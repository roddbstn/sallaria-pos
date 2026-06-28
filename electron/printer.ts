/**
 * printer.ts — Sewoo SLK-TS200 ESC/POS 출력 모듈
 *
 * 출력 순서 (주문 접수 확정 시):
 *   1. buildCustomerReceipt() → 부분 컷
 *   2. buildKitchenReceipt()  → 부분 컷
 *
 * 58mm 롤지 기준 1행 = 32 컬럼 (ASCII 1byte = 1col, 한글 2byte = 2col)
 */

// serialport는 native addon — 로드 실패 시 앱은 계속 동작 (프린터만 비활성)
let SerialPort: typeof import('serialport').SerialPort | null = null
try { SerialPort = require('serialport').SerialPort } catch { SerialPort = null }
import iconv from 'iconv-lite'
import type { BrowserWindow } from 'electron'

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface PrinterSettings {
  path: string
  baudRate: number
  cutMode: 'full' | 'partial'
}

export interface ReceiptSettings {
  menuSize:           'small' | 'normal' | 'large'
  optionSize:         'small' | 'normal' | 'large'
  customerMenuSize:   'small' | 'normal' | 'large'
  customerOptionSize: 'small' | 'normal' | 'large'
}

export interface OrderItem {
  menu_name: string
  quantity:  number
  unit_price: number
  subtotal:  number
  options:   { option_name: string; extra_price: number }[]
}

export interface OrderPayload {
  order_code:    string
  order_number?: string   // 사람이 읽는 주문번호 (예: "1101")
  account_name:  string
  orderer_name:  string
  method:        string
  ordered_at:    string       // ISO 8601
  items:         OrderItem[]
  menu_subtotal: number
  delivery_fee:  number
  total_amount:  number
  balance_before: number
  balance_after:  number
  note?:          string | null
}

// ── ESC/POS 커맨드 상수 ────────────────────────────────────────────────────────

const ESC = 0x1B
const GS  = 0x1D

const CMD = {
  INIT:          Buffer.from([ESC, 0x40]),
  ALIGN_LEFT:    Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER:  Buffer.from([ESC, 0x61, 0x01]),
  BOLD_ON:       Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:      Buffer.from([ESC, 0x45, 0x00]),
  /** GS ! n — 글자 크기 (상위 4비트 = 가로배율-1, 하위 4비트 = 세로배율-1) */
  SIZE:    (n: number)  => Buffer.from([GS, 0x21, n]),
  /** ESC d n — 용지 n행 이송 */
  FEED:    (n: number)  => Buffer.from([ESC, 0x64, n]),
  /** GS V 1 부분 컷, GS V 0 완전 컷 */
  PARTIAL_CUT:   Buffer.from([GS, 0x56, 0x01]),
  FULL_CUT:      Buffer.from([GS, 0x56, 0x00]),
} as const

/**
 * POS_SYSTEM.md §8 매핑
 *  작게 0x00 → 1×1 (기본)
 *  보통 0x11 → 2×2
 *  크게 0x22 → 3×3
 */
const FONT_SIZE: Record<'small' | 'normal' | 'large', number> = {
  small:  0x00,   // 1×1  기본
  normal: 0x01,   // 1w×2h  세로만 2배 (너비 유지, 한 줄 32자)
  large:  0x11,   // 2×2  가로세로 2배
}

const LINE_WIDTH = 32   // 58mm 롤지 기준 컬럼 수

// ── 유틸 함수 ─────────────────────────────────────────────────────────────────

/** CP949 인코딩 — 한글은 2바이트, 영숫자는 1바이트 */
function enc(text: string): Buffer {
  return iconv.encode(text, 'cp949')
}

/** CP949 기준 표시 너비 (한글 = 2col) */
function displayWidth(text: string): number {
  return iconv.encode(text, 'cp949').length
}

/** LF 포함 CP949 라인 */
function line(text: string): Buffer {
  return Buffer.concat([enc(text), Buffer.from([0x0A])])
}

/** 구분선 */
function divider(): Buffer {
  return line('--------------------------------')
}

/**
 * 좌측 텍스트와 우측 텍스트를 LINE_WIDTH 컬럼에 맞게 패딩
 * 한글 너비를 고려하여 공백 수를 계산
 */
function padLR(left: string, right: string, width = LINE_WIDTH): string {
  const used   = displayWidth(left) + displayWidth(right)
  const spaces = Math.max(1, width - used)
  return left + ' '.repeat(spaces) + right
}

