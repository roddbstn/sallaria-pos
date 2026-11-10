// 메뉴 화면 좌상단 검색.
//
// ⚠️ 2026-11-10 까지 **검색이 아예 동작하지 않았다.** 입력창은 있고 값도 들어가는데
//    (Menus.tsx 의 `search` 상태) 그 값을 쓰는 코드가 한 줄도 없었다. '단호박'을 쳐도
//    아무 일이 안 일어나는 게 버그가 아니라, 거를 코드 자체가 없었다.
//
// ── 띄어쓰기를 지우고 비교하는 이유 ────────────────────────────────────────
// 메뉴 이름은 '단호박닭가슴살 샌드위치'처럼 띄어쓰기가 제멋대로다. 손님이 부르는 말과
// 등록된 이름의 띄어쓰기가 같을 이유가 없다 — 점주는 '단호박 닭가슴살'이라고 친다.
// 양쪽에서 공백을 걷어내고 비교하면 둘 다 걸린다.

/** 비교용으로 다듬는다 — 공백 제거 + 소문자 */
export function normalize(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

/** text 안에 query 가 들어 있나. 빈 검색어는 **전부 통과** */
export function matches(text: string, query: string): boolean {
  const q = normalize(query)
  if (!q) return true
  return normalize(text).includes(q)
}

export interface SearchableMenu { name: string; categoryId: string | null }
export interface SearchableCategory { id: string; name: string }

/**
 * 메뉴 거르기 — 메뉴 이름이 걸리거나, **그 메뉴가 속한 카테고리 이름**이 걸리면 남긴다.
 *
 * 카테고리로도 찾게 하는 이유: 점주는 '샌드위치'를 쳐서 그 분류 전체를 보고 싶어 한다.
 * 이름에 '샌드위치'가 안 들어간 메뉴가 그 분류에 있을 수 있는데, 이름만 보면 빠진다.
 */
export function filterMenus<T extends SearchableMenu>(
  menus: T[], categories: SearchableCategory[], query: string,
): T[] {
  if (!normalize(query)) return menus
  const hitCats = new Set(categories.filter(c => matches(c.name, query)).map(c => c.id))
  return menus.filter(m => matches(m.name, query) || (m.categoryId != null && hitCats.has(m.categoryId)))
}

/**
 * 카테고리 거르기 — 카테고리 이름이 걸리거나, **그 안에 걸리는 메뉴가 있으면** 남긴다.
 *
 * 카테고리 모드에서는 화면에 카테고리 카드만 보인다. 메뉴 이름으로 찾았는데 아무것도
 * 안 나오면 "없다"로 읽히지만, 실제로는 그 메뉴가 어느 카드 **안에** 있다.
 * 그 카드를 남겨 줘야 한 번 더 눌러서 찾아갈 수 있다.
 */
export function filterCategories<C extends SearchableCategory, M extends SearchableMenu>(
  categories: C[], menus: M[], query: string,
): C[] {
  if (!normalize(query)) return categories
  const catsWithHit = new Set(
    menus.filter(m => matches(m.name, query)).map(m => m.categoryId).filter((v): v is string => !!v),
  )
  return categories.filter(c => matches(c.name, query) || catsWithHit.has(c.id))
}
