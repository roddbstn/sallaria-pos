// 세션이 사라졌을 때 **쫓아낼지 버틸지** 가르는 규칙.
//
// 2026-10-24 침산점 장애에서 나온 코드다. 점심 12:30 에 POS 가 혼자 로그인 화면으로
// 튕겨 주문을 못 받았다. 토큰 갱신은 로그인 후 59분마다 오는데(실측), 그 순간 매장
// 네트워크가 흔들리면 갱신이 실패했고 앱은 그걸 "세션 만료"와 구분하지 않고 바로
// 로그아웃시켰다. 주문 자체는 QR웹 anon 경로라 DB 엔 정상 기록됐다 — POS 화면에만
// 안 보였다. 즉 **고칠 곳은 주문이 아니라 이 판단 하나**였다.
//
// 규칙은 짧다: **서버가 거절했을 때만 끊는다.** 못 닿은 건 끊을 근거가 아니다.

export interface SignOutDecisionInput {
  /** 사장님이 직접 로그아웃을 눌렀나 */
  intentional: boolean
  /** 이미 로그인 화면인가 — 그렇다면 버틸 화면 자체가 없다 */
  atAuthScreen: boolean
  /**
   * 갱신 요청의 HTTP 상태. **못 닿았으면 undefined.**
   * 400/401 = 서버가 리프레시 토큰을 거절 = 진짜 죽은 세션.
   * 0·5xx·undefined = 네트워크/서버 장애 = 우리 잘못이 아니고 세션 잘못도 아니다.
   */
  status?: number
}

export type SignOutDecision = 'sign-out' | 'retry'

export function decideOnLostSession(i: SignOutDecisionInput): SignOutDecision {
  if (i.intentional) return 'sign-out'
  if (i.atAuthScreen) return 'sign-out'
  if (i.status === 400 || i.status === 401 || i.status === 403) return 'sign-out'
  return 'retry'
}

/** 재시도 간격 — 5초에서 2배씩, 1분에서 멈춘다. 잠깐 끊긴 거면 첫 번째에 붙는다 */
export const AUTH_RETRY_START_MS = 5_000
export const AUTH_RETRY_MAX_MS   = 60_000

export function nextRetryDelay(prevMs: number): number {
  return Math.min(prevMs * 2, AUTH_RETRY_MAX_MS)
}
