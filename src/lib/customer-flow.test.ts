import { describe, it, expect } from 'vitest'
import { buildCustomerFlow, type FlowOrder } from './customer-flow'

// 기준 시각: 2026-11-04. 끝난 달은 10월까지다.
const NOW = new Date(2026, 10, 4)

/** 'YYYY-MM-DD' 를 그 날 정오로 — 월 경계에서 시간대 때문에 흔들리지 않게 */
const at = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d, 12).toISOString()
}

const order = (name: string, ymd: string, status = '완료'): FlowOrder =>
  ({ ordererName: name, at: at(ymd), status })

/** 각 사람의 첫 주문을 주문 목록에서 역산 (실제로는 RPC 가 준다) */
function firstSeenOf(orders: FlowOrder[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const o of orders) {
    if (o.status === '취소' || !o.ordererName) continue
    const cur = m.get(o.ordererName)
    if (!cur || o.at < cur) m.set(o.ordererName, o.at)
  }
  return m
}

describe('buildCustomerFlow — 신규/유지/복귀/이탈', () => {
  it('진행 중인 달은 돌려주지 않는다', () => {
    // 11월(진행 중)이 끼면 "아직 안 온 것"이 전부 이탈로 찍힌다
    const flow = buildCustomerFlow([], new Map(), { months: 3, now: NOW })
    expect(flow.map(f => f.label)).toEqual(['8월', '9월', '10월'])
  })

  it('네 갈래를 가른다', () => {
    const orders = [
      order('가', '2026-08-10'),   // 8월 신규
      order('나', '2026-08-11'),   // 8월 신규
      order('다', '2026-08-12'),   // 8월 신규
      order('가', '2026-09-05'),   // 9월 유지 (8월에도 왔다)
      order('라', '2026-09-06'),   // 9월 신규
      // '나'·'다' 는 9월에 안 왔다 → 9월 이탈 2명
      order('나', '2026-10-02'),   // 10월 복귀 (8월 이후 쉬었다가)
      order('가', '2026-10-03'),   // 10월 유지
      // '라' 는 10월에 안 왔다 → 10월 이탈 1명
    ]
    const flow = buildCustomerFlow(orders, firstSeenOf(orders), { months: 3, now: NOW })
    const by = Object.fromEntries(flow.map(f => [f.label, f]))

    expect(by['8월']).toMatchObject({ newcomers: 3, retained: 0, resurrected: 0, churned: 0 })
    expect(by['9월']).toMatchObject({ newcomers: 1, retained: 1, resurrected: 0, churned: 2 })
    expect(by['10월']).toMatchObject({ newcomers: 0, retained: 1, resurrected: 1, churned: 1 })
  })

  it('신규 + 유지 + 복귀 = 그 달 주문자 수', () => {
    // 세 갈래가 겹치거나 빠지면 막대 높이가 실제 주문자 수와 달라진다
    const orders = [
      order('가', '2026-08-10'), order('나', '2026-08-11'),
      order('가', '2026-09-01'), order('다', '2026-09-02'),
      order('가', '2026-10-01'), order('나', '2026-10-02'), order('라', '2026-10-03'),
    ]
    const flow = buildCustomerFlow(orders, firstSeenOf(orders), { months: 3, now: NOW })
    const oct  = flow.find(f => f.label === '10월')!
    expect(oct.newcomers + oct.retained + oct.resurrected).toBe(3)   // 가·나·라
  })

  it('이탈의 분모는 지난달 주문자 수다', () => {
    const orders = [
      order('가', '2026-09-01'), order('나', '2026-09-02'), order('다', '2026-09-03'),
      order('가', '2026-10-01'),
    ]
    const flow = buildCustomerFlow(orders, firstSeenOf(orders), { months: 2, now: NOW })
    const oct  = flow.find(f => f.label === '10월')!
    expect(oct.churned).toBe(2)      // 나·다
    expect(oct.prevActive).toBe(3)   // 9월 주문자 3명 중 2명
  })

  it('취소 주문과 이름 없는 주문은 세지 않는다', () => {
    const orders: FlowOrder[] = [
      order('가', '2026-09-01'),
      order('나', '2026-09-02', '취소'),
      { ordererName: null, at: at('2026-09-03'), status: '완료' },
      order('가', '2026-10-01'),
    ]
    const flow = buildCustomerFlow(orders, firstSeenOf(orders), { months: 2, now: NOW })
    expect(flow.find(f => f.label === '9월')!.newcomers).toBe(1)
    expect(flow.find(f => f.label === '10월')!.churned).toBe(0)
  })

  it('첫 주문이 창 밖이면 신규가 아니라 복귀다', () => {
    // 창(3개월) 밖인 5월에 처음 온 사람이 10월에 다시 왔다.
    // firstSeen 이 전체 이력이라 '신규'로 잘못 세지 않는다.
    const orders = [order('가', '2026-10-05')]
    const firstSeen = new Map([['가', at('2026-05-02')]])
    const flow = buildCustomerFlow(orders, firstSeen, { months: 3, now: NOW })
    expect(flow.find(f => f.label === '10월')).toMatchObject({ newcomers: 0, resurrected: 1 })
  })
})
