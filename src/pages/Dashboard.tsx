import { useState, useEffect } from 'react'
import { type Order, type OrderStatus } from '../lib/mock-data'
import { won } from '../lib/ipc'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store-context'

// DB의 '내점'을 Order 타입의 '매장 식사'로 매핑
const DB_METHOD_TO_ORDER: Record<string, Order['method']> = {
  '포장':  '포장',
  '내점':  '매장 식사',
  '배달':  '배달',
}

const METHOD_LABEL: Record<string, string> = {
  '포장':    '포장',
  '매장 식사':'매장',
  '배달':    '배달',
}

function useElapsed(createdAt: string) {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
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

  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col">

      {/* ── 다크 헤더 ── */}
      <div className="bg-ink px-4 pt-3 pb-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-white font-extrabold text-[15px]">#{order.orderNumber ?? String(idx + 1)}</span>
          <div className="flex items-center gap-2">
            <span className="text-white/60 text-[12px] font-medium">{timeStr} 접수</span>
            <ElapsedBadge createdAt={order.createdAt} />
          </div>
        </div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-white/80 text-[12px]">{order.accountName} · {order.orderer}{order.phone ? ` · ${order.phone}` : ''}</span>
          <span className="text-white font-semibold text-[16px]">{METHOD_LABEL[order.method]}</span>
        </div>

        {/* ── 완료 버튼 ── */}
        <button
          onClick={onComplete}
          style={{ backgroundColor: '#16a84c' }}
          className="w-full py-2.5 text-white font-semibold text-[15px] rounded-xl hover:opacity-90 transition-opacity"
        >
          완료
        </button>
      </div>

      {/* ── 메뉴 목록 ── */}
      <div className="px-4 py-1">
        {order.items.map((item, i) => (
          <div key={i} className={`py-2.5 ${i > 0 ? 'border-t border-stone-100' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-[13px] font-semibold text-ink leading-snug">{item.name}</span>
              <span className="text-[12px] font-bold text-gray-text flex-shrink-0 mt-px">×{item.qty}</span>
            </div>
            {item.options.map((o, oi) => (
              <div key={oi} className="flex gap-1 mt-0.5">
                <span className="text-[11px] text-gray-text">└ {o}</span>
              </div>
            ))}
          </div>
        ))}
        {order.remarks && (
          <div className="mt-1 text-[11px] text-yellow-700 bg-yellow-50 rounded px-2 py-1 font-semibold">
            💬 {order.remarks}
          </div>
        )}
      </div>

      {/* ── 준비시간 + 합계 + 취소 ── */}
      <div className="border-t border-stone-100 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="text-green font-extrabold text-[16px]">{order.prepMins}</span>
          <span className="text-[11px] text-gray-text">분 후 완료 예정</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="text-[12px] font-medium text-gray-text hover:underline"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  )
}

// ── DB row → Order 타입 변환 ──────────────────────────────────────────────────
function mapRowToOrder(row: any): Order {
  const items = (row.order_items ?? []).map((item: any) => ({
    name:    item.menu_name,
    qty:     item.quantity,
    price:   item.unit_price,
    options: (item.order_item_options ?? []).map((opt: any) => opt.option_name as string),
  }))

  return {
    code:          row.order_code,
    orderNumber:   row.order_number ?? undefined,
    accountName:   row.accounts?.account_name ?? '',
    orderer:       row.orderer_name,
    phone:         row.orderer_phone ?? undefined,
    method:        DB_METHOD_TO_ORDER[row.method] ?? '포장',
    status:        row.status as OrderStatus,
    items,
    total:         row.total_amount,
    prepMins:      0,   // DB에 준비시간 컬럼 없음 — 기본 0
    createdAt:     row.ordered_at,
    remarks:       row.note ?? '',
    balanceBefore: row.balance_before ?? undefined,
    balanceAfter:  row.balance_after  ?? undefined,
  }
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

export default function Dashboard() {
  const { storeId } = useStore()   // 현재는 필터링에 미사용. 향후 다점포 지원용.

  const [activeOrders, setActiveOrders] = useState<Order[]>([])
  const [todayOrders,  setTodayOrders]  = useState<Order[]>([])
  const [loading,      setLoading]      = useState(true)
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null)

  // ── 오늘 전체 주문 조회 (통계 표시용) ────────────────────────────────────────
  async function fetchTodayOrders() {
    const { start, end } = todayRange()
    const { data, error } = await supabase
      .from('orders')
      .select(`
        order_code,
        status,
        total_amount,
        ordered_at
      `)
      .gte('ordered_at', start)
      .lte('ordered_at', end)

    if (error) {
      console.error('오늘 주문 조회 실패:', error)
      return
    }
    // 통계용 최소 필드만 담은 partial Order 배열
    setTodayOrders((data ?? []).map(r => ({
      code:        r.order_code,
      accountName: '',
      orderer:     '',
      method:      '포장',
      status:      r.status as OrderStatus,
      items:       [],
      total:       r.total_amount,
      prepMins:    0,
      createdAt:   r.ordered_at,
      remarks:     '',
    })))
  }

  // ── 활성 주문 조회 (주문완료 · 조리중) ───────────────────────────────────────
  async function fetchActiveOrders() {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        order_code,
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
        accounts ( account_name ),
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
      .in('status', ['주문완료', '조리중'])
      .order('ordered_at', { ascending: true })

    if (error) {
      console.error('활성 주문 조회 실패:', error)
      return
    }

    setActiveOrders((data ?? []).map(mapRowToOrder))
  }

  // ── 마운트 시 초기 로딩 ───────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      await Promise.all([fetchActiveOrders(), fetchTodayOrders()])
      setLoading(false)
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
          fetchActiveOrders()
          fetchTodayOrders()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // ── 완료 처리 ─────────────────────────────────────────────────────────────────
  async function handleComplete(code: string) {
    const { error } = await supabase
      .from('orders')
      .update({ status: '완료' })
      .eq('order_code', code)

    if (error) {
      console.error('완료 처리 실패:', error)
      return
    }
    await Promise.all([fetchActiveOrders(), fetchTodayOrders()])
  }

  // ── 취소 처리 (잔액 환원 포함 RPC) ───────────────────────────────────────────
  async function handleCancel(code: string) {
    const { error } = await supabase.rpc('cancel_order', { p_order_code: code })

    if (error) {
      console.error('취소 처리 실패:', error)
      return
    }
    await Promise.all([fetchActiveOrders(), fetchTodayOrders()])
    setConfirmCancel(null)
  }

  // ── 통계 계산 ─────────────────────────────────────────────────────────────────
  const todayTotal = todayOrders
    .filter(o => o.status !== '취소')
    .reduce((s, o) => s + o.total, 0)

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">

      {/* ── 상단 헤더 ── */}
      <div className="px-8 py-5 border-b border-gray-border bg-white flex items-center justify-between flex-shrink-0">
        <div>
          <div className="text-[22px] font-extrabold text-ink">홈</div>
          <div className="text-[13px] text-gray-text mt-0.5">
            {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </div>
        </div>
        <div className="flex gap-4">
          {[
            { label: '오늘 주문', value: `${todayOrders.length}건` },
            { label: '준비 중',  value: `${activeOrders.length}건`, accent: true },
            { label: '오늘 거래액', value: won(todayTotal) },
          ].map(({ label, value, accent }) => (
            <div key={label} className="bg-gray-bg rounded-xl px-5 py-3 text-center min-w-[110px]">
              <div className="text-[11px] text-gray-text font-semibold">{label}</div>
              <div className={`text-[20px] font-extrabold mt-1 ${accent ? 'text-green' : 'text-ink'}`}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 주문 카드 목록 ── */}
      <div className="flex-1 overflow-y-auto px-8 py-6 bg-gray-100">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-text">
            <div className="w-10 h-10 border-4 border-green border-t-transparent rounded-full animate-spin mb-4" />
            <div className="text-[15px] font-medium">주문을 불러오는 중...</div>
          </div>
        ) : activeOrders.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-text">
            <div className="text-[48px] mb-4">✅</div>
            <div className="text-[18px] font-bold">대기 중인 주문이 없습니다</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {activeOrders.map((order, idx) => (
              <OrderCard
                key={order.code}
                order={order}
                idx={idx}
                onComplete={() => handleComplete(order.code)}
                onCancel={() => setConfirmCancel(order.code)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── 취소 확인 다이얼로그 ── */}
      {confirmCancel && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-[340px]">
            <div className="text-[17px] font-extrabold mb-2">주문을 취소하시겠어요?</div>
            <div className="text-[13px] text-gray-text mb-5 leading-relaxed">
              취소 시 선결제 잔액이 자동으로 환원됩니다.<br />이 작업은 되돌릴 수 없습니다.
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmCancel(null)}
                className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-text font-bold hover:bg-gray-bg transition-colors"
              >
                돌아가기
              </button>
              <button
                onClick={() => handleCancel(confirmCancel)}
                className="flex-1 py-3 rounded-xl bg-danger text-white font-bold hover:bg-danger/90 transition-colors"
              >
                취소 확정
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
