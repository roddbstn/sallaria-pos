// 화면 해상도에 맞춰 #root 의 zoom 을 정한다.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────────
// 이 앱의 화면들은 반응형이 아니다. Figma 캔버스에서 환산한 **고정 px** 을 그대로
// 쓴다(lib/figma-scale.ts). 그래서 폭이 설계값과 다르면 4열 그리드가 눌리고
// 라벨이 세로로 쌓인다.
//
// 전엔 index.css 가 `zoom: 1.07` 을 박아 두고 창을 1440×810 으로 고정해 풀었다.
// 매장이 하나일 때는 됐지만, 모니터가 매장마다 다르면 그 방식은 못 버틴다 —
// 침산점은 1024×768 이라 **창 최소 크기(1400)보다 화면이 작아서 창이 아예 안 들어간다.**
//
// ── 어떻게 ─────────────────────────────────────────────────────────────────
// 레이아웃을 고치는 대신 **보이는 배율만** 화면에 맞춘다. 가로·세로 둘 다 들어가는
// 배율(contain)을 골라서, 어떤 해상도에서도 잘리는 데 없이 같은 화면이 나온다.
//   1024×768  → 0.761  (가로가 기준, 세로는 남는다)
//   1440×810  → 1.070  (전에 박아 두던 값과 같다 — 이 식이 맞다는 확인이다)
//   1920×1080 → 1.427  (설계비가 16:9 라 딱 맞는다)
//   2560×1080 → 1.427  (세로가 기준, 가로가 남는다)
//
// 세로가 남는 건 문제가 아니다 — 화면마다 자기 스크롤 영역을 갖고 있어서
// 남는 만큼 목록이 더 보인다. 가로가 남으면 오른쪽에 여백이 생긴다.
//
// ── 기준은 **창**이다 — 무엇을 포기할지의 문제다 (2026-11-05) ─────────────
// 한 번 모니터 기준으로 바꿨다가 되돌렸다. 모니터 기준이면 창을 줄여도 글자가
// 안 작아지지만, 대신 **오른쪽이 잘려서 안 보인다.** 그게 더 나쁘다 —
// POS 에서 안 보이는 버튼은 없는 버튼이다.
//
// 레이아웃이 고정 px 라서 선택지는 둘뿐이고 동시에는 안 된다:
//   (a) 창에 맞춰 축소  → 다 보인다. 대신 글자도 같이 작아진다.  ← 이쪽
//   (b) 크기 유지       → 글자가 그대로다. 대신 잘려서 스크롤해야 한다.
// 간격만 줄여서 버티는 세 번째 길은 없다. 실측하면 화면 루트의 가로 여백이
// 양쪽 합쳐 26~28px 뿐이다(Customers 14 · Menus 13 · Orders 8).
// 폭을 먹는 건 여백이 아니라 고정폭 사이드패널 400px 과 표 칼럼이라,
// 70% 로 줄이는 데 필요한 404px 중 7% 밖에 못 만든다.
//
// 대신 **창 최소 크기(1008×567)를 설계비와 같은 16:9 로** 잡아 뒀다.
// 그래서 허용된 범위 안에서는 배율이 0.749 아래로 안 내려가고,
// 가로·세로가 동시에 딱 맞아 **잘리는 구간 자체가 없다.**

/**
 * 설계 폭(CSS px). 1440 ÷ 1.07 ≈ 1346 — 전에 index.css 주석이 '설계 폭'이라
 * 부르던 값이다. 화면들의 고정 px 가 이 폭에 맞춰져 있다.
 */
export const DESIGN_W = 1346
/** 설계 높이. 810 ÷ 1.07 ≈ 757. 1346×757 은 16:9 다. */
export const DESIGN_H = 757

/**
 * 너무 작아지거나 커지는 걸 막는다.
 * 하한 — 0.55 보다 작으면 14px 글자가 8px 이 되어 카운터에서 못 읽는다.
 *        그 아래 해상도는 차라리 가로로 스크롤되는 게 낫다(#root min-width).
 * 상한 — 4K 모니터에서 OS 배율까지 꺼져 있으면 2.8배까지 가는데, 그쯤이면
 *        글자가 우스꽝스럽게 커진다.
 */
const MIN_ZOOM = 0.55
const MAX_ZOOM = 2

/** 가로·세로 둘 다 들어가는 배율 */
export function fitZoom(availW: number, availH: number): number {
  if (!(availW > 0) || !(availH > 0)) return 1
  const z = Math.min(availW / DESIGN_W, availH / DESIGN_H)
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

/**
 * #root 에 배율을 입힌다.
 *
 * width/height 를 같이 주는 이유: zoom 은 **그린 뒤에** 확대하는 것이라,
 * 안쪽 레이아웃이 보는 폭은 여전히 100vw 다. 그대로 두면 zoom 배수만큼
 * 오른쪽이 잘린다. 100vw ÷ zoom 으로 되돌려 줘야 안쪽이 제 폭을 본다.
 */
export function applyViewportScale(root: HTMLElement = document.getElementById('root')!): number {
  if (!root) return 1
  const z = fitZoom(window.innerWidth, window.innerHeight)
  root.style.zoom = String(z)
  // ⚠️ max(..., DESIGN_W) 를 걸면 안 된다. 창보다 넓게 버티면서 오른쪽이 잘린다.
  //    창에 맞춰 내려와야 **다 보인다.**
  root.style.width  = `calc(100vw / ${z})`
  root.style.height = `calc(100vh / ${z})`
  return z
}

/** 창 크기가 바뀔 때마다 다시 맞춘다. 반환값을 부르면 감시를 끊는다. */
export function watchViewportScale(): () => void {
  applyViewportScale()
  let raf: number | null = null
  const onResize = () => {
    if (raf !== null) return
    raf = requestAnimationFrame(() => { raf = null; applyViewportScale() })
  }
  window.addEventListener('resize', onResize)
  return () => {
    window.removeEventListener('resize', onResize)
    if (raf !== null) cancelAnimationFrame(raf)
  }
}
