import { useState, Fragment } from 'react'

// 58mm 감열 영수증 미리보기 — 주방 주문서 / 고객 영수증 2종.
//
// QR 안내증 탭은 뺐다(2026-10-13): QR 종이는 설정 > QR출력에서 A4·분할로 뽑는 게 본류이고,
// 영수증 미리보기에 같은 걸 또 두면 어디서 인쇄하는 건지 두 곳을 보게 된다.
// 영수증 프린터로 QR을 뽑는 경로 자체는 QR출력 화면에 '영수증' 용지 옵션으로 남아 있다.
// 프린터 연결 화면과 영수증·증빙 화면이 같은 컴포넌트를 쓴다.
//
// 실제 출력은 electron/printer.ts의 buildKitchenReceiptHtml / buildCustomerReceiptHtml /
// buildTestReceiptHtml이 만든다. 여기는 "설정을 바꾸면 어떻게 보이는지"를 보여주는 화면용이고,
// 폭(58mm ≈ 220px)과 글자 크기 비율만 실제와 맞춰 뒀다.

export type ReceiptKind = 'kitchen' | 'customer'
export type TextSize = 'normal' | 'large'

export interface ReceiptPreviewConfig {
  menuSize:    TextSize
  optionSize:  TextSize
  amountSize:  TextSize
  /**
   * 메뉴 이름 오른쪽에 가격을 찍을지.
   *
   * 끄면 가격 칸이 통째로 빠지고 **그만큼 메뉴명이 넓어진다.** 메뉴명을 '크게'로
   * 두면 '수비드 통삼겹 단백질 도시락' 같은 이름이 쉽게 줄바꿈되는데,
   * 58mm 종이에서 가격 칸이 가져가던 폭이 꽤 크다. 금액은 어차피 아래
   * '메뉴 소계 / 합계'에 다시 나온다.
   * **주방 주문서와 고객 영수증 모두**에 적용된다 — 양식은 한 벌이라야
   * 점주가 "어느 쪽에 적용되는 건가"를 안 따진다.
   */
  showItemPrice: boolean
  footerText:  string
  showBalance: boolean
}

export const DEFAULT_RECEIPT_CONFIG: ReceiptPreviewConfig = {
  menuSize: 'normal', optionSize: 'normal', amountSize: 'normal',
  showItemPrice: true,
  // 빈 값이면 영수증 아래가 휑하게 끝난다. 매장이 고쳐 쓰라고 초안을 깔아둔다
  // (설정 > 영수증·증빙에서 지우거나 바꿀 수 있다).
  footerText: '감사합니다', showBalance: true,
}

// 58mm 용지에 ESC/POS 기본 폰트로 찍히는 크기를 화면 px로 옮긴 값.
// 실제 인쇄는 높이 배수다(보통 2배, 크게 3배). 미리보기도 그 비율로 둔다.
//
// 2026-11-07 — '보통'을 12 → 14 로 올렸다. 실제로 뽑아 보니 메뉴명이 주방에서
// 멀리서 안 읽혔다. 영수증은 손에 들고 보는 종이가 아니라 **조리대에 붙여 놓고
// 흘깃 보는 종이**라, 기본이 작으면 점주가 매번 '크게'로 바꿔야 한다.
const PX: Record<TextSize, number> = { normal: 14, large: 18 }

/**
 * 예상 도착 시간 — 메뉴 바로 위에 **가장 크게** 들어간다.
 *
 * 영수증에서 주방이 제일 먼저 봐야 하는 건 "몇 시까지"다. 주문번호·주문자는
 * 나중에 찾을 때 쓰는 값이고, 조리 순서를 정하는 건 이 한 줄이다.
 * 그래서 메뉴명보다 한 단계 더 크게 둔다.
 */
const ETA_PX = 20

const TABS: { kind: ReceiptKind; label: string }[] = [
  { kind: 'kitchen',  label: '주방 주문서' },
  { kind: 'customer', label: '고객 영수증' },
]

function Line() {
  return <div className="border-t border-dashed border-[#ADADAD] my-[7px]" />
}

function Paper({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="bg-white mx-auto px-[12px] py-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.12)]"
      style={{ width: 220, fontFamily: '"D2Coding", "Courier New", monospace', color: '#1E1E1E' }}
    >
      {children}
    </div>
  )
}

