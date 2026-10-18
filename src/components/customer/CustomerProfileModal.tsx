import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { won } from '../../lib/ipc'
import LoadingBlock from '../ui/LoadingBlock'

// 손님 한 명을 펼쳐 보는 화면.
//
// '주문 많은 손님' 표는 **누구를 볼지**를 고르게 하고, 이 화면은 **그 사람에게 뭘 할지**를
// 고르게 한다. 그래서 '다시 담기' 같은 버튼은 없다 — 손님 화면(QR웹)의 '지난번 주문한'과
// 데이터는 겹치지만 방향이 반대다. 거기선 손님이 빨리 다시 주문하고, 여기선 점주가 판단한다.
//
// 재료는 customer_profile() RPC 하나로 받는다. 요약·월별·메뉴·시간대를 따로 받으면
// 왕복이 네 번이 되고, 이 환경은 왕복이 10번 중 2번 1초를 넘는다.

interface Profile {
  orders:     number
  amount:     number
  avg_amount: number | null
  first_at:   string | null
  last_at:    string | null
  months:     number | null
  days_since: number | null
  cycle_days: number | null
  monthly:    { label: string; n: number }[]
  menus:      { name: string; c: number }[]
  slots:      { part: '평일' | '주말'; slot: string; n: number }[]
  weekday_n:  number
  weekend_n:  number
  methods:    { method: string; n: number }[]
}

const SLOT_ORDER = ['아침', '점심', '오후', '저녁'] as const