function formatWon(n: number): string {
  return n.toLocaleString('ko-KR') + '원'
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${yy}/${mm}/${dd} ${hh}:${mi}`
}

// ── 영수증 빌더 ───────────────────────────────────────────────────────────────

/**
 * ① 주방용 영수증 (가격 없음, 글자 크기 설정 적용)
 *
 * [주방용]
 *       샐러리아 침산점
 * --------------------------------
 * 주문번호: ORD-001
 * 이용방법: 포장   주문자: 홍길동
 * 주문일시: 2026/06/14 12:34
 * --------------------------------
 * 메뉴명                      수량
 * --------------------------------
 * 클래식 포케                    1
 *   ▶ 현미밥
 *   ▶ 아보카도 추가
 * --------------------------------
 * 비고: (없음)
 */
export function buildKitchenReceipt(
  order: OrderPayload,
  settings: ReceiptSettings
): Buffer {
  const bufs: Buffer[] = []
  const p = (...b: Buffer[]) => bufs.push(...b)

  const menuSz = FONT_SIZE[settings.menuSize]
  const optSz  = FONT_SIZE[settings.optionSize]

  p(CMD.INIT, CMD.FEED(1))

  // 헤더
  p(CMD.ALIGN_CENTER, CMD.BOLD_ON)
  p(line('[주방용]'))
  p(CMD.BOLD_OFF)
  p(line('      샐러리아 침산점'))
  p(CMD.ALIGN_LEFT)
  p(divider())

  // 주문 정보
  p(line(`주문번호: ${order.order_number ?? order.order_code}`))
  p(line(`거래처:   ${order.account_name}`))
  p(line(`주문자:   ${order.orderer_name}`))
  p(line(`이용방법: ${order.method}`))
  p(line(`주문일시: ${formatDate(order.ordered_at)}`))
  p(divider())

  // 컬럼 헤더
  p(CMD.BOLD_ON)
  p(line(padLR('메뉴명', '수량')))
  p(CMD.BOLD_OFF)
  p(divider())

  // 메뉴 목록
  for (const item of order.items) {
    // 메뉴명 + 수량 (설정 글자 크기)
    p(CMD.SIZE(menuSz), CMD.BOLD_ON)
    p(line(padLR(item.menu_name, `${item.quantity}`)))
    p(CMD.BOLD_OFF, CMD.SIZE(0x00))

    // 옵션 (설정 글자 크기)
    p(CMD.SIZE(optSz))
    for (const opt of item.options) {
      p(line(`  \u25ba ${opt.option_name}`))
    }
    p(CMD.SIZE(0x00))
  }

  p(divider())

  // 비고
  p(line(order.note ? `비고: ${order.note}` : '비고: (없음)'))

  // 여백 + 컷
  p(CMD.FEED(4))
  p(CMD.PARTIAL_CUT)

  return Buffer.concat(bufs)
}

/**
 * ② 고객용 영수증 (잔액·합계 포함)
 *
 *       샐러리아 침산점
 * --------------------------------
 * 주문번호: ORD-001
 * 거래처:   공원녹지과
 * 주문자:   홍길동
 * 이용방법: 포장
 * 주문일시: 2026/06/14 12:34
 * --------------------------------
 * 클래식 포케 ×1       11,500원
 *   ▶ 아보카도 추가   +1,500원
 * --------------------------------
 * 메뉴 소계            11,500원
 * 합 계                11,500원
 * --------------------------------
 * 주문 전 잔액        223,400원
 * 주문 후 잔액        211,900원
 */
export function buildCustomerReceipt(order: OrderPayload, settings?: ReceiptSettings): Buffer {
  const bufs: Buffer[] = []
  const p = (...b: Buffer[]) => bufs.push(...b)

  const menuSz = FONT_SIZE[settings?.customerMenuSize   ?? 'small']
  const optSz  = FONT_SIZE[settings?.customerOptionSize ?? 'small']

  p(CMD.INIT, CMD.FEED(1))

  // 헤더
  p(CMD.ALIGN_CENTER, CMD.BOLD_ON)
  p(line('샐러리아 침산점'))
  p(CMD.BOLD_OFF)
  p(CMD.ALIGN_LEFT)
  p(divider())

  // 주문 기본 정보
  p(line(`주문번호: ${order.order_number ?? order.order_code}`))
  p(line(`거래처:   ${order.account_name}`))
  p(line(`주문자:   ${order.orderer_name}`))
  p(line(`이용방법: ${order.method}`))
  p(line(`주문일시: ${formatDate(order.ordered_at)}`))
  p(divider())

  // 메뉴 목록 (단가 + 옵션 추가가격)
  for (const item of order.items) {
    p(CMD.SIZE(menuSz), CMD.BOLD_ON)
    p(line(padLR(`${item.menu_name} \xd7${item.quantity}`, formatWon(item.subtotal))))
    p(CMD.BOLD_OFF, CMD.SIZE(0x00))
    p(CMD.SIZE(optSz))
    for (const opt of item.options) {
      const optLabel = opt.extra_price > 0
        ? `  \u25ba ${opt.option_name}   +${opt.extra_price.toLocaleString('ko-KR')}원`
        : `  \u25ba ${opt.option_name}`
      p(line(optLabel))
    }
    p(CMD.SIZE(0x00))
  }

  p(divider())

  // 금액 요약
  p(line(padLR('메뉴 소계', formatWon(order.menu_subtotal))))
  if (order.delivery_fee > 0) {
    p(line(padLR('배달료', formatWon(order.delivery_fee))))
  }
  p(CMD.BOLD_ON)
  p(line(padLR('합  계', formatWon(order.total_amount))))
  p(CMD.BOLD_OFF)
  p(divider())

  // 잔액
  p(line(padLR('주문 전 잔액', formatWon(order.balance_before))))
  p(CMD.BOLD_ON)
  p(line(padLR('주문 후 잔액', formatWon(order.balance_after))))
  p(CMD.BOLD_OFF)

  if (order.balance_after < 0) {
    p(line(''))
    p(line('※ 잔액 부족 — 다음 충전 시 정산'))
  }

  p(CMD.FEED(4))
  p(CMD.PARTIAL_CUT)

  return Buffer.concat(bufs)
}

/** 테스트 출력 */
export function buildTestReceipt(): Buffer {
  const bufs: Buffer[] = []
  const p = (...b: Buffer[]) => bufs.push(...b)

  p(CMD.INIT, CMD.FEED(1))
  p(CMD.ALIGN_CENTER, CMD.BOLD_ON)
  p(line('=== 테스트 출력 ==='))
  p(CMD.BOLD_OFF)
  p(line('샐러리아 침산점 POS'))
  p(CMD.ALIGN_LEFT)
  p(divider())
  p(line('프린터 연결 상태: 정상'))
  p(line(new Date().toLocaleString('ko-KR')))
  p(CMD.FEED(4))
  p(CMD.PARTIAL_CUT)

  return Buffer.concat(bufs)
}

// ── 인쇄 큐 ──────────────────────────────────────────────────────────────────

/**
 * PrintQueue
 * - 프린터 오프라인 중에는 큐에 적재 → 재연결 시 순차 소진
 * - 동시 write 방지 (busy 플래그)
 */
export class PrintQueue {
  private queue:  Buffer[]    = []
  private port:   SerialPort | null = null
  private busy    = false
  private win:    BrowserWindow | null = null

  setWindow(w: BrowserWindow | null): void {
    this.win = w
  }

  // ── 포트 열기/닫기 ───────────────────────────────────────────────────────

  async open(settings: PrinterSettings): Promise<void> {
    if (this.port?.isOpen) {
      await this.close()
    }

    if (!SerialPort) throw new Error('프린터 모듈을 로드할 수 없습니다.')
    this.port = new SerialPort({
      path:     settings.path,
      baudRate: settings.baudRate,
      autoOpen: false,
    })

    // 예기치 않은 끊김 감지
    this.port.on('close', () => {
      console.log('[Printer] 포트 닫힘')
      this._notify()
    })
    this.port.on('error', (err) => {
      console.error('[Printer] 포트 오류:', err.message)
      this._notify()
    })

    await new Promise<void>((resolve, reject) => {
      this.port!.open(err => (err ? reject(err) : resolve()))
    })

    console.log(`[Printer] 포트 열림: ${settings.path} @ ${settings.baudRate}`)
    this._notify()
    this._flush()    // 오프라인 중 쌓인 큐 즉시 소진
  }

  async close(): Promise<void> {
    if (this.port?.isOpen) {
      await new Promise<void>(resolve => this.port!.close(() => resolve()))
    }
    this.port = null
    this._notify()
  }

  // ── 큐 조작 ──────────────────────────────────────────────────────────────

  enqueue(data: Buffer): void {
    this.queue.push(data)
    console.log(`[PrintQueue] 작업 추가 — 대기 ${this.queue.length}건`)
    this._flush()
  }

  get connected(): boolean   { return this.port?.isOpen ?? false }
  get queueLength(): number  { return this.queue.length }

  // ── 내부 ─────────────────────────────────────────────────────────────────

  private _flush(): void {
    if (this.busy || !this.port?.isOpen || this.queue.length === 0) return
    this.busy = true
    const job = this.queue.shift()!

    this.port.write(job, (writeErr) => {
      if (writeErr) {
        console.error('[Printer] write 오류:', writeErr)
        this.queue.unshift(job)   // 실패 시 다시 앞에 삽입
        this.busy = false
        this._notify()
        return
      }

      // drain: 버퍼가 하드웨어에 모두 전달될 때까지 대기
      this.port!.drain((drainErr) => {
        if (drainErr) console.error('[Printer] drain 오류:', drainErr)
        this.busy = false
        this._notify()
        this._flush()   // 다음 작업
      })
    })

    this._notify()
  }

  private _notify(): void {
    this.win?.webContents.send('printer:status', {
      connected:   this.connected,
      queueLength: this.queueLength,
    })
  }
}
