import React, { useState, useEffect, useRef } from 'react'
import { useOperatingHours } from './hooks/useOperatingHours'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { track } from './lib/firebase'
import { StoreContext, type StoreSession } from './lib/store-context'
import { playOrderSound } from './lib/sound'

import logoWithText from './assets/logo-with-text.png'
import { HeaderSlotContext } from './lib/header-slot'

import Auth        from './pages/Auth'
import Onboarding  from './pages/Onboarding'
import Dashboard   from './pages/Dashboard'
import Orders      from './pages/Orders'
import Customers   from './pages/Customers'
import Menus       from './pages/Menus'
import Sales       from './pages/Sales'
import Settings    from './pages/Settings'
import OrderPopup  from './components/OrderPopup'
import { type Order } from './lib/mock-data'

// ── 앱 상태 ───────────────────────────────────────────────────────────────────
type Phase = 'loading' | 'auth' | 'onboarding' | 'main'
type Tab   = 'dashboard' | 'orders' | 'customers' | 'menus' | 'sales' | 'settings'

// ── 사이드바 아이콘 (2D SVG) ──────────────────────────────────────────────────
function IconHome()     { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg> }
function IconOrders()   { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg> }
function IconCustomers(){ return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a6 6 0 0 1 6-6h2"/><circle cx="17" cy="16" r="3"/><path d="M20.5 19.5 22 21"/></svg> }
function IconMenus()    { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="13" rx="8" ry="4"/><path d="M4 13c0 2.21 3.58 4 8 4s8-1.79 8-4"/><path d="M12 3v2"/><path d="M9 4.5C6.5 5.5 5 7.5 5 10"/><path d="M15 4.5C17.5 5.5 19 7.5 19 10"/></svg> }
function IconSettings() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> }
function IconSales()    { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><polyline points="7 9 10 12 13 9 17 13"/></svg> }

// ── 시 드래그 티커 ────────────────────────────────────────────────────────────
function HourTicker({ value, onChange }: { value: number; onChange: (h: number) => void }) {
  const drag = useRef<{ startX: number; startH: number } | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const prev = (value - 1 + 24) % 24
  const next = (value + 1) % 24

  const handleMouseDown = (e: React.MouseEvent) => {
    drag.current = { startX: e.clientX, startH: value }
    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return
      const diff = Math.round((drag.current.startX - ev.clientX) / 16)
      onChangeRef.current(((drag.current.startH + diff) % 24 + 24) % 24)
    }
    const onUp = () => {
      drag.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    drag.current = { startX: e.touches[0].clientX, startH: value }
  }
  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault()
    if (!drag.current) return
    const diff = Math.round((drag.current.startX - e.touches[0].clientX) / 16)
    onChangeRef.current(((drag.current.startH + diff) % 24 + 24) % 24)
  }

  return (
    <div
      className="flex items-center select-none cursor-ew-resize bg-gray-50 rounded-lg overflow-hidden"
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={() => { drag.current = null }}
    >
      <span className="w-7 text-center text-[11px] text-gray-300 py-1">{String(prev).padStart(2,'0')}</span>
      <span className="w-8 text-center text-[14px] font-bold text-ink bg-white border-x border-gray-200 py-1">{String(value).padStart(2,'0')}</span>
      <span className="w-7 text-center text-[11px] text-gray-300 py-1">{String(next).padStart(2,'0')}</span>
    </div>
  )
}

