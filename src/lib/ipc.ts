// Renderer에서 window.api 타입 안전하게 사용하는 헬퍼

import type { Order } from './mock-data'

function parseNote(raw: string | null | undefined): {
  deliveryAddress: string | null
  deliveryNote: string | null
  customerNote: string | null
} {
  if (!raw) return { deliveryAddress: null, deliveryNote: null, customerNote: null }
  const parts = raw.split(' / ')
  let deliveryAddress: string | null = null
  let deliveryNote: string | null = null
  const customerParts: string[] = []
  for (const part of parts) {
    if (part.startsWith('[배달주소] ')) {
      deliveryAddress = part.slice('[배달주소] '.length)
    } else if (part.startsWith('[배달요청] ')) {
      deliveryNote = part.slice('[배달요청] '.length)
    } else if (part.trim()) {
      customerParts.push(part.trim())
    }
  }
  return { deliveryAddress, deliveryNote, customerNote: customerParts.join(', ') || null }
}

type API = typeof import('../../../electron/preload').PosAPI extends infer T ? T : never

export const api: API = (window as unknown as { api: API }).api

export const won = (n: number) =>
  n.toLocaleString('ko-KR') + '원'

export const formatDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

/**
 * 렌더러의 Order 타입 → 프린터 IPC로 전달할 OrderPayload 형태로 변환
 * (mock-data Order.items.options 는 string[] 이라 extra_price = 0 처리)
 */
export function orderToPayload(o: Order) {
  const deliveryFee = o.method === '배달' ? 3500 : 0
  const { deliveryAddress, deliveryNote, customerNote } = parseNote(o.remarks)
  return {
    order_code:       o.code,
    order_number:     o.orderNumber,
    account_name:     o.accountName,
    orderer_name:     o.orderer,
    method:           o.method,
    ordered_at:       o.createdAt,
    items: o.items.map(item => ({
      menu_name:   item.name,
      quantity:    item.qty,
      unit_price:  item.price,
      subtotal:    item.price * item.qty,
      options:     item.options.map(name => ({ option_name: name, extra_price: 0 })),
    })),
    menu_subtotal:    o.total - deliveryFee,
    delivery_fee:     deliveryFee,
    total_amount:     o.total,
    balance_before:   o.balanceBefore ?? 0,
    balance_after:    o.balanceAfter  ?? 0,
    note:             customerNote,
    delivery_address: deliveryAddress,
    delivery_note:    deliveryNote,
  }
}
