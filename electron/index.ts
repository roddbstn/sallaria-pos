import { app, BrowserWindow, ipcMain, shell, powerSaveBlocker, session } from 'electron'
import os from 'node:os'
import fs from 'node:fs/promises'
import { autoUpdater } from 'electron-updater'
import * as Sentry from '@sentry/electron/main'

// 메인 프로세스 크래시/미처리 예외 — 다른 import보다 먼저 초기화해야 그 아래 코드의 에러도 잡힘
Sentry.init({
  dsn:     import.meta.env.VITE_SENTRY_DSN as string ?? '',
  release: `sunpos-pos@${app.getVersion()}`,
})

// Chromium 자동재생 차단 해제 — 주문 알림음이 사용자 클릭 없이도 재생되도록
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
import Store from 'electron-store'
import { SerialPort } from 'serialport'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'

import {
  type PrinterSettings,
  type ReceiptSettings,
  type OrderPayload,
  resolveLineChars,
  resolveQrPrintMM,
  DEFAULT_TCP_PORT,
  normalizePaperWidth,
} from './printer'

import {
  buildKitchenReceiptEscPos,
  buildCustomerReceiptEscPos,
  buildTestReceiptEscPos,
  buildQrReceiptEscPos,
} from './escpos'

// ── electron-store 스키마 ─────────────────────────────────────────────────────

interface StoreSchema {
  printer: PrinterSettings
  receipt: ReceiptSettings
}

const store = new Store<StoreSchema>({
  defaults: {
    printer: { portName: '' },
    // 기본값이 'small' 이었다 — 점주가 설정을 건드리기 전까지 가장 작은 크기로 찍혔다.
    // 화면 기본값('보통')과도 어긋나 있었다. 이미 저장된 'small' 은 sizeCmd 의
    // default 로 떨어져 '보통'으로 처리된다(타입에서 'small' 을 없앴다).
    receipt: { menuSize: 'normal', optionSize: 'normal', customerMenuSize: 'normal', customerOptionSize: 'normal' },
  },
})

// ── Supabase 클라이언트 (Realtime 전용) ──────────────────────────────────────

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  as string ?? ''
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON as string ?? ''
const supabase = SUPABASE_URL
  // ws 의 생성자 시그니처가 supabase-js 의 WebSocketLikeConstructor 와 미세하게 다르다.
  // Node 에서 Realtime 을 쓰려면 이 주입이 필요하고 런타임은 정상이라 타입만 눌러준다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ? createClient(SUPABASE_URL, SUPABASE_ANON, { realtime: { transport: ws as any } })
  : null

let mainWindow: BrowserWindow | null = null
let currentStoreId: string | null = null

// ── 창 생성 ───────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    // 화면 요소들은 이제 고정 실제 px(스케일 없음)라, 창을 너무 좁히면 고정폭 사이드 패널과
    // 헤더/본문의 좌측 콘텐츠가 겹치거나 밀릴 공간이 없어진다. 최소 폭을 좁힐수록 위험하므로
    // 기본 창 크기(1440)에 거의 근접한 값으로 최소폭을 넉넉히 잡는다(16:9 비율 유지).
    width:          1440,
    height:         810,
    minWidth:       1400,
    minHeight:      788,
    title:          '선포스',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload:        join(__dirname, '../preload/preload.js'),
      sandbox:        false,
      contextIsolation: true,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
    if (is.dev) mainWindow!.webContents.openDevTools()
  })
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ── ESC/POS 시리얼 출력 ───────────────────────────────────────────────────────

function getPortName(): string {
  return store.get('printer')?.portName ?? ''
}

function printerCfg(): PrinterSettings {
  return store.get('printer') ?? { portName: '' }
}

/** LAN 프린터로 설정돼 있고 IP 가 채워져 있을 때만 TCP 경로를 쓴다 */
function lanTarget(): { host: string; port: number } | null {
  const c = printerCfg()
  if (c.link !== 'lan') return null
  const host = (c.host ?? '').trim()
  if (!host) return null
  return { host, port: c.tcpPort && c.tcpPort > 0 ? c.tcpPort : DEFAULT_TCP_PORT }
}

/**
 * OS 프린터(스풀러·CUPS)로 보내야 하는 설정인지.
 *
 * link 가 'usb' 인데 COM 포트가 없고 osPrinter 가 골라져 있으면 이 길로 간다.
 * 윈도우에서 USB 프린터가 COM 으로 잡히는 경우(가상 COM 드라이버)는 portName 이
 * 채워지므로 기존 시리얼 길을 그대로 쓴다 — 그게 더 빠르고 검증된 경로다.
 */
function osPrinterTarget(): string | null {
  const c = printerCfg()
  const name = (c.osPrinter ?? '').trim()
  if (!name) return null
  if (c.link === 'lan') return null          // 랜이 우선
  if (getPortName()) return null             // COM 이 잡혀 있으면 시리얼이 우선
  return name
}