export default function CustomerProfileModal({
  storeId, ordererName, accountCode, accountName, onClose,
}: {
  storeId:     string
  ordererName: string
  accountCode: string
  accountName: string
  onClose:     () => void
}) {
  const [p, setP]         = useState<Profile | null>(null)
  const [loading, setLoad] = useState(true)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoad(true)
      const { data } = await supabase.rpc('customer_profile', {
        p_store_id: storeId, p_orderer_name: ordererName, p_account_code: accountCode,
      })
      if (cancelled) return
      setP((data ?? null) as Profile | null)
      setLoad(false)
    })()
    return () => { cancelled = true }
  }, [storeId, ordererName, accountCode])

  const maxMonth = p ? Math.max(1, ...p.monthly.map(m => m.n)) : 1
  // 월별 흐름이 줄고 있는지 — 마지막 달이 최고점의 절반 아래면 짚어준다.
  // 표에서는 "39건 1위"로만 보여서 잘 되는 손님처럼 읽히는데, 실제로는 내려오는 중일 수 있다.
  const declining = !!p && p.monthly.length >= 3 && p.monthly[p.monthly.length - 1].n < maxMonth / 2

  function slotsOf(part: '평일' | '주말') {
    if (!p) return []
    return SLOT_ORDER
      .map(s => ({ slot: s, n: p.slots.find(x => x.part === part && x.slot === s)?.n ?? 0 }))
      .filter(x => x.n > 0)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[14px] shadow-[0_2px_10px_rgba(44,38,31,0.08)] w-[520px] max-w-[92vw] max-h-[86vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-[28px] pt-[24px] pb-[16px] border-b border-[#E8E4E2]">
          <div className="text-[18px] font-semibold text-[#1E1E1E]">{ordererName}</div>
          <div className="text-[13px] font-normal text-[#787878] mt-[3px]">{accountName}</div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-[28px] py-[20px]">
          {loading ? <LoadingBlock py={50} /> : !p || p.orders === 0 ? (
            <div className="py-[50px] text-center text-[13px] font-normal text-[#ADADAD]">주문 기록이 없어요</div>
          ) : (
            <>
              {/* 요약 한 줄 — 관계의 길이와 크기 */}
              <div className="rounded-[11px] bg-[#F2F2F2] px-[16px] py-[13px] mb-[20px]">
                <div className="text-[14px] font-medium text-[#1E1E1E]">
                  {p.first_at?.slice(0, 10)}부터 {p.months}개월째 오고 계세요
                </div>
                <div className="text-[12px] font-normal text-[#6A635E] mt-[4px] tabular-nums">
                  {p.orders}건 · {won(p.amount)}
                  {p.avg_amount != null && <> · 평균 {won(p.avg_amount)}</>}
                  {p.cycle_days != null && <> · 평소 {p.cycle_days}일마다</>}
                </div>
              </div>

              {/* 월별 흐름 — 이 화면의 핵심. 목록에서는 안 보이는 것 */}
              <div className="text-[13px] font-medium text-[#2C261F] mb-[9px]">월별 주문</div>
              <div className="flex flex-col gap-[6px] mb-[6px]">
                {p.monthly.map(m => (
                  <div key={m.label} className="flex items-center gap-[10px]">
                    <span className="w-[38px] text-[12px] font-normal text-[#787878] tabular-nums">{m.label}</span>
                    <div className="flex-1 h-[16px] bg-[#F2F2F2] rounded-[4px] overflow-hidden">
                      <div className="h-full bg-[#6A635E] rounded-[4px]" style={{ width: `${(m.n / maxMonth) * 100}%` }} />
                    </div>
                    <span className="w-[34px] text-right text-[12px] font-medium text-[#1E1E1E] tabular-nums">{m.n}건</span>
                  </div>
                ))}
              </div>
              {declining && (
                <div className="text-[12px] font-medium text-danger mb-[20px]">줄고 있어요</div>
              )}
              {!declining && <div className="mb-[20px]" />}

              {/* 늘 시키는 것 */}
              <div className="text-[13px] font-medium text-[#2C261F] mb-[9px]">늘 시키는 것</div>
              <div className="rounded-[11px] border border-[#E8E4E2] overflow-hidden mb-[20px]">
                {p.menus.map((m, i) => (
                  <div key={m.name} className={`flex items-center px-[14px] h-[36px] ${i > 0 ? 'border-t border-[#F2F2F2]' : ''}`}>
                    <span className="flex-1 min-w-0 text-[12px] font-normal text-[#414141] truncate">{m.name}</span>
                    <span className="text-[12px] font-medium text-[#1E1E1E] tabular-nums">{m.c}회</span>
                    <span className="w-[48px] text-right text-[11px] font-normal text-[#ADADAD] tabular-nums">
                      {Math.round((m.c / p.orders) * 100)}%
                    </span>
                  </div>
                ))}
              </div>

              {/* 주로 오는 시간 — 평일과 주말을 나눠 센다.
                  합쳐 보면 서로 다른 두 습관이 섞여서 "아침도 저녁도 많다"로 뭉개진다.
                  실제로 평일엔 저녁, 주말엔 아침인 손님이 있었다. */}
              <div className="text-[13px] font-medium text-[#2C261F] mb-[9px]">주로 오는 시간</div>
              <div className="flex gap-[10px] mb-[20px]">
                {(['평일', '주말'] as const).map(part => {
                  const list  = slotsOf(part)
                  const total = part === '평일' ? p.weekday_n : p.weekend_n
                  return (
                    <div key={part} className="flex-1 rounded-[11px] border border-[#E8E4E2] px-[14px] py-[11px]">
                      <div className="flex items-baseline justify-between mb-[7px]">
                        <span className="text-[12px] font-medium text-[#1E1E1E]">{part}</span>
                        <span className="text-[11px] font-normal text-[#ADADAD] tabular-nums">{total}건</span>
                      </div>
                      {list.length === 0 ? (
                        <div className="text-[11px] font-normal text-[#ADADAD]">없음</div>
                      ) : list.map(x => (
                        <div key={x.slot} className="flex items-center justify-between py-[2px]">
                          <span className="text-[12px] font-normal text-[#787878]">{x.slot}</span>
                          <span className="text-[12px] font-medium text-[#1E1E1E] tabular-nums">{x.n}건</span>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>

              {/* 이용방법 */}
              <div className="text-[13px] font-medium text-[#2C261F] mb-[9px]">이용방법</div>
              <div className="flex gap-[8px]">
                {p.methods.map(m => (
                  <span key={m.method} className="px-[11px] h-[28px] leading-[28px] rounded-[8px] bg-[#F2F2F2] text-[12px] font-normal text-[#414141]">
                    {m.method === '내점' ? '매장 식사' : m.method} {m.n}건
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end px-[28px] py-[16px] border-t border-[#E8E4E2]">
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
