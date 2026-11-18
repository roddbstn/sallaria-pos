import { describe, it, expect } from 'vitest'
import { sortActiveQueue, queueKey, QUEUE_BUCKETS } from './order-queue'
import type { Order } from './mock-data'

const NOW = new Date('2026-11-18T12:00:00+09:00')

/** 비교에 쓰이는 필드만 의미가 있다 — 나머지는 타입을 채우기 위한 값 */
function order(p: Partial<Order> & { code: string }): Order {
  return {
    accountName: '북구청 공원녹지과',
    orderer:     '김지은',
    method:      '포장',
    status:      '조리중',
    items:       [],
    total:       10_000,
    prepMins:    0,
    createdAt:   '2026-11-18T11:00:00+09:00',
    remarks:     '',
    ...p,
  } as Order
}

/** acceptedAt 을 "now 기준 몇 분 전"으로 */
function minsAgo(m: number): string {
  return new Date(NOW.getTime() - m * 60_000).toISOString()
}

const codes = (os: Order[]) => os.map(o => o.code)

describe('queueKey', () => {
  it('접수 안 된 주문은 제일 급한 칸', () => {
    const k = queueKey(order({ code: 'a' }), NOW)
    expect(k.bucket).toBe(QUEUE_BUCKETS.unaccepted)
  })

  it('prep_minutes 가 0/없음이면 기한을 모르는 칸 — 남은 시간 칸이 아니다', () => {
    // mapOrderRow 가 `row.prep_minutes ?? 0` 으로 매핑하는 그 상태
    const k = queueKey(order({ code: 'a', acceptedAt: minsAgo(40), prepMins: 0 }), NOW)
    expect(k.bucket).toBe(QUEUE_BUCKETS.untimed)
  })

  it('접수 + prep_minutes 가 있으면 남은 시간 칸', () => {
    const k = queueKey(order({ code: 'a', acceptedAt: minsAgo(5), prepMins: 15 }), NOW)
    expect(k.bucket).toBe(QUEUE_BUCKETS.timed)
    expect(k.within).toBe(10)
  })

  it('초과한 주문은 음수 — 많이 초과한 쪽이 더 작다(= 더 위)', () => {
    const a = queueKey(order({ code: 'a', acceptedAt: minsAgo(75), prepMins: 15 }), NOW) // 60분 초과
    const b = queueKey(order({ code: 'b', acceptedAt: minsAgo(74), prepMins: 15 }), NOW) // 59분 초과
    expect(a.within).toBeLessThan(b.within)
    expect(a.within).toBeLessThan(0)
  })
})

