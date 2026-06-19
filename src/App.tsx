import { useState, useEffect, useRef } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { StoreContext, type StoreSession } from './lib/store-context'

import Auth        from './pages/Auth'
import Onboarding  from './pages/Onboarding'
import Dashboard   from './pages/Dashboard'
import Orders      from './pages/Orders'
import Customers   from './pages/Customers'
import Menus       from './pages/Menus'
import Settings    from './pages/Settings'
import OrderPopup  from './components/OrderPopup'
import { type Order } from './lib/mock-data'

// ── 앱 상태 ───────────────────────────────────────────────────────────────────
type Phase = 'loading' | 'auth' | 'onboarding' | 'main'
type Tab   = 'dashboard' | 'orders' | 'customers' | 'menus' | 'settings'

// ── 사이드바 아이콘 (2D SVG) ──────────────────────────────────────────────────
function IconHome()     { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg> }
function IconOrders()   { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg> }
function IconCustomers(){ return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a6 6 0 0 1 6-6h2"/><circle cx="17" cy="16" r="3"/><path d="M20.5 19.5 22 21"/></svg> }
function IconMenus()    { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v4a3 3 0 0 0 3 3 3 3 0 0 0 3-3V2"/><path d="M6 9v13"/><path d="M21 2l-7.5 7.5"/><path d="M15 2l6 6"/><path d="M13.5 9.5L21 17l-3 3-7.5-7.5"/></svg> }
function IconSettings() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> }

const NAV: { id: Tab; Icon: () => JSX.Element; label: string }[] = [
  { id: 'dashboard', Icon: IconHome,      label: '홈' },
  { id: 'orders',    Icon: IconOrders,    label: '주문' },
  { id: 'customers', Icon: IconCustomers, label: '고객' },
  { id: 'menus',     Icon: IconMenus,     label: '메뉴' },
  { id: 'settings',  Icon: IconSettings,  label: '설정' },
]

export default function App() {
  const [phase,      setPhase]      = useState<Phase>('loading')
  const [session,    setSession]    = useState<StoreSession | null>(null)
  const [authObj,    setAuthObj]    = useState<Session | null>(null)
  const [tab,        setTab]        = useState<Tab>('dashboard')
  const [queue,      setQueue]      = useState<Order[]>([])
  const [wsStatus,   setWsStatus]   = useState<'connected' | 'disconnected'>('disconnected')
  const [printerOk,  setPrinterOk]  = useState(true)
  const [toast,      setToast]      = useState('')
  const [toastTimer, setToastTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [updateReady, setUpdateReady] = useState<string | null>(null)  // 다운로드 완료된 버전

  // ── 인증 + 스토어 로딩 ──────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!s) { setPhase('auth'); return }
      setAuthObj(s)
      loadStoreSession(s.user.id, s.user.email ?? '')
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!s) { setPhase('auth'); setSession(null); setAuthObj(null); return }
      setAuthObj(s)
      loadStoreSession(s.user.id, s.user.email ?? '')
    })
    return () => subscription.unsubscribe()
  }, [])

  async function loadStoreSession(userId: string, userEmail: string) {
    // clients 조회
    let { data: client } = await supabase
      .from('clients')
      .select('id, business_name')
      .eq('auth_user_id', userId)
      .single()

    // clients 행이 없으면 자동 생성 (trigger가 없을 때 대비)
    if (!client) {
      const { data: created } = await supabase
        .from('clients')
        .insert({ auth_user_id: userId, contact_email: userEmail })
        .select('id, business_name')
        .single()
      client = created
    }

    if (!client) { setPhase('auth'); return }

    // stores 조회
    const { data: stores } = await supabase
      .from('stores')
      .select('id, name')
      .eq('client_id', client.id)
      .limit(1)

    if (!stores || stores.length === 0) {
      setSession({ userId, clientId: client.id, storeId: '', storeName: '' })
      setPhase('onboarding')
      return
    }

    const store = stores[0]
    setSession({ userId, clientId: client.id, storeId: store.id, storeName: store.name })
    setPhase('main')
  }

  // ── 자동 업데이트 알림 구독 ──────────────────────────────────────────────────
  useEffect(() => {
    const w = window as unknown as { api?: { onUpdaterStatus?: Function } }
    w.api?.onUpdaterStatus?.(({ type, version }: { type: string; version: string }) => {
      if (type === 'available') showToast(`새 버전 ${version} 다운로드 중...`)
      if (type === 'ready')     setUpdateReady(version)
    })
  }, [])

  // ── IPC 구독 (Electron main process → renderer) ─────────────────────────────
  useEffect(() => {
    const w = window as unknown as { api?: { onRealtimeStatus?: Function; onOrderNew?: Function; offOrderNew?: Function } }

    // 연결 상태 표시
    w.api?.onRealtimeStatus?.((s: string) =>
      setWsStatus(s === 'SUBSCRIBED' ? 'connected' : 'disconnected')
    )

    if (!w.api?.onOrderNew) return

    // 신규 주문 수신 (main process가 Supabase Realtime 구독 후 IPC로 전달)
    w.api.onOrderNew(async (rawRow: any) => {
      const { data } = await supabase
        .from('orders')
        .select(`
          order_code, orderer_name, orderer_phone,
          ordered_at, total_amount, balance_before, balance_after,
          method, status, note,
          accounts ( account_name ),
          order_items (
            order_item_id, menu_name, quantity, unit_price,
            order_item_options ( id, option_name, extra_price )
          )
        `)
        .eq('order_code', rawRow.order_code)
        .single()

      if (!data) return
      const order = dbOrderToMock(data)
      setQueue(q => {
        // 중복 방지 (이미 queue에 있으면 추가 안 함)
        if (q.some(o => o.code === order.code)) return q
        return [...q, order]
      })
    })

    return () => { w.api?.offOrderNew?.() }
  }, [])

  // ── Supabase Realtime 구독 (IPC 없는 환경 포함) ───────────────────────────
  useEffect(() => {
    if (phase !== 'main') return

    async function fetchAndQueue(orderCode: string) {
      const { data } = await supabase
        .from('orders')
        .select(`
          order_code, order_number, orderer_name, orderer_phone,
          ordered_at, total_amount, balance_before, balance_after,
          method, status, note,
          accounts ( account_name ),
          order_items (
            order_item_id, menu_name, quantity, unit_price,
            order_item_options ( id, option_name, extra_price )
          )
        `)
        .eq('order_code', orderCode)
        .single()

      if (!data) return
      const order = dbOrderToMock(data)
      setQueue(q => {
        if (q.some(o => o.code === order.code)) return q
        return [...q, order]
      })
      setWsStatus('connected')
    }

    const channel = supabase
      .channel('app-new-orders')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        (payload: any) => {
          fetchAndQueue(payload.new.order_code)
        }
      )
      .subscribe((status: string) => {
        setWsStatus(status === 'SUBSCRIBED' ? 'connected' : 'disconnected')
      })

    return () => { supabase.removeChannel(channel) }
  }, [phase])

  // ── 새 주문 소리 알림 ────────────────────────────────────────────────────────
  const prevQueueLen = useRef(0)
  useEffect(() => {
    if (queue.length > prevQueueLen.current) {
      playOrderSound()
    }
    prevQueueLen.current = queue.length
  }, [queue.length])

  function showToast(msg: string) {
    if (toastTimer) clearTimeout(toastTimer)
    setToast(msg)
    setToastTimer(setTimeout(() => setToast(''), 3000))
  }

  function dismissPopup() {
    setQueue(q => q.slice(1))
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  // ── 로딩 ─────────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-4 border-gray-200 border-t-green animate-spin" />
          <span className="text-[13px] text-gray-text">불러오는 중...</span>
        </div>
      </div>
    )
  }

  if (phase === 'auth') {
    return <Auth onSuccess={() => {}} />
  }

  if (phase === 'onboarding' && session) {
    return (
      <Onboarding
        clientId={session.clientId}
        onComplete={(storeId, storeName) => {
          setSession(s => s ? { ...s, storeId, storeName } : s)
          setPhase('main')
        }}
      />
    )
  }

  if (phase !== 'main' || !session) return null

  // ── 메인 POS ─────────────────────────────────────────────────────────────────
  const PAGE: Record<Tab, React.ReactNode> = {
    dashboard: <Dashboard />,
    orders:    <Orders />,
    customers: <Customers />,
    menus:     <Menus />,
    settings:  <Settings />,
  }

  return (
    <StoreContext.Provider value={session}>
      <div className="flex h-full w-full overflow-hidden">

        {/* ── 사이드바 ── */}
        <aside className="w-[72px] flex-shrink-0 bg-white border-r border-gray-border flex flex-col items-center">

          {/* 프로필 버튼 */}
          <button
            onClick={handleSignOut}
            title={session.storeName || '샐러리아'}
            className="mt-4 mb-2 w-10 h-10 rounded-full bg-[#16a84c] text-white flex items-center justify-center text-[16px] font-bold hover:opacity-85 transition-opacity flex-shrink-0"
          >
            {(session.storeName || '샐')[0]}
          </button>

          <nav className="flex-1 flex flex-col items-center gap-1 py-2 w-full">
            {NAV.map(({ id, Icon, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`w-full flex flex-col items-center gap-1 py-2.5 text-center transition-colors rounded-lg
                  ${tab === id
                    ? 'bg-green-soft text-[#16a84c]'
                    : 'text-gray-text hover:bg-gray-bg hover:text-ink'}`}
              >
                <Icon />
                <span className="text-[10px] font-semibold leading-tight">{label}</span>
              </button>
            ))}
          </nav>

          {/* 연결 상태 */}
          <div className="pb-4 flex flex-col items-center gap-1.5">
            <div title={wsStatus === 'connected' ? '실시간 연결됨' : '연결 끊김'}>
              <span className={`w-2 h-2 rounded-full block ${wsStatus === 'connected' ? 'bg-green' : 'bg-danger'}`} />
            </div>
            <div title={`프린터 ${printerOk ? '정상' : '오프라인'}`}>
              <span className={`w-2 h-2 rounded-full block ${printerOk ? 'bg-green' : 'bg-danger'}`} />
            </div>
          </div>
        </aside>

        {/* ── 컨텐츠 ── */}
        <main className="flex-1 overflow-hidden">
          {PAGE[tab]}
        </main>

        {/* ── 신규 주문 팝업 ── */}
        {queue.length > 0 && (
          <OrderPopup
            queue={queue}
            onClose={dismissPopup}
            onApprove={() => showToast('🖨️ 영수증을 출력합니다')}
          />
        )}

        {/* ── 업데이트 준비 배너 ── */}
        {updateReady && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 bg-ink text-white text-[14px] font-semibold px-5 py-3 rounded-xl shadow-lg">
            <span>🆕 v{updateReady} 업데이트 준비 완료</span>
            <button
              onClick={() => {
                const w = window as unknown as { api?: { updaterInstall?: Function } }
                w.api?.updaterInstall?.()
              }}
              className="bg-green text-white text-[13px] font-bold px-3 py-1 rounded-lg hover:opacity-80"
            >
              지금 재시작
            </button>
            <button onClick={() => setUpdateReady(null)} className="text-white/50 hover:text-white text-[18px] leading-none">×</button>
          </div>
        )}

        {/* ── 토스트 ── */}
        {toast && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-ink text-white text-[14px] font-semibold px-5 py-3 rounded-xl shadow-lg animate-[fadeIn_0.2s_ease]">
            {toast}
          </div>
        )}
      </div>
    </StoreContext.Provider>
  )
}

