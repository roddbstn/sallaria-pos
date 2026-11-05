import { describe, it, expect } from 'vitest'
import { fitZoom, DESIGN_W, DESIGN_H } from './viewport-scale'

describe('fitZoom — 해상도별 배율', () => {
  it('1440×810 은 전에 박아 두던 1.07 과 같다', () => {
    // 이 식이 기존 고정값을 그대로 재현하는지가 유일한 검증 기준이다
    expect(fitZoom(1440, 810)).toBeCloseTo(1.07, 2)
  })

  it('침산점 1024×768 — 가로가 기준이고 세로가 남는다', () => {
    const z = fitZoom(1024, 768)
    expect(z).toBeCloseTo(1024 / DESIGN_W, 3)
    expect(768 / z).toBeGreaterThan(DESIGN_H)   // 세로 여유
  })

  it('1920×1080 은 설계비(16:9)라 가로·세로가 동시에 맞는다', () => {
    const z = fitZoom(1920, 1080)
    expect(1920 / z).toBeCloseTo(DESIGN_W, 0)
    expect(1080 / z).toBeCloseTo(DESIGN_H, 0)
  })

  it('가로로 긴 화면은 세로가 기준 — 잘리지 않는다', () => {
    const z = fitZoom(2560, 1080)
    expect(1080 / z).toBeGreaterThanOrEqual(DESIGN_H)
    expect(2560 / z).toBeGreaterThan(DESIGN_W)  // 가로 여유
  })

  it('어떤 해상도에서도 설계 크기가 다 들어간다', () => {
    for (const [w, h] of [[1024, 768], [1280, 720], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440]]) {
      const z = fitZoom(w, h)
      expect(w / z).toBeGreaterThanOrEqual(DESIGN_W - 1)
      expect(h / z).toBeGreaterThanOrEqual(DESIGN_H - 1)
    }
  })

  it('아주 작은 화면은 하한에서 멈춘다 — 더 줄이면 글자를 못 읽는다', () => {
    expect(fitZoom(640, 480)).toBe(0.55)
  })

  it('아주 큰 화면은 상한에서 멈춘다', () => {
    expect(fitZoom(3840, 2160)).toBe(2)
  })

  it('크기를 아직 모를 때는 1', () => {
    expect(fitZoom(0, 0)).toBe(1)
  })

  it('허용된 최소 창(기본의 70%)에서도 가로·세로가 동시에 딱 맞는다', () => {
    // 1008×567 은 1440×810 의 70% 이고 설계비(16:9)와 같다.
    // 그래서 이 범위 안에서는 **잘리는 구간이 없다.**
    const z = fitZoom(1008, 567)
    expect(1008 / z).toBeCloseTo(DESIGN_W, 0)
    expect(567 / z).toBeCloseTo(DESIGN_H, 0)
    expect(z).toBeGreaterThan(0.55)   // 하한에 안 걸린다
  })
})
