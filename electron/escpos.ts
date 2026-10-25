/**
 * escpos.ts — ESC/POS 시리얼 영수증 빌더
 *
 * 감열 영수증 프린터(COM 포트 직접 연결 / LAN) 용.
 * iconv-lite로 CP949 인코딩.
 *
 * ⚠️ 한 줄 글자 수는 **설정에서 들어온다**(printer.ts resolveLineChars). 예전엔
 *    42 로 박혀 있었는데, 그건 침산점 기기의 실측값일 뿐 58mm 프린터에 꽂으면
 *    구분선이 넘쳐 두 줄로 접히고 메뉴 표의 가격 칼럼이 밀린다.
 * 크기: small=2배높이, normal=2배폭+2배높이, large=3배폭+3배높이
 */

import QRCode from 'qrcode'
import iconv from 'iconv-lite'
import type { ReceiptSettings, OrderPayload } from './printer'
import { maskName, maskPhone } from './mask'
import type { ReceiptTextSize } from './printer'

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
  // GS ! n — 상위 니블이 폭 배수-1, 하위 니블이 높이 배수-1
  SIZE_H1:      Buffer.from([GS,  0x21, 0x00]),  // 1폭 x 1높이
  SIZE_H2:      Buffer.from([GS,  0x21, 0x01]),  // 1폭 x 2높이 ← '보통'
  SIZE_H3:      Buffer.from([GS,  0x21, 0x02]),  // 1폭 x 3높이 ← '크게'
  SIZE_W2H2:    Buffer.from([GS,  0x21, 0x11]),  // 2폭 x 2높이 (폭을 키우면 칼럼이 깨진다)
  FEED_CUT:     Buffer.from([GS,  0x56, 0x42, 0x04]),
}

/**
 * 설정값('보통'/'크게') → ESC/POS 크기 명령.
 *
 * ⚠️ 폭(width)을 키우면 한 줄에 들어가는 글자 수가 42 → 21 → 14 로 줄어, 칼럼을
 *    글자 수로 맞춰 둔 메뉴 표가 깨진다. 그래서 **높이만** 키운다.
 *
 * 2026-10-18 버그 수정: 'large' 와 기본값이 둘 다 0x01(1폭x2높이) 이어서
 *    크게를 골라도 보통과 **완전히 같은 영수증**이 나왔다. 설정이 아무 일도
 *    하지 않고 있었다. 이제 크게는 0x02(1폭x3높이) 다 — 폭은 그대로라 칼럼은 안 깨진다.
 */
function sizeCmd(size: ReceiptTextSize | undefined): Buffer {
  switch (size) {
    case 'large':  return CMD.SIZE_H3   // 1폭 x 3높이
    default:       return CMD.SIZE_H2   // '보통' — 1폭 x 2높이
  }
}

// 설정이 없을 때의 기본값 — 침산점 실측값(80mm 에서 42자).
// 폭은 키우지 않으므로(sizeCmd 주석) 배수에 따라 글자 수가 줄지 않는다.
const DEFAULT_LINE_CHARS = 42


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

/** 구분선: 전체 폭 채움 */
function hrBuf(width: number): Buffer {
  return enc('-'.repeat(width))
}

/** 점선 서브 구분선: "- " 반복 */
function subHrBuf(width: number): Buffer {
  const pattern = '- '
  let s = ''
  while (s.length < width) s += pattern
  return enc(s.slice(0, width))
}

/** 우측 정렬 패딩 (인쇄폭 기준) */
function padR(s: string, w: number): string {
  return ' '.repeat(Math.max(0, w - pw(s))) + s
}

