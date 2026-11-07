import { describe, it, expect } from 'vitest'
import { fitZoom, DESIGN_W, BASE_ZOOM, FLUID_MIN_W } from './viewport-scale'

describe('fitZoom — 창 크기 → 배율', () => {
  it('기본 창(1440×810)은 BASE_ZOOM — 전에 index.css 에 박혀 있던 1.07', () => {
    expect(fitZoom(1440, 810)).toBeCloseTo(1.07, 2)
    expect(fitZoom(1440, 810)).toBe(BASE_ZOOM)
  })

  it('FLUID_MIN 까지는 **글자 크기가 안 변한다** — 레이아웃만 좁아진다', () => {
    // 토스포스가 하는 일이 이것이다. 이 구간에서 배율이 흔들리면 글자가 같이 흔들린다.
    const wide   = fitZoom(1440, 810)
    const narrow = fitZoom(Math.ceil(FLUID_MIN_W * BASE_ZOOM), 810)
    expect(narrow).toBe(wide)
  })

  it('그 구간에서 레이아웃 폭은 실제로 줄어든다', () => {
    const z = fitZoom(1340, 810)
    expect(1340 / z).toBeLessThan(DESIGN_W)        // 1346 보다 좁아졌다
    expect(1340 / z).toBeGreaterThanOrEqual(FLUID_MIN_W)
  })

  it('FLUID_MIN 아래로는 그제서야 줄인다 — 안 그러면 잘린다', () => {
    const z = fitZoom(1024, 768)                    // 침산점
    expect(z).toBeLessThan(BASE_ZOOM)
    expect(1024 / z).toBeCloseTo(FLUID_MIN_W, 0)    // 레이아웃은 floor 에서 멈춘다
  })

  it('침산점은 전(1024/1346=0.761)보다 글자가 커진다', () => {
    expect(fitZoom(1024, 768)).toBeGreaterThan(1024 / DESIGN_W)
  })

  it('어떤 창에서도 레이아웃이 FLUID_MIN 아래로 눌리지 않는다', () => {
    for (const [w, h] of [[1024, 768], [1280, 720], [1366, 768], [1440, 900], [1920, 1080]]) {
      expect(w / fitZoom(w, h)).toBeGreaterThanOrEqual(FLUID_MIN_W - 1)
    }
  })

  it('아주 작은 화면은 하한에서 멈춘다 — 더 줄이면 글자를 못 읽는다', () => {
    expect(fitZoom(400, 300)).toBe(0.55)
  })

  it('크기를 아직 모를 때는 1', () => {
    expect(fitZoom(0, 0)).toBe(1)
  })
})
