// 주문 추이 — 주문 시각 목록을 월/격주/주 단위 막대로 묶는다.
//
// ⚠️ 전부 **KST 기준**이다. orders.ordered_at 은 UTC 라서 그대로 자르면 9시간이 밀리고,
//    자정 전후 주문이 옆 칸으로 새어 나간다. (OrderAnalysis.tsx 의 toKst 와 같은 이유)
//
// ⚠️ 마지막 구간은 **아직 안 끝났다.** 이번 달 23일에 보는 '10월' 은 10월 한 달이 아니라
//    1~23일이다. 그걸 직전 구간과 그냥 비교하면 늘 "줄었다"고 나온다 —
//    그래서 bucket.partial 을 두고, 비교·최다 판정에서는 끝난 구간만 쓴다.

export type TrendUnit = 'month' | 'biweek' | 'week' | 'day'

export interface TrendBucket {
  /** 정렬·비교용 키 */
  key:   string
  /** 축에 적는 짧은 이름 — 월별 '10월', 그 외 '10/20' */
  label: string
  /**
   * 그 칸이 **정확히 언제부터 언제까지인지** — '10/5 ~ 10/18', 일별은 '10/21 (수)'.
   *
   * label 만으로는 범위를 알 수 없다. '10/5' 가 격주면 10/5~10/18 인데 주별이면
   * 10/5~10/11 이다. 같은 글자가 탭에 따라 다른 기간을 뜻하므로 말풍선에서 풀어준다.
   */
  range: string
  /** 주문 건수 */
  count:  number
  /** 주문액 합계(원). 주문 화면 오른쪽이 '주문수량 + 주문액'을 같이 보여주는 것과 맞춘다 */
  amount: number
  /** 아직 진행 중인 마지막 구간인지 */
  partial: boolean
}

/** 추이 입력 — 주문 한 건 */
export interface TrendOrder {
  /** ordered_at (UTC ISO) */
  at:     string
  amount: number
}

/**
 * 막대 개수 상한.
 *
 * "전부 보여달라"가 요구지만 무한은 아니다 — 몇 해치 일별이면 막대가 천 개가 되어
 * 스크롤로도 못 읽고 DOM 만 무거워진다. 넘치면 **오래된 쪽을 자른다**(최근이 중요하다).
 */
const MAX_BUCKETS = 400

const DAY_MS = 86_400_000
const KST_OFFSET_MS = 9 * 3600_000

/** 1970-01-01 부터 센 KST 날짜 번호. 같은 날이면 같은 값이다 */
function kstDayIndex(ms: number): number {
  return Math.floor((ms + KST_OFFSET_MS) / DAY_MS)
}

/** 날짜 번호 → KST 달력 {y, m, d} */
function kstParts(dayIndex: number): { y: number; m: number; d: number } {
  const d = new Date(dayIndex * DAY_MS)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
}

/**
 * 그 날이 속한 주의 **월요일** 날짜 번호.
 *
 * epoch day 0(1970-01-01)은 목요일이라 요일은 (n + 4) % 7 (0=일) 로 나온다.
 */
function mondayOf(dayIndex: number): number {
  const dow = (dayIndex + 4) % 7          // 0=일 … 6=토
  return dayIndex - ((dow + 6) % 7)       // 일요일이면 6일 전이 월요일
}

const pad = (n: number) => String(n).padStart(2, '0')

const DOW_KO = ['일', '월', '화', '수', '목', '금', '토']

/** 날짜 번호 → 'M/D' */
function md(dayIndex: number): string {
  const p = kstParts(dayIndex)
  return `${p.m}/${p.d}`
}

/**
 * 주문을 구간별로 묶는다. **가장 오래된 주문부터 지금까지 전부** 내보낸다(오래된 것 먼저).
 *
 * 개수를 고정하지 않는 이유: 화면이 좌우로 스크롤되므로 열두 칸만 보여줄 이유가 없다.
 * 대신 MAX_BUCKETS 에서 끊는다.
 *
 * 주문이 하나도 없는 구간도 **빠뜨리지 않고 0 으로 채운다** — 빈 칸을 지우면
 * 막대 간격이 들쭉날쭉해져서 "지난주에 뚝 떨어졌다"가 안 보인다.
 */
