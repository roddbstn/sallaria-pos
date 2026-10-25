import { describe, it, expect } from 'vitest'
import { remainingTime, elapsedTime, pickupLabel, defaultPrepMins } from './pickup-time'

// 이 파일이 지키는 것: 홈 화면의 '남은 시간' 배지.
//
// CLAUDE.md 방침("테스트는 핵심 로직만 — 옵션 가격 계산, 잔액 차감 같은 함수만.
// UI는 직접 클릭")에 맞춰, 눈으로 못 잡는 규칙만 고정한다:
//   ① 남은 쪽은 올림 / 지난 쪽은 내림 (방향이 다르다)
//   ② 60분 이상은 '시간'으로 접힌다
//   ③ 정렬은 value 가 아니라 minutes 로 해야 한다 ← 실제로 한 번 틀렸던 지점

const T0 = '2026-10-22T12:00:00.000Z'
/** T0 기준 n분 뒤 Date */
const at = (n: number) => new Date(new Date(T0).getTime() + n * 60_000)

describe('remainingTime — 반올림 방향', () => {
  it('승인 전(accepted_at 없음)이면 대기', () => {
    const r = remainingTime(undefined, 15, at(0))
    expect(r.tone).toBe('pending')
    expect(r.minutes).toBeNull()
  })

  it('prep_minutes 가 없으면 대기 — 침산점에 POS v1.1.0 깔기 전 상태', () => {
    expect(remainingTime(T0, undefined, at(0)).tone).toBe('pending')
  })

  it('남은 시간은 올림: 59초 남았으면 1분', () => {
    // 15분 작업, 14분 1초 경과 → 59초 남음
    const r = remainingTime(T0, 15, new Date(new Date(T0).getTime() + (14 * 60 + 1) * 1000))
    expect(r.minutes).toBe(1)
    expect(r.unit).toBe('분')
  })

  it('지난 시간은 내림: 30초 지났으면 0 → "지금"', () => {
    // 올림으로 처리하면 없는 1분을 지어낸다. 이 케이스에서 실제로 깨졌던 적이 있다.
    const r = remainingTime(T0, 15, new Date(new Date(T0).getTime() + (15 * 60 + 30) * 1000))
    expect(r.tone).toBe('now')
    expect(r.minutes).toBe(0)
  })

  it('1분 넘게 지나면 초과 — heading 이 "초과 시간"으로 바뀐다', () => {
    const r = remainingTime(T0, 15, at(17))
    expect(r.tone).toBe('over')
    expect(r.minutes).toBe(2)
    expect(r.heading).toBe('초과 시간')
  })

  it('5분 이하면 soon(주황), 그보다 많으면 calm', () => {
    expect(remainingTime(T0, 30, at(25)).tone).toBe('soon')   // 5분 남음
    expect(remainingTime(T0, 30, at(20)).tone).toBe('calm')   // 10분 남음
  })
})

describe('remainingTime — 60분 접힘', () => {
  it('59분은 분 단위 그대로', () => {
    const r = remainingTime(T0, 59, at(0))
    expect(r.value).toBe(59)
    expect(r.unit).toBe('분')
  })

  it('120분은 "2시간"으로 접힌다', () => {
    const r = remainingTime(T0, 120, at(0))
    expect(r.value).toBe(2)
    expect(r.unit).toBe('시간')
  })

  it('⚠️ 정렬은 value 가 아니라 minutes 로 해야 한다', () => {
    // 접힘 때문에 2시간의 value(2) 가 59분의 value(59) 보다 작다.
    // value 로 정렬하면 2시간 남은 주문이 59분 남은 주문보다 **급해 보인다**.
    // Home.tsx 의 정렬이 실제로 이 함정에 빠졌던 적이 있어서 고정해 둔다.
    const twoHours = remainingTime(T0, 120, at(0))
    const fiftyNine = remainingTime(T0, 59, at(0))

    expect(twoHours.value).toBeLessThan(fiftyNine.value!)        // 보이는 숫자는 역전
    expect(twoHours.minutes!).toBeGreaterThan(fiftyNine.minutes!) // 실제 급함은 정상
  })
})

describe('elapsedTime — 끝난 주문의 소요 시간', () => {
  it('prep_minutes 와 무관하게 accepted_at + completed_at 만으로 잰다', () => {
    // 완료된 주문에 '대기'가 찍혀 있던 버그의 회귀 방지선 —
    // 이 함수는 prep_minutes 를 아예 안 받는다(그게 핵심이다).
    const r = elapsedTime(T0, at(23).toISOString())
    expect(r.tone).toBe('calm')
    expect(r.minutes).toBe(23)
    expect(r.heading).toBe('소요 시간')
  })

  it('둘 중 하나라도 없으면 "대기"가 아니라 "-"', () => {
    // 끝난 주문에 '대기'라고 쓰면 아직 안 끝난 것처럼 읽힌다.
    expect(elapsedTime(T0, undefined).label).toBe('-')
    expect(elapsedTime(undefined, T0).label).toBe('-')
  })

  it('1분 미만도 "1분" — "0분 걸렸다"는 멈칫하게 한다', () => {
    const r = elapsedTime(T0, new Date(new Date(T0).getTime() + 20_000).toISOString())
    expect(r.minutes).toBe(1)
  })

  it('소요 시간도 60분에서 시간으로 접힌다', () => {
    const r = elapsedTime(T0, at(90).toISOString())
    expect(r.unit).toBe('시간')
    expect(r.value).toBe(1)
    expect(r.minutes).toBe(90)   // 정렬용 값은 접히지 않는다
  })
})

describe('pickupLabel · defaultPrepMins', () => {
  it('pickupLabel 은 분 단위 그대로 — **의도적으로 시간으로 접지 않는다**', () => {
    // 배지(remainingTime)는 60분에서 '시간'으로 접히는데 이 레이블은 접지 않는다.
    // 서로 다른 자리에 쓰이는 값이라 지금은 이게 맞다. 접고 싶어지면
    // remainingTime 의 span() 을 공유하면 되지만, 그때 이 테스트를 같이 고쳐야 한다.
    expect(pickupLabel(0)).toBe('지금')
    expect(pickupLabel(30)).toBe('30분 뒤')
    expect(pickupLabel(120)).toBe('120분 뒤')
  })

  it('defaultPrepMins — 손님이 고른 값을 우선, 0이나 없으면 폴백', () => {
    expect(defaultPrepMins(25, 15)).toBe(25)
    expect(defaultPrepMins(undefined, 15)).toBe(15)
    expect(defaultPrepMins(0, 15)).toBe(15)   // '지금'(0)은 폴백으로 간다
  })
})
