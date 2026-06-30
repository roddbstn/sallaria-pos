/**
 * printer.ts — OS 프린트 API 기반 영수증 빌더
 *
 * SerialPort/ESC-POS 방식 대신 Electron webContents.print() 사용.
 * 프린터가 Windows에 드라이버로 등록돼 있으면 무조건 동작.
 */

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface PrinterSettings {
  portName: string   // COM 포트 이름 (예: "COM1")
}

export interface ReceiptSettings {
  menuSize:           'small' | 'normal' | 'large'
  optionSize:         'small' | 'normal' | 'large'
  customerMenuSize:   'small' | 'normal' | 'large'
  customerOptionSize: 'small' | 'normal' | 'large'
}

export interface OrderItem {
  menu_name:  string
  quantity:   number
  unit_price: number
  subtotal:   number
  options:    { option_name: string; extra_price: number }[]
}

export interface OrderPayload {
  order_code:     string
  order_number?:  string
  account_name:   string
  orderer_name:   string
  method:         string
  ordered_at:     string
  items:          OrderItem[]
  menu_subtotal:  number
  delivery_fee:   number
  total_amount:   number
  balance_before: number
  balance_after:  number
  note?:          string | null
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function formatWon(n: number): string {
  return n.toLocaleString('ko-KR') + '원'
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

const MENU_PT:   Record<'small'|'normal'|'large', string> = { small: '8pt',  normal: '10pt', large: '12pt' }
const OPTION_PT: Record<'small'|'normal'|'large', string> = { small: '7pt',  normal: '8pt',  large: '10pt' }

const BASE_STYLE = `
  @page { size: 58mm auto; margin: 2mm 3mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', 'Courier New', monospace;
    font-size: 8pt;
    width: 52mm;
    color: #000;
    word-break: keep-all;
  }
  .c  { text-align: center; }
  .b  { font-weight: bold; }
  .hr { border: none; border-top: 1px dashed #000; margin: 2px 0; }
  .row { display: flex; justify-content: space-between; gap: 4px; }
  .row .r { white-space: nowrap; flex-shrink: 0; }
  .opt { padding-left: 8px; color: #333; }
`

// ── HTML 영수증 빌더 ──────────────────────────────────────────────────────────

/** ① 주방용 (가격 없음) */
export function buildKitchenReceiptHtml(order: OrderPayload, settings: ReceiptSettings): string {
  const menuPt = MENU_PT[settings.menuSize]
  const optPt  = OPTION_PT[settings.optionSize]

  const itemRows = order.items.map(item => `
    <div class="row b" style="font-size:${menuPt}">
      <span>${item.menu_name}</span>
      <span class="r">${item.quantity}</span>
    </div>
    ${item.options.map(o => `<div class="opt" style="font-size:${optPt}">▶ ${o.option_name}</div>`).join('')}
  `).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>${BASE_STYLE}</style></head><body>
  <div class="c b">[주방용]</div>
  <div class="c">샐러리아 침산점</div>
  <hr class="hr">
  <div>주문번호: ${order.order_number ?? order.order_code}</div>
  <div>거래처: ${order.account_name}</div>
  <div>주문자: ${order.orderer_name}</div>
  <div>이용방법: ${order.method}</div>
  <div>주문일시: ${formatDate(order.ordered_at)}</div>
  <hr class="hr">
  <div class="row b"><span>메뉴명</span><span class="r">수량</span></div>
  <hr class="hr">
  ${itemRows}
  <hr class="hr">
  <div>${order.note ? `비고: ${order.note}` : '비고: (없음)'}</div>
</body></html>`
}

/** ② 고객용 (잔액·합계 포함) */
export function buildCustomerReceiptHtml(order: OrderPayload, settings: ReceiptSettings): string {
  const menuPt = MENU_PT[settings.customerMenuSize]
  const optPt  = OPTION_PT[settings.customerOptionSize]

  const itemRows = order.items.map(item => `
    <div class="row b" style="font-size:${menuPt}">
      <span>${item.menu_name} ×${item.quantity}</span>
      <span class="r">${formatWon(item.subtotal)}</span>
    </div>
    ${item.options.map(o => `
      <div class="opt" style="font-size:${optPt}">
        ▶ ${o.option_name}${o.extra_price > 0 ? ` +${o.extra_price.toLocaleString('ko-KR')}원` : ''}
      </div>`).join('')}
  `).join('')

  const balanceWarning = order.balance_after < 0
    ? `<div style="margin-top:3px;font-size:7pt;">※ 잔액 부족 — 다음 충전 시 정산</div>`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>${BASE_STYLE}</style></head><body>
  <div class="c b">샐러리아 침산점</div>
  <hr class="hr">
  <div>주문번호: ${order.order_number ?? order.order_code}</div>
  <div>거래처: ${order.account_name}</div>
  <div>주문자: ${order.orderer_name}</div>
  <div>이용방법: ${order.method}</div>
  <div>주문일시: ${formatDate(order.ordered_at)}</div>
  <hr class="hr">
  ${itemRows}
  <hr class="hr">
  <div class="row"><span>메뉴 소계</span><span class="r">${formatWon(order.menu_subtotal)}</span></div>
  ${order.delivery_fee > 0 ? `<div class="row"><span>배달료</span><span class="r">${formatWon(order.delivery_fee)}</span></div>` : ''}
  <div class="row b"><span>합  계</span><span class="r">${formatWon(order.total_amount)}</span></div>
  <hr class="hr">
  <div class="row"><span>주문 전 잔액</span><span class="r">${formatWon(order.balance_before)}</span></div>
  <div class="row b"><span>주문 후 잔액</span><span class="r">${formatWon(order.balance_after)}</span></div>
  ${balanceWarning}
</body></html>`
}

/** ③ 테스트 출력 */
export function buildTestReceiptHtml(): string {
  const now = new Date().toLocaleString('ko-KR')
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>${BASE_STYLE}</style></head><body>
  <div class="c b">=== 테스트 출력 ===</div>
  <div class="c">샐러리아 침산점 POS</div>
  <hr class="hr">
  <div>프린터 연결 상태: 정상</div>
  <div>${now}</div>
  <hr class="hr">
</body></html>`
}