export function buildOrderTrend(
  orders: TrendOrder[],
  unit: TrendUnit,
  now: Date = new Date(),
): TrendBucket[] {
  const nowDay = kstDayIndex(now.getTime())

  // 가장 오래된 주문 — 없으면 현재 구간 하나만 그린다
  let oldestDay = nowDay
  for (const o of orders) {
    const d = kstDayIndex(new Date(o.at).getTime())
    if (d < oldestDay) oldestDay = d
  }

  if (unit === 'month') {
    const nowP = kstParts(nowDay)
    const oldP = kstParts(oldestDay)
    const keyOf = (yy: number, mm: number) => `${yy}-${pad(mm)}`

    const span = (nowP.y - oldP.y) * 12 + (nowP.m - oldP.m)   // 0 = 같은 달
    const n = Math.min(span + 1, MAX_BUCKETS)

    const buckets: TrendBucket[] = []
    for (let back = n - 1; back >= 0; back--) {
      // m 은 1-based — Date 에 넣을 땐 0-based 로 맞춘다
      const t = new Date(Date.UTC(nowP.y, nowP.m - 1 - back, 1))
      const yy = t.getUTCFullYear()
      const mm = t.getUTCMonth() + 1
      // 0 일을 넣으면 '그 전 달의 마지막 날' 이 나온다 — 말일 계산의 관용구
      const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate()
      buckets.push({
        key: keyOf(yy, mm), label: `${mm}월`,
        range: `${mm}/1 ~ ${mm}/${lastDay}`,
        count: 0, amount: 0, partial: back === 0,
      })
    }

    const index = new Map(buckets.map((b, i) => [b.key, i]))
    for (const o of orders) {
      const p = kstParts(kstDayIndex(new Date(o.at).getTime()))
      const i = index.get(keyOf(p.y, p.m))
      if (i !== undefined) { buckets[i].count++; buckets[i].amount += o.amount }
    }
    return buckets
  }

  // 일 · 주 · 격주 — 현재 구간의 시작일을 기준점으로 잡고 step 일씩 뒤로 간다
  const step   = unit === 'day' ? 1 : unit === 'week' ? 7 : 14
  // 일별은 날짜 그대로, 주·격주는 그 주의 월요일에 맞춘다
  const anchor = unit === 'day' ? nowDay : mondayOf(nowDay)
  const oldestStart = unit === 'day' ? oldestDay : mondayOf(oldestDay)

  // ⚠️ ceil 이다. 격자는 '현재 구간 시작일에서 step 일씩 뒤로'라서, 가장 오래된 구간의
  //    시작일이 그 격자 위에 없을 수 있다(격주: anchor 10/19 기준 격자는 10/5·10/19 인데
  //    오래된 주의 월요일은 10/12 일 수 있다). floor 로 세면 칸이 하나 모자라서
  //    **그 주문들이 통째로 버려진다** — 실제로 테스트가 그걸 잡았다.
  const span = Math.ceil((anchor - oldestStart) / step)
  const n = Math.min(span + 1, MAX_BUCKETS)

  const buckets: TrendBucket[] = []
  for (let back = n - 1; back >= 0; back--) {
    const start = anchor - back * step
    const p = kstParts(start)
    buckets.push({
      key: String(start), label: `${p.m}/${p.d}`,
      range: step === 1
        ? `${md(start)} (${DOW_KO[(start + 4) % 7]})`
        : `${md(start)} ~ ${md(start + step - 1)}`,
      count: 0, amount: 0, partial: back === 0,
    })
  }

  const first = anchor - (n - 1) * step
  for (const o of orders) {
    const day = kstDayIndex(new Date(o.at).getTime())
    if (day < first) continue
    const i = Math.floor((day - first) / step)
    if (i >= 0 && i < buckets.length) { buckets[i].count++; buckets[i].amount += o.amount }
  }
  return buckets
}

export const UNIT_LABEL: Record<TrendUnit, string> = {
  month:  '월별',
  biweek: '격주별',
  week:   '주별',
  day:    '일별',
}

/**
 * 문장에 쓰는 구간 이름.
 *
 * UNIT_LABEL 에서 '별' 을 떼는 식으로 만들지 말 것 — '월별'→'월' 이 되어
 * "이번 월 주문" 같은 말이 나온다.
 */
