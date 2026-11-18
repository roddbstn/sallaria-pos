// 브라우저 미리보기용 가짜 창구 + 가짜 Supabase.
//
// ⚠️ 이 모듈은 **SignupFlow 보다 먼저 import 돼야 한다.** lib/ipc 가 모듈 최상단에서
//    window.api 를 한 번 읽어 export const api 로 고정하기 때문이다. ESM 은 import 를
//    쓴 순서대로 평가하므로 signup-preview.tsx 의 첫 줄에 이 파일을 둔다.
//
// 프로덕션 빌드에는 들어가지 않는다 — renderer 엔트리(src/index.html)에서 참조하지 않고,
// vite.preview.config.ts(별도 dev 전용 설정)로만 서빙된다.

import { supabase } from '../lib/supabase'

// ── 가짜 프린터 ───────────────────────────────────────────────────────────────
// 실제 시리얼 포트가 없으니 매장에서 흔히 보이는 모양으로 두 개 꾸며 놓는다.
const FAKE_PORTS = [
  { path: 'COM3', manufacturer: 'Prolific',  friendlyName: 'COM3 — 영수증 프린터 (Prolific USB-Serial)' },
  { path: 'COM5', manufacturer: 'FTDI',      friendlyName: 'COM5 — USB Serial Port (FTDI)' },
]

let printerStatusCb: ((s: { connected: boolean; queueLength: number }) => void) | null = null

const noop = async () => ({ ok: true })
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

const mockApi = {
  // 프린터 설정 스텝이 쓰는 것들
  listPorts:        async () => { await wait(600); return FAKE_PORTS },          // 스캔하는 티가 나게 살짝 지연
  connectPrinter:   async () => { await wait(500); return { ok: true as const } },
  updateSettings:   async () => ({ ok: true }),
  getSettings:      async () => ({}),
  testPrint:        noop,
  onPrinterStatus:  (cb: (s: { connected: boolean; queueLength: number }) => void) => { printerStatusCb = cb },
  offPrinterStatus: () => { printerStatusCb = null },

  // 체험 주문 팝업이 쓸 수 있는 것들
  approveOrder:     noop,
  reprintOrder:     noop,
  printQrReceipt:   noop,
  printSheet:       noop,
  listOsPrinters:   async () => [],

  // 나머지는 호출만 삼킨다
  onOrderNew:        () => {},
  offOrderNew:       () => {},
  onRealtimeStatus:  () => {},
  offRealtimeStatus: () => {},
  onUpdaterStatus:   () => {},
  updaterInstall:    noop,
  updaterCheck:      async () => ({ state: 'latest' as const, current: '0.0.0-preview' }),
  onUpdaterProgress:  () => {},
  offUpdaterProgress: () => {},
  appVersion:        async () => '0.0.0-preview',
  openLogs:          async () => ({ ok: true, dir: '(preview)' }),
  keepAwake:         async () => ({ active: false, platform: 'preview' }),
  diagnostics:       async () => ({
    version: '0.0.0-preview', electron: '-', chrome: navigator.userAgent, node: '-',
    platform: 'preview', arch: '-', osRelease: '-', logDir: '-',
    printerPort: 'COM3', printerConnected: true,
  }),
  setStoreId:        noop,
  onAuthDeeplink:    () => {},
  offAuthDeeplink:   () => {},
}

;(window as unknown as { api: unknown }).api = mockApi

/** 프린터가 붙었다고 알려 준다 — dev 바의 "프린터 연결됨 신호" 버튼용 */
export function fakePrinterConnected() {
  printerStatusCb?.({ connected: true, queueLength: 0 })
}

// ── 가짜 Supabase ─────────────────────────────────────────────────────────────
// 미리보기는 네트워크를 타지 않는다. 인스턴스 메서드만 덮어쓰므로 import 하는 쪽
// (PasswordStep·AddressStep)은 코드 그대로다.
//
// 비밀번호 설정: 전화인증 세션이 없으므로 실제로 부르면 AuthSessionMissingError 가 나고
// 화면이 "비밀번호 설정에 실패했어요"에서 멈춘다. 그래서 성공으로 꾸민다.
;(supabase.auth as unknown as Record<string, unknown>).updateUser = async () => {
  await wait(400)
  return { data: { user: null }, error: null }
}

// 주소 → 좌표: geocode-address 엣지 함수 대신 대구 침산동 근처 좌표를 돌려준다
;(supabase.functions as unknown as Record<string, unknown>).invoke = async (name: string) => {
  await wait(400)
  if (name === 'geocode-address') return { data: { lat: 35.8862, lng: 128.5836 }, error: null }
  return { data: null, error: null }
}

export const PREVIEW_NOTE = 'mock-bridge 적용됨 (프린터·Supabase 가짜)'