/** 지금 설정으로 출력할 대상이 하나라도 있는지 — COM 포트 · LAN IP · OS 프린터 */
function hasTarget(): boolean {
  return !!lanTarget() || !!getPortName() || !!osPrinterTarget()
}

// printer:status의 connected는 "포트가 설정돼 있는지"가 아니라 "마지막으로 실제 open을
// 시도했을 때 성공했는지"를 뜻해야 케이블 뽑힘/전원꺼짐을 제대로 반영한다.
let printerReachable = true

function notifyPrinterStatus(): void {
  mainWindow?.webContents.send('printer:status', {
    connected:   hasTarget() && printerReachable,
    queueLength: 0,
  })
}

/** 운영 알림(Slack/Discord) — send-ops-alert Edge Function 호출. 실패해도 무시(알림은 best-effort). */
async function sendOpsAlert(event: string, message: string): Promise<void> {
  if (!SUPABASE_URL) return
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-ops-alert`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
      body:    JSON.stringify({ event, storeId: currentStoreId, message }),
    })
  } catch (e) {
    console.warn('[OpsAlert] 전송 실패 (무시):', e)
  }
}

/** 실제 연결 가능 여부가 바뀌었을 때만 상태 갱신 + 운영 알림 (매 시도마다 스팸 방지) */
async function setPrinterReachable(reachable: boolean): Promise<void> {
  const changed = reachable !== printerReachable
  printerReachable = reachable
  notifyPrinterStatus()
  if (!changed) return
  await sendOpsAlert(
    reachable ? 'printer_reconnected' : 'printer_disconnected',
    reachable ? '프린터가 다시 연결됐어요' : '프린터 연결이 끊겼어요 — 주문이 와도 영수증이 안 나올 수 있어요',
  )
}

/** 포트 open/close만 테스트 — 실제 출력 없이 생존 여부만 확인 (연결 버튼 + 주기적 헬스체크 공용) */
async function testPrinterPort(): Promise<{ ok: boolean; error?: string }> {
  const lan = lanTarget()
  try {
    if (lan) {
      await tcpProbe(lan.host, lan.port)
    } else if (osPrinterTarget()) {
      // OS 프린터는 "열어보기"가 없다. 스풀러/CUPS 에 그 이름이 **여전히 있는지**만 본다 —
      // 프린터를 뽑으면 목록에서 사라지므로 그게 사실상의 생존 확인이다.
      // (여기서 시험 출력을 하면 5분마다 종이가 나온다)
      const name = osPrinterTarget()!
      const found = mainWindow
        ? (await mainWindow.webContents.getPrintersAsync()).find(x => x.name === name)
        : undefined
      if (mainWindow && !found) {
        throw new Error(`'${name}' 프린터를 더 이상 찾을 수 없어요. 케이블을 확인해 주세요.`)
      }
      // ⚠️ 이름이 목록에 있다고 연결된 게 아니다.
      //    USB 프린터를 뽑아도 CUPS/스풀러의 **큐는 남아 있어서** 목록에는 계속 보인다.
      //    상태를 안 보면 "연결됨"이라고 거짓말하게 된다(실제로 그랬다).
      const reasons = String(
        ((found?.options ?? {}) as Record<string, unknown>)['printer-state-reasons'] ?? '',
      ).toLowerCase()
      if (reasons.includes('offline') || reasons.includes('shutdown')) {
        throw new Error(`'${name}' 가 꺼져 있거나 케이블이 빠져 있어요.`)
      }
    } else {
      const portName = getPortName()
      if (!portName) return { ok: false, error: '프린터를 먼저 선택해 주세요.' }
      const port = new SerialPort({ path: portName, baudRate: printerCfg().baudRate ?? 9600, autoOpen: false })
      await new Promise<void>((resolve, reject) => {
        port.open(err => err ? reject(err) : resolve())
      })
      await new Promise<void>(resolve => port.close(() => resolve()))
    }
    await setPrinterReachable(true)
    return { ok: true }
  } catch (err) {
    await setPrinterReachable(false)
    return { ok: false, error: (err as Error).message }
  }
}

/** LAN 프린터 생존 확인 — 연결만 해 보고 바로 끊는다 */
function tcpProbe(host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port })
    // 네트워크 프린터는 꺼져 있어도 TCP SYN 에 응답이 없을 뿐이라 타임아웃이 꼭 필요하다.
    // 없으면 OS 기본값(수십 초)까지 매달려 설정 화면이 멈춘 것처럼 보인다.
    sock.setTimeout(3000)
    sock.once('connect', () => { sock.destroy(); resolve() })
    sock.once('timeout', () => { sock.destroy(); reject(new Error(`${host}:${port} 에 응답이 없어요`)) })
    sock.once('error',   err => { sock.destroy(); reject(err) })
  })
}

async function printEscPos(data: Buffer): Promise<void> {
  const lan = lanTarget()
  if (lan) { await printOverTcp(data, lan.host, lan.port); return }

  // USB 로 꽂아 OS 가 '프린터'로 등록한 경우 — 시리얼 포트가 없으니 스풀러/CUPS 로 보낸다.
  // 순서가 중요하다: LAN > 시리얼(COM) > OS 프린터. 앞의 둘이 더 빠르고 더 검증돼 있다.
  const osName = osPrinterTarget()
  if (osName) {
    try {
      await printToOsPrinter(data, osName)
    } catch (err) {
      // ⚠️ setPrinterReachable 은 try 밖에서 부른다. 안에 두면 그 안의 운영알림이
      //    실패할 때 "출력 실패" 로 뒤바뀐다 — 영수증은 이미 나왔는데도.
      console.error('[Print] OS 프린터 출력 실패:', err)
      await setPrinterReachable(false)
      throw err
    }
    await setPrinterReachable(true)
    return
  }

  const portName = getPortName()
  if (!portName) {
    throw new Error(
      '출력할 프린터가 설정되지 않았습니다. 설정 > 프린터 연결에서 프린터를 골라주세요.',
    )
  }

  const port = new SerialPort({ path: portName, baudRate: printerCfg().baudRate ?? 9600, autoOpen: false })

  try {
    await new Promise<void>((resolve, reject) => {
      port.open(err => err ? reject(err) : resolve())
    })
  } catch (err) {
    await setPrinterReachable(false)
    throw err
  }

  try {
    await new Promise<void>((resolve, reject) => {
      port.write(data, err => {
        if (err) { reject(err); return }
        port.drain(err2 => err2 ? reject(err2) : resolve())
      })
    })
    await setPrinterReachable(true)
  } catch (err) {
    await setPrinterReachable(false)
    throw err
  } finally {
    await new Promise<void>(resolve => port.close(() => resolve()))
  }
}

/** LAN(RJ45) 프린터 — ESC/POS 를 TCP 9100 으로 그대로 흘려보낸다 */
function printOverTcp(data: Buffer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port })
    sock.setTimeout(5000)
    const fail = (err: Error) => { sock.destroy(); setPrinterReachable(false); reject(err) }
    sock.once('connect', () => {
      sock.write(data, err => {
        if (err) { fail(err); return }
        // end() 로 FIN 을 보낸 뒤 close 를 기다린다 — 바로 destroy 하면 버퍼가 비기 전에
        // 소켓이 닫혀 영수증이 중간에서 끊긴다.
        sock.end()
      })
    })
    sock.once('close',   () => { setPrinterReachable(true); resolve() })
    sock.once('timeout', () => fail(new Error(`${host}:${port} 에 응답이 없어요`)))
    sock.once('error',   err => fail(err))
  })
}

/**
 * 운영체제에 등록된 프린터로 **원시 ESC/POS** 를 보낸다.
 *
 * 왜 필요한가: 영수증 프린터를 USB 로 꽂으면 시리얼 포트(COM)가 아니라
 * '프린터'로 등록되는 일이 흔하다. 그러면 SerialPort 로는 보낼 길이 없다.
 * 실제 사례(2026-10-22): BIXOLON SRP-B300II 를 맥에 USB 로 꽂으면
 *   lpstat -v → usb://BIXOLON/SRP-B300II?serial=00000001
 *   SerialPort.list() → 이 프린터 없음
 * 이 경로가 없으면 "프린터가 눈앞에 꽂혀 있는데 출력 못 하는" 상태가 된다.
 *
 * ⚠️ 핵심은 **드라이버가 변환하지 않게** 하는 것이다. 평범하게 인쇄하면 OS 가
 *    그림으로 만들어 보내서 ESC/POS 명령(절단·굵게)이 글자로 찍히거나 무시된다.
 *    그래서 양쪽 다 "raw(원시)" 모드를 명시한다.
 *
 * macOS/Linux : lp -d <이름> -o raw  — stdin 으로 바이트를 그대로 흘린다.
 *               2026-10-22 맥 + SRP-B300II 에서 동작 확인(절단까지).
 * Windows     : 스풀러에 datatype "RAW" 로 넣어야 한다. PowerShell 에서
 *               winspool.drv 를 P/Invoke 한다 — 네이티브 모듈을 안 쓰는 이유는
 *               electron-rebuild 가 배포 파이프라인을 복잡하게 만들기 때문이다.
 *               ⚠️ 윈도우 실기 검증은 아직 못 했다(설치 때 확인 필요).
 */
async function printToOsPrinter(data: Buffer, printerName: string): Promise<void> {
  if (process.platform === 'win32') {
    await printToOsPrinterWindows(data, printerName)
  } else {
    await printToOsPrinterCups(data, printerName)
  }
}

/**
 * lp 실행 파일 경로.
 *
 * PATH 에 의존하지 않는다 — 개발 중엔 셸 환경을 물려받아 'lp' 로도 잡히지만,
 * **패키징한 .app 을 Finder/독에서 띄우면 PATH 가 `/usr/bin:/bin:/usr/sbin:/sbin`
 * 정도로 줄거나 비어서** spawn 이 ENOENT 로 죽는다. 절대경로를 먼저 본다.
 */
function lpBinary(): string {
  for (const c of ['/usr/bin/lp', '/bin/lp', '/usr/local/bin/lp']) {
    if (existsSync(c)) return c
  }
  return 'lp'   // 마지막 수단 — PATH 에 맡긴다
}

function printToOsPrinterCups(data: Buffer, printerName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // -o raw : 드라이버 변환을 끈다. -o document-format 을 쓰지 않는 게 중요하다.
    const bin = lpBinary()
    console.log(`[Print] CUPS raw → ${printerName} (${bin}, ${data.length} bytes)`)
    const lp = spawn(bin, ['-d', printerName, '-o', 'raw'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    lp.stderr.on('data', c => { stderr += String(c) })
    lp.once('error', err => {
      console.error('[Print] lp 실행 실패:', err)
      reject(new Error(`lp 실행 실패: ${err.message}`))
    })
    lp.once('close', code => {
      if (code === 0) { console.log('[Print] CUPS 전송 완료'); resolve(); return }
      console.error(`[Print] lp 종료코드 ${code}`, stderr)
      reject(new Error(`lp 가 ${code} 로 끝났어요${stderr ? `: ${stderr.trim()}` : ''}`))
    })
    lp.stdin.on('error', err => reject(err))
    lp.stdin.end(data)
  })
}

async function printToOsPrinterWindows(data: Buffer, printerName: string): Promise<void> {
  // 임시 파일을 거친다 — PowerShell 표준입력으로 바이너리를 넘기면 인코딩이 끼어든다.
  const tmp = join(tmpdir(), `sunpos-raw-${Date.now()}.bin`)
  await writeFile(tmp, data)

  // winspool.drv P/Invoke — StartDocPrinter 의 datatype 을 "RAW" 로 지정하는 게 핵심.
  // 이 문자열이 없으면 스풀러가 텍스트로 해석해 ESC/POS 가 그대로 찍힌다.
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public static class RawPrint {
  [StructLayout(LayoutKind.Sequential)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet=CharSet.Ansi, SetLastError=true)]
  public static extern bool OpenPrinterA(string src, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", CharSet=CharSet.Ansi, SetLastError=true)]
  public static extern bool StartDocPrinterA(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static void Send(string printer, string file) {
    byte[] bytes = File.ReadAllBytes(file);
    IntPtr h;
    if (!OpenPrinterA(printer, out h, IntPtr.Zero))
      throw new Exception("OpenPrinter 실패: " + Marshal.GetLastWin32Error());
    try {
      DOCINFOA di = new DOCINFOA();
      di.pDocName = "SUNPOS Receipt";
      di.pDataType = "RAW";
      if (!StartDocPrinterA(h, 1, di)) throw new Exception("StartDocPrinter 실패: " + Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(h)) throw new Exception("StartPagePrinter 실패: " + Marshal.GetLastWin32Error());
        IntPtr p = Marshal.AllocHGlobal(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, p, bytes.Length);
          int written;
          if (!WritePrinter(h, p, bytes.Length, out written))
            throw new Exception("WritePrinter 실패: " + Marshal.GetLastWin32Error());
        } finally { Marshal.FreeHGlobal(p); }
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[RawPrint]::Send(${JSON.stringify(printerName)}, ${JSON.stringify(tmp)})
`.trim()

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
        { windowsHide: true },
      )
      let stderr = ''
      child.stderr.on('data', c => { stderr += String(c) })
      child.once('error', err => reject(new Error(`PowerShell 실행 실패: ${err.message}`)))
      child.once('close', code => {
        if (code === 0) resolve()
        else reject(new Error(`스풀러 출력 실패(code ${code})${stderr ? `: ${stderr.trim().slice(0, 300)}` : ''}`))
      })
    })
  } finally {
    await unlink(tmp).catch(() => {})
  }
}

