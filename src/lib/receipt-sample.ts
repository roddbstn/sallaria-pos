// 영수증 미리보기·임시 출력이 같이 쓰는 **표본 주문**.
//
// 왜 한 곳에 두나: 미리보기는 화면에 그리고 임시 출력은 메인 프로세스가 종이에
// 찍는다. 둘이 각자 표본을 들고 있으면 "미리보기와 종이가 다르다"가 또 생긴다.
// 여기 하나를 두고, 미리보기는 마스킹·날짜 포맷만 electron/escpos.ts 와 같은
// 규칙으로 흉내 낸다.
//
// 값은 실제 출력 예시(샐러리아 침산점 2026-07-02 배달 주문)를 그대로 옮긴 것이다.
// 지어낸 값을 쓰면 줄 수와 줄바꿈 위치가 실물과 어긋나 미리보기 의미가 없다.

import { maskName, maskPhone } from './mask'

/** 접수 후 예상 소요시간(분) — 표본의 '예상도착시간' 재료 */
export const SAMPLE_PREP_MINUTES = 15

/**
 * electron/printer.ts 의 OrderPayload 와 같은 모양.
 *
 * 전화번호·주문자명은 **마스킹하지 않은 값**이다 — escpos 가 찍을 때 직접
 * 마스킹한다. 여기서 미리 가려 버리면 종이에 '김**보' 처럼 두 번 가려진다.
 */
export function sampleOrderPayload(storeName = '샐러리아 침산점', now = new Date()) {
  const iso = now.toISOString()
  return {
    order_code:    'SAMPLE',
    order_number:  '11610',
    store_name:    storeName,
    account_name:  '북구청 정보통신과',
    account_type:  '과',
    orderer_name:  '김다보',
    orderer_phone: '01012344224',
    method:        '배달',
    ordered_at:    iso,
    items: [
      {
        menu_name: '닭가슴살 단백질 도시락', quantity: 1, unit_price: 8400, subtotal: 8400,
        options: [
          { option_name: '스팀닭가슴살', extra_price: 0 },
          { option_name: '매콤마요(와사비베이스)', extra_price: 0 },
        ],
      },
      {
        menu_name: '수비드 통삼겹 단백질 도시락', quantity: 1, unit_price: 11000, subtotal: 13000,
        options: [
          { option_name: '멕시칸치폴레', extra_price: 0 },
          { option_name: '연두부튀김 추가', extra_price: 2000 },
        ],
      },
    ],
    menu_subtotal:  21400,
    delivery_fee:   3500,
    total_amount:   24900,
    balance_before: 711800,
    balance_after:  686900,
    note:             '수저·포크 O',
    delivery_address: '대구 북구 옥산로 65',
    delivery_detail:  '별관 3층',
    delivery_note:    '문 앞에 두고 노크해주세요.',
    prep_minutes:     SAMPLE_PREP_MINUTES,
    // 접수 시각 = 주문 시각 = **지금**.
    //
    // 전엔 2026-07-02 로 박아 뒀는데, escpos 는 '(N분 뒤)' 를 지금 기준으로 다시
    // 세고 이미 지난 주문이면 그 줄을 **안 찍는다**(재출력 종이에서 거짓말이 되니까).
    // 그래서 박힌 날짜로 임시 출력을 하면 종이에만 그 줄이 빠져, 미리보기와 한 줄이
    // 어긋났다. 지금으로 두면 둘 다 '(15분 뒤)' 가 나온다.
    accepted_at:      iso,
  }
}

/** escpos.ts 의 formatDate 와 같은 규칙 */
export function formatReceiptDate(iso: string): string {
  const d = new Date(iso)
  return (
    `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  )
}

/** escpos.ts 의 formatWon 과 같은 규칙 */
export function formatReceiptWon(n: number): string {
  return n.toLocaleString('ko-KR') + '원'
}

/** escpos.ts 의 clockLabel 과 같은 규칙 — '오후 5:20' */
export function formatReceiptClock(d: Date): string {
  const h = d.getHours()
  const ampm = h < 12 ? '오전' : '오후'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${ampm} ${h12}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 미리보기가 그릴 **표시용** 표본 — 마스킹·날짜·금액을 인쇄와 같은 규칙으로 통과시킨 값.
 *
 * '(N분 뒤)' 도 인쇄와 **같은 계산**으로 낸다 — 지난 주문이면 null 이고 그 줄이 빠진다.
 */
export function sampleReceiptDisplay(storeName?: string, now = new Date()) {
  const o = sampleOrderPayload(storeName, now)
  const eta = new Date(new Date(o.accepted_at).getTime() + SAMPLE_PREP_MINUTES * 60_000)
  // escpos.ts etaLines 와 같은 계산 — 지난 주문이면 null 이고 그 줄을 안 찍는다
  const left = Math.ceil((eta.getTime() - Date.now()) / 60_000)
  return {
    storeName:    o.store_name,
    orderNumber:  o.order_number,
    orderedAt:    formatReceiptDate(o.ordered_at),
    method:       o.method,
    orderer:      maskName(o.orderer_name),
    phone:        maskPhone(o.orderer_phone),
    account:      o.account_name,
    address:      o.delivery_address,
    addressSub:   o.delivery_detail,
    storeNote:    o.note,
    deliveryNote: o.delivery_note,
    etaClock:     formatReceiptClock(eta),
    etaRelative:  left > 0 ? `(${left}분 뒤)` : null,
    items: o.items.map(it => ({
      name:  it.menu_name,
      qty:   it.quantity,
      price: formatReceiptWon(it.subtotal),
      opts:  it.options.map(op =>
        op.extra_price > 0
          ? `${op.option_name} (+${op.extra_price.toLocaleString('ko-KR')}원)`
          : op.option_name,
      ),
    })),
    subtotal:      formatReceiptWon(o.menu_subtotal),
    deliveryFee:   formatReceiptWon(o.delivery_fee),
    total:         formatReceiptWon(o.total_amount),
    balanceBefore: formatReceiptWon(o.balance_before),
    balanceAfter:  formatReceiptWon(o.balance_after),
  }
}
