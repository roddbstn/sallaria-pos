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
// ── 기준은 **창이 아니라 모니터**다 (2026-11-05) ───────────────────────────
// 처음엔 창 크기(innerWidth)로 배율을 잡았다. 그러면 창을 줄일 때마다 글자와
// 박스가 같이 작아진다 — 점주가 원한 건 그게 아니다. 창을 줄였을 때 바라는 건
// "덜 보이는 것"이지 "작아지는 것"이 아니다.
//
// 그래서 배율은 **모니터(screen.avail*)** 로 한 번 정한다:
//   · 1024×768 모니터에서 최대화  → 0.761 로 화면에 꽉 맞는다
//   · 1920×1080 모니터에서 창을 1008 로 줄임
//       → 배율은 1.427 그대로. 글자 크기가 안 변하고 오른쪽이 잘려 가로 스크롤된다
// 같은 '좁은 뷰포트'라도 **모니터가 좁은 것**과 **창을 줄인 것**은 바라는 게 다르다.
// 둘을 가르는 정보가 screen 크기다.
//
// 간격만 줄여서 버티는 방법도 생각했지만 그만한 여백이 없다 — 실측하면 화면 루트의
// 가로 여백이 양쪽 합쳐 26~28px 이다(Customers 14 · Menus 13 · Orders 8).
// 폭을 먹는 건 여백이 아니라 고정폭 사이드패널 400px 과 표 칼럼이다.

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
 * 창 테두리 몫(타이틀바 등). 모니터 작업영역 전부를 쓸 수 있는 게 아니라
 * 최대화해도 이만큼은 창이 먹는다. 빼지 않으면 최대화했을 때 배율이 살짝 커져
 * 세로가 조금 넘친다.
 */
const WINDOW_CHROME_H = 40

/** 모니터 작업영역으로 배율을 정한다 — 창 크기는 보지 않는다 */
export function screenFitZoom(availW: number, availH: number): number {
  return fitZoom(availW, availH - WINDOW_CHROME_H)
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
  const z = screenFitZoom(window.screen.availWidth, window.screen.availHeight)
  root.style.zoom = String(z)

  // 폭은 **설계 폭 아래로 내려가지 않는다.** 창을 줄이면 #root 가 같이 줄어드는 게
  // 아니라 그대로 있고 오른쪽이 창 밖으로 나간다 → body 의 overflow-x 가 받는다.
  // 이게 "글자는 그대로, 덜 보일 뿐" 을 만드는 한 줄이다.
  root.style.width = `max(calc(100vw / ${z}), ${DESIGN_W}px)`

  // 세로는 창에 맞춘다. 화면마다 자기 스크롤 영역이 있어서, 짧아지면
  // 그 영역이 짧아질 뿐 내용이 닿지 않는 곳으로 가지 않는다.
  // 여기도 설계 높이로 고정하면 body 가 overflow-y: hidden 이라 아래가 영영 가려진다.
  root.style.height = `calc(100vh / ${z})`
  return z
}

/**
 * 다시 맞춘다. 창 크기 자체로는 배율이 안 바뀌지만, **창을 다른 모니터로 옮기면**
 * screen 이 달라지므로 resize 를 신호로 쓴다.
 * 반환값을 부르면 감시를 끊는다.
 */
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
