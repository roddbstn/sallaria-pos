// 선결제 잔액을 월별로 되짚는 단일 출처.
//
// ⚠️ accounts.pin_encrypted 처럼 여기도 한 번 틀린 적이 있다. 처음엔 거래 시점에 기록된
//    `balance_after` 스냅샷을 썼는데, **deposits.balance_after 가 81건 중 68건이 0**이었다
//    (add_deposit 이 채우지 않는다). 그 0을 "잔액 0"으로 읽어서 6월 월말 잔액이
//    3,149,000원이어야 할 자리에 687,700원이 찍혔다. 스냅샷은 믿을 수 없다.
//
// 그래서 **원장을 직접 누적한다**: 충전(deposits) − 주문(orders) + 조정(balance_adjustments).
// 세 번째 항을 빠뜨리면 안 된다 — 점주가 "수기차감 / 편의점 대리 계산" 같은 사유로 잔액을
// 직접 고친 기록이 balance_adjustments 에 남아 있고, 그게 빠지면 또 어긋난다.
//
// 2026-10-13 검증: 이 식으로 계산한 현재 잔액이 활성 거래처 25곳 중 22곳에서
// accounts.current_balance 와 정확히 일치한다(남은 3곳 합계 64,800원은 거래 기록 없이
// 잔액이 설정된 초기 데이터).

export interface LedgerEvent {
  at:     string   // ISO
  /** 잔액을 올리면 +, 내리면 − */
  delta:  number
  kind:   'deposit' | 'order' | 'adjust'
  amount: number   // 표시용 절대값
}

export interface LedgerMonth {
  key:     string   // 'YYYY-MM'
  deposit: number
  order:   number
  adjust:  number
  /** 그 달 말 기준 누적 잔액 */
  balance: number
  active:  boolean
}

const KST = 9 * 3600_000

/** ISO → 'YYYY-MM' (KST) */
export function ledgerMonthKey(iso: string): string {
  return new Date(new Date(iso).getTime() + KST).toISOString().slice(0, 7)
}

/**
 * 월별 집계 + 누적 잔액.
 *
 * @param opening 첫 달 이전까지의 잔액. 기간을 잘라 볼 때 그 앞의 거래를 반영한다.
 */
export function rollUpLedger(events: LedgerEvent[], months: string[], opening = 0): LedgerMonth[] {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at))
  let running = opening
  let i = 0

  return months.map(mk => {
    let deposit = 0, order = 0, adjust = 0, active = false
    while (i < sorted.length && ledgerMonthKey(sorted[i].at) <= mk) {
      const e = sorted[i]
      if (ledgerMonthKey(e.at) === mk) {
        active = true
        if (e.kind === 'deposit') deposit += e.amount
        else if (e.kind === 'order') order += e.amount
        else adjust += e.delta
      }
      running += e.delta
      i++
    }
    return { key: mk, deposit, order, adjust, balance: running, active }
  })
}

/** 거래가 시작된 달부터 이번 달까지. 빈 달을 앞에 깔면 볼 구간이 오른쪽에 뭉친다 */
export function monthsFrom(firstIso: string, cap = 18): string[] {
  const first = ledgerMonthKey(firstIso)
  const out: string[] = []
  const d = new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 1)
  const now = new Date()
  while (d <= now && out.length < cap) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    d.setMonth(d.getMonth() + 1)
  }
  return out
}

/** 최근 N개월 (과거→현재) */
export function recentMonths(n: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}
