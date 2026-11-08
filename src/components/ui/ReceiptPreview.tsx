import { useMemo, useState } from 'react'
import {
  LINE_CHARS, LINE_RATIO, PREVIEW_FONT_PX, PAPER_MM, PRINT_MM,
  QTY_W, PRICE_W, COL_SEP,
  pw, padL, padR, clamp, wrapName, hr, subHr, field, amountField, LABEL_W,
} from '../../lib/receipt-layout'
import { sampleReceiptDisplay, sampleOrderPayload } from '../../lib/receipt-sample'

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
  /**
   * 주문번호·이용방법 두 줄의 크기.
   *
   * 이 둘은 **멀리서 흘깃 보는 값**이다. 주문번호는 전화 응대에서 제일 먼저
   * 대조하고, 이용방법은 담는 방식을 가른다. 나머지 머리말(주문일시·주문자·
   * 전화번호·선결제계정)은 찾을 때 들여다보는 값이라 같이 키우면 종이만 길어진다.
   */
  headerSize:  TextSize
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
  headerSize: 'normal', menuSize: 'normal', optionSize: 'normal', amountSize: 'normal',
  showItemPrice: true,
  // 빈 값이면 영수증 아래가 휑하게 끝난다. 매장이 고쳐 쓰라고 초안을 깔아둔다.
  footerText: '감사합니다', showBalance: true,
}

const TABS: { kind: ReceiptKind; label: string }[] = [
  { kind: 'kitchen',  label: '주방 주문서' },
  { kind: 'customer', label: '고객 영수증' },
]

// 표본 주문은 src/lib/receipt-sample.ts 에 있다 — 임시 출력(종이)과 **같은 값**을
// 써야 "미리보기와 종이가 다르다" 가 안 생긴다.
//
// 모듈 로드가 아니라 **화면이 열릴 때** 만든다(아래 useMemo). 표본의 주문 시각이
// '지금'이라서, 모듈 상수로 두면 앱을 켜 둔 채 몇 시간 뒤에 설정을 열었을 때
// 예상도착시간이 과거로 남는다.
type Sample = ReturnType<typeof sampleReceiptDisplay>

