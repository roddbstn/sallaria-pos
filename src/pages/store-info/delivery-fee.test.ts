import { describe, it, expect } from 'vitest'
import { estimate } from './DeliveryPanel'

// 이 계산은 **DB 의 calculate_delivery_fee 와 한 글자도 다르면 안 된다.**
// 설정 화면이 보여준 금액과 손님이 실제로 낸 금액이 어긋나면,
// 점주는 "4,500원이라더니 왜 4,600원을 받았냐"는 전화를 받는다.
//
// DB 쪽 규칙(0068_delivery_fee_by_distance.sql):
//   거리 <= 기본거리            → 기본팁
//   아니면 ceil(초과 / 단위거리) → 기본팁 + 칸수 × 단위팁
//
// 기본값은 기본거리 1500m · 기본팁 4000원 · 단위 100m · 단위팁 100원.

const T = { baseDistanceM: 1500, baseFee: 4000, tierDistanceM: 100, tierFee: 100 }

describe('estimate — 거리별 배달팁', () => {
  it('기본 거리 안쪽은 기본팁만', () => {
    expect(estimate(0, T)).toBe(4000)
    expect(estimate(900, T)).toBe(4000)
    expect(estimate(1500, T)).toBe(4000)   // 경계는 **포함**이다 (<=)
  })

  it('기본 거리를 1m 만 넘겨도 한 칸 붙는다', () => {
    // ceil(1/100) = 1 — 0.01칸이 아니라 한 칸이다. 올림이라서.
    expect(estimate(1501, T)).toBe(4100)
  })

  it('단위 경계에서 칸이 넘어간다', () => {
    expect(estimate(1600, T)).toBe(4100)   // ceil(100/100) = 1
    expect(estimate(1601, T)).toBe(4200)   // ceil(101/100) = 2
    expect(estimate(1700, T)).toBe(4200)
  })

  it('2km · 3km · 5km', () => {
    expect(estimate(2000, T)).toBe(4500)   // 초과 500 → 5칸
    expect(estimate(3000, T)).toBe(5500)   // 초과 1500 → 15칸
    expect(estimate(5000, T)).toBe(7500)   // 초과 3500 → 35칸
  })

  // 화면에서 고를 수 있는 조합 — 기본거리 1~3km, 할증 100~300원, 단위는 100m 고정
  it('기본거리 1km · 할증 300원', () => {
    const t = { baseDistanceM: 1000, baseFee: 3000, tierDistanceM: 100, tierFee: 300 }
    expect(estimate(1000, t)).toBe(3000)
    expect(estimate(1001, t)).toBe(3300)   // ceil(1/100) = 1
    expect(estimate(2000, t)).toBe(6000)   // ceil(1000/100) = 10 → 3000 + 3000
  })

  it('기본거리 3km 로 올리면 그 안쪽은 전부 기본팁', () => {
    const t = { baseDistanceM: 3000, baseFee: 5000, tierDistanceM: 100, tierFee: 100 }
    expect(estimate(2999, t)).toBe(5000)
    expect(estimate(3000, t)).toBe(5000)
    expect(estimate(3100, t)).toBe(5100)
  })

  // 단위거리는 이제 화면에서 100m 로 고정이지만, 예전 행에 0이 들어 있을 수 있다.
  // 0으로 나누면 Infinity 가 나와 금액 자리에 'Infinity원' 이 찍힌다.
  it('단위거리가 0이면 기본팁으로 버틴다 (0으로 나누지 않는다)', () => {
    const t = { ...T, tierDistanceM: 0 }
    expect(estimate(5000, t)).toBe(4000)
    expect(Number.isFinite(estimate(5000, t))).toBe(true)
  })
})
