import { useState, useEffect } from 'react'
import { type Order } from '../lib/mock-data'
import { won, parseNote } from '../lib/ipc'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store-context'
import { mapOrderRow } from '../lib/mappers'
import { useHeaderSlot } from '../lib/header-slot'

function CopyButton({ text, onDark = false }: { text: string; onDark?: boolean }) {
  const [copied, setCopied] = useState(false)
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  const style = copied
    ? { backgroundColor: '#E6F4EC', color: '#16a84c' }
    : onDark
      ? { backgroundColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)' }
      : { backgroundColor: '#F0F0F0', color: '#727272' }
  return (
    <button
      onClick={handleCopy}
      className="ml-1 px-2 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 transition-colors"
      style={style}
    >
      {copied ? '✓' : '복사'}
    </button>
  )
}

const METHOD_LABEL: Record<string, string> = {
  '포장':    '포장',
  '매장 식사':'매장',
  '배달':    '배달',
}

const REJECT_REASONS = ['재료 소진', '마감시간 초과', '주문 폭주', '매장 사정', '기타']

function useElapsed(createdAt: string) {
  const [mins, setMins] = useState(() =>
    Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  )
  useEffect(() => {
    const id = setInterval(() => {
      setMins(Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000))
    }, 60_000)
    return () => clearInterval(id)
  }, [createdAt])
  return mins
}

