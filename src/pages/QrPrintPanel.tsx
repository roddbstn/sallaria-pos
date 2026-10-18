import { useState, useEffect } from 'react'
import { HubSection } from '../components/hub/HubLayout'
import { supabase, type DbAccount } from '../lib/supabase'
import { useStore } from '../lib/store-context'
import { qrUrlFor, qrDataUrl, PAPER_OPTIONS, DEFAULT_QR_NOTICE, paperGeometry, fontSizesFor, mmToCm, CELL_GAP, type QrPaper } from '../lib/qr-order'
import { printQrSheet } from '../components/ui/QrSheetPrinter'

// 고객 허브에 있던 걸 설정으로 옮겼다 — QR 종이를 뽑는 건 "고객을 보는 일"이 아니라
// "장비를 다루는 일"에 가깝다. 프린터 연결·영수증 설정과 같은 묶음에 있는 게 찾기 쉽다.

// ── QR출력 ─────────────────────────────────────────────────────────────────
//
// 이 화면의 목표는 QR을 "만드는" 게 아니라 "나눠주는" 것이다. 고객 화면 사이드패널에서
// 이미 한 곳씩은 뽑을 수 있다. 추진하기로 한 배포 방식이 "QR 종이를 각 사무실에 배부"라
// 여러 장을 한 번에 뽑는 게 핵심이다.

/**
 * 인쇄될 종이를 그대로 축소해 보여준다.
 *
 * 전에는 칸 하나만 그렸다 — "A4 4등분"을 골라도 한 칸짜리 카드가 나와서, 종이에 네 칸이
 * 어떻게 앉는지는 뽑아 봐야 알았다. 종이·여백·칸 간격을 QrSheetPrinter 와 같은 mm 값으로
 * 잡고 화면 배율만 곱한다. 그래서 여기 보이는 비율이 실제 출력 비율이다.
 */