// 주문 없이도 끊김을 감지하도록 5분마다 생존 확인 (출력 대상이 설정된 경우만)
setInterval(() => {
  if (hasTarget()) testPrinterPort()
}, 5 * 60 * 1000)

// ── Supabase Realtime 구독 ────────────────────────────────────────────────────

function subscribeRealtime(): void {
  if (!supabase) {
    console.warn('[POS] Supabase URL 미설정 — Realtime 구독 건너뜀')
    return
  }

  supabase
    .channel('pos-orders')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders' },
      async (payload) => {
        if (currentStoreId) {
          const accountCode = payload.new['account_code'] as string
          const { data: acc } = await supabase!
            .from('accounts')
            .select('store_id')
            .eq('account_code', accountCode)
            .maybeSingle()
          if (!acc || acc.store_id !== currentStoreId) {
            console.log(`[Realtime] 타 매장 주문 무시 — account: ${accountCode}`)
            return
          }
        }
        console.log('[Realtime] 새 주문 수신:', payload.new)
        mainWindow?.webContents.send('order:new', payload.new)
      }
    )
    .subscribe((status) => {
      console.log('[Realtime] 구독 상태:', status)
      mainWindow?.webContents.send('realtime:status', status)
    })
}

// ── IPC 핸들러 ────────────────────────────────────────────────────────────────

