import { type Order, type OrderStatus, type MenuDetail, type OptionGroup, type OptionItem } from './mock-data'

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

// DB row → Order 타입 변환 (Dashboard, Orders, Customers, IPC 공용)
// group_name: SELECT에 따라 flat 컬럼(o.group_name) 또는 join(option_items.option_groups.name) 둘 다 처리
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapOrderRow(row: any): Order {
  return {
    code:          row.order_code,
    orderNumber:   row.order_number ?? undefined,
    accountName:   row.accounts?.account_name ?? '',
    accountType:   row.accounts?.account_type ?? undefined,
    orderer:       row.orderer_name,
    phone:         row.orderer_phone ?? undefined,
    method:        (DB_METHOD_MAP[row.method] ?? row.method) as Order['method'],
    status:        row.status as OrderStatus,
    items: (row.order_items ?? []).map((item: any) => ({
      name:          item.menu_name,
      qty:           item.quantity,
      price:         item.unit_price,
      imageUrl:      item.menus?.image_url ?? undefined,
      // 수량 버튼으로 2개 이상 담은 옵션은 "발사믹 소스 ×2"로 표시 (order_item_options.quantity)
      options:       (item.order_item_options ?? []).map((o: any) => (o.quantity && o.quantity > 1 ? `${o.option_name} ×${o.quantity}` : o.option_name) as string),
      optionDetails: (item.order_item_options ?? []).map((o: any) => ({
        name:       o.option_name,
        extraPrice: o.extra_price ?? 0,
        // flat group_name (view) 또는 join 경로(option_items.option_groups.name) 모두 지원
        groupName:  o.group_name || o.option_items?.option_groups?.name || undefined,
      })),
    })),
    menuSubtotal:  row.menu_subtotal ?? undefined,
    deliveryFee:   row.delivery_fee  ?? undefined,
    total:         row.total_amount,
    prepMins:      row.prep_minutes ?? 0,
    acceptedAt:    row.accepted_at ?? undefined,
    requestedPickupMinutes: row.requested_pickup_minutes ?? undefined,
    createdAt:     row.ordered_at,
    remarks:       row.note ?? '',
    balanceBefore: row.balance_before ?? undefined,
    balanceAfter:  row.balance_after  ?? undefined,
    isDeleted:     row.is_deleted ?? false,
    deliveryDepartedAt: row.delivery_departed_at ?? undefined,
  }
}

// DB menus row(+menu_option_groups 조인) → MenuDetail 변환.
// Menus.tsx(관리자 메뉴 수정)와 VerbalOrderModal.tsx(구두주문 메뉴 선택)가 공용으로 씀.
// excludeHiddenOptions: 구두주문처럼 고객 노출용으로 쓸 땐 숨김 옵션을 빼고,
// 관리자 편집 화면처럼 숨김 옵션도 보여줘서 다시 노출시킬 수 있어야 하는 곳은 false로 둔다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapMenuRow(row: any, { excludeHiddenOptions = false } = {}): MenuDetail {
  const optionGroups: OptionGroup[] = (row.menu_option_groups ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => a.display_order - b.display_order)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((mog: any) => {
      const g = mog.option_groups
      if (!g) return null
      return {
        id:         g.id,
        name:       g.name,
        isRequired: g.is_required,
        isMulti:    g.is_multi,
        maxSelect:  g.max_select ?? null,
        items:      (g.option_items ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .sort((a: any, b: any) => a.display_order - b.display_order)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((it: any) => !excludeHiddenOptions || !it.is_hidden)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((it: any): OptionItem => ({
            id:           it.id,
            name:         it.name,
            extra:        it.extra_price,
            soldOut:      it.is_sold_out,
            soldOutUntil: it.sold_out_until ?? null,
            hidden:       it.is_hidden,
            isPopular:    it.is_popular,
            maxQty:       it.max_quantity ?? null,
          })),
      } as OptionGroup
    })
    .filter(Boolean) as OptionGroup[]

  return {
    code:          row.id,
    name:          row.name,
    emoji:         '🍽️',
    price:         row.base_price,
    description:   row.description ?? '',
    imageUrl:      row.image_url ?? undefined,
    categoryId:    row.category_id,
    active:        !row.is_hidden,
    soldOut:       row.is_sold_out,
    soldOutUntil:  row.sold_out_until ?? null,
    order:         row.display_order,
    isPopular:     row.is_popular     ?? false,
    isRecommended: row.is_recommended ?? false,
    isNew:         row.is_new         ?? false,
    optionGroups,
  }
}
