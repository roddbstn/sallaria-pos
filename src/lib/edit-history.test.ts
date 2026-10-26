import { describe, it, expect } from 'vitest'
import {
  initHistory, pushHistory, undoHistory, redoHistory,
  canUndo, canRedo, currentOf, orderChanged,
} from './edit-history'

const id = (x: string) => x

describe('edit-history', () => {
  it('편집 전에는 양쪽 다 못 누른다', () => {
    const h = initHistory(['A', 'B', 'C'])
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
    expect(currentOf(h)).toEqual(['A', 'B', 'C'])
  })

  it('쌓으면 되돌리기만 열린다', () => {
    const h = pushHistory(initHistory(['A', 'B']), ['B', 'A'])
    expect(canUndo(h)).toBe(true)
    expect(canRedo(h)).toBe(false)
    expect(currentOf(h)).toEqual(['B', 'A'])
  })

  it('되돌리면 다시실행이 열리고, 편집 전보다 더는 못 간다', () => {
    let h = pushHistory(initHistory(['A', 'B']), ['B', 'A'])
    h = undoHistory(h)
    expect(currentOf(h)).toEqual(['A', 'B'])
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(true)

    // 더 되돌려도 그대로 — 범위를 넘지 않는다
    h = undoHistory(h)
    expect(h.idx).toBe(0)
    expect(currentOf(h)).toEqual(['A', 'B'])
  })

  it('다시실행은 되돌린 만큼만', () => {
    let h = pushHistory(initHistory(['A']), ['B'])
    h = undoHistory(h)
    h = redoHistory(h)
    expect(currentOf(h)).toEqual(['B'])
    h = redoHistory(h)          // 더 갈 데가 없다
    expect(currentOf(h)).toEqual(['B'])
    expect(canRedo(h)).toBe(false)
  })

  it('되돌린 뒤 새로 편집하면 다시실행 가지를 버린다', () => {
    let h = initHistory(['A', 'B', 'C'])
    h = pushHistory(h, ['B', 'A', 'C'])
    h = pushHistory(h, ['B', 'C', 'A'])
    h = undoHistory(h)
    expect(canRedo(h)).toBe(true)

    h = pushHistory(h, ['A', 'C', 'B'])   // 새 편집
    expect(canRedo(h)).toBe(false)
    expect(h.stack).toHaveLength(3)       // 편집전 · 드래그1 · 새편집
    expect(currentOf(h)).toEqual(['A', 'C', 'B'])
  })

  it('긴 편집도 끝까지 되돌아간다', () => {
    let h = initHistory<string>([])
    for (let i = 0; i < 30; i++) h = pushHistory(h, [String(i)])
    for (let i = 0; i < 30; i++) h = undoHistory(h)
    expect(h.idx).toBe(0)
    expect(currentOf(h)).toEqual([])
  })
})

describe('orderChanged — 제자리에 놓았으면 쌓지 않는다', () => {
  it('같은 순서면 false', () => {
    expect(orderChanged(['A', 'B'], ['A', 'B'], id)).toBe(false)
  })
  it('순서가 바뀌면 true', () => {
    expect(orderChanged(['A', 'B'], ['B', 'A'], id)).toBe(true)
  })
  it('길이가 다르면(삭제) true', () => {
    expect(orderChanged(['A', 'B'], ['A'], id)).toBe(true)
  })
  it('키 추출자로 비교한다 — 객체가 새로 만들어져도 순서만 같으면 false', () => {
    const a = [{ code: 'x' }, { code: 'y' }]
    const b = [{ code: 'x' }, { code: 'y' }]
    expect(orderChanged(a, b, m => m.code)).toBe(false)
  })
})
