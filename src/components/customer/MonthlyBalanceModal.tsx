import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { won } from '../../lib/ipc'
import PrepaidTrendChart, { type TrendMonth } from '../ui/PrepaidTrendChart'
import { rollUpLedger, monthsFrom, type LedgerEvent } from '../../lib/prepaid-ledger'

// ── 월별 선결제 잔액 ─────────────────────────────────────────────────────────
//
// 매출 리포트의 '현재 선결제 잔액' 카드에서 열린다. 카드는 "지금 얼마"만 말하는데,
// 점주가 그걸 누르는 이유는 숫자 하나가 아니라 **"이걸 보고 뭘 해야 하나"** 다.
//
// 선결제 매장에서 그 답은 거의 언제나 하나로 모인다 — **충전 영업을 언제 시작하나.**
// 잔액은 손님이 밥을 먹을 때마다 줄고, 충전이 들어올 때만 는다. 그래서 봐야 할 건
// 잔액의 절대값이 아니라 **이번 달에 늘었나 줄었나**, 그리고 **이 속도면 언제 바닥인가**다.
//
// 그래서 이 화면이 먼저 말하는 것:
//   1. 이번 달 순증감 (충전 − 주문)  ← 지금 방향
//   2. 남은 개월 수 (잔액 ÷ 최근 평균 주문)  ← 언제 움직여야 하나
//   3. 월별 충전·주문·월말잔액 막대  ← 그 판단의 근거
//
// 처음엔 12개월 선 그래프였는데 버렸다. 거래가 6월에 시작돼서 앞의 일곱 달이 바닥에
// 깔린 평평한 선이 되고, 정작 볼 구간은 오른쪽 끝에 뭉쳤다. "12개월 전보다 +324만원"도
// 뺐다 — 12개월 전이 0원이라 증감률이 아니라 그냥 현재값을 다시 쓴 것이었다.
//
// ⚠️ 월말 잔액은 **거래 시점에 기록된 balance_after 스냅샷**이다. 원장(충전−주문)으로
//    역산하지 않는 이유: 침산점 기준 역산값이 실제 잔액과 695,800원 어긋난다(계정 10곳이
//    양쪽 방향으로). 거래처 등록 시 초기 잔액을 deposits 없이 직접 쓰는 경로가 있고,
//    소프트 삭제된 주문 35건의 차감이 환원되지 않은 것이 섞여 있다. 스냅샷은 같은 방식으로
//    현재를 계산했을 때 오차가 31,300원(1%)이라 20배 이상 정확하다.

type MonthRow = TrendMonth

