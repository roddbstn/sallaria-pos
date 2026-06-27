import { useState } from 'react'
import { type Order } from '../lib/mock-data'
import { won, orderToPayload } from '../lib/ipc'
import { supabase } from '../lib/supabase'

interface Props {
  queue:      Order[]
  onClose:    () => void   // 현재(첫 번째) 주문 제거
  onApprove?: () => void
}

type Stage = 'summary' | 'approve' | 'reject'

const REJECT_REASONS = ['재료 소진', '마감시간 초과', '주문 폭주', '매장 사정', '기타']
const PREP_PRESETS   = [5, 10, 15, 20, 25, 30]

const METHOD_BADGE: Record<string, string> = {
  '포장':    'bg-blue-100 text-blue-700',
  '매장 식사':'bg-purple-100 text-purple-700',
  '배달':    'bg-orange-100 text-orange-700',
}

const CARD_W = 400   // 카드 너비(px)
const CARD_GAP = 20  // 카드 간격(px)

// 마지막 승인 소요시간 기억 (세션 내 유지)
let lastPrepMins = 15

export default function OrderPopup({ queue, onClose, onApprove }: Props) {
  const [stage,    setStage]    = useState<Stage>('summary')
  const [prepMins, setPrepMins] = useState(lastPrepMins)
  const [reason,   setReason]   = useState('')
  const [loading,  setLoading]  = useState(false)
  const [sliding,  setSliding]  = useState(false)  // 슬라이드 애니메이션 중

  const order = queue[0]

  // 슬라이드 후 onClose 호출
  function dismiss() {
    if (sliding) return
    setSliding(true)
    setTimeout(() => {
      setSliding(false)
      setStage('summary')
      setPrepMins(15)
      setReason('')
      onClose()
    }, 320)
  }

  async function handleApprove() {
    lastPrepMins = prepMins   // 다음 팝업 초기값으로 기억
    setLoading(true)

    // ① DB 상태 → '조리중' (QR 웹사이트 postgres_changes 트리거)
    await supabase
      .from('orders')
      .update({ status: '조리중' })
      .eq('order_code', order.code)

    // ② broadcast로 예상 소요시간 전달 (fire-and-forget)
    ;(async () => {
      const ch = supabase.channel(`orders:order_code=${order.code}`)
      await new Promise<void>(resolve => {
        ch.subscribe(s => {
          if (s !== 'SUBSCRIBED') return
          ch.send({ type: 'broadcast', event: 'ORDER_ACCEPTED', payload: { estimated_minutes: prepMins } })
            .finally(() => { supabase.removeChannel(ch); resolve() })
        })
        setTimeout(resolve, 3000)
      })
    })()

    // ③ Electron IPC (영수증 출력)
    const w = window as unknown as { api?: { approveOrder?: Function } }
    await w.api?.approveOrder?.({ order: orderToPayload(order), prepMins })

    setLoading(false)
    onApprove?.()
    dismiss()
  }

  async function handleReject() {
    if (!reason) return
    setLoading(true)

    // ① cancel_order RPC (status → '취소' + 잔액 환원 — QR 웹사이트 postgres_changes 트리거)
    await supabase.rpc('cancel_order', { p_order_code: order.code })

    // ② broadcast로 거부 사유 전달 (fire-and-forget)
    ;(async () => {
      const ch = supabase.channel(`orders:order_code=${order.code}`)
      await new Promise<void>(resolve => {
        ch.subscribe(s => {
          if (s !== 'SUBSCRIBED') return
          ch.send({ type: 'broadcast', event: 'ORDER_REJECTED', payload: { reason } })
            .finally(() => { supabase.removeChannel(ch); resolve() })
        })
        setTimeout(resolve, 3000)
      })
    })()

    // ③ Electron IPC
    const w = window as unknown as { api?: { rejectOrder?: Function } }
    await w.api?.rejectOrder?.({ orderCode: order.code, reason })

    setLoading(false)
    dismiss()
  }

  // 슬라이드 시 translateX 값
  const translateX = sliding ? -(CARD_W + CARD_GAP) : 0

  // 모달 너비: 모든 카드 완전히 표시
  const modalW = CARD_W * queue.length + CARD_GAP * (queue.length - 1)

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
              style={{ width: CARD_W, flexShrink: 0 }}
              className={`bg-white rounded-2xl overflow-hidden ${idx > 0 ? 'opacity-60' : ''}`}
            >
              {/* ── 헤더 (대시보드 카드 스타일) ── */}
              <div className="bg-ink px-5 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white font-medium text-[16px]">
                    #{o.orderNumber ?? String(idx + 1)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-white/60 text-[13px] font-medium">
                      {new Date(o.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })} 접수
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-white/80 text-[13px]">
                      {o.accountName === o.orderer ? o.accountName : `${o.accountName} · ${o.orderer}`}
                    </span>
                    {o.phone && <span className="text-white/60 text-[12px]">{o.phone}</span>}
                  </div>
                  <span className="text-white font-semibold text-[20px] leading-none">{o.method}</span>
                </div>
              </div>

              {/* ── 카드 본문 (첫 번째만 인터랙티브) ── */}
              <div className="px-6 py-5">
                {idx === 0 ? (
                  <>
                    {/* 1단계: 주문 요약 */}
                    {stage === 'summary' && (
                      <>
                        <div className="bg-gray-bg rounded-xl p-4 mb-4 space-y-2">
                          {o.items.map((item, i) => (
                            <div key={i}>
                              <div className="flex justify-between text-[16px] font-semibold">
                                <span>{item.name} · {item.qty}개</span>
                                <span className="text-[12px] font-normal text-gray-text">{won(item.price * item.qty)}</span>
                              </div>
                              {item.options.length > 0 && (
                                <div className="text-[12px] text-gray-text ml-1 mt-0.5 space-y-0.5">
                                  {item.options.map((opt, oi) => <div key={oi}>└ {opt}</div>)}
                                </div>
                              )}
                            </div>
                          ))}
                          <div className="border-t border-gray-border pt-2.5 mt-2.5 flex justify-between items-center">
                            <span className="font-semibold text-[15px]">합계</span>
                            <span className="text-ink text-[20px] font-bold">{won(o.total)}</span>
                          </div>
                        </div>
                        {o.remarks && (
                          <div className="mb-3">
                            <div className="text-[12px] font-bold text-gray-text mb-1">요청사항 💬</div>
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-[13px] text-ink font-semibold">
                              {o.remarks}
                            </div>
                          </div>
                        )}
                        {o.balanceAfter !== undefined && (
                          <div className="bg-gray-bg rounded-xl px-4 py-3 mb-4 flex justify-between items-center">
                            <span className="text-[13px] font-medium text-gray-text">{o.accountName}</span>
                            <span className="text-[13px] font-medium text-gray-text">
                              현재 잔액: <span className={o.balanceAfter <= 0 ? 'text-danger' : ''}>{won(o.balanceAfter)}</span>
                            </span>
                          </div>
                        )}
                        <div className="flex gap-3 mt-2">
                          <button
                            onClick={() => setStage('reject')}
                            className="flex-[1] py-3 rounded-xl bg-ink text-white font-bold text-[15px] hover:bg-ink/80 transition-colors"
                          >
                            거부
                          </button>
                          <button
                            onClick={() => setStage('approve')}
                            style={{ backgroundColor: '#16a84c' }}
                            className="flex-[3] py-3 rounded-xl text-white font-bold text-[15px] hover:opacity-90 transition-opacity"
                          >
                            승인
                          </button>
                        </div>
                      </>
                    )}

                    {/* 2A단계: 소요시간 */}
                    {stage === 'approve' && (
                      <>
                        <button
                          onClick={() => setStage('summary')}
                          className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-text hover:bg-gray-bg hover:text-ink transition-colors mb-1"
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12" />
                            <polyline points="12 19 5 12 12 5" />
                          </svg>
                        </button>
                        <div className="text-[15px] font-bold mb-5">예상 소요시간</div>
                        <div className="flex items-center justify-center gap-4 mb-5">
                          <button
                            onClick={() => setPrepMins(p => Math.max(1, p - 1))}
                            className="w-12 h-12 rounded-xl bg-gray-100 text-gray-text hover:bg-gray-200 text-[22px] flex items-center justify-center transition-colors duration-75 flex-shrink-0">
                            −
                          </button>
                          <div className="w-28 text-center flex-shrink-0">
                            <span className="text-[52px] font-extrabold text-green leading-none tabular-nums">{prepMins}</span>
                            <span className="text-[18px] font-semibold text-gray-text ml-1">분</span>
                          </div>
                          <button
                            onClick={() => setPrepMins(p => Math.min(60, p + 1))}
                            className="w-12 h-12 rounded-xl bg-gray-100 text-gray-text hover:bg-gray-200 text-[22px] flex items-center justify-center transition-colors duration-75 flex-shrink-0">
                            +
                          </button>
                        </div>
                        <div className="flex justify-center mb-5">
                          <div className="border border-gray-border rounded-2xl flex items-center overflow-hidden">
                            {PREP_PRESETS.map((mins, i) => (
                              <>
                                {i > 0 && <div key={`sep-${mins}`} className="w-px h-5 bg-gray-border flex-shrink-0" />}
                                <button
                                  key={mins}
                                  onClick={() => setPrepMins(mins)}
                                  className={`px-4 py-2.5 font-medium text-[13px] transition-colors duration-75
                                    ${prepMins === mins
                                      ? 'bg-ink text-white'
                                      : 'text-gray-text hover:bg-gray-bg'}`}>
                                  {mins}분
                                </button>
                              </>
                            ))}
                          </div>
                        </div>
                        <div className="bg-gray-bg rounded-xl px-4 py-3 mb-5 text-[13px] text-gray-text font-semibold leading-relaxed">
                          <strong className="text-ink">"약 {prepMins}분 후 준비 예정"</strong>으로 안내됩니다.
                        </div>
                        <button
                          onClick={handleApprove}
                          disabled={loading}
                          style={{ backgroundColor: '#16a84c' }}
                          className="w-full py-3 rounded-xl text-white font-bold text-[15px] hover:opacity-90 transition-opacity disabled:opacity-60"
                        >
                          {loading ? '처리 중…' : '접수'}
                        </button>
                      </>
                    )}

                    {/* 2B단계: 거부 사유 */}
                    {stage === 'reject' && (
                      <>
                        <div className="text-[15px] font-bold mb-4">거부 사유를 선택해주세요</div>
                        <div className="grid grid-cols-2 gap-2 mb-5">
                          {REJECT_REASONS.map(r => (
                            <button key={r} onClick={() => setReason(r)}
                              className={`py-3 rounded-xl border-2 text-[13px] font-semibold transition-colors
                                ${reason === r ? 'border-danger bg-red-50 text-danger' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                              {r}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-3">
                          <button onClick={() => setStage('summary')}
                            className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-text font-bold hover:bg-gray-bg transition-colors">
                            뒤로
                          </button>
                          <button onClick={handleReject} disabled={!reason || loading}
                            className="flex-1 py-3 rounded-xl bg-danger text-white font-bold text-[15px] hover:bg-danger/90 transition-colors disabled:opacity-40">
                            {loading ? '처리 중…' : '거부 확정'}
                          </button>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  /* 다음 주문 미리보기 (읽기 전용) */
                  <div className="space-y-2 pointer-events-none">
                    {o.items.map((item, i) => (
                      <div key={i}>
                        <div className="text-[13px] font-semibold text-ink">
                          {item.name} · {item.qty}개
                        </div>
                        {item.options.length > 0 && (
                          <div className="text-[12px] text-gray-text ml-1 mt-0.5 space-y-0.5">
                            {item.options.map((opt, oi) => <div key={oi}>└ {opt}</div>)}
                          </div>
                        )}
                      </div>
                    ))}
                    <div className="pt-2 border-t border-gray-border text-[14px] font-bold text-ink">
                      {won(o.total)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}