/** 한 줄 — 조각 단위로 굵게가 갈린다(실제 프린터도 줄 중간에 BOLD 를 켠다) */
export interface PLine {
  /**
   * 한 줄의 조각들. x2 는 **조각 단위**다 — ESC/POS 는 줄 중간에 배수를 바꿀 수 있고
   * (GS ! 를 그 자리에서 다시 보낸다) 메뉴명 줄이 실제로 그걸 쓴다:
   * 이름만 2배, 수량·가격은 1배로 같은 줄에.
   */
  segs:    { t: string; b?: boolean; x2?: boolean }[]
  /** ESC a 1 — 인쇄 영역 가운데 정렬 */
  center?: boolean
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
export function buildLines(kind: ReceiptKind, cfg: ReceiptPreviewConfig, SAMPLE: Sample = sampleReceiptDisplay()): PLine[] {
  const W = LINE_CHARS
  const showPrice = cfg.showItemPrice
  const nameW = showPrice ? W - QTY_W - COL_SEP - PRICE_W : W - QTY_W
  const bigName = cfg.menuSize === 'large'
  // '크게'(2배)면 한 줄에 들어가는 칸이 절반이다 — 그 폭으로 자른다
  const optW = cfg.optionSize === 'large' ? Math.floor(W / 2) : W
  const amtX2 = cfg.amountSize === 'large'
  // 주문번호·이용방법만 따로 — 2배면 한 줄이 21칸이라 값을 그 폭으로 자른다
  const hdrX2 = cfg.headerSize === 'large'
  const hdrW  = hdrX2 ? Math.floor(W / 2) : W
  const hdrValW = hdrW - LABEL_W - 3

  const out: PLine[] = []
  const HR  = () => out.push(t(hr(W)))

  // ── 머리말
  out.push(ct(kind === 'kitchen' ? '[주방용]' : '[고객용]', true))
  out.push(ct(`${SAMPLE.storeName} - 선결제 영수증`))
  HR()

  // ── 주문번호 / 주문일시
  out.push({ segs: [
    { t: padL('주문번호', LABEL_W) + ' : ', x2: hdrX2 },
    { t: clamp(SAMPLE.orderNumber, hdrValW), b: true, x2: hdrX2 },
  ] })
  out.push(t(field('주문일시', SAMPLE.orderedAt)))
  HR()

  // ── 이용방법 / 주문자 / 전화번호 / 선결제계정
  //    전화번호가 선결제계정 **위**다 — 두 영수증이 같은 순서라야 겹쳐 볼 때 눈이 덜 움직인다
  out.push({ segs: [
    { t: padL('이용방법', LABEL_W) + ' : ', x2: hdrX2 },
    { t: clamp(SAMPLE.method, hdrValW), b: true, x2: hdrX2 },
  ] })
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
    out.push({ segs: [{ t: '예상도착시간', b: true, x2: true }] })
    out.push({ segs: [{ t: SAMPLE.etaClock, b: true, x2: true }] })
    if (SAMPLE.etaRelative) out.push(t(SAMPLE.etaRelative))
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
      // 수량 숫자가 **시작하는 칸 바로 왼쪽**까지를 메뉴명 칸으로 본다 —
      // escpos.ts itemNameLines() 와 같은 계산. 수량 칼럼 4칸 중 '1' 은 한 칸만
      // 쓰므로 남는 세 칸까지 메뉴명이 들어간다.
      const avail = nameW + (QTY_W - pw(qty)) - 1
      const w2 = Math.max(1, Math.floor(avail / 2))
      const lines = wrapName(it.name, w2)
      // 1배 기준 한 줄에서 2배 이름이 먹은 칸만큼 앞을 잘라 붙인다(잘리는 구간은 공백)
      const full = ' '.repeat(nameW) + tail
      lines.forEach((l, i) => {
        const segs: PLine['segs'] = [{ t: l, b: true, x2: true }]
        if (i === 0) segs.push({ t: full.slice(pw(l) * 2), b: true })
        out.push({ segs })
      })
    } else {
      const lines = wrapName(it.name, nameW)
      lines.forEach((l, i) => {
        const isLast = i === lines.length - 1
        out.push(t(padL(l, nameW) + (isLast ? tail : ' '.repeat(W - nameW)), true))
      })
    }
    for (const o of it.opts) {
      out.push({ segs: [{ t: clamp('  > ' + o, optW), x2: cfg.optionSize === 'large' }] })
    }
  }
  HR()

  // ── 금액
  out.push({ segs: [{ t: amountField('메뉴 소계', SAMPLE.subtotal, amtX2), x2: amtX2 }] })
  out.push({ segs: [{ t: amountField('배달료', SAMPLE.deliveryFee, amtX2), x2: amtX2 }] })
  HR()
  out.push({ segs: [{ t: amountField('합  계', SAMPLE.total, amtX2), b: true, x2: amtX2 }] })
  HR()

  if (cfg.showBalance) {
    out.push({ segs: [{ t: amountField('주문전 잔액', SAMPLE.balanceBefore, amtX2), x2: amtX2 }] })
    out.push({ segs: [{ t: amountField('주문후 잔액', SAMPLE.balanceAfter, amtX2), b: true, x2: amtX2 }] })
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
function Cells({ segs, scale }: { segs: PLine['segs']; scale: number }) {
  return (
    <>
      {segs.map((seg, si) => (
        // 줄은 가장 큰 글자 크기로 서 있다. 1배 조각은 거기서 되돌린다 —
        // 칸 폭이 조각의 글자 크기에 em 으로 매여 있으니 폭도 같이 맞는다.
        <span key={si} style={{ fontWeight: seg.b ? 700 : 400, fontSize: `${(seg.x2 ? 2 : 1) / scale}em` }}>
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
        {lines.map((l, i) => {
          // 줄 높이는 **그 줄에서 가장 큰 글자**가 정한다. 2배 조각이 하나라도 있으면
          // 줄 간격도 두 배다(프린터가 그 줄을 그만큼 먹인다).
          const scale = l.segs.some(sg => sg.x2) ? 2 : 1
          return (
            <div
              key={i}
              style={{
                fontSize: `${scale}em`,
                lineHeight: LINE_RATIO,
                textAlign: l.center ? 'center' : 'left',
                whiteSpace: 'nowrap',
                // 칸 수 초과는 테스트로 막지만, 뚫려도 종이 폭이 늘어나진 않게
                overflow: 'hidden',
              }}
            >
              <Cells segs={l.segs} scale={scale} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 지금 보고 있는 영수증 한 장만 실제로 뽑는다.
 *
 * 표본 주문(receipt-sample.ts)을 그대로 메인 프로세스에 보내고, 메인은 평소
 * 주문 영수증과 **똑같은 빌더**로 찍는다. 그래서 이 버튼이 나오는 종이가
 * 영업 중에 나올 종이와 같다 — 설정을 고치고 손님 주문을 기다릴 필요가 없다.
 *
 * '주방 주문서' 탭이면 주방용만, '고객 영수증' 탭이면 고객용만 나간다.
 * 둘 다 나가면 어느 쪽 설정을 본 건지 헷갈리고 종이도 두 장 버린다.
 */
async function printSample(kind: ReceiptKind, storeName?: string): Promise<{ ok: boolean; error?: string }> {
  const w = window as unknown as {
    api?: { reprintOrder?: (p: unknown) => Promise<{ ok: boolean; error?: string }> }
  }
  if (!w.api?.reprintOrder) return { ok: false, error: '데스크톱 앱에서만 출력할 수 있어요' }
  return w.api.reprintOrder({ order: sampleOrderPayload(storeName), kinds: [kind] })
}

/** 탭 + 종이 미리보기. 프린터 화면과 영수증·증빙 화면이 공유한다. */
export default function ReceiptPreview({
  config = DEFAULT_RECEIPT_CONFIG,
  initialKind = 'kitchen',
  storeName,
  showToast,
}: {
  config?: ReceiptPreviewConfig
  initialKind?: ReceiptKind
  storeName?: string
  showToast?: (msg: string) => void
}) {
  const [kind, setKind] = useState<ReceiptKind>(initialKind)
  const [printing, setPrinting] = useState(false)
  // showToast 가 없는 화면(프린터 연결)에서도 결과를 알아야 한다
  const [note, setNote] = useState<string | null>(null)
  const sample = useMemo(() => sampleReceiptDisplay(storeName), [storeName])

  const onPrint = async () => {
    if (printing) return
    setPrinting(true)
    setNote(null)
    const res = await printSample(kind, storeName)
    const label = TABS.find(x => x.kind === kind)!.label
    const msg = res.ok ? `${label} 한 장을 출력했어요` : (res.error || '출력에 실패했어요')
    if (showToast) showToast(msg)
    else setNote(msg)
    setPrinting(false)
  }

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
        {/* 탭 오른쪽 끝 — '지금 보고 있는 이 장'을 뽑는 버튼이라 탭 옆이 맞다 */}
        <button
          onClick={onPrint}
          disabled={printing}
          className="ml-auto h-[30px] px-[11px] rounded-[8px] text-[15px] border border-[#ADADAD]
                     text-[#1E1E1E] bg-[#FCFCFC] hover:bg-[#F2F2F2] transition-colors
                     disabled:opacity-50 disabled:cursor-default"
        >
          {printing ? '출력 중…' : '임시 출력'}
        </button>
      </div>

      {note && <div className="text-[13px] text-[#787878] mb-[8px]">{note}</div>}

      <div className="rounded-[11px] bg-[#F2F2F2] py-[22px] px-[16px] overflow-x-auto">
        <Paper lines={buildLines(kind, config, sample)} />
        <div className="text-center text-[10px] text-[#787878] mt-[12px]">
          79mm 용지 · 한 줄 {LINE_CHARS}자 실제 비율
        </div>
      </div>
    </div>
  )
}
