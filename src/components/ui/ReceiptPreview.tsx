import { useState } from 'react'
import {
  LINE_CHARS, LINE_RATIO, PREVIEW_FONT_PX, PAPER_MM, PRINT_MM,
  QTY_W, PRICE_W, COL_SEP,
  padL, padR, clamp, wrapName, hr, subHr, field, amountField,
} from '../../lib/receipt-layout'

// 감열 영수증 미리보기 — 주방 주문서 / 고객 영수증 2종.
//
// ── 왜 '문자 격자'로 다시 썼나 (2026-11-07) ───────────────────────────────
// 전엔 flex·grid 로 영수증처럼 **생긴** 화면을 그렸다. 라벨은 width:5em,
// 메뉴 표는 grid-template-columns, 글자 크기는 눈대중으로 고른 px 였다.
// 그래서 설정을 바꿔도 종이에서 어떻게 나올지는 뽑아 봐야 알았고, 실제로
// 여러 군데가 달랐다(콜론 위치·줄 수·크기 배수).
//
// 영수증 프린터는 **글자를 격자에 찍는다.** 한 줄 42칸, 한글 2칸, ASCII 1칸.
// 그래서 지금은 electron/escpos.ts 와 **같은 패딩 함수로 같은 문자열을 만들고**,
// 그 문자열을 고정폭 글꼴로 한 줄씩 그린다. 실측 치수는 receipt-layout.ts 머리말에
// 적어 뒀다(72mm / 42칸 / 칸 1.71mm / 줄 4.23mm / 줄높이비 1.41).
//
// ⚠️ 라벨·순서·크기 배수를 고칠 땐 **escpos.ts 를 같이 고친다.** 한쪽만 고치면
//    미리보기가 다시 거짓말을 한다 — 그게 이 파일을 다시 쓴 이유다.

export type ReceiptKind = 'kitchen' | 'customer'
export type TextSize = 'normal' | 'large'

export interface ReceiptPreviewConfig {
  menuSize:    TextSize
  optionSize:  TextSize
  amountSize:  TextSize
  /**
   * 메뉴 이름 오른쪽에 가격을 찍을지.
   *
   * 끄면 가격 칸(10칸)이 통째로 빠지고 **그만큼 메뉴명이 넓어진다.**
   * 긴 이름이 줄바꿈되는 걸 막는 용도다. 금액은 어차피 아래 '메뉴 소계 / 합계'에
   * 다시 나온다. **주방 주문서와 고객 영수증 모두**에 적용된다.
   */
  showItemPrice: boolean
  footerText:  string
  showBalance: boolean
}

export const DEFAULT_RECEIPT_CONFIG: ReceiptPreviewConfig = {
  menuSize: 'normal', optionSize: 'normal', amountSize: 'normal',
  showItemPrice: true,
  // 빈 값이면 영수증 아래가 휑하게 끝난다. 매장이 고쳐 쓰라고 초안을 깔아둔다.
  footerText: '감사합니다', showBalance: true,
}

const TABS: { kind: ReceiptKind; label: string }[] = [
  { kind: 'kitchen',  label: '주방 주문서' },
  { kind: 'customer', label: '고객 영수증' },
]

// 실제 출력 예시(샐러리아 침산점 배달 주문)를 그대로 옮긴 표본.
// 지어낸 값을 쓰면 줄 수와 줄바꿈 위치가 실물과 어긋난다.
const SAMPLE = {
  storeName:   '샐러리아 침산점',
  orderNumber: '11610',
  orderedAt:   '2026/07/02 17:05',
  method:      '배달',
  orderer:     '김*보',
  phone:       '010-****-4224',
  account:     '북구청 정보통신과',
  address:     '대구 북구 옥산로 65',
  addressSub:  '별관 3층',
  storeNote:   '수저·포크 O',
  deliveryNote: '문 앞에 두고 노크해주세요.',
  // 실제로는 접수시각 + 소요시간으로 계산한다(escpos.ts etaLines 와 같은 기준)
  etaClock:    '오후 5:20',
  etaRelative: '(15분 뒤)',
  items: [
    { name: '닭가슴살 단백질 도시락', qty: 1, price: '8,400원',
      opts: ['스팀닭가슴살', '매콤마요(와사비베이스)'] },
    { name: '수비드 통삼겹 단백질 도시락', qty: 1, price: '13,000원',
      opts: ['멕시칸치폴레', '연두부튀김 추가 (+2,000원)'] },
  ],
  subtotal:      '21,400원',
  deliveryFee:   '3,500원',
  total:         '24,900원',
  balanceBefore: '711,800원',
  balanceAfter:  '686,900원',
}

/** 한 줄 — 조각 단위로 굵게가 갈린다(실제 프린터도 줄 중간에 BOLD 를 켠다) */
export interface PLine {
  segs:    { t: string; b?: boolean }[]
  /** GS ! 0x11 — 2폭 2높이. 한 줄에 들어가는 칸이 절반이 된다 */
  x2?:     boolean
  /** ESC a 1 — 인쇄 영역 가운데 정렬 */
  center?: boolean
  /** ESC/POS 의 가로 구분선. 격자 안에서 '-' 를 채우는 것과 같다 */
}

