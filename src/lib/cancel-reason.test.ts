import { describe, it, expect } from 'vitest'
import { isKnownCancelReason } from './cancel-reason'

describe('isKnownCancelReason — 사유인가 손님이 쓴 말인가', () => {
  it('고정 목록에 있는 말은 사유다', () => {
    expect(isKnownCancelReason('재료 소진')).toBe(true)
    expect(isKnownCancelReason('주문 폭주로 조리 불가')).toBe(true)
    expect(isKnownCancelReason('매장 사정')).toBe(true)
  })

  it('손님이 쓴 요청사항은 사유가 아니다', () => {
    // 실제로 취소 주문의 note 에 들어 있던 값들이다 — 이게 사유로 둔갑했었다
    expect(isKnownCancelReason('수저·포크 O')).toBe(false)
    expect(isKnownCancelReason('소스 따로')).toBe(false)
  })

  it('앞뒤 공백은 무시한다', () => {
    expect(isKnownCancelReason('  재료 소진 ')).toBe(true)
  })

  it('비어 있으면 사유가 아니다', () => {
    expect(isKnownCancelReason('')).toBe(false)
    expect(isKnownCancelReason(null)).toBe(false)
    expect(isKnownCancelReason(undefined)).toBe(false)
  })

  it('사유를 포함하기만 한 문장은 사유가 아니다 — 손님이 그렇게 쓸 수도 있다', () => {
    expect(isKnownCancelReason('재료 소진되면 연락주세요')).toBe(false)
  })
})
