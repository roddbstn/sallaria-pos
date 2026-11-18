import { remainingTime } from './pickup-time'
import type { Order } from './mock-data'

/**
 * 홈 '대기중' 목록의 줄 세우기 — **급한 것이 위**.
 *
 * 왜 따로 뺐나: 전엔 Home.tsx 안에 비교자가 인라인으로 있었고 "남은 시간이 적은 순"
 * 이라고 적혀 있었는데, 실제로는 절반 가까운 주문에서 그게 꺼져 있었다.
 * `remainingTime()` 은 `if (!acceptedAt || !prepMinutes)` 로 'pending' 을 내는데
 * mapOrderRow 가 `prepMins: row.prep_minutes ?? 0` 으로 매핑하고 **0 은 falsy** 다.
 * 그래서 prep_minutes 가 비어 있는 주문은 전부 'pending' 한 덩어리가 되고,
 * 비교자가 그 덩어리 안에서 0 을 돌려주니 원래 쿼리 순서(ordered_at **desc**)가
 * 그대로 남았다 — 오래 기다린 주문이 맨 아래로 가는, 정확히 거꾸로 된 순서다.
 * 침산점은 최근 30일 완료 90건 중 42건이 prep_minutes 가 비어 있다(구버전 POS 접수분).
 *
 * 그래서 '모르는 것'을 '0분 남음'처럼 섞지 않고, 네 칸으로 나눠 각 칸 안에서만
 * 비교한다. 모르는 기한을 지어내는 순간 화면의 숫자와 순서가 어긋난다.
 */
export const QUEUE_BUCKETS = {
  /** 아직 접수조차 안 된 것('대기'). 점주가 손도 안 댔으니 제일 급하다 */
  unaccepted: 0,
  /** 남은 시간을 아는 것. 초과 많은 순 → 지금 → 남은 분 적은 순 */
  timed: 1,
  /** 접수는 했는데 prep_minutes 가 없어 기한을 모르는 것. 오래 기다린 순 */
  untimed: 2,
  /** 준비 알림을 보낸 것. 셀 시간이 끝났으니 맨 아래 */
  notified: 3,
} as const

export interface QueueKey {
  bucket: number
  /**
   * 같은 칸 안에서의 순서값. **칸마다 단위가 다르다** —
   * `timed` 는 분(초과는 음수), 나머지는 epoch ms.
   * 다른 칸끼리는 bucket 으로 먼저 갈리니 섞여 비교되는 일이 없다.
   */
  within: number
}

function ms(iso: string | undefined): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

export function queueKey(order: Order, now: Date, notified = false): QueueKey {
  // 준비 알림을 보낸 주문은 카드에도 '준비됨'이 찍힌다(readyTime). 남은 시간을
  // 세는 중인 주문들 사이에 끼워두면 "촉박한 순" 목록이 아니게 된다.
  if (notified) return { bucket: QUEUE_BUCKETS.notified, within: ms(order.acceptedAt || order.createdAt) }

  // 미접수와 '접수했지만 기한 미정'은 remainingTime 이 둘 다 'pending' 으로 뭉갠다.
  // 급한 정도가 전혀 다르므로 여기서 직접 가른다.
  if (!order.acceptedAt) return { bucket: QUEUE_BUCKETS.unaccepted, within: ms(order.createdAt) }

  const r = remainingTime(order.acceptedAt, order.prepMins, now)
  if (r.tone === 'pending') return { bucket: QUEUE_BUCKETS.untimed, within: ms(order.acceptedAt) }

  // 화면에 찍히는 value 는 60분이 넘으면 '시간'으로 접힌다. 정렬은 접기 전 분으로 —
  // value 로 비교하면 2시간 초과(2)가 59분 초과(59)보다 덜 급해진다.
  const minutes = r.tone === 'over' ? -(r.minutes ?? 0) : (r.minutes ?? 0)
  return { bucket: QUEUE_BUCKETS.timed, within: minutes }
}

export function compareQueue(a: Order, b: Order, now: Date, isNotified: (o: Order) => boolean): number {
  const ka = queueKey(a, now, isNotified(a))
  const kb = queueKey(b, now, isNotified(b))
  if (ka.bucket !== kb.bucket) return ka.bucket - kb.bucket
  if (ka.within !== kb.within) return ka.within - kb.within
  // 완전히 같으면 주문코드로 — 틱마다 순서가 흔들리면 누르려던 카드가 움직인다
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0
}

/** 대기중 목록 정렬. 원본은 건드리지 않는다 */
export function sortActiveQueue(
  orders: Order[],
  now: Date,
  isNotified: (o: Order) => boolean = () => false,
): Order[] {
  return [...orders].sort((a, b) => compareQueue(a, b, now, isNotified))
}
