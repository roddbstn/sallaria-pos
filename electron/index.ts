import { app, BrowserWindow, ipcMain, shell } from 'electron'

// Chromium 자동재생 차단 해제 — 주문 알림음이 사용자 클릭 없이도 재생되도록
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
import Store from 'electron-store'
let SerialPort: typeof import('serialport').SerialPort | null = null
try { SerialPort = require('serialport').SerialPort } catch { SerialPort = null }

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
    receipt: { menuSize: 'small', optionSize: 'small', customerMenuSize: 'small', customerOptionSize: 'small' },
  },
})

// ── 전역 인스턴스 ─────────────────────────────────────────────────────────────

const printQueue = new PrintQueue()

// ── Supabase 클라이언트 (Realtime 전용) ──────────────────────────────────────

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  as string ?? ''
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON as string ?? ''
const supabase = SUPABASE_URL
  ? createClient(SUPABASE_URL, SUPABASE_ANON, { realtime: { transport: ws } })
  : null

let mainWindow: BrowserWindow | null = null

// ── 창 생성 ───────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width:          1024,
    height:         768,
    minWidth:       800,
    minHeight:      600,
    aspectRatio:    4 / 3,
    title:          '샐러리아 POS',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload:        join(__dirname, '../preload/preload.js'),
      sandbox:        false,
      contextIsolation: true,
    },
  })

  printQueue.setWindow(mainWindow)

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
    if (is.dev) mainWindow!.webContents.openDevTools()
  })
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

/**
 * 새 주문 수신 시 영수증 자동 출력 + 상태 → 조리중
 */
async function autoPrintOrder(orderCode: string): Promise<void> {
  if (!supabase) return
  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        order_code, order_number, orderer_name,
        ordered_at, menu_subtotal, delivery_fee, total_amount,
        balance_before, balance_after, method, note,
        accounts ( account_name ),
        order_items (
          order_item_id, quantity, unit_price, subtotal,
          menus ( name ),
          order_item_options (
            id, extra_price,
            option_items ( name )
          )
        )
      `)
      .eq('order_code', orderCode)
      .single()

    if (error || !data) {
      console.error('[AutoPrint] 주문 조회 실패:', error)
      return
    }

    const orderPayload: OrderPayload = {
      order_code:     data.order_code,
      order_number:   (data as any).order_number ?? undefined,
      account_name:   (data.accounts as any)?.account_name ?? '',
      orderer_name:   data.orderer_name,
      method:         data.method,
      ordered_at:     data.ordered_at,
      items: ((data.order_items as any[]) ?? []).map((item: any) => ({
        menu_name:  item.menus?.name ?? '',
        quantity:   item.quantity,
        unit_price: item.unit_price,
        subtotal:   item.subtotal,
        options:    ((item.order_item_options as any[]) ?? []).map((o: any) => ({
          option_name: o.option_items?.name ?? '',
          extra_price: o.extra_price,
        })),
      })),
      menu_subtotal:  data.menu_subtotal,
      delivery_fee:   data.delivery_fee,
      total_amount:   data.total_amount,
      balance_before: data.balance_before,
      balance_after:  data.balance_after,
      note:           data.note ?? null,
    }

    // 영수증 출력 (프린터 미연결 시 큐에 적재)
    const receipt = store.get('receipt')
    printQueue.enqueue(buildCustomerReceipt(orderPayload, receipt))
    printQueue.enqueue(buildKitchenReceipt(orderPayload, receipt))
    console.log(`[AutoPrint] 영수증 출력 완료: ${orderCode}`)

    // 상태 → 조리중
    await supabase.rpc('update_order_status', { p_order_code: orderCode, p_status: '조리중' })
  } catch (err) {
    console.error('[AutoPrint] 오류:', err)
  }
}

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
      (payload) => {
        console.log('[Realtime] 새 주문 수신:', payload.new)
        mainWindow?.webContents.send('order:new', payload.new)
        autoPrintOrder(payload.new['order_code'] as string)
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

  // 1) DB 상태 → 조리중
  if (supabase) {
    await supabase.rpc('update_order_status', { p_order_code: order.order_code, p_status: '조리중' })

    // 2) 웹 success 페이지에 broadcast (best-effort)
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

  // 3) 영수증 출력
  const receipt = store.get('receipt')
  printQueue.enqueue(buildCustomerReceipt(order, receipt))
  printQueue.enqueue(buildKitchenReceipt(order, receipt))

  return { ok: true }
})

ipcMain.handle('order:reject', async (_e, { orderCode, reason }: { orderCode: string; reason: string }) => {
  console.log(`[IPC] order:reject — ${orderCode}, 사유: ${reason}`)

  if (supabase) {
    // 취소 + 잔액 환원 + 사유 저장 (RPC가 원자적으로 처리)
    await supabase.rpc('cancel_order', {
      p_order_code: orderCode,
      p_allow_after_cooking: true,
      p_note: reason,
    })

    // 웹 success 페이지에 broadcast (best-effort)
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
    await supabase.rpc('update_order_status', { p_order_code: orderCode, p_status: '완료' })
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
  if (!SerialPort) return []
  const ports = await SerialPort.list()
  return ports.map(p => p.path)
})

/** 영수증 재출력 (주문 관리 탭에서 호출) */
ipcMain.handle('printer:reprint', async (_e, { order }: { order: OrderPayload }) => {
  if (!printQueue.connected) {
    return { ok: false, error: '프린터가 연결되어 있지 않습니다.' }
  }
  const receipt = store.get('receipt')
  printQueue.enqueue(buildCustomerReceipt(order, receipt))
  printQueue.enqueue(buildKitchenReceipt(order, receipt))
  return { ok: true }
})

/** 프린터 명시적 연결 (Settings에서 "연결하기" 버튼) */
ipcMain.handle('printer:connect', async () => {
  const settings = store.get('printer')
  try {
    await printQueue.open(settings)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
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
