import { describe, it, expect } from 'vitest'
import { menuGrid, MAX_COLS, MIN_COLS } from './menu-grid'

// 우측 사이드패널이 400px 고정이라, 좌측 영역은 (창 레이아웃 폭 − 400) 이다.
const leftArea = (layoutW: number) => layoutW - 400

describe('menuGrid', () => {
  it('1440 에서는 예전처럼 6열', () => {
    const g = menuGrid(leftArea(1440), true)
    expect(g.cols).toBe(6)
    expect(g.cardW).toBeGreaterThanOrEqual(132)
  })

  it('1024 에서는 열을 줄여 카드 폭을 지킨다', () => {
    const g = menuGrid(leftArea(1024), true)
    expect(g.cols).toBeLessThan(6)
    expect(g.cardW).toBeGreaterThanOrEqual(132)
  })

  it('어떤 창 폭에서도 이름 칸이 한글 세 자는 들어간다', () => {
    // 15px 한글 ≈ 15칸. 세 자 = 45칸
    for (let w = 1024; w <= 2560; w += 8) {
      const g = menuGrid(leftArea(w), true)
      expect(g.nameW, `레이아웃 ${w}px`).toBeGreaterThanOrEqual(45)
    }
  })

  it('썸네일을 끄면 이름이 그만큼 넓어진다', () => {
    const on  = menuGrid(leftArea(1024), true)
    const off = menuGrid(leftArea(1024), false)
    expect(off.nameW).toBe(on.nameW + 58)
    expect(off.namePadR).toBe(0)
  })

  it('열 수는 상·하한 안에 머문다', () => {
    for (const w of [300, 500, 1024, 1440, 3840]) {
      const g = menuGrid(leftArea(w), true)
      expect(g.cols).toBeGreaterThanOrEqual(MIN_COLS)
      expect(g.cols).toBeLessThanOrEqual(MAX_COLS)
    }
  })

  it('카드가 좌측 영역을 넘지 않는다', () => {
    for (let w = 1024; w <= 2560; w += 8) {
      const g = menuGrid(leftArea(w), true)
      const used = g.cols * g.cardW + (g.cols - 1) * 10 + 26 * 2
      expect(used, `레이아웃 ${w}px`).toBeLessThanOrEqual(leftArea(w) + 2)  // 반올림 오차
    }
  })
})