export default function MonthlyBalanceModal({ storeId, currentTotal, onClose }: {
  storeId:      string
  /** accounts.current_balance 합계 — 이 화면이 믿는 '지금' 값 */
  currentTotal: number
  onClose:      () => void
}) {
  const [loading, setLoading] = useState(true)
  const [rows,    setRows]    = useState<MonthRow[]>([])
  // 조정 합계 — 막대엔 안 보이지만 잔액을 움직인 세 번째 축이라 설명이 필요하다
  const [adjustTotal, setAdjustTotal] = useState(0)
  // 거래처 필터 — 한 곳만 떼어 보면 "이 과가 잔액을 까먹고 있나"를 바로 알 수 있다.
  // 전체 합계로는 한 곳이 바닥나도 다른 곳 충전에 묻혀 안 보인다.
  const [accountList, setAccountList] = useState<{ code: string; name: string }[]>([])
  const [picked,      setPicked]      = useState<string | null>(null)   // null = 전체
  const [filterOpen,  setFilterOpen]  = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!storeId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data: accRows } = await supabase
        .from('accounts').select('account_code, account_name')
        .eq('store_id', storeId).eq('is_active', true)
        .order('account_name')
      const all = (accRows ?? []) as { account_code: string; account_name: string }[]
      setAccountList(all.map(a => ({ code: a.account_code, name: a.account_name })))
      // 한 곳만 고르면 그 거래처의 원장만 누적한다
      const codes = picked ? [picked] : all.map(a => a.account_code)
      if (codes.length === 0) {
        if (!cancelled) { setRows([]); setLoading(false) }
        return
      }

      // 잔액을 움직이는 셋을 모두 가져온다 — 조정을 빼면 어긋난다(lib/prepaid-ledger 주석)
      const [ordRes, depRes, adjRes] = await Promise.all([
        supabase.from('orders')
          .select('ordered_at, total_amount')
          .in('account_code', codes).neq('status', '취소').eq('is_deleted', false),
        supabase.from('deposits')
          .select('created_at, amount').in('account_code', codes),
        supabase.from('balance_adjustments')
          .select('created_at, amount').in('account_code', codes),
      ])
      if (cancelled) return

      const events: LedgerEvent[] = [
        ...((ordRes.data ?? []) as { ordered_at: string; total_amount: number | null }[])
          .map(o => ({ at: o.ordered_at, delta: -(o.total_amount ?? 0), kind: 'order' as const, amount: o.total_amount ?? 0 })),
        ...((depRes.data ?? []) as { created_at: string; amount: number | null }[])
          .map(d => ({ at: d.created_at, delta: d.amount ?? 0, kind: 'deposit' as const, amount: d.amount ?? 0 })),
        ...((adjRes.data ?? []) as { created_at: string; amount: number | null }[])
          .map(b => ({ at: b.created_at, delta: b.amount ?? 0, kind: 'adjust' as const, amount: Math.abs(b.amount ?? 0) })),
      ]

      if (events.length === 0) {
        if (!cancelled) { setRows([]); setLoading(false) }
        return
      }

      const first  = events.reduce((a, b) => (a.at < b.at ? a : b)).at
      const months = monthsFrom(first)
      const built  = rollUpLedger(events, months)

      if (cancelled) return
      setRows(built.map(m => ({ key: m.key, deposit: m.deposit, order: m.order, balance: m.balance, active: m.active })))
      setAdjustTotal(built.reduce((s2, m) => s2 + m.adjust, 0))
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [storeId, picked])

  const latest = rows[rows.length - 1]
  const netThisMonth = latest ? latest.deposit - latest.order : 0

  // 소진 속도 — 최근 3개월(이번 달 제외) 평균 주문액. 이번 달은 아직 안 끝나서 평균을 낮춘다
  const burnRate = useMemo(() => {
    const past = rows.slice(0, -1).filter(r => r.active).slice(-3)
    if (past.length === 0) return null
    const avg = past.reduce((s, r) => s + r.order, 0) / past.length
    return avg > 0 ? avg : null
  }, [rows])
  // 거래처를 하나 고르면 매장 전체 합계(currentTotal)는 더 이상 이 화면의 기준이 아니다.
  // 그 거래처의 마지막 달 잔액을 쓴다.
  const shownBalance = picked ? (latest?.balance ?? 0) : currentTotal
  const monthsLeft = burnRate && shownBalance > 0 ? shownBalance / burnRate : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-[20px]" onClick={onClose}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[14px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] w-[660px] max-w-full flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-[28px] pt-[26px] pb-[20px]">
          <div className="flex items-start justify-between mb-[2px]">
            <div className="text-[18px] font-semibold text-[#1E1E1E]">월별 선결제 잔액</div>
            <button
              onClick={onClose}
              aria-label="닫기"
              className="w-[26px] h-[26px] flex items-center justify-center rounded-[7px] text-[#ADADAD] hover:bg-[#F2F2F2] hover:text-[#787878] transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="text-[11px] font-normal text-[#ADADAD] mb-[20px]">
            충전이 들어올 때만 늘고, 손님이 드실 때마다 줄어요
          </div>

          {loading ? (
            <div className="py-[90px] text-center text-[13px] font-normal text-[#787878]">불러오는 중…</div>
          ) : rows.length === 0 ? (
            <div className="py-[90px] text-center text-[13px] font-normal text-[#ADADAD]">아직 거래 기록이 없어요</div>
          ) : (
            <>
              {/* 지금 상태 — 잔액과 이번 달 방향 */}
              <div className="flex gap-[10px] mb-[16px]">
                <div className="flex-1 bg-[#F2F2F2] rounded-[10px] px-[14px] py-[12px]">
                  <div className="text-[11px] font-normal text-[#787878] mb-[5px]">
                    {picked ? '이 거래처 잔액' : '현재 잔액'}
                  </div>
                  <div className={`text-[20px] font-medium ${shownBalance < 0 ? 'text-danger' : 'text-[#2C261F]'}`}>
                    {won(shownBalance)}
                  </div>
                </div>
                <div className="flex-1 bg-[#F2F2F2] rounded-[10px] px-[14px] py-[12px]">
                  <div className="text-[11px] font-normal text-[#787878] mb-[5px]">이번 달 순증감</div>
                  <div className={`text-[20px] font-medium ${netThisMonth >= 0 ? 'text-[#017333]' : 'text-danger'}`}>
                    {netThisMonth >= 0 ? '+' : '−'}{Math.abs(netThisMonth).toLocaleString('ko-KR')}원
                  </div>
                </div>
                <div className="flex-1 bg-[#F2F2F2] rounded-[10px] px-[14px] py-[12px]">
                  <div className="text-[11px] font-normal text-[#787878] mb-[5px]">남은 기간</div>
                  <div className="text-[20px] font-medium text-[#2C261F]">
                    {monthsLeft == null ? '—' : `약 ${monthsLeft.toFixed(1)}개월`}
                  </div>
                </div>
              </div>

              {/* 한 줄로 판단 — 숫자만 띄우면 엑셀이다.
                   문장이 둘이면 줄을 나눈다 — 한 줄로 이으면 어디서 끊어 읽을지가 안 보인다 */}
              {latest && (
                <div className="mb-[18px] rounded-[9px] bg-[#F2F2F2] px-[13px] py-[11px] text-[13px] font-normal text-[#1E1E1E] leading-relaxed flex flex-col gap-[4px]">
                  <div>
                    {latest.deposit === 0 && latest.order > 0 ? (
                      <>이번 달은 <span className="font-medium">충전이 한 건도 없고</span> 주문만 {won(latest.order)} 나가서 잔액이 그만큼 줄었어요.</>
                    ) : netThisMonth < 0 ? (
                      <>이번 달은 충전 {won(latest.deposit)}보다 주문 {won(latest.order)}이 많아 잔액이 {won(-netThisMonth)} 줄었어요.</>
                    ) : (
                      <>이번 달은 충전 {won(latest.deposit)}이 주문 {won(latest.order)}보다 많아 잔액이 {won(netThisMonth)} 늘었어요.</>
                    )}
                  </div>
                  {monthsLeft != null && (
                    <div>
                      최근 주문 속도가 이어지면 <span className="font-medium">약 {monthsLeft.toFixed(1)}개월</span> 뒤 잔액이 바닥나요
                      {monthsLeft < 2 ? <> — 충전 안내를 시작할 때예요.</> : <>.</>}
                    </div>
                  )}
                </div>
              )}

              {/* 월별 막대 — 계정 상세 모달과 같은 컴포넌트, 같은 색·같은 읽는 법 */}
              <div className="bg-[#FCFCFC] border border-[#E5E5E5] rounded-[10px] px-[16px] pt-[16px] pb-[12px]">
                <PrepaidTrendChart months={rows} height={150} barWidth={10} />
              </div>

              {/* 계산 근거와 남은 차이를 숨기지 않는다 */}
              {latest && (
                <div className="mt-[14px] text-[11px] font-normal text-[#ADADAD] leading-relaxed">
                  월말 잔액은 충전 − 주문{adjustTotal !== 0 && <> + 수기 조정({adjustTotal > 0 ? '+' : '−'}{Math.abs(adjustTotal).toLocaleString('ko-KR')}원)</>} 을 누적한 값이에요.
                  {!picked && Math.abs(currentTotal - latest.balance) > 0 && (
                    <> 지금 거래처 잔액 합계({won(currentTotal)})와는 {won(Math.abs(currentTotal - latest.balance))} 차이가 있는데,
                    거래 기록 없이 잔액이 설정된 초기 데이터 때문이에요.</>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-[#ADADAD] shadow-[0px_-5px_24.3px_4px_rgba(0,0,0,0.06)] px-[28px] py-[14px] flex justify-end items-center gap-[8px]">
          {/* 거래처 필터 — 위로 펼친다(푸터라 아래가 없다) */}
          <div className="relative">
            <button
              onClick={() => setFilterOpen(v => !v)}
              className={`pressable h-[42px] px-[16px] rounded-[10px] text-[14px] font-medium max-w-[220px] truncate ${
                picked ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878]'
              }`}
            >
              {picked ? (accountList.find(a => a.code === picked)?.name ?? '거래처') : '전체 거래처'}
            </button>
            {filterOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setFilterOpen(false)} />
                <div className="absolute left-0 bottom-full mb-[6px] z-30 w-[240px] max-h-[320px] overflow-y-auto bg-[#FCFCFC] border border-[#E5E5E5] rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)]">
                  <button
                    onClick={() => { setPicked(null); setFilterOpen(false) }}
                    className={`w-full px-[13px] h-[36px] text-left text-[12px] transition-colors ${
                      picked === null ? 'bg-[#F2F2F2] text-[#2C261F] font-medium' : 'text-[#414141] font-normal hover:bg-[#F2F2F2]'
                    }`}
                  >
                    전체 거래처
                  </button>
                  <div className="border-t border-[#E5E5E5]" />
                  {accountList.map(a => (
                    <button
                      key={a.code}
                      onClick={() => { setPicked(a.code); setFilterOpen(false) }}
                      className={`w-full px-[13px] h-[36px] text-left text-[12px] truncate transition-colors ${
                        picked === a.code ? 'bg-[#F2F2F2] text-[#2C261F] font-medium' : 'text-[#414141] font-normal hover:bg-[#F2F2F2]'
                      }`}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            onClick={onClose}
            className="pressable w-[86px] h-[42px] rounded-[10px] bg-[#E8E4E2] text-[#6A635E] text-[14px] font-medium hover:opacity-90"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