export const UNIT_CURR_LABEL: Record<TrendUnit, string> = {
  month:  '이번 달',
  biweek: '이번 2주',
  week:   '이번 주',
  day:    '오늘',
}

/** 가장 최근에 **끝난** 구간의 이름 */
export const UNIT_PREV_LABEL: Record<TrendUnit, string> = {
  month:  '지난달',
  biweek: '직전 2주',
  week:   '지난주',
  day:    '어제',
}

export interface TrendSummary {
  /** 진행 중인 마지막 구간 */
  current?:  TrendBucket
  /** 가장 최근에 **끝난** 구간 */
  lastDone?: TrendBucket
  /** 그 직전 구간 — lastDone 과 비교할 상대 */
  prevDone?: TrendBucket
  /** 끝난 구간 중 최다 */
  peak?:     TrendBucket
  /** lastDone − prevDone(건수). 둘 중 하나라도 없으면 undefined */
  delta?:    number
}

/**
 * 막대에서 문장거리를 뽑는다.
 *
 * **진행 중인 구간은 비교에 쓰지 않는다.** 10월 23일의 '10월' 을 '9월' 과 비교하면
 * 달이 끝나지도 않았는데 "줄었다"가 되어 거짓 경보가 된다.
 */
export function summarizeTrend(buckets: TrendBucket[]): TrendSummary {
  const current = buckets.find(b => b.partial)
  const done    = buckets.filter(b => !b.partial)
  const lastDone = done[done.length - 1]
  const prevDone = done[done.length - 2]
  // 주문이 한 건도 없던 구간만 있으면 최다를 말할 게 없다
  const withOrders = done.filter(b => b.count > 0)
  const peak = withOrders.length
    ? withOrders.reduce((a, b) => (b.count > a.count ? b : a))
    : undefined

  return {
    current, lastDone, prevDone, peak,
    delta: lastDone && prevDone ? lastDone.count - prevDone.count : undefined,
  }
}


/**
 * 건수 축의 눈금 — 0 · 중간 · 최대 셋.
 *
 * 규칙 둘을 지킨다:
 *  1) **눈금은 정수다.** 건수 축에 '2.5건' 은 말이 안 된다.
 *     (최대 1건일 때 0/2.5/5 가 나오던 게 실제 버그였다)
 *  2) **가장 높은 막대가 축의 70% 는 넘는다.** 130건인데 축이 200이면
 *     막대가 65% 에서 멈춰 그림이 납작해진다.
 *
 * 중간 눈금(step)을 먼저 고르고 최대를 그 두 배로 잡으면 둘 다 자동으로 지켜진다.
 */
export function countAxisTicks(maxCount: number): number[] {
  const half = Math.max(1, Math.ceil(Math.max(1, maxCount) / 2))
  const mag  = Math.pow(10, Math.floor(Math.log10(half)))
  // mag === 1 이면 사다리도 정수여야 한다 — 1.5 를 쓰면 눈금이 1.5건이 된다
  const ladder = mag === 1 ? [1, 2, 3, 4, 5, 6, 8, 10] : [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
  const n    = half / mag
  const step = (ladder.find(x => n <= x) ?? 10) * mag
  return [0, step, step * 2]
}


// ── 지난 구간 '이맘때'와의 비교 ──────────────────────────────────────────────
//
// 왜 이것 하나만 남겼나: 리포트 오른쪽 위에 지난 구간 총계·그 전 구간과의 증감·최다
// 구간이 한꺼번에 있었다. 세 숫자를 다 읽어야 "지금 잘 되고 있나"를 겨우 짐작하는데,
// 정작 그 답을 바로 주는 숫자는 하나도 없었다.
//
// 점주가 실제로 묻는 건 하나다 — **지금 페이스가 지난번보다 나은가.**
// 지난달 총계(91건)는 이번 달이 아직 안 끝났으니 비교 상대가 못 된다. 끝난 구간끼리
// (지난달 vs 그 전달) 비교한 숫자는 '지금'에 대해 아무 말도 하지 않는다.
//
// 그래서 **같은 만큼 흐른 시점끼리** 센다:
//     이번 구간 [시작 ~ 지금]   vs   지난 구간 [시작 ~ 시작+같은시간]
// 10월 29일 14시면 10/1 0시~10/29 14시 와 9/1 0시~9/29 14시 를 비교한다.
// 단위가 달라도 규칙은 하나다 — '시작부터 흐른 시간'만 맞추면 된다.

export interface PaceComparison {
  /** 이번 구간에서 지금까지의 건수 */
  current:  number
  /** 지난 구간의 **같은 시점까지** 건수 */
  previous: number
  /**
   * 증감률(%). previous 가 0 이면 undefined —
   * 0 에서 늘어난 건 몇 %가 아니라 무한이다. 화면에서 따로 말한다.
   */
  pct?:     number
  /** 비교한 범위 — '9/1~9/29' 처럼. %만 보여주면 근거가 없어 믿기 어렵다 */
  range:    string
}

/** KST 날짜 번호의 자정이 UTC 로 몇 ms 인지 */
function kstMidnightMs(dayIndex: number): number {
  return dayIndex * DAY_MS - KST_OFFSET_MS
}

/** {y, m, d} → KST 날짜 번호. m 은 1-based 이고 범위를 벗어나도 Date 가 넘겨준다 */
function dayIndexOf(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS)
}

