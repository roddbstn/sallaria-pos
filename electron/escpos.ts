/**
 * escpos.ts — ESC/POS 시리얼 영수증 빌더
 *
 * 58mm 열전사 프린터 (COM 포트 직접 연결) 용.
 * iconv-lite로 CP949 인코딩.
 * LINE_W=48: 구분선이 오른쪽 끝까지 채워짐.
 * 크기: small=2배높이, normal=2배폭+2배높이, large=3배폭+3배높이
 */

import iconv from 'iconv-lite'
import type { ReceiptSettings, OrderPayload } from './printer'

// ── ESC/POS 커맨드 ─────────────────────────────────────────────────────────

const ESC = 0x1B
const GS  = 0x1D
const LF  = 0x0A

const CMD = {
  INIT:         Buffer.from([ESC, 0x40]),
  ALIGN_LEFT:   Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),
  BOLD_ON:      Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:     Buffer.from([ESC, 0x45, 0x00]),
  SIZE_NORMAL:  Buffer.from([GS,  0x21, 0x00]),  // 1x1 (기본)
  SIZE_SMALL:   Buffer.from([GS,  0x21, 0x01]),  // 1x2 (2배 높이) ← '기본' 옵션
  SIZE_MEDIUM:  Buffer.from([GS,  0x21, 0x11]),  // 2x2 (2배 폭+높이) ← '보통' 옵션
  SIZE_LARGE:   Buffer.from([GS,  0x21, 0x22]),  // 3x3 (3배 폭+높이) ← '크게' 옵션
  FEED_CUT:     Buffer.from([GS,  0x56, 0x42, 0x04]),
}

// 실측: 이 프린터는 1배 폭 기준 42자 폭
// SIZE_SMALL(1x width): 42  SIZE_MEDIUM(2x width): 21  SIZE_LARGE(3x width): 14
const BASE_W = 42  // 기본 구분선 / 정보 라인 폭

function sizeCmd(s: 'small' | 'normal' | 'large'): Buffer {
  if (s === 'large')  return CMD.SIZE_MEDIUM  // 2x2 — 큰 표시 (짧은 이름용)
  if (s === 'normal') return CMD.SIZE_SMALL   // 1x2 — 보통 (긴 이름도 전폭 표시)
  return CMD.SIZE_SMALL                        // 1x2 — 기본
}

function lineW(s: 'small' | 'normal' | 'large'): number {
  if (s === 'large')  return 21  // 2x 폭 → 42/2
  return 42                       // 1x 폭 → 전폭
}

// ── 인코딩 / 레이아웃 유틸 ─────────────────────────────────────────────────

/** 인쇄 폭 계산: 한글/한자 = 2, ASCII = 1 */
function pw(str: string): number {
  let w = 0
  for (const ch of str) w += ch.charCodeAt(0) > 0x7F ? 2 : 1
  return w
}

/** 인쇄 폭 기준으로 최대 maxW 폭까지 잘라냄 */
function clamp(str: string, maxW: number): string {
  let w = 0
  for (let i = 0; i < str.length; i++) {
    const add = str.charCodeAt(i) > 0x7F ? 2 : 1
    if (w + add > maxW) return str.slice(0, i)
    w += add
  }
  return str
}

function enc(str: string): Buffer {
  return iconv.encode(str, 'cp949')
}

function nl(): Buffer { return Buffer.from([LF]) }

/** 양쪽 정렬 행: 왼쪽 레이블, 오른쪽 값 */
function rowBuf(left: string, right: string, width = BASE_W): Buffer {
  const rw = pw(right)
  const leftStr = clamp(left, width - rw - 1)
  const spaces = Math.max(1, width - pw(leftStr) - rw)
  return enc(leftStr + ' '.repeat(spaces) + right)
}

/** 구분선: 전체 폭 채움 */
function hrBuf(width = BASE_W): Buffer {
  return enc('-'.repeat(width))
}

