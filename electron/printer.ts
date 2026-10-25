// 영수증 '타입' 정의 파일.
//
// ⚠️ 실제 인쇄는 electron/escpos.ts 가 한다. 이 파일엔 한때 HTML 영수증 빌더
//    (buildKitchenReceiptHtml 등)가 있었는데, ESC/POS 직접 전송으로 갈아탄 뒤로
//    아무도 호출하지 않는 채 남아 있었다. 그 유령 때문에 "영수증을 고친다"면서
//    실제로는 인쇄되지 않는 코드를 고치는 사고가 실제로 났다(마스킹 적용 건).
//    그래서 빌더는 전부 지우고 타입만 남긴다 — 영수증 모양을 바꾸려면 escpos.ts 를 볼 것.

// ── 용지 넓이 ────────────────────────────────────────────────────────────────────
//
// 시중 영수증 프린터는 사실상 두 종류다. 조사한 기기(세우 TS-200KB·SLK-TS200·
// SLK-TS100, 빅솔론 B300, 시원아이티 CPP-3100)는 전부 80mm 계열이고,
// 작은 카드단말 일체형이 58mm 를 쓴다.
//
// ⚠️ 중요한 건 '용지폭'이 아니라 **한 줄에 들어가는 글자 수**다. 영수증 레이아웃은
//    칼럼을 글자 수로 맞추기 때문에, 이 숫자가 틀리면 구분선이 넘치거나 짧아지고
//    메뉴 표의 가격 칼럼이 밀린다. 그래서 프리셋이 글자 수를 같이 들고 다닌다.
//
// lineChars 는 **여유를 둔 안전값**이다. 빅솔론 B300 스펙시트는 Font A 48자로
// 적어 두지만, 실제로 48자를 꽉 채우면 기기·여백 설정에 따라 마지막 글자가 잘리는
// 일이 있다. 침산점 실측값이 42자였고 그게 지금까지 멀쩡히 돌았다 — 그래서 80mm
// 기본값은 42자로 두고, 꽉 채우고 싶은 점주는 maxChars 까지 직접 올리게 한다.

export type PaperWidth = '57' | '79'

/**
 * 예전에 저장된 용지 키 → 지금 키.
 *
 * 2026-10-22 에 '58'·'80' 을 실제 용지 치수인 '57'·'79' 로 바꿨다. 이 값은
 * **설정에 저장돼 있어서**, 매핑 없이 바꾸면 기존에 58mm 로 쓰던 매장이
 * 조회에 실패해 79mm 기본값으로 튄다 — 한 줄 32자가 42자로 늘어나
 * 영수증이 조용히 깨진다. 그래서 옛 키를 받아준다.
 */
const LEGACY_PAPER_KEYS: Record<string, PaperWidth> = { '58': '57', '80': '79' }

/** 저장된 값(옛 키 포함)을 현재 키로 정규화. 모르는 값은 79mm */
export function normalizePaperWidth(w: string | undefined): PaperWidth {
  if (w === '57' || w === '79') return w
  return LEGACY_PAPER_KEYS[w ?? ''] ?? '79'
}

export interface PaperPreset {
  width:     PaperWidth
  label:     string
  /** 감열지 실제 넓이(mm) */
  paperMM:   number
  /** 인쇄 가능 넓이(mm) — 좌우 여백을 뺀 값 */
  printMM:   number
  /** 기본 한 줄 글자 수 (1배 폭 Font A 기준, 여유 포함) */
  lineChars: number
  /** 꽉 채웠을 때의 이론치 — 미세조정 상한 */
  maxChars:  number
  /** ESC/POS QR 모듈 크기 (GS ( k 의 n). 폭이 넓으면 QR도 키울 수 있다 */
  qrModule:  number
}

// printMM·lineChars·maxChars·qrModule 은 **용지가 아니라 인쇄 헤드**가 정하는 값이라
// 용지 치수를 79/57 로 고쳐도 그대로 둔다. 3인치 헤드는 용지가 79든 80이든 72mm 를 찍는다.
export const PAPER_PRESETS: Record<PaperWidth, PaperPreset> = {
  '57': { width: '57', label: '57mm', paperMM: 57, printMM: 50, lineChars: 32, maxChars: 32, qrModule: 8  },
  '79': { width: '79', label: '79mm', paperMM: 79, printMM: 72, lineChars: 42, maxChars: 48, qrModule: 11 },
}

// ── 연결 수단 ─────────────────────────────────────────────────────────────────
//
// 조사한 기기의 포트는 9핀 시리얼(RS232C) · USB(B타입) · RJ45(LAN) · 블루투스 넷이다.
// 이 중 앞의 셋 중 **시리얼·USB·블루투스는 윈도우에서 모두 COM 포트로 잡힌다**
// (USB는 USB-시리얼 변환, 블루투스는 SPP 가상 COM). 그래서 통신 코드는 하나다.
// LAN 만 COM 이 아니라 TCP 9100 소켓이라 경로가 다르다.
export type PrinterLink = 'serial' | 'usb' | 'bluetooth' | 'lan'