function PaperPreview({ paper, storeName, accountName, notice, qrImg, pin, filled }: {
  paper:       QrPaper
  storeName:   string
  accountName: string
  notice:      string
  qrImg:       string
  pin:         string | null
  /** 이번에 뽑을 거래처 수 — 칸을 몇 개나 채우는지 보여준다 */
  filled:      number
}) {
  const spec = PAPER_OPTIONS.find(p => p.key === paper)!
  const geo  = paperGeometry(paper)
  const f    = fontSizesFor(geo.qrMM)
  const isReceipt = paper === 'receipt'

  // 종이 실치수(mm)와 인쇄 여백 — QrSheetPrinter 의 @page margin 과 같은 값
  const paperW = isReceipt ? 58 : 210
  const margin = isReceipt ? 4 : 10
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
            const on = i < filled
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
                <div style={{ fontSize: Math.max(4, mm(f.store)), color: '#787878' }}>{storeName} 선결제</div>
                <div
                  className="font-bold text-center"
                  style={{ fontSize: Math.max(5, mm(f.name)), lineHeight: 1.15, color: '#1E1E1E' }}
                >
                  {accountName}
                </div>
                {qrImg
                  ? <img src={qrImg} alt="" style={{ width: mm(geo.qrMM), height: mm(geo.qrMM) }} />
                  : <div style={{ width: mm(geo.qrMM), height: mm(geo.qrMM), background: '#F2F2F2' }} />}
                <div
                  className="text-center"
                  style={{ fontSize: Math.max(4, mm(f.notice)), lineHeight: 1.25, color: '#414141' }}
                >
                  {notice}
                </div>
                {pin && (
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
        {isReceipt ? '영수증 58mm' : 'A4 210 × 297mm'} · 한 장에 {geo.perPage}칸
        {filled < geo.perPage && geo.perPage > 1 && (
          <span className="text-[#ADADAD]"> · 이번엔 {filled}칸만 채워져요</span>
        )}
      </div>
    </div>
  )
}

export default function QrPrintPanel() {
  const { storeId, storeName } = useStore()
  const [accounts, setAccounts] = useState<DbAccount[]>([])
  const [loading,  setLoading]  = useState(true)
  const [picked,   setPicked]   = useState<Set<string>>(new Set())
  const [paper,    setPaper]    = useState<QrPaper>('a4-4')
  const [notice,   setNotice]   = useState(DEFAULT_QR_NOTICE)
  const [printing, setPrinting] = useState(false)
  const [preview,  setPreview]  = useState('')

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
        setPicked(new Set(rows.map(a => a.account_code)))   // 기본은 전체 — 배부가 목적이니까
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [storeId])

  // 미리보기는 "첫 번째로 고른 곳" 기준. 전부 그리면 느리고, 어차피 양식은 같다
  const first = accounts.find(a => picked.has(a.account_code)) ?? accounts[0]
  const firstUrl = first ? qrUrlFor(first, storeId) : ''

  useEffect(() => {
    if (!firstUrl) { setPreview(''); return }
    let cancelled = false
    qrDataUrl(firstUrl, 400).then(d => { if (!cancelled) setPreview(d) }).catch(() => setPreview(''))
    return () => { cancelled = true }
  }, [firstUrl])

  function toggle(code: string) {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code); else next.add(code)
      return next
    })
  }

  async function handlePrint() {
    const chosen = accounts.filter(a => picked.has(a.account_code))
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
        { paper, storeName, notice, showPin: false },
      )
    } finally {
      setPrinting(false)
    }
  }

  const geo = paperGeometry(paper)
  const pageCount = paper === 'receipt' ? picked.size : Math.max(1, Math.ceil(picked.size / geo.perPage))
  const allPicked = accounts.length > 0 && picked.size === accounts.length

  return (
    <div>
      <HubSection title="QR출력" />

      {loading ? (
        <div className="py-[56px] text-center text-[13px] font-normal text-[#787878]">불러오는 중…</div>
      ) : accounts.length === 0 ? (
        <div className="py-[56px] text-center text-[13px] font-normal text-[#ADADAD]">등록된 거래처가 없어요</div>
      ) : (
        <div className="flex gap-[36px]">
          {/* ── 좌: 미리보기 — 고른 용지가 실제로 어떻게 찍히는지 ── */}
          <div className="flex-shrink-0" style={{ width: 260 }}>
            <div className="text-[13px] font-normal text-[#6A635E] mb-[12px]">미리보기</div>
            <div className="bg-[#F2F2F2] rounded-[10px] px-[14px] py-[16px]">
              <PaperPreview
                paper={paper}
                storeName={storeName}
                accountName={first?.account_name ?? '거래처'}
                notice={notice || DEFAULT_QR_NOTICE}
                qrImg={preview}
                pin={null}
                filled={picked.size}
              />
            </div>

            {/* 인쇄 버튼은 미리보기 바로 아래, 그 박스와 같은 폭으로 둔다.
                "이걸 뽑는다"와 "뽑기" 사이에 눈이 움직일 거리가 없는 게 맞다.
                높이는 폭(260) 대비 약 1/5 — 오른쪽 설정 칼럼의 버튼보다 크다 */}
            <button
              onClick={handlePrint}
              disabled={picked.size === 0 || printing}
              className="pressable w-full h-[52px] mt-[12px] rounded-[11px] bg-[#2C261F] text-[#F9F9F9] text-[15px] font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {printing ? '출력 중…' : `${picked.size}곳 인쇄하기`}
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
                <div>
                  <div className="text-[11px] font-normal text-[#787878] mb-[3px]">
                    {paper === 'receipt' ? '영수증' : '한 장에'}
                  </div>
                  <div className="text-[15px] font-medium text-[#1E1E1E]">
                    {paper === 'receipt' ? `${picked.size}장` : `${geo.perPage}곳 · 총 ${pageCount}장`}
                  </div>
                </div>
                {geo.qrMM < 20 && (
                  <div className="text-[11px] font-normal text-danger ml-auto">
                    2cm 아래면 휴대폰이 잘 못 읽어요
                  </div>
                )}
              </div>
            </div>



            {/* 안내 문구 */}
            <div className="mb-[20px]">
              <div className="text-[12px] font-medium text-[#2C261F] mb-[8px]">안내 문구</div>
              <input
                value={notice}
                onChange={e => setNotice(e.target.value.slice(0, 30))}
                placeholder={DEFAULT_QR_NOTICE}
                className="field-soft w-full h-[40px] px-[13px] rounded-[9px] border border-[#D9D9D9] text-[13px] text-[#1E1E1E] outline-none"
              />
            </div>

            {/* 대상 거래처 */}
            <div className="mb-[16px]">
              <div className="flex items-center justify-between mb-[8px]">
                <span className="text-[12px] font-medium text-[#2C261F]">출력 대상: {picked.size}곳</span>
                <button
                  onClick={() => setPicked(allPicked ? new Set() : new Set(accounts.map(a => a.account_code)))}
                  className="text-[12px] font-normal text-[#6A635E] hover:text-ink transition-colors"
                >
                  {allPicked ? '전체 해제' : '전체 선택'}
                </button>
              </div>
              <div className="rounded-[10px] bg-[#F2F2F2] p-[10px] max-h-[220px] overflow-y-auto flex flex-wrap gap-[6px]">
                {accounts.map(a => {
                  const on = picked.has(a.account_code)
                  return (
                    <button
                      key={a.account_code}
                      onClick={() => toggle(a.account_code)}
                      className={`h-[30px] px-[11px] rounded-[8px] text-[12px] font-normal transition-colors ${
                        on ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#FCFCFC] text-[#787878] hover:bg-[#E8E4E2]'
                      }`}
                    >
                      {a.account_name}
                    </button>
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

