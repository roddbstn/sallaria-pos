import { describe, it, expect } from 'vitest'
import { normalize, matches, filterMenus, filterCategories } from './menu-search'

const cats = [
  { id: 'c1', name: '샌드위치' },
  { id: 'c2', name: '샐러드' },
  { id: 'c3', name: '음료' },
]
const menus = [
  { name: '단호박닭가슴살 샌드위치', categoryId: 'c1' },
  { name: '통통 쉬림프 듬뿍 샌드위치', categoryId: 'c1' },
  { name: '통통쉬림프 샐러드',       categoryId: 'c2' },
  { name: '아이스 아메리카노',        categoryId: 'c3' },
  { name: '분류 없는 메뉴',           categoryId: null },
]

describe('normalize', () => {
  it('공백을 지우고 소문자로', () => {
    expect(normalize(' 단호박 닭가슴살 ')).toBe('단호박닭가슴살')
    expect(normalize('ICE Americano')).toBe('iceamericano')
  })
})

describe('matches', () => {
  it('부분 일치', () => {
    expect(matches('단호박닭가슴살 샌드위치', '단호박')).toBe(true)
  })

  it('띄어쓰기가 달라도 찾는다 — 점주가 치는 말과 등록된 이름이 같을 이유가 없다', () => {
    expect(matches('단호박닭가슴살 샌드위치', '단호박 닭가슴살')).toBe(true)
    expect(matches('통통 쉬림프 듬뿍 샌드위치', '통통쉬림프')).toBe(true)
  })

  it('빈 검색어는 전부 통과', () => {
    expect(matches('아무거나', '')).toBe(true)
    expect(matches('아무거나', '   ')).toBe(true)
  })

  it('없는 말은 안 걸린다', () => {
    expect(matches('단호박닭가슴살 샌드위치', '연어')).toBe(false)
  })
})

describe('filterMenus', () => {
  it("'단호박' — 그 메뉴만", () => {
    expect(filterMenus(menus, cats, '단호박').map(m => m.name)).toEqual(['단호박닭가슴살 샌드위치'])
  })

  it('카테고리 이름으로도 찾는다 — 그 분류 전체가 나온다', () => {
    expect(filterMenus(menus, cats, '샌드위치').map(m => m.name)).toEqual([
      '단호박닭가슴살 샌드위치', '통통 쉬림프 듬뿍 샌드위치',
    ])
  })

  it('빈 검색어는 전부', () => {
    expect(filterMenus(menus, cats, '')).toHaveLength(menus.length)
  })

  it('카테고리 없는 메뉴도 이름으로 걸린다', () => {
    expect(filterMenus(menus, cats, '분류 없는').map(m => m.name)).toEqual(['분류 없는 메뉴'])
  })
})

describe('filterCategories', () => {
  it('안에 걸리는 메뉴가 있으면 그 카드를 남긴다 — 눌러서 찾아갈 수 있게', () => {
    expect(filterCategories(cats, menus, '단호박').map(c => c.name)).toEqual(['샌드위치'])
  })

  it('카테고리 이름으로도', () => {
    expect(filterCategories(cats, menus, '음료').map(c => c.name)).toEqual(['음료'])
  })

  it('아무것도 안 걸리면 빈 목록', () => {
    expect(filterCategories(cats, menus, '없는메뉴')).toEqual([])
  })

  it("'쉬림프' 는 샌드위치·샐러드 둘 다", () => {
    expect(filterCategories(cats, menus, '쉬림프').map(c => c.name)).toEqual(['샌드위치', '샐러드'])
  })
})