/**
 * 이번 구간과 지난 구간의 '같은 시점까지'를 비교한다.
 *
 * 지난 구간이 아예 없으면(가게를 이번 달에 연 경우) undefined 를 돌려준다 —
 * 그럴 때 0% 라고 적으면 "지난달에도 똑같았다"는 거짓말이 된다.
 */
export function comparePace(
  orders: TrendOrder[],
  unit: TrendUnit,
  now: Date = new Date(),
): PaceComparison | undefined {
  const nowMs  = now.getTime()
  const nowDay = kstDayIndex(nowMs)

  let curStartDay: number
  let prevStartDay: number
  let prevEndDay: number          // 지난 구간의 **마지막 날**(포함)

  if (unit === 'month') {
    const p = kstParts(nowDay)
    curStartDay  = dayIndexOf(p.y, p.m, 1)
    prevStartDay = dayIndexOf(p.y, p.m - 1, 1)   // m=1 이면 Date 가 작년 12월로 넘긴다
    prevEndDay   = curStartDay - 1
  } else {
    const step   = unit === 'day' ? 1 : unit === 'week' ? 7 : 14
    curStartDay  = unit === 'day' ? nowDay : mondayOf(nowDay)
    prevStartDay = curStartDay - step
    prevEndDay   = curStartDay - 1
  }

  const curStartMs  = kstMidnightMs(curStartDay)
  const prevStartMs = kstMidnightMs(prevStartDay)
  // 지난 구간의 끝 — 그 마지막 날의 자정 직전까지
  const prevEndMs   = kstMidnightMs(prevEndDay + 1) - 1

  // 흐른 시간을 그대로 옮긴다. 다만 지난 구간 밖으로 넘기지 않는다 —
  // 10/31 에 보면 9/1 + 30일 = 10/1 이 되어 10월 주문까지 끌어온다.
  const elapsed      = nowMs - curStartMs
  const prevCutoffMs = Math.min(prevStartMs + elapsed, prevEndMs)

  let current = 0
  let previous = 0
  let sawPrev = false            // 지난 구간에 주문이 하나라도 있었나(0건과 '기록 없음'은 다르다)
  let oldestMs = Infinity

  for (const o of orders) {
    const t = new Date(o.at).getTime()
    if (t < oldestMs) oldestMs = t
    if (t >= curStartMs  && t <= nowMs)        current++
    if (t >= prevStartMs && t <= prevEndMs)    sawPrev = true
    if (t >= prevStartMs && t <= prevCutoffMs) previous++
  }

  // 지난 구간이 가게 개업보다 앞이면 비교할 게 없다.
  // sawPrev 로 먼저 건지는 이유: 지난 구간에 주문이 있었다면 개업 여부를 따질 필요가 없다.
  if (!sawPrev && oldestMs >= curStartMs) return undefined

  const cutoffDay = kstDayIndex(prevCutoffMs)
  return {
    current,
    previous,
    pct: previous > 0 ? Math.round(((current - previous) / previous) * 100) : undefined,
    range: prevStartDay === cutoffDay ? md(prevStartDay) : `${md(prevStartDay)}~${md(cutoffDay)}`,
  }
}
