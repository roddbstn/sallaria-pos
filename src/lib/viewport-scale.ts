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
// ── 토스포스 방식으로 간다 (2026-11-07) ───────────────────────────────────
// 업계 POS(토스포스·페이히어)는 창을 줄이면 **글자 크기는 그대로 두고 레이아웃이
// 좁아진다.** 박스의 가로 폭과 요소 간 간격만 줄고, 글자와 세로 높이는 고정이다.
//
// 전엔 zoom 을 창 폭에서 바로 구했다. 그러면 치명적인 성질이 생긴다:
//     #root 폭 = 100vw / zoom,  zoom = 창폭 / 1346
//     → 100vw / (창폭/1346) = 1346        ← **항상 1346**
// 창을 어떻게 줄여도 레이아웃이 보는 폭이 안 변한다. 그래서 간격이 줄어들 수가
// 없고, 창 크기 변화가 전부 글자 크기로만 나타났다.
//
// 이제 **FLUID_MIN 까지는 배율을 고정**한다. 그 구간에서 창을 줄이면 레이아웃이
// 직접 좁아지고(= 간격·박스 폭이 줄고) 글자는 안 변한다.
// FLUID_MIN 아래로 내려갈 때만 마지막 수단으로 축소한다.
//
//   창 1440 → zoom 1.07, 레이아웃 1346  (기본)
//   창 1200 → zoom 1.07, 레이아웃 1121  ← 글자 그대로, 레이아웃만 좁아짐
//   창 1096 → zoom 1.07, 레이아웃 1024  ← 여기까지가 고정 구간
//   창 1024 → zoom 1.00, 레이아웃 1024  (침산점 — 글자가 적어놓은 크기대로 찍힌다)
//
// ── FLUID_MIN 은 **내려가는 중인 값**이다 ──────────────────────────────────
// 화면들이 아직 고정 px 라 1240 아래를 못 받는다. 화면을 하나씩 유동으로
// 바꿀 때마다 이 숫자를 낮춘다. 0 에 가까워지면 zoom 을 통째로 뗄 수 있다.
// 한 번에 낮추지 않는 이유: 침산점이 라이브다. 안 되는 폭을 강요하면
// 그 매장 화면이 그날로 깨진다.

/**
 * 설계 폭(CSS px). 1440 ÷ 1.07 ≈ 1346 — 전에 index.css 주석이 '설계 폭'이라
 * 부르던 값이다. 화면들의 고정 px 가 이 폭에 맞춰져 있다.
 */
export const DESIGN_W = 1346
/** 설계 높이. 810 ÷ 1.07 ≈ 757. 1346×757 은 16:9 다. */
export const DESIGN_H = 757

/**
 * 기본 배율 — 설계 폭(1346)을 기본 창(1440)에 채우는 값.
 * 글자 크기는 **이 값에 묶여 고정**이다. 전에 index.css 에 박혀 있던 1.07 이다.
 */
export const BASE_ZOOM = 1440 / DESIGN_W   // ≈ 1.07

/**
 * 레이아웃이 버틸 수 있는 가장 좁은 폭(CSS px). 여기까지는 배율을 안 건드린다.
 * 화면을 유동으로 바꿀 때마다 낮춘다 — 위 주석 참고.
 */
export const FLUID_MIN_W = 1024
/** 세로도 같은 규칙. 화면마다 자기 스크롤 영역이 있어 가로보다 여유가 있다 */
export const FLUID_MIN_H = 640

/**
 * 너무 작아지거나 커지는 걸 막는다.
 * 하한 — 0.55 보다 작으면 14px 글자가 8px 이 되어 카운터에서 못 읽는다.
 *        그 아래 해상도는 차라리 가로로 스크롤되는 게 낫다(#root min-width).
 * 상한 — 4K 모니터에서 OS 배율까지 꺼져 있으면 2.8배까지 가는데, 그쯤이면
 *        글자가 우스꽝스럽게 커진다.
 */
const MIN_ZOOM = 0.55
const MAX_ZOOM = 2

/**
 * 창 크기 → 배율.
 *
 * FLUID_MIN 까지는 **BASE_ZOOM 그대로** — 글자가 안 변하고 레이아웃이 좁아진다.
 * 그보다 좁아지면 그때부터 줄인다(안 그러면 잘린다).
 */
export function fitZoom(viewportW: number, viewportH: number): number {
  if (!(viewportW > 0) || !(viewportH > 0)) return 1
  const z = Math.min(
    BASE_ZOOM,
    viewportW / FLUID_MIN_W,
    viewportH / FLUID_MIN_H,
  )
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