// 실제 출력 예시(샐러리아 침산점 배달 주문)를 그대로 옮긴 표본 데이터.
// 지어낸 값을 쓰면 미리보기가 실물과 어긋나, 설정을 바꿔도 결과를 가늠할 수 없다.
const SAMPLE = {
  storeName:  '샐러리아 침산점',
  orderNumber: '11610',
  orderedAt:  '2026/07/02 17:05',
  method:     '배달',
  orderer:    '김*보',
  phone:      '010-****-4224',
  account:    '북구청 정보통신과',
  address:    '대구 북구 옥산로 65',
  addressSub: '별관 3층',
  storeNote:  '수저·포크 O',
  // 실제로는 승인 시각 + 소요시간으로 계산한다(lib/pickup-time.ts 의 readyClock 과 같은 기준)
  etaClock:   '오후 5:20',
  etaRelative: '15분 뒤',
  deliveryNote: '문 앞에 두고 노크해주세요.',
  items: [
    { name: '닭가슴살 단백질 도시락', qty: 1, amount: '8,400원',
      opts: [{ t: '8,400원' }, { t: '스팀닭가슴살' }, { t: '매콤마요(와사비베이스)' }] },
    { name: '수비드 통삼겹 단백질 도시락', qty: 1, amount: '13,000원',
      opts: [{ t: '11,000원' }, { t: '멕시칸치폴레' }, { t: '연두부튀김 추가', plus: '(+2,000원)' }] },
  ],
  subtotal: '21,400원',
  deliveryFee: '3,500원',
  total: '24,900원',
  balanceBefore: '711,800원',
  balanceAfter:  '686,900원',
}

/**
 * '라벨 : 값' 한 줄.
 *
 * 전엔 라벨 뒤에 &nbsp; 를 손으로 채워 콜론을 맞췄다. 그런데 이 미리보기는
 * 한글 고정폭 글꼴(D2Coding)이라 **한글 한 글자와 nbsp 한 개의 폭이 다르다** —
 * 한글은 nbsp 두 개쯤 된다. 그래서 '주문자' 처럼 짧은 라벨에 nbsp 를 많이 넣으면
 * 콜론이 맞기는커녕 그 줄만 유독 벌어진다. 실제로 '주문자' 뒤가 그랬다.
 *
 * 폭을 글자 수가 아니라 **길이(em)** 로 잡으면 글꼴이 뭐든 한 줄로 선다.
 * 가장 긴 라벨이 '선결제계정'(5자)이라 5em 이면 충분하다.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, display: 'flex' }}>
      <span style={{ width: '5em', flexShrink: 0 }}>{label}</span>
      <span style={{ flexShrink: 0, paddingRight: '0.4em' }}>:</span>
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  )
}

/** 점선 구분선 — 실제 영수증의 border-top:1px dashed */
function Row({ label, value, bold = false, size = 11 }: { label: string; value: string; bold?: boolean; size?: number }) {
  return (
    <div className={`flex justify-between gap-[4px] ${bold ? 'font-bold' : ''}`} style={{ fontSize: size }}>
      <span>{label}</span><span className="whitespace-nowrap flex-shrink-0">{value}</span>
    </div>
  )
}

