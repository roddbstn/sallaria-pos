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

/**
 * 칸 안에서 QR 말고 글자가 먹는 세로 길이(mm).
 * 매장명(4) + 거래처명(7) + 안내문구(4) + 칸 위아래 여백(12) + 줄 간격(3×3)
 */
const TEXT_H = 36
/** 칸 좌우 여백(mm) */
const PAD_X = 8

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
  { key: 'a4-4',    label: 'A4 4등분', note: '한 장을 네 칸으로 — 잘라서 나눠주기 좋아요', cols: 2, rows: 2 },
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
    const w = 50
    return { cellW: w, cellH: w + TEXT_H, qrMM: w - 4, perPage: 1 }
  }
  const spec = PAPER_OPTIONS.find(p => p.key === paper)!
  const cellW = (A4_W - CELL_GAP * (spec.cols - 1)) / spec.cols
  const cellH = (A4_H - CELL_GAP * (spec.rows - 1)) / spec.rows
  const qrMM  = Math.max(10, Math.min(cellW - PAD_X, cellH - TEXT_H))
  return { cellW, cellH, qrMM, perPage: spec.cols * spec.rows }
}

/** 23.4 → '2.3cm' */
export function mmToCm(mm: number): string {
  return `${(mm / 10).toFixed(1)}cm`
}

export const DEFAULT_QR_NOTICE = 'QR 찍고 바로 주문하기'
