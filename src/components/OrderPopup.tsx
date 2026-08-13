import { useState } from 'react'
import { type Order } from '../lib/mock-data'
import { won, orderToPayload, parseNote } from '../lib/ipc'
import { supabase } from '../lib/supabase'
import { track } from '../lib/firebase'
import { useStore } from '../lib/store-context'

// 복사 버튼 컴포넌트
function CopyButton({ text, variant = 'gray' }: { text: string; variant?: 'gray' | 'black' }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  const style = copied
    ? { backgroundColor: '#E6F4EC', color: '#16a84c' }
    : variant === 'black'
      ? { backgroundColor: '#1E1E1E', color: '#FFFFFF' }
      : { backgroundColor: '#F0F0F0', color: '#727272' }
  return (
    <button
      onClick={handleCopy}
      className="ml-1.5 px-2 py-0.5 rounded text-[10px] font-semibold transition-colors flex-shrink-0"
      style={style}
    >
      {copied ? '✓ 복사됨' : '복사'}
    </button>
  )
}

interface Props {
  queue:      Order[]
  onClose:    () => void   // 현재(첫 번째) 주문 제거
  onApprove?: () => void
}

type Stage = 'summary' | 'approve' | 'reject'

const REJECT_REASONS = ['재료 소진', '마감시간 초과', '주문 폭주', '매장 사정', '기타']
const PREP_PRESETS   = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]

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
  const { storeName } = useStore()
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

    // ① approve_order RPC: 상태 → '조리중' + 잔액 차감 (원자적)
    await supabase.rpc('approve_order', { p_order_code: order.code })

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
    await w.api?.approveOrder?.({ order: orderToPayload(order, storeName), prepMins })

    track('pos_order_approved', {
      order_code:        order.code,
      total_amount:      order.total,
      method:            order.method,
      item_count:        order.items.length,
      prep_mins:         prepMins,
    })

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

    track('pos_order_rejected', {
      order_code:   order.code,
      total_amount: order.total,
      method:       order.method,
      reason,
    })

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
              style={{ width: CARD_W, flexShrink: 0, maxHeight: 'calc(100vh - 40px)' }}
              className={`bg-white rounded-2xl overflow-hidden flex flex-col ${idx > 0 ? 'opacity-60' : ''}`}
            >
              {/* ── 헤더 (대시보드 카드 스타일) ── */}
              <div className="bg-ink px-5 py-3 flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white font-medium text-[16px]">
                    #{o.orderNumber ?? String(idx + 1)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-white/60 text-[13px] font-medium">
                      {new Date(o.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })} 주문
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-white/80 text-[13px]">
                      {o.accountName === o.orderer ? o.accountName : `${o.accountName} · ${o.orderer}`}
                    </span>
                    {o.phone && (
                    <div className="flex items-center gap-1">
                      <span className="text-white/60 text-[12px]">{o.phone}</span>
                      <CopyButton text={o.phone} variant="gray" />
                    </div>
                  )}
                  </div>
                  <span className="text-white font-semibold text-[20px] leading-none">{o.method}</span>
                </div>
              </div>

              {/* ── 카드 본문 (첫 번째만 인터랙티브) ── */}
              <div className="px-6 py-5 overflow-y-auto flex-1">
                {idx === 0 ? (
                  <>
                    {/* 1단계: 주문 요약 */}
                    {stage === 'summary' && (
                      <>
                        <div className="bg-gray-bg rounded-xl p-4 mb-4 space-y-3">
                          {o.items.map((item, i) => (
                            <div key={i} className="flex gap-3 items-start">
                              {/* 메뉴 이미지 */}
                              <div className="w-[48px] h-[48px] rounded-lg overflow-hidden flex-shrink-0 bg-gray-200">
                                {item.imageUrl ? (
                                  <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[20px]">🍽️</div>
                                )}
                              </div>
                              {/* 메뉴 정보 */}
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between text-[15px] font-semibold">
                                  <span className="truncate">{item.name} · {item.qty}개</span>
                                  <span className="text-[12px] font-normal text-gray-text flex-shrink-0 ml-2">{won(item.price * item.qty)}</span>
                                </div>
                                {item.options.length > 0 && (
                                  <div className="text-[12px] text-gray-text mt-0.5 space-y-0.5">
                                    {item.options.map((opt, oi) => <div key={oi}>└ {opt}</div>)}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                          <div className="border-t border-gray-border pt-2.5 mt-2.5 flex justify-between items-center">
                            <span className="font-semibold text-[15px]">합계</span>
                            <span className="text-ink text-[20px] font-bold">{won(o.total)}</span>
                          </div>
                        </div>
                        {o.remarks && (() => {
                          const { deliveryAddress, deliveryDetail, deliveryNote, customerNote } = parseNote(o.remarks)
                          return (
                            <div className="mb-3 space-y-2">
                              {customerNote && (
                                <div>
                                  <div className="text-[12px] font-bold text-gray-text mb-1">가게 요청사항 💬</div>
                                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-[13px] text-ink font-semibold">
                                    {customerNote}
                                  </div>
                                </div>
                              )}
                              {deliveryAddress && (
                                <div>
                                  <div className="text-[12px] font-bold text-gray-text mb-1">배달 주소 🛵</div>
                                  <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-2 space-y-1.5">
                                    <div className="flex items-center justify-between text-[13px] text-ink font-semibold">
                                      <span className="flex-1 min-w-0 truncate">{deliveryAddress}</span>
                                      <CopyButton text={deliveryAddress} variant="black" />
                                    </div>
                                    {deliveryDetail && (
                                      <div className="flex items-center justify-between text-[12px] text-gray-text">
                                        <span className="flex-1 min-w-0 truncate">{deliveryDetail}</span>
                                        <CopyButton text={deliveryDetail} variant="black" />
                                      </div>
                                    )}
                                  </div>
                                  {deliveryNote && (
                                    <div className="mt-2">
                                      <div className="text-[12px] font-bold text-gray-text mb-1">배달 요청사항 📝</div>
                                      <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-2 flex items-center justify-between gap-2">
                                        <span className="text-[13px] text-ink flex-1 min-w-0">{deliveryNote}</span>
                                        <CopyButton text={deliveryNote} variant="black" />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                              {!deliveryAddress && !customerNote && (
                                <div>
                                  <div className="text-[12px] font-bold text-gray-text mb-1">요청사항 💬</div>
                                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-[13px] text-ink font-semibold">
                                    {o.remarks}
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })()}
                        <div className="flex gap-3 mt-2">
                          <button
                            onClick={() => setStage('reject')}
                            className="flex-[1] py-2.5 rounded-xl bg-ink text-white font-bold text-[14px] hover:bg-ink/80 transition-colors"
                          >
                            거부
                          </button>
                          <button
                            onClick={() => setStage('approve')}
                            style={{ backgroundColor: '#16a84c' }}
                            className="flex-[3] py-2.5 rounded-xl text-white font-bold text-[14px] hover:opacity-90 transition-opacity"
                          >
                            승인
                          </button>
                        </div>
                      </>
                    )}

                    {/* 2A단계: 소요시간 */}
                    {stage === 'approve' && (
                      <>
                        {/* 주문 메뉴 요약 (compact) */}
                        <div className="bg-gray-bg rounded-xl px-3 py-2 mb-3 space-y-1 max-h-[120px] overflow-y-auto">
                          {order.items.map((item, i) => (
                            <div key={i} className="text-[12px]">
                              <span className="font-semibold text-ink">{item.name} · {item.qty}개</span>
                              {item.options.length > 0 && (
                                <span className="text-gray-text ml-1">{item.options.join(', ')}</span>
                              )}
                            </div>
                          ))}
                        </div>

                        <div className="text-[13px] font-bold mb-3">{order.method === '배달' ? '배달 출발까지 예상 소요시간' : '예상 소요시간'}</div>
                        <div className="flex items-center justify-center gap-4 mb-3">
                          <button
                            onClick={() => setPrepMins(p => Math.max(1, p - 1))}
                            className="w-10 h-10 rounded-xl bg-gray-100 text-gray-text hover:bg-gray-200 text-[20px] flex items-center justify-center transition-colors duration-75 flex-shrink-0">
                            −
                          </button>
                          <div className="w-24 text-center flex-shrink-0">
                            <span className="text-[42px] font-extrabold text-green leading-none tabular-nums">{prepMins}</span>
                            <span className="text-[15px] font-semibold text-gray-text ml-1">분</span>
                          </div>
                          <button
                            onClick={() => setPrepMins(p => Math.min(90, p + 1))}
                            className="w-10 h-10 rounded-xl bg-gray-100 text-gray-text hover:bg-gray-200 text-[20px] flex items-center justify-center transition-colors duration-75 flex-shrink-0">
                            +
                          </button>
                        </div>
                        <div className="grid grid-cols-6 gap-1 mb-3">
                          {PREP_PRESETS.map(mins => (
                            <button
                              key={mins}
                              onClick={() => setPrepMins(mins)}
                              className={`py-1.5 rounded-lg font-medium text-[12px] transition-colors duration-75 border
                                ${prepMins === mins
                                  ? 'bg-ink text-white border-ink'
                                  : 'text-gray-text border-gray-border hover:bg-gray-bg'}`}>
                              {mins}분
                            </button>
                          ))}
                        </div>
                        <div className="bg-gray-bg rounded-xl px-4 py-2.5 mb-3 text-[12px] text-gray-text font-semibold leading-relaxed">
                          <strong className="text-ink">"약 {prepMins}분 후 {order.method === '배달' ? '배달 출발' : '준비'} 예정"</strong>으로 안내됩니다.
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={handleApprove}
                            disabled={loading}
                            style={{ backgroundColor: '#16a84c' }}
                            className="flex-1 py-2.5 rounded-xl text-white font-bold text-[14px] hover:opacity-90 transition-opacity disabled:opacity-60"
                          >
                            {loading ? '처리 중…' : '접수'}
                          </button>
                          <button
                            onClick={() => setStage('summary')}
                            disabled={loading}
                            className="px-4 py-2.5 rounded-xl bg-gray-100 text-ink font-bold text-[13px] hover:bg-gray-200 transition-colors disabled:opacity-50"
                          >
                            뒤로
                          </button>
                        </div>
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
