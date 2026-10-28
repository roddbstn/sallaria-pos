import { describe, it, expect } from 'vitest'
import { alertKindOf, KIND_LABEL, type AlertKind } from './sound'
import { DB_METHOD_MAP } from './mappers'
import type { Order } from './mock-data'

// 여기서 테스트하는 건 **이름이 두 벌이라서** 생기는 함정 하나다.
//   DB 의 method 컬럼 : '내점' · '포장' · '배달'
//   UI 의 Order.method: '매장 식사' · '포장' · '배달'
// mappers.ts 의 DB_METHOD_MAP 이 '내점' → '매장 식사' 로 바꿔서 올려보낸다.
// alertKindOf 는 **UI 값**을 받으므로 '내점' 을 그대로 찾으면 영원히 안 맞는다.
// 소리가 조용히 틀리는 종류의 버그라 눈으로는 안 잡힌다.

describe('alertKindOf', () => {
  it('UI 이용방법 세 가지를 각각 다른 알림음으로 가른다', () => {
    expect(alertKindOf('배달')).toBe('delivery')
    expect(alertKindOf('포장')).toBe('takeout')
    expect(alertKindOf('매장 식사')).toBe('dinein')
  })

  it('DB 값을 매핑해서 넣어도 세 종류가 모두 구분된다', () => {
    const kinds = Object.values(DB_METHOD_MAP).map(alertKindOf)
    expect(new Set(kinds).size).toBe(3)
  })

  it("DB 의 '내점' 은 내점 알림음으로 간다", () => {
    expect(alertKindOf(DB_METHOD_MAP['내점'])).toBe('dinein')
  })

  it('DB 의 세 값 어느 것도 기본음으로 떨어지지 않는다', () => {
    for (const dbValue of ['내점', '포장', '배달']) {
      const uiValue = DB_METHOD_MAP[dbValue]
      expect(uiValue, `DB_METHOD_MAP 에 '${dbValue}' 가 없다`).toBeDefined()
      expect(['delivery', 'takeout', 'dinein']).toContain(alertKindOf(uiValue))
    }
  })

  // 알 수 없는 값이 와도 소리는 나야 한다 — 알림이 멈추는 게 최악이다.
  it('모르는 값이면 내점으로 떨어진다 (조용해지지 않는다)', () => {
    expect(alertKindOf('테이크아웃' as Order['method'])).toBe('dinein')
  })
})

describe('KIND_LABEL', () => {
  it('세 종류 모두 라벨이 있다', () => {
    for (const k of ['delivery', 'takeout', 'dinein'] as AlertKind[]) {
      expect(KIND_LABEL[k]).toBeTruthy()
    }
  })
})
