import QRCode from 'qrcode'

// 거래처 QR 주소를 만드는 단일 출처.
//
// 두 체계가 공존한다:
//   legacy — sallaria.web.app?store=..&account=..  (PIN 입력 화면부터 시작)
//   kakao  — sunpos-kakao.vercel.app/qr/<account>  (카카오 로그인 흐름)
// accounts.qr_system 이 어느 쪽인지 들고 있고, 고객 화면·QR출력 화면이 같은 규칙을 써야 한다.

export const BASE_URL        = 'https://sallaria.web.app'
export const SUNPOS_KAKAO_URL = 'https://sunpos-kakao.vercel.app'

export function qrUrlFor(
  account: { account_code: string; qr_system: 'legacy' | 'kakao' },
  storeId: string,
): string {
  return account.qr_system === 'kakao'
    ? `${SUNPOS_KAKAO_URL}/qr/${account.account_code}`
    : `${BASE_URL}?store=${storeId}&account=${account.account_code}`
}

/** 인쇄용 PNG data URL. 종이에 찍히므로 화면용보다 크게 뽑는다 */
export function qrDataUrl(url: string, size = 400): Promise<string> {
  return QRCode.toDataURL(url, {
    width: size, margin: 0,
    color: { dark: '#1E1E1E', light: '#FFFFFF' },
  })
}

// ── 용지 ────────────────────────────────────────────────────────────────────
//
// 실제 종이 치수에서 QR 크기를 역산한다. "4등분"이 몇 cm인지 눈대중으로 두면
// 인쇄해 보고서야 "너무 작다"를 알게 된다 — 종이와 잉크를 버리고 나서.

export type QrPaper = 'a4-1' | 'a4-2' | 'a4-4' | 'a4-8' | 'receipt'

/** A4 210×297mm, @page margin 10mm → 인쇄 가능 영역 */
const A4_W = 190
const A4_H = 277
/** 칸 사이 간격(mm) — 자를 여유 */
export const CELL_GAP = 8

/** 칸 좌우 여백(mm) */
const PAD_X = 8

// ── 글자 크기는 QR 에 비례한다 ───────────────────────────────────────────────
//
// 전에는 글자가 3/5/3.5mm 로 고정이었다. 그러면 A4 한 장짜리(QR 18cm)에서는
// 거래처명이 손톱만 하게 보이고, 8등분(QR 4cm)에서는 상대적으로 거대해진다.
// 벽에 붙는 종이라 **거래처명이 멀리서 읽혀야** 하는데 그게 안 됐다.
//
// 그래서 글자 크기를 QR 한 변의 비율로 잡는다. 맨 위 두 줄(매장명·거래처명)에
// 가장 큰 비중을 준다 — 사무실 벽에서 자기 과 QR 을 찾는 게 첫 번째 일이다.
export const FONT_RATIO = {
  store:  0.075,   // "○○ 선결제"
  name:   0.130,   // 거래처명 — 가장 크게
  notice: 0.062,   // 안내 문구
} as const

/** 글자가 너무 작아지지 않게 하는 하한(mm) — 8등분에서도 읽혀야 한다 */
export const FONT_MIN = { store: 3.2, name: 5.5, notice: 3.0 } as const

/**
 * QR 한 변 q(mm)에 대응하는 글자 크기(mm).
 * 미리보기와 실제 인쇄가 **같은 값을 쓰도록** 여기 한 곳에서만 계산한다.
 */
export function fontSizesFor(q: number) {
  return {
    store:  Math.max(FONT_MIN.store,  q * FONT_RATIO.store),
    name:   Math.max(FONT_MIN.name,   q * FONT_RATIO.name),
    notice: Math.max(FONT_MIN.notice, q * FONT_RATIO.notice),
    /** 줄 사이 간격 */
    gap:    q * GAP_RATIO,
    /** 칸 위아래 여백 */
    padY:   q * PAD_Y_RATIO,
  }
}

/** 줄 간격·칸 위아래 여백도 QR 에 비례시킨다 */
const GAP_RATIO = 0.025
const PAD_Y_RATIO = 0.03

