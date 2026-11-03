import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import '@sentry/electron/preload' // contextIsolation: true일 때 renderer ↔ main IPC 브릿지 필요

// Renderer에서 window.api.XXX 로 접근
const api = {
  // ── 주문 ────────────────────────────────────────────────────────────────────
  onOrderNew:    (cb: (order: unknown) => void) => ipcRenderer.on('order:new',    (_e, v) => cb(v)),
  offOrderNew:   ()                             => ipcRenderer.removeAllListeners('order:new'),
  approveOrder:  (p: { order: Record<string, unknown>; prepMins: number }) => ipcRenderer.invoke('order:approve',  p),
  reprintOrder:  (p: { order: Record<string, unknown> })                   => ipcRenderer.invoke('printer:reprint', p),
  listOsPrinters: ()                                                      => ipcRenderer.invoke('printer:list-os'),

  // ── Realtime 상태 ────────────────────────────────────────────────────────────
  onRealtimeStatus: (cb: (status: string) => void) => ipcRenderer.on('realtime:status', (_e, v) => cb(v)),
  offRealtimeStatus: ()                             => ipcRenderer.removeAllListeners('realtime:status'),

  // ── 자동 업데이트 ────────────────────────────────────────────────────────────
  onUpdaterStatus: (cb: (info: { type: string; version: string }) => void) =>
    ipcRenderer.on('updater:status', (_e, v) => cb(v)),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),
  updaterCheck:   () => ipcRenderer.invoke('updater:check') as Promise<{
    state: 'latest' | 'available' | 'no-feed' | 'error'
    current: string
    latest?: string
    message?: string
  }>,
  onUpdaterProgress: (cb: (p: { percent: number }) => void) =>
    ipcRenderer.on('updater:progress', (_e, v) => cb(v)),
  offUpdaterProgress: () => ipcRenderer.removeAllListeners('updater:progress'),

  // ── 앱 정보 · 기타 설정 ──────────────────────────────────────────────────────
  appVersion:  () => ipcRenderer.invoke('app:version') as Promise<string>,
  openLogs:    () => ipcRenderer.invoke('app:open-logs') as Promise<{ ok: boolean; dir: string; error?: string }>,
  keepAwake:   (on: boolean) => ipcRenderer.invoke('app:keep-awake', on) as Promise<{ active: boolean; platform: string }>,
  diagnostics: () => ipcRenderer.invoke('app:diagnostics') as Promise<{
    version: string; electron: string; chrome: string; node: string
    platform: string; arch: string; osRelease: string; logDir: string
    printerPort: string; printerConnected: boolean
    paperWidth: string; lineChars: number; link: string; baudRate: number; lanHost: string
  }>,

  // ── 매장 세션 ────────────────────────────────────────────────────────────────
  setStoreId: (storeId: string) => ipcRenderer.invoke('store:setStoreId', storeId),

  // ── 설정 ────────────────────────────────────────────────────────────────────
  getSettings:    ()           => ipcRenderer.invoke('settings:get'),
  updateSettings: (p: unknown) => ipcRenderer.invoke('settings:update', p),
  listPorts:      ()           => ipcRenderer.invoke('printer:list-ports') as Promise<{ path: string; manufacturer: string; friendlyName: string }[]>,
  connectPrinter: ()           => ipcRenderer.invoke('printer:connect'),
  testPrint:      ()           => ipcRenderer.invoke('printer:test'),
  printQrReceipt: (p: { accountName: string; manager: string; phone: string; pin: string; qrUrl: string; storeName: string; storePhone?: string; notice?: string }) =>
    ipcRenderer.invoke('printer:qr-receipt', p),

  printSheet:       (p: { html: string; deviceName?: string }) => ipcRenderer.invoke('printer:print-sheet', p),
  onPrinterStatus:  (cb: (s: { connected: boolean; queueLength: number }) => void) =>
    ipcRenderer.on('printer:status', (_e, v) => cb(v)),
  offPrinterStatus: () => ipcRenderer.removeAllListeners('printer:status'),

  // ── 딥링크 (비밀번호 재설정) ─────────────────────────────────────────────────
  // ── 주문 알림 팝업 창 (electron/index.ts 주석 참고) ──
  popupOpen:     ()          => ipcRenderer.invoke('popup:open'),
  popupClose:    ()          => ipcRenderer.invoke('popup:close'),
  /** 메인 창 → 팝업 창 */
  popupSync:     (p: unknown) => ipcRenderer.invoke('popup:sync', p),
  onPopupData:   (cb: (v: unknown) => void) => ipcRenderer.on('popup:data', (_e, v) => cb(v)),
  offPopupData:  () => ipcRenderer.removeAllListeners('popup:data'),
  /** 팝업 창 → 메인 창 */
  popupAction:   (p: unknown) => ipcRenderer.invoke('popup:action', p),
  onPopupAction: (cb: (v: unknown) => void) => ipcRenderer.on('popup:action', (_e, v) => cb(v)),
  offPopupAction: () => ipcRenderer.removeAllListeners('popup:action'),
  /** 사용자가 팝업 창을 닫았다 */
  onPopupClosed:  (cb: () => void) => ipcRenderer.on('popup:closed', () => cb()),
  offPopupClosed: () => ipcRenderer.removeAllListeners('popup:closed'),

  onAuthDeeplink:  (cb: (url: string) => void) => ipcRenderer.on('auth:deeplink', (_e, v) => cb(v)),
  offAuthDeeplink: () => ipcRenderer.removeAllListeners('auth:deeplink'),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (e) {
    console.error(e)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}

export type PosAPI = typeof api