const t  = (text: string, bold = false): PLine => ({ segs: [{ t: text, b: bold }] })
const ct = (text: string, bold = false): PLine => ({ segs: [{ t: text, b: bold }], center: true })

/**
 * escpos.ts 의 두 빌더와 **같은 순서·같은 문자열**로 줄 목록을 만든다.
 *
 * 주방/고객 차이는 머리말 한 줄과 예상도착시간 유무뿐이다 — 실제 빌더도 그렇다.
 * (고객 영수증에 예상도착시간을 안 찍는 이유: 손님은 QR웹에서 같은 시각을 보고
 *  있고 그 숫자는 점주가 시간을 고치면 같이 바뀐다. 종이에 찍힌 시각은 안 바뀌어서
 *  어긋나는 순간 종이 쪽이 거짓말이 된다.)
 */
export function buildLines(kind: ReceiptKind, cfg: ReceiptPreviewConfig): PLine[] {
  const W = LINE_CHARS
  const showPrice = cfg.showItemPrice
  const nameW = showPrice ? W - QTY_W - COL_SEP - PRICE_W : W - QTY_W
  const bigName = cfg.menuSize === 'large'
  // '크게'(2배)면 한 줄에 들어가는 칸이 절반이다 — 그 폭으로 자른다
  const optW = cfg.optionSize === 'large' ? Math.floor(W / 2) : W
  const amtX2 = cfg.amountSize === 'large'

  const out: PLine[] = []
  const HR  = () => out.push(t(hr(W)))

  // ── 머리말
  out.push(ct(kind === 'kitchen' ? '[주방용]' : '[고객용]', true))
  out.push(ct(`${SAMPLE.storeName} - 선결제 영수증`))
  HR()

  // ── 주문번호 / 주문일시
  out.push({ segs: [{ t: padL('주문번호', 11) + ' : ' }, { t: SAMPLE.orderNumber, b: true }] })
  out.push(t(field('주문일시', SAMPLE.orderedAt)))
  HR()

  // ── 이용방법 / 주문자 / 전화번호 / 선결제계정
  //    전화번호가 선결제계정 **위**다 — 두 영수증이 같은 순서라야 겹쳐 볼 때 눈이 덜 움직인다
  out.push({ segs: [{ t: padL('이용방법', 11) + ' : ' }, { t: SAMPLE.method, b: true }] })
  out.push(t(field('주문자', SAMPLE.orderer)))
  out.push(t(field('전화번호', SAMPLE.phone)))
  out.push(t(field('선결제계정', SAMPLE.account)))
  HR()

  // ── 배달 정보 (배달일 때만 — 표본은 배달 주문이다)
  for (const l of wrapName(field('배달주소', SAMPLE.address), W)) out.push(t(l))
  for (const l of wrapName(field('배달상세', SAMPLE.addressSub), W)) out.push(t(l))
  out.push(t(field('가게요청', SAMPLE.storeNote)))
  out.push(t(field('배달요청', SAMPLE.deliveryNote)))
  HR()

  // ── 예상도착시간 — 메뉴 바로 위, 이 종이에서 가장 큰 글자. 주방용만.
  if (kind === 'kitchen') {
    out.push({ segs: [{ t: '예상도착시간', b: true }], x2: true })
    out.push({ segs: [{ t: SAMPLE.etaClock, b: true }], x2: true })
    out.push(t(SAMPLE.etaRelative))
    HR()
  }

  // ── 메뉴 표
  out.push(t(
    showPrice
      ? padL('메뉴명', nameW) + padR('수량', QTY_W) + ' '.repeat(COL_SEP) + padR('가격', PRICE_W)
      : padL('메뉴명', nameW) + padR('수량', QTY_W),
    true,
  ))
  out.push(t(subHr(W)))

  for (const it of SAMPLE.items) {
    const qty   = String(it.qty)
    const tail  = showPrice
      ? padR(qty, QTY_W) + ' '.repeat(COL_SEP) + padR(it.price, PRICE_W)
      : padR(qty, QTY_W)

    if (bigName) {
      // 2배 글자는 칸을 두 배로 먹으니 이름이 표에 안 들어간다. 그래서 이름을
      // **자기 줄**에 크게 찍고, 수량·가격은 다음 줄에 머리글 칼럼에 맞춰 오른쪽으로 보낸다.
      for (const l of wrapName(it.name, Math.floor(W / 2))) {
        out.push({ segs: [{ t: l, b: true }], x2: true })
      }
      out.push(t(' '.repeat(nameW) + tail, true))
    } else {
      const lines = wrapName(it.name, nameW)
      lines.forEach((l, i) => {
        const isLast = i === lines.length - 1
        out.push(t(padL(l, nameW) + (isLast ? tail : ' '.repeat(W - nameW)), true))
      })
    }
    for (const o of it.opts) {
      out.push({ segs: [{ t: clamp('  > ' + o, optW) }], x2: cfg.optionSize === 'large' })
    }
  }
  HR()

  // ── 금액
  out.push({ segs: [{ t: amountField('메뉴 소계', SAMPLE.subtotal, amtX2) }], x2: amtX2 })
  out.push({ segs: [{ t: amountField('배달료', SAMPLE.deliveryFee, amtX2) }], x2: amtX2 })
  HR()
  out.push({ segs: [{ t: amountField('합  계', SAMPLE.total, amtX2), b: true }], x2: amtX2 })
  HR()

  if (cfg.showBalance) {
    out.push({ segs: [{ t: amountField('주문전 잔액', SAMPLE.balanceBefore, amtX2) }], x2: amtX2 })
    out.push({ segs: [{ t: amountField('주문후 잔액', SAMPLE.balanceAfter, amtX2), b: true }], x2: amtX2 })
  }

  if (cfg.footerText.trim()) {
    HR()
    for (const l of cfg.footerText.trim().split('\n')) out.push(ct(clamp(l, W)))
  }
  return out
}

