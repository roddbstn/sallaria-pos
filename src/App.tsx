import { useState, useEffect } from 'react'
import Dashboard  from './pages/Dashboard'
import Orders     from './pages/Orders'
import Customers  from './pages/Customers'
import Menus      from './pages/Menus'
import Settings   from './pages/Settings'
import OrderPopup from './components/OrderPopup'
import { MOCK_NEW_ORDER, MOCK_NEW_ORDER_2, type Order } from './lib/mock-data'

type Tab = 'dashboard' | 'orders' | 'customers' | 'menus' | 'settings'

const NAV: { id: Tab; icon: string; label: string }[] = [
  { id: 'dashboard', icon: '🏠', label: '대시보드' },
  { id: 'orders',    icon: '📋', label: '주문' },
  { id: 'customers', icon: '👥', label: '고객' },
  { id: 'menus',     icon: '🍱', label: '메뉴' },
  { id: 'settings',  icon: '⚙️', label: '설정' },
]

export default function App() {
  const [tab,        setTab]        = useState<Tab>('dashboard')
  const [queue,      setQueue]      = useState<Order[]>([])   // 주문 큐
  const [wsStatus,   setWsStatus]   = useState<'connected' | 'disconnected'>('disconnected')
  const [printerOk,  setPrinterOk]  = useState(true)
  const [toast,      setToast]      = useState('')
  const [toastTimer, setToastTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

function showToast(msg: string) {
    if (toastTimer) clearTimeout(toastTimer)
    setToast(msg)
    setToastTimer(setTimeout(() => setToast(''), 3000))
  }

  // 팝업 닫기 = 큐에서 첫 항목 제거 → 다음 주문 자동 팝업
  function dismissPopup() {
    setQueue(q => q.slice(1))
  }

  // ── Realtime / IPC 구독 ──────────────────────────────────────────────────────
  useEffect(() => {
    const w = window as unknown as { api?: { onOrderNew?: Function; onRealtimeStatus?: Function } }
    if (!w.api) {
      // 브라우저 개발 모드 — 3초 후 2건 동시 큐 추가
      const t = setTimeout(() => setQueue([MOCK_NEW_ORDER, MOCK_NEW_ORDER_2]), 3000)
      return () => clearTimeout(t)
    }
    w.api.onOrderNew?.((order: Order) => setQueue(q => [...q, order]))
    w.api.onRealtimeStatus?.((s: string) =>
      setWsStatus(s === 'SUBSCRIBED' ? 'connected' : 'disconnected')
    )
    return () => {
      const { offOrderNew, offRealtimeStatus } = w.api as unknown as Record<string, Function>
      offOrderNew?.()
      offRealtimeStatus?.()
    }
  }, [])

  const PAGE: Record<Tab, React.ReactNode> = {
    dashboard: <Dashboard />,
    orders:    <Orders />,
    customers: <Customers />,
    menus:     <Menus />,
    settings:  <Settings />,
  }

  return (
    <div className="flex h-full w-full overflow-hidden">

      {/* ── 사이드바 ── */}
      <aside className="w-[200px] flex-shrink-0 bg-white border-r border-gray-border flex flex-col">
        {/* 로고 */}
        <div className="px-5 py-5 border-b border-gray-border">
          <div className="text-ink text-[13px] font-bold tracking-wide">🥗 샐러리아 침산점</div>
        </div>

        {/* 탭 */}
        <nav className="flex-1 py-3 flex flex-col gap-0.5">
          {NAV.map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-3 px-5 py-3 text-[14px] font-semibold text-left transition-colors rounded-lg mx-2
                ${tab === id
                  ? 'bg-green-soft text-ink'
                  : 'text-gray-text hover:bg-gray-bg hover:text-ink'}`}
            >
              <span className="text-[18px]">{icon}</span>
              {label}
            </button>
          ))}
        </nav>

        {/* 상태 표시 */}
        <div className="px-5 py-4 border-t border-gray-border flex flex-col gap-2 text-[11px]">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${wsStatus === 'connected' ? 'bg-green' : 'bg-danger'}`} />
            <span className="text-gray-text">{wsStatus === 'connected' ? '실시간 연결됨' : '연결 끊김'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${printerOk ? 'bg-green' : 'bg-danger'}`} />
            <span className="text-gray-text">프린터 {printerOk ? '정상' : '오프라인'}</span>
          </div>
        </div>
      </aside>

      {/* ── 컨텐츠 ── */}
      <main className="flex-1 overflow-hidden">
        {PAGE[tab]}
      </main>

      {/* ── 신규 주문 팝업 (슬라이드 큐) ── */}
      {queue.length > 0 && (
        <OrderPopup
          queue={queue}
          onClose={dismissPopup}
          onApprove={() => showToast('🖨️ 영수증을 출력합니다')}
        />
      )}

      {/* ── 토스트 ── */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-ink text-white text-[14px] font-semibold px-5 py-3 rounded-xl shadow-lg animate-[fadeIn_0.2s_ease]">
          {toast}
        </div>
      )}
    </div>
  )
}
