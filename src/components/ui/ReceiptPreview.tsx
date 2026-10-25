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
  footerText:  string
  showBalance: boolean
}

export const DEFAULT_RECEIPT_CONFIG: ReceiptPreviewConfig = {
  menuSize: 'normal', optionSize: 'normal', amountSize: 'normal',
  // 빈 값이면 영수증 아래가 휑하게 끝난다. 매장이 고쳐 쓰라고 초안을 깔아둔다
  // (설정 > 영수증·증빙에서 지우거나 바꿀 수 있다).
  footerText: '감사합니다', showBalance: true,
}

// 58mm 용지에 ESC/POS 기본 폰트로 찍히는 크기를 화면 px로 옮긴 값
// 실제 인쇄는 높이 배수다(보통 2배, 크게 3배). 미리보기도 그 비율로 둔다 — 12 : 18
const PX: Record<TextSize, number> = { normal: 12, large: 18 }

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
  return (
    <Paper>
      <div className="text-center font-bold" style={{ fontSize: 12 }}>[주방용]</div>
      <div className="text-center" style={{ fontSize: 11 }}>{SAMPLE.storeName} - 선결제 영수증</div>
      <Line />
      <div style={{ fontSize: 11 }}>주문번호 : <b>{SAMPLE.orderNumber}</b></div>
      <div style={{ fontSize: 11 }}>주문일시 : {SAMPLE.orderedAt}</div>
      <Line />
      <div style={{ fontSize: 11 }}>이용방법 : <b>{SAMPLE.method}</b></div>
      <div style={{ fontSize: 11 }}>주문자&nbsp;&nbsp; : {SAMPLE.orderer}</div>
      <div style={{ fontSize: 11 }}>전화번호 : {SAMPLE.phone}</div>
      <div style={{ fontSize: 11 }}>거래처&nbsp;&nbsp; : {SAMPLE.account}</div>
      <Line />
      <div style={{ fontSize: 11 }}>배달주소 : {SAMPLE.address}</div>
      <div style={{ fontSize: 11 }}>배달상세 : {SAMPLE.addressSub}</div>
      <div style={{ fontSize: 11 }}>가게요청 : {SAMPLE.storeNote}</div>
      <div style={{ fontSize: 11 }}>배달요청 : {SAMPLE.deliveryNote}</div>
      <Line />

      {/* 메뉴 표 — 실제는 grid-template-columns: 1fr auto auto */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', rowGap: 2, columnGap: 10 }}>
        <span className="font-bold" style={{ fontSize: menuPx }}>메뉴명</span>
        <span className="font-bold text-right" style={{ fontSize: menuPx }}>수량</span>
        <span className="font-bold text-right" style={{ fontSize: menuPx }}>가격</span>
        <div style={{ gridColumn: '1/-1' }}><div className="border-t border-dotted border-[#ADADAD] my-[2px]" /></div>
        {SAMPLE.items.map((it, i) => (
          <Fragment key={i}>
            <span className="font-bold" style={{ fontSize: menuPx }}>{it.name}</span>
            <span className="font-bold text-right" style={{ fontSize: menuPx }}>{it.qty}</span>
            <span className="font-bold text-right whitespace-nowrap" style={{ fontSize: menuPx }}>{it.amount}</span>
            {it.opts.map((o, oi) => (
              <Fragment key={oi}>
                <div style={{ gridColumn: '1/3', paddingLeft: 8, fontSize: optPx, color: '#333' }}>&gt; {o.t}</div>
                <div className="text-right whitespace-nowrap" style={{ fontSize: optPx }}>{o.plus ?? ''}</div>
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
  return (
    <Paper>
      <div className="text-center font-bold" style={{ fontSize: 12 }}>[고객용]</div>
      <div className="text-center" style={{ fontSize: 11 }}>{SAMPLE.storeName} - 선결제 영수증</div>
      <Line />
      <div style={{ fontSize: 11 }}>주문번호 : <b>{SAMPLE.orderNumber}</b></div>
      <div style={{ fontSize: 11 }}>주문일시 : {SAMPLE.orderedAt}</div>
      <Line />
      <div style={{ fontSize: 11 }}>이용방법 : <b>{SAMPLE.method}</b></div>
      <div style={{ fontSize: 11 }}>주문자&nbsp;&nbsp; : {SAMPLE.orderer}</div>
      <div style={{ fontSize: 11 }}>거래처&nbsp;&nbsp; : {SAMPLE.account}</div>
      <div style={{ fontSize: 11 }}>전화번호 : {SAMPLE.phone}</div>
      <Line />
      {/* 배달이면 주소·배달요청까지, 아니면 가게요청만 — escpos 와 같은 분기 */}
      <div style={{ fontSize: 11 }}>배달주소 : {SAMPLE.address}</div>
      <div style={{ fontSize: 11 }}>가게요청 : {SAMPLE.storeNote}</div>
      <div style={{ fontSize: 11 }}>배달요청 : {SAMPLE.deliveryNote}</div>
      <Line />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', rowGap: 2, columnGap: 10 }}>
        <span className="font-bold" style={{ fontSize: menuPx }}>메뉴명</span>
        <span className="font-bold text-right" style={{ fontSize: menuPx }}>수량</span>
        <span className="font-bold text-right" style={{ fontSize: menuPx }}>가격</span>
        <div style={{ gridColumn: '1/-1' }}><div className="border-t border-dotted border-[#ADADAD] my-[2px]" /></div>
        {SAMPLE.items.map((it, i) => (
          <Fragment key={i}>
            <span className="font-bold" style={{ fontSize: menuPx }}>{it.name}</span>
            <span className="font-bold text-right" style={{ fontSize: menuPx }}>{it.qty}</span>
            <span className="font-bold text-right whitespace-nowrap" style={{ fontSize: menuPx }}>{it.amount}</span>
            {it.opts.map((o, oi) => (
              <Fragment key={oi}>
                <div style={{ gridColumn: '1/3', paddingLeft: 8, fontSize: optPx, color: '#333' }}>&gt; {o.t}</div>
                <div className="text-right whitespace-nowrap" style={{ fontSize: optPx }}>{o.plus ?? ''}</div>
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
