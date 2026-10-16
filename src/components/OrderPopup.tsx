import { useState } from 'react'
import { type Order } from '../lib/mock-data'
import { won, orderToPayload, parseNote } from '../lib/ipc'
import { supabase } from '../lib/supabase'
import { track } from '../lib/firebase'
import { useStore } from '../lib/store-context'
import { maskName, maskPhone } from '../lib/mask'
import { defaultPrepMins, readyClock } from '../lib/pickup-time'
import RevealText from './ui/RevealText'

// 복사 버튼 — 아이콘만. 전엔 [복사] 글자 배지라 옆의 전화번호·주소와 글자끼리 경쟁했다.
// 복사 직후 1.5초간 체크로 바뀌어 "눌렸다"를 알린다(토스트 없이).
function CopyButton({ text, variant = 'gray' }: { text: string; variant?: 'gray' | 'black' }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  // gray = 어두운 헤더 위, black = 밝은 회색 박스 위
  const color = copied ? '#00C45A' : variant === 'black' ? '#414141' : '#D9D9D9'
  return (
    <button
      onClick={handleCopy}
      aria-label={copied ? '복사됨' : '복사'}
      title={copied ? '복사됨' : '복사'}
      className="ml-[5px] p-[2px] rounded-[4px] hover:opacity-60 transition-opacity flex-shrink-0"
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="5.4" y="5.4" width="8.1" height="8.1" rx="1.8" stroke={color} strokeWidth="1.4" />
          <path d="M10.6 5.4V4.2A1.8 1.8 0 0 0 8.8 2.4H4.2A1.8 1.8 0 0 0 2.4 4.2v4.6a1.8 1.8 0 0 0 1.8 1.8h1.2"
                stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

interface Props {
  queue:      Order[]
  onClose:    () => void   // 현재(첫 번째) 주문 제거
  onApprove?: () => void
  /** 낙관적 처리 뒤 백그라운드 작업이 실패했을 때 — 화면은 이미 넘어가 있으므로 토스트로 알린다 */
  onError?:   (msg: string) => void
}

type Stage = 'summary' | 'approve' | 'reject'

const REJECT_REASONS = ['재료 소진', '마감시간 초과', '주문 폭주', '매장 사정', '기타']
// Figma 733:673 의 칩 8개 (5~40분, 5분 간격). 그 위 ±버튼으로 1분 단위 미세조정.
const PREP_PRESETS   = [5, 10, 15, 20, 25, 30, 35, 40]

// Figma 733:652 / 733:673 — 네이티브 캔버스 638×789.
// 프로젝트 공통 비율 FIGMA_SCALE(0.643)로 환산한 고정 px를 쓴다(lib/figma-scale.ts 참고).
const CARD_W   = 410  // 638 × 0.643
const CARD_GAP = 20   // 대기 카드 사이 간격 — Figma엔 없는 우리 큐 UI 값

// 마지막 승인 소요시간 기억 (세션 내 유지)
let lastPrepMins = 15

export default function OrderPopup({ queue, onClose, onApprove, onError }: Props) {
  const { storeName } = useStore()
  const [stage,    setStage]    = useState<Stage>('summary')
  const [prepMins, setPrepMins] = useState(lastPrepMins)
  const [reason,   setReason]   = useState('')
  const [sliding,  setSliding]  = useState(false)  // 슬라이드 애니메이션 중

  const order = queue[0]

  // 슬라이드 후 onClose 호출
  function dismiss() {
    if (sliding) return
    setSliding(true)
    setTimeout(() => {
      setSliding(false)
      setStage('summary')
      setPrepMins(lastPrepMins)
      setReason('')
      onClose()
    }, 320)
  }

  // 승인 화면 진입 — 소요시간 기본값을 손님이 고른 수령시간으로 맞춘다.
  // 한가하면 그대로 "접수"만 누르면 되고, 바쁘면 그 자리에서 덮어쓴다.
  function openApprove() {
    setPrepMins(defaultPrepMins(order.requestedPickupMinutes, lastPrepMins))
    setStage('approve')
  }

  // 접수/거부는 "낙관적"으로 처리한다.
  //
  // 피크타임에 점주는 팝업을 1초 안에 넘겨야 하는데, 예전엔 RPC + Realtime broadcast + 영수증
  // IPC 를 전부 await 한 뒤에야 카드가 넘어가서 버튼이 "처리 중…"으로 1~3초 멈춰 있었다.
  // 성공률이 사실상 100%인 작업을 기다리느라 매번 느린 셈이라, 화면은 즉시 넘기고
  // 뒷일은 백그라운드로 돌린다. 실패하면 onError 로 토스트를 띄운다(주문은 DB에 그대로 남아
  // 주문 화면에서 다시 처리할 수 있다).
  function handleApprove() {
    lastPrepMins = prepMins   // 다음 팝업 초기값으로 기억
    const target  = order     // dismiss 후 queue[0] 이 바뀌므로 지금 값을 붙잡는다
    const mins    = prepMins

    // 손님 화면에 안내할 시간은 **둘 중 긴 쪽**이다.
    //   · 주방이 30분 필요한데 손님이 10분 뒤에 온다고 했으면 → 30분 (음식이 늦는다)
    //   · 주방은 5분이면 되는데 손님이 30분 뒤에 온다고 했으면 → 30분 (손님이 그때 온다)
    // prep_minutes 는 주방 기준이라 그대로 두고, 안내용만 따로 계산한다.
    const notify = Math.max(mins, target.requestedPickupMinutes ?? 0)

    onApprove?.()
    dismiss()

    void (async () => {
      try {
        // ① approve_order RPC: 상태 → '조리중' + **소요시간·승인시각 기록**
        //    prep_minutes 를 같이 넘기지 않으면 홈 화면의 '남은 시간'이 기준을 잃는다
        //    (2026-10-15 이전엔 broadcast 로만 보내서 새로고침하면 사라졌다)
        const { error } = await supabase.rpc('approve_order', {
          p_order_code:   target.code,
          p_prep_minutes: mins,
        })
        if (error) throw error

        // ② broadcast로 예상 소요시간 전달 (fire-and-forget)
        const ch = supabase.channel(`orders:order_code=${target.code}`)
        await new Promise<void>(resolve => {
          ch.subscribe(st => {
            if (st !== 'SUBSCRIBED') return
            ch.send({ type: 'broadcast', event: 'ORDER_ACCEPTED', payload: { estimated_minutes: notify } })
              .finally(() => { supabase.removeChannel(ch); resolve() })
          })
          setTimeout(resolve, 3000)
        })

        // ③ Electron IPC (영수증 출력)
        const w = window as unknown as { api?: { approveOrder?: Function } }
        await w.api?.approveOrder?.({ order: orderToPayload(target, storeName), prepMins: mins })

        track('pos_order_approved', {
          order_code:   target.code,
          total_amount: target.total,
          method:       target.method,
          item_count:   target.items.length,
          prep_mins:    mins,
        })
      } catch (e) {
        onError?.(`접수 처리 실패 (#${target.orderNumber ?? ''}) — 주문 화면에서 다시 시도해주세요`)
        console.error('[OrderPopup] approve 실패:', e)
      }
    })()
  }

  function handleReject() {
    if (!reason) return
    const target = order
    const why    = reason

    dismiss()

    void (async () => {
      try {
        // ① cancel_order RPC (status → '취소' + 잔액 환원 — QR 웹사이트 postgres_changes 트리거)
        const { error } = await supabase.rpc('cancel_order', { p_order_code: target.code })
        if (error) throw error

        // ② broadcast로 거부 사유 전달 (fire-and-forget)
        const ch = supabase.channel(`orders:order_code=${target.code}`)
        await new Promise<void>(resolve => {
          ch.subscribe(st => {
            if (st !== 'SUBSCRIBED') return
            ch.send({ type: 'broadcast', event: 'ORDER_REJECTED', payload: { reason: why } })
              .finally(() => { supabase.removeChannel(ch); resolve() })
          })
          setTimeout(resolve, 3000)
        })

        // ③ Electron IPC
        const w = window as unknown as { api?: { rejectOrder?: Function } }
        await w.api?.rejectOrder?.({ orderCode: target.code, reason: why })

        track('pos_order_rejected', {
          order_code:   target.code,
          total_amount: target.total,
          method:       target.method,
          reason:       why,
        })
      } catch (e) {
        onError?.(`거부 처리 실패 (#${target.orderNumber ?? ''}) — 주문 화면에서 다시 시도해주세요`)
        console.error('[OrderPopup] reject 실패:', e)
      }
    })()
  }

  // 하단 버튼 — Figma 733:652/673 공통 (h 78→50, r 20→13, 거부·이전 171 : 승인·접수 377 ≈ 1:2.2)
  // 높이는 Figma 환산값(50)보다 키웠다 — 터치로도 누르는 POS라 손가락 목표를 넉넉히.
  // 굵기는 semibold → medium 한 단계 낮춤(카드 안에서 제일 굵은 글자가 버튼일 필요는 없다).
  const BTN = 'h-[58px] rounded-[13px] text-[18px] font-medium flex items-center justify-center transition-colors disabled:opacity-50'

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
      {/* 슬라이드 스트립 — card1 중앙 고정, card2는 오른쪽 끝에 반만 노출 */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: `calc(50% - ${CARD_W / 2}px)`,
          display: 'flex',
          gap: CARD_GAP,
          transform: sliding
            ? `translate(-${CARD_W + CARD_GAP}px, -50%)`
            : 'translate(0, -50%)',
          transition: sliding ? 'transform 0.32s cubic-bezier(0.4,0,0.2,1)' : 'none',
        }}
      >
          {queue.map((o, idx) => (
            <div
              key={o.code}
              style={{ width: CARD_W, flexShrink: 0, maxHeight: 'calc(100vh - 40px)' }}
              className={`bg-[#FCFCFC] rounded-[19px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] overflow-hidden flex flex-col ${idx > 0 ? 'opacity-60' : ''}`}
            >
              {/* ── 헤더 (Figma 578:1078 — h 158→102, bg #6A635E) ──
                  좌: 주문번호 + 이용방법 / 우: 주문시각 · 거래처|주문자 · 연락처 */}
              <div className="bg-[#6A635E] h-[102px] flex-shrink-0 px-[26px] flex justify-between">
                <div className="pt-[19px] flex flex-col gap-[6px]">
                  <span className="text-[#FCFCFC] text-[23px] font-semibold leading-[28px]">
                    #{o.orderNumber ?? String(idx + 1)}
                  </span>
                  <span className="text-[#FCFCFC] text-[23px] font-semibold leading-[28px]">{o.method}</span>
                </div>
                <div className="pt-[13px] flex flex-col items-end min-w-0">
                  <span className="text-[#FCFCFC] text-[13px] font-normal leading-none">
                    {new Date(o.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                  {/* 주문자 이름도 가린 채로 — 팝업은 카운터 앞에서 손님에게 그대로 보인다 */}
                  <span className="mt-[30px] text-[#FCFCFC] text-[15px] font-semibold leading-none flex items-center gap-[5px] max-w-full truncate">
                    {o.accountName === o.orderer ? o.accountName : (
                      <>
                        <span className="truncate">{o.accountName}</span>
                        <span>|</span>
                        <RevealText value={o.orderer} masked={maskName(o.orderer)} iconSize={13} onDark />
                      </>
                    )}
                  </span>
                  {o.phone && (
                    <span className="mt-[3px] flex items-center">
                      <RevealText
                        value={o.phone} masked={maskPhone(o.phone)}
                        className="text-[#D9D9D9] text-[12px] font-normal leading-none" iconSize={11} onDark
                      />
                      <CopyButton text={o.phone} variant="gray" />
                    </span>
                  )}
                </div>
              </div>

              {idx === 0 ? (
                <>
                  {/* ─────────── 1단계: 주문 요약 (Figma 733:652) ─────────── */}
                  {stage === 'summary' && (
                    <>
                      <div className="flex-1 overflow-y-auto px-[26px] pt-[40px] pb-[14px]">
                        {/* 메뉴 목록 — 메뉴명 | 수량, 그 아래 └ 단가 / └ 옵션 */}
                        {o.items.map((item, i) => (
                          <div key={i} className={`flex gap-[14px] ${i > 0 ? 'mt-[24px]' : ''}`}>
                            <div className="flex-1 min-w-0">
                              <div className="text-[20px] font-semibold text-[#1E1E1E] truncate">
                                {item.name} | {item.qty}개
                              </div>
                              <div className="mt-[12px] flex flex-col gap-[10px]">
                                <BranchLine>{won(item.price)}</BranchLine>
                                {item.options.map((opt, oi) => <BranchLine key={oi}>{opt}</BranchLine>)}
                              </div>
                            </div>
                            {/* 썸네일 131→84 */}
                            <div className="w-[84px] h-[84px] rounded-[6px] overflow-hidden flex-shrink-0 bg-[#F2F2F2]">
                              {item.imageUrl ? (
                                <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-[28px]">🍽️</div>
                              )}
                            </div>
                          </div>
                        ))}

                        <div className="h-px bg-[#D9D9D9] my-[26px]" />

                        <div className="flex items-center justify-between">
                          <span className="text-[15px] font-semibold text-[#1E1E1E]">합계</span>
                          <span className="text-[18px] font-semibold text-[#1E1E1E]">{won(o.total)}</span>
                        </div>

                        {/* 요청사항 / 배달 정보 */}
                        {(() => {
                          const { deliveryAddress, deliveryDetail, deliveryNote, customerNote } = parseNote(o.remarks)
                          const note = customerNote || (!deliveryAddress ? o.remarks : '')
                          return (
                            <>
                              {note && (
                                <>
                                  {/* '가게 요청사항' 라벨은 뺐다. 이 팝업에서 회색 박스에 담긴
                                      자유 문장은 이것뿐이라 박스 자체가 라벨 역할을 한다
                                      (홈 상세의 요청사항도 같은 이유로 라벨을 뺐다).
                                      배달 주소·배달 요청사항은 둘이 나란히 와서 구분이 필요하므로 라벨을 남긴다. */}
                                  <div className="mt-[32px] rounded-[13px] bg-[#F2F2F2] px-[19px] py-[16px] text-[15px] font-semibold text-[#1E1E1E] leading-[1.5] whitespace-pre-wrap">
                                    {note}
                                  </div>
                                </>
                              )}
                              {deliveryAddress && (
                                <>
                                  <div className="mt-[32px] text-[15px] font-normal text-[#1E1E1E]">배달 주소</div>
                                  <div className="mt-[13px] rounded-[13px] bg-[#F2F2F2] px-[19px] py-[16px]">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[15px] font-semibold text-[#1E1E1E] flex-1 min-w-0 truncate">{deliveryAddress}</span>
                                      <CopyButton text={deliveryAddress} variant="black" />
                                    </div>
                                    {deliveryDetail && (
                                      <div className="mt-[6px] flex items-center justify-between gap-2">
                                        <span className="text-[13px] font-normal text-[#787878] flex-1 min-w-0 truncate">{deliveryDetail}</span>
                                        <CopyButton text={deliveryDetail} variant="black" />
                                      </div>
                                    )}
                                    {deliveryNote && (
                                      <div className="mt-[10px] pt-[10px] border-t border-[#D9D9D9] text-[13px] font-normal text-[#414141]">
                                        {deliveryNote}
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}
                            </>
                          )
                        })()}
                      </div>

                      {/* 하단 버튼 — 거부(연분홍/빨강) : 승인(짙은 먹) = 171 : 377 */}
                      <div className="flex-shrink-0 px-[26px] pb-[26px] flex gap-[6px]">
                        <button
                          onClick={() => setStage('reject')}
                          className={`${BTN} w-[110px] flex-shrink-0 bg-[#FFEFEF] text-[#FF676F] hover:brightness-95`}
                        >
                          거부
                        </button>
                        <button
                          onClick={openApprove}
                          className={`${BTN} flex-1 bg-[#2C261F] text-[#F9F9F9] hover:opacity-90`}
                        >
                          승인
                        </button>
                      </div>
                    </>
                  )}

                  {/* ─────────── 2A단계: 소요시간 (Figma 733:673) ─────────── */}
                  {stage === 'approve' && (
                    <>
                      {/* Figma 733:673 세로 좌표(원본 → ×0.643, 헤더 102 제외한 본문 기준):
                          스테퍼 178→76 · 칩1행 260 · 칩2행 306 · 안내박스 360 · 버튼 431 */}
                      <div className="flex-1 overflow-y-auto px-[26px] pt-[24px] pb-[14px] flex flex-col">
                        {/* 손님 기준 결과를 맨 위에 — 아래 스테퍼·칩은 "분"만 다루지만
                            점주가 실제로 판단할 때 필요한 건 몇 시에 가져가느냐다.
                            스테퍼를 돌리면 분과 시각이 같이 움직인다. */}
                        {/* 윗줄은 **손님이 주문할 때 고른 시간**이다. 스테퍼를 돌려도 움직이지 않는다 —
                            점주가 조리시간을 바꾼다고 손님이 한 말이 바뀌지는 않으니까.
                            전엔 여기도 prepMins 를 썼는데, 그러면 "손님은 5분 후에 수령할 수 있어요"가
                            점주의 입력을 손님의 요청인 척 되돌려주는 꼴이었다. */}
                        {(() => {
                          const req = o.requestedPickupMinutes
                          if (req == null) return (
                            <div className="text-[15px] font-normal text-[#787878] mb-[28px]">
                              손님이 수령 시간을 고르지 않았어요
                            </div>
                          )
                          if (req === 0) return (
                            <div className="text-[15px] font-normal text-[#414141] mb-[28px]">
                              손님은 <span className="font-semibold text-[#1E1E1E]">지금 바로</span>
                              {o.method === '배달' ? ' 배달 출발을 원해요' : ' 받으러 와요'}
                            </div>
                          )
                          return (
                            <div className="text-[15px] font-normal text-[#414141] mb-[28px]">
                              손님은 <span className="font-semibold text-[#1E1E1E]">{req}분 후({readyClock(req, new Date(o.createdAt))})</span>에
                              {o.method === '배달' ? ' 배달 출발을 원해요' : ' 수령하길 원해요'}
                            </div>
                          )
                        })()}

                        {/* 스테퍼 — Figma는 +가 왼쪽, −가 오른쪽 */}
                        <div className="flex items-center justify-between px-[51px]">
                          <StepBtn onClick={() => setPrepMins(p => Math.min(90, p + 1))} kind="plus" />
                          <span className="text-[31px] font-semibold text-[#1E1E1E] leading-none tabular-nums">
                            {prepMins}분
                          </span>
                          <StepBtn onClick={() => setPrepMins(p => Math.max(1, p - 1))} kind="minus" />
                        </div>

                        {/* 프리셋 칩 4×2 */}
                        {/* 4열 × 2행 고정. flex-wrap 으로 두면 폭이 358이라 한 줄에 5개가 들어가
                            5+3으로 깨진다 — Figma 좌표(폭 57 · 간격 10 · 총 258 가운데정렬) 그대로 그리드로 박는다 */}
                        <div className="mt-[39px] grid grid-cols-4 gap-x-[10px] gap-y-[12px] w-[258px] mx-auto">
                          {PREP_PRESETS.map(mins => (
                            <button
                              key={mins}
                              onClick={() => setPrepMins(mins)}
                              className={`w-[57px] py-[8px] rounded-[10px] border text-[15px] font-medium transition-colors
                                ${prepMins === mins
                                  ? 'bg-[#6A635E] text-[#F9F9F9] border-[#6A635E]'
                                  : 'bg-transparent text-[#414141] border-[#D9D9D9] hover:bg-[#F2F2F2]'}`}>
                              {mins}분
                            </button>
                          ))}
                        </div>

                        {/* Figma 557:4367 — 회색 안내 박스 한 개.
                            "몇 분"만 말하면 점주가 머릿속으로 시계를 더해야 해서 시각을 같이 적는다.
                            스테퍼를 돌리면 분과 시각이 같이 움직인다. */}
                        {/* 여기가 스테퍼를 따라 움직이는 줄이다.
                            ⚠️ prepMins 를 그대로 쓰면 안 된다 — 실제로 손님에게 가는 값은
                            handleApprove 의 notify = max(prepMins, 손님요청) 이다.
                            주방이 5분이어도 손님이 30분 뒤 온다고 했으면 30분으로 안내된다.
                            그 차이를 안 적으면 "내가 5분 했는데 왜 30분이지?"가 된다. */}
                        {(() => {
                          const req    = o.requestedPickupMinutes ?? 0
                          const notify = Math.max(prepMins, req)
                          return (
                            <div className="mt-[20px] rounded-[13px] bg-[#F2F2F2] px-[19px] py-[14px] min-h-[57px] flex flex-col justify-center">
                              <div className="text-[15px] font-semibold text-[#1E1E1E]">
                                고객에게 [{notify}분 뒤 {o.method === '배달' ? '배달출발' : '준비완료'}]로 안내돼요
                              </div>
                              {notify !== prepMins && (
                                <div className="text-[12px] font-normal text-[#787878] mt-[4px]">
                                  주방은 {prepMins}분이지만 손님이 {req}분 뒤에 온다고 해서 그 시간으로 안내돼요
                                </div>
                              )}
                            </div>
                          )
                        })()}
                      </div>

                      <div className="flex-shrink-0 px-[26px] pb-[26px] flex gap-[6px]">
                        <button
                          onClick={() => setStage('summary')}
                          className={`${BTN} w-[110px] flex-shrink-0 bg-[#F2F2F2] text-[#414141] hover:brightness-95`}
                        >
                          이전
                        </button>
                        <button
                          onClick={handleApprove}
                          className={`${BTN} flex-1 bg-[#2C261F] text-[#F9F9F9] hover:opacity-90`}
                        >
                          접수
                        </button>
                      </div>
                    </>
                  )}

                  {/* ─────────── 2B단계: 거부 사유 (Figma 없음 — 같은 디자인 언어로) ─────────── */}
                  {stage === 'reject' && (
                    <>
                      <div className="flex-1 overflow-y-auto px-[26px] pt-[40px] pb-[14px]">
                        <div className="text-[18px] font-semibold text-[#1E1E1E] mb-[20px]">거부 사유를 선택해주세요</div>
                        <div className="grid grid-cols-2 gap-[10px]">
                          {REJECT_REASONS.map(r => (
                            <button key={r} onClick={() => setReason(r)}
                              className={`py-[12px] rounded-[10px] border text-[15px] font-medium transition-colors
                                ${reason === r
                                  ? 'bg-[#FFEFEF] text-[#FF676F] border-[#FF676F]'
                                  : 'bg-transparent text-[#414141] border-[#D9D9D9] hover:bg-[#F2F2F2]'}`}>
                              {r}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex-shrink-0 px-[26px] pb-[26px] flex gap-[6px]">
                        <button
                          onClick={() => setStage('summary')}
                          className={`${BTN} w-[110px] flex-shrink-0 bg-[#F2F2F2] text-[#414141] hover:brightness-95`}
                        >
                          이전
                        </button>
                        <button
                          onClick={handleReject}
                          disabled={!reason}
                          className={`${BTN} flex-1 bg-[#FFEFEF] text-[#FF676F] hover:brightness-95 disabled:opacity-40`}
                        >
                          거부 확정
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                /* 대기 중인 다음 주문 — 읽기 전용 미리보기 */
                <div className="flex-1 overflow-y-auto px-[26px] pt-[40px] pb-[26px] pointer-events-none">
                  {o.items.map((item, i) => (
                    <div key={i} className={i > 0 ? 'mt-[16px]' : ''}>
                      <div className="text-[15px] font-semibold text-[#1E1E1E] truncate">
                        {item.name} | {item.qty}개
                      </div>
                      {item.options.length > 0 && (
                        <div className="mt-[8px] flex flex-col gap-[8px]">
                          {item.options.map((opt, oi) => <BranchLine key={oi} small>{opt}</BranchLine>)}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="h-px bg-[#D9D9D9] my-[20px]" />
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-[#1E1E1E]">합계</span>
                    <span className="text-[15px] font-semibold text-[#1E1E1E]">{won(o.total)}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  )
}

/** Figma 578:1092 — 메뉴 하위 줄 앞의 └ 꺾쇠. 1.2px 선 2개(18px)를 테두리로 그린다 */
function BranchLine({ children, small = false }: { children: React.ReactNode; small?: boolean }) {
  const arm = small ? 9 : 12
  return (
    <div className="flex items-start">
      <span
        className="border-l border-b border-[#1E1E1E] flex-shrink-0 mr-[3px]"
        style={{ width: arm, height: arm, marginTop: small ? 1 : 2 }}
      />
      <span className={`${small ? 'text-[13px]' : 'text-[15px]'} font-light text-[#1E1E1E] leading-none`}>
        {children}
      </span>
    </div>
  )
}

/** Figma 557:4384/4393 — 소요시간 ± 버튼 (73×67 → 47×43, bg #F2F2F2, 아이콘 #787878) */
function StepBtn({ onClick, kind }: { onClick: () => void; kind: 'plus' | 'minus' }) {
  return (
    <button
      onClick={onClick}
      className="w-[47px] h-[43px] rounded-[10px] bg-[#F2F2F2] hover:bg-[#E8E4E2] flex items-center justify-center flex-shrink-0 transition-colors"
      aria-label={kind === 'plus' ? '1분 늘리기' : '1분 줄이기'}
    >
      <span className="relative block w-[16px] h-[16px]">
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[16px] h-[2px] rounded-[5px] bg-[#787878]" />
        {kind === 'plus' && (
          <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[16px] w-[2px] rounded-[5px] bg-[#787878]" />
        )}
      </span>
    </button>
  )
}
