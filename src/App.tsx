import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import { useOperatingHours } from './hooks/useOperatingHours'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { checkPhoneLoginState, PASSWORD_MIN_LEN } from './lib/auth-helpers'
import { track } from './lib/firebase'
import { StoreContext, type StoreSession } from './lib/store-context'
import { playOrderSound, startOrderAlarm, stopOrderAlarm, getSavedVolume } from './lib/sound'
import { readSetting } from './hooks/usePersistentState'

import storeIcon from './assets/icons/store.svg'
import { HeaderSlotContext } from './lib/header-slot'
import { formatKstDate, formatKstTime } from './lib/datetime'

import AuthEntry   from './pages/auth/AuthEntry'
import LoginScreen from './pages/auth/LoginScreen'
import SignupFlow  from './pages/auth/signup/SignupFlow'
import PhoneAuthFlow from './pages/auth/signup/PhoneAuthFlow'
import type { SignupData } from './pages/auth/signup/types'
import QrPasswordSetupModal from './components/auth/QrPasswordSetupModal'
import Home       from './pages/Home'
import Orders     from './pages/Orders'
import Customers   from './pages/Customers'
import Menus       from './pages/Menus'
import { UpgradeModal } from './pages/Sales'
import Settings    from './pages/Settings'
import StoreInfo   from './pages/StoreInfo'
import CustomerHub, { type CustomerHubTab } from './pages/CustomerHub'
import ProductHub, { type ProductHubTab } from './pages/ProductHub'
import SupportModal from './components/SupportModal'
import NotificationBell from './components/ui/NotificationBell'
import SettingsHub, { type SettingsHubTab } from './pages/SettingsHub'
import SalesHub, { type SalesHubTab } from './pages/SalesHub'
import OrderPopup  from './components/OrderPopup'
import ProfileModal from './components/ProfileModal'
import { type Order } from './lib/mock-data'
import { mapOrderRow } from './lib/mappers'

// ── 주문 SELECT 쿼리 (Realtime / 폴링 / IPC 공용) ────────────────────────────
const ORDER_SELECT = `
  order_number, order_code, orderer_name, orderer_phone,
  ordered_at, total_amount, balance_before, balance_after,
  method, status, note, requested_pickup_minutes,
  accounts ( account_name ),
  order_items (
    order_item_id, menu_name, quantity, unit_price,
    menus ( image_url ),
    order_item_options ( id, option_name, extra_price, option_items ( option_groups ( name ) ) )
  )
` as const

// ── 앱 상태 ───────────────────────────────────────────────────────────────────
type Phase = 'loading' | 'auth' | 'onboarding' | 'welcome' | 'main'
type Tab   = 'home' | 'dashboard' | 'customers' | 'menus' | 'settings' | 'store-info' | 'customer-hub' | 'product-hub' | 'settings-hub' | 'sales-hub'


