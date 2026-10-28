import { useState, useEffect } from 'react'
import Working from '../components/ui/Working'
import { HubSection } from '../components/hub/HubLayout'
import { supabase, type DbAccount } from '../lib/supabase'
import { useStore } from '../lib/store-context'
import { qrUrlFor, qrDataUrl, PAPER_OPTIONS, DEFAULT_QR_NOTICE, paperGeometry, fontSizesFor, mmToCm, CELL_GAP, type QrPaper } from '../lib/qr-order'
import { printQrSheet } from '../components/ui/QrSheetPrinter'
import { usePrinterConfig } from '../hooks/usePrinterConfig'
import { paperChoice } from '../lib/printer-paper'
import LoadingBlock from '../components/ui/LoadingBlock'

// 고객 허브에 있던 걸 설정으로 옮겼다 — QR 종이를 뽑는 건 "고객을 보는 일"이 아니라
// "장비를 다루는 일"에 가깝다. 프린터 연결·영수증 설정과 같은 묶음에 있는 게 찾기 쉽다.

// ── QR출력 ─────────────────────────────────────────────────────────────────
//
// 이 화면의 목표는 QR을 "만드는" 게 아니라 "나눠주는" 것이다. 고객 화면 사이드패널에서
// 이미 한 곳씩은 뽑을 수 있다. 추진하기로 한 배포 방식이 "QR 종이를 각 사무실에 배부"라
// 여러 장을 한 번에 뽑는 게 핵심이다.

/**
 * 영수증 프린터로 나가는 모습 그대로의 미리보기.
 *
 * ⚠️ 이 컴포넌트는 **electron/escpos.ts 의 buildQrReceiptEscPos 와 짝**이다.
 *    전엔 영수증을 골라도 A4 카드 양식(가게명·거래처명·QR·안내문)이 보였는데,
 *    실제로 나오는 건 전혀 다른 양식이었다 — 머리글 [거래처 선결제 QR오더],
 *    점선, QR, 점선, 계정/관리자/연락처/PIN 표, 점선, 매장명.
 *    종이를 뽑아보기 전엔 뭐가 나올지 알 수 없었다.
 *    한쪽을 고치면 **반드시 다른 쪽도** 고쳐야 한다.
 */
/** 미리보기 종이 폭(px)과 좌우 여백 — 실제 비율을 흉내 내는 기준값 */
const RECEIPT_PREVIEW_W = 232
const RECEIPT_PREVIEW_PAD = 14
/**
 * 인쇄 폭의 몇 %를 QR 에 내줄지 — **electron/escpos.ts 의 QR_FILL_RATIO 와 같은 값.**
 * 한쪽만 고치면 미리보기와 종이가 어긋난다.
 */
const QR_FILL_RATIO = 0.72

/**
 * 미리보기 QR 크기.
 *
 * 실제 출력이 인쇄 가능 폭의 QR_FILL_RATIO 만큼을 차지하므로 미리보기도 같은 비율로 둔다.
 * 전엔 150px 로 박아둬서 실물보다 작게 보였다.
 */
const QR_PREVIEW_PX = Math.round((RECEIPT_PREVIEW_W - RECEIPT_PREVIEW_PAD * 2) * QR_FILL_RATIO)

