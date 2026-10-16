// 영수증 '타입' 정의 파일.
//
// ⚠️ 실제 인쇄는 electron/escpos.ts 가 한다. 이 파일엔 한때 HTML 영수증 빌더
//    (buildKitchenReceiptHtml 등)가 있었는데, ESC/POS 직접 전송으로 갈아탄 뒤로
//    아무도 호출하지 않는 채 남아 있었다. 그 유령 때문에 "영수증을 고친다"면서
//    실제로는 인쇄되지 않는 코드를 고치는 사고가 실제로 났다(마스킹 적용 건).
//    그래서 빌더는 전부 지우고 타입만 남긴다 — 영수증 모양을 바꾸려면 escpos.ts 를 볼 것.

export interface PrinterSettings {
  portName: string   // COM 포트 이름 (예: "COM1")
}

export type ReceiptTextSize = 'small' | 'normal' | 'large'

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
