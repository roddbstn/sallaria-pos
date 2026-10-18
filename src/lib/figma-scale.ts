/**
 * Figma 디자인은 2240px 네이티브 캔버스에 그려져 있고, 화면엔 ~0.64배로 축소해서 보여주는 걸
 * 전제로 작업됐다. App.tsx/Dashboard.tsx/Customers.tsx/Menus.tsx를 ScaledCanvas(transform:scale,
 * 창 폭에 따라 매번 다시 계산되는 가변 배율) 방식에서 "고정 실제 px, 창을 줄이면 그냥 가려짐"
 * 방식으로 전환하면서, 모든 위치/크기/폰트 값에 이 비율을 한 번만 곱해 고정 리터럴로 박아넣었다.
 *
 * 앱 기본 창 폭(electron/index.ts의 BrowserWindow width)이 바뀌면 이 값도 같이 바꿔야 하고,
 * 그러면 각 파일에 박아둔 리터럴 px 값들도 전부 다시 계산해야 한다(현재는 자동 추적되지 않음).
 */
export const FIGMA_SCALE = 1440 / 2240 // ≈ 0.643

/** Figma 원본 px 값을 고정 실제 px로 반올림 변환. 새로 작성하는 코드에서 손계산 리터럴 대신 사용 권장. */
export function fpx(figmaPx: number): number {
  return Math.round(figmaPx * FIGMA_SCALE)
}


/**
 * #root 에 걸린 zoom 배율.
 *
 * index.css 가 #root 에 zoom 을 걸어 둬서, 그 안의 fixed 자식은 left/bottom 도
 * 같은 비율로 확대된다. getBoundingClientRect() 가 주는 실제 뷰포트 좌표를
 * 그대로 쓰면 그만큼 어긋나므로 나눠서 되돌린다.
 *
 * 화면 밖(fixed)에 띄우는 말풍선·드롭다운이 전부 이게 필요하다.
 */
export function rootZoom(): number {
  const el = document.getElementById('root')
  if (!el) return 1
  const z = parseFloat((getComputedStyle(el) as unknown as { zoom?: string }).zoom ?? '1')
  return Number.isFinite(z) && z > 0 ? z : 1
}
