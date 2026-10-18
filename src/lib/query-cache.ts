// 화면 사이를 오갈 때 같은 데이터를 다시 받지 않기 위한 아주 작은 캐시.
//
// 왜 필요한가 (2026-10-18 측정):
//   · 서버 쿼리 자체는 빠르다 — 사소한 쿼리 90ms vs 메뉴 전체 190ms, 차이가 100ms 남짓
//   · 비싼 건 왕복이다. 기본 90~120ms 에, 10번 중 2번은 1~3초로 튄다
//   · 그런데 탭을 바꾸면 화면이 통째로 언마운트돼서 **매번 처음부터 다시 받는다**
//     (App.tsx 의 PAGE 객체는 고른 하나만 렌더한다)
//   · 메뉴 화면은 압축 후에도 112KB 다
//
// 그래서 쿼리를 더 빠르게 만드는 대신, **이미 받아둔 걸 즉시 보여주고 뒤에서 갱신**한다
// (stale-while-revalidate). 점주 체감으로는 두 번째 방문부터 즉시 뜬다.
//
// 일부러 안 한 것:
//   · localStorage 영속화 — 앱을 껐다 켜면 새로 받는 게 맞다. 메뉴·잔액은 바뀌어 있을 수 있다
//   · 자동 만료 타이머 — 화면이 열릴 때마다 뒤에서 갱신하므로 낡은 채로 머물지 않는다
//   · 라이브러리 도입 — 이 정도에 react-query 를 넣을 이유가 없다

interface Entry { at: number; data: unknown }

const cache = new Map<string, Entry>()

/** 이 시간이 지난 캐시는 "있지만 낡음" — 보여주되 반드시 갱신한다 */
const STALE_MS = 30_000

export function getCached<T>(key: string): { data: T; stale: boolean } | null {
  const e = cache.get(key)
  if (!e) return null
  return { data: e.data as T, stale: Date.now() - e.at > STALE_MS }
}

export function setCached(key: string, data: unknown): void {
  cache.set(key, { at: Date.now(), data })
}

/**
 * 무언가를 고쳤을 때 그 화면 캐시를 버린다.
 * 접두사로 지우는 이유: 'menus:<storeId>' 처럼 키에 매장이 붙어 있어서
 * invalidate('menus') 한 번이면 어느 매장이든 같이 지워진다.
 */
export function invalidate(prefix: string): void {
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k)
  }
}

/** 로그아웃·매장 전환처럼 전부 버려야 할 때 */
export function clearCache(): void {
  cache.clear()
}
