import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { won } from '../../lib/ipc'
import LoadingBlock from '../ui/LoadingBlock'
import { NUM, NUM_STRONG, NUM_MUTED } from '../../lib/number-style'

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
  /** 최근 주문 20건 — '언제 왔나'는 월별 막대로는 답이 안 된다 */
  recent:     { date: string; time: string; dow: string; method: string; amount: number; items: string | null }[]
}

// 시간대 경계는 customer_profile() RPC 안의 case 문과 **같은 값**이다.
//   hour < 11 → 아침 / < 15 → 점심 / < 18 → 오후 / 그 외 → 저녁
// 화면에 범위를 같이 적어주지 않으면 "점심이 몇 시부터인데?"를 알 길이 없다.
// RPC 를 고치면 여기 range 도 같이 고쳐야 한다.
//
// 아침의 시작을 08시로 적는 이유: RPC 는 11시 **이전 전부**를 아침으로 넣는데,
// 실제 주문 기록에서 가장 이른 주문이 09시다(08시 이전 주문은 0건). 그래서
// '08~11시' 가 현실과 어긋나지 않는다. 혹시 새벽 주문을 받기 시작하면
// 이 레이블이 거짓이 되므로 그때 RPC 와 함께 고쳐야 한다.
const SLOTS = [
  { slot: '아침', range: '08~11시' },
  { slot: '점심', range: '11~15시' },
  { slot: '오후', range: '15~18시' },
  { slot: '저녁', range: '18시~'  },
] as const

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

  /** 시간대 × 평일/주말 교차 칸 하나 */
  function slotN(part: '평일' | '주말', slot: string) {
    return p?.slots.find(x => x.part === part && x.slot === slot)?.n ?? 0
  }
  // 가장 많이 오는 칸 — 표에서 한 칸만 진하게 집어준다.
  // 숫자를 전부 같은 굵기로 두면 "그래서 언제 오는 사람인데?"에 눈이 멈출 곳이 없다.
  const peak = p
    ? SLOTS.flatMap(s => (['평일', '주말'] as const)
        .map(part => ({ part: part as string, slot: s.slot as string, n: slotN(part, s.slot) })))
        .reduce((a, b) => (b.n > a.n ? b : a), { part: '', slot: '', n: 0 })
    : null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[18px] shadow-[0_2px_10px_rgba(44,38,31,0.08)] w-[520px] max-w-[92vw] max-h-[86vh] flex flex-col overflow-hidden"
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
              {/* 요약 — 관계의 길이(문장)와 크기(숫자)를 나눠 놓는다.
                  전엔 "2건 · 45,900원 · 평균 22,950원 · 평소 17.8일마다" 처럼 가운뎃점으로
                  이어 붙인 한 줄이었다. 네 개가 전부 같은 크기·같은 색이라 어디까지가
                  한 값인지 읽으면서 끊어야 했고, '45,900'과 '22,950'이 나란히 있는데
                  무엇이 누적이고 무엇이 평균인지는 앞의 '평균' 두 글자에만 달려 있었다.
                  라벨을 값 위에 올려 네 칸으로 나눈다. */}
              <div className="rounded-[11px] bg-[#F2F2F2] px-[16px] py-[14px] mb-[20px]">
                <div className="text-[14px] font-medium text-[#1E1E1E] mb-[12px]">
                  {p.first_at?.slice(0, 10)}부터 {p.months}개월째 오고 계세요
                </div>
                <div className="grid grid-cols-2 gap-[7px]">
                  {([
                    { label: '주문 횟수',   value: `${p.orders}건` },
                    { label: '누적 주문액', value: won(p.amount) },
                    ...(p.avg_amount != null ? [{ label: '평균 주문액', value: won(p.avg_amount) }] : []),
                    ...(p.cycle_days != null ? [{ label: '주문 주기',   value: `${p.cycle_days}일` }] : []),
                  ]).map(st => (
                    <div key={st.label} className="bg-[#FCFCFC] rounded-[9px] px-[12px] py-[9px]">
                      <div className="text-[11px] font-normal text-[#787878]">{st.label}</div>
                      <div className="text-[15px] font-semibold text-[#1E1E1E] tabular-nums mt-[2px]">{st.value}</div>
                    </div>
                  ))}
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
              {/* '줄고 있어요' — 전엔 빨간 글자 한 줄이 막대 아래에 떠 있어서
                  차트의 일부인지 경고인지 구분이 안 됐다. 박스에 담고 아이콘을 붙여
                  "이건 읽어야 하는 말"로 만든다. 왜 그렇게 판단했는지도 같이 적는다 —
                  근거 없는 경고는 점주가 두 번째부터 무시한다. */}
              {declining ? (
                <div className="mt-[11px] mb-[20px] flex items-start gap-[9px] rounded-[10px] bg-[#FFEFEF] px-[13px] py-[11px]">
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-[1px]">
                    <path d="M8 2.5L14.5 13.5H1.5L8 2.5Z" stroke="#C92A2A" strokeWidth="1.5" strokeLinejoin="round"/>
                    <path d="M8 6.5V9.5" stroke="#C92A2A" strokeWidth="1.5" strokeLinecap="round"/>
                    <circle cx="8" cy="11.4" r="0.8" fill="#C92A2A"/>
                  </svg>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-[#C92A2A] leading-snug">주문이 줄고 있어요</div>
                    <div className="text-[12px] font-normal text-[#A94442] mt-[3px] leading-relaxed">
                      가장 많았던 달 {maxMonth}건의 절반도 안 되는 {p.monthly[p.monthly.length - 1].n}건이에요
                      {' '}({p.monthly[p.monthly.length - 1].label} 기준).
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mb-[20px]" />
              )}

              {/* 선호 메뉴 */}
              <div className="text-[13px] font-medium text-[#2C261F] mb-[9px]">선호 메뉴</div>
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

              {/* 주로 오는 시간 — 시간대(행) × 평일·주말(열) 교차표.
                  평일과 주말을 나눠 세는 이유는 그대로다: 합치면 서로 다른 두 습관이 섞여
                  "아침도 저녁도 많다"로 뭉개진다. 실제로 평일엔 저녁, 주말엔 아침인 손님이 있었다.

                  전엔 평일/주말 카드 두 장 안에 아침·점심·저녁을 나열했다. 그러면 '평일'과
                  '저녁'이 **같은 층처럼 읽혀서** 어느 쪽이 묶는 축인지 알 수 없었다.
                  축을 머리글로 못 박고(행=시간대, 열=평일/주말) 시간 범위까지 적어
                  '점심이 몇 시부터인지'를 화면에서 바로 읽게 한다. */}
              <div className="text-[13px] font-medium text-[#2C261F] mb-[9px]">주로 오는 시간</div>
              <div className="rounded-[11px] border border-[#E8E4E2] overflow-hidden mb-[20px]">
                {/* 머리글 — 여기가 '열은 평일/주말이다'라고 말해주는 유일한 자리 */}
                <div className="flex items-center h-[32px] px-[14px] bg-[#F2F2F2]">
                  <span className="flex-1 text-[11px] font-medium text-[#6A635E]">시간대</span>
                  <span className="w-[62px] text-right text-[11px] font-medium text-[#6A635E]">평일</span>
                  <span className="w-[62px] text-right text-[11px] font-medium text-[#6A635E]">주말</span>
                </div>
                {SLOTS.map(({ slot, range }) => {
                  const wd = slotN('평일', slot)
                  const we = slotN('주말', slot)
                  return (
                    <div key={slot} className="flex items-center h-[34px] px-[14px] border-t border-[#F2F2F2]">
                      <span className="flex-1 min-w-0 text-[12px] text-[#414141]">
                        {slot}
                        {/* 범위는 한 단계 흐리게 — 이름이 먼저 읽히고 범위가 뒤따라야 한다 */}
                        <span className="ml-[5px] text-[11px] font-normal text-[#ADADAD] tabular-nums">{range}</span>
                      </span>
                      {([['평일', wd], ['주말', we]] as const).map(([part, n]) => (
                        <span
                          key={part}
                          className={`w-[62px] text-right text-[12px] tabular-nums ${
                            n === 0
                              ? 'font-normal text-[#D7D7D7]'
                              : peak && peak.n > 0 && peak.part === part && peak.slot === slot
                                ? 'font-semibold text-[#1E1E1E]'
                                : 'font-normal text-[#414141]'
                          }`}
                        >
                          {n === 0 ? '—' : `${n}건`}
                        </span>
                      ))}
                    </div>
                  )
                })}
                {/* 합계 — 평일·주말 둘 중 어느 쪽 사람인지는 이 줄이 답한다 */}
                <div className="flex items-center h-[32px] px-[14px] border-t border-[#E8E4E2] bg-[#FAFAFA]">
                  <span className="flex-1 text-[11px] font-medium text-[#6A635E]">합계</span>
                  <span className="w-[62px] text-right text-[12px] font-medium text-[#1E1E1E] tabular-nums">{p.weekday_n}건</span>
                  <span className="w-[62px] text-right text-[12px] font-medium text-[#1E1E1E] tabular-nums">{p.weekend_n}건</span>
                </div>
              </div>

              {/* 이용방법 */}
              <div className="text-[13px] font-medium text-[#2C261F] mb-[9px]">이용방법</div>
              <div className="flex gap-[8px] mb-[20px]">
                {p.methods.map(m => (
                  <span key={m.method} className="px-[11px] h-[28px] leading-[28px] rounded-[8px] bg-[#F2F2F2] text-[12px] font-normal text-[#414141]">
                    {m.method === '내점' ? '매장 식사' : m.method} {m.n}건
                  </span>
                ))}
              </div>

              {/* 언제 주문했나 — 월별 막대는 흐름을 보여주지만
                  "지난주에 왔나?"는 날짜가 있어야 답한다 */}
              <div className="text-[13px] font-medium text-[#2C261F] mb-[9px]">
                최근 주문
                <span className="ml-[6px] text-[11px] font-normal text-[#ADADAD]">
                  {p.orders > p.recent.length ? `${p.recent.length}건 / 전체 ${p.orders}건` : `${p.recent.length}건`}
                </span>
              </div>
              <div className="rounded-[11px] border border-[#E8E4E2] overflow-hidden">
                {p.recent.map((r, i) => (
                  <div key={i} className={`flex items-center px-[14px] py-[8px] gap-[10px] ${i > 0 ? 'border-t border-[#F2F2F2]' : ''}`}>
                    <span className={`w-[74px] flex-shrink-0 text-[12px] ${NUM}`}>
                      {r.date}<span className="text-[#ADADAD]">({r.dow})</span>
                    </span>
                    <span className={`w-[38px] flex-shrink-0 text-[11px] ${NUM_MUTED}`}>{r.time}</span>
                    <span className="flex-1 min-w-0 text-[12px] font-normal text-[#414141] truncate">{r.items ?? '—'}</span>
                    <span className={`flex-shrink-0 text-[12px] ${NUM_STRONG}`}>{won(r.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="bg-[#FCFCFC] flex justify-end px-[28px] py-[16px]">
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
