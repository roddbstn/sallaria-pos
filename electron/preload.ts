import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Renderer에서 window.api.XXX 로 접근
const api = {
  // ── 주문 ────────────────────────────────────────────────────────────────────
  onOrderNew:    (cb: (order: unknown) => void) => ipcRenderer.on('order:new',    (_e, v) => cb(v)),
  offOrderNew:   ()                             => ipcRenderer.removeAllListeners('order:new'),
  approveOrder:  (p: { order: Record<string, unknown>; prepMins: number }) => ipcRenderer.invoke('order:approve',  p),
  reprintOrder:  (p: { order: Record<string, unknown> })                   => ipcRenderer.invoke('printer:reprint', p),
  rejectOrder:   (p: { orderCode: string; reason: string })   => ipcRenderer.invoke('order:reject',   p),
  completeOrder: (p: { orderCode: string })                   => ipcRenderer.invoke('order:complete', p),
  cancelOrder:   (p: { orderCode: string })                   => ipcRenderer.invoke('order:cancel',   p),

  // ── Realtime 상태 ────────────────────────────────────────────────────────────
  onRealtimeStatus: (cb: (status: string) => void) => ipcRenderer.on('realtime:status', (_e, v) => cb(v)),
  offRealtimeStatus: ()                             => ipcRenderer.removeAllListeners('realtime:status'),

  // ── 자동 업데이트 ────────────────────────────────────────────────────────────
  onUpdaterStatus: (cb: (info: { type: string; version: string }) => void) =>
    ipcRenderer.on('updater:status', (_e, v) => cb(v)),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),

  // ── 설정 ────────────────────────────────────────────────────────────────────
  getSettings:    ()           => ipcRenderer.invoke('settings:get'),
  updateSettings: (p: unknown) => ipcRenderer.invoke('settings:update', p),
  listPorts:      ()           => ipcRenderer.invoke('printer:list-ports'),
  testPrint:      ()           => ipcRenderer.invoke('printer:test'),
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
