import { describe, it, expect } from 'vitest'
import { buildOrderTrend, summarizeTrend, countAxisTicks, type TrendOrder } from './order-trend'

// 기준 시각을 고정해 둔다 — '지금'에 기대면 달이 바뀔 때 테스트가 깨진다.
// 2026-10-23(금) 12:00 KST = 2026-10-23T03:00:00Z
const NOW = new Date('2026-10-23T03:00:00Z')

const o = (at: string, amount = 10_000): TrendOrder => ({ at, amount })

describe('buildOrderTrend — 범위', () => {
  it('가장 오래된 주문부터 지금까지 전부 낸다', () => {
    const b = buildOrderTrend([o('2026-08-10T01:00:00Z')], 'month', NOW)
    expect(b.map(x => x.key)).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(b[2].partial).toBe(true)
    expect(b.filter(x => x.partial)).toHaveLength(1)
  })

  it('주문이 없으면 현재 구간 하나만 낸다', () => {
    const b = buildOrderTrend([], 'month', NOW)
    expect(b).toHaveLength(1)
    expect(b[0].key).toBe('2026-10')
  })
})

describe('buildOrderTrend — 월별', () => {
  it('주문이 없는 중간 달도 0으로 남긴다', () => {
    const b = buildOrderTrend([o('2026-08-05T01:00:00Z'), o('2026-10-05T01:00:00Z')], 'month', NOW)
    expect(b.map(x => x.count)).toEqual([1, 0, 1])
  })

  it('UTC 가 아니라 KST 로 달을 가른다', () => {
    // 2026-09-30T16:00Z = 2026-10-01 01:00 KST → 10월에 들어가야 한다
    const b = buildOrderTrend([o('2026-09-30T16:00:00Z')], 'month', NOW)
    expect(b.map(x => x.key)).toEqual(['2026-10'])
    expect(b[0].count).toBe(1)
  })

  it('금액을 구간별로 합친다', () => {
    const b = buildOrderTrend(
      [o('2026-10-05T01:00:00Z', 12_000), o('2026-10-06T01:00:00Z', 8_000)],
      'month', NOW,
    )
    expect(b[0].amount).toBe(20_000)
  })
})

describe('buildOrderTrend — 주별 · 격주별', () => {
  it('월요일을 구간 시작으로 잡는다', () => {
    // 2026-10-23 이 속한 주의 월요일은 2026-10-19
    const b = buildOrderTrend([o('2026-10-07T01:00:00Z')], 'week', NOW)
    expect(b.map(x => x.label)).toEqual(['10/5', '10/12', '10/19'])
    expect(b[2].partial).toBe(true)
  })

  it('구간 경계에 걸친 주문을 한쪽에만 넣는다', () => {
    const b = buildOrderTrend(
      [
        o('2026-10-11T14:00:00Z'),  // 10/11(일) 23시 KST → 10/5 주
        o('2026-10-18T15:00:00Z'),  // 10/19(월) 00시 KST → 10/19 주
      ],
      'week', NOW,
    )
    expect(b.map(x => x.label)).toEqual(['10/5', '10/12', '10/19'])
    expect(b.map(x => x.count)).toEqual([1, 0, 1])
  })

  it('격주는 14일씩 끊는다', () => {
    const b = buildOrderTrend(
      [o('2026-10-12T01:00:00Z'), o('2026-10-16T01:00:00Z')],   // 둘 다 10/5 구간(10/5~10/18)
      'biweek', NOW,
    )
    expect(b.map(x => x.label)).toEqual(['10/5', '10/19'])
    expect(b.map(x => x.count)).toEqual([2, 0])
  })
})

describe('buildOrderTrend — 일별', () => {
  it('하루씩 끊고 빈 날도 남긴다', () => {
    const b = buildOrderTrend([o('2026-10-21T01:00:00Z')], 'day', NOW)
    expect(b.map(x => x.label)).toEqual(['10/21', '10/22', '10/23'])
    expect(b.map(x => x.count)).toEqual([1, 0, 0])
    expect(b[2].partial).toBe(true)   // 오늘은 진행 중
  })

  it('KST 자정 경계에서 날이 갈린다', () => {
    const b = buildOrderTrend(
      [
        o('2026-10-21T14:59:00Z'),  // 10/21 23:59 KST
        o('2026-10-21T15:00:00Z'),  // 10/22 00:00 KST
      ],
      'day', NOW,
    )
    expect(b.map(x => x.count)).toEqual([1, 1, 0])
  })
})

