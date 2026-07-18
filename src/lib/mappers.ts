import { type Order, type OrderStatus } from './mock-data'

// DB method 컬럼 → UI 표시값 매핑
export const DB_METHOD_MAP: Record<string, Order['method']> = {
  '내점': '매장 식사',
  '포장': '포장',
  '배달': '배달',
}

// note 문자열에서 배달/요청 정보 파싱
export function parseNote(raw: string | null | undefined): {
  deliveryAddress: string | null
  deliveryDetail: string | null
  deliveryNote: string | null
  customerNote: string | null
} {
  if (!raw) return { deliveryAddress: null, deliveryDetail: null, deliveryNote: null, customerNote: null }
  const parts = raw.split(' / ')
  let deliveryAddress: string | null = null
  let deliveryDetail: string | null = null
  let deliveryNote: string | null = null
  const customerParts: string[] = []
  for (const part of parts) {
    if (part.startsWith('[배달주소] ')) deliveryAddress = part.slice('[배달주소] '.length)
    else if (part.startsWith('[배달상세] ')) deliveryDetail = part.slice('[배달상세] '.length)
    else if (part.startsWith('[배달요청] ')) deliveryNote = part.slice('[배달요청] '.length)
    else if (part.trim()) customerParts.push(part.trim())
  }
  return { deliveryAddress, deliveryDetail, deliveryNote, customerNote: customerParts.join(', ') || null }
}

// DB row → Order 타입 변환 (Dashboard, Orders, Customers 공용)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapOrderRow(row: any): Order {
  return {
    code:          row.order_code,
    orderNumber:   row.order_number ?? undefined,
    accountName:   row.accounts?.account_name ?? '',
    orderer:       row.orderer_name,
    phone:         row.orderer_phone ?? undefined,
    method:        (DB_METHOD_MAP[row.method] ?? row.method) as Order['method'],
    status:        row.status as OrderStatus,
    items: (row.order_items ?? []).map((item: any) => ({
      name:          item.menu_name,
      qty:           item.quantity,
      price:         item.unit_price,
      options:       (item.order_item_options ?? []).map((o: any) => o.option_name as string),
      optionDetails: (item.order_item_options ?? []).map((o: any) => ({
        name:       o.option_name,
        extraPrice: o.extra_price ?? 0,
        groupName:  o.group_name ?? undefined,
      })),
    })),
    total:         row.total_amount,
    prepMins:      0,
    createdAt:     row.ordered_at,
    remarks:       row.note ?? '',
    balanceBefore: row.balance_before ?? undefined,
    balanceAfter:  row.balance_after  ?? undefined,
    isDeleted:     row.is_deleted ?? false,
  }
}