/**
 * 한 줄을 **칸 단위로** 그린다.
 *
 * 글자 하나를 span 하나에 넣고 폭을 ASCII 0.5em · 한글 1em 으로 못박는다.
 * 고정폭 글꼴에 맡기지 않는 이유: 점주 PC 에 D2Coding 이 깔려 있을 리가 없고,
 * 대체 글꼴(맑은 고딕·Menlo)은 **한글 폭이 ASCII 의 정확히 두 배가 아니다.**
 * 그러면 패딩 공백으로 맞춘 칼럼이 한 줄씩 어긋나, 격자로 그린 보람이 없다.
 *
 * 칸마다 글자를 가운데 두는 건 실물과 같은 모양이다 — 감열 프린터도 글자를
 * 12×24(한글 24×24) 도트 칸 가운데에 찍는다. 그게 영수증의 '자간'이다.
 */
function Cells({ segs }: { segs: PLine['segs'] }) {
  return (
    <>
      {segs.map((seg, si) => (
        <span key={si} style={{ fontWeight: seg.b ? 700 : 400 }}>
          {[...seg.t].map((ch, ci) => (
            <span
              key={ci}
              style={{
                display: 'inline-block',
                width: ch.charCodeAt(0) > 0x7F ? '1em' : '0.5em',
                textAlign: 'center',
              }}
            >
              {ch}
            </span>
          ))}
        </span>
      ))}
    </>
  )
}

/**
 * 종이 한 장.
 *
 * 인쇄 영역 폭 = 42칸 × 0.5em = 21em. 글자 크기를 바꾸면 종이도 같이 커지므로
 * 비율이 안 깨진다. 2배 줄은 글자 크기만 두 배로 주면 칸도 같이 두 배가 되어
 * 21칸으로 한 줄이 꽉 찬다 — 프린터의 GS ! 0x11 과 같은 셈이다.
 *
 * 좌우 여백은 실물 비율(79mm 종이에 72mm 인쇄)로 둔다.
 */
function Paper({ lines }: { lines: PLine[] }) {
  const F = PREVIEW_FONT_PX
  const sideEM = ((PAPER_MM - PRINT_MM) / 2 / PRINT_MM) * (LINE_CHARS / 2)
  return (
    <div
      className="bg-white mx-auto shadow-[0_1px_4px_rgba(0,0,0,0.12)]"
      style={{
        fontSize: F,
        fontFamily: '"D2Coding", "Nanum Gothic Coding", "Menlo", "Consolas", monospace',
        color: '#1E1E1E',
        width: 'fit-content',
        padding: `12px ${sideEM}em`,
      }}
    >
      <div style={{ width: `${LINE_CHARS / 2}em` }}>
        {lines.map((l, i) => (
          <div
            key={i}
            style={{
              // 2배 줄은 글자도 줄간격도 같이 두 배가 된다(프린터가 그렇게 먹인다)
              fontSize: l.x2 ? '2em' : '1em',
              lineHeight: LINE_RATIO,
              textAlign: l.center ? 'center' : 'left',
              whiteSpace: 'nowrap',
              // 칸 수 초과는 테스트로 막지만, 뚫려도 종이 폭이 늘어나진 않게
              overflow: 'hidden',
            }}
          >
            <Cells segs={l.segs} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** 탭 + 종이 미리보기. 프린터 화면과 영수증·증빙 화면이 공유한다. */
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
        {TABS.map(tab => (
          <button
            key={tab.kind}
            onClick={() => setKind(tab.kind)}
            className={`h-[30px] px-[11px] rounded-[8px] text-[15px] transition-colors ${
              kind === tab.kind ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-[11px] bg-[#F2F2F2] py-[22px] px-[16px] overflow-x-auto">
        <Paper lines={buildLines(kind, config)} />
        <div className="text-center text-[10px] text-[#787878] mt-[12px]">
          79mm 용지 · 한 줄 {LINE_CHARS}자 실제 비율
        </div>
      </div>
    </div>
  )
}
