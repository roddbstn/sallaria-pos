// 고객이 주문할 때 고른 예상 수령시간을 POS에서 읽기 좋게 바꾸는 유틸.
//
// DB: orders.requested_pickup_minutes — 주문시각 기준 분. 0 = 지금, NULL = 미선택.
// 절대시각을 따로 저장하지 않고 ordered_at + 분으로 계산한다 (진실의 출처를 하나로).
//
// 점주가 승인 화면에서 정하는 prepMins 와 혼동하지 말 것:
//   requestedPickupMinutes = 손님이 "언제 오겠다"고 한 시간
//   prepMins               = 주방이 "언제까지 만들 수 있다"고 답한 시간
// 한가하면 둘이 같고, 바쁘면 점주가 덮어쓴다.

/** 0 → '지금', 10 → '10분 뒤' */
export function pickupLabel(minutes: number): string {
  return minutes === 0 ? '지금' : `${minutes}분 뒤`
}

/** 주문시각 + 분 → '오후 12:40' */
export function pickupClock(orderedAt: string, minutes: number): string {
  const at = new Date(new Date(orderedAt).getTime() + minutes * 60_000)
  if (Number.isNaN(at.getTime())) return ''
  const h24 = at.getHours()
  const ampm = h24 < 12 ? '오전' : '오후'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${ampm} ${h12}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** 승인 화면 기본 소요시간 — 손님이 고른 값을 우선, 없거나 '지금'이면 직전에 쓴 값 */
export function defaultPrepMins(requested: number | undefined, fallback: number): number {
  return requested != null && requested > 0 ? requested : fallback
}

/**
 * from 기준 n분 뒤 시각 — '11:48'. 카드 헤더의 주문시각과 같은 24시간 표기.
 *
 * 주문 팝업은 from 에 "현재 시각"이 아니라 orders.ordered_at 을 넘긴다.
 * 카드 헤더에 찍힌 주문시각(예: 18:24)에서 바로 더해지는 값이라야 점주가 눈으로 검산할 수 있고,
 * 영수증·고객 화면이 쓰는 기준과도 같아진다.
 * 대신 주문이 들어온 뒤 한참 방치됐다가 승인하면 표시된 시각이 이미 지난 시각일 수 있다.
 */
export function readyClock(minutes: number, from: Date = new Date()): string {
  const at = new Date(from.getTime() + minutes * 60_000)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

// ── 홈 화면 '남은 시간' ──────────────────────────────────────────────────────
//
// 홈에서 두 번째로 중요한 정보(첫째는 주문번호)라 멀리서도 읽혀야 하고, 그래서
// 상태를 색으로도 말한다. 기준은 **승인 시각 + 소요시간**이다 — 주문 시각이 아니다.
// 주문이 들어오고 3분 뒤에 승인했다면 10분은 그 시점부터 센다.
//
// accepted_at 이 없는 주문(아직 안 받은 신규)은 셀 기준 자체가 없으므로 'pending'.

export type RemainTone = 'pending' | 'calm' | 'soon' | 'now' | 'over'

export interface Remaining {
  tone:  RemainTone
  /** 크게 찍을 숫자. 60분을 넘기면 시간으로 접힌다. 'pending'/'now' 면 null */
  value: number | null
  /**
   * 접기 전 실제 분. **정렬·비교는 반드시 이 값으로 한다.**
   * value 로 비교하면 '2시간'(2)이 '59분'(59)보다 덜 급한 것으로 뒤집힌다.
   */
  minutes: number | null
  /** 숫자 없이 쓸 말 — '대기' · '지금' */
  label: string
  /** 숫자 뒤에 붙는 단위 — '분' */
  unit:  string
  /**
   * 숫자 위에 적는 머리말.
   *
   * 약속 시간을 넘기면 '남은 시간'이 아니라 **'초과 시간'**이다.
   * 전에는 머리말을 그대로 두고 숫자만 음수로 갔는데, '남은 시간 −3분'은 읽는 순간
   * 한 번 더 생각해야 한다. 말을 바꾸면 숫자는 그냥 양수로 읽힌다.
   */
  heading: string
}

/**
 * 60분이 넘으면 시간으로 접는다 — 60~119분은 '1시간', 120~179분은 '2시간'.
 *
 * 나머지 분은 버린다. 이 화면은 1.5~2m 밖에서 흘끗 보는 곳이라 '1시간 15분'처럼
 * 두 토막이 되면 큰 글자로 키운 이점이 사라진다. 그리고 한 시간을 넘긴 시점에서
 * 알아야 하는 건 '몇 분'이 아니라 '꽤 오래됐다'는 사실이다.
 */
function span(mins: number): { value: number; unit: string } {
  return mins >= 60
    ? { value: Math.floor(mins / 60), unit: '시간' }
    : { value: mins, unit: '분' }
}

/**
 * 남은 시간 계산.
 *
 * @param acceptedAt  orders.accepted_at (없으면 아직 승인 전)
 * @param prepMinutes orders.prep_minutes
 * @param now         테스트에서 고정하기 위한 주입점
 */
export function remainingTime(
  acceptedAt: string | undefined,
  prepMinutes: number | undefined,
  now: Date = new Date(),
): Remaining {
  if (!acceptedAt || !prepMinutes) {
    return { tone: 'pending', value: null, minutes: null, label: '대기', unit: '', heading: '남은 시간' }
  }
  const due    = new Date(acceptedAt).getTime() + prepMinutes * 60_000
  const diffMs = due - now.getTime()

  // ⚠️ 남은 쪽과 지난 쪽의 반올림 방향이 다르다. 한 공식으로 묶으면 틀린다.
  //    · 남았을 때는 **올림** — 59초 남았으면 '1분'이어야 "아직 1분 있다"로 읽힌다.
  //    · 지났을 때는 **내림** — 30초 지났는데 '1분 지남'이라고 하면 없는 1분을 지어낸다.
  //      (처음에 올림 하나로 처리했다가 바로 이 케이스에서 깨졌다.)
  if (diffMs <= 0) {
    const over = Math.floor(-diffMs / 60_000)
    if (over === 0) return { tone: 'now', value: null, minutes: 0, label: '지금', unit: '', heading: '남은 시간' }
    return { tone: 'over', ...span(over), minutes: over, label: '', heading: '초과 시간' }
  }
  const mins = Math.ceil(diffMs / 60_000)
  // 5분 이하는 주황 — 기존 경과 배지(5분 #FF8418 / 30분 #FF676F)와 같은 신호 체계
  return { tone: mins <= 5 ? 'soon' : 'calm', ...span(mins), minutes: mins, label: '', heading: '남은 시간' }
}

/**
 * 끝난 주문의 '소요 시간'.
 *
 * 완료된 주문에 '남은 시간'을 묻는 건 말이 안 된다 — 이미 끝났으니 남은 게 없다.
 * 그런데 전엔 완료 카드도 remainingTime() 을 그대로 써서, prep_minutes 가 없으면
 * 영원히 '대기'가 찍혀 있었다. 끝난 주문이 '대기'라고 적혀 있는 화면이었다.
 *
 * 여기서 재는 건 **접수 → 준비 완료까지 실제로 걸린 시간**이다. 점주가 예상 시간을
 * 얼마로 잡았는지와는 무관하다(그건 prep_minutes 고, 지금 거의 안 쌓이고 있다).
 * 그래서 prep_minutes 가 비어 있어도 이 값은 나온다 — accepted_at 과 completed_at 둘 다
 * 있으면 된다.
 */
export function elapsedTime(
  acceptedAt: string | undefined,
  completedAt: string | undefined,
): Remaining {
  if (!acceptedAt || !completedAt) {
    // 둘 중 하나라도 없으면 잴 수가 없다. '대기'가 아니라 '-' 로 둔다 —
    // 끝난 주문에 '대기'라고 쓰면 아직 안 끝난 것처럼 읽힌다.
    return { tone: 'pending', value: null, minutes: null, label: '-', unit: '', heading: '소요 시간' }
  }
  const ms = new Date(completedAt).getTime() - new Date(acceptedAt).getTime()
  // 1분 미만은 '1분'으로 — '0분 걸렸다'는 읽는 사람을 멈칫하게 한다
  const mins = Math.max(1, Math.round(ms / 60_000))
  return { tone: 'calm', ...span(mins), minutes: mins, label: '', heading: '소요 시간' }
}

/** 남은 시간 색 — 글자색과 배경색. 'over' 만 배경을 깐다(가장 멀리서 보여야 하므로) */
export function remainStyle(tone: RemainTone): { color: string; background?: string } {
  switch (tone) {
    case 'over': return { color: '#C92A2A' }
    case 'now':  return { color: '#FF8418' }
    case 'soon': return { color: '#FF8418' }
    case 'calm': return { color: '#2C261F' }
    default:     return { color: '#6A635E' }
  }
}
