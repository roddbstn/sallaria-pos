// 메뉴 화면 좌측 카드 그리드의 치수.
//
// ── 왜 따로 빼 뒀나 ──────────────────────────────────────────────────────
// 2026-11-08, 1024 해상도에서 **메뉴 이름이 한 글자씩 세로로 쌓였다.**
// 열 수가 6으로 박혀 있었기 때문이다:
//   1440 → 좌측 영역 1040, 카드 156칸, 이름 칸 78  → 멀쩡
//   1024 → 좌측 영역  624, 카드  87칸, 이름 칸  9  → 한 글자씩 줄바꿈
// 카드 안쪽은 좌우 10씩 패딩이고 썸네일(48)과 그 여백(10)을 오른쪽에 비워 두니,
// 이름이 설 폭은 카드 폭에서 78을 뺀 값이다. 카드가 좁아지면 그게 먼저 0이 된다.
//
// 산수가 JSX 한가운데 섞여 있으면 이런 건 눈으로 못 잡는다. 여기 두고 테스트로 박는다.

/** 그리드 좌우 여백 */
export const GRID_PAD = 26
/** 카드 사이 간격 */
export const GRID_GAP = 10
/** 카드 오른쪽 위 썸네일 한 변 */
export const THUMB = 48
/** 카드 안쪽 패딩(좌우) */
export const CARD_PAD = 10
/**
 * 카드 한 장의 최소 폭.
 *
 * 132면 이름 칸이 54칸 — 15px 한글이 세 자쯤 들어간다. 이보다 좁아질 바엔
 * 열을 줄이는 게 낫다(한 줄에 더 많이 보여 봐야 이름을 못 읽으면 소용없다).
 */
export const CARD_MIN_W = 132
/** 열 수 상한 — 1440에서 쓰던 값. 더 넓어져도 카드만 커진다 */
export const MAX_COLS = 6
/** 열 수 하한 */
export const MIN_COLS = 2

export interface MenuGrid {
  cols:      number
  cardW:     number
  /** 다음 열까지의 간격 — 카드가 absolute 로 놓인다 */
  colStep:   number
  /** 메뉴 이름이 썸네일을 피해 가는 오른쪽 패딩. 썸네일을 끄면 0 */
  namePadR:  number
  /** 이름이 실제로 쓸 수 있는 폭 */
  nameW:     number
}

/** 좌측 영역 실측 폭 → 그리드 치수 */
export function menuGrid(gridAreaW: number, showImage: boolean): MenuGrid {
  const inner = gridAreaW - GRID_PAD * 2
  const cols = Math.max(MIN_COLS, Math.min(MAX_COLS,
    Math.floor((inner + GRID_GAP) / (CARD_MIN_W + GRID_GAP))))
  const cardW = Math.max(80, Math.round((inner - GRID_GAP * (cols - 1)) / cols))
  const namePadR = showImage ? THUMB + CARD_PAD : 0
  return {
    cols, cardW,
    colStep:  cardW + GRID_GAP,
    namePadR,
    nameW:    cardW - CARD_PAD * 2 - namePadR,
  }
}
