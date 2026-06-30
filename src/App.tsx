import { useState, useEffect, useRef } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { StoreContext, type StoreSession } from './lib/store-context'
import { playOrderSound } from './lib/sound'

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
function IconMenus()    { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="13" rx="8" ry="4"/><path d="M4 13c0 2.21 3.58 4 8 4s8-1.79 8-4"/><path d="M12 3v2"/><path d="M9 4.5C6.5 5.5 5 7.5 5 10"/><path d="M15 4.5C17.5 5.5 19 7.5 19 10"/></svg> }
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
  const [printerOk,  setPrinterOk]  = useState(false)
  const [toast,      setToast]      = useState('')
  const [toastTimer, setToastTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [updateReady, setUpdateReady] = useState<string | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)

  // 프로필 모달 상태
  const [editingName,   setEditingName]   = useState(false)
  const [nameInput,     setNameInput]     = useState('')
  const [pwInput,       setPwInput]       = useState('')
  const [pwConfirm,     setPwConfirm]     = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg,    setProfileMsg]    = useState<{ text: string; ok: boolean } | null>(null)
  const [customerCount, setCustomerCount] = useState<number | null>(null)
  const [menuCount,     setMenuCount]     = useState<number | null>(null)
  const [showPw,        setShowPw]        = useState(false)
  const [showPwConfirm, setShowPwConfirm] = useState(false)

  // 운영 상태 + 운영시간
  const [isOpen,        setIsOpen]        = useState(() => {
    const s = localStorage.getItem('pos_is_open')
    return s !== null ? JSON.parse(s) : true
  })
  const [hoursOpen,     setHoursOpen]     = useState(false)
  const [operatingHours, setOperatingHours] = useState<Record<string, { enabled: boolean; open: string; close: string }>>(() => {
    try {
      const s = localStorage.getItem('pos_operating_hours')
      return s ? JSON.parse(s) : defaultOperatingHours()
    } catch { return defaultOperatingHours() }
  })
  const [hoursDraft, setHoursDraft] = useState<Record<string, { enabled: boolean; open: string; close: string }>>({})

  // ── 인증 + 스토어 로딩 ──────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!s) { setPhase('auth'); return }
      setAuthObj(s)
      loadStoreSession(s.user.id, s.user.email ?? '')
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'TOKEN_REFRESH_FAILED' || !s) {
        setPhase('auth'); setSession(null); setAuthObj(null); return
      }
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

  // ── storeId → main process 전달 (Realtime 필터용) ────────────────────────────
  useEffect(() => {
    if (!session?.storeId) return
    const w = window as unknown as { api?: { setStoreId?: (id: string) => void } }
    w.api?.setStoreId?.(session.storeId)
  }, [session?.storeId])

  // ── 자동 업데이트 알림 구독 ──────────────────────────────────────────────────
  useEffect(() => {
    const w = window as unknown as { api?: { onUpdaterStatus?: Function } }
    w.api?.onUpdaterStatus?.(({ type, version }: { type: string; version: string }) => {
      if (type === 'available') showToast(`새 버전 ${version} 다운로드 중...`)
      if (type === 'ready')     setUpdateReady(version)
    })
  }, [])

  // ── 프린터 상태 구독 ─────────────────────────────────────────────────────────
  useEffect(() => {
    const w = window as unknown as { api?: { onPrinterStatus?: Function; offPrinterStatus?: Function } }
    w.api?.onPrinterStatus?.((s: { connected: boolean }) => setPrinterOk(s.connected))
    return () => { w.api?.offPrinterStatus?.() }
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
            menus ( image_url ),
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

  // ── Supabase Realtime 구독 (IPC 없는 환경 포함, 자동 재연결) ────────────────
  useEffect(() => {
    if (phase !== 'main') return

    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let channel: ReturnType<typeof supabase.channel> | null = null

    const ORDER_SELECT = `
      order_code, orderer_name, orderer_phone,
      ordered_at, total_amount, balance_before, balance_after,
      method, status, note,
      accounts ( account_name ),
      order_items (
        order_item_id, menu_name, quantity, unit_price,
        menus ( image_url ),
        order_item_options ( id, option_name, extra_price )
      )
    `

    async function fetchAndQueue(orderCode: string) {
      const { data } = await supabase
        .from('orders')
        .select(ORDER_SELECT)
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

    function subscribe() {
      // 채널명에 타임스탬프를 붙여 재구독 시 새 채널 생성
      // (같은 이름 재사용 시 "cannot add callbacks after subscribe()" 에러 발생)
      channel = supabase
        .channel(`app-new-orders-${Date.now()}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'orders' },
          (payload: any) => {
            fetchAndQueue(payload.new.order_code)
          }
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            setWsStatus('connected')
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            // 연결 끊기면 5초 후 재연결
            setWsStatus('disconnected')
            retryTimer = setTimeout(() => {
              if (channel) supabase.removeChannel(channel)
              subscribe()
            }, 5000)
          } else {
            setWsStatus('disconnected')
          }
        })
    }

    subscribe()

    return () => {
      if (retryTimer) clearTimeout(retryTimer)
      if (channel) supabase.removeChannel(channel)
    }
  }, [phase])

  // ── 폴링 폴백: Realtime 누락 주문 복구 (30초마다) ──────────────────────────
  // Realtime이 끊긴 사이 들어온 '주문완료' 상태 주문을 폴링으로 잡아냄
  useEffect(() => {
    if (phase !== 'main') return

    const ORDER_SELECT_POLL = `
      order_code, orderer_name, orderer_phone,
      ordered_at, total_amount, balance_before, balance_after,
      method, status, note,
      accounts ( account_name ),
      order_items (
        order_item_id, menu_name, quantity, unit_price,
        menus ( image_url ),
        order_item_options ( id, option_name, extra_price )
      )
    `

    async function poll() {
      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      const { data } = await supabase
        .from('orders')
        .select(ORDER_SELECT_POLL)
        .eq('status', '주문완료')
        .gte('ordered_at', cutoff)

      for (const row of data ?? []) {
        const order = dbOrderToMock(row as any)
        setQueue(q => {
          if (q.some(o => o.code === order.code)) return q
          return [...q, order]
        })
      }
    }

    // 즉시 1회 실행 + 이후 30초마다
    poll()
    const id = setInterval(poll, 30_000)
    return () => clearInterval(id)
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

  async function openProfile() {
    setNameInput(session?.storeName ?? '')
    setPwInput('')
    setPwConfirm('')
    setEditingName(false)
    setProfileMsg(null)
    setShowPw(false)
    setShowPwConfirm(false)
    setProfileOpen(true)

    // 내 매장 카테고리 ID 먼저 조회 → 메뉴 카운트 필터용
    const { data: myCats } = await supabase
      .from('categories').select('id').eq('store_id', session!.storeId)
    const catIds = myCats?.map(c => c.id) ?? []

    const [{ count: cc }, { count: mc }] = await Promise.all([
      supabase.from('accounts').select('*', { count: 'exact', head: true })
        .eq('is_active', true).eq('store_id', session!.storeId),
      catIds.length > 0
        ? supabase.from('menus').select('*', { count: 'exact', head: true })
            .eq('is_hidden', false).in('category_id', catIds)
        : Promise.resolve({ count: 0 }),
    ])
    setCustomerCount(cc ?? 0)
    setMenuCount(mc ?? 0)
  }

  async function handleSaveStoreName() {
    if (!nameInput.trim() || !session) return
    setProfileSaving(true)
    const { error } = await supabase
      .from('stores')
      .update({ name: nameInput.trim() })
      .eq('id', session.storeId)
    if (error) {
      setProfileMsg({ text: '저장 실패: ' + error.message, ok: false })
    } else {
      setSession(s => s ? { ...s, storeName: nameInput.trim() } : s)
      setEditingName(false)
      setProfileMsg({ text: '가게 이름이 변경됐습니다.', ok: true })
    }
    setProfileSaving(false)
  }

  async function handleChangePassword() {
    if (!pwInput) return
    if (pwInput !== pwConfirm) {
      setProfileMsg({ text: '비밀번호가 일치하지 않습니다.', ok: false })
      return
    }
    setProfileSaving(true)
    const { error } = await supabase.auth.updateUser({ password: pwInput })
    if (error) {
      setProfileMsg({ text: '변경 실패: ' + error.message, ok: false })
    } else {
      setPwInput('')
      setPwConfirm('')
      setProfileMsg({ text: '비밀번호가 변경됐습니다.', ok: true })
    }
    setProfileSaving(false)
  }

  function defaultOperatingHours() {
    const days: Record<string, { enabled: boolean; open: string; close: string }> = {}
    const week = ['mon','tue','wed','thu','fri','sat','sun']
    week.forEach(d => {
      days[d] = { enabled: d !== 'sun', open: '09:00', close: '21:00' }
    })
    days['sun'] = { enabled: false, open: '10:00', close: '18:00' }
    return days
  }

  function toggleIsOpen() {
    const next = !isOpen
    setIsOpen(next)
    localStorage.setItem('pos_is_open', JSON.stringify(next))
  }

  function saveOperatingHours() {
    setOperatingHours(hoursDraft)
    localStorage.setItem('pos_operating_hours', JSON.stringify(hoursDraft))
    setHoursOpen(false)
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
        <aside className="w-[72px] flex-shrink-0 bg-white dark:bg-[#242424] border-r border-gray-border flex flex-col items-center">

          {/* 프로필 버튼 */}
          <button
            onClick={openProfile}
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

          {/* 운영 상태 토글 + 시간 설정 */}
          <div className="flex flex-col items-center gap-2 pb-2">
            {/* 슬라이드 토글 */}
            <button
              onClick={toggleIsOpen}
              title={isOpen ? '운영중 — 클릭해서 종료' : '운영종료 — 클릭해서 시작'}
              className={`relative w-10 h-[22px] rounded-full transition-colors duration-200 flex-shrink-0 ${
                isOpen ? 'bg-[#16a84c]' : 'bg-gray-300'
              }`}
            >
              <span className={`absolute top-[3px] w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${
                isOpen ? 'translate-x-[19px]' : 'translate-x-[3px]'
              }`} />
            </button>
            <span className={`text-[9px] font-bold leading-none ${isOpen ? 'text-[#16a84c]' : 'text-gray-text'}`}>
              {isOpen ? '운영중' : '종료'}
            </span>
            {/* 시계 아이콘 버튼 */}
            <button
              onClick={() => { setHoursDraft({ ...operatingHours }); setHoursOpen(true) }}
              title="운영시간 설정"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-text hover:bg-gray-bg hover:text-ink transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </button>
          </div>

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

        {/* ── 운영시간 설정 모달 ── */}
        {hoursOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50" onClick={() => setHoursOpen(false)}>
            <div className="bg-white rounded-2xl shadow-xl w-[420px] overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-6 pt-5 pb-4 border-b border-gray-border">
                <div className="text-[16px] font-extrabold text-ink">운영시간 설정</div>
                <div className="text-[12px] text-gray-text mt-0.5">요일별 운영 시간을 설정하세요</div>
              </div>
              <div className="px-6 py-4 space-y-2">
                {[
                  { key: 'mon', label: '월' },
                  { key: 'tue', label: '화' },
                  { key: 'wed', label: '수' },
                  { key: 'thu', label: '목' },
                  { key: 'fri', label: '금' },
                  { key: 'sat', label: '토' },
                  { key: 'sun', label: '일' },
                ].map(({ key, label }) => {
                  const day = hoursDraft[key] ?? { enabled: true, open: '09:00', close: '21:00' }
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <span className="w-6 text-[13px] font-bold text-ink">{label}</span>
                      <button
                        onClick={() => setHoursDraft(prev => ({ ...prev, [key]: { ...day, enabled: !day.enabled } }))}
                        className={`w-10 h-6 rounded-full relative transition-colors flex-shrink-0 ${day.enabled ? 'bg-[#16a84c]' : 'bg-gray-200'}`}
                      >
                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${day.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                      {day.enabled ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="time"
                            value={day.open}
                            onChange={e => setHoursDraft(prev => ({ ...prev, [key]: { ...day, open: e.target.value } }))}
                            className="flex-1 border border-gray-border rounded-lg px-2 py-1 text-[13px] text-ink outline-none focus:border-[#16a84c]"
                          />
                          <span className="text-gray-text text-[12px]">~</span>
                          <input
                            type="time"
                            value={day.close}
                            onChange={e => setHoursDraft(prev => ({ ...prev, [key]: { ...day, close: e.target.value } }))}
                            className="flex-1 border border-gray-border rounded-lg px-2 py-1 text-[13px] text-ink outline-none focus:border-[#16a84c]"
                          />
                        </div>
                      ) : (
                        <span className="text-[12px] text-gray-text flex-1">운영 안 함</span>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="px-6 py-4 border-t border-gray-border flex gap-2">
                <button
                  onClick={() => setHoursOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-text font-bold text-[13px] hover:bg-gray-200 transition-colors"
                >취소</button>
                <button
                  onClick={saveOperatingHours}
                  className="flex-1 py-2.5 rounded-xl bg-[#16a84c] text-white font-bold text-[13px] hover:opacity-90 transition-opacity"
                >저장</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 프로필 모달 ── */}
        {profileOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50" onClick={() => setProfileOpen(false)}>
            <div className="bg-white rounded-2xl shadow-xl w-[340px] overflow-hidden" onClick={e => e.stopPropagation()}>

              {/* 헤더 */}
              <div className="px-6 pt-6 pb-5 border-b border-gray-border">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-[#16a84c] text-white flex items-center justify-center text-[20px] font-bold flex-shrink-0">
                    {(session.storeName || '샐')[0]}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[16px] font-extrabold text-ink leading-tight truncate">{session.storeName || '샐러리아'}</div>
                    <div className="text-[12px] text-gray-text mt-0.5 truncate">{authObj?.user.email ?? ''}</div>
                  </div>
                </div>
              </div>

              {/* 가게 현황 */}
              <div className="px-6 py-4 border-b border-gray-border flex gap-3">
                {[
                  { label: '등록 고객', value: customerCount !== null ? `${customerCount}명` : '—' },
                  { label: '등록 메뉴', value: menuCount     !== null ? `${menuCount}개`     : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex-1 bg-gray-bg rounded-xl py-3 text-center">
                    <div className="text-[11px] text-gray-text font-semibold">{label}</div>
                    <div className="text-[18px] font-extrabold text-ink mt-0.5">{value}</div>
                  </div>
                ))}
              </div>

              {/* 가게 이름 수정 */}
              <div className="px-6 py-4 border-b border-gray-border">
                <div className="text-[11px] font-bold text-gray-text mb-2">가게 이름</div>
                {editingName ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={nameInput}
                      onChange={e => setNameInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveStoreName(); if (e.key === 'Escape') setEditingName(false) }}
                      className="flex-1 border border-gray-border rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-[#16a84c]"
                    />
                    <button
                      onClick={handleSaveStoreName}
                      disabled={profileSaving}
                      className="px-3 py-2 bg-[#16a84c] text-white text-[13px] font-bold rounded-lg hover:opacity-85 disabled:opacity-50"
                    >저장</button>
                    <button
                      onClick={() => setEditingName(false)}
                      className="px-3 py-2 bg-gray-100 text-gray-text text-[13px] font-bold rounded-lg hover:bg-gray-200"
                    >취소</button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-semibold text-ink">{session.storeName || '—'}</span>
                    <button
                      onClick={() => { setNameInput(session.storeName ?? ''); setEditingName(true) }}
                      className="text-[12px] font-semibold text-[#16a84c] hover:underline"
                    >수정</button>
                  </div>
                )}
              </div>

              {/* 비밀번호 변경 */}
              <div className="px-6 py-4 border-b border-gray-border">
                <div className="text-[11px] font-bold text-gray-text mb-2">비밀번호 변경</div>
                <div className="flex flex-col gap-2">
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      placeholder="새 비밀번호"
                      value={pwInput}
                      onChange={e => setPwInput(e.target.value)}
                      className="w-full border border-gray-border rounded-lg px-3 py-2 pr-10 text-[14px] text-ink outline-none focus:border-[#16a84c]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-text hover:text-ink"
                    >
                      {showPw
                        ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPwConfirm ? 'text' : 'password'}
                      placeholder="비밀번호 확인"
                      value={pwConfirm}
                      onChange={e => setPwConfirm(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleChangePassword() }}
                      className="w-full border border-gray-border rounded-lg px-3 py-2 pr-10 text-[14px] text-ink outline-none focus:border-[#16a84c]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwConfirm(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-text hover:text-ink"
                    >
                      {showPwConfirm
                        ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  </div>
                  <button
                    onClick={handleChangePassword}
                    disabled={profileSaving || !pwInput || !pwConfirm}
                    className="py-2 bg-ink text-white text-[13px] font-bold rounded-lg hover:opacity-85 disabled:opacity-40"
                  >변경하기</button>
                </div>
              </div>

              {/* 피드백 메시지 */}
              {profileMsg && (
                <div className={`mx-6 mt-3 px-3 py-2 rounded-lg text-[12px] font-semibold ${profileMsg.ok ? 'bg-green-soft text-green' : 'bg-red-50 text-danger'}`}>
                  {profileMsg.text}
                </div>
              )}

              {/* 로그아웃 */}
              <div className="px-6 py-4">
                <button
                  onClick={handleSignOut}
                  className="w-full py-3 rounded-xl border border-danger/40 text-danger font-bold text-[14px] hover:bg-red-50 transition-colors"
                >
                  로그아웃
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </StoreContext.Provider>
  )
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
      name:     item.menu_name,
      qty:      item.quantity,
      price:    item.unit_price,
      options:  (item.order_item_options ?? []).map((o: any) => o.option_name),
      imageUrl: item.menus?.image_url ?? undefined,
    })),
  }
}