describe('buildOrderTrend — range(정확한 기간)', () => {
  it('월별은 말일까지 — 윤년·30일 달도 맞다', () => {
    const b = buildOrderTrend([o('2026-02-10T01:00:00Z')], 'month', new Date('2026-04-15T03:00:00Z'))
    expect(b.map(x => x.range)).toEqual(['2/1 ~ 2/28', '3/1 ~ 3/31', '4/1 ~ 4/30'])
  })

  it('주별은 월~일 7일', () => {
    const b = buildOrderTrend([o('2026-10-20T01:00:00Z')], 'week', NOW)
    expect(b[b.length - 1].range).toBe('10/19 ~ 10/25')
  })

  it('격주별은 14일 — 같은 label 이라도 주별과 기간이 다르다', () => {
    const wk = buildOrderTrend([o('2026-10-06T01:00:00Z')], 'week', NOW)
    const bw = buildOrderTrend([o('2026-10-06T01:00:00Z')], 'biweek', NOW)
    const w5 = wk.find(x => x.label === '10/5')!
    const b5 = bw.find(x => x.label === '10/5')!
    expect(w5.range).toBe('10/5 ~ 10/11')
    expect(b5.range).toBe('10/5 ~ 10/18')
  })

  it('일별은 요일을 붙인다', () => {
    const b = buildOrderTrend([o('2026-10-21T01:00:00Z')], 'day', NOW)
    // 2026-10-21 은 수요일, 10-23 은 금요일
    expect(b[0].range).toBe('10/21 (수)')
    expect(b[b.length - 1].range).toBe('10/23 (금)')
  })
})

describe('summarizeTrend', () => {
  it('진행 중 구간은 비교에서 뺀다', () => {
    const b = buildOrderTrend(
      [
        o('2026-08-10T01:00:00Z'),                              // 8월 1건
        o('2026-09-10T01:00:00Z'), o('2026-09-11T01:00:00Z'),   // 9월 2건
        o('2026-10-02T01:00:00Z'),                              // 10월(진행 중) 1건
      ],
      'month', NOW,
    )
    const s = summarizeTrend(b)
    expect(s.current?.key).toBe('2026-10')
    expect(s.current?.count).toBe(1)
    expect(s.lastDone?.key).toBe('2026-09')
    expect(s.prevDone?.key).toBe('2026-08')
    expect(s.delta).toBe(1)          // 9월 2건 − 8월 1건. 진행 중인 10월은 안 쓴다
    expect(s.peak?.key).toBe('2026-09')
  })

  it('주문이 전혀 없으면 최다·비교를 말하지 않는다', () => {
    const s = summarizeTrend(buildOrderTrend([], 'month', NOW))
    expect(s.peak).toBeUndefined()
    expect(s.delta).toBeUndefined()   // 끝난 구간이 아예 없다
  })
})

describe('countAxisTicks', () => {
  it('눈금은 늘 정수다 — 건수 축에 2.5건은 없다', () => {
    for (let m = 0; m <= 200; m++) {
      for (const t of countAxisTicks(m)) {
        expect(Number.isInteger(t)).toBe(true)
      }
    }
  })

  it('가장 높은 막대가 축의 70% 이상을 채운다', () => {
    // 최대 1건만 예외 — 정수 눈금으로는 0/1/2 말고 고를 게 없어서 50% 가 된다.
    // 한 건짜리 막대가 절반 높이로 서는 건 오히려 정직하다.
    for (let m = 2; m <= 200; m++) {
      const [, , top] = countAxisTicks(m)
      expect(m / top).toBeGreaterThanOrEqual(0.7)
    }
    expect(countAxisTicks(1)).toEqual([0, 1, 2])
  })

  it('0 · 중간 · 최대 셋이고 중간은 정확히 절반이다', () => {
    const t = countAxisTicks(9)
    expect(t).toHaveLength(3)
    expect(t[0]).toBe(0)
    expect(t[1] * 2).toBe(t[2])
  })

  it('주문이 없어도 축이 선다', () => {
    expect(countAxisTicks(0)).toEqual([0, 1, 2])
  })
})