// ── 요일 행 컴포넌트 (운영시간 설정 모달용) ──────────────────────────────────
function DayRow({
  dayKey, label, hoursDraft, breakDraft, setHoursDraft, setBreakDraft,
}: {
  dayKey: string
  label: string
  hoursDraft: Record<string, { enabled: boolean; open: string; close: string }>
  breakDraft: Record<string, { enabled: boolean; start: string; end: string }>
  setHoursDraft: React.Dispatch<React.SetStateAction<Record<string, { enabled: boolean; open: string; close: string }>>>
  setBreakDraft:  React.Dispatch<React.SetStateAction<Record<string, { enabled: boolean; start: string; end: string }>>>
}) {
  const day = hoursDraft[dayKey] ?? { enabled: dayKey !== 'sun', open: '09:00', close: '21:00' }
  const brk = breakDraft[dayKey] ?? { enabled: false, start: '14:00', end: '17:00' }
  const parseT = (t: string) => { const [h, m] = t.split(':'); return { h: parseInt(h), m } }
  const setTime = (field: 'open' | 'close', h: number, m: string) => {
    setHoursDraft(prev => ({ ...prev, [dayKey]: { ...day, [field]: `${String(h).padStart(2,'0')}:${m}` } }))
  }
  const setBreakField = (field: 'start' | 'end', h: number, m: string) => {
    setBreakDraft(prev => ({ ...prev, [dayKey]: { ...brk, [field]: `${String(h).padStart(2,'0')}:${m}` } }))
  }
  const openT     = parseT(day.open)
  const closeT    = parseT(day.close)
  const brkStartT = parseT(brk.start)
  const brkEndT   = parseT(brk.end)

  return (
    <div className="py-2 space-y-1.5">
      {/* 영업 시간 행 */}
      <div className="flex items-center gap-2">
        <span className="w-5 text-[13px] font-bold text-ink flex-shrink-0">{label}</span>
        <button
          onClick={() => setHoursDraft(prev => ({ ...prev, [dayKey]: { ...day, enabled: !day.enabled } }))}
          className={`relative w-9 h-5 rounded-full flex-shrink-0 transition-colors duration-200 ${day.enabled ? 'bg-[#16a84c]' : 'bg-gray-200'}`}
        >
          <span className={`absolute top-[3px] left-[3px] w-[14px] h-[14px] bg-white rounded-full shadow transition-transform duration-200 ${day.enabled ? 'translate-x-[16px]' : 'translate-x-0'}`} />
        </button>
        {day.enabled ? (
          <div className="flex flex-col gap-1 flex-1">
            {(['open', 'close'] as const).map(field => {
              const { h, m } = field === 'open' ? openT : closeT
              return (
                <div key={field} className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-text w-5 flex-shrink-0">{field === 'open' ? '시작' : '종료'}</span>
                  <HourTicker value={h} onChange={newH => setTime(field, newH, m)} />
                  <span className="text-gray-text text-[12px] mx-0.5">:</span>
                  {['00','15','30','45'].map(min => (
                    <button
                      key={min}
                      onClick={() => setTime(field, h, min)}
                      className={`w-7 h-6 rounded text-[11px] font-semibold transition-colors ${m === min ? 'bg-green-soft text-ink' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
                    >{min}</button>
                  ))}
                </div>
              )
            })}
          </div>
        ) : (
          <span className="text-[12px] text-gray-text">운영 안 함</span>
        )}
      </div>

      {/* 브레이크타임 (영업일만) */}
      {day.enabled && (
        <div className="flex items-start gap-2 pl-7">
          <span className="text-[11px] font-semibold text-gray-text w-[58px] pt-1.5 flex-shrink-0">브레이크</span>
          <button
            onClick={() => setBreakDraft(prev => ({ ...prev, [dayKey]: { ...brk, enabled: !brk.enabled } }))}
            className={`relative w-9 h-5 rounded-full flex-shrink-0 mt-1 transition-colors duration-200 ${brk.enabled ? 'bg-orange-400' : 'bg-gray-200'}`}
          >
            <span className={`absolute top-[3px] left-[3px] w-[14px] h-[14px] bg-white rounded-full shadow transition-transform duration-200 ${brk.enabled ? 'translate-x-[16px]' : 'translate-x-0'}`} />
          </button>
          {brk.enabled ? (
            <div className="flex flex-col gap-1 flex-1">
              {(['start', 'end'] as const).map(field => {
                const { h, m } = field === 'start' ? brkStartT : brkEndT
                return (
                  <div key={field} className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-text w-5 flex-shrink-0">{field === 'start' ? '시작' : '종료'}</span>
                    <HourTicker value={h} onChange={newH => setBreakField(field, newH, m)} />
                    <span className="text-gray-text text-[12px] mx-0.5">:</span>
                    {['00','15','30','45'].map(min => (
                      <button
                        key={min}
                        onClick={() => setBreakField(field, h, min)}
                        className={`w-7 h-6 rounded text-[11px] font-semibold transition-colors ${m === min ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
                      >{min}</button>
                    ))}
                  </div>
                )
              })}
            </div>
          ) : (
            <span className="text-[12px] text-gray-text pt-1">없음</span>
          )}
        </div>
      )}
    </div>
  )
}

const NAV: { id: Tab; Icon: () => JSX.Element; label: string }[] = [
  { id: 'dashboard', Icon: IconHome,      label: '홈' },
  { id: 'orders',    Icon: IconOrders,    label: '주문' },
  { id: 'customers', Icon: IconCustomers, label: '고객' },
  { id: 'menus',     Icon: IconMenus,     label: '메뉴' },
  { id: 'sales',     Icon: IconSales,     label: '정산' },
  { id: 'settings',  Icon: IconSettings,  label: '설정' },
]

const PAGE_TITLES: Record<Tab, string> = {
  dashboard: '홈',
  orders:    '주문관리',
  customers: '고객관리',
  menus:     '메뉴관리',
  sales:     '정산',
  settings:  '설정',
}

