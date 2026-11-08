import { describe, it, expect } from 'vitest'
import { dateLines } from './Orders'

// 주문 내역 표의 주문일시는 두 줄이다(칼럼 폭 74칸). 자르는 자리가 틀리면
// 날짜 줄에 시각이 섞여 들어가 칸을 넘는다.

describe('dateLines', () => {
  it('날짜와 시각을 나눈다', () => {
    expect(dateLines('2026-11-08T10:52:00+09:00')).toEqual(['11/8 (일)', '10:52'])
  })

  it('두 자리 월·일에서도 자르는 자리가 맞는다', () => {
    expect(dateLines('2026-12-31T09:05:00+09:00')).toEqual(['12/31 (목)', '09:05'])
  })

  it('날짜 줄에 시각이 섞이지 않는다', () => {
    for (const iso of ['2026-01-01T00:00:00+09:00', '2026-12-31T23:59:00+09:00']) {
      const [date, time] = dateLines(iso)
      expect(date).not.toMatch(/:/)
      expect(time).toMatch(/^\d{2}:\d{2}$/)
    }
  })
})