function ReceiptPreview({ storeName, accountName, manager, phone, qrImg, storePhone, notice, paperLabel }: {
  storeName:   string
  accountName: string
  manager:     string
  phone:       string
  qrImg:       string
  storePhone:  string
  /** QR 바로 아래 한 줄 — escpos 쪽도 같은 자리에 찍는다 */
  notice:      string
  paperLabel:  string
}) {
  // 점선 — ESC/POS 쪽 L.hr() 과 같은 자리에 온다
  const hr = <div className="border-t border-dashed border-[#9A9A9A]" />
  // 라벨 열 — padL(label, 6) 과 같은 리듬(라벨 폭 고정 + 두 칸 띄우기)
  const row = (label: string, value: string) => (
    <div className="flex gap-[10px] leading-[1.7]">
      <span className="w-[46px] flex-shrink-0 text-[#414141]">{label}</span>
      <span className="min-w-0 flex-1 break-all text-[#1E1E1E]">{value}</span>
    </div>
  )

  return (
    <div>
      {/* 감열지 한 장. 폭은 고정 232px — 실제 비율이 아니라 **양식**을 보여주는 게 목적이다
          (A4 미리보기는 비율이 중요해서 mm 로 그린다) */}
      <div className="bg-white mx-auto shadow-[0_1px_6px_rgba(0,0,0,0.14)] py-[16px] flex flex-col gap-[9px]"
           /* 좌우 여백은 상수로 — QR 크기 계산과 같은 값을 써야 비율이 맞는다 */
           style={{ width: RECEIPT_PREVIEW_W, paddingLeft: RECEIPT_PREVIEW_PAD, paddingRight: RECEIPT_PREVIEW_PAD, fontFamily: "'Courier New', monospace" }}>
        <div className="text-center text-[12px] font-bold text-[#1E1E1E] leading-snug break-all">
          [{accountName} 선결제 QR오더]
        </div>
        {hr}

        {/* QR — 실제 출력은 **인쇄 폭을 거의 꽉** 채운다(escpos.ts 의 fitQrModule).
            전엔 여기만 150px 로 작게 그려서, 미리보기를 믿고 뽑으면 실물이 달랐다.
            종이 폭에서 좌우 여백을 뺀 만큼을 그대로 쓴다. */}
        <div className="flex justify-center py-[2px]">
          {qrImg
            ? <img src={qrImg} alt="" style={{ width: QR_PREVIEW_PX, height: QR_PREVIEW_PX }} />
            : <div style={{ width: QR_PREVIEW_PX, height: QR_PREVIEW_PX, background: '#F2F2F2' }} />}
        </div>

        {/* 안내 문구 — QR 바로 아래 한 줄. 실제 출력도 여기에 찍힌다.
            nowrap 으로 둬서 "두 줄이 되면 어떡하지"를 미리보기에서도 볼 수 있게 한다
            (15자 제한이 있어 실제로는 넘치지 않는다). */}
        {notice.trim() && (
          <div className="text-center text-[11px] text-[#1E1E1E] whitespace-nowrap overflow-hidden text-ellipsis">
            {notice}
          </div>
        )}
        {hr}

        <div className="text-[11px]">
          {row('계정', accountName)}
          {manager && row('관리자', manager)}
          {phone && row('연락처', phone)}
          {/* PIN 값은 찍지 않는다 — 종이가 벽에 붙으니까. escpos.ts 의 같은 줄과 맞춘다 */}
          {row('PIN', '관리자에게 문의')}
        </div>
        {hr}

        <div className="text-center text-[11px] text-[#1E1E1E] leading-[1.7]">
          <div className="font-bold">{storeName}</div>
          {storePhone && <div>{storePhone}</div>}
        </div>
      </div>

      <div className="mt-[10px] text-[11px] font-normal text-[#787878] text-center">
        영수증 {paperLabel} · 한 장에 1곳
      </div>
    </div>
  )
}

/**
 * 인쇄될 종이를 그대로 축소해 보여준다.
 *
 * 전에는 칸 하나만 그렸다 — "A4 4등분"을 골라도 한 칸짜리 카드가 나와서, 종이에 네 칸이
 * 어떻게 앉는지는 뽑아 봐야 알았다. 종이·여백·칸 간격을 QrSheetPrinter 와 같은 mm 값으로
 * 잡고 화면 배율만 곱한다. 그래서 여기 보이는 비율이 실제 출력 비율이다.
 */
/** 미리보기 한 칸에 들어갈 것. 칸 수보다 적게 주면 나머지는 **빈 칸**으로 남는다 */
export interface PreviewLabel { name: string; qrImg: string }

