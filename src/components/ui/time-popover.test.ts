import { describe, it, expect } from 'vitest'
import { timeLabel, toHHMM } from './TimePopover'

// 12시제 ↔ 24시제는 **자정과 정오에서 틀린다.** 오전 12시는 00시, 오후 12시는 12시다.
// 선결제 일시가 12시간 어긋나면 장부를 맞출 때 그날 순서가 뒤집힌다.

describe('toHHMM — 12시제를 24시제로', () => {
  it('오전 12시는 자정(00시)', () => {
    expect(toHHMM(12, 0, false)).toBe('00:00')
  })

  it('오후 12시는 정오(12시)', () => {
    expect(toHHMM(12, 30, true)).toBe('12:30')
  })

  it('오전은 그대로, 오후는 +12', () => {
    expect(toHHMM(1, 5, false)).toBe('01:05')
    expect(toHHMM(11, 55, false)).toBe('11:55')
    expect(toHHMM(1, 5, true)).toBe('13:05')
    expect(toHHMM(11, 55, true)).toBe('23:55')
  })

  it('항상 두 자리로 채운다 — 문자열 비교·정렬이 깨지지 않게', () => {
    for (const pm of [false, true]) {
      for (let h = 1; h <= 12; h++) {
        expect(toHHMM(h, 0, pm)).toMatch(/^\d{2}:\d{2}$/)
      }
    }
  })
})

describe('timeLabel — 24시제를 사람 말로', () => {
  it('자정과 정오', () => {
    expect(timeLabel('00:00')).toBe('오전 12:00')
    expect(timeLabel('12:00')).toBe('오후 12:00')
  })

  it('오전/오후를 가른다', () => {
    expect(timeLabel('09:05')).toBe('오전 9:05')
    expect(timeLabel('14:35')).toBe('오후 2:35')
    expect(timeLabel('23:59')).toBe('오후 11:59')
  })

  it('빈 값·엉뚱한 값은 null — 버튼이 "시간 선택"으로 남는다', () => {
    for (const v of ['', '시간', '25:00', '12:99', '1:2']) {
      expect(timeLabel(v)).toBeNull()
    }
  })

  it('toHHMM 과 왕복해도 같은 시각', () => {
    for (const pm of [false, true]) {
      for (const h of [12, 1, 6, 11]) {
        for (const m of [0, 5, 55]) {
          expect(timeLabel(toHHMM(h, m, pm)))
            .toBe(`${pm ? '오후' : '오전'} ${h}:${String(m).padStart(2, '0')}`)
        }
      }
    }
  })
})
