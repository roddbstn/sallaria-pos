import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createClient } from '@supabase/supabase-js'
import Store from 'electron-store'
import { SerialPort } from 'serialport'

import {
  PrintQueue,
  buildCustomerReceipt,
  buildKitchenReceipt,
  buildTestReceipt,
  type PrinterSettings,
  type ReceiptSettings,
  type OrderPayload,
} from './printer'

// ── electron-store 스키마 ─────────────────────────────────────────────────────

interface StoreSchema {
  printer: PrinterSettings
  receipt: ReceiptSettings
}

const store = new Store<StoreSchema>({
  defaults: {
    printer: { path: 'COM3', baudRate: 9600, cutMode: 'partial' },
    receipt: { menuSize: 'normal', optionSize: 'small' },
  },
})

// ── 전역 인스턴스 ─────────────────────────────────────────────────────────────

const printQueue = new PrintQueue()

// ── Supabase 클라이언트 (Realtime 전용) ──────────────────────────────────────

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL  ?? ''
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON ?? ''
const supabase = SUPABASE_URL ? createClient(SUPABASE_URL, SUPABASE_ANON) : null

let mainWindow: BrowserWindow | null = null

// ── 창 생성 ───────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width:          1280,
    height:         800,
    minWidth:       1024,
    minHeight:      600,
    title:          '샐러리아 POS',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload:        join(__dirname, '../preload/index.js'),
      sandbox:        false,
      contextIsolation: true,
    },
  })

  printQueue.setWindow(mainWindow)

  mainWindow.on('ready-to-show', () => mainWindow!.show())
  mainWindow.on('closed', () => {
    printQueue.setWindow(null)
    mainWindow = null
  })
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

// ── 프린터 초기화 (저장된 설정으로 포트 열기) ────────────────────────────────

async function initPrinter(): Promise<void> {
  const settings = store.get('printer')
  if (!settings.path) return
  try {
    await printQueue.open(settings)
    console.log(`[Printer] 초기화 완료: ${settings.path}`)
  } catch (err) {
    console.warn('[Printer] 초기화 실패 (프린터 연결 확인 필요):', (err as Error).message)
  }
}

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
      { event: 'INSERT', schema: 'public', table: '주문' },
      (payload) => {
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

/**
 * 주문 접수 확정 → 고객용 + 주방용 영수증 순서대로 출력
 * 렌더러에서 order 전체 payload + prepMins 전달
 */
ipcMain.handle('order:approve', async (_e, { order, prepMins }: { order: OrderPayload; prepMins: number }) => {
  console.log(`[IPC] order:approve — ${order.order_code}, 준비시간: ${prepMins}분`)

  const receipt = store.get('receipt')
  // 고객용 먼저, 이어서 주방용
  printQueue.enqueue(buildCustomerReceipt(order))
  printQueue.enqueue(buildKitchenReceipt(order, receipt))

  return { ok: true }
})

ipcMain.handle('order:reject', async (_e, { orderCode, reason }) => {
  console.log(`[IPC] order:reject — ${orderCode}, 사유: ${reason}`)
  // TODO: Supabase PATCH 상태 = '취소'
  return { ok: true }
})

ipcMain.handle('order:complete', async (_e, { orderCode }) => {
  console.log(`[IPC] order:complete — ${orderCode}`)
  // TODO: Supabase PATCH 상태 = '완료'
  return { ok: true }
})

ipcMain.handle('order:cancel', async (_e, { orderCode }) => {
  console.log(`[IPC] order:cancel — ${orderCode}`)
  // TODO: Supabase PATCH 상태 = '취소' + 잔액 환원
  return { ok: true }
})

/** 설정 읽기 */
ipcMain.handle('settings:get', async () => {
  return {
    printer: store.get('printer'),
    receipt: store.get('receipt'),
  }
})

/** 설정 저장 + 필요 시 포트 재초기화 */
ipcMain.handle('settings:update', async (_e, patch: Partial<StoreSchema>) => {
  const prevPath    = store.get('printer').path
  const prevBaud    = store.get('printer').baudRate

  if (patch.printer) store.set('printer', patch.printer)
  if (patch.receipt) store.set('receipt', patch.receipt)

  // 프린터 경로나 보드레이트가 바뀌면 포트 재초기화
  const newPrinter = store.get('printer')
  if (patch.printer && (prevPath !== newPrinter.path || prevBaud !== newPrinter.baudRate)) {
    try {
      await printQueue.open(newPrinter)
    } catch (err) {
      console.warn('[Printer] 재초기화 실패:', (err as Error).message)
    }
  }

  return { ok: true }
})

/** 사용 가능한 시리얼 포트 목록 */
ipcMain.handle('printer:list-ports', async () => {
  const ports = await SerialPort.list()
  return ports.map(p => p.path)
})

/** 테스트 영수증 출력 */
ipcMain.handle('printer:test', async () => {
  if (!printQueue.connected) {
    return { ok: false, error: '프린터가 연결되어 있지 않습니다.' }
  }
  printQueue.enqueue(buildTestReceipt())
  return { ok: true }
})

// ── 앱 생명주기 ───────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('kr.sallaria.pos')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  createWindow()
  subscribeRealtime()
  await initPrinter()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  await printQueue.close()
  if (process.platform !== 'darwin') app.quit()
})