/** 시리얼 보율 후보. 안 맞으면 글자가 깨져 나온다 — 대부분 9600 또는 115200 */
export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const

/** LAN 영수증 프린터의 사실상 표준 포트 */
export const DEFAULT_TCP_PORT = 9100

export interface PrinterSettings {
  portName: string   // COM 포트 이름 (예: "COM1")
  /** 용지폭 프리셋. 없으면 80mm 로 본다 (기존 설치 기기가 80mm 계열) */
  paperWidth?: PaperWidth
  /** 한 줄 글자 수 직접 지정 — 프리셋 기본값을 덮어쓴다. 보정 출력으로 맞춘다 */
  lineChars?: number
  /** 어떻게 꽂혀 있는지. lan 이면 host/tcpPort 를 쓴다 */
  link?: PrinterLink
  /** 시리얼 보율. 없으면 9600 */
  baudRate?: number
  /** LAN 프린터 IP */
  host?: string
  /** LAN 프린터 포트. 없으면 9100 */
  tcpPort?: number
  /**
   * 운영체제에 등록된 프린터 이름 (Windows 스풀러 · macOS/Linux CUPS).
   *
   * 영수증 프린터를 USB 로 꽂으면 시리얼 포트가 아니라 '프린터'로 등록되는 일이 흔하다.
   * 그때는 COM 포트가 없어서 portName 으로는 보낼 수 없고, 스풀러/CUPS 에 **원시
   * ESC/POS 를 그대로** 밀어넣어야 한다. 이 값이 그 대상 이름이다.
   * (2026-10-22 맥에서 `lp -d <name> -o raw` 로 ESC/POS 출력 확인)
   */
  osPrinter?: string
}

/** 설정 → 실제 레이아웃에 쓸 한 줄 글자 수 */
export function resolveLineChars(p?: PrinterSettings): number {
  const preset = PAPER_PRESETS[normalizePaperWidth(p?.paperWidth)]
  const n = p?.lineChars
  // 24자 미만이면 메뉴 표(이름 26 + 수량 4 + 가격 10)가 성립하지 않고,
  // 64자를 넘는 영수증 프린터는 없다. 범위를 벗어난 값은 프리셋으로 되돌린다.
  if (typeof n === 'number' && n >= 24 && n <= 64) return Math.floor(n)
  return preset.lineChars
}

/** 설정 → QR 모듈 크기 */
export function resolveQrModule(p?: PrinterSettings): number {
  return PAPER_PRESETS[normalizePaperWidth(p?.paperWidth)].qrModule
}

/**
 * QR 을 앉힐 인쇄 가능 폭(mm).
 *
 * QR 크기는 더 이상 프리셋 상수(qrModule)가 아니라 **이 폭에서 계산**한다 —
 * escpos.ts 의 fitQrModule(). 박아둔 값은 79mm 종이에 절반짜리 QR 을 찍었다.
 */
export function resolveQrPrintMM(p?: PrinterSettings): number {
  return PAPER_PRESETS[normalizePaperWidth(p?.paperWidth)].printMM
}

// '작게'는 뺐다 — 감열 영수증에서 1배 높이는 읽기 어렵고, 보통/크게면 충분하다
export type ReceiptTextSize = 'normal' | 'large'

export interface ReceiptSettings {
  menuSize:           ReceiptTextSize
  optionSize:         ReceiptTextSize
  customerMenuSize:   ReceiptTextSize
  customerOptionSize: ReceiptTextSize
  /** 금액 줄(소계·배달료·합계·잔액) 크기 */
  amountSize?:        ReceiptTextSize
  /** 영수증 맨 아래 한 줄. 빈 값이면 안 찍는다 */
  footerText?:        string
  /** 선결제 잔액 2줄을 찍을지 */
  showBalance?:       boolean
}

export interface OrderItem {
  menu_name:  string
  quantity:   number
  unit_price: number
  subtotal:   number
  options:    { option_name: string; extra_price: number; group_name?: string }[]
}

export interface OrderPayload {
  order_code:        string
  order_number?:     string
  store_name?:       string
  account_name:      string
  account_type?:     string   // '과' | '기업' | '개인' | '기타'
  orderer_name:      string
  orderer_phone?:    string | null
  method:            string
  ordered_at:        string
  items:             OrderItem[]
  menu_subtotal:     number
  delivery_fee:      number
  total_amount:      number
  balance_before:    number
  balance_after:     number
  note?:             string | null   // 고객요청사항만 (파싱 후)
  delivery_address?: string | null   // 배달주소
  delivery_detail?:  string | null   // 배달상세주소
  delivery_note?:    string | null   // 배달요청사항
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────
