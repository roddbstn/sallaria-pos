import { useState } from 'react'
import { MOCK_ORDERS, type Order } from '../lib/mock-data'
import { won } from '../lib/ipc'

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
          <span className="text-white font-extrabold text-[15px]">#{idx + 1}</span>
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

export default function Dashboard() {
  const [orders, setOrders] = useState<Order[]>(
    MOCK_ORDERS.filter(o => o.status === '주문완료' || o.status === '조리중')
  )
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null)

  const todayAll   = MOCK_ORDERS
  const todayTotal = todayAll.filter(o => o.status !== '취소').reduce((s, o) => s + o.total, 0)

  async function handleComplete(code: string) {
    const w = window as unknown as { api?: { completeOrder?: Function } }
    await w.api?.completeOrder?.({ orderCode: code })
    setOrders(prev => prev.filter(o => o.code !== code))
  }

  async function handleCancel(code: string) {
    const w = window as unknown as { api?: { cancelOrder?: Function } }
    await w.api?.cancelOrder?.({ orderCode: code })
    setOrders(prev => prev.filter(o => o.code !== code))
    setConfirmCancel(null)
  }

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">

      {/* ── 상단 헤더 ── */}
      <div className="px-8 py-5 border-b border-gray-border bg-white flex items-center justify-between flex-shrink-0">
        <div>
          <div className="text-[22px] font-extrabold text-ink">대시보드</div>
          <div className="text-[13px] text-gray-text mt-0.5">
            {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </div>
        </div>
        <div className="flex gap-4">
          {[
            { label: '오늘 주문', value: `${todayAll.length}건` },
            { label: '준비 중',  value: `${orders.length}건`, accent: true },
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
        {orders.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-text">
            <div className="text-[48px] mb-4">✅</div>
            <div className="text-[18px] font-bold">대기 중인 주문이 없습니다</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {orders.map((order, idx) => (
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
                className="flex-1 py-3 rounded-xl border-2 border-gray-border text-gray-text font-bold hover:bg-gray-bg transition-colors"
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