function ElapsedBadge({ createdAt }: { createdAt: string }) {
  const mins = useElapsed(createdAt)
  const color =
    mins <= 5  ? 'bg-blue-500 text-white' :
    mins <= 10 ? 'bg-orange-500 text-white' :
                 'bg-red-500 text-white'
  const label = mins >= 30 ? '30분+ 경과' : `${mins}분 경과`
  return (
    <span className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full ${color}`}>
      ⏱ {label}
    </span>
  )
}

function OrderCard({
  order, idx, onComplete, onCancel,
}: {
  order: Order
  idx: number
  onComplete: () => void
  onCancel: () => void
}) {
  const timeStr = new Date(order.createdAt).toLocaleTimeString('ko-KR', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const isCancelled = order.status === '취소'

  return (
    <div className={`rounded-2xl overflow-hidden shadow-sm flex flex-col ${isCancelled ? 'bg-red-50 opacity-75' : 'bg-white hover:shadow-md transition-shadow'}`}>

      {/* ── 헤더 ── */}
      <div className={`px-4 pt-3 pb-3 ${isCancelled ? 'bg-[#C92A2A]' : 'bg-ink'}`}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-white font-extrabold text-[15px]">#{order.orderNumber ?? String(idx + 1)}</span>
          <div className="flex items-center gap-2">
            <span className="text-white/60 text-[12px] font-medium">{timeStr} 접수</span>
            {!isCancelled && <ElapsedBadge createdAt={order.createdAt} />}
          </div>
        </div>
        <div className="flex items-start justify-between mb-3 gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-white/80 text-[12px] leading-snug">
              {order.accountName} · {order.orderer}
              {order.phone ? <><br />{order.phone}</> : ''}
            </span>
            {order.phone && <CopyButton text={order.phone} onDark />}
          </div>
          <span className="text-white font-semibold text-[16px] flex-shrink-0">{METHOD_LABEL[order.method]}</span>
        </div>

        {/* ── 완료 버튼 or 거부됨 배지 ── */}
        {isCancelled ? (
          <div className="w-full py-2.5 bg-white/20 text-white font-bold text-[15px] rounded-xl text-center">
            거부됨
          </div>
        ) : (
          <button
            onClick={onComplete}
            style={{ backgroundColor: '#16a84c' }}
            className="w-full py-2.5 text-white font-semibold text-[15px] rounded-xl hover:opacity-90 transition-opacity"
          >
            {order.method === '배달' ? '🛵 출발 완료' : '완료'}
          </button>
        )}
      </div>

      {/* ── 메뉴 목록 ── */}
      <div className="px-4 py-1">
        {order.items.map((item, i) => (
          <div key={i} className={`py-2.5 ${i > 0 ? 'border-t border-stone-100' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <span className={`text-[13px] font-semibold leading-snug ${isCancelled ? 'text-gray-text line-through' : 'text-ink'}`}>{item.name}</span>
              <span className="text-[12px] font-bold text-gray-text flex-shrink-0 mt-px">×{item.qty}</span>
            </div>
            {item.options.map((o, oi) => (
              <div key={oi} className="flex gap-1 mt-0.5">
                <span className="text-[11px] text-gray-text">└ {o}</span>
              </div>
            ))}
          </div>
        ))}
        {order.remarks && (() => {
          const { deliveryAddress, deliveryDetail, deliveryNote, customerNote } = parseNote(order.remarks)
          return (
            <div className="mt-1 space-y-1">
              {customerNote && (
                <div className="text-[11px] text-yellow-700 bg-yellow-50 rounded px-2 py-1 font-semibold">
                  💬 {customerNote}
                </div>
              )}
              {deliveryAddress && (
                <div className="bg-orange-50 border border-orange-200 rounded px-2 py-1.5 space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] text-orange-800 font-semibold truncate">🛵 {deliveryAddress}</span>
                    <CopyButton text={deliveryAddress} />
                  </div>
                  {deliveryDetail && (
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] text-orange-700 truncate">{deliveryDetail}</span>
                      <CopyButton text={deliveryDetail} />
                    </div>
                  )}
                  {deliveryNote && (
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] text-orange-700 truncate">📝 {deliveryNote}</span>
                      <CopyButton text={deliveryNote} />
                    </div>
                  )}
                </div>
              )}
              {!deliveryAddress && !customerNote && (
                <div className="text-[11px] text-yellow-700 bg-yellow-50 rounded px-2 py-1 font-semibold">
                  💬 {order.remarks}
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {/* ── 합계 ── */}
      <div className="px-4 pt-2 pb-0.5 flex justify-end">
        <span className={`text-[14px] font-bold ${isCancelled ? 'text-gray-text line-through' : 'text-ink'}`}>{won(order.total)}</span>
      </div>

      {/* ── 준비시간 + 취소 (활성 주문만) ── */}
      {!isCancelled && (
        <div className="border-t border-stone-100 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-green font-extrabold text-[16px]">{order.prepMins}</span>
            <span className="text-[11px] text-gray-text">분 후 완료 예정</span>
          </div>
          <button
            onClick={onCancel}
            className="text-[12px] font-medium text-gray-text hover:underline"
          >
            취소
          </button>
        </div>
      )}
    </div>
  )
}

// ── 오늘 날짜 범위 (KST 기준) ────────────────────────────────────────────────
function todayRange(): { start: string; end: string } {
  const now = new Date()
  const y   = now.getFullYear()
  const m   = String(now.getMonth() + 1).padStart(2, '0')
  const d   = String(now.getDate()).padStart(2, '0')
  return {
    start: `${y}-${m}-${d}T00:00:00`,
    end:   `${y}-${m}-${d}T23:59:59`,
  }
}

// ── KST 날짜 문자열 헬퍼 ────────────────────────────────────────────────────
function toKstDateStr(isoStr: string): string {
  const kst = new Date(new Date(isoStr).getTime() + 9 * 60 * 60 * 1000)
  return kst.toISOString().slice(0, 10)
}
function todayKstStr():     string { return toKstDateStr(new Date().toISOString()) }
function yesterdayKstStr(): string {
  const d = new Date(); d.setDate(d.getDate() - 1)
  return toKstDateStr(d.toISOString())
}
function getDayLabel(dateStr: string): string {
  if (dateStr === todayKstStr())     return '오늘'
  if (dateStr === yesterdayKstStr()) return '어제'
  return `${parseInt(dateStr.slice(5, 7))}월 ${parseInt(dateStr.slice(8, 10))}일`
}

export default function Dashboard() {
  const { storeId } = useStore()   // 현재는 필터링에 미사용. 향후 다점포 지원용.
  const { setHeaderRight } = useHeaderSlot()

  const [activeOrders,  setActiveOrders]  = useState<Order[]>([])
  const [todayOrders,   setTodayOrders]   = useState<Order[]>([])
  const [loading,       setLoading]       = useState(true)
  const [fetchError,    setFetchError]    = useState(false)
  const [actionError,   setActionError]   = useState('')
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null)
  const [cancelReason,  setCancelReason]  = useState('')
  const [cancelLoading, setCancelLoading] = useState(false)

  function showActionError(msg: string) {
    setActionError(msg)
    setTimeout(() => setActionError(''), 3000)
  }

  // ── 오늘 전체 주문 조회 (통계 + 완료 목록) ──────────────────────────────────
  async function fetchTodayOrders() {
    const { start, end } = todayRange()
    const { data, error } = await supabase
      .from('orders')
      .select(`
        order_code,
        order_number,
        orderer_name,
        method,
        status,
        total_amount,
        ordered_at,
        accounts ( account_name, account_type ),
        order_items (
          menu_name,
          quantity,
          unit_price,
          order_item_options ( option_name )
        )
      `)
      .gte('ordered_at', start)
      .lte('ordered_at', end)
      .order('ordered_at', { ascending: false })

    if (error) {
      console.error('오늘 주문 조회 실패:', error)
      throw error
    }
    setTodayOrders((data ?? []).map(mapOrderRow))
  }

  // ── 활성 주문 조회 (주문완료 · 조리중 + 오늘 취소된 주문) ────────────────────
  async function fetchActiveOrders() {
    const { start, end } = todayRange()
    const { data, error } = await supabase
      .from('orders')
      .select(`
        order_code,
        order_number,
        account_code,
        orderer_name,
        orderer_phone,
        ordered_at,
        menu_subtotal,
        delivery_fee,
        total_amount,
        balance_before,
        balance_after,
        method,
        status,
        note,
        delivery_departed_at,
        accounts ( account_name, account_type ),
        order_items (
          order_item_id,
          menu_name,
          quantity,
          unit_price,
          subtotal,
          order_item_options (
            id,
            option_name,
            extra_price
          )
        )
      `)
      // 주문완료·조리중은 날짜 무관 전체 조회, 취소는 오늘만
      .or(`status.in.(주문완료,조리중),and(status.eq.취소,ordered_at.gte.${start},ordered_at.lte.${end})`)
      .order('ordered_at', { ascending: true })

    if (error) {
      console.error('활성 주문 조회 실패:', error)
      throw error
    }

    const rows = (data ?? []).map(mapOrderRow)

    // 활성 주문: 날짜 내림차순(오늘→어제), 같은 날 내 시간 오름차순(오래된 주문 먼저)
    const active = rows
      .filter(o => o.status !== '취소')
      .sort((a, b) => {
        const dayA = toKstDateStr(a.createdAt)
        const dayB = toKstDateStr(b.createdAt)
        if (dayA !== dayB) return dayB.localeCompare(dayA)
        return a.createdAt.localeCompare(b.createdAt)
      })
    const cancelled = rows.filter(o => o.status === '취소')
    setActiveOrders([...active, ...cancelled])
  }

  // ── 마운트 시 초기 로딩 ───────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      setFetchError(false)
      try {
        await Promise.all([fetchActiveOrders(), fetchTodayOrders()])
      } catch {
        setFetchError(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [storeId])

  // ── Realtime 구독: orders 테이블 변경 시 자동 갱신 ───────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-orders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => {
          fetchActiveOrders().catch(() => {})
          fetchTodayOrders().catch(() => {})
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // ── 완료 처리 ─────────────────────────────────────────────────────────────────
  async function handleComplete(code: string, method?: string) {
    const isDelivery = method === '배달'
    const departedAt = isDelivery ? new Date().toISOString() : undefined

    const updateData: Record<string, unknown> = { status: '완료' }
    if (departedAt) updateData.delivery_departed_at = departedAt

    const { error } = await supabase
      .from('orders')
      .update(updateData)
      .eq('order_code', code)

    if (error) {
      console.error('완료 처리 실패:', error)
      showActionError('완료 처리에 실패했습니다. 다시 시도해주세요.')
      return
    }

    // QR 웹에 완료 알림 broadcast (fire-and-forget)
    // 배달 주문은 DELIVERY_DEPARTED도 함께 전송하여 출발 시각 전달
    ;(async () => {
      const ch = supabase.channel(`orders:order_code=${code}`)
      await new Promise<void>(resolve => {
        ch.subscribe(s => {
          if (s !== 'SUBSCRIBED') return
          const sends: Promise<unknown>[] = [
            ch.send({ type: 'broadcast', event: 'ORDER_COMPLETED', payload: departedAt ? { departed_at: departedAt } : {} }),
          ]
          if (departedAt) {
            sends.push(ch.send({ type: 'broadcast', event: 'DELIVERY_DEPARTED', payload: { departed_at: departedAt } }))
          }
          Promise.all(sends).finally(() => { supabase.removeChannel(ch); resolve() })
        })
        setTimeout(resolve, 3000)
      })
    })()

    await Promise.all([fetchActiveOrders(), fetchTodayOrders()])
  }

  // ── 취소 처리 (잔액 환원 포함 RPC + ORDER_REJECTED 브로드캐스트) ─────────────
  async function handleCancel(code: string) {
    if (cancelLoading) return
    setCancelLoading(true)
    const reason = cancelReason || '매장 사정'
    const { error } = await supabase.rpc('cancel_order', {
      p_order_code: code,
      p_allow_after_cooking: true,
      p_note: reason,
    })

    if (error) {
      console.error('취소 처리 실패:', error.code, error.message, error)
      showActionError(`취소 처리 실패: ${error.message ?? '다시 시도해주세요.'}`)
      setConfirmCancel(null)
      setCancelReason('')
      setCancelLoading(false)
      return
    }

    // ORDER_REJECTED 브로드캐스트 (QR웹 거부 사유 화면 전환)
    ;(async () => {
      const ch = supabase.channel(`orders:order_code=${code}`)
      await new Promise<void>(resolve => {
        ch.subscribe(s => {
          if (s !== 'SUBSCRIBED') return
          ch.send({ type: 'broadcast', event: 'ORDER_REJECTED', payload: { reason } })
            .finally(() => { supabase.removeChannel(ch); resolve() })
        })
        setTimeout(resolve, 3000)
      })
    })()

    // Electron IPC
    const w = window as unknown as { api?: { rejectOrder?: Function } }
    w.api?.rejectOrder?.({ orderCode: code, reason })

    await Promise.all([fetchActiveOrders(), fetchTodayOrders()])
    setConfirmCancel(null)
    setCancelReason('')
    setCancelLoading(false)
  }

  // ── 출발 알림 처리 ───────────────────────────────────────────────────────────────
  // ── 통계 계산 ─────────────────────────────────────────────────────────────────
  const todayTotal = todayOrders
    .filter(o => o.status !== '취소')
    .reduce((s, o) => s + o.total, 0)

  // 헤더에 오늘 주문 통계 박스 주입
  useEffect(() => {
    const stats = [
      { label: '오늘 주문', num: String(todayOrders.length), unit: '건', accent: false },
      { label: '준비 중',   num: String(activeOrders.filter(o => o.status !== '취소').length), unit: '건', accent: true },
      { label: '오늘 주문액', num: todayTotal.toLocaleString('ko-KR'), unit: '원', accent: false },
    ]
    setHeaderRight(
      <div className="flex gap-2">
        {stats.map(({ label, num, unit, accent }) => (
          <div key={label} className="bg-gray-bg rounded-lg px-3 py-1 flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-[10px] text-gray-text font-medium">{label}</span>
            <span className={`text-[14px] font-extrabold ${accent ? 'text-green' : 'text-ink'}`}>
              {num}<span className="text-[11px] font-light ml-px">{unit}</span>
            </span>
          </div>
        ))}
      </div>
    )
    return () => setHeaderRight(null)
  }, [todayOrders.length, activeOrders, todayTotal])

  return (
    <div className="h-full flex flex-col bg-gray-bg overflow-hidden">

      {/* ── 액션 에러 배너 ── */}
      {actionError && (
        <div className="px-8 py-2 bg-red-50 border-b border-red-200 text-[13px] text-danger font-semibold flex-shrink-0">
          ⚠️ {actionError}
        </div>
      )}

      {/* ── 본문: 주문 카드 + 우측 사이드바 ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── 활성 주문 카드 영역 ── */}
        <div className="flex-1 overflow-y-auto px-8 py-6 bg-gray-100">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-text">
              <div className="w-10 h-10 border-4 border-green border-t-transparent rounded-full animate-spin mb-4" />
              <div className="text-[15px] font-medium">주문을 불러오는 중...</div>
            </div>
          ) : fetchError ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-text gap-3">
              <div className="text-[40px]">⚠️</div>
              <div className="text-[16px] font-bold text-ink">주문을 불러오지 못했습니다</div>
              <div className="text-[13px]">네트워크 상태를 확인하고 다시 시도해주세요.</div>
              <button
                onClick={() => { setFetchError(false); setLoading(true); Promise.all([fetchActiveOrders(), fetchTodayOrders()]).catch(() => setFetchError(true)).finally(() => setLoading(false)) }}
                className="mt-2 px-5 py-2 rounded-lg bg-ink text-white text-[13px] font-bold hover:bg-ink/80 transition-colors"
              >
                다시 시도
              </button>
            </div>
          ) : activeOrders.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center">
              <svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" className="mb-3">
                <circle cx="26" cy="26" r="26" fill="#16a84c"/>
                <path d="M15 26.5L22.5 34L37 18" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <div className="text-[15px] font-normal text-[#AAAAAA] tracking-tight">대기 중인 주문이 없습니다</div>
            </div>
          ) : (
            (() => {
                // 날짜별 그룹화
                const groups: { label: string; orders: Order[] }[] = []
                let lastDay = ''
                for (const order of activeOrders.filter(o => o.status !== '취소')) {
                  const day = toKstDateStr(order.createdAt)
                  if (day !== lastDay) {
                    groups.push({ label: getDayLabel(day), orders: [] })
                    lastDay = day
                  }
                  groups[groups.length - 1].orders.push(order)
                }
                const cancelled = activeOrders.filter(o => o.status === '취소')

                return (
                  <div className="space-y-6">
                    {groups.map(({ label, orders }, gi) => (
                      <div key={label}>
                        <div className="text-[11px] font-extrabold text-gray-text tracking-wide mb-2">{label}</div>
                        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4 items-start">
                          {orders.map((order, idx) => (
                            <OrderCard
                              key={order.code}
                              order={order}
                              idx={gi * 100 + idx}
                              onComplete={() => handleComplete(order.code, order.method)}
                              onCancel={() => setConfirmCancel(order.code)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                    {cancelled.length > 0 && (
                      <div>
                        <div className="text-[11px] font-extrabold text-gray-text tracking-wide mb-2">취소</div>
                        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4 items-start">
                          {cancelled.map((order, idx) => (
                            <OrderCard
                              key={order.code}
                              order={order}
                              idx={idx}
                              onComplete={() => handleComplete(order.code)}
                              onCancel={() => setConfirmCancel(order.code)}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()
          )}
        </div>

        {/* ── 우측 사이드바: 오늘 처리된 주문 ── */}
        <div className="w-[220px] flex-shrink-0 border-l border-gray-border bg-white flex flex-col overflow-hidden">
          <div className="px-4 py-3 flex-shrink-0">
            <div className="text-[12px] font-extrabold text-gray-text">주문목록</div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {todayOrders.length === 0 ? (
              <div className="h-full flex items-center justify-center"></div>
            ) : (
              <div className="divide-y divide-gray-border">
                {todayOrders
                  .map(o => {
                    const timeStr = new Date(o.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
                    return (
                      <div key={o.code} className="px-4 py-2.5">
                        {/* 주문번호 + 상태 */}
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[12px] font-bold text-ink">
                            #{o.orderNumber ?? o.code.slice(0, 6)}
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                            o.status === '완료' ? 'bg-green-soft text-green' : 'bg-red-50 text-danger'
                          }`}>
                            {o.status}
                          </span>
                        </div>
                        {/* 거래처 */}
                        <div className="text-[11px] text-gray-text truncate">
                          {o.accountName}
                          {o.accountName !== o.orderer && o.orderer ? ` · ${o.orderer}` : ''}
                        </div>
                        {/* 메뉴 (최대 2개) */}
                        <div className="mt-1 space-y-0.5">
                          {o.items.slice(0, 2).map((item, i) => (
                            <div key={i}>
                              <div className="text-[11px] font-semibold text-ink truncate">
                                {item.name} ×{item.qty}
                              </div>
                              {item.options.length > 0 && (
                                <div className="text-[10px] text-gray-text truncate pl-1">
                                  └ {item.options.join(', ')}
                                </div>
                              )}
                            </div>
                          ))}
                          {o.items.length > 2 && (
                            <div className="text-[10px] text-gray-text">외 {o.items.length - 2}개</div>
                          )}
                        </div>
                        {/* 접수시간 + 방법 + 금액 */}
                        <div className="flex items-center justify-between mt-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-gray-text">{timeStr} 접수</span>
                            <span className="text-[10px] bg-gray-100 text-gray-text px-1.5 py-0.5 rounded font-medium">
                              {METHOD_LABEL[o.method]}
                            </span>
                          </div>
                          <span className="text-[11px] font-semibold text-ink">{won(o.total)}</span>
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 취소 확인 다이얼로그 ── */}
      {confirmCancel && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-[340px]">
            <div className="text-[17px] font-extrabold mb-1">주문을 취소하시겠어요?</div>
            <div className="text-[13px] text-gray-text mb-4 leading-relaxed">
              취소 시 선결제 잔액이 자동으로 환원됩니다.
            </div>
            <div className="text-[14px] font-bold mb-3">거부 사유를 선택해주세요</div>
            <div className="grid grid-cols-2 gap-2 mb-5">
              {REJECT_REASONS.map(r => (
                <button
                  key={r}
                  onClick={() => setCancelReason(r)}
                  className={`py-2.5 rounded-xl border-2 text-[13px] font-semibold transition-colors
                    ${cancelReason === r
                      ? 'border-danger bg-red-50 text-danger'
                      : 'bg-gray-100 text-gray-text hover:bg-gray-200 border-transparent'}`}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setConfirmCancel(null); setCancelReason('') }}
                className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-text font-bold hover:bg-gray-bg transition-colors"
              >
                돌아가기
              </button>
              <button
                onClick={() => handleCancel(confirmCancel)}
                disabled={!cancelReason || cancelLoading}
                className="flex-1 py-3 rounded-xl bg-danger text-white font-bold hover:bg-danger/90 transition-colors disabled:opacity-40"
              >
                {cancelLoading ? '처리 중...' : '취소 확정'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
