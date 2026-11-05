import { describe, it, expect } from 'vitest'
import { defaultQrSystemFor } from './qr-system'

const a = (n: number, s: 'legacy' | 'kakao') => Array.from({ length: n }, () => ({ qr_system: s }))

describe('defaultQrSystemFor — 새 거래처의 QR 방식', () => {
  it('거래처가 없는 새 매장은 kakao', () => {
    expect(defaultQrSystemFor([])).toBe('kakao')
  })

  it('PIN 으로 돌고 있는 매장은 legacy — 침산점 24/25', () => {
    expect(defaultQrSystemFor([...a(24, 'legacy'), ...a(1, 'kakao')])).toBe('legacy')
  })

  it('카카오로 돌고 있는 매장은 kakao — 행포케 3/3', () => {
    expect(defaultQrSystemFor(a(3, 'kakao'))).toBe('kakao')
  })

  it('반반이면 가는 방향(kakao)에 붙인다', () => {
    expect(defaultQrSystemFor([...a(2, 'legacy'), ...a(2, 'kakao')])).toBe('kakao')
  })

  it('한 곳뿐이어도 그 방식을 따른다', () => {
    expect(defaultQrSystemFor(a(1, 'legacy'))).toBe('legacy')
    expect(defaultQrSystemFor(a(1, 'kakao'))).toBe('kakao')
  })
})