/** 메뉴명을 인쇄 폭 기준으로 줄바꿈 — 잘라내지 않고 여러 줄로 */
function wrapName(name: string, maxW: number): string[] {
  if (pw(name) <= maxW) return [name]
  const lines: string[] = []
  let cur = '', curW = 0
  for (const ch of name) {
    const cw = ch.charCodeAt(0) > 0x7F ? 2 : 1
    if (curW + cw > maxW) { lines.push(cur); cur = ch; curW = cw }
    else { cur += ch; curW += cw }
  }
  if (cur) lines.push(cur)
  return lines
}

// ── 포맷 유틸 ──────────────────────────────────────────────────────────────

function formatWon(n: number): string {
  return n.toLocaleString('ko-KR') + '원'
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return (
    `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ` +
    `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  )
}

// ── 영수증 빌더 ────────────────────────────────────────────────────────────

/** ① 주방용 (가격 없음) */
export function buildKitchenReceiptEscPos(order: OrderPayload, settings: ReceiptSettings): Buffer {
  const mSize = settings.menuSize
  const oSize = settings.optionSize
  const mW    = lineW(mSize)

  const chunks: Buffer[] = []
  const p = (...bufs: Buffer[]) => chunks.push(...bufs)

  p(CMD.INIT)

  // 헤더
  p(CMD.ALIGN_CENTER, CMD.BOLD_ON, CMD.SIZE_SMALL, enc('[주방용]'), nl())
  p(enc('샐러리아 침산점'), nl(), CMD.SIZE_NORMAL, CMD.BOLD_OFF)
  p(CMD.ALIGN_LEFT)
  p(hrBuf(), nl())

  // 주문 정보 (양쪽 정렬, 기본 크기)
  p(CMD.SIZE_SMALL)
  p(rowBuf('주문번호', order.order_number ?? order.order_code), nl())
  p(rowBuf('거래처',   order.account_name), nl())
  p(rowBuf('주문자',   order.orderer_name), nl())
  p(rowBuf('이용방법', order.method), nl())
  p(rowBuf('주문일시', formatDate(order.ordered_at)), nl())
  p(CMD.SIZE_NORMAL)
  p(hrBuf(), nl())

  // 메뉴 헤더
  p(sizeCmd(mSize), CMD.BOLD_ON, rowBuf('메뉴명', '수량', mW), CMD.BOLD_OFF, CMD.SIZE_NORMAL, nl())
  p(hrBuf(), nl())

  // 메뉴 목록
  for (const item of order.items) {
    const qty = String(item.quantity)
    const nameLines = wrapName(item.menu_name, mW - pw(qty) - 1)
    for (let i = 0; i < nameLines.length; i++) {
      const isLast = i === nameLines.length - 1
      p(sizeCmd(mSize), CMD.BOLD_ON)
      p(isLast ? rowBuf(nameLines[i], qty, mW) : enc(nameLines[i]))
      p(CMD.BOLD_OFF, CMD.SIZE_NORMAL, nl())
    }
    for (const opt of item.options) {
      p(sizeCmd(oSize), enc(`  ${opt.option_name}`), CMD.SIZE_NORMAL, nl())
    }
  }

  p(hrBuf(), nl())
  p(CMD.SIZE_SMALL)
  p(rowBuf('비고', order.note || '없음'), nl())
  p(CMD.SIZE_NORMAL)
  p(CMD.FEED_CUT)

  return Buffer.concat(chunks)
}

/** ② 고객용 (잔액·합계 포함) */
export function buildCustomerReceiptEscPos(order: OrderPayload, settings: ReceiptSettings): Buffer {
  const mSize = settings.customerMenuSize
  const oSize = settings.customerOptionSize
  const mW    = lineW(mSize)

  const chunks: Buffer[] = []
  const p = (...bufs: Buffer[]) => chunks.push(...bufs)

  p(CMD.INIT)

  // 헤더
  p(CMD.ALIGN_CENTER, CMD.BOLD_ON, CMD.SIZE_SMALL, enc('샐러리아 침산점'), nl(), CMD.SIZE_NORMAL, CMD.BOLD_OFF)
  p(CMD.ALIGN_LEFT)
  p(hrBuf(), nl())

  // 주문 정보 (양쪽 정렬)
  p(CMD.SIZE_SMALL)
  p(rowBuf('주문번호', order.order_number ?? order.order_code), nl())
  p(rowBuf('거래처',   order.account_name), nl())
  p(rowBuf('주문자',   order.orderer_name), nl())
  p(rowBuf('이용방법', order.method), nl())
  p(rowBuf('주문일시', formatDate(order.ordered_at)), nl())
  p(CMD.SIZE_NORMAL)
  p(hrBuf(), nl())

  // 메뉴 목록 (양쪽 정렬, 크기 적용)
  for (const item of order.items) {
    const priceStr = formatWon(item.subtotal)
    const label = `${item.menu_name} x${item.quantity}`
    const nameLines = wrapName(label, mW - pw(priceStr) - 1)
    for (let i = 0; i < nameLines.length; i++) {
      const isLast = i === nameLines.length - 1
      p(sizeCmd(mSize), CMD.BOLD_ON)
      p(isLast ? rowBuf(nameLines[i], priceStr, mW) : enc(nameLines[i]))
      p(CMD.BOLD_OFF, CMD.SIZE_NORMAL, nl())
    }
    for (const opt of item.options) {
      const optLabel = opt.extra_price > 0
        ? `${opt.option_name} +${opt.extra_price.toLocaleString('ko-KR')}원`
        : opt.option_name
      p(sizeCmd(oSize), enc(`  ${optLabel}`), CMD.SIZE_NORMAL, nl())
    }
  }

  p(hrBuf(), nl())

  // 금액 요약 (양쪽 정렬, 기본 크기)
  p(CMD.SIZE_SMALL)
  p(rowBuf('메뉴 소계', formatWon(order.menu_subtotal)), nl())
  if (order.delivery_fee > 0) {
    p(rowBuf('배달료', formatWon(order.delivery_fee)), nl())
  }
  p(CMD.SIZE_NORMAL)
  p(hrBuf(), nl())
  p(CMD.SIZE_SMALL, CMD.BOLD_ON, rowBuf('합  계', formatWon(order.total_amount)), nl(), CMD.BOLD_OFF, CMD.SIZE_NORMAL)
  p(hrBuf(), nl())

  // 잔액 (양쪽 정렬)
  p(CMD.SIZE_SMALL)
  p(rowBuf('주문 전 잔액', formatWon(order.balance_before)), nl())
  p(CMD.BOLD_ON, rowBuf('주문 후 잔액', formatWon(order.balance_after)), nl(), CMD.BOLD_OFF)
  if (order.balance_after < 0) {
    p(enc('※ 잔액 부족 - 다음 충전 시 정산'), nl())
  }
  p(CMD.SIZE_NORMAL)

  p(CMD.FEED_CUT)

  return Buffer.concat(chunks)
}

/** ③ 테스트 출력 */
export function buildTestReceiptEscPos(): Buffer {
  const chunks: Buffer[] = []
  const p = (...bufs: Buffer[]) => chunks.push(...bufs)
  const now = new Date().toLocaleString('ko-KR')

  p(CMD.INIT)
  p(CMD.ALIGN_CENTER, CMD.SIZE_SMALL, CMD.BOLD_ON)
  p(enc('=== 테스트 출력 ==='), nl())
  p(enc('샐러리아 침산점 POS'), nl())
  p(CMD.BOLD_OFF, CMD.SIZE_NORMAL, CMD.ALIGN_LEFT)
  p(hrBuf(), nl())
  p(CMD.SIZE_SMALL)
  p(rowBuf('프린터 상태', '정상'), nl())
  p(enc(now), nl())
  p(CMD.SIZE_NORMAL)
  p(hrBuf(), nl())
  p(CMD.FEED_CUT)

  return Buffer.concat(chunks)
}
