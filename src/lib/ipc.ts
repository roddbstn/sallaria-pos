// Renderer에서 window.api 타입 안전하게 사용하는 헬퍼

import type { Order } from './mock-data'

// note 문자열(= 가게 요청사항 + 배달 정보)을 파싱. customerNote는 "수저·포크 O" 같은 요청 칩이든
// 고객이 직접 입력한 텍스트든 구분 없이 전부 합쳐진 "가게 요청사항" 하나로 취급한다 — 카드 상단
// 박스는 특정 칩 전용이 아니라 이 customerNote를 그대로 보여주는 범용 칸이다 (Figma node 491:330).
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
    if (part.startsWith('[배달주소] ')) {
      deliveryAddress = part.slice('[배달주소] '.length)
    } else if (part.startsWith('[배달상세] ')) {
      deliveryDetail = part.slice('[배달상세] '.length)
    } else if (part.startsWith('[배달요청] ')) {
      deliveryNote = part.slice('[배달요청] '.length)
    } else if (part.trim()) {
      customerParts.push(part.trim())
    }
  }
  return { deliveryAddress, deliveryDetail, deliveryNote, customerNote: customerParts.join(', ') || null }
}

// 창구 타입은 src/vite-env.d.ts 의 PosBridge 가 들고 있다(위 주석 참고).
// Electron 밖(브라우저 미리보기)에서는 window.api 가 없으므로 호출부가 ?. 로 방어한다.
//
// ⚠️ `typeof window` 검사가 꼭 필요하다. 전엔 `window.api` 를 모듈 최상단에서 바로
//    읽어서, window 가 **아예 없는** 환경(Node — 즉 단위 테스트)에서는 import 만 해도
//    ReferenceError 로 터졌다. 그래서 이 파일의 순수 함수들(won·parseNote)을
//    테스트할 수가 없었다.
//
// 타입은 그대로 PosBridge 로 둔다 — 호출부 절반이 `api.foo` 로(옵셔널 없이) 쓰고 있어서
// 타입을 `| undefined` 로 바꾸면 그 9곳이 전부 타입 에러가 난다. 그건 따로 정리할 일이고,
// 여기서 고치는 건 "import 자체가 터지는 것"까지다.
export const api = (typeof window !== 'undefined' ? window.api : undefined) as PosBridge

export const won = (n: number) =>
  n.toLocaleString('ko-KR') + '원'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'] as const

/**
 * '10/11 (토) 18:24'
 *
 * 요일을 같이 찍는 이유: 주문 내역을 훑는 목적이 대개 "지난 금요일 그 주문"처럼
 * 요일 기억에서 출발한다. 날짜만 있으면 달력을 한 번 더 봐야 한다.
 */
export const formatDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAY[d.getDay()]}) ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

/**
 * 렌더러의 Order 타입 → 프린터 IPC로 전달할 OrderPayload 형태로 변환
 * (mock-data Order.items.options 는 string[] 이라 extra_price = 0 처리)
 */
export function orderToPayload(o: Order, storeName?: string) {
  // 배달료는 매장별 거리 요금제(stores.delivery_tip_*)로 주문 시점에 확정되므로 상수가 아니다.
  // 예전엔 여기서 3500으로 하드코딩하고 menu_subtotal을 "총액 - 3500"으로 역산했는데,
  // 기본 배달료가 4000으로 오른 뒤 영수증에 배달료 3,500 / 메뉴소계가 500원 부풀어 찍혔다.
  // → 세 금액 모두 DB(orders.menu_subtotal/delivery_fee/total_amount) 값을 그대로 쓴다.
  const itemsSubtotal = o.items.reduce((sum, it) => sum + it.price * it.qty, 0)
  const deliveryFee   = o.deliveryFee ?? 0
  const menuSubtotal  = o.menuSubtotal ?? itemsSubtotal
  const { deliveryAddress, deliveryDetail, deliveryNote, customerNote } = parseNote(o.remarks)
  return {
    order_code:       o.code,
    order_number:     o.orderNumber,
    store_name:       storeName,
    account_name:     o.accountName,
    account_type:     o.accountType,
    orderer_name:     o.orderer,
    orderer_phone:    o.phone ?? null,
    method:           o.method,
    ordered_at:       o.createdAt,
    items: o.items.map(item => ({
      menu_name:   item.name,
      quantity:    item.qty,
      unit_price:  item.price,
      subtotal:    item.price * item.qty,
      options: item.optionDetails
        ? item.optionDetails.map(od => ({
            option_name: od.name,
            extra_price: od.extraPrice,
            group_name:  od.groupName,
          }))
        : item.options.map(name => ({ option_name: name, extra_price: 0 })),
    })),
    menu_subtotal:    menuSubtotal,
    delivery_fee:     deliveryFee,
    total_amount:     o.total,
    balance_before:   o.balanceBefore ?? 0,
    balance_after:    o.balanceAfter  ?? 0,
    note:             customerNote,
    delivery_address: deliveryAddress,
    delivery_detail:  deliveryDetail,
    delivery_note:    deliveryNote,
  }
}

/**
 * 앱 버전 — 진단·문의에 붙여 보내는 값.
 *
 * ⚠️ 하드코딩하지 말 것. 전엔 SupportModal 이 '1.0.0', 프린터 진단이 '1.0.1' 을
 * 손으로 적어 보냈다. 실제 배포 버전은 1.1.0 이었다. "어느 버전 쓰고 계세요?"가
 * 원격 지원의 첫 질문인데 그 답이 늘 틀려 있으면 진단 정보를 붙이는 의미가 없다.
 *
 * 진실은 메인 프로세스의 app.getVersion()(= package.json) 하나뿐이다.
 * Electron 밖(브라우저 미리보기)에서는 창구가 없어 'unknown' 을 돌려준다.
 */
export async function getAppVersion(): Promise<string> {
  try {
    return (await api?.appVersion?.()) ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