ipcMain.handle('store:setStoreId', (_e, storeId: string) => {
  console.log('[IPC] store:setStoreId:', storeId)
  currentStoreId = storeId
})

/**
 * 주문 접수 확정 → 고객용 + 주방용 영수증 출력
 * approve_order RPC는 렌더러(OrderPopup)에서 이미 호출 — 여기선 출력만
 */
ipcMain.handle('order:approve', async (_e, { order, prepMins }: { order: OrderPayload; prepMins: number }) => {
  console.log(`[IPC] order:approve — ${order.order_code}, 준비시간: ${prepMins}분`)

  // 웹 success 페이지에 broadcast (best-effort)
  if (supabase) {
    try {
      const ch = supabase.channel(`orders:order_code=${order.order_code}`)
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          ch.send({ type: 'broadcast', event: 'ORDER_ACCEPTED', payload: { estimated_minutes: prepMins } })
            .then(() => setTimeout(() => supabase!.removeChannel(ch), 1500))
        }
      })
    } catch (e) {
      console.warn('[IPC] broadcast 실패 (무시):', e)
    }
  }

  // 수락 시 영수증 출력
  const receipt = store.get('receipt')
  try {
    await printEscPos(buildCustomerReceiptEscPos(order, receipt, resolveLineChars(printerCfg())))
    await printEscPos(buildKitchenReceiptEscPos(order, receipt, resolveLineChars(printerCfg())))
    console.log(`[IPC] 영수증 출력 완료: ${order.order_code}`)
  } catch (err) {
    console.error('[IPC] 영수증 출력 실패 (무시):', err)
  }

  return { ok: true }
})