function PaperPreview({ paper, storeName, notice, pin, labels, totalLabels }: {
  paper:       QrPaper
  storeName:   string
  notice:      string
  pin:         string | null
  /** 첫 장에 실제로 찍힐 칸들. 전엔 칸마다 같은 이름을 그리고 투명도만 낮췄는데,
   *  한 곳만 골라도 나머지 세 칸에 그 이름이 흐리게 찍혀 "4장 나오나?" 로 읽혔다. */
  labels:      PreviewLabel[]
  /** 전체 장수(여러 장일 때 '첫 장만 보여주는 중'을 알리려고) */
  totalLabels: number
}) {
  const spec = PAPER_OPTIONS.find(p => p.key === paper)!
  // 영수증 폭은 프린터 설정에서 온다. 58mm 로 박아두면 80mm 프린터를 쓰는 매장에서
  // 미리보기가 실제보다 좁게 보이고, QR 이 종이 가운데 작게 찍히는 걸 설명할 수 없다.
  const { cfg } = usePrinterConfig()
  const rp   = paperChoice(cfg.paperWidth)
  const geo  = paperGeometry(paper, rp.printMM)
  const f    = fontSizesFor(geo.fontMM)
  const isReceipt = paper === 'receipt'

  // 종이 실치수(mm)와 인쇄 여백 — QrSheetPrinter 의 @page margin 과 같은 값
  const paperW = isReceipt ? rp.paperMM : 210
  const margin = isReceipt ? (rp.paperMM - rp.printMM) / 2 : 10
  const innerH = isReceipt ? geo.cellH : 277
  const paperH = innerH + margin * 2

  // 상자 안에 들어가도록 — 가로·세로 둘 다 맞춘다
  const BOX_W = 232, BOX_H = 376
  const k = Math.min(BOX_W / paperW, BOX_H / paperH)
  const mm = (v: number) => v * k

  const cells = Array.from({ length: geo.perPage }, (_, i) => i)

  return (
    <div>
      <div
        className="bg-white mx-auto shadow-[0_1px_6px_rgba(0,0,0,0.14)] relative"
        style={{ width: mm(paperW), height: mm(paperH) }}
      >
        <div
          className="absolute grid"
          style={{
            left: mm(margin), top: mm(margin),
            width: mm(paperW - margin * 2), height: mm(innerH),
            gridTemplateColumns: `repeat(${spec.cols}, 1fr)`,
            gridTemplateRows:    `repeat(${spec.rows}, 1fr)`,
            gap: mm(CELL_GAP),
          }}
        >
          {cells.map(i => {
            const label = labels[i]
            const on    = !!label
            return (
              <div
                key={i}
                className="flex flex-col items-center justify-center overflow-hidden"
                style={{
                  border: `${Math.max(1, mm(0.3))}px dashed ${on ? '#ADADAD' : '#E5E5E5'}`,
                  borderRadius: mm(3),
                  gap: mm(f.gap),
                  padding: `${mm(f.padY)}px ${mm(4)}px`,
                  opacity: on ? 1 : 0.45,
                }}
              >
                {/* 글자 크기는 QrSheetPrinter 와 같은 fontSizesFor() 를 쓴다.
                    미리보기만 따로 계산하면 "화면과 인쇄물이 다르다"가 생긴다.
                    Math.max(4, …) 하한은 화면에서만 — 종이에서는 안 쓰는 값이다 */}
                {/* 빈 칸은 **정말로 비운다** — 흐린 글자라도 들어가 있으면 그것도 찍히는 줄 안다 */}
                {on && <>
                <div style={{ fontSize: Math.max(4, mm(f.store)), color: '#787878' }}>{storeName} 선결제</div>
                <div
                  className="font-bold text-center"
                  style={{ fontSize: Math.max(5, mm(f.name)), lineHeight: 1.15, color: '#1E1E1E' }}
                >
                  {label.name}
                </div>
                {label.qrImg
                  ? <img src={label.qrImg} alt="" style={{ width: mm(geo.qrMM), height: mm(geo.qrMM) }} />
                  : <div style={{ width: mm(geo.qrMM), height: mm(geo.qrMM), background: '#F2F2F2' }} />}
                <div
                  className="text-center"
                  style={{ fontSize: Math.max(4, mm(f.notice)), lineHeight: 1.25, color: '#414141' }}
                >
                  {notice}
                </div>
                </>}
                {on && pin && (
                  <div style={{ fontSize: Math.max(4, mm(f.notice)), fontWeight: 600, letterSpacing: mm(f.notice * 0.25), color: '#6A635E' }}>
                    PIN {pin}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-[10px] text-[11px] font-normal text-[#787878] text-center">
        {isReceipt ? `영수증 ${rp.label}` : 'A4 210 × 297mm'} · 한 장에 {geo.perPage}칸
        {totalLabels > geo.perPage
          ? <span className="text-[#ADADAD]"> · 총 {totalLabels}장</span>
          : labels.length < geo.perPage && geo.perPage > 1 && (
            <span className="text-[#ADADAD]"> · 이번엔 {labels.length}칸만 채워져요</span>
          )}
      </div>
    </div>
  )
}

/**
 * 안내 문구 글자 수 상한.
 *
 * 15자인 이유는 **영수증 한 줄**이다. 한글은 인쇄 폭을 2칸 먹으니 15자 = 30칸이고,
 * 가장 좁은 용지(57mm · 32칸)에도 들어간다. 더 길게 허용하면 QR 바로 아래 한 줄이라는
 * 규칙이 깨져 두 줄로 흐르거나 잘린 채 나간다.
 */
/** 한 거래처당 매수 상한. 종이를 쓰는 동작이라 0 하나 더 누른 사고를 막는다 */
const MAX_PER_ACCOUNT = 50

const NOTICE_MAX = 15

export default function QrPrintPanel() {
  const { storeId, storeName } = useStore()
  // 영수증 미리보기 밑에 "영수증 79mm" 처럼 적어주기 위해 — 실제 출력 폭과 같은 값
  const { cfg } = usePrinterConfig()
  const [accounts, setAccounts] = useState<DbAccount[]>([])
  const [loading,  setLoading]  = useState(true)
  /**
   * 거래처별 **출력 매수**. 키가 없으면 미선택, 있으면 1 이상.
   *
   * 전엔 Set<string> 이라 "고른 곳 1곳당 1장"이 전부였다. 그런데 실제로는
   * 같은 거래처를 2~3장 뽑아 여러 층에 붙이거나, A4 한 장에 김다현 3장 +
   * KT 1장 식으로 섞어 뽑는 일이 많다. 수량이 없으면 그걸 할 방법이 없었다.
   */
  const [counts,   setCounts]   = useState<Map<string, number>>(new Map())
  const [paper,    setPaper]    = useState<QrPaper>('a4-4')
  const [notice,   setNotice]   = useState(DEFAULT_QR_NOTICE)
  const [printing, setPrinting] = useState(false)
  const [previewLabels, setPreviewLabels] = useState<PreviewLabel[]>([])
  /** 영수증 푸터에 찍을 매장 연락처 (stores.phone) */
  const [store, setStore] = useState<{ phone: string }>({ phone: '' })

  useEffect(() => {
    if (!storeId) return
    supabase.from('stores').select('phone').eq('id', storeId).maybeSingle()
      .then(({ data }) => setStore({ phone: data?.phone ?? '' }))
  }, [storeId])

  useEffect(() => {
    if (!storeId) return
    let cancelled = false
    supabase.from('accounts')
      .select('*')
      .eq('store_id', storeId).eq('is_active', true)
      .order('account_name')
      .then(({ data }) => {
        if (cancelled) return
        const rows = (data ?? []) as DbAccount[]
        setAccounts(rows)
        // 기본은 **아무것도 선택 안 함**. 전엔 전체 선택으로 열렸는데,
        // 한 곳만 다시 뽑으려고 들어와도 먼저 전체를 풀어야 해서 순서가 거꾸로였다.
        // 종이를 쓰는 동작이라 실수로 전부 출력되는 쪽이 비용이 크다 —
        // 고르고 누르는 게 맞다. 전체가 필요하면 머리줄 '전체 선택'이 한 번에 한다.
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [storeId])

  // 실제로 찍힐 순서대로 펼친다 — 거래처 목록 순서 × 각자의 매수.
  // 인쇄도 이 배열을 그대로 쓴다. 화면과 종이가 다른 순서면 믿을 수 없다.
  const labelQueue = accounts.flatMap(a => {
    const n = counts.get(a.account_code) ?? 0
    return Array.from({ length: n }, () => a)
  })
  const totalLabels = labelQueue.length

  const geo = paperGeometry(paper)
  // 영수증은 한 장에 하나, A4 는 칸 수만큼
  const perPage   = paper === 'receipt' ? 1 : geo.perPage
  const pageCount = Math.ceil(totalLabels / perPage)

  // 넘겨 보는 장. 선택을 줄여 장수가 줄면 범위를 벗어나므로 **그릴 때 한 번 더 가둔다** —
  // state 를 effect 에서 되돌리면 한 프레임 동안 빈 장이 번쩍인다.
  const [page, setPage] = useState(0)
  const safePage  = Math.min(page, Math.max(0, pageCount - 1))
  const pageSlice = labelQueue.slice(safePage * perPage, (safePage + 1) * perPage)
  const pageKey   = pageSlice.map(a => a.account_code).join('|')

  // 보고 있는 장의 QR 만 만든다. 전부 만들면 37곳 × 매수가 된다.
  useEffect(() => {
    if (pageSlice.length === 0) { setPreviewLabels([]); return }
    let cancelled = false
    Promise.all(pageSlice.map(async a => ({
      name:  a.account_name,
      qrImg: await qrDataUrl(qrUrlFor(a, storeId), 400).catch(() => ''),
    }))).then(ls => { if (!cancelled) setPreviewLabels(ls) })
    return () => { cancelled = true }
    // pageKey 로 걸어야 매 렌더마다 다시 만들지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, storeId])

  function toggle(code: string) {
    setCounts(prev => {
      const next = new Map(prev)
      if (next.has(code)) next.delete(code); else next.set(code, 1)
      return next
    })
  }

  /** 매수 증감. 0 이 되면 선택 해제 — '0장 선택됨'이라는 상태는 뜻이 없다 */
  function bump(code: string, delta: number) {
    setCounts(prev => {
      const next = new Map(prev)
      const v = (next.get(code) ?? 0) + delta
      if (v <= 0) next.delete(code)
      else next.set(code, Math.min(v, MAX_PER_ACCOUNT))
      return next
    })
  }

  async function handlePrint() {
    // 화면 미리보기와 **같은 배열**을 쓴다 (labelQueue). 따로 만들면 순서가 어긋난다.
    const chosen = labelQueue
    setPrinting(true)
    try {
      if (paper === 'receipt') {
        // 영수증은 매장 감열 프린터로 바로 보낸다. 브라우저 인쇄 대화상자를 거치면
        // 58mm 용지가 A4로 잡혀 엉뚱하게 나오고, 급할 때 쓰라는 선택지인데 손이 더 간다.
        for (const a of chosen) {
          await window.api?.printQrReceipt({
            accountName: a.account_name,
            manager:     a.contact_person ?? '',
            phone:       a.contact_phone  ?? '',
            pin:         '',   // PIN 은 종이에 찍지 않는다 — 아래 printQrSheet 주석 참고
            qrUrl:       qrUrlFor(a, storeId),
            storeName,
            storePhone:  store.phone,
            notice:      notice || DEFAULT_QR_NOTICE,
          })
        }
        return
      }

      await printQrSheet(
        chosen.map(a => ({
          accountName: a.account_name,
          manager:     a.contact_person ?? '',
          pin:         '',
          url:         qrUrlFor(a, storeId),
        })),
        // PIN 은 더 이상 종이에 찍지 않는다. QR 종이는 사무실 벽에 붙는데,
        // PIN 이 적혀 있으면 지나가는 누구나 그 거래처 잔액으로 주문할 수 있다.
        { paper, storeName, notice, showPin: false, docPrinter: cfg.docPrinter },
      )
    } finally {
      setPrinting(false)
    }
  }

  const allPicked = accounts.length > 0 && counts.size === accounts.length

  return (
    <div>
      <HubSection title="QR출력" />

      {loading ? (
        <LoadingBlock py={56} />
      ) : accounts.length === 0 ? (
        <div className="py-[56px] text-center text-[13px] font-normal text-[#ADADAD]">등록된 거래처가 없어요</div>
      ) : (
        <div className="flex gap-[36px]">
          {/* ── 좌: 미리보기 — 고른 용지가 실제로 어떻게 찍히는지 ── */}
          <div className="flex-shrink-0" style={{ width: 260 }}>
            <div className="text-[13px] font-normal text-[#6A635E] mb-[12px]">미리보기</div>
            <div className="bg-[#F2F2F2] rounded-[10px] px-[14px] py-[16px]">
              {/* 장 넘김 — 박스 안 우상단. 전엔 '첫 장만 보여드려요'로 끝내서
                  둘째 장부터 무엇이 찍히는지 확인할 방법이 없었다.
                  버튼색은 박스 바탕(#F2F2F2)에서 한 단계만 내린 #E8E4E2 —
                  미리보기 종이가 주인공이라 조작부가 먼저 눈에 띄면 안 된다. */}
              {pageCount > 1 && (
                <div className="flex items-center justify-end gap-[4px] mb-[10px]">
                  <span className="text-[11px] font-normal text-[#787878] tabular-nums mr-[2px]">
                    {safePage + 1} / {pageCount}
                  </span>
                  {/* 꺾쇠 — Figma 491:3390 을 재서 맞췄다.
                      수직에서 **40°**(45° 가 아니다 — 더 벌어진 모양),
                      선 두께는 아이콘 높이의 **0.17**. 글자(‹ ›)로 두면 폰트마다
                      굵기·세로중심이 달라지고 키워도 가늘어지기만 해서 SVG 로 둔다. */}
                  <button
                    onClick={() => setPage(Math.max(0, safePage - 1))}
                    disabled={safePage === 0}
                    aria-label="이전 장"
                    className="pressable-tab w-[26px] h-[34px] rounded-[8px] bg-[#E8E4E2] text-[#6A635E] flex items-center justify-center hover:bg-[#DCD6D1] disabled:opacity-35 transition-colors"
                  >
                    <svg width="11" height="20" viewBox="0 0 12 22" fill="none">
                      <path d="M9.4 3.5L2.8 11L9.4 18.5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                    disabled={safePage >= pageCount - 1}
                    aria-label="다음 장"
                    className="pressable-tab w-[26px] h-[34px] rounded-[8px] bg-[#E8E4E2] text-[#6A635E] flex items-center justify-center hover:bg-[#DCD6D1] disabled:opacity-35 transition-colors"
                  >
                    <svg width="11" height="20" viewBox="0 0 12 22" fill="none">
                      <path d="M2.6 3.5L9.2 11L2.6 18.5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              )}
              {/* 용지에 따라 **다른 양식**을 보여준다.
                  영수증은 감열 프린터로 ESC/POS 가 바로 나가고(escpos.ts),
                  A4 는 브라우저 인쇄로 카드가 나간다(QrSheetPrinter). 두 양식이
                  전혀 다른데 전엔 둘 다 A4 카드로 그려서, 영수증을 고르면
                  미리보기와 실물이 따로 놀았다. */}
              {paper === 'receipt' ? (
                <ReceiptPreview
                  storeName={storeName}
                  accountName={pageSlice[0]?.account_name ?? '거래처'}
                  manager={pageSlice[0]?.contact_person ?? ''}
                  phone={pageSlice[0]?.contact_phone ?? ''}
                  qrImg={previewLabels[0]?.qrImg ?? ''}
                  storePhone={store.phone}
                  notice={notice || DEFAULT_QR_NOTICE}
                  paperLabel={paperChoice(cfg.paperWidth).label}
                />
              ) : (
                <PaperPreview
                  paper={paper}
                  storeName={storeName}
                  notice={notice || DEFAULT_QR_NOTICE}
                  pin={null}
                  labels={previewLabels}
                  totalLabels={totalLabels}
                />
              )}
            </div>

            {/* 인쇄 버튼은 미리보기 바로 아래, 그 박스와 같은 폭으로 둔다.
                "이걸 뽑는다"와 "뽑기" 사이에 눈이 움직일 거리가 없는 게 맞다.
                높이는 폭(260) 대비 약 1/5 — 오른쪽 설정 칼럼의 버튼보다 크다 */}
            <button
              onClick={handlePrint}
              disabled={totalLabels === 0 || printing}
              className="pressable w-full h-[52px] mt-[12px] rounded-[11px] bg-[#2C261F] text-[#F9F9F9] text-[15px] font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {printing ? <Working label="출력 중" /> : `${totalLabels}장 인쇄하기`}
            </button>
          </div>

          {/* ── 우: 발급 설정 ── */}
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-normal text-[#6A635E] mb-[12px]">발급 설정</div>

            {/* 용지 */}
            <div className="mb-[20px]">
              <div className="text-[12px] font-medium text-[#2C261F] mb-[8px]">용지</div>
              <div className="flex gap-[8px]">
                {PAPER_OPTIONS.map(o => (
                  <button
                    key={o.key}
                    onClick={() => setPaper(o.key)}
                    title={o.note}
                    className={`h-[32px] px-[12px] rounded-[9px] text-[13px] font-normal transition-colors ${
                      paper === o.key ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="mt-[7px] text-[11px] font-normal text-[#ADADAD]">
                {PAPER_OPTIONS.find(o => o.key === paper)?.note}
              </div>
              {/* 인쇄해 보고서야 "너무 작다"를 알면 종이와 잉크를 버리게 된다.
                  실제 종이 치수에서 역산한 값을 미리 보여준다 */}
              <div className="mt-[8px] rounded-[9px] bg-[#F2F2F2] px-[13px] py-[10px] flex items-center gap-[14px]">
                <div>
                  <div className="text-[11px] font-normal text-[#787878] mb-[3px]">QR 실제 크기</div>
                  <div className="text-[15px] font-medium text-[#1E1E1E]">
                    {mmToCm(geo.qrMM)} × {mmToCm(geo.qrMM)}
                  </div>
                </div>
                <div className="w-px h-[28px] bg-[#D9D9D9]" />
                {/* 성격이 다른 두 숫자를 한 라벨에 묶지 않는다.
                    전에는 '한 장에 : 8곳 · 총 4장' 이라 "한 장에 4장"으로 읽혔다.
                    '8곳'은 용지가 정하는 값이고, '4장'은 고른 거래처 수가 정하는 값이다. */}
                {paper === 'receipt' ? (
                  <div>
                    <div className="text-[11px] font-normal text-[#787878] mb-[3px]">영수증</div>
                    <div className="text-[15px] font-medium text-[#1E1E1E]">
                      {totalLabels > 0 ? `${totalLabels}장` : '—'}
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <div className="text-[11px] font-normal text-[#787878] mb-[3px]">한 장에</div>
                      <div className="text-[15px] font-medium text-[#1E1E1E]">{geo.perPage}곳</div>
                    </div>
                    <div className="w-px h-[28px] bg-[#D9D9D9]" />
                    <div>
                      <div className="text-[11px] font-normal text-[#787878] mb-[3px]">용지 수</div>
                      <div className="text-[15px] font-medium text-[#1E1E1E]">
                        {totalLabels > 0 ? `${pageCount}장` : '—'}
                      </div>
                    </div>
                  </>
                )}
                {geo.qrMM < 20 && (
                  <div className="text-[11px] font-normal text-danger ml-auto">
                    2cm 아래면 휴대폰이 잘 못 읽어요
                  </div>
                )}
              </div>
            </div>



            {/* 안내 문구 — QR 바로 아래 한 줄로 찍힌다 */}
            <div className="mb-[20px]">
              <div className="flex items-baseline justify-between mb-[8px]">
                <span className="text-[12px] font-medium text-[#2C261F]">안내 문구</span>
                {/* 한계를 치기 전에 보여준다 — 다 치고 나서 잘리면 뭐가 없어졌는지 모른다 */}
                <span className={`text-[11px] tabular-nums ${notice.length >= NOTICE_MAX ? 'text-[#C92A2A]' : 'text-[#ADADAD]'}`}>
                  {notice.length}/{NOTICE_MAX}
                </span>
              </div>
              <input
                value={notice}
                onChange={e => setNotice(e.target.value.slice(0, NOTICE_MAX))}
                placeholder={DEFAULT_QR_NOTICE}
                className="field-soft w-full h-[40px] px-[13px] rounded-[9px] border border-[#D9D9D9] text-[13px] text-[#1E1E1E] outline-none"
              />
              <div className="text-[11px] font-normal text-[#ADADAD] mt-[6px] leading-relaxed">
                QR 바로 아래에 한 줄로 찍혀요.
              </div>
            </div>

            {/* 대상 거래처 */}
            <div className="mb-[16px]">
              <div className="flex items-center justify-between mb-[8px]">
                <span className="text-[12px] font-medium text-[#2C261F]">
                  출력 대상: {counts.size}곳 · {totalLabels}장
                </span>
                <button
                  onClick={() => setCounts(allPicked ? new Map() : new Map(accounts.map(a => [a.account_code, 1])))}
                  className="text-[12px] font-normal text-[#6A635E] hover:text-ink transition-colors"
                >
                  {allPicked ? '전체 해제' : '전체 선택'}
                </button>
              </div>
              <div className="rounded-[10px] bg-[#F2F2F2] p-[10px] max-h-[220px] overflow-y-auto flex flex-wrap gap-[6px]">
                {/* 고르면 그 칩 안에서 바로 매수를 올린다. 수량을 따로 모아 두면
                    "어느 줄이 어느 거래처 것인지"를 다시 맞춰 봐야 한다. */}
                {accounts.map(a => {
                  const n = counts.get(a.account_code) ?? 0
                  const on = n > 0
                  return (
                    <div
                      key={a.account_code}
                      className={`h-[30px] rounded-[8px] text-[12px] font-normal flex items-center transition-colors ${
                        on ? 'bg-[#6A635E] text-[#FCFCFC] pr-[4px]' : 'bg-[#FCFCFC] text-[#787878] hover:bg-[#E8E4E2]'
                      }`}
                    >
                      <button
                        onClick={() => toggle(a.account_code)}
                        className="h-full px-[11px] whitespace-nowrap"
                        title={on ? '선택 해제' : '선택'}
                      >
                        {a.account_name}
                      </button>
                      {on && (
                        <span className="flex items-center gap-[1px] flex-shrink-0">
                          <button
                            onClick={() => bump(a.account_code, -1)}
                            aria-label={`${a.account_name} 한 장 빼기`}
                            className="w-[20px] h-[22px] rounded-[5px] bg-white/15 hover:bg-white/30 transition-colors leading-none"
                          >−</button>
                          <span className="min-w-[20px] text-center tabular-nums font-medium">{n}</span>
                          <button
                            onClick={() => bump(a.account_code, 1)}
                            disabled={n >= MAX_PER_ACCOUNT}
                            aria-label={`${a.account_name} 한 장 더`}
                            className="w-[20px] h-[22px] rounded-[5px] bg-white/15 hover:bg-white/30 disabled:opacity-30 transition-colors leading-none"
                          >+</button>
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}