describe('sortActiveQueue', () => {
  it('남은 시간이 적은 주문이 위', () => {
    const list = [
      order({ code: 'c30', acceptedAt: minsAgo(0),  prepMins: 30 }), // 30분 남음
      order({ code: 'c3',  acceptedAt: minsAgo(12), prepMins: 15 }), // 3분 남음
      order({ code: 'c10', acceptedAt: minsAgo(5),  prepMins: 15 }), // 10분 남음
    ]
    expect(codes(sortActiveQueue(list, NOW))).toEqual(['c3', 'c10', 'c30'])
  })

  it('초과한 주문이 아직 남은 주문보다 위, 많이 초과한 순', () => {
    const list = [
      order({ code: 'left1',  acceptedAt: minsAgo(14), prepMins: 15 }), // 1분 남음
      order({ code: 'over5',  acceptedAt: minsAgo(20), prepMins: 15 }), // 5분 초과
      order({ code: 'over40', acceptedAt: minsAgo(55), prepMins: 15 }), // 40분 초과
    ]
    expect(codes(sortActiveQueue(list, NOW))).toEqual(['over40', 'over5', 'left1'])
  })

  it('60분을 넘겨도 시간으로 접히지 않고 분으로 비교된다', () => {
    const list = [
      order({ code: 'over59',  acceptedAt: minsAgo(74),  prepMins: 15 }),
      order({ code: 'over120', acceptedAt: minsAgo(135), prepMins: 15 }),
    ]
    expect(codes(sortActiveQueue(list, NOW))).toEqual(['over120', 'over59'])
  })

  it('미접수가 맨 위 — 초과한 주문보다도 위', () => {
    const list = [
      order({ code: 'over40', acceptedAt: minsAgo(55), prepMins: 15 }),
      order({ code: 'new',    createdAt: minsAgo(2) }),
    ]
    expect(codes(sortActiveQueue(list, NOW))).toEqual(['new', 'over40'])
  })

  it('미접수끼리는 오래 기다린 순', () => {
    const list = [
      order({ code: 'new1', createdAt: minsAgo(1) }),
      order({ code: 'new9', createdAt: minsAgo(9) }),
      order({ code: 'new4', createdAt: minsAgo(4) }),
    ]
    expect(codes(sortActiveQueue(list, NOW))).toEqual(['new9', 'new4', 'new1'])
  })

  it('기한을 모르는 주문(prep 없음)은 남은 시간 칸 아래, 접수 오래된 순', () => {
    const list = [
      order({ code: 'untimed10', acceptedAt: minsAgo(10), prepMins: 0 }),
      order({ code: 'left30',    acceptedAt: minsAgo(0),  prepMins: 30 }),
      order({ code: 'untimed50', acceptedAt: minsAgo(50), prepMins: 0 }),
    ]
    expect(codes(sortActiveQueue(list, NOW))).toEqual(['left30', 'untimed50', 'untimed10'])
  })

  it('회귀: prep_minutes 가 비어 있는 주문들이 ordered_at desc 로 들어와도 오래된 순으로 뒤집힌다', () => {
    // 전엔 이 셋이 전부 'pending' 동률이라 비교자가 0 을 돌려주고, 쿼리 순서
    // (최신순)가 그대로 남았다 — 오래 기다린 사람이 맨 아래였다.
    const list = [
      order({ code: 'a', acceptedAt: minsAgo(3),  prepMins: 0 }),
      order({ code: 'b', acceptedAt: minsAgo(25), prepMins: 0 }),
      order({ code: 'c', acceptedAt: minsAgo(60), prepMins: 0 }),
    ]
    expect(codes(sortActiveQueue(list, NOW))).toEqual(['c', 'b', 'a'])
  })

  it('준비 알림을 보낸 주문은 맨 아래', () => {
    const list = [
      order({ code: 'ready',  acceptedAt: minsAgo(55), prepMins: 15 }), // 40분 초과지만 다 만들었다
      order({ code: 'left10', acceptedAt: minsAgo(5),  prepMins: 15 }),
      order({ code: 'new',    createdAt: minsAgo(1) }),
    ]
    const sorted = sortActiveQueue(list, NOW, o => o.code === 'ready')
    expect(codes(sorted)).toEqual(['new', 'left10', 'ready'])
  })

  it('원본 배열을 건드리지 않는다', () => {
    const list = [
      order({ code: 'b', acceptedAt: minsAgo(0),  prepMins: 30 }),
      order({ code: 'a', acceptedAt: minsAgo(12), prepMins: 15 }),
    ]
    const before = codes(list)
    sortActiveQueue(list, NOW)
    expect(codes(list)).toEqual(before)
  })

  it('완전 동률이면 주문코드로 — 틱마다 순서가 흔들리지 않는다', () => {
    const same = { acceptedAt: minsAgo(5), prepMins: 15 }
    const asc  = codes(sortActiveQueue([order({ code: 'b2', ...same }), order({ code: 'a1', ...same })], NOW))
    const desc = codes(sortActiveQueue([order({ code: 'a1', ...same }), order({ code: 'b2', ...same })], NOW))
    expect(asc).toEqual(['a1', 'b2'])
    expect(desc).toEqual(['a1', 'b2'])
  })
})
