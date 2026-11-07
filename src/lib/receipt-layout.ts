// 영수증 미리보기를 **실물과 같은 문자 그리드**로 그리기 위한 치수와 유틸.
//
// ── 왜 치수를 따로 적어 두나 ──────────────────────────────────────────────
// 미리보기는 그동안 flex·grid 로 "비슷하게" 그리고 있었다. 글자 크기도 화면용
// px 를 눈대중으로 골랐다. 그러니 설정을 바꿔도 종이에서 어떻게 나올지는 뽑아 봐야
// 알았고, 실제로 미리보기와 실물이 여러 군데 달랐다(라벨 간격·줄 수·크기).
//
// 영수증 프린터는 **글자를 격자에 찍는다.** 한 줄에 들어가는 칸 수가 정해져 있고
// 한글은 두 칸, ASCII 는 한 칸을 먹는다. 그 격자를 그대로 흉내 내면 미리보기가
// 종이와 같아진다.
//
// ── 실측값 (2026-11-07, 행포케 BIXOLON SRP-B300II / 79mm) ─────────────────
//   인쇄 폭        72mm      electron/printer.ts PAPER_PRESETS['79'].printMM
//   한 줄 글자 수   42자      같은 곳 lineChars (ASCII 기준)
//   글자 한 칸     1.71mm    72 ÷ 42
//   한글 한 글자   3.43mm    두 칸
//   줄 간격       4.23mm     ESC/POS 기본 줄바꿈 = 1/6 inch
//   글자 높이      3.0mm     Font A 24도트 @ 203dpi
//   줄높이 비율    1.41      4.23 ÷ 3.0
//
// ⚠️ 아래 pw/clamp/padL/padR/wrapName 은 **electron/escpos.ts 의 같은 이름 함수와
//    한 글자도 달라선 안 된다.** 거기가 실제로 종이에 찍는 쪽이고 여기는 그림이다.
//    electron/ 은 별도 tsconfig(include: electron/**) 라 import 로 묶을 수가 없어
//    mask.ts 처럼 복제해 둔다. 고칠 땐 양쪽을 같이 고친다.

/** 인쇄 폭(mm) — 3인치 헤드 */
export const PRINT_MM = 72
/** 한 줄 글자 수(ASCII 기준) */
export const LINE_CHARS = 42
/** 줄높이 ÷ 글자높이. ESC/POS 기본 줄간격(1/6인치)과 Font A 높이(24도트)의 비 */
export const LINE_RATIO = 1.41

/** 메뉴 표 칼럼 — escpos.ts 와 같은 값 */
export const QTY_W   = 4
export const PRICE_W = 10
export const COL_SEP = 2

/** 인쇄 폭 계산: 한글/한자 = 2, ASCII = 1 */
export function pw(str: string): number {
  let w = 0
  for (const ch of str) w += ch.charCodeAt(0) > 0x7F ? 2 : 1
  return w
}

/** 인쇄 폭 기준으로 최대 maxW 폭까지 잘라냄 */
export function clamp(str: string, maxW: number): string {
  let w = 0
  for (let i = 0; i < str.length; i++) {
    const add = str.charCodeAt(i) > 0x7F ? 2 : 1
    if (w + add > maxW) return str.slice(0, i)
    w += add
  }
  return str
}

/** 좌측 정렬 패딩 (인쇄폭 기준) */
export function padL(s: string, w: number): string {
  return s + ' '.repeat(Math.max(0, w - pw(s)))
}

/** 우측 정렬 패딩 (인쇄폭 기준) */
export function padR(s: string, w: number): string {
  return ' '.repeat(Math.max(0, w - pw(s))) + s
}

/** 가운데 정렬 — 프린터의 ESC a 1 이 하는 일을 글자로 흉내 낸다 */
export function center(s: string, w: number): string {
  const pad = Math.max(0, Math.floor((w - pw(s)) / 2))
  return ' '.repeat(pad) + s
}

