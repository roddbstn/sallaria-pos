// 영수증 프린터의 용지 넓이·연결 수단 — 화면 쪽 정의.
//
// ⚠️ 실제 출력에 쓰이는 숫자(한 줄 글자 수, QR 모듈 크기)의 **원본은
//    electron/printer.ts 의 PAPER_PRESETS** 다. 거기서 인쇄가 일어난다.
//    여기 있는 건 화면에 보여주고 미리보기 비율을 그리기 위한 것이고,
//    화면은 늘 **넓이 키('57' | '79')만 저장**한다 — 숫자를 renderer 가 계산해서
//    넘기면 두 파일이 갈라졌을 때 조용히 틀린 영수증이 나온다.
//    (web/node tsconfig 가 project reference 로 갈려 있어 한 파일을 같이 쓸 수 없다.
//     TS6307 — electron/printer.ts 를 src 에서 import 하면 빌드가 깨진다.)

export type PaperWidth  = '57' | '79'

/**
 * 예전에 저장된 용지 키 → 지금 키.
 *
 * 2026-10-22 에 '58'·'80' 을 실제 용지 치수인 '57'·'79' 로 바꿨다. 이 값은
 * **설정에 저장돼 있어서** 매핑 없이 바꾸면 기존 58mm 매장이 조회에 실패해
 * 79mm 로 튄다 — 한 줄 32자가 42자가 되어 영수증이 조용히 깨진다.
 * electron/printer.ts 의 normalizePaperWidth 와 **같은 규칙**이다.
 */
const LEGACY_PAPER_KEYS: Record<string, PaperWidth> = { '58': '57', '80': '79' }
export type PrinterLink = 'serial' | 'usb' | 'bluetooth' | 'lan'

export interface PaperChoice {
  key:       PaperWidth
  label:     string
  /** 감열지 실제 넓이(mm) */
  paperMM:   number
  /** 인쇄 가능 넓이(mm) — 좌우 여백을 뺀 값. QR 미리보기 비율에 쓴다 */
  printMM:   number
  /** 기본 한 줄 글자 수 */
  lineChars: number
  /** 미세조정 상한 — 꽉 채웠을 때의 이론치 */
  maxChars:  number
  hint:      string
}

/**
 * 조사한 시중 기기는 전부 80mm 계열이었다 —
 * 세우 TS-200KB(80mm) · SLK-TS200(80mm) · SLK-TS100(79.5mm, 인쇄 72mm) ·
 * 빅솔론 B300(3인치 72mm, Font A 48자) · 시원아이티 CPP-3100(80mm).
 * 58mm 는 카드단말 일체형·휴대용에서 쓴다.
 */
export const PAPER_CHOICES: PaperChoice[] = [
  {
    key: '79', label: '79mm', paperMM: 79, printMM: 72, lineChars: 42, maxChars: 48,
    hint: '가장 흔해요. 세우 TS-200KB · SLK-TS200 · 빅솔론 B300 · CPP-3100',
  },
  {
    key: '57', label: '57mm', paperMM: 57, printMM: 50, lineChars: 32, maxChars: 32,
    hint: '좁은 용지. 카드단말 일체형이나 휴대용 프린터',
  },
]

/**
 * 저장된 값을 보기 좋은 선택지로. 옛 키('58'·'80')도 받아준다.
 *
 * ⚠️ `?? PAPER_CHOICES[0]` 만으로 끝내면 안 된다 — 옛 키 '58' 이 조회에 실패해
 *    목록 첫 항목(79mm)으로 떨어지고, 58mm 쓰던 매장의 한 줄 글자 수가
 *    32 → 42 로 바뀌어 영수증이 깨진다.
 */
export function paperChoice(w: string | undefined): PaperChoice {
  const key = (w === '57' || w === '79') ? w : (LEGACY_PAPER_KEYS[w ?? ''] ?? '79')
  return PAPER_CHOICES.find(c => c.key === key) ?? PAPER_CHOICES[0]
}

/** 연결 수단. 시리얼·USB·블루투스는 윈도우에서 모두 COM 포트로 잡혀 통신 코드가 같다 */
export const LINK_CHOICES: { key: PrinterLink; label: string; hint: string }[] = [
  { key: 'serial',    label: '9핀 시리얼', hint: '포스기 뒤 RS232C 포트. 보율이 안 맞으면 글자가 깨져요' },
  // ⚠️ 전엔 "COM 포트로 잡혀요" 라고만 적었다. 그건 가상 COM 드라이버가 깔린
  //    윈도우에서만 맞는 말이고, 맥이나 드라이버 없는 윈도우에선 '프린터'로 등록된다.
  //    (2026-10-22 BIXOLON SRP-B300II 가 맥에서 정확히 그랬다)
  { key: 'usb',       label: 'USB',        hint: 'USB B타입 케이블. COM 포트 또는 설치된 프린터로 잡혀요' },
  { key: 'bluetooth', label: '블루투스',    hint: '동글을 꽂고 짝을 맺으면 COM 포트로 잡혀요' },
  { key: 'lan',       label: '랜선(RJ45)',  hint: 'IP로 직접 보내요. 프린터 IP가 필요해요' },
]

/** 시리얼 보율 후보 — 대부분 9600 또는 115200 */
export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const

export const DEFAULT_TCP_PORT = 9100

export interface PrinterConfig {
  portName?:   string
  paperWidth?: PaperWidth
  /** 한 줄 글자 수 직접 지정. 비우면 용지 넓이 기본값 */
  lineChars?:  number
  link?:       PrinterLink
  baudRate?:   number
  host?:       string
  tcpPort?:    number
  /** OS 에 등록된 프린터 이름 (스풀러·CUPS). USB 프린터로 보낼 때 쓴다 */
  osPrinter?:  string
}

/** 화면에 보여줄 한 줄 글자 수 (electron 의 resolveLineChars 와 같은 규칙) */
export function effectiveLineChars(c: PrinterConfig | undefined): number {
  const n = c?.lineChars
  if (typeof n === 'number' && n >= 24 && n <= 64) return Math.floor(n)
  return paperChoice(c?.paperWidth).lineChars
}

/** QR 미리보기가 쓸 인쇄 가능 넓이(mm) */
export function printableMM(c: PrinterConfig | undefined): number {
  return paperChoice(c?.paperWidth).printMM
}

/** LAN 으로 고르고도 IP 를 안 적었으면 출력이 안 된다 — 화면에서 먼저 잡아준다 */
export function configProblem(c: PrinterConfig | undefined): string | null {
  if (!c) return null
  if (c.link === 'lan') {
    const host = (c.host ?? '').trim()
    if (!host) return '랜선으로 고르셨는데 프린터 IP가 비어 있어요'
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return 'IP 형식이 아니에요 (예: 192.168.0.50)'
    return null
  }
  // 시리얼(COM) 이 아니어도 OS 프린터(USB)가 골라져 있으면 출력할 수 있다.
  // 이 줄이 없으면 USB 로 연결해 놓고도 "프린터를 아직 고르지 않았어요"가 떴다.
  if (!c.portName && !(c.osPrinter ?? '').trim()) {
    return '연결된 프린터를 아직 고르지 않았어요'
  }
  return null
}
