import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'

// Chromium 자동재생 차단 해제 — 주문 알림음이 사용자 클릭 없이도 재생되도록
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
import Store from 'electron-store'

import {
  buildCustomerReceiptHtml,
  buildKitchenReceiptHtml,
  buildTestReceiptHtml,
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
    printer: { printerName: '' },
    receipt: { menuSize: 'small', optionSize: 'small', customerMenuSize: 'small', customerOptionSize: 'small' },
  },
})

// ── Supabase 클라이언트 (Realtime 전용) ──────────────────────────────────────

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  as string ?? ''
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON as string ?? ''
const supabase = SUPABASE_URL
  ? createClient(SUPABASE_URL, SUPABASE_ANON, { realtime: { transport: ws } })
  : null

let mainWindow: BrowserWindow | null = null
let currentStoreId: string | null = null

// ── 창 생성 ───────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width:          1024,
    height:         768,
    minWidth:       800,
    minHeight:      600,
    aspectRatio:    4 / 3,
    title:          '선결제 고객 POS',
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

// ── OS 프린터로 HTML 출력 ─────────────────────────────────────────────────────

/**
 * 숨겨진 BrowserWindow에 HTML을 로드한 뒤, OS 프린트 API로 인쇄.
 * 프린터가 Windows에 드라이버로 등록돼 있으면 무조건 동작.
 */
async function printHtml(html: string): Promise<void> {
  const printerName = getPrinterName()
  if (!printerName) throw new Error('프린터가 설정되지 않았습니다. 설정 탭에서 프린터를 선택해 주세요.')

  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: false, contextIsolation: false },
  })

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        { silent: true, printBackground: false, deviceName: printerName },
        (success, failureReason) => {
          if (success) resolve()
          else reject(new Error(failureReason || '출력 실패'))
        }
      )
    })
  } finally {
    win.destroy()
  }
}

function getPrinterName(): string {
  const saved = store.get('printer') as Record<string, unknown>
  return (saved?.printerName as string) ?? ''
}

function notifyPrinterStatus(): void {
  mainWindow?.webContents.send('printer:status', {
    connected:   !!getPrinterName(),
    queueLength: 0,
  })
}

// ── Supabase Realtime 구독 ────────────────────────────────────────────────────

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

    const receipt = store.get('receipt')
    await printHtml(buildCustomerReceiptHtml(orderPayload, receipt))
    await printHtml(buildKitchenReceiptHtml(orderPayload, receipt))
    console.log(`[AutoPrint] 영수증 출력 완료: ${orderCode}`)
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
        autoPrintOrder(payload.new['order_code'] as string)
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

  // 영수증 출력은 Realtime autoPrintOrder()에서 자동 처리 — 여기선 출력 안 함

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
  const savedPrinter = store.get('printer') as Record<string, unknown>
  return {
    printer: { printerName: (savedPrinter?.printerName as string) ?? '' },
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

/** 시스템에 설치된 프린터 목록 */
ipcMain.handle('printer:list-system', async () => {
  if (!mainWindow) return []
  const printers = await mainWindow.webContents.getPrintersAsync()
  return printers.map(p => ({ name: p.name, isDefault: p.isDefault }))
})

/** 영수증 재출력 */
ipcMain.handle('printer:reprint', async (_e, { order }: { order: OrderPayload }) => {
  const receipt = store.get('receipt')
  try {
    await printHtml(buildCustomerReceiptHtml(order, receipt))
    await printHtml(buildKitchenReceiptHtml(order, receipt))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

/** 프린터 연결 확인 (설정에서 "연결하기" 버튼) */
ipcMain.handle('printer:connect', async () => {
  const printerName = getPrinterName()
  if (!printerName) return { ok: false, error: '프린터를 먼저 선택해 주세요.' }
  if (!mainWindow) return { ok: false, error: '창이 준비되지 않았습니다.' }
  const printers = await mainWindow.webContents.getPrintersAsync()
  const found = printers.some(p => p.name === printerName)
  if (!found) return { ok: false, error: `"${printerName}" 프린터를 찾을 수 없습니다. 목록을 새로고침해 주세요.` }
  notifyPrinterStatus()
  return { ok: true }
})

/** 테스트 출력 */
ipcMain.handle('printer:test', async () => {
  try {
    await printHtml(buildTestReceiptHtml())
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})

// ── 앱 생명주기 ───────────────────────────────────────────────────────────────

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

// ── 앱 생명주기 ───────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('kr.sallaria.pos')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  createWindow()
  subscribeRealtime()

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