/** 메뉴명을 인쇄 폭 기준으로 줄바꿈 — 잘라내지 않고 여러 줄로 */
export function wrapName(name: string, maxW: number): string[] {
  if (pw(name) <= maxW) return [name]
  const lines: string[] = []
  let cur = '', curW = 0
  for (const ch of name) {
    const cw = ch.charCodeAt(0) > 0x7F ? 2 : 1
    if (curW + cw > maxW) {
      // 띄어쓰기가 있으면 **거기서** 끊는다.
      // 칸 수만 보고 끊으면 '수비드 통삼겹 단백질 도시 / 락' 처럼 낱자 한 글자가
      // 다음 줄로 떨어진다. 주방에서 그 줄은 메뉴가 하나 더 있는 것처럼 보인다.
      const sp = cur.lastIndexOf(' ')
      if (sp > 0 && pw(cur.slice(sp + 1)) + cw <= maxW) {
        lines.push(cur.slice(0, sp))
        cur = cur.slice(sp + 1)
        curW = pw(cur)
      } else {
        lines.push(cur)
        cur = ''; curW = 0
      }
    }
    cur += ch; curW += cw
  }
  if (cur) lines.push(cur)
  return lines
}

/** 구분선 — 전체 폭 채움 */
export function hr(w = LINE_CHARS): string {
  return '-'.repeat(w)
}

/** 점선 서브 구분선 — '- ' 반복 */
export function subHr(w = LINE_CHARS): string {
  let s = ''
  while (s.length < w) s += '- '
  return s.slice(0, w)
}

/** 메뉴명 칼럼 폭 */
export function nameWidth(w = LINE_CHARS): number {
  return w - QTY_W - COL_SEP - PRICE_W
}

// ── 미리보기용 ────────────────────────────────────────────────────────────

/**
 * 미리보기 1배 글자 크기(px).
 *
 * 고정폭 글꼴에서 ASCII 한 칸은 0.5em 이다. 11px 이면 한 칸 5.5px, 42칸 = 231px —
 * 지금까지 쓰던 종이 폭(220px)과 거의 같다. 즉 **종이 크기를 그대로 두고**
 * 글자만 격자에 앉힌다.
 *
 * 줄 간격은 LINE_RATIO(1.41) 를 line-height 로 주면 실물과 맞는다:
 *   칸 폭 12도트 : 글자 높이 24도트 : 줄 간격 34도트(1/6인치)
 *   → 줄간격 ÷ 칸폭 = 2.82칸 = 15.5px, 15.5 ÷ 11 = 1.41
 */
export const PREVIEW_FONT_PX = 11
/** 감열지 전체 폭(mm) — 미리보기 종이의 좌우 여백을 실물 비율로 두기 위한 값 */
export const PAPER_MM = 79

/**
 * '라벨 : 값' 한 줄의 라벨 칼럼 폭(칸).
 *
 * 11 인 이유: 이 영수증에서 가장 긴 라벨이 '주문전 잔액'(11칸)이다. 이보다 좁게
 * 잡으면 그 줄만 콜론이 밀려 나가, 격자로 그리는 의미가 없어진다.
 * ⚠️ electron/escpos.ts 의 LABEL_W 와 같은 값이어야 한다.
 */
export const LABEL_W = 11

/** '라벨 : 값' 한 줄 — escpos.ts 의 field() 와 같은 모양 */
export function field(label: string, value: string): string {
  return padL(label, LABEL_W) + ' : ' + value
}

/**
 * 금액 줄의 짧은 라벨 — '크게'(2배)일 때만 쓴다.
 *
 * 2배 글자는 한 칸이 두 칸을 먹으니 한 줄이 21칸뿐이다. 그런데 기본 라벨로
 * 쓰면 '메뉴 소계 : 21,400원' 이 22칸, '주문전 잔액 : 711,800원' 이 23칸이라
 * **종이를 넘는다** — 프린터가 조용히 줄을 접어서 금액 한 줄이 두 줄로 쪼개진다.
 * (2026-11-07 미리보기를 격자로 바꾸면서 발견. 실제 인쇄도 같은 문제였다.)
 */
const AMOUNT_SHORT: Record<string, string> = {
  '메뉴 소계':   '소계',
  '배달료':     '배달료',
  '합  계':     '합계',
  '주문전 잔액': '주문전',
  '주문후 잔액': '주문후',
}
/** 짧은 라벨 중 가장 긴 것('배달료'·'주문전')이 6칸 */
export const AMOUNT_LABEL_W = 6

/** 금액 한 줄. x2 면 짧은 라벨로 바꿔 21칸 안에 넣는다 */
export function amountField(label: string, value: string, x2: boolean): string {
  if (!x2) return field(label, value)
  return padL(AMOUNT_SHORT[label] ?? label, AMOUNT_LABEL_W) + ' : ' + value
}
