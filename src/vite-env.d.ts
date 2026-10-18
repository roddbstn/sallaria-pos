/// <reference types="vite/client" />

// Vite 가 이미지/SVG 를 URL 문자열로 import 해주지만, 타입 선언이 없으면 tsc 가
// "Cannot find module './assets/...'" 로 막는다. 런타임엔 문제가 없던 에러라
// 지금까지 baseline 에 섞여 있어서 진짜 에러를 가렸다.
declare module '*.png'  { const src: string; export default src }
declare module '*.jpg'  { const src: string; export default src }
declare module '*.jpeg' { const src: string; export default src }
declare module '*.svg'  { const src: string; export default src }
declare module '*.webp' { const src: string; export default src }

// Electron preload 가 contextBridge 로 심어주는 창구 (electron/preload.ts 의 api 객체).
//
// 예전엔 ipc.ts 가 `typeof import('../../../electron/preload')` 로 타입을 끌어왔는데
// 경로도 틀렸고(`../../`가 맞다), tsconfig.web.json 의 include 가 `src/**/*` 뿐이라
// electron/ 밖 파일은 애초에 이 프로젝트에서 보이지 않는다. 늘 에러였고 baseline 에 묻혀 있었다.
//
// ⚠️ electron/preload.ts 를 고치면 여기도 같이 고칠 것. 두 파일이 한 쌍이다.
interface PosBridge {
  onOrderNew:        (cb: (order: unknown) => void) => void
  offOrderNew:       () => void
  approveOrder:      (p: { order: Record<string, unknown>; prepMins: number }) => Promise<unknown>
  reprintOrder:      (p: { order: Record<string, unknown> }) => Promise<unknown>
  rejectOrder:       (p: { orderCode: string; reason: string }) => Promise<unknown>
  completeOrder:     (p: { orderCode: string }) => Promise<unknown>
  cancelOrder:       (p: { orderCode: string }) => Promise<unknown>
  onRealtimeStatus:  (cb: (status: string) => void) => void
  offRealtimeStatus: () => void
  onUpdaterStatus:   (cb: (info: { type: string; version: string }) => void) => void
  updaterInstall:    () => Promise<unknown>
  updaterCheck:      () => Promise<{
    state: 'latest' | 'available' | 'no-feed' | 'error'
    current: string
    latest?: string
    message?: string
  }>
  onUpdaterProgress:  (cb: (p: { percent: number }) => void) => void
  offUpdaterProgress: () => void
  appVersion:        () => Promise<string>
  openLogs:          () => Promise<{ ok: boolean; dir: string; error?: string }>
  keepAwake:         (on: boolean) => Promise<{ active: boolean; platform: string }>
  diagnostics:       () => Promise<{
    version: string; electron: string; chrome: string; node: string
    platform: string; arch: string; osRelease: string; logDir: string; keepAwake: boolean
  }>
  setStoreId:        (storeId: string) => Promise<unknown>
  getSettings:       () => Promise<unknown>
  updateSettings:    (p: unknown) => Promise<unknown>
  listPorts:         () => Promise<{ path: string; manufacturer: string; friendlyName: string }[]>
  connectPrinter:    () => Promise<{ ok: boolean; error?: string }>
  testPrint:         () => Promise<{ ok: boolean; error?: string }>
  printQrReceipt:    (p: { accountName: string; manager: string; phone: string; pin: string; qrUrl: string; storeName: string }) => Promise<unknown>
  onPrinterStatus:   (cb: (s: { connected: boolean; queueLength: number }) => void) => void
  offPrinterStatus:  () => void
  onAuthDeeplink:    (cb: (url: string) => void) => void
  offAuthDeeplink:   () => void
}

interface Window {
  // Electron 밖(브라우저 미리보기)에서는 없다 — 호출부가 ?. 로 방어한다
  api?: PosBridge
}