// ── 주문 알림 소리 (Web Audio API) ───────────────────────────────────────────
function playOrderSound() {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime
    // 세 번 올라가는 비프음
    const notes = [880, 1100, 1320]
    notes.forEach((freq, i) => {
      const offset = i * 0.18
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + offset)
      gain.gain.linearRampToValueAtTime(0.45, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.28)
      osc.start(now + offset)
      osc.stop(now + offset + 0.3)
    })
  } catch (_) {}
}

// ── DB 주문 → 기존 Order 타입 변환 ───────────────────────────────────────────
function dbOrderToMock(row: any): Order {
  const methodMap: Record<string, string> = { '내점': '매장 식사', '포장': '포장', '배달': '배달' }
  return {
    code:         row.order_code,
    orderNumber:  row.order_number ?? undefined,
    accountName:  row.accounts?.account_name ?? '',
    orderer:      row.orderer_name,
    phone:        row.orderer_phone ?? undefined,
    method:       (methodMap[row.method] ?? row.method) as any,
    status:       row.status,
    prepMins:     0,
    total:        row.total_amount,
    createdAt:    row.ordered_at,
    remarks:      row.note ?? '',
    balanceBefore: row.balance_before,
    balanceAfter:  row.balance_after,
    items: (row.order_items ?? []).map((item: any) => ({
      name:    item.menu_name,
      qty:     item.quantity,
      price:   item.unit_price,
      options: (item.order_item_options ?? []).map((o: any) => o.option_name),
    })),
  }
}
