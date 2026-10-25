// "주문이 뜸한 거래처" 판정 — **이 파일이 유일한 기준이다.**
//
// 왜 꺼냈나: 같은 말을 두 화면이 서로 다르게 세고 있었다.
//   · 주문 리포트(OrderAnalysis) — 평소 주기의 2배 넘게 비었고 최소 7일   → 11곳
//   · 문자 보내기(SmsPanel)      — 마지막 주문으로부터 60일 절대 기준      → 6곳
// 겹치는 건 5곳뿐이었다. 리포트에서 "12곳이 뜸해요"를 읽고 문자 화면으로 건너가면
// 전혀 다른 명단이 떠서, 점주 입장에선 둘 중 어느 쪽이 맞는지 알 수 없었다.
//
// 어느 쪽으로 통일했나: **상대 주기**(리포트 쪽)다. 절대 60일보다 신호가 정확하다 —
// 매일 오던 과가 10일 비면 급한 신호인데 60일 기준은 그걸 놓치고, 원래 분기에 한 번
// 오는 곳은 61일째에 걸려 괜히 문자를 받는다. '평소보다 오래'가 다시 부를 이유다.

/**
 * 주기를 계산할 때 들여다보는 기간(일).
 *
 * 두 화면이 **같은 창**을 봐야 같은 답이 나온다. 전엔 리포트가 180일,
 * 문자 화면이 전체 기간이라 판정 함수를 통일해도 avgGap·lastDays 가 달랐다.
 * (주문 리포트의 CYCLE_DAYS 가 여기로 올라온 것이다)
 */
export const IDLE_WINDOW_DAYS = 180

/** 주기를 구할 수 있을 때, 평소 주기의 몇 배를 넘기면 '뜸하다'로 볼지 */
export const IDLE_GAP_MULTIPLE = 2

/**
 * 하한. 매일 오는 곳이 이틀 쉰 것만으로 경고에 뜨는 걸 막는다.
 * (평소 주기가 1일이면 2배가 2일밖에 안 된다)
 */
export const IDLE_MIN_DAYS = 7

/**
 * 평소 주기를 구할 수 없을 때(주문 1건 이하) 쓰는 절대 기준.
 * 문자 화면이 원래 쓰던 값을 그대로 가져왔다 — 주기가 없는 곳의 폴백으로는 이게 맞다.
 */
export const IDLE_ABSOLUTE_DAYS = 60

export interface IdleInput {
  /** 평균 주문 주기(일). 주문이 2건 미만이면 null */
  avgGap:   number | null
  /** 마지막 주문 이후 지난 일수. 주문 이력이 없으면 null */
  lastDays: number | null
}

/**
 * 이 거래처가 '주문이 뜸한' 상태인가.
 *
 * 세 경우로 갈린다:
 *   ① 평소 주기를 안다(주문 2건 이상) → 그 주기의 2배를 넘겼고, 최소 7일은 지났는가
 *   ② 주기를 모른다(주문 1건)         → 절대 60일 기준
 *   ③ 주문 이력이 아예 없다            → 뜸한 게 아니라 **아직 시작 안 한 것**이다.
 *      '다시 이용 안내'를 보낼 대상이 아니라서 false 다. 그쪽은 '관리자 등록 안내'가 맡는다.
 */
export function isIdleAccount({ avgGap, lastDays }: IdleInput): boolean {
  if (lastDays == null) return false                                    // ③
  if (avgGap == null)   return lastDays >= IDLE_ABSOLUTE_DAYS           // ②
  return lastDays > avgGap * IDLE_GAP_MULTIPLE && lastDays >= IDLE_MIN_DAYS  // ①
}

/** 마지막 주문 ISO → 지난 일수 (없으면 null) */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

/**
 * 주문 시각 목록에서 평균 주기(일)를 구한다. 2건 미만이면 null.
 * (첫 주문 ~ 마지막 주문 기간) ÷ (건수 − 1) — 간격의 개수로 나눠야 한다.
 */
export function averageGapDays(orderedAtIso: string[]): number | null {
  if (orderedAtIso.length < 2) return null
  const ts = orderedAtIso.map(s => new Date(s).getTime()).sort((a, b) => a - b)
  const spanDays = (ts[ts.length - 1] - ts[0]) / 86_400_000
  return spanDays / (ts.length - 1)
}
