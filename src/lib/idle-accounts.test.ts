import { describe, it, expect } from 'vitest'
import {
  isIdleAccount, averageGapDays, daysSince,
  IDLE_MIN_DAYS, IDLE_ABSOLUTE_DAYS,
} from './idle-accounts'

// 이 규칙이 지키는 것: "주문이 뜸한 거래처" 명단.
//
// 주문 리포트와 문자 보내기(다시 이용 안내)가 **같은 명단**을 보여줘야 한다.
// 전엔 각자 조건을 들고 있어서 11곳 / 6곳으로 갈렸다. 그 상태로는 리포트를 읽고
// 문자 화면으로 건너간 점주가 "아까 본 사람들이 왜 없지?"가 된다.
// 두 화면이 이 함수를 쓰므로, 여기가 깨지면 둘이 같이 깨진다 — 그게 의도다.

describe('isIdleAccount — 평소 주기 기준', () => {
  it('평소 주기의 2배를 넘기면 뜸하다', () => {
    // 평소 5일마다 오던 곳이 11일 비었다
    expect(isIdleAccount({ avgGap: 5, lastDays: 11 })).toBe(true)
  })

  it('2배 이하면 아직 아니다', () => {
    expect(isIdleAccount({ avgGap: 5, lastDays: 10 })).toBe(false)
    expect(isIdleAccount({ avgGap: 5, lastDays: 6 })).toBe(false)
  })

  it(`하한 ${IDLE_MIN_DAYS}일 — 매일 오던 곳이 이틀 쉰 것만으로는 안 뜬다`, () => {
    // 평소 1일 주기 → 2배는 2일. 하한이 없으면 주말만 지나도 경고가 뜬다.
    expect(isIdleAccount({ avgGap: 1, lastDays: 3 })).toBe(false)
    expect(isIdleAccount({ avgGap: 1, lastDays: 6 })).toBe(false)
    expect(isIdleAccount({ avgGap: 1, lastDays: 8 })).toBe(true)
  })

  it('원래 드물게 오는 곳은 쉽게 걸리지 않는다', () => {
    // 평소 40일마다 오는 곳 — 60일은 평소 범위다.
    // 절대 60일 기준이었을 때 이런 곳이 괜히 문자를 받았다.
    expect(isIdleAccount({ avgGap: 40, lastDays: 60 })).toBe(false)
    expect(isIdleAccount({ avgGap: 40, lastDays: 90 })).toBe(true)
  })

  it('반대로, 자주 오던 곳은 60일 전에 잡힌다', () => {
    // 절대 60일 기준이 놓치던 케이스 — 이게 통일의 핵심 이유다.
    expect(isIdleAccount({ avgGap: 3, lastDays: 10 })).toBe(true)
  })
})

describe('isIdleAccount — 주기를 모를 때', () => {
  it(`주문 1건(avgGap 없음)이면 절대 ${IDLE_ABSOLUTE_DAYS}일 기준`, () => {
    expect(isIdleAccount({ avgGap: null, lastDays: 59 })).toBe(false)
    expect(isIdleAccount({ avgGap: null, lastDays: 60 })).toBe(true)
  })

  it('주문 이력이 아예 없으면 false — 뜸한 게 아니라 아직 시작 안 한 것', () => {
    // '다시 이용 안내'를 보낼 대상이 아니다. 그쪽은 '관리자 등록 안내'가 맡는다.
    expect(isIdleAccount({ avgGap: null, lastDays: null })).toBe(false)
    expect(isIdleAccount({ avgGap: 5, lastDays: null })).toBe(false)
  })
})

describe('averageGapDays', () => {
  it('2건 미만이면 null — 간격이 없으면 주기도 없다', () => {
    expect(averageGapDays([])).toBeNull()
    expect(averageGapDays(['2026-10-01T00:00:00Z'])).toBeNull()
  })

  it('기간을 간격 개수(건수-1)로 나눈다', () => {
    // 10/01, 10/11, 10/21 → 기간 20일, 간격 2개 → 평균 10일
    const gap = averageGapDays([
      '2026-10-01T00:00:00Z', '2026-10-11T00:00:00Z', '2026-10-21T00:00:00Z',
    ])
    expect(gap).toBeCloseTo(10, 5)
  })

  it('순서가 섞여 들어와도 같은 값 — 내부에서 정렬한다', () => {
    const sorted = averageGapDays(['2026-10-01T00:00:00Z', '2026-10-21T00:00:00Z'])
    const jumbled = averageGapDays(['2026-10-21T00:00:00Z', '2026-10-01T00:00:00Z'])
    expect(jumbled).toBe(sorted)
    expect(jumbled).toBeCloseTo(20, 5)
  })
})

describe('daysSince', () => {
  it('없으면 null', () => {
    expect(daysSince(null)).toBeNull()
    expect(daysSince(undefined)).toBeNull()
  })

  it('내림 — 하루가 다 안 지났으면 0일', () => {
    const almostADay = new Date(Date.now() - 23 * 3600_000).toISOString()
    expect(daysSince(almostADay)).toBe(0)
  })
})