/** 주방용 — electron/printer.ts buildKitchenReceiptHtml 과 같은 순서·같은 라벨 */
function KitchenReceipt({ cfg }: { cfg: ReceiptPreviewConfig }) {
  const menuPx = PX[cfg.menuSize]
  const optPx  = PX[cfg.optionSize]
  const amtPx  = PX[cfg.amountSize]
  const showPrice = cfg.showItemPrice
  return (
    <Paper>
      <div className="text-center font-bold" style={{ fontSize: 12 }}>[주방용]</div>
      <div className="text-center" style={{ fontSize: 11 }}>{SAMPLE.storeName} - 선결제 영수증</div>
      <Line />
      <Field label="주문번호"><b>{SAMPLE.orderNumber}</b></Field>
      <Field label="주문일시">{SAMPLE.orderedAt}</Field>
      <Line />
      <Field label="이용방법"><b>{SAMPLE.method}</b></Field>
      <Field label="주문자">{SAMPLE.orderer}</Field>
      <Field label="전화번호">{SAMPLE.phone}</Field>
      <Field label="선결제계정">{SAMPLE.account}</Field>
      <Line />
      <Field label="배달주소">{SAMPLE.address}</Field>
      <Field label="배달상세">{SAMPLE.addressSub}</Field>
      <Field label="가게요청">{SAMPLE.storeNote}</Field>
      <Field label="배달요청">{SAMPLE.deliveryNote}</Field>
      <Line />

      {/* 예상 도착 시간 — 메뉴 바로 위, 이 종이에서 가장 큰 글자.
          주방이 조리 순서를 정하는 건 이 한 줄이다(주문번호·주문자는 나중에 찾을 때 쓴다).
          '(15분 뒤)' 를 같이 적는 이유: 시각만 보면 지금 몇 시인지 머리로 빼야 한다. */}
      <div className="font-bold" style={{ fontSize: ETA_PX, lineHeight: 1.25 }}>
        예상도착시간
      </div>
      <div className="font-bold" style={{ fontSize: ETA_PX, lineHeight: 1.25 }}>
        {SAMPLE.etaClock} <span style={{ fontSize: Math.round(ETA_PX * 0.8) }}>({SAMPLE.etaRelative})</span>
      </div>
      <Line />

      {/* 메뉴 표 — 실제는 grid-template-columns: 1fr auto auto.
          가격을 끄면 칸이 통째로 빠져 메뉴명이 그만큼 넓어진다(줄바꿈 방지).
          이때 수량은 오른쪽 끝으로 간다. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: showPrice ? '1fr auto auto' : '1fr auto',
        rowGap: 2, columnGap: 10,
      }}>
        <span className="font-bold" style={{ fontSize: menuPx }}>메뉴명</span>
        <span className="font-bold text-right" style={{ fontSize: menuPx }}>수량</span>
        {showPrice && <span className="font-bold text-right" style={{ fontSize: menuPx }}>가격</span>}
        <div style={{ gridColumn: '1/-1' }}><div className="border-t border-dotted border-[#ADADAD] my-[2px]" /></div>
        {SAMPLE.items.map((it, i) => (
          <Fragment key={i}>
            <span className="font-bold" style={{ fontSize: menuPx }}>{it.name}</span>
            <span className="font-bold text-right" style={{ fontSize: menuPx }}>{it.qty}</span>
            {showPrice && (
              <span className="font-bold text-right whitespace-nowrap" style={{ fontSize: menuPx }}>{it.amount}</span>
            )}
            {it.opts.map((o, oi) => (
              <Fragment key={oi}>
                <div style={{ gridColumn: showPrice ? '1/3' : '1/-1', paddingLeft: 8, fontSize: optPx, color: '#333' }}>
                  &gt; {o.t}{!showPrice && o.plus ? ` ${o.plus}` : ''}
                </div>
                {showPrice && (
                  <div className="text-right whitespace-nowrap" style={{ fontSize: optPx }}>{o.plus ?? ''}</div>
                )}
              </Fragment>
            ))}
          </Fragment>
        ))}
      </div>

      <Line />
      <Row label="메뉴 소계" value={SAMPLE.subtotal} size={amtPx} />
      <Row label="배달료" value={SAMPLE.deliveryFee} size={amtPx} />
      <Line />
      <Row label="합  계" value={SAMPLE.total} bold size={amtPx} />
      {cfg.showBalance && (
        <>
          <Line />
          <Row label="주문전 잔액" value={SAMPLE.balanceBefore} size={amtPx} />
          <Row label="주문후 잔액" value={SAMPLE.balanceAfter} bold size={amtPx} />
        </>
      )}
      {cfg.footerText.trim() && (
        <>
          <Line />
          <div className="text-center whitespace-pre-wrap" style={{ fontSize: 10 }}>{cfg.footerText}</div>
        </>
      )}
    </Paper>
  )
}

/**
 * 고객용 — electron/escpos.ts buildCustomerReceiptEscPos 와 같은 순서·같은 라벨.
 *
 * 2026-10-18: 전화번호·배달주소·가게요청·배달요청이 미리보기에만 빠져 있었다.
 * 실제 인쇄는 처음부터 이 넷을 다 찍고 있었는데 미리보기가 '금액 중심'이라며
 * 생략해서, 화면만 보면 고객 영수증에 그 정보가 없는 것처럼 보였다.
 * 미리보기는 실제와 같아야 한다 — 다르면 미리보기가 아니다.
 */
function CustomerReceipt({ cfg }: { cfg: ReceiptPreviewConfig }) {
  const menuPx = PX[cfg.menuSize]
  const optPx  = PX[cfg.optionSize]
  const amtPx  = PX[cfg.amountSize]
  const showPrice = cfg.showItemPrice
  return (
    <Paper>
      <div className="text-center font-bold" style={{ fontSize: 12 }}>[고객용]</div>
      <div className="text-center" style={{ fontSize: 11 }}>{SAMPLE.storeName} - 선결제 영수증</div>
      <Line />
      <Field label="주문번호"><b>{SAMPLE.orderNumber}</b></Field>
      <Field label="주문일시">{SAMPLE.orderedAt}</Field>
      <Line />
      <Field label="이용방법"><b>{SAMPLE.method}</b></Field>
      {/* 전화번호가 선결제 계정보다 **위**다 — 주방 주문서와 같은 순서.
          둘이 다르면 같은 주문의 두 장을 겹쳐 볼 때 눈이 한 번 더 움직인다. */}
      <Field label="주문자">{SAMPLE.orderer}</Field>
      <Field label="전화번호">{SAMPLE.phone}</Field>
      <Field label="선결제계정">{SAMPLE.account}</Field>
      <Line />
      {/* 배달이면 주소·배달요청까지, 아니면 가게요청만 — escpos 와 같은 분기 */}
      <Field label="배달주소">{SAMPLE.address}</Field>
      <Field label="가게요청">{SAMPLE.storeNote}</Field>
      <Field label="배달요청">{SAMPLE.deliveryNote}</Field>
      <Line />

      {/* 예상 도착 시간은 **주방용에만** 둔다.
          손님은 주문 직후 QR웹 화면에서 이미 그 시각을 보고 있고, 거기 숫자는
          점주가 시간을 고치면 같이 바뀐다. 종이에 한 번 찍힌 시각은 안 바뀌어서
          둘이 어긋나는 순간 종이 쪽이 거짓말이 된다. */}

      {/* 가격을 끄면 칸이 통째로 빠져 메뉴명이 그만큼 넓어진다(줄바꿈 방지).
          주방 주문서와 **같은 설정을 따른다** — 영수증 양식은 한 벌이라야
          점주가 "어느 쪽에 적용되는 건가"를 안 따진다.
          금액은 어차피 아래 메뉴 소계·합계에 그대로 남는다. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: showPrice ? '1fr auto auto' : '1fr auto',
        rowGap: 2, columnGap: 10,
      }}>
        <span className="font-bold" style={{ fontSize: menuPx }}>메뉴명</span>
        <span className="font-bold text-right" style={{ fontSize: menuPx }}>수량</span>
        {showPrice && <span className="font-bold text-right" style={{ fontSize: menuPx }}>가격</span>}
        <div style={{ gridColumn: '1/-1' }}><div className="border-t border-dotted border-[#ADADAD] my-[2px]" /></div>
        {SAMPLE.items.map((it, i) => (
          <Fragment key={i}>
            <span className="font-bold" style={{ fontSize: menuPx }}>{it.name}</span>
            <span className="font-bold text-right" style={{ fontSize: menuPx }}>{it.qty}</span>
            {showPrice && (
              <span className="font-bold text-right whitespace-nowrap" style={{ fontSize: menuPx }}>{it.amount}</span>
            )}
            {it.opts.map((o, oi) => (
              <Fragment key={oi}>
                <div style={{ gridColumn: showPrice ? '1/3' : '1/-1', paddingLeft: 8, fontSize: optPx, color: '#333' }}>
                  &gt; {o.t}{!showPrice && o.plus ? ` ${o.plus}` : ''}
                </div>
                {showPrice && (
                  <div className="text-right whitespace-nowrap" style={{ fontSize: optPx }}>{o.plus ?? ''}</div>
                )}
              </Fragment>
            ))}
          </Fragment>
        ))}
      </div>

      <Line />
      <Row label="메뉴 소계" value={SAMPLE.subtotal} size={amtPx} />
      <Row label="배달료" value={SAMPLE.deliveryFee} size={amtPx} />
      <Line />
      <Row label="합  계" value={SAMPLE.total} bold size={amtPx} />
      {cfg.showBalance && (
        <>
          <Line />
          <Row label="주문전 잔액" value={SAMPLE.balanceBefore} size={amtPx} />
          <Row label="주문후 잔액" value={SAMPLE.balanceAfter} bold size={amtPx} />
        </>
      )}
      {cfg.footerText.trim() && (
        <>
          <Line />
          <div className="text-center whitespace-pre-wrap" style={{ fontSize: 10 }}>{cfg.footerText}</div>
        </>
      )}
    </Paper>
  )
}


/** 탭 + 종이 미리보기. 프린터 화면과 영수증 화면이 공유한다. */
export default function ReceiptPreview({
  config = DEFAULT_RECEIPT_CONFIG,
  initialKind = 'kitchen',
}: {
  config?: ReceiptPreviewConfig
  initialKind?: ReceiptKind
}) {
  const [kind, setKind] = useState<ReceiptKind>(initialKind)

  return (
    <div>
      <div className="flex items-center gap-[5px] mb-[12px]">
        {TABS.map(t => (
          <button
            key={t.kind}
            onClick={() => setKind(t.kind)}
            className={`h-[30px] px-[12px] rounded-[8px] text-[12px] transition-colors ${
              kind === t.kind ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-[11px] bg-[#F2F2F2] py-[22px] px-[16px]">
        {kind === 'kitchen'  && <KitchenReceipt cfg={config} />}
        {kind === 'customer' && <CustomerReceipt cfg={config} />}
        <div className="text-center text-[10px] text-[#787878] mt-[12px]">58mm 용지 실제 비율</div>
      </div>
    </div>
  )
}