/** 설정 읽기 */
// ── 주문 상태 조작 IPC 는 전부 지웠다 (2026-10-22) ───────────────────────────
//
// order:reject / order:complete / order:cancel 세 개가 있었는데:
//   · order:complete, order:cancel 은 renderer 에서 아무도 안 불렀다 (죽은 코드).
//     게다가 이 프로세스의 supabase 는 **anon 키 + 세션 없음**(위 createClient)이라
//     orders RLS(authenticated 전용)에 걸려 0행 UPDATE 로 조용히 실패하는 코드였다.
//   · order:reject 는 OrderPopup 이 불렀지만, 하는 일이 renderer 가 이미 한 것과
//     똑같았다 — cancel_order 는 'Order already cancelled' 로 늘 터지고,
//     ORDER_REJECTED broadcast 는 손님 화면에 두 번 갔다.
//
// 주문 상태를 바꾸는 일은 **세션이 있는 renderer 에서만** 한다. 그래야
// cancel_order 같은 함수를 anon 에서 회수할 수 있다(supabase/migrations/0013).

ipcMain.handle('settings:get', async () => {
  return {
    printer: { portName: store.get('printer')?.portName ?? '' },
    receipt: store.get('receipt'),
  }
})

/** 설정 저장 */
ipcMain.handle('settings:update', async (_e, patch: Partial<StoreSchema>) => {
  if (patch.printer) store.set('printer', patch.printer)
  if (patch.receipt) store.set('receipt', patch.receipt)
  notifyPrinterStatus()
  return { ok: true }
})

/** 시스템에 연결된 COM 포트 목록 */
ipcMain.handle('printer:list-ports', async () => {
  const ports = await SerialPort.list()
  return ports.map(p => {
    const x = p as {
      friendlyName?: string; vendorId?: string; productId?: string; pnpId?: string
    }
    return {
      path:         p.path,
      manufacturer: p.manufacturer ?? '',
      // ⚠️ 여기서 path 로 폴백하지 않는다.
      //
      // 전엔 `friendlyName ?? p.path` 였다. friendlyName 은 **Windows 전용** 필드라
      // macOS 에선 늘 undefined → path 가 들어갔고, 화면의 guessModel() 이 그걸
      // 제품명으로 알고 그대로 찍어서 "/dev/tty.Bluetooth-Incoming-Port" 가
      // 프린터 이름처럼 보였다. 비워서 보내면 화면이 자기 폴백('알 수 없는 프린터')을
      // 쓸 수 있다.
      friendlyName: x.friendlyName ?? '',
      // 식별에 쓸 추가 단서. Windows 는 대개 다 채워주고, macOS 는 USB 장치만 채운다.
      // 문자열 매칭보다 VID/PID 가 정확하다 — 같은 모델이 드라이버에 따라 이름이 달라진다.
      vendorId:     x.vendorId  ?? '',
      productId:    x.productId ?? '',
      pnpId:        x.pnpId     ?? '',
    }
  })
})

