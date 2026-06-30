/**
 * escpos.ts — ESC/POS 시리얼 영수증 빌더
 *
 * 58mm 열전사 프린터 (COM 포트 직접 연결) 용.
 * iconv-lite로 CP949 인코딩, 1줄 = 32 인쇄 폭(한글 2B / ASCII 1B).
 */

import iconv from 'iconv-lite'
import type { ReceiptSettings, OrderPayload } from './printer'

// ── ESC/POS 커맨드 상수 ───────────────────────────────────────────────────────

const ESC = 0x1B
const GS  = 0x1D
const LF  = 0x0A

const CMD = {
  INIT:        Buffer.from([ESC, 0x40]),
  ALIGN_LEFT:  Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER:Buffer.from([ESC, 0x61, 0x01]),
  BOLD_ON:     Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:    Buffer.from([ESC, 0x45, 0x00]),
  FEED_CUT:    Buffer.from([GS,  0x56, 0x42, 0x04]),   // 4줄 피드 후 부분 컷
}

// ── 인코딩 / 레이아웃 유틸 ───────────────────────────────────────────────────

const LINE_W = 32  // 58mm 기본 폭 (인쇄 단위 문자 수)

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

/** 한 줄: 왼쪽 텍스트 + 오른쪽 텍스트 (오른쪽 정렬) */
function rowBuf(left: string, right: string, width = LINE_W): Buffer {
  const rw = pw(right)
  const leftStr = clamp(left, width - rw - 1)
  const spaces = Math.max(1, width - pw(leftStr) - rw)
  return enc(leftStr + ' '.repeat(spaces) + right)
}

/** 구분선 */
function hrBuf(char = '-', width = LINE_W): Buffer {
  return enc(char.repeat(width))
}

// ── 영수증 빌더 ───────────────────────────────────────────────────────────────

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

/** ① 주방용 (가격 없음) */
export function buildKitchenReceiptEscPos(order: OrderPayload, _settings: ReceiptSettings): Buffer {
  const chunks: Buffer[] = []
  const p = (...bufs: Buffer[]) => chunks.push(...bufs)

  p(CMD.INIT)

  // 헤더
  p(CMD.ALIGN_CENTER, CMD.BOLD_ON, enc('[주방용]'), nl(), CMD.BOLD_OFF)
  p(enc('샐러리아 침산점'), nl())
  p(CMD.ALIGN_LEFT)
  p(hrBuf(), nl())

  // 주문 정보
  p(enc(`주문번호: ${order.order_number ?? order.order_code}`), nl())
  p(enc(`거래처: ${order.account_name}`), nl())
  p(enc(`주문자: ${order.orderer_name}`), nl())
  p(enc(`이용방법: ${order.method}`), nl())
  p(enc(`주문일시: ${formatDate(order.ordered_at)}`), nl())
  p(hrBuf(), nl())

  // 메뉴 헤더
  p(CMD.BOLD_ON, rowBuf('메뉴명', '수량'), nl(), CMD.BOLD_OFF)
  p(hrBuf(), nl())

  // 메뉴 목록
  for (const item of order.items) {
    p(CMD.BOLD_ON, rowBuf(item.menu_name, String(item.quantity)), nl(), CMD.BOLD_OFF)
    for (const opt of item.options) {
      p(enc(`  ▶ ${opt.option_name}`), nl())
    }
  }

  p(hrBuf(), nl())
  p(enc(order.note ? `비고: ${order.note}` : '비고: (없음)'), nl())

  // 피드 + 컷
  p(CMD.FEED_CUT)

  return Buffer.concat(chunks)
}

/** ② 고객용 (잔액·합계 포함) */
export function buildCustomerReceiptEscPos(order: OrderPayload, _settings: ReceiptSettings): Buffer {
  const chunks: Buffer[] = []
  const p = (...bufs: Buffer[]) => chunks.push(...bufs)

  p(CMD.INIT)

  // 헤더
  p(CMD.ALIGN_CENTER, CMD.BOLD_ON, enc('샐러리아 침산점'), nl(), CMD.BOLD_OFF)
  p(CMD.ALIGN_LEFT)
  p(hrBuf(), nl())

  // 주문 정보
  p(enc(`주문번호: ${order.order_number ?? order.order_code}`), nl())
  p(enc(`거래처: ${order.account_name}`), nl())
  p(enc(`주문자: ${order.orderer_name}`), nl())
  p(enc(`이용방법: ${order.method}`), nl())
  p(enc(`주문일시: ${formatDate(order.ordered_at)}`), nl())
  p(hrBuf(), nl())

  // 메뉴 목록 (가격 포함)
  for (const item of order.items) {
    p(CMD.BOLD_ON, rowBuf(`${item.menu_name} ×${item.quantity}`, formatWon(item.subtotal)), nl(), CMD.BOLD_OFF)
    for (const opt of item.options) {
      const optLabel = opt.extra_price > 0 ? `${opt.option_name} +${opt.extra_price.toLocaleString('ko-KR')}원` : opt.option_name
      p(enc(`  ▶ ${optLabel}`), nl())
    }
  }

  p(hrBuf(), nl())

  // 금액 요약
  p(rowBuf('메뉴 소계', formatWon(order.menu_subtotal)), nl())
  if (order.delivery_fee > 0) {
    p(rowBuf('배달료', formatWon(order.delivery_fee)), nl())
  }
  p(CMD.BOLD_ON, rowBuf('합  계', formatWon(order.total_amount)), nl(), CMD.BOLD_OFF)
  p(hrBuf(), nl())

  // 잔액
  p(rowBuf('주문 전 잔액', formatWon(order.balance_before)), nl())
  p(CMD.BOLD_ON, rowBuf('주문 후 잔액', formatWon(order.balance_after)), nl(), CMD.BOLD_OFF)
  if (order.balance_after < 0) {
    p(enc('※ 잔액 부족 - 다음 충전 시 정산'), nl())
  }

  // 피드 + 컷
  p(CMD.FEED_CUT)

  return Buffer.concat(chunks)
}

/** ③ 테스트 출력 */
export function buildTestReceiptEscPos(): Buffer {
  const chunks: Buffer[] = []
  const p = (...bufs: Buffer[]) => chunks.push(...bufs)
  const now = new Date().toLocaleString('ko-KR')

  p(CMD.INIT)
  p(CMD.ALIGN_CENTER)
  p(CMD.BOLD_ON, enc('=== 테스트 출력 ==='), nl(), CMD.BOLD_OFF)
  p(enc('샐러리아 침산점 POS'), nl())
  p(CMD.ALIGN_LEFT)
  p(hrBuf(), nl())
  p(enc('프린터 연결 상태: 정상'), nl())
  p(enc(now), nl())
  p(hrBuf(), nl())
  p(CMD.FEED_CUT)

  return Buffer.concat(chunks)
}
