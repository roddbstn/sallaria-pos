import type { DbAccount } from './supabase'

// 선결제 유효기간 — 가장 최근 충전일 기준. 자동 만료 처리는 없고 점주가 육안으로만 확인한다.
//
// Customers.tsx 안에만 있던 걸 끌어냈다. 계정 상세 모달도 같은 표시를 해야 하는데, 복사하면
// 만료 기준을 한쪽만 고치는 날이 온다. DB 에는 'none'/'6m' 같은 코드만 들어 있어서
// 라벨 변환을 거치지 않으면 화면에 "none" 이 그대로 나온다(실제로 39건 전부 'none').

export type PrepayValidity = DbAccount['prepay_validity']

export const PREPAY_VALIDITY_OPTIONS: PrepayValidity[] = ['none', '6m', '1y', '2y']

export const PREPAY_VALIDITY_LABEL: Record<PrepayValidity, string> = {
  none: '없음', '6m': '6개월', '1y': '1년', '2y': '2년',
}

export const PREPAY_VALIDITY_MONTHS: Record<PrepayValidity, number | null> = {
  none: null, '6m': 6, '1y': 12, '2y': 24,
}

/** 가장 최근 충전일 + 유효기간 → "1년 · 2027.03.14까지" / "⚠ … 만료됨" */
export function prepayValidityDisplay(validity: PrepayValidity, lastDepositAt: string | undefined): string {
  const months = PREPAY_VALIDITY_MONTHS[validity]
  // 유효기간을 안 걸어둔 경우는 **아무 말도 하지 않는다.**
  // 전엔 '없음' 한 단어만 떴는데, 라벨이 없어서 무엇이 없다는 건지 알 수 없었다
  // (충전 이력이 없다는 뜻으로 읽히기도 했다). 게다가 거래처 대부분이 'none' 이라
  // 거의 모든 화면에 그 한 단어가 떠 있었다. 빈 값이면 호출부가 안 그린다.
  if (months === null) return ''
  if (!lastDepositAt) return `${PREPAY_VALIDITY_LABEL[validity]} · 충전 이력 없음`
  const expiresAt = new Date(lastDepositAt)
  expiresAt.setMonth(expiresAt.getMonth() + months)
  const dateStr = expiresAt.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
  return expiresAt < new Date()
    ? `${PREPAY_VALIDITY_LABEL[validity]} · ⚠ ${dateStr} 만료됨`
    : `${PREPAY_VALIDITY_LABEL[validity]} · ${dateStr}까지`
}

export function isPrepayExpired(validity: PrepayValidity, lastDepositAt: string | undefined): boolean {
  const months = PREPAY_VALIDITY_MONTHS[validity]
  if (months === null || !lastDepositAt) return false
  const expiresAt = new Date(lastDepositAt)
  expiresAt.setMonth(expiresAt.getMonth() + months)
  return expiresAt < new Date()
}