/** 좌측 정렬 패딩 (인쇄폭 기준) */
function padL(s: string, w: number): string {
  return s + ' '.repeat(Math.max(0, w - pw(s)))
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

// ── 레이아웃 계산 ─────────────────────────────────────────────────────────
//
// 폭이 바뀌면 구분선 길이와 메뉴 표의 '메뉴명' 칼럼이 같이 바뀐다. 수량(4)·가격(10)은
// 담을 숫자의 자릿수로 정해진 값이라 폭과 무관하게 고정이고, 남는 자리를 메뉴명이 받는다.
// 메뉴 표는 항상 1폭 기준으로 계산한다(sizeCmd 주석 — 폭을 키우면 칼럼이 깨진다).

const QTY_W   = 4
const PRICE_W = 10
const COL_SEP = 2        // 수량↔가격 사이 공백

function layout(lineChars = DEFAULT_LINE_CHARS) {
  const W = Math.max(24, Math.min(64, Math.floor(lineChars)))
  return {
    W,
    nameW:  W - QTY_W - COL_SEP - PRICE_W,
    hr:    () => hrBuf(W),
    subHr: () => subHrBuf(W),
  }
}

// ── 영수증 빌더 ────────────────────────────────────────────────────────────

/** ① 주방용 */
export function buildKitchenReceiptEscPos(order: OrderPayload, settings: ReceiptSettings, lineChars?: number): Buffer {
  const L = layout(lineChars)
  const chunks: Buffer[] = []
  const p = (...bufs: Buffer[]) => chunks.push(...bufs)
  // 메뉴명 줄은 글자 수로 칼럼을 맞추므로 크기를 바꾸지 않는다(sizeCmd 주석 참고).
  // 독립된 줄인 옵션·금액만 설정 크기를 따른다.
  const optCmd = sizeCmd(settings.optionSize)
  const amtCmd = sizeCmd(settings.amountSize)

  p(CMD.INIT)

  // 헤더
  p(CMD.ALIGN_CENTER, CMD.BOLD_ON, CMD.SIZE_H2)
  p(enc('[주방용]'), nl())
  p(CMD.BOLD_OFF, enc(`${order.store_name ?? '샐러리아 침산점'} - 선결제 영수증`), nl())
  p(CMD.SIZE_H1, CMD.ALIGN_LEFT)
  p(L.hr(), nl())

  // 블록1: 주문번호 / 주문일시
  p(CMD.SIZE_H2)
  p(enc('주문번호 : '), CMD.BOLD_ON, enc(order.order_number ?? order.order_code), CMD.BOLD_OFF, nl())
  p(enc('주문일시 : ' + formatDate(order.ordered_at)), nl())
  p(CMD.SIZE_H1)
  p(L.hr(), nl())

  // 블록2: 이용방법 / 주문자 / 전화번호
  p(CMD.SIZE_H2)
  p(enc('이용방법 : '), CMD.BOLD_ON, enc(order.method), CMD.BOLD_OFF, nl())
  p(enc('주문자   : ' + maskName(order.orderer_name)), nl())
  p(enc('전화번호 : ' + (order.orderer_phone ? maskPhone(order.orderer_phone) : '없음')), nl())
  if (order.account_name) {
    p(enc('거래처   : ' + order.account_name), nl())
  }
  p(CMD.SIZE_H1)
  p(L.hr(), nl())

  // 블록3: 배달 정보 (배달일 때만)
  if (order.delivery_address) {
    p(CMD.SIZE_H2)
    for (const line of wrapName('배달주소 : ' + order.delivery_address, L.W)) p(enc(line), nl())
    if (order.delivery_detail) {
      for (const line of wrapName('배달상세 : ' + order.delivery_detail, L.W)) p(enc(line), nl())
    }
    p(enc('가게요청 : ' + (order.note || '없음')), nl())
    p(enc('배달요청 : ' + (order.delivery_note || '없음')), nl())
    p(CMD.SIZE_H1)
    p(L.hr(), nl())
  } else {
    p(CMD.SIZE_H2)
    p(enc('가게요청 : ' + (order.note || '없음')), nl())
    p(CMD.SIZE_H1)
    p(L.hr(), nl())
  }

  // 메뉴 테이블 헤더 (3열, SIZE_NORMAL = 작은 크기)
  p(CMD.SIZE_H1, CMD.BOLD_ON)
  p(enc(padL('메뉴명', L.nameW) + padR('수량', QTY_W) + ' '.repeat(COL_SEP) + padR('가격', PRICE_W)))
  p(CMD.BOLD_OFF, nl())
  p(L.subHr(), nl())

  // 메뉴 목록
  for (const item of order.items) {
    const qtyStr   = String(item.quantity)
    const priceStr = formatWon(item.subtotal)
    const nameLines = wrapName(item.menu_name, L.nameW)
    for (let i = 0; i < nameLines.length; i++) {
      const isLast = i === nameLines.length - 1
      p(CMD.SIZE_H1, CMD.BOLD_ON)
      if (isLast) p(enc(padL(nameLines[i], L.nameW) + padR(qtyStr, QTY_W) + ' '.repeat(COL_SEP) + padR(priceStr, PRICE_W)))
      else        p(enc(padL(nameLines[i], L.nameW) + ' '.repeat(QTY_W + COL_SEP + PRICE_W)))
      p(CMD.BOLD_OFF, nl())
    }
    for (const opt of item.options) {
      const optLabel = opt.extra_price > 0
        ? `  > ${opt.option_name} (+${opt.extra_price.toLocaleString('ko-KR')}원)`
        : `  > ${opt.option_name}`
      p(optCmd, enc(clamp(optLabel, L.W)), nl())
    }
  }

  p(L.hr(), nl())

  // 금액 요약
  p(amtCmd)
  p(enc('메뉴 소계 : ' + formatWon(order.menu_subtotal)), nl())
  if (order.delivery_fee > 0) p(enc('배달료   : ' + formatWon(order.delivery_fee)), nl())
  p(CMD.SIZE_H1)
  p(L.hr(), nl())
  p(amtCmd, CMD.BOLD_ON, enc('합  계   : ' + formatWon(order.total_amount)), CMD.BOLD_OFF, CMD.SIZE_H1, nl())
  p(L.hr(), nl())

  // 잔액 — 설정에서 끌 수 있다(기본 켬)
  if (settings.showBalance !== false) {
    p(amtCmd)
    p(enc('주문전 잔액 : ' + formatWon(order.balance_before)), nl())
    p(CMD.BOLD_ON, enc('주문후 잔액 : ' + formatWon(order.balance_after)), CMD.BOLD_OFF, nl())
    if (order.balance_after < 0) p(enc('※ 잔액 부족 - 다음 충전 시 정산'), nl())
    p(CMD.SIZE_H1)
  }

  // 점주가 설정한 하단 문구
  if (settings.footerText?.trim()) {
    p(L.hr(), nl())
    p(CMD.ALIGN_CENTER, CMD.SIZE_H1)
    for (const line of settings.footerText.trim().split('\n')) p(enc(clamp(line, L.W)), nl())
    p(CMD.ALIGN_LEFT)
  }

  p(CMD.FEED_CUT)
  return Buffer.concat(chunks)
}

/** ② 고객용 (잔액·합계 포함) */
export function buildCustomerReceiptEscPos(order: OrderPayload, settings: ReceiptSettings, lineChars?: number): Buffer {
  const L = layout(lineChars)
  const chunks: Buffer[] = []
  const p = (...bufs: Buffer[]) => chunks.push(...bufs)
  const optCmd = sizeCmd(settings.customerOptionSize)
  const amtCmd = sizeCmd(settings.amountSize)

  p(CMD.INIT)

  // 헤더
  p(CMD.ALIGN_CENTER, CMD.BOLD_ON, CMD.SIZE_H2)
  p(enc('[고객용]'), nl())
  p(CMD.BOLD_OFF, enc(`${order.store_name ?? '샐러리아 침산점'} - 선결제 영수증`), nl())
  p(CMD.SIZE_H1, CMD.ALIGN_LEFT)
  p(L.hr(), nl())

  // 블록1: 주문번호 / 주문일시
  p(CMD.SIZE_H2)
  p(enc('주문번호 : '), CMD.BOLD_ON, enc(order.order_number ?? order.order_code), CMD.BOLD_OFF, nl())
  p(enc('주문일시 : ' + formatDate(order.ordered_at)), nl())
  p(CMD.SIZE_H1)
  p(L.hr(), nl())

  // 블록2: 이용방법 / 주문자 / 전화번호
  p(CMD.SIZE_H2)
  p(enc('이용방법 : '), CMD.BOLD_ON, enc(order.method), CMD.BOLD_OFF, nl())
  p(enc('주문자   : ' + maskName(order.orderer_name)), nl())
  p(enc('전화번호 : ' + (order.orderer_phone ? maskPhone(order.orderer_phone) : '없음')), nl())
  if (order.account_name) {
    p(enc('거래처   : ' + order.account_name), nl())
  }
  p(CMD.SIZE_H1)
  p(L.hr(), nl())

  // 블록3: 배달 정보 + 요청사항
  if (order.delivery_address) {
    p(CMD.SIZE_H2)
    for (const line of wrapName('배달주소 : ' + order.delivery_address, L.W)) p(enc(line), nl())
    if (order.delivery_detail) {
      for (const line of wrapName('배달상세 : ' + order.delivery_detail, L.W)) p(enc(line), nl())
    }
    p(enc('가게요청 : ' + (order.note || '없음')), nl())
    p(enc('배달요청 : ' + (order.delivery_note || '없음')), nl())
    p(CMD.SIZE_H1)
    p(L.hr(), nl())
  } else {
    p(CMD.SIZE_H2)
    p(enc('가게요청 : ' + (order.note || '없음')), nl())
    p(CMD.SIZE_H1)
    p(L.hr(), nl())
  }

  // 메뉴 테이블 헤더 (3열, SIZE_NORMAL = 작은 크기)
  p(CMD.SIZE_H1, CMD.BOLD_ON)
  p(enc(padL('메뉴명', L.nameW) + padR('수량', QTY_W) + ' '.repeat(COL_SEP) + padR('가격', PRICE_W)))
  p(CMD.BOLD_OFF, nl())
  p(L.subHr(), nl())

  // 메뉴 목록
  for (const item of order.items) {
    const qtyStr   = String(item.quantity)
    const priceStr = formatWon(item.subtotal)
    const nameLines = wrapName(item.menu_name, L.nameW)
    for (let i = 0; i < nameLines.length; i++) {
      const isLast = i === nameLines.length - 1
      p(CMD.SIZE_H1, CMD.BOLD_ON)
      if (isLast) p(enc(padL(nameLines[i], L.nameW) + padR(qtyStr, QTY_W) + ' '.repeat(COL_SEP) + padR(priceStr, PRICE_W)))
      else        p(enc(padL(nameLines[i], L.nameW) + ' '.repeat(QTY_W + COL_SEP + PRICE_W)))
      p(CMD.BOLD_OFF, nl())
    }
    for (const opt of item.options) {
      const optLabel = opt.extra_price > 0
        ? `  > ${opt.option_name} (+${opt.extra_price.toLocaleString('ko-KR')}원)`
        : `  > ${opt.option_name}`
      p(optCmd, enc(clamp(optLabel, L.W)), nl())
    }
  }

  p(L.hr(), nl())

  // 금액 요약
  p(amtCmd)
  p(enc('메뉴 소계 : ' + formatWon(order.menu_subtotal)), nl())
  if (order.delivery_fee > 0) p(enc('배달료   : ' + formatWon(order.delivery_fee)), nl())
  p(CMD.SIZE_H1)
  p(L.hr(), nl())
  p(amtCmd, CMD.BOLD_ON, enc('합  계   : ' + formatWon(order.total_amount)), CMD.BOLD_OFF, CMD.SIZE_H1, nl())
  p(L.hr(), nl())

  // 잔액 — 설정에서 끌 수 있다(기본 켬)
  if (settings.showBalance !== false) {
    p(amtCmd)
    p(enc('주문전 잔액 : ' + formatWon(order.balance_before)), nl())
    p(CMD.BOLD_ON, enc('주문후 잔액 : ' + formatWon(order.balance_after)), CMD.BOLD_OFF, nl())
    if (order.balance_after < 0) p(enc('※ 잔액 부족 - 다음 충전 시 정산'), nl())
    p(CMD.SIZE_H1)
  }

  // 점주가 설정한 하단 문구
  if (settings.footerText?.trim()) {
    p(L.hr(), nl())
    p(CMD.ALIGN_CENTER, CMD.SIZE_H1)
    for (const line of settings.footerText.trim().split('\n')) p(enc(clamp(line, L.W)), nl())
    p(CMD.ALIGN_LEFT)
  }

  p(CMD.FEED_CUT)
  return Buffer.concat(chunks)
}

/** ③ 테스트 출력 */
export interface QrReceiptPayload {
  accountName: string
  manager:     string
  phone:       string
  pin:         string
  qrUrl:       string   // QR에 인코딩할 URL
  storeName:   string
  /** 매장 연락처(stores.phone) — 손님이 물어볼 곳. 안심번호도 그대로 찍는다 */
  storePhone?: string
  /**
   * QR 바로 아래 한 줄 안내 문구. 최대 15자(화면에서 자른다).
   *
   * 왜 15자인가: 한글은 인쇄 폭을 2칸 먹는다. 15자 = 30칸이라 가장 좁은 용지
   * (57mm · 32칸)에서도 **한 줄에 들어간다.** 넘치면 clamp() 가 잘라내므로
   * 두 줄로 흐르지 않는다 — QR 바로 아래 한 줄이라는 규칙이 깨지지 않게.
   */
  notice?: string
}

/**
 * QR 을 **래스터 이미지로** 그려 ESC/POS 비트이미지(GS v 0)로 내보낸다.
 *
 * 왜 프린터 내장 QR(GS ( k)을 안 쓰나:
 *   내장 QR 은 모듈 크기를 n(1~16)으로 지정하는데, **프린터가 그 상한을 지킬 의무가 없다.**
 *   BIXOLON SRP-B300II 에 n=14 를 보냈더니(바이트까지 확인했다) 출력물은 n=8 때와
 *   똑같았다 — 내부에서 잘라버린 것이다. 그래서 "모듈 크기를 키워달라"는 요청을
 *   프린터가 조용히 무시했고, 코드를 고쳐도 종이는 그대로였다.
 *
 *   래스터로 보내면 우리가 픽셀을 직접 찍으므로 **프린터 구현과 무관하게** 크기가 정해진다.
 *   미리보기(QR 이미지)와도 같은 비율로 맞출 수 있다.
 *
 * @param modules  qrcode 가 만든 정사각 비트맵(한 변 size, data[i] 가 1이면 검정)
 * @param scale    모듈 하나를 몇 도트로 찍을지
 * @param quiet    여백(모듈 단위). QR 규격 권장은 4
 */
function qrRaster(modules: { size: number; data: Uint8Array | number[] }, scale: number, quiet = 2): Buffer {
  const n = modules.size
  const sidePx = (n + quiet * 2) * scale
  // GS v 0 은 한 줄을 바이트 단위로 받는다 — 가로 픽셀을 8의 배수로 올림
  const widthBytes = Math.ceil(sidePx / 8)
  const raster = Buffer.alloc(widthBytes * sidePx, 0x00)

  for (let y = 0; y < sidePx; y++) {
    const my = Math.floor(y / scale) - quiet
    if (my < 0 || my >= n) continue
    for (let x = 0; x < sidePx; x++) {
      const mx = Math.floor(x / scale) - quiet
      if (mx < 0 || mx >= n) continue
      if (!modules.data[my * n + mx]) continue
      raster[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }

  const xL = widthBytes & 0xFF, xH = (widthBytes >> 8) & 0xFF
  const yL = sidePx & 0xFF,     yH = (sidePx >> 8) & 0xFF
  // GS v 0 m xL xH yL yH d1…dk   (m=0: 보통 크기)
  return Buffer.concat([Buffer.from([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]), raster])
}

/**
 * QR 한 변의 모듈 수 — 바이트모드 · 오류정정 M 기준.
 *
 * 숫자는 QR 규격의 버전별 용량표다. URL 이 길어지면 버전이 올라가고 모듈이 늘어난다.
 * (지금 쓰는 URL 은 `https://sallaria.web.app/qr/<uuid>` 로 64자 → 버전 5, 37모듈)
 */
function qrModulesFor(urlLen: number): number {
  if (urlLen <= 42)  return 29   // v3
  if (urlLen <= 62)  return 33   // v4
  if (urlLen <= 84)  return 37   // v5
  if (urlLen <= 106) return 41   // v6
  if (urlLen <= 122) return 45   // v7
  return 49                      // v8 이상 — 보수적으로
}

/**
 * 인쇄 폭에 맞는 래스터 배율(모듈 하나당 도트)을 **계산**한다.
 *
 * 전엔 용지 프리셋에 8(57mm)·11(79mm) 로 박아뒀다. 그 값이 보수적이라 79mm 종이에
 * 37mm 짜리 QR 이 찍혔다 — 인쇄 폭(72mm)의 절반이다. 실물로 확인했다(2026-10-22).
 *
 * 박아두면 URL 이 길어져 버전이 올라갈 때 QR 이 종이를 넘어가는 것도 못 막는다.
 * 폭이 모자라면 프린터가 QR 을 **아예 안 찍는다** — 빈 자리만 남는다.
 * 그래서 "URL 길이 → 모듈 수 → 들어갈 수 있는 최대 크기" 로 매번 구한다.
 *
 * +4 는 여백(한 변에 2모듈) — qrRaster 의 quiet 기본값과 같은 값이라야 한다.
 * QR 규격은 4모듈을 권하지만 용지 좌우 여백이 이미 있어서(79mm 종이에 인쇄 폭 72mm)
 * 2모듈이면 스캔에 지장이 없다.
 *
 * 상한을 16 으로 묶지 않는다 — 그건 프린터 내장 QR 명령(n)의 한계였고, 래스터에는
 * 해당이 없다. 대신 인쇄 폭이 진짜 상한이다.
 */
/**
 * 인쇄 폭의 몇 %를 QR 에 내줄지.
 *
 * 1.0 이면 폭을 꽉 채운다. 꽉 채워 뽑아보니 QR 이 종이 양끝에 닿을 듯해 답답했고,
 * 감열지는 좌우로 약간 흔들리며 밀려 나와서 가장자리가 치우쳐 보인다.
 *
 * 실물을 보며 두 번 줄였다: 1.0 → 0.9 → 0.72.
 * (79mm 기준 71.8mm → 61.5mm → 51.3mm)
 *
 * ⚠️ 배율은 **정수**라서(모듈 하나당 도트 수) 이 비율이 그대로 크기에 반영되지는
 *    않는다. 79mm 에서 scale 이 14 → 12 → 10 으로 한 칸씩 떨어진다.
 *    소수 배율로 보간하면 QR 모서리가 뭉개져 스캔이 안 된다.
 *
 * ⚠️ 미리보기(src/pages/QrPrintPanel.tsx 의 QR_FILL_RATIO)도 **같은 값**이다.
 *    한쪽만 고치면 화면과 종이가 다시 어긋난다.
 */
const QR_FILL_RATIO = 0.72

function fitQrModule(urlLen: number, printMM: number): number {
  const DOTS_PER_MM = 8                       // 203dpi 감열 헤드
  const dots = Math.floor(printMM * DOTS_PER_MM * QR_FILL_RATIO)
  const side = qrModulesFor(urlLen) + 4       // qrRaster(quiet = 2) 와 같은 여백
  return Math.max(1, Math.floor(dots / side))
}

/**
 * ③ 거래처 QR 영수증 — ESC/POS GS(k 명령어로 QR 직접 렌더링
 *
 * @param qrPrintMM 인쇄 가능 폭(mm). 이 폭에 맞춰 QR 크기를 계산한다.
 */
export function buildQrReceiptEscPos(p: QrReceiptPayload, lineChars?: number, qrPrintMM = 50): Buffer {
  const qrModule = fitQrModule(p.qrUrl.length, qrPrintMM)
  const L = layout(lineChars)
  const chunks: Buffer[] = []
  const push = (...bufs: Buffer[]) => chunks.push(...bufs)

  push(CMD.INIT)

  // ── 헤더 ──
  push(CMD.ALIGN_CENTER, CMD.BOLD_ON, CMD.SIZE_H2)
  push(enc(`[${p.accountName} 선결제 QR오더]`), nl())
  push(CMD.BOLD_OFF, CMD.SIZE_H1)
  push(L.hr(), nl())

  // ── QR 코드 — 래스터 비트이미지로 직접 찍는다 ──
  //
  // 프린터 내장 QR(GS ( k)은 모듈 크기 상한을 프린터가 제멋대로 자른다.
  // (SRP-B300II 는 n=14 를 보내도 n=8 로 찍었다 — qrRaster 주석 참고)
  // 여기서 비트맵을 만들어 보내면 크기가 우리 손에 있다.
  push(CMD.ALIGN_CENTER)
  const qr = QRCode.create(p.qrUrl, { errorCorrectionLevel: 'M' })
  push(qrRaster(qr.modules, qrModule))
  // QR 바로 아래 점선까지 간격은 **한 줄**. 전엔 두 줄이라 QR 과 구분선 사이가
  // 종이에서 눈에 띄게 비었다(실물 확인 2026-10-22).
  push(nl())

  // ── 안내 문구 — QR 바로 아래 한 줄 ──
  // 가운데 정렬, 점선 위. clamp 로 한 줄을 보장한다(15자 제한은 화면에서 걸지만,
  // 옛 설정값이나 다른 호출부가 긴 문구를 보낼 수도 있다).
  const notice = p.notice?.trim()
  if (notice) {
    push(CMD.ALIGN_CENTER, enc(clamp(notice, L.W)), nl())
  }

  // ── 정보 ──
  push(CMD.ALIGN_LEFT, L.hr(), nl())
  push(CMD.SIZE_H2)

  const row = (label: string, value: string) => {
    const LW = 6  // 라벨 인쇄폭
    push(enc(padL(label, LW) + '  ' + value), nl())
  }
  row('계정',   p.accountName)
  if (p.manager) row('관리자', p.manager)
  if (p.phone)   row('연락처', p.phone)

  // PIN 은 **값을 찍지 않는다.**
  //
  // 이 종이는 사무실 벽에 붙는다. PIN 이 적혀 있으면 지나가는 누구나 그 거래처
  // 잔액으로 주문할 수 있다 — QR 과 PIN 이 한 장에 같이 있으면 PIN 이 있으나 마나다.
  // (호출부도 pin: '' 로 보내고 있었는데, 그러면 "PIN" 라벨만 덩그러니 찍혔다.)
  row('PIN', '관리자에게 문의')

  push(CMD.SIZE_H1, L.hr(), nl())

  // ── 푸터 — 매장 이름과 연락처 ──
  // 손님이 이 종이를 보고 물어볼 곳이 있어야 한다. 전엔 매장 이름만 있었다.
  //
  // 대표자 이름은 찍지 않는다. 이 종이는 거래처 사무실 벽에 붙는데, 거기서
  // 필요한 건 "어디에 물어보나"(매장 이름·전화)지 대표자 개인 이름이 아니다.
  push(CMD.ALIGN_CENTER, CMD.SIZE_H2)
  push(enc(p.storeName), nl())
  push(CMD.SIZE_H1)
  if (p.storePhone) push(enc(p.storePhone), nl())
  push(CMD.FEED_CUT)

  return Buffer.concat(chunks)
}

export function buildTestReceiptEscPos(lineChars?: number): Buffer {
  const L = layout(lineChars)
  const chunks: Buffer[] = []
  const p = (...bufs: Buffer[]) => chunks.push(...bufs)
  const now = new Date().toLocaleString('ko-KR')

  p(CMD.INIT)
  p(CMD.ALIGN_CENTER, CMD.SIZE_H2, CMD.BOLD_ON)
  p(enc('=== 테스트 출력 ==='), nl())
  p(enc('샐러리아 침산점 POS'), nl())
  p(CMD.BOLD_OFF, CMD.SIZE_H1, CMD.ALIGN_LEFT)
  p(L.hr(), nl())
  p(CMD.SIZE_H2)
  p(enc('프린터 상태 : 정상'), nl())
  p(enc(now), nl())
  p(CMD.SIZE_H1)
  p(L.hr(), nl())
  p(CMD.FEED_CUT)

  return Buffer.concat(chunks)
}