/**
 * 운영체제가 알고 있는 프린터 목록 (Windows 스풀러 · macOS CUPS).
 *
 * 왜 필요한가: 영수증 프린터를 USB 로 꽂으면 **시리얼 포트가 아니라 "프린터"로**
 * 등록되는 경우가 많다. 그러면 SerialPort.list() 에 아예 안 잡히고, 화면은
 * "찾은 프린터 0개" 라고 말한다 — 프린터가 눈앞에 꽂혀 있는데도.
 *
 * 실제로 확인한 사례(2026-10-22, 개발용 맥):
 *   lpstat -v → BIXOLON_SRP_B300II   usb://BIXOLON/SRP-B300II?serial=00000001
 *   SerialPort.list() → 맥 기본 포트 3개뿐, 프린터 없음
 *
 * ⚠️ 이 목록은 **알려주기 위한 것**이고, 여기로 출력하지는 못한다.
 *    printEscPos 는 시리얼과 LAN(TCP 9100) 두 길만 가진다. OS 프린터로 보내려면
 *    스풀러/CUPS 경로를 새로 붙여야 한다(아직 없음).
 *    그래도 "0개"라고 거짓말하는 것보다 "이렇게 꽂혀 있는데 이 길로는 못 보낸다"가 낫다.
 */
ipcMain.handle('printer:list-os', async () => {
  if (!mainWindow) return []
  try {
    const list = await mainWindow.webContents.getPrintersAsync()
    return list.map(p => {
      const opt = (p.options ?? {}) as Record<string, unknown>
      // CUPS/스풀러가 알려주는 상태. 케이블을 뽑으면 여기에 'offline-report' 가 들어온다.
      //   lpstat -l -p <name>  →  "경고: offline-report"
      // 이걸 안 보면 **뽑아놔도 목록에 그대로 남는다** — 큐는 지워지지 않으니까.
      const reasons = String(opt['printer-state-reasons'] ?? '').toLowerCase()
      // printer-state: 3 idle · 4 processing · 5 stopped
      const state = String(opt['printer-state'] ?? '')
      return {
        name:        p.name,
        displayName: p.displayName || p.name,
        description: p.description ?? '',
        // options 는 플랫폼별 자유 필드다. macOS/CUPS 는 device-uri 를 담아주는데
        // 그 값으로 "USB 로 꽂혔는지 / 랜인지"를 사람에게 설명할 수 있다.
        // (예: usb://BIXOLON/SRP-B300II?serial=00000001)
        deviceUri:   String(opt['device-uri'] ?? ''),
        /** 지금 실제로 쓸 수 있는 상태인가 — 꽂혀 있고 멈춰 있지 않은가 */
        offline:     reasons.includes('offline') || reasons.includes('shutdown') || state === '5',
        stateReason: reasons,
      }
    })
  } catch (err) {
    console.warn('[IPC] printer:list-os 실패:', err)
    return []
  }
})

/** 영수증 재출력 */
ipcMain.handle('printer:reprint', async (_e, { order }: { order: OrderPayload }) => {
  const receipt = store.get('receipt')
  try {
    await printEscPos(buildCustomerReceiptEscPos(order, receipt, resolveLineChars(printerCfg())))
    await printEscPos(buildKitchenReceiptEscPos(order, receipt, resolveLineChars(printerCfg())))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

/** 프린터 연결 확인 (설정에서 "연결하기" 버튼) — COM 포트 열기 테스트 */
ipcMain.handle('printer:connect', () => testPrinterPort())

/** 거래처 QR 영수증 출력 */
ipcMain.handle('printer:qr-receipt', async (_e, payload: {
  accountName: string; manager: string; phone: string; pin: string; qrUrl: string; storeName: string
  storePhone?: string; notice?: string
}) => {
  if (!hasTarget()) throw new Error('프린터기가 연결되어 있지 않아요')
  try {
    await printEscPos(buildQrReceiptEscPos(payload, resolveLineChars(printerCfg()), resolveQrPrintMM(printerCfg())))
    return { ok: true }
  } catch (err) {
    throw new Error((err as Error).message)
  }
})

/** 테스트 출력 */
/**
 * A4 시트(QR 종이)를 **무음으로** 지정한 OS 프린터에 보낸다.
 *
 * 왜 메인이 하나: 렌더러의 iframe.print() 는 브라우저 인쇄 대화상자를 띄운다.
 * 영수증 프린터는 설정에 저장해 두고 바로 나가는데 A4 만 매번 손으로 프린터를
 * 고르는 게 앞뒤가 안 맞았다 — 두 대를 같이 쓰는 매장이 많다.
 *
 * deviceName 이 비어 있거나 실패하면 **false 를 돌려준다.** 렌더러가 그때
 * 기존 대화상자 방식으로 떨어뜨린다 — 못 찍는 것보다 한 번 더 누르는 게 낫다.
 */
ipcMain.handle('printer:print-sheet', async (_e, { html, deviceName }: { html: string; deviceName?: string }) => {
  if (!html) return { ok: false, error: '내용이 비어 있어요' }

  // data: URL 로 띄우면 QR 이 base64 라 길이 제한에 걸린다. 임시 파일로 연다.
  const file = join(os.tmpdir(), `sunpos-sheet-${Date.now()}.html`)
  let win: BrowserWindow | null = null
  try {
    await fs.writeFile(file, html, 'utf8')
    win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } })
    await win.loadFile(file)
    // 폰트·이미지가 자리를 잡을 시간 — 렌더러 쪽 250ms 와 같은 이유다
    await new Promise(r => setTimeout(r, 300))

    const ok = await new Promise<boolean>(resolve => {
      win!.webContents.print(
        { silent: true, printBackground: true, ...(deviceName ? { deviceName } : {}) },
        success => resolve(success),
      )
    })
    return ok ? { ok: true } : { ok: false, error: '인쇄가 취소됐어요' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    win?.destroy()
    fs.unlink(file).catch(() => {})
  }
})

ipcMain.handle('printer:test', async () => {
  const cfg = printerCfg()
  const lineChars = resolveLineChars(cfg)
  // 실패했을 때 "어떤 설정으로 어느 길로 갔나"를 알 수 있어야 원격 지원이 된다.
  console.log('[Print] 테스트 출력 요청', {
    link: cfg.link, portName: cfg.portName, osPrinter: cfg.osPrinter,
    paperWidth: cfg.paperWidth, lineChars,
  })
  try {
    await printEscPos(buildTestReceiptEscPos(lineChars))
    return { ok: true }
  } catch (err) {
    console.error('[Print] 테스트 출력 실패:', err)
    return { ok: false, error: (err as Error).message }
  }
})

// ── 자동 업데이트 ─────────────────────────────────────────────────────────────

autoUpdater.autoDownload    = true
autoUpdater.autoInstallOnAppQuit = true

autoUpdater.on('update-available', (info) => {
  console.log('[Updater] 업데이트 발견:', info.version)
  mainWindow?.webContents.send('updater:status', { type: 'available', version: info.version })
})
autoUpdater.on('update-downloaded', (info) => {
  console.log('[Updater] 다운로드 완료:', info.version)
  mainWindow?.webContents.send('updater:status', { type: 'downloaded', version: info.version })
})
autoUpdater.on('error', (err) => {
  console.warn('[Updater] 오류 (무시):', err.message)
})

ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall()
})