export default function App() {
  const [phase,      setPhase]      = useState<Phase>('loading')
  const [session,    setSession]    = useState<StoreSession | null>(null)
  const [authObj,    setAuthObj]    = useState<Session | null>(null)
  const [tab,        setTab]        = useState<Tab>('dashboard')
  const [headerRight, setHeaderRight] = useState<React.ReactNode>(null)
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
  const [pwCurrent,     setPwCurrent]     = useState('')
  const [pwInput,       setPwInput]       = useState('')
  const [pwConfirm,     setPwConfirm]     = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg,    setProfileMsg]    = useState<{ text: string; ok: boolean } | null>(null)
  const [customerCount, setCustomerCount] = useState<number | null>(null)
  const [menuCount,     setMenuCount]     = useState<number | null>(null)
  const [showPwCurrent, setShowPwCurrent] = useState(false)
  const [showPw,        setShowPw]        = useState(false)
  const [showPwConfirm, setShowPwConfirm] = useState(false)
  const [showForgotPw,  setShowForgotPw]  = useState(false)
  const [resetEmail,    setResetEmail]    = useState('')
  const [resetSending,  setResetSending]  = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteLoading,     setDeleteLoading]     = useState(false)

  // 운영 상태 + 운영시간 — useOperatingHours 훅으로 분리

  // ── 인증 + 스토어 로딩 ──────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (!s) { setPhase('auth'); return }
      // 자동 로그인 비활성화 시 저장된 세션 무효화
      if (localStorage.getItem('sallaria_pos_remember') === 'false') {
        await supabase.auth.signOut()
        setPhase('auth')
        return
      }
      setAuthObj(s)
      loadStoreSession(s.user.id, s.user.email ?? '')
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      // INITIAL_SESSION 은 getSession()에서 이미 처리 — 중복 제외
      if (event === 'INITIAL_SESSION') return
      if (event === 'TOKEN_REFRESH_FAILED' || !s) {
        setPhase('auth'); setSession(null); setAuthObj(null); return
      }
      setAuthObj(s)
      // TOKEN_REFRESHED: 세션 갱신만, 스토어 재로딩하면 onboarding 중 홈으로 튕김
      if (event === 'TOKEN_REFRESHED') return
      loadStoreSession(s.user.id, s.user.email ?? '')
    })
    return () => subscription.unsubscribe()
  }, [])

  // 탭 변경 시 헤더 슬롯 초기화
  useEffect(() => { setHeaderRight(null) }, [tab])

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
      .select('id, name, is_open')
      .eq('client_id', client.id)
      .limit(1)

    if (!stores || stores.length === 0) {
      setSession({ userId, clientId: client.id, storeId: '', storeName: '' })
      setPhase('onboarding')
      return
    }

    const store = stores[0]
    setSession({ userId, clientId: client.id, storeId: store.id, storeName: store.name })

    // DB의 is_open 값으로 초기 상태 동기화
    if (store.is_open !== undefined && store.is_open !== null) {
      setIsOpen(store.is_open)
    }
    track('pos_store_login', { store_id: store.id, store_name: store.name })
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
          order_number, order_code, orderer_name, orderer_phone,
          ordered_at, total_amount, balance_before, balance_after,
          method, status, note,
          accounts ( account_name ),
          order_items (
            order_item_id, menu_name, quantity, unit_price,
            menus ( image_url ),
            order_item_options ( id, option_name, extra_price, option_items ( option_groups ( name ) ) )
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
      order_number, order_code, orderer_name, orderer_phone,
      ordered_at, total_amount, balance_before, balance_after,
      method, status, note,
      accounts ( account_name ),
      order_items (
        order_item_id, menu_name, quantity, unit_price,
        menus ( image_url ),
        order_item_options ( id, option_name, extra_price, option_items ( option_groups ( name ) ) )
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
      // 기존 타이머 취소 (중복 subscribe 방지)
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }

      channel = supabase
        .channel(`store-${session?.storeId}-orders-${Date.now()}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'orders' },
          (payload: any) => {
            fetchAndQueue(payload.new.order_code)
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'stores' },
          (payload: any) => {
            const newIsOpen = payload.new?.is_open
            if (typeof newIsOpen === 'boolean') {
              setIsOpen(newIsOpen)
              // 다른 기기의 변경이 권위 있음 — 수동 오버라이드 해제
              manualOverrideRef.current = null
            }
          }
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            setWsStatus('connected')
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setWsStatus('disconnected')
            // 이미 재연결 타이머가 있으면 추가 등록하지 않음
            if (!retryTimer) {
              retryTimer = setTimeout(() => {
                retryTimer = null
                if (channel) { supabase.removeChannel(channel); channel = null }
                subscribe()
              }, 5000)
            }
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
  }, [phase, session?.storeId])

  // ── 폴링 폴백: Realtime 누락 주문 복구 (30초마다) ──────────────────────────
  // Realtime이 끊긴 사이 들어온 '주문완료' 상태 주문을 폴링으로 잡아냄
  useEffect(() => {
    if (phase !== 'main') return

    const ORDER_SELECT_POLL = `
      order_number, order_code, orderer_name, orderer_phone,
      ordered_at, total_amount, balance_before, balance_after,
      method, status, note,
      accounts ( account_name ),
      order_items (
        order_item_id, menu_name, quantity, unit_price,
        menus ( image_url ),
        order_item_options ( id, option_name, extra_price, option_items ( option_groups ( name ) ) )
      )
    `

    async function poll() {
      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      const { data } = await supabase
        .from('orders')
        .select(ORDER_SELECT_POLL)
        .eq('status', '주문완료')
        .eq('store_id', session?.storeId ?? '')
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
  }, [phase, session?.storeId])

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

  // 운영 상태 + 운영시간 훅 (is_open 진실 공급원 = DB)
  const {
    isOpen, setIsOpen,
    autoOpenEnabled,
    hoursOpen, setHoursOpen,
    operatingHours,
    breakTime,
    hoursDraft, setHoursDraft,
    breakDraft, setBreakDraft,
    offHoursConfirm, setOffHoursConfirm,
    closureOpen, setClosureOpen,
    closureType, setClosureType,
    closureTime, setClosureTime,
    closureActive,
    overrideType,
    vacationDays,
    vacationOpen, setVacationOpen,
    toggleIsOpen,
    toggleAutoOpenEnabled,
    confirmForceOpen,
    saveOperatingHours,
    confirmClosure,
    cancelClosure,
    saveVacationDays,
    deleteVacationDay,
  } = useOperatingHours(session?.storeId, showToast)

  // ── 휴가 예약 모달 로컬 상태 ──────────────────────────────────────────────────
  const [vacCalYear,    setVacCalYear]    = useState(() => new Date().getFullYear())
  const [vacCalMonth,   setVacCalMonth]   = useState(() => new Date().getMonth())
  // 선택된 날짜별 설정 draft: date → { type, openTime, closeTime }
  const [vacDraft,      setVacDraft]      = useState<Record<string, { type: 'holiday' | 'custom'; openTime: string; closeTime: string }>>({})

  function openVacationModal() {
    // 기존 저장된 휴가를 draft에 로드
    const init: Record<string, { type: 'holiday' | 'custom'; openTime: string; closeTime: string }> = {}
    vacationDays.forEach(v => {
      init[v.date] = { type: v.type, openTime: v.openTime ?? '09:00', closeTime: v.closeTime ?? '18:00' }
    })
    setVacDraft(init)
    setVacCalYear(new Date().getFullYear())
    setVacCalMonth(new Date().getMonth())
    setVacationOpen(true)
  }

  function toggleVacDate(dateStr: string) {
    setVacDraft(prev => {
      if (prev[dateStr]) {
        const next = { ...prev }
        delete next[dateStr]
        return next
      }
      return { ...prev, [dateStr]: { type: 'holiday', openTime: '09:00', closeTime: '18:00' } }
    })
  }

  async function handleSaveVacation() {
    const days = Object.entries(vacDraft).map(([date, cfg]) => ({
      date,
      type:      cfg.type,
      openTime:  cfg.type === 'custom' ? cfg.openTime  : undefined,
      closeTime: cfg.type === 'custom' ? cfg.closeTime : undefined,
    }))
    await saveVacationDays(days)
  }

  function dismissPopup() {
    setQueue(q => q.slice(1))
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  async function handleDeleteAccount() {
    setDeleteLoading(true)
    const { error } = await supabase.rpc('delete_my_account')
    if (error) {
      setDeleteLoading(false)
      setDeleteConfirmOpen(false)
      showToast('탈퇴 처리 중 오류가 발생했습니다.')
      return
    }
    await supabase.auth.signOut()
  }

  async function openProfile() {
    setNameInput(session?.storeName ?? '')
    setPwCurrent('')
    setPwInput('')
    setPwConfirm('')
    setEditingName(false)
    setProfileMsg(null)
    setShowPwCurrent(false)
    setShowPw(false)
    setShowPwConfirm(false)
    setShowForgotPw(false)
    setResetEmail('')
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
    if (!pwCurrent) { setProfileMsg({ text: '현재 비밀번호를 입력해주세요.', ok: false }); return }
    if (pwInput.length < 6) { setProfileMsg({ text: '새 비밀번호는 6자 이상이어야 합니다.', ok: false }); return }
    if (pwInput !== pwConfirm) { setProfileMsg({ text: '새 비밀번호가 일치하지 않습니다.', ok: false }); return }
    setProfileSaving(true)
    // 현재 비밀번호 검증 (재로그인으로 확인)
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email: authObj?.user.email ?? '',
      password: pwCurrent,
    })
    if (verifyErr) {
      setProfileMsg({ text: '현재 비밀번호가 올바르지 않습니다.', ok: false })
      setProfileSaving(false)
      return
    }
    const { error } = await supabase.auth.updateUser({ password: pwInput })
    if (error) {
      setProfileMsg({ text: '변경 실패: ' + error.message, ok: false })
    } else {
      setPwCurrent('')
      setPwInput('')
      setPwConfirm('')
      setProfileMsg({ text: '비밀번호가 변경됐습니다.', ok: true })
    }
    setProfileSaving(false)
  }

  async function handleResetPassword() {
    const email = resetEmail.trim() || authObj?.user.email || ''
    if (!email) { setProfileMsg({ text: '이메일을 입력해주세요.', ok: false }); return }
    setResetSending(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    if (error) {
      setProfileMsg({ text: '전송 실패: ' + error.message, ok: false })
    } else {
      setProfileMsg({ text: `${email}으로 재설정 링크를 보냈습니다. 이메일을 확인해주세요.`, ok: true })
      setShowForgotPw(false)
      setResetEmail('')
    }
    setResetSending(false)
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
    sales:     <Sales />,
    settings:  <Settings onOpenHours={() => { setHoursDraft({ ...operatingHours }); setBreakDraft({ ...breakTime }); setHoursOpen(true) }} />,
  }

  return (
    <StoreContext.Provider value={session}>
      <div className="flex flex-col h-full w-full overflow-hidden">

        {/* ── 공통 상단 헤더 ── */}
        <header className="flex-shrink-0 h-[54px] bg-white border-b border-gray-border flex items-stretch">
          <button
            onClick={() => setTab('dashboard')}
            title="홈으로"
            className="w-[176px] flex-shrink-0 px-5 flex items-center hover:opacity-75 transition-opacity"
          >
            <img src={logoWithText} alt="sunpos" className="h-[48px] object-contain object-left" />
          </button>
          <div className="flex-1 px-4 flex items-center justify-between">
            <span className="text-[16px] font-extrabold text-ink">{PAGE_TITLES[tab]}</span>
            <div className="flex items-center gap-2">{headerRight}</div>
          </div>
        </header>

        {/* ── 사이드바 + 컨텐츠 ── */}
        <div className="flex flex-1 overflow-hidden">

        {/* ── 사이드바 ── */}
        <aside className="w-[176px] flex-shrink-0 bg-white dark:bg-[#242424] border-r border-gray-border flex flex-col">

          {/* 네비게이션 */}
          <nav className="flex-1 py-3 px-3 space-y-0.5 overflow-y-auto">
            {NAV.map(({ id, Icon, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors
                  ${tab === id
                    ? 'bg-green-soft text-[#16a84c] font-bold'
                    : 'text-gray-text hover:bg-gray-bg hover:text-ink font-medium'}`}
              >
                <span className="flex-shrink-0"><Icon /></span>
                <span className="text-[13px] leading-tight">{label}</span>
              </button>
            ))}
          </nav>

          {/* 하단: 운영 토글 + 프로필 */}
          <div className="px-4 py-4 border-t border-gray-border flex-shrink-0 space-y-3">
            {/* 운영 상태 토글 */}
            <button
              onClick={toggleIsOpen}
              title={isOpen ? '운영중 — 클릭해서 종료' : '운영종료 — 클릭해서 시작'}
              className="flex items-center gap-2.5 w-full group"
            >
              <div className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 flex-shrink-0 ${isOpen ? 'bg-[#16a84c]' : 'bg-gray-300'}`}>
                <span className={`absolute top-[3px] left-[3px] w-3 h-3 bg-white rounded-full shadow-sm transition-transform duration-200 ${isOpen ? 'translate-x-[14px]' : 'translate-x-0'}`} />
              </div>
              <span className={`text-[12px] font-semibold leading-none ${isOpen ? 'text-[#16a84c]' : 'text-gray-text'}`}>
                {isOpen ? '운영 중' : '종료됨'}
              </span>
            </button>

            {/* 프로필 버튼 */}
            <button
              onClick={openProfile}
              title={session.storeName || '프로필'}
              className="flex items-center gap-2.5 w-full px-0 hover:opacity-70 transition-opacity"
            >
              <div className="w-7 h-7 rounded-full bg-gray-200 text-gray-text flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                {(session.storeName || '프')[0]}
              </div>
              <span className="text-[12px] font-medium text-ink truncate">{session.storeName || '프로필'}</span>
            </button>
          </div>
        </aside>

        {/* ── 컨텐츠 ── */}
        <HeaderSlotContext.Provider value={{ setHeaderRight }}>
          <main className="flex-1 overflow-hidden">
            {PAGE[tab]}
          </main>
        </HeaderSlotContext.Provider>

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

        {/* ── 조기마감 모달 ── */}
        {closureOpen && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-2xl shadow-xl w-[420px] px-6 py-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
              <div>
                <div className="text-[15px] font-extrabold text-ink">조기마감</div>
                <div className="text-[12px] text-gray-text mt-0.5">오늘 지정한 시간부터 자동으로 영업이 종료됩니다</div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[13px] text-gray-text flex-shrink-0">마감 시간</span>
                <HourTicker
                  value={parseInt(closureTime.split(':')[0])}
                  onChange={h => setClosureTime(`${String(h).padStart(2,'0')}:${closureTime.split(':')[1]}`)}
                />
                <span className="text-gray-text text-[13px]">:</span>
                {(['00','15','30','45'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setClosureTime(`${closureTime.split(':')[0]}:${m}`)}
                    className={`w-8 h-6 rounded text-[11px] font-semibold transition-colors ${closureTime.split(':')[1] === m ? 'bg-green-soft text-ink' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
                  >{m}</button>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setClosureOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-text font-bold text-[13px] hover:bg-gray-200 transition-colors"
                >취소</button>
                <button
                  onClick={() => { setClosureType('early'); confirmClosure() }}
                  className="flex-1 py-2.5 rounded-xl bg-[#16a84c] text-white font-bold text-[13px] hover:opacity-90 transition-opacity"
                >조기마감 확정</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 휴가예약 모달 ── */}
        {vacationOpen && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50" onClick={() => setVacationOpen(false)}>
            <div className="bg-white rounded-2xl shadow-xl w-[680px] max-h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* 헤더 */}
              <div className="px-6 pt-5 pb-4 border-b border-gray-border flex-shrink-0">
                <div className="text-[16px] font-extrabold text-ink">휴가 예약</div>
                <div className="text-[12px] text-gray-text mt-0.5">날짜를 선택하고 하루 휴점 또는 단축 운영을 설정하세요</div>
              </div>

              <div className="flex flex-1 overflow-hidden min-h-0">
                {/* 캘린더 */}
                <div className="w-[320px] flex-shrink-0 border-r border-gray-border p-4 flex flex-col">
                  {/* 월 이동 */}
                  <div className="flex items-center justify-between mb-3">
                    <button
                      onClick={() => { const d = new Date(vacCalYear, vacCalMonth - 1, 1); setVacCalYear(d.getFullYear()); setVacCalMonth(d.getMonth()) }}
                      className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-text"
                    >‹</button>
                    <span className="text-[14px] font-bold text-ink">{vacCalYear}년 {vacCalMonth + 1}월</span>
                    <button
                      onClick={() => { const d = new Date(vacCalYear, vacCalMonth + 1, 1); setVacCalYear(d.getFullYear()); setVacCalMonth(d.getMonth()) }}
                      className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-text"
                    >›</button>
                  </div>
                  {/* 요일 헤더 */}
                  <div className="grid grid-cols-7 mb-1">
                    {['일','월','화','수','목','금','토'].map((d, i) => (
                      <div key={d} className={`text-center text-[11px] font-bold py-1 ${i === 0 ? 'text-danger' : i === 6 ? 'text-blue-500' : 'text-gray-text'}`}>{d}</div>
                    ))}
                  </div>
                  {/* 날짜 그리드 */}
                  {(() => {
                    const today = new Date()
                    today.setHours(0,0,0,0)
                    const firstDay = new Date(vacCalYear, vacCalMonth, 1).getDay()
                    const daysInMonth = new Date(vacCalYear, vacCalMonth + 1, 0).getDate()
                    const cells: JSX.Element[] = []
                    for (let i = 0; i < firstDay; i++) cells.push(<div key={`e${i}`} />)
                    for (let d = 1; d <= daysInMonth; d++) {
                      const dateStr = `${vacCalYear}-${String(vacCalMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
                      const cellDate = new Date(vacCalYear, vacCalMonth, d)
                      const isPast = cellDate < today
                      const isSelected = !!vacDraft[dateStr]
                      const dow = cellDate.getDay()
                      cells.push(
                        <button
                          key={d}
                          disabled={isPast}
                          onClick={() => toggleVacDate(dateStr)}
                          className={`aspect-square flex items-center justify-center text-[13px] font-semibold rounded-full transition-colors
                            ${isPast ? 'opacity-30 cursor-not-allowed' : ''}
                            ${isSelected ? 'bg-[#16a84c] text-white' : isPast ? '' : 'hover:bg-gray-100'}
                            ${!isSelected && dow === 0 ? 'text-danger' : ''}
                            ${!isSelected && dow === 6 ? 'text-blue-500' : ''}
                            ${!isSelected && dow !== 0 && dow !== 6 ? 'text-ink' : ''}`}
                        >{d}</button>
                      )
                    }
                    return <div className="grid grid-cols-7 gap-y-0.5">{cells}</div>
                  })()}
                </div>

                {/* 선택된 날짜 설정 패널 */}
                <div className="flex-1 overflow-y-auto p-4">
                  {Object.keys(vacDraft).length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center">
                      <div className="text-[32px] mb-2">📅</div>
                      <div className="text-[13px] text-gray-text">왼쪽 캘린더에서 휴가 날짜를 선택하세요</div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {Object.entries(vacDraft).sort(([a],[b]) => a.localeCompare(b)).map(([dateStr, cfg]) => {
                        const [y, mo, d] = dateStr.split('-')
                        const dow = ['일','월','화','수','목','금','토'][new Date(Number(y), Number(mo)-1, Number(d)).getDay()]
                        return (
                          <div key={dateStr} className="border border-gray-border rounded-xl p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[13px] font-bold text-ink">{mo}월 {d}일 ({dow})</span>
                              <button
                                onClick={() => toggleVacDate(dateStr)}
                                className="text-gray-text hover:text-danger text-[13px]"
                              >✕</button>
                            </div>
                            {/* 타입 선택 */}
                            <div className="flex gap-2">
                              {([
                                { value: 'holiday', label: '하루 휴점' },
                                { value: 'custom',  label: '시간 설정' },
                              ] as const).map(({ value, label }) => (
                                <button
                                  key={value}
                                  onClick={() => setVacDraft(prev => ({ ...prev, [dateStr]: { ...cfg, type: value } }))}
                                  className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors
                                    ${cfg.type === value
                                      ? 'bg-green-soft text-ink'
                                      : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
                                >{label}</button>
                              ))}
                            </div>
                            {/* 시간 설정 (custom) */}
                            {cfg.type === 'custom' && (
                              <div className="space-y-1.5 pt-1">
                                {(['open', 'close'] as const).map(field => {
                                  const timeVal = field === 'open' ? cfg.openTime : cfg.closeTime
                                  const [hStr, mStr] = timeVal.split(':')
                                  const h = parseInt(hStr)
                                  return (
                                    <div key={field} className="flex items-center gap-1.5">
                                      <span className="text-[10px] text-gray-text w-6 flex-shrink-0">{field === 'open' ? '시작' : '종료'}</span>
                                      <HourTicker
                                        value={h}
                                        onChange={newH => setVacDraft(prev => ({
                                          ...prev,
                                          [dateStr]: { ...cfg, [field === 'open' ? 'openTime' : 'closeTime']: `${String(newH).padStart(2,'0')}:${mStr}` }
                                        }))}
                                      />
                                      <span className="text-gray-text text-[12px] mx-0.5">:</span>
                                      {['00','15','30','45'].map(min => (
                                        <button
                                          key={min}
                                          onClick={() => setVacDraft(prev => ({
                                            ...prev,
                                            [dateStr]: { ...cfg, [field === 'open' ? 'openTime' : 'closeTime']: `${hStr}:${min}` }
                                          }))}
                                          className={`w-8 h-6 rounded text-[11px] font-semibold transition-colors ${mStr === min ? 'bg-green-soft text-ink' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
                                        >{min}</button>
                                      ))}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* 하단 버튼 */}
              <div className="px-6 py-4 border-t border-gray-border flex-shrink-0 flex gap-2">
                <button
                  onClick={() => setVacationOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-text font-bold text-[13px] hover:bg-gray-200 transition-colors"
                >취소</button>
                <button
                  onClick={handleSaveVacation}
                  className="flex-1 py-2.5 rounded-xl bg-[#16a84c] text-white font-bold text-[13px] hover:opacity-90 transition-opacity"
                >저장 ({Object.keys(vacDraft).length}일)</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 운영시간 외 강제 ON 확인 다이얼로그 ── */}
        {offHoursConfirm && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-2xl shadow-xl w-[320px] px-6 py-6 flex flex-col gap-4">
              <div>
                <div className="text-[15px] font-extrabold text-ink mb-1">운영시간이 아닙니다</div>
                <div className="text-[13px] text-gray-text leading-relaxed">현재는 설정한 운영시간이 아니에요.<br/>그래도 운영 상태로 바꿀까요?</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffHoursConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-text font-bold text-[13px] hover:bg-gray-200 transition-colors"
                >취소</button>
                <button
                  onClick={confirmForceOpen}
                  className="flex-1 py-2.5 rounded-xl bg-[#16a84c] text-white font-bold text-[13px] hover:opacity-90 transition-opacity"
                >운영 시작</button>
              </div>
            </div>
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
            <div className="bg-white rounded-2xl shadow-xl w-[820px] overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
              {/* 헤더 */}
              <div className="px-6 pt-5 pb-4 border-b border-gray-border flex items-center justify-between">
                <div>
                  <div className="text-[16px] font-extrabold text-ink">운영시간 설정</div>
                  <div className="text-[12px] text-gray-text mt-0.5">요일별 운영 시간을 설정하세요</div>
                </div>
                <div className="flex items-center gap-2">
                  {closureActive && (
                    <button
                      onClick={cancelClosure}
                      className="text-[12px] font-semibold text-danger border border-danger rounded-lg px-3 py-1.5 hover:bg-red-50 transition-colors"
                    >조기마감 취소</button>
                  )}
                  <button
                    onClick={() => { setClosureTime('18:00'); setClosureOpen(true) }}
                    className="text-[12px] font-semibold text-gray-text bg-gray-100 rounded-lg px-3 py-1.5 hover:bg-gray-200 transition-colors"
                  >조기마감</button>
                  <button
                    onClick={openVacationModal}
                    className="text-[12px] font-semibold text-gray-text bg-gray-100 rounded-lg px-3 py-1.5 hover:bg-gray-200 transition-colors"
                  >휴가예약</button>
                </div>
              </div>

              {/* 요일 2컬럼 */}
              <div className="flex-1 overflow-y-auto">
                <div className="grid grid-cols-2 divide-x divide-gray-100">
                  {/* 왼쪽: 월~금 */}
                  <div className="px-5 py-2 divide-y divide-gray-100">
                    <div className="pb-1 text-[11px] font-bold text-gray-text uppercase tracking-wide">평일</div>
                    {[
                      { key: 'mon', label: '월' },
                      { key: 'tue', label: '화' },
                      { key: 'wed', label: '수' },
                      { key: 'thu', label: '목' },
                      { key: 'fri', label: '금' },
                    ].map(({ key, label }) => <DayRow key={key} dayKey={key} label={label} hoursDraft={hoursDraft} breakDraft={breakDraft} setHoursDraft={setHoursDraft} setBreakDraft={setBreakDraft} />)}
                  </div>
                  {/* 오른쪽: 토~일 */}
                  <div className="px-5 py-2 divide-y divide-gray-100">
                    <div className="pb-1 text-[11px] font-bold text-gray-text uppercase tracking-wide">주말</div>
                    {[
                      { key: 'sat', label: '토' },
                      { key: 'sun', label: '일' },
                    ].map(({ key, label }) => <DayRow key={key} dayKey={key} label={label} hoursDraft={hoursDraft} breakDraft={breakDraft} setHoursDraft={setHoursDraft} setBreakDraft={setBreakDraft} />)}
                    {/* 예약된 휴가 미리보기 */}
                    {vacationDays.length > 0 && (
                      <div className="pt-3">
                        <div className="text-[11px] font-bold text-gray-text uppercase tracking-wide mb-2">예약된 휴가</div>
                        <div className="space-y-1.5">
                          {vacationDays.slice(0, 5).map(v => (
                            <div key={v.date} className="flex items-center justify-between gap-2">
                              <span className="text-[12px] text-ink font-semibold">{v.date}</span>
                              <span className="text-[11px] text-gray-text">
                                {v.type === 'holiday' ? '하루 휴점' : `${v.openTime}~${v.closeTime}`}
                              </span>
                              <button
                                onClick={() => deleteVacationDay(v.date)}
                                className="text-[11px] text-danger hover:opacity-70"
                              >✕</button>
                            </div>
                          ))}
                          {vacationDays.length > 5 && (
                            <div className="text-[11px] text-gray-text">외 {vacationDays.length - 5}건...</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
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
                    {(session.storeName || '프')[0]}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[16px] font-extrabold text-ink leading-tight truncate">{session.storeName || '프리POS'}</div>
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
              <div className="px-6 py-4">
                <div className="text-[11px] font-bold text-gray-text mb-2">비밀번호 변경</div>

                {!showForgotPw ? (
                  <div className="flex flex-col gap-2">
                    {/* 현재 비밀번호 */}
                    <div className="relative">
                      <input
                        type={showPwCurrent ? 'text' : 'password'}
                        placeholder="현재 비밀번호"
                        value={pwCurrent}
                        onChange={e => setPwCurrent(e.target.value)}
                        className="w-full border border-gray-border rounded-lg px-3 py-2 pr-10 text-[14px] text-ink outline-none focus:border-[#16a84c]"
                      />
                      <button type="button" onClick={() => setShowPwCurrent(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-text hover:text-ink">
                        {showPwCurrent
                          ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                          : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        }
                      </button>
                    </div>
                    {/* 새 비밀번호 */}
                    <div className="relative">
                      <input
                        type={showPw ? 'text' : 'password'}
                        placeholder="새 비밀번호 (6자 이상)"
                        value={pwInput}
                        onChange={e => setPwInput(e.target.value)}
                        className="w-full border border-gray-border rounded-lg px-3 py-2 pr-10 text-[14px] text-ink outline-none focus:border-[#16a84c]"
                      />
                      <button type="button" onClick={() => setShowPw(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-text hover:text-ink">
                        {showPw
                          ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                          : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        }
                      </button>
                    </div>
                    {/* 새 비밀번호 확인 */}
                    <div className="relative">
                      <input
                        type={showPwConfirm ? 'text' : 'password'}
                        placeholder="새 비밀번호 확인"
                        value={pwConfirm}
                        onChange={e => setPwConfirm(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleChangePassword() }}
                        className="w-full border border-gray-border rounded-lg px-3 py-2 pr-10 text-[14px] text-ink outline-none focus:border-[#16a84c]"
                      />
                      <button type="button" onClick={() => setShowPwConfirm(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-text hover:text-ink">
                        {showPwConfirm
                          ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                          : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        }
                      </button>
                    </div>
                    <button
                      onClick={handleChangePassword}
                      disabled={profileSaving || !pwCurrent || !pwInput || !pwConfirm}
                      className="py-2 bg-ink text-white text-[13px] font-bold rounded-lg hover:opacity-85 disabled:opacity-40"
                    >{profileSaving ? '확인 중...' : '변경하기'}</button>
                    <button
                      type="button"
                      onClick={() => { setShowForgotPw(true); setResetEmail(authObj?.user.email ?? '') }}
                      className="text-[11px] text-gray-text hover:text-ink text-center underline underline-offset-2 transition-colors"
                    >비밀번호를 잊으셨나요?</button>
                  </div>
                ) : (
                  /* 비밀번호 찾기 (이메일 재설정 링크) */
                  <div className="flex flex-col gap-2">
                    <p className="text-[12px] text-gray-text">가입한 이메일로 재설정 링크를 보냅니다.</p>
                    <input
                      type="email"
                      placeholder="이메일 주소"
                      value={resetEmail}
                      onChange={e => setResetEmail(e.target.value)}
                      className="w-full border border-gray-border rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-[#16a84c]"
                    />
                    <button
                      onClick={handleResetPassword}
                      disabled={resetSending || !resetEmail.trim()}
                      className="py-2 bg-ink text-white text-[13px] font-bold rounded-lg hover:opacity-85 disabled:opacity-40"
                    >{resetSending ? '전송 중...' : '재설정 링크 보내기'}</button>
                    <button
                      type="button"
                      onClick={() => setShowForgotPw(false)}
                      className="text-[11px] text-gray-text hover:text-ink text-center transition-colors"
                    >← 비밀번호 직접 변경</button>
                  </div>
                )}
              </div>

              {/* 피드백 메시지 */}
              {profileMsg && (
                <div className={`mx-6 mt-3 px-3 py-2 rounded-lg text-[12px] font-semibold ${profileMsg.ok ? 'bg-green-soft text-green' : 'bg-red-50 text-danger'}`}>
                  {profileMsg.text}
                </div>
              )}

              {/* 로그아웃 + 회원탈퇴 */}
              <div className="px-6 pb-5 pt-1 flex items-center justify-between">
                <button
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="text-[12px] text-gray-300 font-normal hover:text-gray-400 transition-colors"
                >
                  회원탈퇴
                </button>
                <button
                  onClick={handleSignOut}
                  className="text-[12px] text-ink font-semibold hover:text-gray-text transition-colors"
                >
                  로그아웃
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 회원탈퇴 확인 모달 ── */}
        {deleteConfirmOpen && (
          <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50">
            <div className="bg-white rounded-2xl shadow-xl w-[320px] px-6 py-6 flex flex-col gap-4">
              <div>
                <div className="text-[16px] font-extrabold text-ink mb-1">정말 탈퇴하시겠습니까?</div>
                <div className="text-[13px] text-gray-text leading-relaxed">
                  계정과 매장의 모든 데이터가 삭제되며<br />복구할 수 없습니다.
                </div>
              </div>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteLoading}
                className="text-center text-[13px] text-gray-300 font-normal hover:opacity-70 disabled:opacity-40 transition-opacity"
              >
                {deleteLoading ? '탈퇴 처리 중...' : '그래도 탈퇴하기'}
              </button>
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={deleteLoading}
                className="w-full py-3 rounded-xl bg-[#16a84c] text-white font-bold text-[14px] hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                유지하기
              </button>
            </div>
          </div>
        )}
        </div>{/* flex flex-1 overflow-hidden */}
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
      optionDetails: (item.order_item_options ?? []).map((o: any) => ({
        name:       o.option_name,
        extraPrice: o.extra_price ?? 0,
        groupName:  o.option_items?.option_groups?.name ?? undefined,
      })),
      imageUrl: item.menus?.image_url ?? undefined,
    })),
  }
}
