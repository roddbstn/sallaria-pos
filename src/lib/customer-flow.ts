// 월별 손님 드나듦 — 신규 · 유지 · 복귀 · 이탈.
//
// ── 무엇에 답하나 ──────────────────────────────────────────────────────────
// "이전에 주문했던 사람이 얼마나 빠지고 있나"에 한 그림으로 답한다.
// 점주가 실제로 마주치는 경우는 한 가지가 아니다:
//   · 7월에 시키고 안 오다가 10월에 갑자기 다시 온 사람  → 복귀
//   · 8월에 시키고 그 뒤로 소식 없는 사람                → 이탈
//   · 지난달에 이어 이번 달도 온 사람                    → 유지
// 비율 하나(이탈률 38%)로는 **유입이 이탈을 메우고 있는지**가 안 보인다.
// 네 값을 같이 들고 다녀야 그 균형이 막대 길이로 읽힌다.
//
// ── '등록만 하고 주문 안 한 사람' 은 왜 없나 ───────────────────────────────
// account_members 행은 **첫 주문 때 create_order 가 만든다**(카카오 자가등록과
// 거래처 담당자 트리거는 예외). 2026-11-03 침산점 기준 등록자 105명 중 한 번도
// 주문하지 않은 사람은 0명이었다. 그래서 이 계산은 '주문해 본 사람'만 다룬다.
//
// ── 사람 식별 ──────────────────────────────────────────────────────────────
// orderer_name 뿐이다. 동명이인은 한 사람으로 합쳐진다(CustomerHub 상단 주석과 같은 한계).

export interface FlowOrder {
  /** orderer_name — 없으면(null) 센다는 뜻이 없어 버린다 */
  ordererName: string | null
  /** ordered_at (ISO) */
  at:          string
  status:      string
}

export interface FlowMonth {
  /** '7월' */
  label:       string
  /** 그 달에 처음 주문한 사람 */
  newcomers:   number
  /** 지난달에도 왔고 이번 달도 온 사람 */
  retained:    number
  /** 전에 주문한 적은 있지만 **지난달엔 안 왔다가** 이번 달 다시 온 사람 */
  resurrected: number
  /** 지난달엔 왔는데 이번 달 안 온 사람 */
  churned:     number
  /** 지난달 주문자 수 — 이탈의 분모. 말풍선에 '61명 중 30명' 으로 적는다 */
  prevActive:  number
}

/**
 * @param orders    최소 `months + 1` 개월치. 가장 오래된 달의 **이탈**을 세려면
 *                  그 직전 달 주문이 있어야 한다. 모자라면 그 달 이탈이 0으로 찍힌다.
 * @param firstSeen 주문자별 첫 주문 시각(orderer_first_order RPC). 전체 이력이어야 한다 —
 *                  창 안의 주문만으로 신규를 판정하면 가장 오래된 달이 통째로 '신규'가 된다.
 * @param months    보여줄 달 수. **끝난 달만** 돌려준다.
 *                  진행 중인 달을 끼우면 매달 1~3일에 "이탈 45명" 같은 수가 찍힌다 —
 *                  아직 올 사람이 안 온 것뿐인데 전부 빠져나간 것처럼 보인다.
 */
export function buildCustomerFlow(
  orders:    FlowOrder[],
  firstSeen: Map<string, string>,
  opts:      { months?: number; now?: Date } = {},
): FlowMonth[] {
  const months = opts.months ?? 6
  const now    = opts.now    ?? new Date()

  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`

  // 달 → 그 달에 주문한 사람 집합
  const active = new Map<string, Set<string>>()
  for (const o of orders) {
    if (o.status === '취소' || !o.ordererName) continue
    const k = key(new Date(o.at))
    let set = active.get(k)
    if (!set) { set = new Set(); active.set(k, set) }
    set.add(o.ordererName)
  }

  const out: FlowMonth[] = []
  // back = months..1 — 1 까지만 가서 이번 달(진행 중)은 뺀다
  for (let back = months; back >= 1; back--) {
    const d     = new Date(now.getFullYear(), now.getMonth() - back, 1)
    const prevD = new Date(d.getFullYear(), d.getMonth() - 1, 1)
    const cur   = active.get(key(d))     ?? new Set<string>()
    const prev  = active.get(key(prevD)) ?? new Set<string>()

    const mStart = d.toISOString()
    const mEnd   = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString()

    let newcomers = 0, retained = 0, resurrected = 0
    for (const p of cur) {
      const first = firstSeen.get(p)
      // 이번 달이 첫 주문이면 신규. 신규는 지난달에 있었을 수가 없다.
      if (first && first >= mStart && first < mEnd) { newcomers++; continue }
      if (prev.has(p)) retained++
      else             resurrected++
    }

    let churned = 0
    for (const p of prev) if (!cur.has(p)) churned++

    out.push({
      label: `${d.getMonth() + 1}월`,
      newcomers, retained, resurrected, churned,
      prevActive: prev.size,
    })
  }
  return out
}