// 설정 > 기타 > '업데이트 확인' 이 부르는 수동 확인.
//
// 앱 시작 10초 뒤의 자동 확인과 같은 autoUpdater 를 쓰지만, 이쪽은 **결과를 돌려준다** —
// 자동 확인은 조용히 실패해도 되지만 버튼은 누른 사람에게 답을 줘야 한다.
//
// ⚠️ 지금 GitHub 릴리즈에 latest.yml 피드가 없어서 'error' 가 돌아온다.
//    v* 태그를 한 번 밀어 release.yml 이 피드를 올리면 그때부터 제대로 답한다.
//    그래서 에러를 숨기지 않고 'no-feed' 로 구분해 돌려준다 — 화면에서
//    "확인할 수 없어요"와 "최신이에요"를 다르게 말해야 하기 때문이다.
ipcMain.handle('updater:check', async () => {
  const current = app.getVersion()
  try {
    const r = await autoUpdater.checkForUpdates()
    const latest = r?.updateInfo?.version
    if (!latest) return { state: 'latest' as const, current }
    return latest !== current
      ? { state: 'available' as const, current, latest }
      : { state: 'latest' as const, current }
  } catch (err) {
    const msg = (err as Error).message ?? ''
    // 피드 파일이 없을 때 electron-updater 가 내는 전형적인 메시지들
    const noFeed = /404|Cannot find|latest.*\.yml|ENOTFOUND|No published versions/i.test(msg)
    return { state: noFeed ? ('no-feed' as const) : ('error' as const), current, message: msg }
  }
})

// ── 기타 설정이 쓰는 것들 ─────────────────────────────────────────────────────

ipcMain.handle('app:version', () => app.getVersion())

/** 로그 폴더 열기 — 점주가 문제를 보낼 때 파일을 찾아갈 수 있게 */
ipcMain.handle('app:open-logs', async () => {
  const dir = app.getPath('logs')
  const err = await shell.openPath(dir)
  return err ? { ok: false, dir, error: err } : { ok: true, dir }
})

/**
 * 영업 중 화면 꺼짐 방지.
 *
 * Electron 의 powerSaveBlocker 는 Windows · macOS · Linux 셋 다 지원한다.
 * 다만 Linux 는 데스크톱 환경이 org.freedesktop.ScreenSaver 를 제공해야 먹는다.
 * 침산점 POS 는 Windows x64 라 실사용 경로에서는 문제가 없다.
 *
 * 'prevent-display-sleep' 은 화면까지 켜 둔다('prevent-app-suspension' 은
 * 시스템만 깨우고 모니터는 꺼진다 — 주문을 눈으로 봐야 하므로 전자가 맞다).
 */