// ── 시 드래그 티커 ────────────────────────────────────────────────────────────
// ── 공통 슬라이드 틱커 (HourTicker / MinuteTicker 공유) ─────────────────────
// value: 현재 단계값(정수), total: 전체 단계 수, format: 단계→표시 문자열
function Ticker({
  value, total, format, onChange,
}: {
  value: number
  total: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  const ITEM_W = 30 // px, 아이템 1개 너비
  const [pxOffset, setPxOffset] = useState(0)
  // 드래그 시작 시점의 값과 누적 픽셀을 ref에 보관 (stale closure 방지)
  const dragRef = useRef<{ startX: number; startV: number; px: number } | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // 드래그 중이면 startV 기준, 아니면 prop value 기준
  const baseV = dragRef.current?.startV ?? value
  const stepOffset = pxOffset / ITEM_W          // 실수 단계 오프셋
  const roundedStep = Math.round(stepOffset)     // 현재 "선택된" 단계 이동량
  const fractional = stepOffset - roundedStep    // −0.5 ~ +0.5 사이 소수 부분
  const centerV = ((baseV + roundedStep) % total + total) % total

  // 5개 아이템(-2 ~ +2) 렌더: overflow-hidden 으로 3개만 보임
  const items = [-2, -1, 0, 1, 2].map(i => ({
    i,
    v: ((centerV + i) % total + total) % total,
  }))
  // strip 전체를 fractional 만큼 밀어서 부드럽게 슬라이드
  const translateX = -(1 + fractional) * ITEM_W

  const startDrag = (startX: number) => {
    dragRef.current = { startX, startV: value, px: 0 }
    setPxOffset(0)
  }
  const moveDrag = (currentX: number) => {
    if (!dragRef.current) return
    const px = dragRef.current.startX - currentX
    dragRef.current.px = px
    setPxOffset(px)
  }
  const endDrag = () => {
    if (!dragRef.current) return
    const steps = Math.round(dragRef.current.px / ITEM_W)
    onChangeRef.current(((dragRef.current.startV + steps) % total + total) % total)
    dragRef.current = null
    setPxOffset(0)
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    startDrag(e.clientX)
    const onMove = (ev: MouseEvent) => moveDrag(ev.clientX)
    const onUp = () => {
      endDrag()
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      className="relative overflow-hidden cursor-ew-resize select-none rounded-lg"
      style={{ width: ITEM_W * 3, height: 26 }}
      onMouseDown={handleMouseDown}
      onTouchStart={e => startDrag(e.touches[0].clientX)}
      onTouchMove={e => { e.preventDefault(); moveDrag(e.touches[0].clientX) }}
      onTouchEnd={endDrag}
    >
      {/* 고정 배경: 회색 | 흰색(선택) | 회색 */}
      <div className="absolute inset-0 flex pointer-events-none">
        <div className="h-full bg-gray-50" style={{ width: ITEM_W }} />
        <div className="h-full bg-white border-x border-gray-200" style={{ width: ITEM_W }} />
        <div className="h-full bg-gray-50" style={{ width: ITEM_W }} />
      </div>
      {/* 슬라이딩 숫자 strip */}
      <div
        className="absolute flex h-full"
        style={{ transform: `translateX(${translateX}px)`, willChange: 'transform' }}
      >
        {items.map(({ i, v }) => (
          <div
            key={i}
            className="flex items-center justify-center h-full flex-shrink-0"
            style={{ width: ITEM_W }}
          >
            <span className={i === 0 ? 'text-[13px] font-bold text-ink' : 'text-[10px] text-gray-300'}>
              {format(v)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HourTicker({ value, onChange }: { value: number; onChange: (h: number) => void }) {
  return (
    <Ticker
      value={value}
      total={24}
      format={v => String(v).padStart(2, '0')}
      onChange={onChange}
    />
  )
}

function MinuteTicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const step = Math.round(parseInt(value || '0') / 5) % 12
  return (
    <Ticker
      value={step}
      total={12}
      format={s => String(s * 5).padStart(2, '0')}
      onChange={s => onChange(String(s * 5).padStart(2, '0'))}
    />
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
          className={`relative w-9 h-5 rounded-full flex-shrink-0 transition-colors duration-200 ${day.enabled ? 'bg-[#00DD67]' : 'bg-gray-200'}`}
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
                  <span className="text-gray-text text-[11px]">시</span>
                  <MinuteTicker value={m} onChange={min => setTime(field, h, min)} />
                  <span className="text-gray-text text-[11px]">분</span>
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
                    <span className="text-gray-text text-[11px]">시</span>
                    <MinuteTicker value={m} onChange={min => setBreakField(field, h, min)} />
                    <span className="text-gray-text text-[11px]">분</span>
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

// ── 상단 탭 (Figma: 주문/메뉴/고객만 상단 탭, 나머지는 햄버거 드로어) ──────────
// 'dashboard' 탭(실시간 주문 화면)이 Figma상 "주문" 탭 — 기존 Orders.tsx(주문 내역/분석)는 드로어에서만 진입
const TOP_TABS: { id: Tab; label: string }[] = [
  { id: 'home',      label: '홈' },
  { id: 'dashboard', label: '주문' },
  { id: 'menus',     label: '메뉴' },
  { id: 'customers', label: '고객' },
]

// 햄버거(전체 메뉴)로 들어가는 허브형 화면 — 좌측 네비 + 본문 패널 구조라
// 헤더 하단 구분선을 그리지 않는다(네비 상단과 겹쳐 보임)
const HUB_TABS: Tab[] = ['store-info', 'customer-hub', 'product-hub', 'settings-hub', 'sales-hub']

export default function App() {
  const [phase,      setPhase]      = useState<Phase>('loading')
  const phaseRef = useRef<Phase>('loading')
  const [session,    setSession]    = useState<StoreSession | null>(null)
  const [authObj,    setAuthObj]    = useState<Session | null>(null)
  const [tab,        setTab]        = useState<Tab>('home')
  // 고객 전체메뉴(CustomerHub)에서 처음 열릴 탭 — 햄버거 드로어에서 누른 항목으로 정해진다
  const [customerHubTab, setCustomerHubTab] = useState<CustomerHubTab>('detail')
  const [productHubTab,  setProductHubTab]  = useState<ProductHubTab>('menus')
  const [settingsHubTab, setSettingsHubTab] = useState<SettingsHubTab>('printer')
  const [salesHubTab,    setSalesHubTab]    = useState<SalesHubTab>('report')

  // 활성 탭 밑줄 — 고정 px(106 + i*109) 추정치 대신, 실제 탭 버튼의 렌더된 중앙 위치를 측정해서
  // 맞춘다. 한글 글자폭은 라틴 문자처럼 균등하지 않아 고정 간격 추정이 탭마다 미묘하게 어긋났음.
  // 밑줄 폭(UNDERLINE_W) 자체는 Figma 원본 디자인 값 그대로 유지하고, 중심만 텍스트 중앙에 맞춘다.
  const UNDERLINE_W = 69
  const tabBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [tabUnderlineLeft, setTabUnderlineLeft] = useState(106)
  const measureUnderline = useCallback(() => {
    const el = tabBtnRefs.current[tab]
    if (el) setTabUnderlineLeft(el.offsetLeft + el.offsetWidth / 2 - UNDERLINE_W / 2)
  }, [tab])
  // 예전엔 deps가 [tab]뿐이라 "탭이 바뀔 때" 한 번만 쟀다. 그래서 첫 측정이 틀리면
  // (웹폰트 로딩 전 폴백 글꼴 폭으로 쟀거나, 헤더가 아직 마운트되기 전이라 el이 null이어서
  // 초기값 106이 그대로 남거나) 그 뒤로 영영 교정되지 않았다. 창 크기를 바꿔도 마찬가지.
  // 폰트 로드 · 버튼 리사이즈 · 창 리사이즈를 모두 구독해 다시 잰다.
  useLayoutEffect(() => {
    measureUnderline()
    document.fonts?.ready.then(measureUnderline).catch(() => {})
    const ro = new ResizeObserver(measureUnderline)
    Object.values(tabBtnRefs.current).forEach(el => el && ro.observe(el))
    window.addEventListener('resize', measureUnderline)
    return () => { ro.disconnect(); window.removeEventListener('resize', measureUnderline) }
  }, [measureUnderline])
  const [headerRight, setHeaderRight] = useState<React.ReactNode>(null)
  const [queue,      setQueue]      = useState<Order[]>([])
  const [toast,      setToast]      = useState('')
  const [toastTimer, setToastTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [updateReady, setUpdateReady] = useState<string | null>(null)
  const [profileOpen,  setProfileOpen]  = useState(false)
  // 미리보기용 — 데이터 연동 전까지 auth 화면 눈으로 확인하기 위한 로컬 상태
  const [authView, setAuthView] = useState<'entry' | 'signup' | 'login'>('entry')
  const [qrOpen,   setQrOpen]   = useState(false)
  // phase='onboarding' 재진입 시 이미 저장된 값(업종/주소/고객유형/대표자명)을 SignupFlow에 프리필
  const [onboardingPrefill, setOnboardingPrefill] = useState<Partial<SignupData> | null>(null)
  // 이미 비밀번호를 설정해둔 상태로 재진입했는지 — SignupFlow의 password 스텝 스킵 여부에 씀
  const [onboardingHasPassword, setOnboardingHasPassword] = useState(false)
  const [upgradeOpen,  setUpgradeOpen]  = useState(false)
  // 웰컴 화면 페이드 제어 (true = 완전 표시, false = 페이드아웃 중)
  const [welcomeVisible, setWelcomeVisible] = useState(false)
  // 상단 햄버거 전체메뉴 드로어.
  //
  // 클릭이 아니라 호버로 연다. 닫기는 "영역을 벗어나면" — 다만 햄버거와 패널 사이를
  // 지나가는 몇 px 때문에 즉시 닫으면 깜빡이므로, 짧은 지연을 두고 다시 들어오면 취소한다.
  const [hamburgerOpen, setHamburgerOpen] = useState(false)
  const drawerCloseTimer = useRef<number | null>(null)

  function openDrawer() {
    if (drawerCloseTimer.current !== null) {
      window.clearTimeout(drawerCloseTimer.current)
      drawerCloseTimer.current = null
    }
    setHamburgerOpen(true)
  }
  function scheduleCloseDrawer() {
    if (drawerCloseTimer.current !== null) window.clearTimeout(drawerCloseTimer.current)
    drawerCloseTimer.current = window.setTimeout(() => {
      drawerCloseTimer.current = null
      setHamburgerOpen(false)
    }, 160)
  }
  useEffect(() => () => {
    if (drawerCloseTimer.current !== null) window.clearTimeout(drawerCloseTimer.current)
  }, [])
  // 문의 모달 — early return(onboarding/welcome) 위에 둘 것. 아래로 내리면 훅 개수가 렌더마다 달라진다
  const [supportOpen, setSupportOpen] = useState(false)
  // 값은 쓰지 않고 setter 만 쓴다(연결 상태는 IPC 쪽에서만 참조) — 자리를 비워 미사용 경고를 없앴다
  const [, setWsStatus] = useState<'connected' | 'disconnected'>('disconnected')
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // phaseRef: onAuthStateChange 클로저에서 현재 phase 읽기 위해 동기화
  useEffect(() => { phaseRef.current = phase }, [phase])

  // welcome phase: 1.5s 후 페이드아웃 → main
  useEffect(() => {
    if (phase !== 'welcome') return
    setWelcomeVisible(true)
    const show = setTimeout(() => setWelcomeVisible(false), 1500)
    const hide = setTimeout(() => { setPhase('main'); setTab('home') }, 1800)
    return () => { clearTimeout(show); clearTimeout(hide) }
  }, [phase])

  // onboarding 재진입 시 이미 저장된 값(clients/stores)을 SignupFlow 프리필로 로드
  useEffect(() => {
    if (phase !== 'onboarding' || !session) return
    let cancelled = false

    async function loadPrefill() {
      const { data: clientRow } = await supabase
        .from('clients').select('business_type, owner_name').eq('id', session!.clientId).maybeSingle()

      let storeRow: { address: string | null; address_detail: string | null; lat: number | null; lng: number | null; customer_types: string[] | null } | null = null
      if (session!.storeId) {
        const { data } = await supabase
          .from('stores')
          .select('address, address_detail, lat, lng, customer_types')
          .eq('id', session!.storeId)
          .maybeSingle()
        storeRow = data ?? null
      }

      // 전화번호가 있는 세션(OTP 가입)만 비밀번호 설정 여부 확인 — 기존 이메일 계정은 해당 없음
      let hasPassword = false
      if (authObj?.user.phone) {
        hasPassword = (await checkPhoneLoginState(authObj.user.phone)) === 'has_password'
      }

      if (cancelled) return
      setOnboardingHasPassword(hasPassword)
      setOnboardingPrefill({
        businessType:  clientRow?.business_type ?? '',
        address:       storeRow?.address ?? '',
        addressDetail: storeRow?.address_detail ?? '',
        lat:           storeRow?.lat ?? null,
        lng:           storeRow?.lng ?? null,
        customerTypes: storeRow?.customer_types ?? [],
        ownerName:     clientRow?.owner_name ?? '',
      })
    }

    loadPrefill()
    return () => { cancelled = true }
  }, [phase, session?.clientId, session?.storeId, authObj?.user.phone])

  // 비밀번호 재설정 딥링크 수신 후 새 비밀번호 입력 모달
  const [showNewPwModal,  setShowNewPwModal]  = useState(false)
  const [newPw,           setNewPw]           = useState('')
  const [newPwConfirm,    setNewPwConfirm]    = useState('')
  const [newPwSaving,     setNewPwSaving]     = useState(false)
  const [newPwMsg,        setNewPwMsg]        = useState<{ text: string; ok: boolean } | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteLoading,     setDeleteLoading]     = useState(false)

  // 운영 상태 + 운영시간 — useOperatingHours 훅으로 분리

  // ── 인증 + 스토어 로딩 ──────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (!s) { setPhase('auth'); setAuthView('entry'); return }
      // 자동 로그인 비활성화 시 저장된 세션 무효화
      if (localStorage.getItem('sallaria_pos_remember') === 'false') {
        await supabase.auth.signOut()
        setPhase('auth')
        setAuthView('entry')
        return
      }
      setAuthObj(s)
      loadStoreSession(s.user.id, s.user.email ?? '')
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      // INITIAL_SESSION 은 getSession()에서 이미 처리 — 중복 제외
      if (event === 'INITIAL_SESSION') return
      // supabase-js 의 AuthChangeEvent 유니온에는 없지만 런타임엔 실제로 오는 이벤트라
      // 타입을 넓혀서 비교한다 (라이브러리 타입이 실제 동작보다 좁음)
      if ((event as string) === 'TOKEN_REFRESH_FAILED' || !s) {
        // 로그아웃/세션만료로 진짜 auth phase로 돌아갈 때만 authView를 초기화 —
        // verifyOtp 성공 직후엔 건드리지 않아야 onboarding으로 넘어가기 전
        // 시작화면이 깜빡 보이는 문제가 없다.
        setPhase('auth'); setAuthView('entry'); setSession(null); setAuthObj(null); setTab('home'); setProfileOpen(false); return
      }
      setAuthObj(s)
      // TOKEN_REFRESHED: 세션 갱신만, 스토어 재로딩하면 onboarding 중 홈으로 튕김
      if (event === 'TOKEN_REFRESHED') return
      // SIGNED_IN은 창 전환 복귀 시에도 발생함 — 이미 auth phase를 벗어나 있으면
      // (main/onboarding 등) 진짜 새 로그인이 아니라 포커스 재검증일 뿐이므로 무시.
      // 실제 신규 로그인은 OTP 인증 성공 직후 phase가 'auth'일 때만 일어난다.
      if (event === 'SIGNED_IN' && phaseRef.current !== 'auth') return
      loadStoreSession(s.user.id, s.user.email ?? '')
    })
    return () => subscription.unsubscribe()
  }, [])


  async function loadStoreSession(userId: string, userEmail: string) {
    // clients 조회
    let { data: client } = await supabase
      .from('clients')
      .select('id, business_name, plan')
      .eq('auth_user_id', userId)
      .single()

    // clients 행이 없으면 자동 생성 (trigger가 없을 때 대비)
    if (!client) {
      const { data: created } = await supabase
        .from('clients')
        .insert({ auth_user_id: userId, contact_email: userEmail })
        .select('id, business_name, plan')
        .single()
      client = created
    }

    if (!client) { setPhase('auth'); setAuthView('entry'); return }

    let plan = (client as { plan?: string }).plan ?? 'free'

    // ── 구독 조회 및 자동 다운그레이드 처리 ─────────────────────────────────────
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('client_id', client.id)
      .single()

    if (!sub) {
      // 구독 행이 없으면 생성 (신규 가입)
      await supabase.from('subscriptions').insert({
        client_id:            client.id,
        plan:                 plan,
        billing_anchor_date:  new Date().toISOString().slice(0, 10),
        current_period_start: new Date().toISOString().slice(0, 10),
        current_period_end:   new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().slice(0, 10),
      })
    } else if (sub.pending_plan && sub.current_period_end <= new Date().toISOString().slice(0, 10)) {
      // 다음 결제일이 지났고 예약된 다운그레이드가 있으면 적용
      const today = new Date().toISOString().slice(0, 10)
      const nextEnd = new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().slice(0, 10)
      await Promise.all([
        supabase.from('clients').update({ plan: sub.pending_plan }).eq('id', client.id),
        supabase.from('subscriptions').update({
          plan:                 sub.pending_plan,
          pending_plan:         null,
          pending_plan_at:      null,
          current_period_start: today,
          current_period_end:   nextEnd,
        }).eq('client_id', client.id),
      ])
      plan = sub.pending_plan
      showToast(`플랜이 ${({ free:'무료', basic:'베이직', pro:'프로', max:'맥스' } as Record<string,string>)[sub.pending_plan]}으로 변경됐어요`)
    }

    // stores 조회
    const { data: stores } = await supabase
      .from('stores')
      .select('id, name, is_open, onboarding_completed')
      .eq('client_id', client.id)
      .order('onboarding_completed', { ascending: false })  // onboarding 완료된 매장 우선
      .order('created_at', { ascending: true })
      .limit(1)

    if (!stores || stores.length === 0) {
      // stores 행이 없으면 온보딩 시작
      setSession({ userId, clientId: client.id, storeId: '', storeName: '', plan: plan as import('./lib/plans').PlanTier })
      setPhase('onboarding')
      return
    }

    const store = stores[0]
    setSession({ userId, clientId: client.id, storeId: store.id, storeName: store.name, plan: plan as import('./lib/plans').PlanTier })

    // stores 행이 있어도 onboarding_completed가 false면 온보딩 미완
    if (!store.onboarding_completed) {
      setPhase('onboarding')
      return
    }

    // DB의 is_open 값으로 초기 상태 동기화
    if (store.is_open !== undefined && store.is_open !== null) {
      setIsOpen(store.is_open)
    }
    track('pos_store_login', { store_id: store.id, store_name: store.name })
    setPhase('main')
    setTab('home')   // 기본 진입은 홈 — 하루 종일 켜두는 화면이다
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


  // ── IPC 구독 (Electron main process → renderer) ─────────────────────────────
  useEffect(() => {
    const w = window as unknown as { api?: { onRealtimeStatus?: Function; onOrderNew?: Function; offOrderNew?: Function } }

    // 연결 상태 표시
    w.api?.onRealtimeStatus?.((s: string) =>
      setWsStatus(s === 'SUBSCRIBED' ? 'connected' : 'disconnected')
    )

    if (!w.api?.onOrderNew) return

    // 신규 주문 수신 (main process가 Supabase Realtime 구독 후 IPC로 전달)
    w.api.onOrderNew(async (rawRow: { order_code: string }) => {
      const { data } = await supabase
        .from('orders')
        .select(ORDER_SELECT)
        .eq('order_code', rawRow.order_code)
        .single()

      if (!data) return
      const order = mapOrderRow(data)
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

    async function fetchAndQueue(orderCode: string) {
      const { data } = await supabase
        .from('orders')
        .select(ORDER_SELECT)
        .eq('order_code', orderCode)
        .single()

      if (!data) return
      const order = mapOrderRow(data)
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
          { event: 'INSERT', schema: 'public', table: 'orders', filter: `store_id=eq.${session?.storeId}` },
          (payload: { new: { order_code: string } }) => {
            fetchAndQueue(payload.new.order_code)
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'stores', filter: `id=eq.${session?.storeId}` },
          (payload: { new?: { is_open?: boolean } }) => {
            const newIsOpen = payload.new?.is_open
            if (typeof newIsOpen === 'boolean') {
              setIsOpen(newIsOpen)
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

    async function poll() {
      const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      const { data } = await supabase
        .from('orders')
        .select(ORDER_SELECT)
        .eq('status', '주문완료')
        .eq('store_id', session?.storeId ?? '')
        .gte('ordered_at', cutoff)

      for (const row of data ?? []) {
        const order = mapOrderRow(row)
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
  //
  // 설정의 '알림 방식'에 따라 둘 중 하나로 동작한다(설정 > 기타 참고).
  //   정해진 횟수   : N회 울리고 끝
  //   확인할 때까지 : 주문 팝업이 닫힐 때까지 간격마다 계속 울린다
  // 후자는 그동안 설정값만 저장되고 아무 일도 하지 않았다.
  const prevQueueLen = useRef(0)
  useEffect(() => {
    if (queue.length > prevQueueLen.current) {
      const mode = readSetting<'count' | 'until-ack'>('alarm_mode', 'count')
      if (mode === 'until-ack') {
        startOrderAlarm(getSavedVolume(), readSetting('repeat_sec', 10))
      } else {
        playOrderSound()
      }
    }
    prevQueueLen.current = queue.length
  }, [queue.length])

  // 팝업이 사라지면(= 점주가 주문을 봤다) 반복 알림을 멈춘다
  useEffect(() => {
    if (queue.length === 0) stopOrderAlarm()
  }, [queue.length])

  function showToast(msg: string) {
    if (toastTimer) clearTimeout(toastTimer)
    setToast(msg)
    setToastTimer(setTimeout(() => setToast(''), 3000))
  }

  // 운영 상태 + 운영시간 훅 (is_open 진실 공급원 = DB)
  const {
    isOpen, setIsOpen,
    hoursOpen, setHoursOpen,
    operatingHours,
    breakTime,
    hoursDraft, setHoursDraft,
    breakDraft, setBreakDraft,
    saveBreakTime,
    offHoursConfirm, setOffHoursConfirm,
    closureOpen, setClosureOpen,
    setClosureType,
    closureTime, setClosureTime,
    closureActive,
    vacationDays,
    vacationOpen, setVacationOpen,
    toggleIsOpen,
    confirmForceOpen,
    saveOperatingHours,
    setDayTime,
    regularHolidays,
    saveRegularHolidays,
    confirmClosure,
    cancelClosure,
    saveVacationDays,
    deleteVacationDay,
  } = useOperatingHours(session?.storeId, showToast)

  // 매장 설정 화면의 미니 캘린더에서 고른 날짜를 기존 휴무일에 더한다.
  // saveVacationDays는 "오늘 이후 전체 교체" 방식이라 반드시 기존 목록과 합쳐서 넘겨야 한다.
  async function addVacationDays(dates: string[]) {
    const existing = new Set(vacationDays.map(v => v.date))
    const added = dates
      .filter(d => !existing.has(d))
      .map(d => ({ date: d, type: 'holiday' as const }))
    if (added.length === 0) { showToast('이미 지정된 날짜예요'); return }
    await saveVacationDays([...vacationDays, ...added])
  }

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

    // auth.users 삭제는 DB 함수로 못 함(Supabase가 보호) — Admin API를 쓰는
    // Edge Function으로 처리. 세션이 아직 있는 지금 호출해야 본인 확인(JWT)이 됨.
    const { error: deleteAuthErr } = await supabase.functions.invoke('delete-auth-user')
    if (deleteAuthErr) {
      console.error('auth.users 삭제 실패:', deleteAuthErr)
    }

    // 위에서 실패해도 DB 쪽 탈퇴는 이미 끝났으니 로컬 세션은 정리하고 로그인 화면으로.
    // signOut 자체가 실패해도(세션이 서버에서 이미 무효화됐을 수 있음) 무시하고 진행.
    try {
      await supabase.auth.signOut()
    } catch (e) {
      console.error('signOut 실패(무시):', e)
    }
    setDeleteLoading(false)
    setDeleteConfirmOpen(false)
  }

  function openProfile() {
    setProfileOpen(true)
  }

  // ── 딥링크 수신 — 비밀번호 재설정 이메일 링크 클릭 시 ──────────────────────
  useEffect(() => {
    const api = (window as unknown as { api?: { onAuthDeeplink?: (cb: (url: string) => void) => void; offAuthDeeplink?: () => void } }).api
    if (!api?.onAuthDeeplink) return

    const handler = async (url: string) => {
      // sunpos://reset-password#access_token=XXX&refresh_token=YYY&type=recovery
      const hash = url.split('#')[1] ?? ''
      const params = new URLSearchParams(hash)
      const accessToken  = params.get('access_token')
      const refreshToken = params.get('refresh_token') ?? ''
      const type         = params.get('type')

      if (type === 'recovery' && accessToken) {
        // Supabase 세션 복원
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        setNewPw('')
        setNewPwConfirm('')
        setNewPwMsg(null)
        setShowNewPwModal(true)
      }
    }

    api.onAuthDeeplink(handler)
    return () => api.offAuthDeeplink?.()
  }, [])

  async function handleSaveNewPassword() {
    if (newPw.length < PASSWORD_MIN_LEN) { setNewPwMsg({ text: `비밀번호는 ${PASSWORD_MIN_LEN}자 이상이어야 합니다.`, ok: false }); return }
    if (newPw !== newPwConfirm) { setNewPwMsg({ text: '비밀번호가 일치하지 않습니다.', ok: false }); return }
    setNewPwSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPw })
    if (error) {
      setNewPwMsg({ text: '변경 실패: ' + error.message, ok: false })
    } else {
      setNewPwMsg({ text: '비밀번호가 변경됐습니다. 다시 로그인해주세요.', ok: true })
      setTimeout(() => {
        setShowNewPwModal(false)
        supabase.auth.signOut()
      }, 2000)
    }
    setNewPwSaving(false)
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
    return (
      <>
        {authView === 'entry' && (
          <AuthEntry
            onStart={() => setAuthView('signup')}
            onLogin={() => setAuthView('login')}
          />
        )}
        {authView === 'signup' && (
          <PhoneAuthFlow
            onCancel={() => setAuthView('entry')}
            onVerified={() => {
              // verifyOtp 성공 시 실제 세션이 생기고, 아래 onAuthStateChange 리스너가
              // 이걸 감지해서 loadStoreSession → phase='onboarding'으로 알아서 넘어간다.
              // authView를 여기서 'entry'로 바꾸면 그 사이 짧게 시작화면이 보였다가
              // onboarding으로 넘어가는 깜빡임이 생기므로 아무것도 하지 않고 phase 전환을 기다린다.
            }}
          />
        )}
        {authView === 'login' && (
          <LoginScreen
            onBack={() => setAuthView('entry')}
            onLoginSuccess={() => { /* TODO: API 연동 */ }}
            onOpenPasswordSetup={() => setQrOpen(true)}
          />
        )}
        <QrPasswordSetupModal open={qrOpen} onClose={() => setQrOpen(false)} />
      </>
    )
  }

  if (phase === 'onboarding' && session) {
    // 이미 저장된 값 로딩 전이면 대기 — 빈 값으로 먼저 그렸다가 프리필로 바뀌는 깜빡임 방지
    if (!onboardingPrefill) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-gray-bg">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full border-4 border-gray-200 border-t-green animate-spin" />
            <span className="text-[13px] text-gray-text">불러오는 중...</span>
          </div>
        </div>
      )
    }
    // 이미 로그인된 사용자(기존 이메일 계정 포함)가 매장 정보를 마저 채우는 경우 —
    // 전화인증은 이미 끝난 상태이므로 storeName부터 시작. onCancel을 안 넘기면
    // 첫 스텝에서 "이전" 버튼 자체가 안 보임(돌아갈 화면이 없으므로).
    return (
      <SignupFlow
        initialData={onboardingPrefill}
        hasPassword={onboardingHasPassword}
        onComplete={async (data) => {
          const { data: storeId, error } = await supabase.rpc('complete_onboarding', {
            p_store_id:       session.storeId || null,
            p_store_name:     data.storeName,
            p_owner_name:     data.ownerName,
            p_address:        data.address,
            p_business_type:  data.businessType,
            p_customer_types: data.customerTypes,
            p_sources:        data.sources,
            p_source_other:   data.sourceOther,
            p_requested_plan: data.plan,
            p_address_detail: data.addressDetail || null,
            p_lat:            data.lat,
            p_lng:            data.lng,
          })
          if (error) throw error
          // 대표자명을 auth 계정에도 심는다. complete_onboarding은 stores/clients만 쓰는데,
          // 비밀번호 재설정 안내나 고객센터 응대처럼 auth 쪽만 보는 경로에서 이름이 비어 있었다.
          // 실패해도 온보딩은 성공으로 본다 — 이름은 clients.owner_name이 원본이다.
          const { error: metaErr } = await supabase.auth.updateUser({ data: { name: data.ownerName } })
          if (metaErr) console.warn('[onboarding] auth 이름 저장 실패:', metaErr.message)
          // clients.plan은 RPC에서 건드리지 않음 — 유료 신청은 plan_requests 접수만 하고
          // 실제 플랜 전환은 결제 확인 후 운영자가 수동 처리함
          setSession(s => s ? { ...s, storeId: storeId ?? s.storeId, storeName: data.storeName } : s)
          setPhase('welcome')
        }}
      />
    )
  }

  if (phase === 'welcome' && session) {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-gray-bg"
        style={{
          opacity:    welcomeVisible ? 1 : 0,
          transition: 'opacity 0.35s ease',
        }}
      >
        <div className="flex flex-col items-center gap-5">
          {/* 체크 아이콘 */}
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,221,103,0.15)' }}
          >
            <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
              <path d="M8 19.5L15 27L30 12" stroke="#00DD67" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          {/* 환영 텍스트 */}
          <div className="text-center">
            <p className="text-[26px] font-bold text-ink leading-snug">
              {session.storeName} 점주님,
            </p>
            <p className="text-[26px] font-bold text-ink leading-snug">
              환영합니다!
            </p>
          </div>
          <p className="text-[14px] text-gray-text">선포스와 함께 더 편한 매장 운영을 시작해요 🎉</p>
        </div>
      </div>
    )
  }

  if (phase !== 'main' || !session) return null

  // ── 메인 POS ─────────────────────────────────────────────────────────────────
  const PAGE: Record<Tab, React.ReactNode> = {
    home:      <Home onOpenOrders={() => setTab('dashboard')} />,
    dashboard: <Orders initialTab="주문내역" />,
    customers: <Customers onOpenDetail={() => goToCustomerHub('detail')} />,
    menus:     <Menus />,
    settings:  <Settings onOpenHours={() => { setHoursDraft({ ...operatingHours }); setBreakDraft({ ...breakTime }); setHoursOpen(true) }} onOpenProfile={openProfile} operatingHours={operatingHours} breakTime={breakTime} showToast={showToast} />,
    // Figma node 664:541 — 매장 설정 / 대표자 정보. 영업시간·주소는 Settings.tsx와 동일한
    // operatingHours/breakTime/useDeliveryInfo를 그대로 재사용(StoreInfo.tsx 참고).
    'store-info': (
      <StoreInfo
        onBack={() => setTab('home')}
        onOpenHours={() => { setHoursDraft({ ...operatingHours }); setBreakDraft({ ...breakTime }); setHoursOpen(true) }}
        onAddVacationDays={addVacationDays}
        onDeleteVacationDay={deleteVacationDay}
        onSetDayTime={setDayTime}
        regularHolidays={regularHolidays}
        onSaveRegularHolidays={saveRegularHolidays}
        onSaveBreakTime={saveBreakTime}
        onSignOut={handleSignOut}
        operatingHours={operatingHours}
        breakTime={breakTime}
        vacationDays={vacationDays}
        showToast={showToast}
      />
    ),
    // 햄버거 드로어 "고객" 그룹 — Figma node 532:3003 / 570:694 / 570:717 / 570:673.
    // 드로어에서 누른 항목이 그대로 초기 탭이 된다.
    'settings-hub': (
      <SettingsHub
        key={settingsHubTab}
        initialTab={settingsHubTab}
        onBack={() => setTab('home')}
        showToast={showToast}
      />
    ),
    // 햄버거 드로어 "매출 · 주문" 그룹 — 기존 Sales.tsx / Orders.tsx 를 허브 셸로 감싼 것
    'sales-hub': (
      <SalesHub
        key={salesHubTab}
        initialTab={salesHubTab}
        onBack={() => setTab('home')}
      />
    ),
    'product-hub': (
      <ProductHub
        key={productHubTab}
        initialTab={productHubTab}
        onBack={() => setTab('home')}
        showToast={showToast}
      />
    ),
    'customer-hub': (
      <CustomerHub
        key={customerHubTab}
        initialTab={customerHubTab}
        onBack={() => setTab('home')}
      />
    ),
  }

  // ── 햄버거 드로어: 매출·주문 / 상품 / 고객 / 설정 (Figma 690:379 구조) ──
  function goTo(id: Tab) { setTab(id); setHamburgerOpen(false) }
  function goToCustomerHub(sub: CustomerHubTab) { setCustomerHubTab(sub); goTo('customer-hub') }
  function goToProductHub(sub: ProductHubTab)  { setProductHubTab(sub);  goTo('product-hub') }
  function goToSettingsHub(sub: SettingsHubTab) { setSettingsHubTab(sub); goTo('settings-hub') }
  function goToSalesHub(sub: SalesHubTab)       { setSalesHubTab(sub);    goTo('sales-hub') }
  // Figma node 690:379 — 매출·주문 / 상품 / 고객 / 설정 4단 그리드
  const DRAWER_GROUPS: { title: string; items: { label: string; onClick: () => void }[] }[] = [
    { title: '매출 · 주문', items: [
      { label: '매출 리포트', onClick: () => goToSalesHub('report') },
      { label: '주문 리포트', onClick: () => goToSalesHub('analysis') },
      // '주문 내역'은 뺐다 — 상단 '주문' 탭이 같은 화면이다
    ] },
    { title: '상품', items: [
      { label: '메뉴 정보',     onClick: () => goToProductHub('menus') },
      { label: '옵션 정보',     onClick: () => goToProductHub('options') },
      { label: '카테고리 정보', onClick: () => goToProductHub('categories') },
    ] },
    { title: '고객', items: [
      { label: '고객 현황',   onClick: () => goToCustomerHub('detail') },
      { label: '계정 관리',   onClick: () => goToCustomerHub('accounts') },
      { label: '문자 보내기', onClick: () => goToCustomerHub('sms') },
    ] },
    { title: '설정', items: [
      { label: 'QR출력',       onClick: () => goToSettingsHub('qr') },
      { label: '프린터 연결',   onClick: () => goToSettingsHub('printer') },
      { label: '영수증 · 증빙', onClick: () => goToSettingsHub('receipt') },
      { label: '기타 설정',     onClick: () => goToSettingsHub('etc') },
    ] },
  ]

  return (
    <StoreContext.Provider value={session}>
      <div className="relative flex flex-col h-full w-full overflow-hidden">

        {/* ── 상단 탭 네비게이션 — 창 폭에 맞춰 늘어나는 진짜 반응형 바. 왼쪽 그룹(햄버거/탭)은 left로,
             오른쪽 그룹(프린터/시간/ON-OFF)은 right로 각각 자기 쪽 가장자리에 고정하고, 가운데는 그냥 비워둔다 ── */}
        {/* 아래 모든 px 값은 Figma 2240 캔버스 원본 수치 × 0.643(=1440/2240, 앱 기본 창 폭 기준) 로 환산한
             "고정 실제 크기" — Figma 자체가 2240px 캔버스를 ~0.64배로 축소해서 보여주는 걸 전제로 그려졌기 때문에,
             원본 숫자를 그대로 쓰면 실제 화면에서 지나치게 커 보인다. 이후 페이즈도 동일 비율로 환산할 것. */}
        {/* ── 상단 탭 네비게이션 — 햄버거/탭/밑줄/구분선/프린터/시간/ON-OFF ── */}
        <div className={`relative z-10 flex-shrink-0 h-[58px] w-full overflow-hidden ${
          HUB_TABS.includes(tab)
            ? 'bg-canvas-line shadow-[0_2px_6px_rgba(0,0,0,0.07)]'
            : 'bg-canvas'
        }`}>
            {/* 햄버거는 이 헤더 밖(아래 .drawer-anchor)에 있다 — 헤더가 overflow-hidden 이라
                 안에 두면 펼쳐진 패널이 58px 높이에서 잘린다 */}

            {TOP_TABS.map(({ id, label }, i) => (
              <button
                key={id}
                ref={el => {
                  tabBtnRefs.current[id] = el
                  // 헤더가 늦게 마운트돼도 활성 탭 버튼이 붙는 즉시 밑줄을 맞춘다
                  if (el && id === tab) measureUnderline()
                }}
                onClick={() => goTo(id)}
                className={`pressable-tab absolute top-[15px] px-[10px] py-[6px] rounded-[8px] text-[21px] whitespace-nowrap leading-none hover:bg-[#F2F2F2] ${
                  tab === id ? 'text-ink font-semibold' : 'text-[#787878] font-medium hover:text-ink'
                }`}
                style={{ left: 114 + i * 108 - 10 }}
              >
                {label}
              </button>
            ))}
            {/* 활성 탭 밑줄 — 탭 버튼의 실제 렌더 중앙(tabUnderlineLeft)에 맞춰 정렬, 폭은 고정.
                 TOP_TABS에 없는 탭(매장 정보 등)일 땐 숨김 */}
            {TOP_TABS.some(t => t.id === tab) && (
              <div
                className="absolute bg-[#2C261F] h-[3px] transition-[left] duration-150"
                style={{ left: tabUnderlineLeft, width: UNDERLINE_W, top: 55 }}
              />
            )}

            {/* 헤더 밑줄.
                 426px 에서 끊는 건 **우측 400px 사이드 패널이 있는 화면**에만 맞는 치수다.
                 홈은 원래 사이드 패널이 없고, 주문 탭은 사이드 패널을 없애면서 그 여백이 사라졌다 —
                 두 화면에선 선이 화면 가운데서 뚝 끊긴 것처럼 보였다. 그래서 끝까지 긋는다.
                 고객 화면은 아직 400px 고객현황 패널이 있어 그대로 끊는다.
                 전체메뉴(허브) 화면은 좌측 네비가 헤더 바로 아래에서 시작해 겹치므로 숨긴다. */}
            {!HUB_TABS.includes(tab) && (
              // 색은 --canvas-line(#E5E5E5) — 바탕(#F2F2F2) 위에 긋는 선의 시스템 값.
              // #C1B7AA 는 추이 차트 막대에 쓰는 색이라 선으로는 한 단계 진했다.
              <div className={`absolute bg-canvas-line h-px left-[26px] bottom-0 ${
                tab === 'customers' ? 'right-[426px]' : 'right-[26px]'
              }`} />
            )}


            {/* 날짜/시간 — 오른쪽 가장자리에서 140px 떨어진 지점에 중앙정렬(translate-x-1/2 + right) */}
            <div
              className="absolute translate-x-1/2 flex flex-col items-center leading-[normal] text-[#6A635E] font-semibold text-[13px] whitespace-nowrap"
              style={{ right: 140, top: 12 }}
            >
              <span>{formatKstDate(now)}</span>
              <span>{formatKstTime(now)}</span>
            </div>

            {/* 운영 ON/OFF — Figma node 496:657 (track 84x48, knob r18) × 0.643, 오른쪽 가장자리에서 26px */}
            <button
              onClick={toggleIsOpen}
              title={isOpen ? '운영중 — 클릭해서 종료' : '운영종료 — 클릭해서 시작'}
              className={`absolute w-[54px] h-[31px] rounded-full transition-colors duration-200 ${
                isOpen ? 'bg-[#6A635E]' : 'bg-[#ADADAD]'
              }`}
              style={{ right: 26, top: 12 }}
            >
              {/* 텍스트 — Figma node 496:660, knob 반대편에 위치(ON=왼쪽/OFF=오른쪽 미러) */}
              <span
                className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[13px] font-semibold text-[#FCFCFC] whitespace-nowrap transition-all duration-200`}
                style={{ left: isOpen ? 16 : 38 }}
              >
                {isOpen ? 'ON' : 'OFF'}
              </span>
              <span
                className={`absolute top-[4px] left-[4px] w-[23px] h-[23px] rounded-full bg-[#FCFCFC] shadow-sm transition-transform duration-200 ${
                  isOpen ? 'translate-x-[23px]' : 'translate-x-0'
                }`}
              />
            </button>
        </div>

        {/* ── 햄버거 드로어 (전체 메뉴) — Figma node 690:379 ── */}
        {/* ── 전체메뉴 드로어 ──
             햄버거 버튼과 패널을 한 앵커 안에 둔다. 패널이 버튼의 자식이라 패널 위에
             마우스가 있는 동안엔 앵커의 mouseleave 가 뜨지 않는다 — 그래서 "버튼에서
             패널로 넘어가다 닫히는" 일이 없다. 둘 다 벗어나면 그때 닫힌다. */}
        {/* 알림 종 — 프린터 표시가 있던 자리.
            프린터 연결 여부는 평소엔 아무 일도 없고 문제가 생기면 영수증이 안 나와서 바로 안다.
            늘 떠 있을 만큼 급한 정보가 아니었다(상태는 설정 > 프린터 연결에서 본다).
            반대로 거래처 관리자 등록은 일어난 순간 알아야 하는데 알릴 자리가 없었다.

            ⚠️ 햄버거와 같은 이유로 **헤더 밖**에 둔다 — 헤더가 overflow-hidden 이라
               안에 두면 펼쳐진 드롭다운이 58px 높이에서 잘린다. */}
        <NotificationBell storeId={session?.storeId ?? null} />

        <div
          className="drawer-anchor absolute left-[18px] top-[15px] z-[60]"
          onMouseEnter={openDrawer}
          onMouseLeave={scheduleCloseDrawer}
        >
          <button
            onClick={() => (hamburgerOpen ? setHamburgerOpen(false) : openDrawer())}
            onFocus={openDrawer}
            title="전체 메뉴"
            aria-expanded={hamburgerOpen}
            className="pressable-tab flex flex-col gap-[5px] p-[8px] rounded-[8px] hover:bg-[#F2F2F2]"
          >
            <span className="w-[22px] h-[2px] bg-ink rounded-[1px]" />
            <span className="w-[22px] h-[2px] bg-ink rounded-[1px]" />
            <span className="w-[22px] h-[2px] bg-ink rounded-[1px]" />
          </button>

          {/* 좌상단에서 우하단으로 자라나며 열린다(.drawer-panel, index.css).
              언마운트하지 않는 이유: 닫힐 때도 같은 길로 접히게 하려면 DOM 이 남아야 한다. */}
          <div
            data-open={hamburgerOpen}
            aria-hidden={!hamburgerOpen}
            className="drawer-panel absolute left-0 top-[41px] w-[1090px] max-w-[calc(100vw-44px)] bg-[#FCFCFC] rounded-[32px] shadow-[0_18px_48px_rgba(0,0,0,0.18)] p-8"
          >
            {/* 매장명 — 오른쪽 화살표 클릭 시 매장 정보 화면으로 이동 */}
            <button
              onClick={() => { setHamburgerOpen(false); goTo('store-info') }}
              className="pressable inline-flex items-center gap-3 bg-[#E8E4E2] rounded-tl-[45px] rounded-tr-[45px] rounded-br-[45px] rounded-bl-[6px] pl-5 pr-6 py-3 mb-7 hover:opacity-90"
            >
              <img src={storeIcon} alt="" className="w-[26px] h-[26px]" />
              <span className="text-[22px] font-semibold text-ink">{session?.storeName}</span>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 3.5L10.5 8L6 12.5" stroke="#787878" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>

            <div className="grid grid-cols-4 gap-x-8 gap-y-7">
              {DRAWER_GROUPS.map(group => (
                <div key={group.title}>
                  <div className="text-[15px] text-[#ADADAD] font-medium mb-3">{group.title}</div>
                  {/* 상단 탭(홈·주문·메뉴·고객)과 같은 조작감 — 올리면 박스가 뜨고, 누르면 꺼진다.
                      밑줄은 "링크"라고 말하는데 여기 항목들은 화면을 바꾸는 버튼이다.
                      -mx-3 로 박스만 바깥으로 넓혀 글자 시작선은 그대로 둔다. */}
                  <div className="space-y-1 -mx-3">
                    {group.items.map(item => (
                      <button
                        key={item.label}
                        onClick={item.onClick}
                        className="pressable-tab block w-full px-3 py-2 rounded-[10px] text-[17px] text-ink font-medium text-left hover:bg-[#F2F2F2]"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end mt-7">
              <button
                onClick={() => { setHamburgerOpen(false); setSupportOpen(true) }}
                className="pressable border border-[#D9D9D9] rounded-[15px] px-5 py-3 text-[15px] font-medium text-[#414141] hover:bg-[#F2F2F2]"
              >
                선포스에 의견 보내기
              </button>
            </div>
          </div>
        </div>

        {supportOpen && <SupportModal onClose={() => setSupportOpen(false)} showToast={showToast} />}

        {/* ── 컨텐츠 ── */}
        <div className="relative flex flex-1 overflow-hidden">
          {headerRight && (
            <div className="absolute right-6 top-2 z-50 flex items-center gap-2">{headerRight}</div>
          )}
          <HeaderSlotContext.Provider value={{ setHeaderRight }}>
            <main className="flex-1 overflow-hidden">
              {PAGE[tab]}
            </main>
          </HeaderSlotContext.Provider>
        </div>

        {/* ── 신규 주문 팝업 ── */}
        {queue.length > 0 && (
          <OrderPopup
            queue={queue}
            onClose={dismissPopup}
            onApprove={() => showToast('🖨️ 영수증을 출력합니다')}
            onError={showToast}
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
            <div className="modal-in bg-white rounded-2xl shadow-xl w-[480px] px-9 py-9 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
              <div>
                <div className="text-[17px] font-semibold text-ink">조기마감</div>
                <div className="text-[12px] text-gray-text mt-0.5">오늘 지정한 시간부터 자동으로 영업이 종료됩니다</div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[13px] text-gray-text flex-shrink-0">마감 시간</span>
                <HourTicker
                  value={parseInt(closureTime.split(':')[0])}
                  onChange={h => setClosureTime(`${String(h).padStart(2,'0')}:${closureTime.split(':')[1]}`)}
                />
                <span className="text-gray-text text-[11px]">시</span>
                <MinuteTicker
                  value={closureTime.split(':')[1]}
                  onChange={m => setClosureTime(`${closureTime.split(':')[0]}:${m}`)}
                />
                <span className="text-gray-text text-[11px]">분</span>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setClosureOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-text font-bold text-[13px] hover:bg-gray-200 transition-colors"
                >취소</button>
                <button
                  onClick={() => { setClosureType('early'); confirmClosure() }}
                  className="flex-1 py-2.5 rounded-xl bg-[#00DD67] text-[#1A1A1A] font-bold text-[13px] hover:opacity-90 transition-opacity"
                >조기마감 확정</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 휴가예약 모달 ── */}
        {vacationOpen && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50" onClick={() => setVacationOpen(false)}>
            <div className="modal-in bg-white rounded-2xl shadow-xl w-[680px] max-h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* 헤더 */}
              <div className="px-8 pt-7 pb-0 flex-shrink-0">
                <div className="text-[17px] font-semibold text-ink">휴가 예약</div>
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
                            ${isSelected ? 'bg-[#00DD67] text-[#1A1A1A]' : isPast ? '' : 'hover:bg-gray-100'}
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
                <div className="flex-1 overflow-y-auto px-4 py-[30px]">
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
                                      <span className="text-gray-text text-[11px]">시</span>
                                      <MinuteTicker
                                        value={mStr}
                                        onChange={min => setVacDraft(prev => ({
                                          ...prev,
                                          [dateStr]: { ...cfg, [field === 'open' ? 'openTime' : 'closeTime']: `${hStr}:${min}` }
                                        }))}
                                      />
                                      <span className="text-gray-text text-[11px]">분</span>
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
              <div className="px-6 py-4 border-t border-gray-border flex-shrink-0 flex gap-2 modal-footer">
                <button
                  onClick={() => setVacationOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-text font-bold text-[13px] hover:bg-gray-200 transition-colors"
                >취소</button>
                <button
                  onClick={handleSaveVacation}
                  className="flex-1 py-2.5 rounded-xl bg-[#00DD67] text-[#1A1A1A] font-bold text-[13px] hover:opacity-90 transition-opacity"
                >저장 ({Object.keys(vacDraft).length}일)</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 운영시간 외 강제 ON 확인 다이얼로그 ── */}
        {offHoursConfirm && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50">
            <div className="modal-in bg-white rounded-2xl shadow-xl w-[320px] px-9 py-9 flex flex-col gap-4">
              <div>
                <div className="text-[17px] font-semibold text-ink mb-1">운영시간이 아닙니다</div>
                <div className="text-[13px] text-gray-text leading-relaxed">현재는 설정한 운영시간이 아니에요.<br/>그래도 운영 상태로 바꿀까요?</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffHoursConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-text font-bold text-[13px] hover:bg-gray-200 transition-colors"
                >취소</button>
                <button
                  onClick={confirmForceOpen}
                  className="flex-1 py-2.5 rounded-xl bg-[#00DD67] text-[#1A1A1A] font-bold text-[13px] hover:opacity-90 transition-opacity"
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
            <div className="modal-in bg-white rounded-2xl shadow-xl w-[820px] overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
              {/* 헤더 */}
              <div className="px-8 pt-7 pb-0 flex items-center justify-between">
                <div>
                  <div className="text-[17px] font-semibold text-ink">운영시간 설정</div>
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
                    className="text-[12px] font-semibold text-ink bg-gray-100 rounded-lg px-3 py-1.5 hover:bg-gray-200 transition-colors"
                  >조기마감</button>
                  <button
                    onClick={openVacationModal}
                    className="text-[12px] font-semibold text-ink bg-gray-100 rounded-lg px-3 py-1.5 hover:bg-gray-200 transition-colors"
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
                  className="flex-1 py-2.5 rounded-xl bg-[#00DD67] text-[#1A1A1A] font-bold text-[13px] hover:opacity-90 transition-opacity"
                >저장</button>
              </div>
            </div>
          </div>
        )}

        <ProfileModal
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          session={session}
          setSession={setSession}
          authObj={authObj}
          onDeleteRequest={() => setDeleteConfirmOpen(true)}
          onOpenPasswordSetup={() => setQrOpen(true)}
        />
        <QrPasswordSetupModal open={qrOpen} onClose={() => setQrOpen(false)} />

        <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />

        {/* ── 회원탈퇴 확인 모달 ── */}
        {deleteConfirmOpen && (
          <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50">
            <div className="modal-in bg-white rounded-2xl shadow-xl w-[320px] px-9 py-9 flex flex-col gap-4">
              <div>
                <div className="text-[17px] font-semibold text-ink mb-1">정말 탈퇴하시겠습니까?</div>
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
                className="w-full py-3 rounded-xl bg-[#00DD67] text-[#1A1A1A] font-bold text-[14px] hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                유지하기
              </button>
            </div>
          </div>
        )}
        {/* 새 비밀번호 입력 모달 — 재설정 이메일 링크 클릭 후 */}
        {showNewPwModal && (
          <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50">
            <div className="modal-in bg-white rounded-2xl shadow-xl w-[460px] px-9 py-9 flex flex-col gap-4">
              <div>
                <div className="text-[17px] font-semibold text-ink mb-1">새 비밀번호 설정</div>
                <div className="text-[13px] text-gray-text">6자 이상의 새 비밀번호를 입력해주세요.</div>
              </div>
              <div className="flex flex-col gap-2">
                <input
                  type="password"
                  placeholder="새 비밀번호"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  className="w-full border border-gray-border rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-[#00DD67]"
                />
                <input
                  type="password"
                  placeholder="새 비밀번호 확인"
                  value={newPwConfirm}
                  onChange={e => setNewPwConfirm(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSaveNewPassword()}
                  className="w-full border border-gray-border rounded-xl px-3 py-2.5 text-[13px] outline-none focus:border-[#00DD67]"
                />
              </div>
              {newPwMsg && (
                <div className={`px-3 py-2 rounded-lg text-[12px] font-semibold ${newPwMsg.ok ? 'bg-green-soft text-green' : 'bg-red-50 text-danger'}`}>
                  {newPwMsg.text}
                </div>
              )}
              <button
                onClick={handleSaveNewPassword}
                disabled={newPwSaving || !newPw || !newPwConfirm}
                className="w-full py-3 rounded-xl bg-[#00DD67] text-[#1A1A1A] font-bold text-[14px] hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {newPwSaving ? '저장 중...' : '비밀번호 변경하기'}
              </button>
            </div>
          </div>
        )}

      </div>
    </StoreContext.Provider>
  )
}
