import { describe, it, expect } from 'vitest'
import { kstDateString } from './datetime'

describe('kstDateString — KST 달력 날짜', () => {
  it('KST 00:27 은 그날 날짜다 (UTC 로는 아직 전날 15:27)', () => {
    // 2026-10-27T15:27Z = 2026-10-28 00:27 KST  ← 실제 사고 시각
    expect(kstDateString(new Date('2026-10-27T15:27:00Z'))).toBe('2026-10-28')
  })

  it('KST 08:59 — 넘어가기 직전에도 당일', () => {
    expect(kstDateString(new Date('2026-10-27T23:59:00Z'))).toBe('2026-10-28')
  })

  it('KST 09:00 — UTC 날짜가 따라잡는 순간', () => {
    expect(kstDateString(new Date('2026-10-28T00:00:00Z'))).toBe('2026-10-28')
  })

  it('KST 23:59 — 자정 직전', () => {
    expect(kstDateString(new Date('2026-10-28T14:59:00Z'))).toBe('2026-10-28')
  })

  it('KST 00:00 — 자정 정각에 날짜가 넘어간다', () => {
    expect(kstDateString(new Date('2026-10-28T15:00:00Z'))).toBe('2026-10-29')
  })

  it('UTC 날짜 그대로 자르는 것과 다르다 (사고 구간)', () => {
    const d = new Date('2026-10-27T15:27:00Z')
    expect(d.toISOString().slice(0, 10)).toBe('2026-10-27')  // 틀린 값
    expect(kstDateString(d)).toBe('2026-10-28')              // 맞는 값
  })
})
