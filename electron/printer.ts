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
  options:    { option_name: string; extra_price: number; group_name?: string }[]
}

export interface OrderPayload {
  order_code:        string
  order_number?:     string
  account_name:      string
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

// ── 옵션 가격 포맷 ────────────────────────────────────────────────────────────

/** 옵션 1줄: 이름 + extra_price > 0이면 "+N원" 표시 */
function optPriceStr(extraPrice: number): string {
  return extraPrice > 0 ? ` +${extraPrice.toLocaleString('ko-KR')}원` : ''
}

// ── HTML 영수증 빌더 ──────────────────────────────────────────────────────────

/** ① 주방용 (가격 없음) */
export function buildKitchenReceiptHtml(order: OrderPayload, settings: ReceiptSettings): string {
  const menuPt = MENU_PT[settings.menuSize]
  const optPt  = OPTION_PT[settings.optionSize]

  const itemCells = order.items.map(item => `
    <span style="font-size:${menuPt};font-weight:bold">${item.menu_name}</span>
    <span style="font-size:${menuPt};font-weight:bold;text-align:right">${item.quantity}</span>
    ${item.options.map(o =>
      `<div class="opt" style="font-size:${optPt};grid-column:1/-1">&gt; ${o.option_name}${optPriceStr(o.extra_price)}</div>`
    ).join('')}
  `).join('')

  const deliveryBlock = order.delivery_address ? `
    <div>배달주소 : ${order.delivery_address}</div>
    ${order.delivery_detail ? `<div>배달상세 : ${order.delivery_detail}</div>` : ''}
    <div>가게요청 : ${order.note || '없음'}</div>
    <div>배달요청 : ${order.delivery_note || '없음'}</div>
    <hr class="hr">
  ` : `
    <div>가게요청 : ${order.note || '없음'}</div>
    <hr class="hr">
  `

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>${BASE_STYLE}
.sub-hr { border:none; border-top:1px dotted #000; margin:2px 0; }
.menu-row { display:grid; grid-template-columns:1fr auto; gap:4px; }
</style></head><body>
  <div class="c b">[주방용]</div>
  <div class="c">샐러리아 침산점 - 선결제 영수증</div>
  <hr class="hr">
  <div>주문번호 : <b>${order.order_number ?? order.order_code}</b></div>
  <div>주문일시 : ${formatDate(order.ordered_at)}</div>
  <hr class="hr">
  <div>이용방법 : <b>${order.method}</b></div>
  <div>주문자   : ${order.orderer_name}</div>
  <div>전화번호 : ${order.orderer_phone || '없음'}</div>
  <hr class="hr">
  ${deliveryBlock}
  <div style="display:grid;grid-template-columns:1fr auto;gap:4px">
    <span style="font-weight:bold">메뉴명</span>
    <span style="font-weight:bold;text-align:right">수량</span>
    <div style="grid-column:1/-1"><hr class="sub-hr"></div>
    ${itemCells}
  </div>
  <hr class="hr">
</body></html>`
}

/** ② 고객용 (잔액·합계 포함) */
export function buildCustomerReceiptHtml(order: OrderPayload, settings: ReceiptSettings): string {
  const menuPt = MENU_PT[settings.customerMenuSize]
  const optPt  = OPTION_PT[settings.customerOptionSize]

  const itemCells = order.items.map(item => `
    <span style="font-size:${menuPt};font-weight:bold">${item.menu_name}</span>
    <span style="font-size:${menuPt};font-weight:bold;text-align:right">${item.quantity}</span>
    <span style="font-size:${menuPt};font-weight:bold;text-align:right">${formatWon(item.subtotal)}</span>
    ${item.options.map(o => `
      <div class="opt" style="font-size:${optPt};grid-column:1/3">&gt; ${o.option_name}</div>
      <div style="font-size:${optPt};text-align:right;white-space:nowrap">${o.extra_price > 0 ? `+${o.extra_price.toLocaleString('ko-KR')}원` : ''}</div>`
    ).join('')}
  `).join('')

  const deliveryBlock = order.delivery_address ? `
    <div>배달주소 : ${order.delivery_address}</div>
    ${order.delivery_detail ? `<div>배달상세 : ${order.delivery_detail}</div>` : ''}
    <div>가게요청 : ${order.note || '없음'}</div>
    <div>배달요청 : ${order.delivery_note || '없음'}</div>
    <hr class="hr">
  ` : `
    <div>가게요청 : ${order.note || '없음'}</div>
    <hr class="hr">
  `

  const balanceWarning = order.balance_after < 0
    ? `<div style="font-size:7pt">※ 잔액 부족 — 다음 충전 시 정산</div>` : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>${BASE_STYLE}
.sub-hr { border:none; border-top:1px dotted #000; margin:2px 0; }
</style></head><body>
  <div class="c b">[고객용]</div>
  <div class="c">샐러리아 침산점 - 선결제 영수증</div>
  <hr class="hr">
  <div>주문번호 : <b>${order.order_number ?? order.order_code}</b></div>
  <div>주문일시 : ${formatDate(order.ordered_at)}</div>
  <hr class="hr">
  <div>이용방법 : <b>${order.method}</b></div>
  <div>주문자   : ${order.orderer_name}</div>
  <div>전화번호 : ${order.orderer_phone || '없음'}</div>
  <hr class="hr">
  ${deliveryBlock}
  <div style="display:grid;grid-template-columns:1fr auto auto;gap:4px">
    <span style="font-weight:bold">메뉴명</span>
    <span style="font-weight:bold;text-align:right">수량</span>
    <span style="font-weight:bold;text-align:right">가격</span>
    <div style="grid-column:1/-1"><hr class="sub-hr"></div>
    ${itemCells}
  </div>
  <hr class="hr">
  <div class="row"><span>메뉴 소계</span><span class="r">${formatWon(order.menu_subtotal)}</span></div>
  ${order.delivery_fee > 0 ? `<div class="row"><span>배달료</span><span class="r">${formatWon(order.delivery_fee)}</span></div>` : ''}
  <hr class="hr">
  <div class="row b"><span>합  계</span><span class="r">${formatWon(order.total_amount)}</span></div>
  <hr class="hr">
  <div class="row"><span>주문전 잔액</span><span class="r">${formatWon(order.balance_before)}</span></div>
  <div class="row b"><span>주문후 잔액</span><span class="r">${formatWon(order.balance_after)}</span></div>
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
