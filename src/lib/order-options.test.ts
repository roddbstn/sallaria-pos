import { describe, it, expect } from 'vitest'
import { isPriceOnlyOption } from './order-options'

describe('isPriceOnlyOption — 값만 적힌 옵션 걸러내기', () => {
  it('금액만 있는 이름은 거른다', () => {
    expect(isPriceOnlyOption('13,000원', 0)).toBe(true)
    expect(isPriceOnlyOption('8,300원', 0)).toBe(true)
    expect(isPriceOnlyOption('900원', 0)).toBe(true)
    expect(isPriceOnlyOption(' 10,900 원 ', 0)).toBe(true)
  })

  it('추가금이 붙어 있으면 이름이 금액이어도 남긴다', () => {
    // 돈이 움직이는 선택을 화면에서 지우면 합계가 안 맞는 것처럼 보인다
    expect(isPriceOnlyOption('1,000원', 1000)).toBe(false)
  })

  it('사이즈·종류 같은 진짜 선택지는 남긴다', () => {
    // 같은 '가격(필수)' 그룹 안에 섞여 있는 값들이다
    expect(isPriceOnlyOption('HOT 500ml', 0)).toBe(false)
    expect(isPriceOnlyOption('ICE 1L', 0)).toBe(false)
    expect(isPriceOnlyOption('100g', 0)).toBe(false)
    expect(isPriceOnlyOption('스팀 닭가슴살 포케', 0)).toBe(false)
    expect(isPriceOnlyOption('현미밥', 0)).toBe(false)
  })

  it('금액이 이름의 일부이면 남긴다 — 그건 설명이 붙은 선택지다', () => {
    expect(isPriceOnlyOption('1,000원 추가', 0)).toBe(false)
    expect(isPriceOnlyOption('추가 1,000원', 0)).toBe(false)
    expect(isPriceOnlyOption('13,000원 세트', 0)).toBe(false)
  })

  it('빈 문자열은 금액이 아니다', () => {
    expect(isPriceOnlyOption('', 0)).toBe(false)
    expect(isPriceOnlyOption('원', 0)).toBe(false)
  })
})