let keepAwakeId: number | null = null
ipcMain.handle('app:keep-awake', (_e, on: boolean) => {
  if (on) {
    if (keepAwakeId === null || !powerSaveBlocker.isStarted(keepAwakeId)) {
      keepAwakeId = powerSaveBlocker.start('prevent-display-sleep')
    }
  } else if (keepAwakeId !== null && powerSaveBlocker.isStarted(keepAwakeId)) {
    powerSaveBlocker.stop(keepAwakeId)
    keepAwakeId = null
  }
  return {
    active: keepAwakeId !== null && powerSaveBlocker.isStarted(keepAwakeId),
    platform: process.platform,
  }
})

/**
 * 진단 리포트에 들어갈 메인 프로세스 쪽 정보.
 *
 * 무엇을 넣을지는 "실제로 들어오는 문의"로 정했다:
 *   "영수증이 안 나와요"  → 프린터 포트·연결 상태
 *   "주문이 안 들어와요"  → 앱 버전·플랫폼 (실시간 연결은 렌더러가 안다)
 *   "소리가 안 나요"      → 알림음 설정 (렌더러 쪽)
 * 사람이 되묻지 않고 원인을 좁힐 수 있는 것만 넣는다.
 */
ipcMain.handle('app:diagnostics', () => ({
  version:   app.getVersion(),
  electron:  process.versions.electron,
  chrome:    process.versions.chrome,
  node:      process.versions.node,
  platform:  process.platform,
  arch:      process.arch,
  osRelease: os.release(),
  logDir:    app.getPath('logs'),
  printerPort:      getPortName() || '',
  printerConnected: hasTarget() && printerReachable,
  // 영수증이 깨져 나온다는 문의의 90%는 용지 넓이/글자수 불일치라, 진단에 꼭 들어가야 한다
  paperWidth:       normalizePaperWidth(printerCfg().paperWidth),
  lineChars:        resolveLineChars(printerCfg()),
  link:             printerCfg().link ?? 'serial',
  baudRate:         printerCfg().baudRate ?? 9600,
  lanHost:          printerCfg().link === 'lan' ? (printerCfg().host ?? '') : '',
}))

// ── 앱 생명주기 ───────────────────────────────────────────────────────────────

// ── sunpos:// 딥링크 프로토콜 (비밀번호 재설정 이메일 링크용) ──────────────────

// Windows: 앱이 이미 실행 중일 때 두 번째 인스턴스 실행 시도 → URL 수신
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // Windows에서 딥링크 URL은 argv 마지막 인수로 들어옴
    const url = argv.find(arg => arg.startsWith('sunpos://'))
    if (url && mainWindow) {
      mainWindow.focus()
      mainWindow.webContents.send('auth:deeplink', url)
    }
  })
}

function handleDeeplinkOnStart(): void {
  // Windows: 앱이 닫혀 있을 때 딥링크로 실행되면 process.argv에 URL 포함
  const url = process.argv.find(arg => arg.startsWith('sunpos://'))
  if (url) {
    mainWindow?.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('auth:deeplink', url)
    })
  }
}

/**
 * 카카오 지도 SDK 요청에 Referer 를 붙인다.
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────
 * 카카오는 JavaScript 키를 **등록된 도메인에서 온 요청인지**로 막는다(키 도용 방지).
 * 그런데 이 앱은 프로덕션에서 화면이 file:// 로 뜨고(아래 loadFile), file:// 은
 * Referer 를 보내지 않는다 — 등록할 도메인 자체가 없어서 지도가 통째로 안 뜬다.
 *
 * 그래서 메인 프로세스에서 Referer 를 채워 보낸다. 우회가 아니다 —
 * **우리 카카오 앱의 우리 키**이고, 아래 도메인도 우리가 등록한 우리 서비스다.
 * 카카오의 도메인 검사는 남이 키를 훔쳐 쓰는 걸 막자는 것이지 같은 제품의
 * 데스크탑 클라이언트를 막자는 게 아니다.
 *
 * ⚠️ 이 도메인이 개발자센터 > 플랫폼 > Web 에서 빠지면 POS 지도가 조용히 죽는다.
 *    (QR웹은 진짜 https 도메인에서 떠서 이 처리가 필요 없다)
 */
const KAKAO_REFERER = 'https://sunpos-kakao.vercel.app'

function attachKakaoReferer() {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://dapi.kakao.com/*', 'https://*.daumcdn.net/*'] },
    (details, callback) => {
      callback({
        requestHeaders: { ...details.requestHeaders, Referer: KAKAO_REFERER },
      })
    },
  )
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('kr.sallaria.pos')
  attachKakaoReferer()
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  // sunpos:// 프로토콜 핸들러로 등록 (설치된 앱에서만 동작)
  if (!is.dev) {
    app.setAsDefaultProtocolClient('sunpos')
  }

  createWindow()
  subscribeRealtime()
  handleDeeplinkOnStart()

  // 설정 탭 진입 시 프린터 상태 초기 전송
  mainWindow?.webContents.once('did-finish-load', () => notifyPrinterStatus())

  // 앱 시작 10초 후 업데이트 확인 (개발 환경 제외)
  if (!is.dev) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