/**
 * QR 한 변이 q(mm)일 때 글자 블록이 먹는 세로 길이(mm).
 * 줄 3개(매장명·거래처명·안내문구) × 1.3 행간 + 줄 사이 간격 3개 + 위아래 여백.
 * PIN 을 켜면 한 줄이 더 붙으므로 그만큼 여유를 둔다.
 */
export function textHeightFor(q: number): number {
  const line = (r: number, min: number) => Math.max(min, q * r) * 1.3
  return line(FONT_RATIO.store,  FONT_MIN.store)
       + line(FONT_RATIO.name,   FONT_MIN.name)
       + line(FONT_RATIO.notice, FONT_MIN.notice) * 2   // 안내문구 + PIN 자리
       + q * GAP_RATIO * 3
       + q * PAD_Y_RATIO * 2
}

/** 글자 크기가 q 에 비례하므로, 칸 높이 안에 QR+글자가 들어가는 가장 큰 q 를 찾는다 */
function fitQr(cellW: number, cellH: number): number {
  const byWidth = cellW - PAD_X
  // textHeightFor 는 q 에 대해 단조증가라 이분 탐색으로 안전하게 푼다.
  // (하한 때문에 완전한 선형이 아니라 식을 바로 뒤집을 수 없다)
  let lo = 10, hi = byWidth
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (mid + textHeightFor(mid) <= cellH) lo = mid
    else hi = mid
  }
  return Math.max(10, Math.min(byWidth, lo))
}

export interface PaperSpec {
  key:   QrPaper
  label: string
  note:  string
  cols:  number
  rows:  number
}

export const PAPER_OPTIONS: PaperSpec[] = [
  { key: 'a4-1',    label: 'A4 1장',   note: '한 장에 하나 — 벽에 크게 붙일 때',           cols: 1, rows: 1 },
  { key: 'a4-2',    label: 'A4 2등분', note: '위아래로 둘 — 반으로 잘라 두 곳에',          cols: 1, rows: 2 },
  { key: 'a4-4',    label: 'A4 4등분', note: '한 장을 네 칸으로 - 잘라서 나눠주기 좋아요', cols: 2, rows: 2 },
  { key: 'a4-8',    label: 'A4 8등분', note: '한 장에 여덟 — 거래처가 많을 때',            cols: 2, rows: 4 },
  { key: 'receipt', label: '영수증',    note: '매장 프린터로 바로 나와요. 인쇄 대화상자가 뜨지 않습니다', cols: 1, rows: 1 },
]

export interface PaperGeometry {
  /** 칸 하나의 크기(mm) */
  cellW: number
  cellH: number
  /** 그 칸에 들어가는 QR 한 변(mm) — 가로·세로 중 좁은 쪽에 맞춘다 */
  qrMM:  number
  perPage: number
}

/**
 * 용지별 실제 치수 계산.
 *
 * 영수증은 58mm 감열지 기준(좌우 4mm 여백 → 50mm). A4 는 위 상수에서 역산한다.
 * QR 은 정사각형이라 칸의 가로·세로 중 좁은 쪽에 맞춘다.
 */
export function paperGeometry(paper: QrPaper): PaperGeometry {
  if (paper === 'receipt') {
    // 영수증은 폭이 고정(50mm)이라 QR 을 먼저 정하고 글자 높이를 거기에 맞춘다
    const w = 50
    const qrMM = w - 4
    return { cellW: w, cellH: qrMM + textHeightFor(qrMM), qrMM, perPage: 1 }
  }
  const spec = PAPER_OPTIONS.find(p => p.key === paper)!
  const cellW = (A4_W - CELL_GAP * (spec.cols - 1)) / spec.cols
  const cellH = (A4_H - CELL_GAP * (spec.rows - 1)) / spec.rows
  const qrMM  = fitQr(cellW, cellH)
  return { cellW, cellH, qrMM, perPage: spec.cols * spec.rows }
}

/** 23.4 → '2.3cm' */
export function mmToCm(mm: number): string {
  return `${(mm / 10).toFixed(1)}cm`
}

export const DEFAULT_QR_NOTICE = 'QR 찍고 바로 주문하기'
