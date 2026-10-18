import { app, BrowserWindow, ipcMain, shell, powerSaveBlocker } from 'electron'
import os from 'node:os'
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

import {
  type PrinterSettings,
  type ReceiptSettings,
  type OrderPayload,
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
    receipt: { menuSize: 'small', optionSize: 'small', customerMenuSize: 'small', customerOptionSize: 'small' },
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

// printer:status의 connected는 "포트가 설정돼 있는지"가 아니라 "마지막으로 실제 open을
// 시도했을 때 성공했는지"를 뜻해야 케이블 뽑힘/전원꺼짐을 제대로 반영한다.
let printerReachable = true

function notifyPrinterStatus(): void {
  mainWindow?.webContents.send('printer:status', {
    connected:   !!getPortName() && printerReachable,
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
  const portName = getPortName()
  if (!portName) return { ok: false, error: 'COM 포트를 먼저 선택해 주세요.' }
  try {
    const port = new SerialPort({ path: portName, baudRate: 9600, autoOpen: false })
    await new Promise<void>((resolve, reject) => {
      port.open(err => err ? reject(err) : resolve())
    })
    await new Promise<void>(resolve => port.close(() => resolve()))
    await setPrinterReachable(true)
    return { ok: true }
  } catch (err) {
    await setPrinterReachable(false)
    return { ok: false, error: (err as Error).message }
  }
}

async function printEscPos(data: Buffer): Promise<void> {
  const portName = getPortName()
  if (!portName) throw new Error('COM 포트가 설정되지 않았습니다. 설정 탭에서 포트를 선택해 주세요.')

  const port = new SerialPort({ path: portName, baudRate: 9600, autoOpen: false })

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

// 주문 없이도 끊김을 감지하도록 5분마다 생존 확인 (포트가 설정된 경우만)
setInterval(() => {
  if (getPortName()) testPrinterPort()
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
    await printEscPos(buildCustomerReceiptEscPos(order, receipt))
    await printEscPos(buildKitchenReceiptEscPos(order, receipt))
    console.log(`[IPC] 영수증 출력 완료: ${order.order_code}`)
  } catch (err) {
    console.error('[IPC] 영수증 출력 실패 (무시):', err)
  }

  return { ok: true }
})

ipcMain.handle('order:reject', async (_e, { orderCode, reason }: { orderCode: string; reason: string }) => {
  console.log(`[IPC] order:reject — ${orderCode}, 사유: ${reason}`)
  if (supabase) {
    await supabase.rpc('cancel_order', {
      p_order_code: orderCode,
      p_allow_after_cooking: true,
      p_note: reason,
    })
    try {
      const ch = supabase.channel(`orders:order_code=${orderCode}`)
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          ch.send({ type: 'broadcast', event: 'ORDER_REJECTED', payload: { reason } })
            .then(() => setTimeout(() => supabase!.removeChannel(ch), 1500))
        }
      })
    } catch (e) {
      console.warn('[IPC] broadcast 실패 (무시):', e)
    }
  }
  return { ok: true }
})

ipcMain.handle('order:complete', async (_e, { orderCode }: { orderCode: string }) => {
  console.log(`[IPC] order:complete — ${orderCode}`)
  if (supabase) {
    await supabase.from('orders').update({ status: '완료' }).eq('order_code', orderCode)
  }
  return { ok: true }
})

ipcMain.handle('order:cancel', async (_e, { orderCode }: { orderCode: string }) => {
  console.log(`[IPC] order:cancel — ${orderCode}`)
  if (supabase) {
    await supabase.rpc('cancel_order', { p_order_code: orderCode, p_allow_after_cooking: true })
  }
  return { ok: true }
})

/** 설정 읽기 */
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
  return ports.map(p => ({
    path:         p.path,
    manufacturer: p.manufacturer ?? '',
    // friendlyName 은 Windows 전용 필드라 PortInfo 타입에 없다. 런타임엔 들어온다
    friendlyName: (p as { friendlyName?: string }).friendlyName ?? p.path,
  }))
})

/** 영수증 재출력 */
ipcMain.handle('printer:reprint', async (_e, { order }: { order: OrderPayload }) => {
  const receipt = store.get('receipt')
  try {
    await printEscPos(buildCustomerReceiptEscPos(order, receipt))
    await printEscPos(buildKitchenReceiptEscPos(order, receipt))
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
}) => {
  const portName = getPortName()
  if (!portName) throw new Error('프린터기가 연결되어 있지 않아요')
  try {
    await printEscPos(buildQrReceiptEscPos(payload))
    return { ok: true }
  } catch (err) {
    throw new Error((err as Error).message)
  }
})

/** 테스트 출력 */
ipcMain.handle('printer:test', async () => {
  try {
    await printEscPos(buildTestReceiptEscPos())
    return { ok: true }
  } catch (err) {
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
  printerConnected: !!getPortName() && printerReachable,
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

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('kr.sallaria.pos')
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
