import { useState, useEffect, useRef, type ReactNode } from 'react'
import { getCached, setCached } from '../lib/query-cache'
import { rootZoom } from '../lib/figma-scale'
import QRCode from 'qrcode'
import { supabase, type DbAccount, type DbDeposit } from '../lib/supabase'
import { won } from '../lib/ipc'
import { useStore } from '../lib/store-context'
import { track } from '../lib/firebase'
import type { Order } from '../lib/mock-data'
import { mapOrderRow } from '../lib/mappers'
import { PLAN_LIMITS, PLAN_NAMES } from '../lib/plans'
import DonutChart from '../components/DonutChart'
import EyeIcon from '../components/ui/EyeIcon'
import { maskName, maskPhone } from '../lib/mask'
import { buildPinColumns } from '../lib/pin-crypto'
import {
  PREPAY_VALIDITY_OPTIONS, PREPAY_VALIDITY_LABEL,
  prepayValidityDisplay, isPrepayExpired,
} from '../lib/prepay-validity'
// 이 파일엔 주문 상태용 StatusTag 가 따로 있어 이름이 겹친다 — 별칭으로 구분
import { StatusTag as PillTag } from '../components/ui/DataTable'
import ScrollHint from '../components/ui/ScrollHint'
import RevealText from '../components/ui/RevealText'
import StatCard from '../components/StatCard'
import { useQrPrint } from '../hooks/useQrPrint'
import LoadingTimer from '../components/ui/LoadingTimer'
import LoadingBlock from '../components/ui/LoadingBlock'
import CustomerProfileModal from '../components/customer/CustomerProfileModal'
import { NUM, NUM_STRONG, NUM_UP, NUM_DOWN, NUM_MUTED, deltaClass } from '../lib/number-style'

const BASE_URL = 'https://sallaria.web.app'
const SUNPOS_KAKAO_URL = 'https://sunpos-kakao.vercel.app'

function useQrDataUrl(url: string) {
  const [dataUrl, setDataUrl] = useState('')
  useEffect(() => {
    if (!url) { setDataUrl(''); return }
    QRCode.toDataURL(url, { width: 400, margin: 0, color: { dark: '#1E1E1E', light: '#FFFFFF' } })
      .then(setDataUrl)
      .catch(() => setDataUrl(''))
  }, [url])
  return dataUrl
}

const TYPE_LABEL: Record<string, string> = {
  '부서': '부서',
  '기업': '기업',
  '개인': '개인',
}

// 계정유형 도넛 색상 — 매장이 유형을 커스텀 추가해도(최대 6개) 색이 모자라지 않도록 6색 팔레트
const TYPE_DONUT_COLORS = ['#FF676F', '#3374FF', '#ADADAD', '#F5A623', '#7ED321', '#9B59B6']



// 우측 고객 상세 패널 — 관리자 이름 가운데 마스킹 (예: "김민준" → "김*준")

/** 010-1234-5678 → 010-****-5678. 가운데 덩어리만 가린다 */

/**
 * 가린 채로 보여주다가 눈 아이콘을 눌러야 고칠 수 있는 입력.
 * 수정 모달은 "편집"이 목적이라 값을 영영 가리면 안 되고, 그렇다고 화면에 이름·번호를
 * 그대로 띄워두면 손님이 지나가다 본다. 그래서 기본은 마스킹 + 읽기전용, 열어야 편집.
 */
function MaskedField({ value, masked, onChange, placeholder, inputMode }: {
  value: string
  masked: string
  onChange: (v: string) => void
  placeholder?: string
  inputMode?: 'numeric'
}) {
  const [revealed, setRevealed] = useState(false)
  return (
    <div className="relative">
      <input
        value={revealed ? value : (value ? masked : '')}
        onChange={e => onChange(e.target.value)}
        readOnly={!revealed}
        placeholder={placeholder}
        inputMode={inputMode}
        onClick={() => { if (!revealed) setRevealed(true) }}
        className={CUST_INPUT_CLS + ' pr-[44px]' + (revealed ? '' : ' cursor-pointer')}
      />
      <button
        type="button"
        onClick={() => setRevealed(v => !v)}
        title={revealed ? '가리기' : '보기 · 수정하려면 눌러주세요'}
        className="absolute right-[12px] top-1/2 -translate-y-1/2"
      >
        <EyeIcon off={revealed} size={15} />
      </button>
    </div>
  )
}

/**
 * PIN 입력 — 방금 친 한 글자만 보이고 앞은 * 로 가린다 ("0" → "*0" → "**0" → "***0").
 * 포커스를 떠나면 전부 * 가 된다. 눈 아이콘으로 통째로 열어볼 수 있다.
 *
 * type="password" 를 안 쓰는 이유: 브라우저가 전부 점으로 덮어버려서 "마지막 글자만 보이기"가
 * 불가능하고, 비밀번호 관리자가 저장하겠다고 끼어든다. PIN 은 계정 비밀번호가 아니다.
 */
function PinField({ value, onChange, placeholder, className = '' }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  const [focused,  setFocused]  = useState(false)
  const [revealed, setRevealed] = useState(false)

  const display = revealed || value.length === 0
    ? value
    : focused
      ? '*'.repeat(value.length - 1) + value[value.length - 1]
      : '*'.repeat(value.length)

  return (
    <div className="relative">
      <input
        value={display}
        onChange={e => {
          // 표시값에 * 가 섞여 있어도 길이 변화만 보고 실제 값을 고친다
          const next = e.target.value.replace(/[^0-9]/g, '')
          if (e.target.value.length < display.length) onChange(value.slice(0, e.target.value.length))
          else if (next) onChange((value + next.slice(-1)).slice(0, 4))
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxLength={4}
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        // 값이 비어 플레이스홀더만 보일 땐 mono 를 빼서 프리텐다드로 나오게 한다.
        // mono 가 걸리면 한글 플레이스홀더가 폴백 글꼴로 떨어져 어색해진다.
        className={(value ? className : className.replace(/\bfont-mono\b/, '').replace(/\btracking-\[4px\]/, '')) + ' pr-[44px]'}
      />
      <button
        type="button"
        onClick={() => setRevealed(v => !v)}
        title={revealed ? '가리기' : '보기'}
        className="absolute right-[12px] top-1/2 -translate-y-1/2"
      >
        <EyeIcon off={revealed} size={15} />
      </button>
    </div>
  )
}

// 계정 추가 모달(Figma node 532:3039) 큰 사이즈 폼 — 라벨 28px + 테두리 rounded-15 인풋
// px는 Figma 원본 × FIGMA_SCALE — src/lib/figma-scale.ts 참고
const CUST_INPUT_CLS = 'field-soft w-full border border-[#D9D9D9] rounded-[10px] px-[14px] py-[11px] text-[14px] text-ink outline-none focus:border-ink bg-transparent'
function CustFormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-[22px]">
      <div className="text-[14px] font-medium text-ink mb-[8px]">{label}</div>
      {children}
    </div>
  )
}

// 선결제 유효기간 표시·만료 판정은 lib/prepay-validity.ts 가 단일 출처 (계정 상세 모달과 공용)

function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 7) return `${d.slice(0,3)}-${d.slice(3)}`
  return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`
}

// ── 플랜 다운그레이드 순서 ────────────────────────────────────────────────────
const PLAN_ORDER = ['free', 'basic', 'pro', 'max'] as const

/** 활성 팀 수에 맞는 최적 플랜 반환 */
function getRecommendedPlan(activeCount: number): import('../lib/plans').PlanTier {
  if (activeCount <= 1)  return 'free'
  if (activeCount <= 10) return 'basic'
  if (activeCount <= 20) return 'pro'
  return 'max'
}

/** billing_anchor_date 기준 다음 결제일 계산 */
function getNextBillingDate(anchorDate: string): Date {
  const day = new Date(anchorDate).getDate()
  const today = new Date()
  let next = new Date(today.getFullYear(), today.getMonth(), day)
  if (next <= today) next = new Date(today.getFullYear(), today.getMonth() + 1, day)
  return next
}

export default function Customers({ onOpenDetail }: { onOpenDetail?: () => void }) {
  const { storeId, storeName, plan, clientId } = useStore()
  const tableScrollRef = useRef<HTMLDivElement | null>(null)
  const [accounts,     setAccounts]     = useState<DbAccount[]>([])
  const [selected,     setSelected]     = useState<DbAccount | null>(null)
  const [printerToast, setPrinterToast] = useState('')
  const [accountOrders, setAccountOrders] = useState<Order[]>([])
  const [deposits,     setDeposits]     = useState<DbDeposit[]>([])
  const [, setMonthlyUsage] = useState<Record<string, number>>({})   // 값은 안 쓰고 집계만 채운다
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({})      // 고객현황 사이드바 — 계정별 이용자(account_members) 수
  const [monthlyDeposits, setMonthlyDeposits] = useState<Record<string, number>>({}) // 이번달 선결제(충전) 합계
  const [orderTrend, setOrderTrend] = useState<Record<string, number>>({})          // 추이 = 이번달 주문건수 - 저번달 주문건수
  const [monthlyOrderCount, setMonthlyOrderCount] = useState<Record<string, number>>({}) // 이번달 주문건수 (가장 많이 주문한 고객 랭킹용)
  const [active30dCount, setActive30dCount] = useState(0)                           // 최근 30일 내 주문 1건 이상인 계정 수
  const [yearlyDeposits, setYearlyDeposits] = useState<number[]>(Array(12).fill(0))  // 선결제 추이 — 올해 1~12월 합계
  const [yearlyOrders,   setYearlyOrders]   = useState<number[]>(Array(12).fill(0))  // 주문 추이 — 올해 1~12월 건수
  const [phoneRevealed, setPhoneRevealed] = useState(false) // 우측 패널 — 관리자 연락처 중간 4자리 공개 토글
  const [yearlyDepositRows, setYearlyDepositRows] = useState<{ account_code: string; amount: number; created_at: string }[]>([]) // 바 차트 호버 툴팁용 — 월별 합계의 원본 행
  const [barTooltip, setBarTooltip] = useState<{ monthIdx: number; x: number; y: number } | null>(null)
  const [donutTooltip, setDonutTooltip] = useState<{ type: DbAccount['account_type']; x: number; y: number } | null>(null)
  const [trendInfoTooltip, setTrendInfoTooltip] = useState<{ x: number; y: number } | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('all')

  // 고객 유형(부서/기업/개인) 커스텀 관리 — Figma node 503:786.
  // stores.customer_types(최대 6개)가 이 매장에서 쓸 수 있는 유형 목록의 원본.
  const [customerTypes,  setCustomerTypes]  = useState<string[]>(['부서', '기업', '개인'])
  const [typeEditMode,   setTypeEditMode]   = useState(false)
  const [typeDraft,      setTypeDraft]      = useState<string[]>([])
  const [editingTypeIdx, setEditingTypeIdx] = useState<number | null>(null)
  const [typeSaving,     setTypeSaving]     = useState(false)

  useEffect(() => {
    if (!storeId) return
    supabase.from('stores').select('customer_types').eq('id', storeId).maybeSingle()
      .then(({ data }) => { if (data?.customer_types?.length) setCustomerTypes(data.customer_types) })
  }, [storeId])

  function startTypeEdit() {
    setTypeDraft([...customerTypes])
    setEditingTypeIdx(null)
    setTypeEditMode(true)
  }
  function cancelTypeEdit() {
    setTypeEditMode(false)
    setEditingTypeIdx(null)
  }
  function addTypeDraft() {
    if (typeDraft.length >= 6) return
    setTypeDraft(prev => [...prev, '새 유형'])
    setEditingTypeIdx(typeDraft.length)
  }
  async function confirmTypeEdit() {
    const next = typeDraft.map(t => t.trim()).filter(Boolean)
    const deduped = Array.from(new Set(next))
    if (!storeId || deduped.length === 0) { cancelTypeEdit(); return }
    setTypeSaving(true)
    // 같은 자리(index)의 이름이 바뀐 유형은, 이미 그 유형을 쓰고 있는 거래처들의 account_type도 같이 갱신
    const renames = customerTypes
      .map((old, i) => ({ old, next: deduped[i] }))
      .filter(r => r.next && r.next !== r.old)
    await Promise.all([
      supabase.from('stores').update({ customer_types: deduped }).eq('id', storeId),
      ...renames.map(r => supabase.rpc('rename_account_type', { p_store_id: storeId, p_old_name: r.old, p_new_name: r.next })),
    ])
    if (renames.length > 0) {
      const renameMap = new Map(renames.map(r => [r.old, r.next]))
      setAccounts(prev => prev.map(a => renameMap.has(a.account_type) ? { ...a, account_type: renameMap.get(a.account_type)! } : a))
      setTypeFilter(f => renameMap.get(f) ?? f)
    }
    setCustomerTypes(deduped)
    setTypeSaving(false)
    setTypeEditMode(false)
    setEditingTypeIdx(null)
  }
  const [loading,      setLoading]      = useState(true)
  const [fetchError,   setFetchError]   = useState(false)
  const [downgradeModal, setDowngradeModal] = useState<{
    targetPlan: import('../lib/plans').PlanTier
    nextBillingDate: Date
    immediate?: boolean
  } | null>(null)
  const [retryCount,   setRetryCount]   = useState(0)
  const [chargeOpen,   setChargeOpen]   = useState(false)
  const [chargeAmt,    setChargeAmt]    = useState('')
  const [chargeMemo,   setChargeMemo]   = useState('')
  const [chargeError,  setChargeError]  = useState('')
  const [search,       setSearch]       = useState('')
  const [kioskQr,      setKioskQr]      = useState(false)
  const [accountQr,    setAccountQr]    = useState<string | null>(null) // account_code
  const [detailTab,    setDetailTab]    = useState<'orders' | 'charges' | 'members' | 'statement' | 'people'>('orders')
  const [members,      setMembers]      = useState<{ id: string; name: string; phone: string | null; order_count: number; last_ordered_at: string | null }[]>([])
  const [adminUsers,   setAdminUsers]   = useState<{ role: string; status: string; name: string | null; phone: string | null; approved_at: string | null; created_at: string }[]>([])
  const [registeredAdmins, setRegisteredAdmins] = useState<Set<string>>(new Set())
  const [resendLoading, setResendLoading] = useState(false)
  const [, setOrderPage]  = useState(0)   // 값은 안 쓰고 초기화 용도로만 호출
  const [, setChargePage] = useState(0)   // 값은 안 쓰고 초기화 용도로만 호출

  // 인라인 QR (selected 변경 시 자동 생성)
  // qr_system='kakao' 거래처는 sunpos-kakao(신규 카카오 흐름), 'legacy'는 기존 sallaria.web.app 그대로
  const selectedQrUrl        = selected
    ? (selected.qr_system === 'kakao'
        ? `${SUNPOS_KAKAO_URL}/qr/${selected.account_code}`
        : `${BASE_URL}?store=${storeId}&account=${selected.account_code}`)
    : ''
  const selectedQrDataUrl    = useQrDataUrl(selectedQrUrl)

  // QR 인쇄(A4 종이 / 영수증) 두 동작은 src/hooks/useQrPrint.ts 로 옮겼다.
  // 이 화면에는 아직 그 버튼이 없다 — 고객 > QR오더 화면(기획 완료, 미구현)이
  // 이 훅을 그대로 쓸 예정이다. 그 화면을 붙일 때 printQrSheet / printQrReceipt 를
  // 버튼에 연결하면 끝이다.
  //
  // 버튼이 없는데도 여기서 한 번 호출해 두는 이유: selected·storeName 같은 입력이
  // 바뀌면 타입 에러로 바로 드러나게 하려고. 안 부르고 두면 훅이 조용히 썩는다.
  const qrPrint = useQrPrint({
    account:   selected,
    qrDataUrl: selectedQrDataUrl,
    qrUrl:     selectedQrUrl,
    storeName,
    onError:   msg => {
      setPrinterToast(msg)
      setTimeout(() => setPrinterToast(''), 3500)
    },
  })
  void qrPrint   // 버튼이 붙기 전까지 의도적 미사용

  const [addOpen,      setAddOpen]      = useState(false)
  const [newForm,      setNewForm]      = useState({
    name: '', type: '부서' as DbAccount['account_type'], org: '', manager: '', phone: '', pin: '',
    initialDeposit: '', initialDepositMemo: '', prepayValidity: 'none' as DbAccount['prepay_validity'],
  })
  const [addPinError, setAddPinError] = useState('')
  const [editOpen,     setEditOpen]     = useState(false)
  const [editForm,     setEditForm]     = useState({
    name: '', type: '부서' as DbAccount['account_type'], org: '', manager: '', phone: '', pin: '',
    prepayValidity: 'none' as DbAccount['prepay_validity'],
  })
  const [addPhoneError, setAddPhoneError] = useState('')
  const [addDupAccount, setAddDupAccount] = useState<{ account_code: string; account_name: string } | null>(null)
  const [addConfirm,    setAddConfirm]    = useState(false)
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [editPinError, setEditPinError] = useState('')
  const [editDeactivateConfirm, setEditDeactivateConfirm] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [chargeMethod,      setChargeMethod]      = useState('신용카드')
  const [chargeDate,        setChargeDate]        = useState('')   // "YYYY-MM-DD"
  const [chargeTime,        setChargeTime]        = useState('')   // "HH:MM"
  const [chargeConfirm,     setChargeConfirm]     = useState(false)
  const [chargeLoading,     setChargeLoading]     = useState(false)
  const [statementOpen,     setStatementOpen]     = useState(false)
  const [stmtMonth,         setStmtMonth]         = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [stmtAllTime,  setStmtAllTime]  = useState(false)
  const [stmtOrders,      setStmtOrders]      = useState<any[]>([])
  const [stmtDeposits,    setStmtDeposits]    = useState<DbDeposit[]>([])
  const [stmtAdjustments, setStmtAdjustments] = useState<any[]>([])
  const [stmtLoading,     setStmtLoading]     = useState(false)

  // ── 거래처 목록 조회 ──────────────────────────────────────────────────────────
  async function fetchAccounts(inactive = false) {
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('is_active', !inactive)
      .eq('store_id', storeId)
      .order('created_at', { ascending: true })
    if (error) throw error
    if (data) setAccounts(data as DbAccount[])
    return (data ?? []) as DbAccount[]
  }

  // ── 관리자 등록완료 여부 (qr_system='kakao' 거래처의 "등록대기" 배지 판정용) ──
  async function fetchRegisteredAdmins() {
    const { data } = await supabase
      .from('user_account_links')
      .select('account_code')
      .eq('role', '관리자')
      .eq('status', 'approved')
    setRegisteredAdmins(new Set((data ?? []).map((r: { account_code: string }) => r.account_code)))
  }

  // ── 이번달 거래처별 사용액 계산 ───────────────────────────────────────────────
  async function fetchMonthlyUsages() {
    const now   = new Date()
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00`
    const { data } = await supabase
      .from('orders')
      .select('account_code, total_amount, status')
      .gte('ordered_at', start)

    const map: Record<string, number> = {}
    for (const row of (data ?? [])) {
      if (row.status !== '취소') {
        map[row.account_code] = (map[row.account_code] ?? 0) + row.total_amount
      }
    }
    setMonthlyUsage(map)
  }

  // ── 고객현황 사이드바 통계 (Figma node 494:1051) ─────────────────────────────
  async function fetchCustomerStats(accountCodes: string[]) {
    if (accountCodes.length === 0) {
      setMemberCounts({}); setMonthlyDeposits({}); setOrderTrend({})
      setMonthlyOrderCount({}); setActive30dCount(0); setYearlyDeposits(Array(12).fill(0)); setYearlyOrders(Array(12).fill(0)); setYearlyDepositRows([])
      return
    }
    const now = new Date()
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const yearStart = new Date(now.getFullYear(), 0, 1)
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const [membersRes, depositsRes, ordersRes] = await Promise.all([
      supabase.from('account_members').select('account_code').in('account_code', accountCodes),
      supabase.from('deposits').select('account_code, amount, created_at').in('account_code', accountCodes).gte('created_at', yearStart.toISOString()),
      // 올해 전체로 넓힌다 — 선결제 추이와 나란히 놓을 '주문 추이'를 그리려면
      // 12개월치가 필요하다. orders 가 수백 행이라 범위를 넓혀도 부담이 없다.
      supabase.from('orders').select('account_code, ordered_at, status').in('account_code', accountCodes).gte('ordered_at', yearStart.toISOString()),
    ])

    const mCounts: Record<string, number> = {}
    for (const row of (membersRes.data ?? [])) mCounts[row.account_code] = (mCounts[row.account_code] ?? 0) + 1
    setMemberCounts(mCounts)

    const mDeposits: Record<string, number> = {}
    const yDeposits = Array(12).fill(0)
    for (const row of (depositsRes.data ?? [])) {
      const d = new Date(row.created_at)
      if (d >= thisMonthStart) mDeposits[row.account_code] = (mDeposits[row.account_code] ?? 0) + row.amount
      yDeposits[d.getMonth()] += row.amount
    }
    setMonthlyDeposits(mDeposits)
    setYearlyDeposits(yDeposits)
    setYearlyDepositRows(depositsRes.data ?? [])

    const thisCount: Record<string, number> = {}
    const lastCount: Record<string, number> = {}
    const active30d = new Set<string>()
    const yOrders = Array(12).fill(0)
    for (const row of (ordersRes.data ?? [])) {
      if (row.status === '취소') continue
      const d = new Date(row.ordered_at)
      yOrders[d.getMonth()] += 1
      if (d >= thisMonthStart) thisCount[row.account_code] = (thisCount[row.account_code] ?? 0) + 1
      // 범위를 올해 전체로 넓혔으므로 '지난달'을 명시적으로 가둬야 한다.
      // 안 그러면 1월 주문까지 전부 '지난달'로 세어져 추이가 엉킨다.
      else if (d >= lastMonthStart) lastCount[row.account_code] = (lastCount[row.account_code] ?? 0) + 1
      if (d >= d30) active30d.add(row.account_code)
    }
    setYearlyOrders(yOrders)
    setMonthlyOrderCount(thisCount)
    setActive30dCount(active30d.size)
    const trend: Record<string, number> = {}
    for (const code of new Set([...Object.keys(thisCount), ...Object.keys(lastCount)])) {
      trend[code] = (thisCount[code] ?? 0) - (lastCount[code] ?? 0)
    }
    setOrderTrend(trend)
  }

  // ── 선택 거래처 주문 내역 조회 ────────────────────────────────────────────────
  async function fetchAccountOrders(accountCode: string) {
    const { data } = await supabase
      .from('orders')
      .select(`
        order_code, orderer_name, orderer_phone,
        ordered_at, total_amount, balance_after, method, status, note,
        accounts ( account_name ),
        order_items (
          menu_name, quantity, unit_price,
          order_item_options ( option_name )
        )
      `)
      .eq('account_code', accountCode)
      .order('ordered_at', { ascending: false })
      .limit(30)

    setAccountOrders((data ?? []).map(mapOrderRow))
  }

  // ── 선택 거래처 누적 주문자 조회 ─────────────────────────────────────────────
  async function fetchMembers(accountCode: string) {
    const { data } = await supabase
      .from('account_members')
      .select('id, name, phone, order_count, last_ordered_at')
      .eq('account_code', accountCode)
      .order('order_count', { ascending: false })
    setMembers((data ?? []) as typeof members)
  }

  // ── 선택 거래처 관리자/이용자 조회 (qr_system='kakao'인 거래처만 의미 있음) ────
  async function fetchAdminUsers(accountCode: string) {
    const { data } = await supabase.rpc('get_account_admin_users', { p_account_code: accountCode })
    setAdminUsers((data ?? []) as typeof adminUsers)
  }

  // ── 선택 거래처 충전 이력 조회 ────────────────────────────────────────────────
  async function fetchDeposits(accountCode: string) {
    const { data } = await supabase
      .from('deposits')
      .select('*')
      .eq('account_code', accountCode)
      .order('created_at', { ascending: false })
    setDeposits((data ?? []) as DbDeposit[])
  }

  // ── 이용내역서 조회 (항상 전체 기간 로드, 표시는 buildStmtRows에서 필터) ──────
  async function fetchStatement(accountCode: string) {
    setStmtLoading(true)
    try {
      const [{ data: orders }, { data: deps }, { data: adjs }] = await Promise.all([
        supabase
          .from('orders')
          .select('order_code, ordered_at, total_amount, delivery_fee, method, orderer_name, balance_after, order_items ( menu_name, quantity )')
          .eq('account_code', accountCode)
          .neq('status', '취소')
          // 삭제된 주문은 잔액이 환불된 건이라 사용내역에 charge로 남으면 안 된다
          .eq('is_deleted', false)
          .order('ordered_at', { ascending: true }),
        supabase
          .from('deposits')
          .select('*')
          .eq('account_code', accountCode)
          .order('created_at', { ascending: true }),
        supabase
          .from('balance_adjustments')
          .select('*')
          .eq('account_code', accountCode)
          .order('created_at', { ascending: true }),
      ])
      setStmtOrders(orders ?? [])
      setStmtDeposits((deps ?? []) as DbDeposit[])
      setStmtAdjustments(adjs ?? [])
    } finally {
      setStmtLoading(false)
    }
  }

  type StmtRow =
    | { type: 'deposit';    date: string; amount: number; paymentMethod: string; balanceAfter: number }
    | { type: 'adjustment'; date: string; amount: number; balanceBefore: number; balanceAfter: number; reason: string | null; orderer: string | null }
    | { type: 'order';      date: string; amount: number; summary: string; note: string; orderer: string; balanceAfter: number; discrepancy?: number }

  function buildStmtRows(): StmtRow[] {
    // 전체 행 합산 후 날짜 정렬
    const all: StmtRow[] = [
      ...stmtDeposits.map(d => ({
        type:          'deposit' as const,
        date:          d.created_at,
        amount:        d.amount,
        paymentMethod: d.payment_method ?? '신용카드',
        balanceAfter:  d.balance_after,
      })),
      ...stmtAdjustments.map((a: any) => ({
        type:          'adjustment' as const,
        date:          a.created_at,
        amount:        a.amount,
        balanceBefore: a.balance_before,
        balanceAfter:  a.balance_after,
        reason:        a.reason ?? null,
        orderer:       a.orderer_name ?? null,
      })),
      ...stmtOrders.map((o: any) => ({
        type:         'order' as const,
        date:         o.ordered_at,
        amount:       o.total_amount,
        summary:      (o.order_items ?? []).map((i: any) => `${i.menu_name}${i.quantity}`).join(', '),
        note:         o.method === '배달' && o.delivery_fee ? `배달료 포함(${o.delivery_fee.toLocaleString()}원)` : o.method,
        orderer:      o.orderer_name ?? '',
        balanceAfter: o.balance_after ?? 0,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date))

    // 순방향으로 예상 잔액 추적.
    // 주문 행에서 (예상 잔액 - 주문금액)과 실제 balance_after가 다르면 discrepancy 표시.
    // 충전 행은 잔액 표시 없음 (소급 입력 가능성으로 신뢰 불가).
    let expectedBalance = 0
    const computed = all.map(row => {
      if (row.type === 'deposit') {
        expectedBalance += row.amount
        return { ...row, balanceAfter: expectedBalance }
      } else if (row.type === 'adjustment') {
        // 조정은 balance_after가 정확하므로 기준점으로 사용
        expectedBalance = row.balanceAfter
        return row
      } else {
        const expectedBalanceBefore = expectedBalance
        const actualBalanceBefore   = row.balanceAfter + row.amount
        const diff = actualBalanceBefore - expectedBalanceBefore
        expectedBalance = row.balanceAfter  // 주문 스냅샷으로 보정
        return { ...row, discrepancy: diff !== 0 ? diff : undefined }
      }
    })

    // 월 필터 적용 (데이터는 전체, 표시만 선택 월로 제한)
    if (!stmtAllTime) {
      const [y, m] = stmtMonth.split('-').map(Number)
      const start = new Date(y, m - 1, 1)
      const end   = new Date(y, m,     1)
      return computed.filter(r => {
        const d = new Date(r.date)
        return d >= start && d < end
      })
    }
    return computed
  }

  function downloadCSV() {
    if (!selected) return
    const acc  = selected
    const rows = buildStmtRows()

    const esc     = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const fmt     = (n: number)  => `₩${n.toLocaleString()}`
    const fmtDate = (iso: string) => {
      const d = new Date(iso)
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    }

    const lines: string[][] = [
      ['선결제 이용내역서','','','','','','','',''],
      ['회사명', acc.account_name, '', '관리자', acc.contact_person ?? '', '', '', '', ''],
      ['사업자등록번호', acc.business_number ?? '', '', '전화번호', acc.contact_phone ?? '', '', '', '', ''],
      ['','','','','','','','',''],
      ['선결제내역','','','사용내역','','','','','잔액'],
      ['일자','금액','기타','일자','금액','내역','비고','서명','잔액'],
      ...rows.map(r => {
        if (r.type === 'deposit') {
          return [fmtDate(r.date), r.amount < 0 ? `-${fmt(Math.abs(r.amount))}` : `+${fmt(r.amount)}`, r.paymentMethod, '', '', '', '', '', fmt(r.balanceAfter)]
        } else if (r.type === 'adjustment') {
          const sign = r.amount >= 0 ? '+' : ''
          return [fmtDate(r.date), `${sign}${fmt(r.amount)}`, '잔액조정', '', '', r.reason ?? '', `${fmt(r.balanceBefore)} → ${fmt(r.balanceAfter)}`, r.orderer ?? '', fmt(r.balanceAfter)]
        } else {
          return ['', '', '', fmtDate(r.date), fmt(r.amount), r.summary, r.note, r.orderer, fmt(r.balanceAfter)]
        }
      }),
    ]

    const csv  = '\uFEFF' + lines.map(row => row.map(esc).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `선결제이용내역서_${acc.account_name}_${stmtAllTime ? '전체' : stmtMonth}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // 우측 상세 패널 "이용내역서" 버튼 — 월별 표 모달을 띄움 (CSV 다운로드는 모달 안에서)
  async function handleOpenStatement() {
    if (!selected) return
    setStatementOpen(true)
    await fetchStatement(selected.account_code)
  }

  function prevStmtMonth() {
    if (stmtAllTime) { setStmtAllTime(false); return }
    const [y, m] = stmtMonth.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    setStmtMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  function nextStmtMonth() {
    if (stmtAllTime) return
    const [y, m] = stmtMonth.split('-').map(Number)
    const d = new Date(y, m, 1)
    setStmtMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // ── selected 변경 시 충전 모달 초기화 ──────────────────────────────────────────
  useEffect(() => {
    setChargeOpen(false)
    setChargeConfirm(false)
    setChargeAmt('')
    setChargeError('')
    setPhoneRevealed(false)
    setDetailTab('orders')
  }, [selected?.account_code])

  // ── 마운트 / showInactive 변경 시 목록 재조회 ────────────────────────────────
  useEffect(() => {
    const key = `accounts:${storeId}:${showInactive ? 'inactive' : 'active'}`

    async function load() {
      setFetchError(false)
      setSelected(null)

      // 캐시가 있으면 먼저 그려놓고 뒤에서 갱신한다 — 탭을 옮길 때마다
      // 화면이 언마운트돼 매번 처음부터 받던 걸 없앤다 (Menus 와 같은 방식)
      const hit = getCached<DbAccount[]>(key)
      if (hit) {
        setAccounts(hit.data)
        setLoading(false)
        if (!hit.stale) {
          // 집계는 가벼우니 최신이어도 뒤에서 한 번 갱신해 둔다
          fetchCustomerStats(hit.data.map(a => a.account_code)).catch(() => {})
          return
        }
      } else {
        setLoading(true)
      }

      try {
        const [fetchedAccounts] = await Promise.all([fetchAccounts(showInactive), fetchMonthlyUsages(), fetchRegisteredAdmins()])
        setCached(key, fetchedAccounts)
        fetchCustomerStats(fetchedAccounts.map(a => a.account_code)).catch(() => {})
      } catch {
        setFetchError(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [showInactive, retryCount])

  // 캐시를 화면 상태와 맞춘다 — 거래처를 추가·수정·충전하면 상태가 먼저 바뀐다
  useEffect(() => {
    if (!storeId || loading || accounts.length === 0) return
    setCached(`accounts:${storeId}:${showInactive ? 'inactive' : 'active'}`, accounts)
  }, [storeId, loading, showInactive, accounts])

  // ── 선택 거래처 변경 시 이력 로딩 ─────────────────────────────────────────────
  useEffect(() => {
    if (!selected) return
    fetchAccountOrders(selected.account_code)
    fetchDeposits(selected.account_code)
    fetchMembers(selected.account_code)
    fetchAdminUsers(selected.account_code)
    setOrderPage(0)
    setChargePage(0)
  }, [selected?.account_code])

  // ── 이용내역서 탭 활성 / 월 변경 시 조회 ──────────────────────────────────────
  useEffect(() => {
    if (detailTab !== 'statement' || !selected) return
    fetchStatement(selected.account_code)
  }, [detailTab, selected?.account_code])

  const filtered = accounts.filter(a => {
    if (typeFilter !== 'all' && a.account_type !== typeFilter) return false
    if (search && !a.account_name.includes(search) && !(a.organization_name ?? '').includes(search) && !(a.contact_person ?? '').includes(search)) return false
    return true
  })

  // ── 거래처 추가 ───────────────────────────────────────────────────────────────
  // PIN은 점주가 계정 생성 시점에 매장에서 바로 정함 (고객에게 구두로 물어보고 입력) —
  // 온라인 관리자 등록 흐름에선 더 이상 PIN을 안 받음.
  function isValidManagerPhone(phone: string): boolean {
    return /^010-\d{4}-\d{4}$/.test(phone)
  }

  function isWeakPin(pin: string): boolean {
    if (/^(\d)\1{3}$/.test(pin)) return true
    if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return true
    return false
  }

  // "등록" 클릭 → 검증 + 중복확인만 하고, 실제 생성은 확인 다이얼로그의 [확인]에서
  async function openAddConfirm() {
    const phone = newForm.phone.trim()
    if (!newForm.name.trim() || !newForm.manager.trim() || !isValidManagerPhone(phone)) return
    if (newForm.pin.length !== 4) return
    if (isWeakPin(newForm.pin)) { setAddPinError('다른 번호로 설정해 주세요'); return }
    setAddPinError('')
    const initialBalance = parseInt(newForm.initialDeposit.replace(/,/g, ''), 10)
    if (isNaN(initialBalance) || initialBalance === 0) return

    const { data: dup } = await supabase
      .from('accounts')
      .select('account_code, account_name')
      .eq('contact_phone', phone)
      .eq('is_active', true)
      .eq('store_id', storeId)
      .maybeSingle()
    if (dup) {
      setAddDupAccount(dup)
      return
    }
    setAddDupAccount(null)
    setAddPhoneError('')
    setAddConfirm(true)
  }

  async function handleAddAccount() {
    const phone = newForm.phone.trim()
    const initialBalance = parseInt(newForm.initialDeposit.replace(/,/g, ''), 10)
    setAddSubmitting(true)

    // PIN — 평문(레거시 웹)과 암호화(카카오) 두 컬럼을 같이 만든다. lib/pin-crypto.ts 주석 참고
    let pinCols
    try {
      pinCols = await buildPinColumns(newForm.pin)
    } catch (e) {
      console.error('PIN 설정 실패:', e)
      setAddSubmitting(false)
      setPrinterToast('PIN 설정에 실패했어요. 다시 시도해 주세요')
      setTimeout(() => setPrinterToast(''), 3500)
      return
    }

    const { data: newAccount, error } = await supabase
      .from('accounts')
      .insert({
        account_name:      newForm.name.trim(),
        account_type:      newForm.type,
        organization_name: newForm.org.trim() || null,
        contact_person:    newForm.manager.trim(),
        contact_phone:     phone,
        prepay_validity:   newForm.prepayValidity,
        is_active:         true,
        store_id:          storeId,
        pin_code:          pinCols.pin_code,
        pin_encrypted:     pinCols.pin_encrypted,
        // 양수/음수 모두 초기값으로 직접 설정 (add_deposit은 양수 전용이라 직접 INSERT)
        current_balance:   initialBalance,
      })
      .select('account_code')
      .single()

    if (error) {
      console.error('거래처 추가 실패:', error)
      setAddSubmitting(false)
      return
    }

    // 초기 잔액 이력 기록 (양수·음수 모두)
    if (newAccount) {
      const { error: depErr } = await supabase.from('deposits').insert({
        account_code: newAccount.account_code,
        amount:       initialBalance,
        note:         newForm.initialDepositMemo.trim() || '초기 잔액 등록',
      })
      if (depErr) console.error('초기 잔액 이력 기록 실패:', depErr)
    }

    // 관리자 등록 링크 발급 + SOLAPI 문자 발송 (실패해도 계정 생성은 이미 끝났으니 토스트로만 알림)
    if (newAccount) {
      try {
        const { data: token, error: linkErr } = await supabase.rpc('admin_registration_issue_link', {
          p_account_code: newAccount.account_code,
        })
        if (linkErr) throw linkErr

        // 문자 단문 요금 유도를 위한 단축링크 (bit.ly 등 외부 서비스는 무료 발급량이 너무 적어 자체 구현)
        const { data: shortCode } = await supabase.rpc('create_short_link', {
          p_target_url: `${SUNPOS_KAKAO_URL}/register/admin/${token}`,
        })
        const link = shortCode ? `${SUNPOS_KAKAO_URL}/s/${shortCode}` : `${SUNPOS_KAKAO_URL}/register/admin/${token}`
        const { error: sendErr } = await supabase.functions.invoke('send-notification', {
          body: {
            purpose: 'admin_registration',
            phone,
            params: { storeName, accountName: newForm.name.trim(), link },
          },
        })
        if (sendErr) throw sendErr
      } catch (e) {
        console.error('관리자 등록 링크 발송 실패:', e)
        setPrinterToast('문자 발송에 실패했어요. 번호를 확인해 주세요')
        setTimeout(() => setPrinterToast(''), 3500)
      }
    }

    await fetchAccounts().catch(() => {})
    setNewForm({ name: '', type: '부서', org: '', manager: '', phone: '', pin: '', initialDeposit: '', initialDepositMemo: '', prepayValidity: 'none' })
    setAddDupAccount(null)
    setAddConfirm(false)
    setAddSubmitting(false)
    setAddOpen(false)
  }

  // ── 관리자 등록 문자 재발송 ───────────────────────────────────────────────────
  // 이미 완료된 계정이면 admin_registration_issue_link RPC가 서버에서 막아줌 (raise exception).
  async function handleResendAdminRegistration() {
    if (!selected) return
    setResendLoading(true)
    try {
      const { data: token, error: linkErr } = await supabase.rpc('admin_registration_issue_link', {
        p_account_code: selected.account_code,
      })
      if (linkErr) throw linkErr

      const { data: shortCode } = await supabase.rpc('create_short_link', {
        p_target_url: `${SUNPOS_KAKAO_URL}/register/admin/${token}`,
      })
      const link = shortCode ? `${SUNPOS_KAKAO_URL}/s/${shortCode}` : `${SUNPOS_KAKAO_URL}/register/admin/${token}`
      const { error: sendErr } = await supabase.functions.invoke('send-notification', {
        body: {
          purpose: 'admin_registration',
          phone: selected.contact_phone,
          params: { storeName, accountName: selected.account_name, link },
        },
      })
      if (sendErr) throw sendErr
      setPrinterToast('관리자 등록 문자를 다시 보냈어요')
    } catch (e) {
      console.error('재발송 실패:', e)
      const msg = (e as { message?: string })?.message ?? ''
      setPrinterToast(msg.includes('이미 관리자 등록이 완료된 계정') ? '이미 관리자 등록이 완료된 계정이에요' : '문자 발송에 실패했어요. 번호를 확인해 주세요')
    } finally {
      setResendLoading(false)
      setTimeout(() => setPrinterToast(''), 3500)
      fetchRegisteredAdmins()
    }
  }

  // ── 중복 전화번호 발견 시: 기존 계정으로 가서 충전 ────────────────────────────
  function goChargeExistingAccount() {
    if (!addDupAccount) return
    const acc = accounts.find(a => a.account_code === addDupAccount.account_code)
    setAddOpen(false)
    setAddDupAccount(null)
    if (acc) { setSelected(acc); setChargeOpen(true) }
  }

  // ── 충전 등록 ─────────────────────────────────────────────────────────────────
  async function handleCharge() {
    const amt = parseInt(chargeAmt.replace(/,/g, ''), 10)
    if (isNaN(amt) || amt <= 0 || !selected || chargeLoading) return
    setChargeLoading(true)

    // 선결제 일시: 입력된 날짜+시간을 KST로 해석해 ISO로 변환
    const createdAt = chargeDate
      ? `${chargeDate}T${chargeTime || '00:00'}:00+09:00`
      : undefined

    const { error } = await supabase.rpc('add_deposit', {
      p_account_code:   selected.account_code,
      p_amount:         amt,
      p_note:           chargeMemo || null,
      p_payment_method: chargeMethod,
      ...(createdAt ? { p_created_at: createdAt } : {}),
    })

    if (error) {
      console.error('충전 실패:', error)
      setChargeError('충전에 실패했습니다. 다시 시도해주세요.')
      setChargeLoading(false)
      return
    }

    track('pos_deposit_added', {
      account_code:    selected.account_code,
      account_name:    selected.account_name,
      amount:          amt,
    })

    await Promise.all([fetchAccounts(), fetchDeposits(selected.account_code)]).catch(() => {})
    // 계산값 대신 DB에서 최신 잔액 직접 조회해 selected 갱신
    const { data: refreshed } = await supabase
      .from('accounts')
      .select('*')
      .eq('account_code', selected.account_code)
      .single()
    if (refreshed) setSelected(refreshed as DbAccount)
    setChargeOpen(false)
    setChargeAmt('')
    setChargeMemo('')
    setChargeError('')
    setChargeMethod('신용카드')
    setChargeLoading(false)
  }

  // ── 정보 수정 열기 ────────────────────────────────────────────────────────────
  function openEdit() {
    if (!selected) return
    setEditForm({
      name:          selected.account_name,
      type:          selected.account_type,
      org:           selected.organization_name ?? '',
      manager:       selected.contact_person ?? '',
      phone:         selected.contact_phone ?? '',
      pin:           selected.pin_code ?? '',
      prepayValidity: selected.prepay_validity,
    })
    setEditOpen(true)
  }

  // ── 정보 수정 저장 ────────────────────────────────────────────────────────────
  async function handleEditAccount() {
    if (!selected || !editForm.name.trim() || !editForm.manager.trim() || editForm.pin.length !== 4) return

    // PIN이 변경됐을 때만 중복 확인 (자기 자신 제외)
    if (editForm.pin.trim() !== selected.pin_code) {
      const { data: dup } = await supabase
        .from('accounts')
        .select('account_code')
        .eq('pin_code', editForm.pin.trim())
        .eq('is_active', true)
        .eq('store_id', storeId)
        .neq('account_code', selected.account_code)
        .maybeSingle()
      if (dup) {
        setEditPinError('이미 존재하는 PIN번호입니다.')
        return
      }
    }
    setEditPinError('')

    // PIN 이 바뀌었으면 암호화본도 같이 갱신한다. 평문만 바꾸면 카카오 로그인이
    // 옛 PIN 으로 남아서 "일치하지 않는다"가 뜬다 (2026-10-13 장애 원인)
    let pinCols
    try {
      pinCols = await buildPinColumns(editForm.pin)
    } catch (e) {
      console.error('PIN 설정 실패:', e)
      setEditPinError('PIN 저장에 실패했어요. 다시 시도해 주세요.')
      return
    }

    const { error } = await supabase
      .from('accounts')
      .update({
        account_name:      editForm.name.trim(),
        account_type:      editForm.type,
        organization_name: editForm.org.trim() || null,
        contact_person:    editForm.manager.trim(),
        contact_phone:     editForm.phone.trim() || null,
        pin_code:          pinCols.pin_code,
        pin_encrypted:     pinCols.pin_encrypted,
        prepay_validity:   editForm.prepayValidity,
      })
      .eq('account_code', selected.account_code)
    if (error) { console.error('수정 실패:', error); return }

    await fetchAccounts().catch(() => {})
    setSelected(prev => prev ? {
      ...prev,
      account_name:      editForm.name.trim(),
      account_type:      editForm.type,
      organization_name: editForm.org.trim() || null,
      contact_person:    editForm.manager.trim(),
      contact_phone:     editForm.phone.trim() || null,
      prepay_validity:   editForm.prepayValidity,
      pin_code:          editForm.pin.trim(),
    } : prev)
    setEditPinError('')
    setEditOpen(false)
  }

  // ── 삭제 후 다운그레이드 필요 여부 확인 ──────────────────────────────────────
  async function checkDowngrade() {
    const currentPlanIdx = PLAN_ORDER.indexOf(plan as typeof PLAN_ORDER[number])
    if (currentPlanIdx <= 0) return // 무료 플랜은 다운그레이드 없음

    // 삭제 후 최신 활성 팀 수를 DB에서 직접 조회
    const { count } = await supabase
      .from('accounts')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('is_active', true)

    const activeCount = count ?? 0
    const recommended = getRecommendedPlan(activeCount)
    const recommendedIdx = PLAN_ORDER.indexOf(recommended)

    if (recommendedIdx >= currentPlanIdx) return // 다운그레이드 불필요

    // 구독 정보에서 다음 결제일 가져오기
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('billing_anchor_date')
      .eq('client_id', clientId)
      .single()

    const anchorDate = sub?.billing_anchor_date ?? new Date().toISOString().slice(0, 10)
    setDowngradeModal({ targetPlan: recommended, nextBillingDate: getNextBillingDate(anchorDate) })
  }

  // ── 다운그레이드 예약 ─────────────────────────────────────────────────────────
  async function scheduleDowngrade(targetPlan: import('../lib/plans').PlanTier) {
    await supabase.from('subscriptions').update({
      pending_plan:    targetPlan,
      pending_plan_at: new Date().toISOString(),
    }).eq('client_id', clientId)
    setDowngradeModal(null)
  }

  // ── 즉시 다운그레이드 ─────────────────────────────────────────────────────────
  async function applyDowngradeNow(targetPlan: import('../lib/plans').PlanTier) {
    const today = new Date().toISOString().slice(0, 10)
    const nextEnd = new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().slice(0, 10)
    await Promise.all([
      supabase.from('clients').update({ plan: targetPlan }).eq('id', clientId),
      supabase.from('subscriptions').update({
        plan: targetPlan, pending_plan: null, pending_plan_at: null,
        current_period_start: today, current_period_end: nextEnd,
      }).eq('client_id', clientId),
    ])
    setDowngradeModal(null)
    // 페이지 리로드로 세션 플랜 갱신
    window.location.reload()
  }

  // ── 거래처 삭제 (소프트) ─────────────────────────────────────────────────────
  async function handleDeleteAccount() {
    if (!selected) return
    const { error } = await supabase
      .from('accounts')
      .update({ is_active: false })
      .eq('account_code', selected.account_code)
    if (error) { console.error('삭제 실패:', error); return }
    await fetchAccounts(showInactive).catch(() => {})
    setSelected(null)
    setEditDeactivateConfirm(false)
    setEditOpen(false)
    await checkDowngrade()
  }

  // ── 충전 이력 수정 ────────────────────────────────────────────────────────────
  // ── 거래처 영구 삭제 (하드) ──────────────────────────────────────────────────
  // ── 거래처 복구 ───────────────────────────────────────────────────────────────
  async function handleRestoreAccount() {
    if (!selected) return
    const { error } = await supabase
      .from('accounts')
      .update({ is_active: true })
      .eq('account_code', selected.account_code)
    if (error) { console.error('복구 실패:', error); return }
    await fetchAccounts(showInactive).catch(() => {})
    setSelected(null)
  }

  // ── 고객현황 사이드바 집계 (Figma node 494:1051) ─────────────────────────────
  const typeCounts: Record<string, number> = {}
  for (const a of accounts) typeCounts[a.account_type] = (typeCounts[a.account_type] ?? 0) + 1
  const typeTotal = accounts.length || 1
  // 표의 유형 태그 색 — 우측 계정유형 도넛과 같은 기준(건수 많은 순)으로 팔레트를 배정해 둘이 어긋나지 않게 한다
  const typeColorOrder = [...customerTypes].sort((a, b) => (typeCounts[b] ?? 0) - (typeCounts[a] ?? 0))
  const typeColorOf = (t: string) => {
    const i = typeColorOrder.indexOf(t)
    return TYPE_DONUT_COLORS[(i < 0 ? 0 : i) % TYPE_DONUT_COLORS.length]
  }
  const totalMembers = Object.values(memberCounts).reduce((s, n) => s + n, 0)
  const active30dPct = accounts.length > 0 ? Math.round((active30dCount / accounts.length) * 100) : 0
  const topOrderedAccounts = [...accounts]
    .filter(a => (monthlyOrderCount[a.account_code] ?? 0) > 0)
    .sort((a, b) => (monthlyOrderCount[b.account_code] ?? 0) - (monthlyOrderCount[a.account_code] ?? 0))
    .slice(0, 3)
  const maxYearlyDeposit = Math.max(1, ...yearlyDeposits)

  return (
    <div className="h-full flex flex-col overflow-hidden bg-canvas">


      {/* ── 좌측 고객 테이블 + 우측 고객현황 사이드바. 둘 다 고정 실제 px, transform:scale 없음 —
           모든 px는 Figma 원본(2240 캔버스) 수치 × FIGMA_SCALE — src/lib/figma-scale.ts 참고 ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* 좌측: 검색 + 유형 필터 + 테이블 */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* 검색창 — Menus.tsx와 동일하게 relative 컨테이너 + absolute 버튼으로 위치 통일 */}
          <div className="relative flex-shrink-0 px-[26px] pt-[17px] pb-[13px]" style={{ height: 59 }}>
            <div className="field-wrap border border-[#ADADAD] rounded-[15px] bg-white flex items-center px-[13px] gap-[8px]" style={{ width: 250, height: 31 }}>
              <svg width="14" height="14" viewBox="0 0 22 22" fill="none"><circle cx="9" cy="9" r="7" stroke="#8C8379" strokeWidth="2"/><path d="M14 14L19 19" stroke="#8C8379" strokeWidth="2" strokeLinecap="round"/></svg>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="계정이름 또는 주문자 이름 검색"
                className="field-bare flex-1 min-w-0 outline-none focus-visible:outline-none text-[13px] text-ink placeholder:text-[#8C8379] bg-transparent"
              />
            </div>
            {/* 우상단 텍스트 버튼 — 메뉴·주문 화면의 텍스트 버튼과 같은 위치(top 3)로 맞춤 */}
            {typeEditMode ? (
              <div className="absolute flex items-center gap-[16px]" style={{ right: 26, top: 3 }}>
                <button onClick={cancelTypeEdit} className="text-[13px] font-medium text-gray-text whitespace-nowrap hover:text-ink transition-colors">
                  편집 취소
                </button>
                <button
                  onClick={confirmTypeEdit}
                  disabled={typeSaving}
                  className="px-[15px] py-[7px] rounded-lg bg-[#2C261F] text-white text-[13px] font-semibold whitespace-nowrap disabled:opacity-50 transition-opacity"
                >
                  {typeSaving ? '저장 중...' : '완료'}
                </button>
              </div>
            ) : (
              <button
                onClick={startTypeEdit}
                className="absolute flex items-center gap-[4px] text-[13px] text-[#6A635E] whitespace-nowrap hover:text-ink transition-colors"
                style={{ right: 26, top: 3 }}
              >
                화면 편집 ✎
              </button>
            )}
          </div>

          <div className="flex-shrink-0 flex items-center justify-between gap-[13px] px-[26px] pb-[13px]">
            {/* 유형 필터 pill — Figma 503:786: 평소엔 전체/유형들만, 화면 편집 중엔 각 유형에 연필 아이콘 + "유형 추가" */}
            <div className="flex items-center gap-[4px] flex-wrap">
              <button
                onClick={() => setTypeFilter('all')}
                className={`px-[10px] py-[6px] rounded-[19px] text-[15px] font-medium whitespace-nowrap transition-colors ${
                  typeFilter === 'all' ? 'bg-[#D7D2CE] text-ink' : 'text-ink/60 hover:text-ink'
                }`}
              >
                전체
              </button>
              {(typeEditMode ? typeDraft : customerTypes).map((t, i) => (
                typeEditMode && editingTypeIdx === i ? (
                  <input
                    key={i}
                    autoFocus
                    value={t}
                    maxLength={7}
                    onChange={e => setTypeDraft(prev => prev.map((x, xi) => xi === i ? e.target.value.slice(0, 7) : x))}
                    onBlur={() => setEditingTypeIdx(null)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingTypeIdx(null) }}
                    className="px-[10px] py-[6px] rounded-[19px] text-[15px] font-medium border border-ink outline-none"
                    style={{ width: Math.max(60, t.length * 14 + 20) }}
                  />
                ) : (
                  <button
                    key={i}
                    onClick={() => typeEditMode ? setEditingTypeIdx(i) : setTypeFilter(t)}
                    className={`px-[10px] py-[6px] rounded-[19px] text-[15px] font-medium whitespace-nowrap transition-colors flex items-center gap-[6px] ${
                      !typeEditMode && typeFilter === t ? 'bg-[#D7D2CE] text-ink' : 'text-ink/60 hover:text-ink'
                    }`}
                  >
                    {t}
                    {typeEditMode && (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z" stroke="#6A635E" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                    )}
                  </button>
                )
              ))}
              {typeEditMode && typeDraft.length < 6 && (
                <button
                  onClick={addTypeDraft}
                  className="px-[10px] py-[6px] text-[15px] font-medium text-[#6A635E] whitespace-nowrap flex items-center gap-[4px] hover:text-ink transition-colors"
                >
                  유형 추가
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" stroke="#6A635E" strokeWidth="2"/><path d="M12 7V17M7 12H17" stroke="#6A635E" strokeWidth="2" strokeLinecap="round"/></svg>
                </button>
              )}
            </div>
            {!typeEditMode && (
              <button
                onClick={() => setShowInactive(v => !v)}
                className={`text-[13px] font-medium whitespace-nowrap transition-colors flex-shrink-0 ${showInactive ? 'text-danger' : 'text-[#6A635E] hover:text-ink'}`}
              >
                {showInactive ? '비활성 고객 보는 중' : '비활성 보기'}
              </button>
            )}
          </div>

          {/* 테이블 */}
          <div className="relative flex-1 min-h-0">
            <ScrollHint scrollRef={tableScrollRef} topOffset={55} bottomOffset={38} />
            <div ref={tableScrollRef} className="h-full overflow-y-auto px-[26px] pb-[26px]">
            {/* overflow-hidden 을 빼야 머리글 sticky 가 산다(DataTable.tsx 주석 참고).
                모서리는 rounded + 첫 행/마지막 행이 알아서 맞춰진다. */}
            <div className="bg-canvas-soft rounded-[13px]">
              <div className="sticky top-0 z-10 bg-[#D7D2CE] border-y border-[#C1B7AA] flex items-center text-[#6A635E] text-[15px] font-medium rounded-t-[13px]" style={{ height: 43, paddingLeft: 15, paddingRight: 15 }}>
                <span style={{ width: 51 }}>순번</span>
                <span className="flex-1">계정 이름</span>
                <span style={{ width: 80 }}>유형</span>
                <span style={{ width: 77 }} className="flex items-center justify-end gap-[5px]">
                  추이
                  <span
                    className="w-[13px] h-[13px] rounded-full bg-[#E8E4E2] text-[#787878] text-[9px] flex items-center justify-center cursor-default"
                    onMouseEnter={e => { const r = e.currentTarget.getBoundingClientRect(); setTrendInfoTooltip({ x: r.left + r.width / 2, y: r.top }) }}
                    onMouseLeave={() => setTrendInfoTooltip(null)}
                  >
                    i
                  </span>
                </span>
                <span style={{ width: 97 }} className="text-right">이용자수</span>
                <span style={{ width: 116 }} className="text-right">잔액</span>
                <span style={{ width: 141 }} className="text-right">이번달 선결제</span>
              </div>

              {loading ? (
                <div className="flex items-center justify-center" style={{ height: 193 }}><LoadingTimer size={36} /></div>
              ) : fetchError ? (
                <div className="flex flex-col items-center justify-center gap-[8px] text-[#ADADAD] text-[13px]" style={{ height: 193 }}>
                  고객 목록을 불러오지 못했습니다
                  <button onClick={() => setRetryCount(c => c + 1)} className="px-[13px] py-[6px] rounded-[6px] bg-ink text-white text-[10px] font-bold">다시 시도</button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex items-center justify-center text-[#ADADAD] text-[13px]" style={{ height: 193 }}>
                  {search ? '검색 결과가 없습니다' : showInactive ? '비활성 고객이 없습니다' : '등록된 고객이 없습니다'}
                </div>
              ) : (
                filtered.map((acc, i) => {
                  const trend = orderTrend[acc.account_code] ?? 0
                  return (
                    <button
                      key={acc.account_code}
                      onClick={() => setSelected(acc)}
                      className="w-full flex items-center text-left text-[17px] text-ink hover:bg-white/40 transition-colors border-b border-[#E5E5E5] last:border-b-0"
                      style={{ height: 46, paddingLeft: 15, paddingRight: 15 }}
                    >
                      <span style={{ width: 51 }}>{i + 1}</span>
                      <span className="flex-1 truncate">{acc.account_name}</span>
                      <span style={{ width: 80 }}>
                        {(() => {
                          const c = typeColorOf(acc.account_type)
                          return (
                            <span
                              className="inline-block px-[8px] py-[3px] rounded-[6px] text-[12px] font-medium whitespace-nowrap max-w-full truncate align-middle"
                              style={{ color: c, backgroundColor: `${c}1F` }}
                            >
                              {TYPE_LABEL[acc.account_type] ?? acc.account_type}
                            </span>
                          )
                        })()}
                      </span>
                      <span style={{ width: 77 }} className={`text-right ${deltaClass(trend)}`}>
                        {trend > 0 ? `+${trend}건` : trend < 0 ? `${trend}건` : '-'}
                      </span>
                      <span style={{ width: 97 }} className={`text-right ${NUM}`}>{memberCounts[acc.account_code] ?? 0}명</span>
                      <span style={{ width: 116 }} className={`text-right ${acc.current_balance < 0 ? NUM_DOWN : NUM_STRONG}`}>
                        {acc.current_balance < 0 ? `-${won(Math.abs(acc.current_balance))}` : won(acc.current_balance)}
                      </span>
                      <span style={{ width: 141 }} className={`text-right ${(monthlyDeposits[acc.account_code] ?? 0) > 0 ? NUM_UP : NUM_MUTED}`}>
                        {(monthlyDeposits[acc.account_code] ?? 0) > 0 ? `+${won(monthlyDeposits[acc.account_code])}` : won(0)}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
            </div>
          </div>

          {/* "추이" 헤더 i 아이콘 툴팁 — 표 밖(fixed)에서 렌더해야 안 잘림 */}
          {trendInfoTooltip && (
            <div
              className="fixed z-50 pointer-events-none bg-[#FCFCFC] rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] px-[8px] py-[8px] w-[112px] -translate-x-1/2"
              style={{
                left:   trendInfoTooltip.x / rootZoom(),
                bottom: (window.innerHeight - trendInfoTooltip.y) / rootZoom() + 6,
              }}
            >
              <span className="block text-[12px] font-semibold text-ink text-center leading-[1.2]">지난달보다 늘어난<br />주문량이에요</span>
            </div>
          )}
        </div>

        {/* 우측: 고객현황 사이드바 — Figma node 494:1051 "고객현황" (실데이터) */}
        <div className="relative flex-shrink-0 w-[400px] h-full bg-[#F9F9F9] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden">
          {!selected ? (
            <div className="h-full overflow-y-auto flex flex-col gap-[13px] px-[26px] py-[13px]">
          {/* 제목 옆 '>' — 전체메뉴 고객 > 고객 현황 화면으로 진입 */}
          <button
            onClick={onOpenDetail}
            disabled={!onOpenDetail}
            className="flex items-center gap-[6px] self-start group"
          >
            <span className="text-[21px] font-medium text-ink whitespace-nowrap">고객현황</span>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="text-[#6A635E] group-hover:text-ink transition-colors">
              <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          <div className="flex gap-[6px]">
            <StatCard className="bg-[#F2F2F2] rounded-[13px]" padding={13} gap={9} style={{ width: 196 }}>
              <div className="text-[13px] font-medium text-[#2C261F] tracking-[-0.5px]">계정/이용자수</div>
              <div className="text-[21px] font-medium text-ink whitespace-nowrap">{accounts.length}팀/{totalMembers}명</div>
            </StatCard>
            <StatCard className="bg-[#F2F2F2] rounded-[13px] flex-1" padding={13} gap={9}>
              <div className="text-[13px] font-medium text-[#2C261F] tracking-[-0.5px] whitespace-nowrap">최근 30일 주문율</div>
              <div className="text-[18px] font-medium text-ink">{active30dPct}%</div>
            </StatCard>
          </div>

          {/* 선결제 추이 — 올해 월별 충전합계 바차트 */}
          <div className="relative bg-[#F2F2F2] rounded-[13px]" style={{ padding: 13 }}>
            <div className="text-[15px] font-semibold text-[#2C261F]">선결제 추이</div>
            <div className="flex items-end mt-[13px]" style={{ width: 323, height: 51 }}>
              {yearlyDeposits.map((amt, i) => (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-center justify-end h-full px-[1px] cursor-pointer"
                  onMouseEnter={e => setBarTooltip({ monthIdx: i, x: e.clientX, y: e.clientY })}
                  onMouseMove={e => setBarTooltip(t => t && { ...t, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setBarTooltip(null)}
                >
                  <div className="w-full bg-[#6A635E] rounded-t-[2px] transition-opacity" style={{ height: Math.max(2, (amt / maxYearlyDeposit) * 51), opacity: barTooltip && barTooltip.monthIdx !== i ? 0.4 : 1 }} />
                </div>
              ))}
            </div>
            {barTooltip && (() => {
              const monthRows = yearlyDepositRows.filter(r => new Date(r.created_at).getMonth() === barTooltip.monthIdx)
              const byAccount = new Map<string, { name: string; total: number; dates: string[] }>()
              for (const r of monthRows) {
                const name = accounts.find(a => a.account_code === r.account_code)?.account_name ?? '(삭제된 계정)'
                const day = new Date(r.created_at).getDate()
                const cur = byAccount.get(r.account_code) ?? { name, total: 0, dates: [] }
                cur.total += r.amount
                cur.dates.push(`${day}일`)
                byAccount.set(r.account_code, cur)
              }
              const rows = [...byAccount.values()].sort((a, b) => b.total - a.total)
              return (
                <div
                  className="fixed z-50 pointer-events-none bg-white border border-gray-border rounded-xl shadow-lg px-3 py-2.5 text-[11px] min-w-[180px] max-w-[280px]"
                  style={barTooltip.x > window.innerWidth / 2
                    ? { right: window.innerWidth - barTooltip.x + 12, top: barTooltip.y - 8 }
                    : { left: barTooltip.x + 12, top: barTooltip.y - 8 }}
                >
                  <div className="font-bold text-ink mb-1.5">{barTooltip.monthIdx + 1}월 · {won(yearlyDeposits[barTooltip.monthIdx])} ({rows.length}개 과)</div>
                  {rows.length === 0 ? (
                    <div className="text-gray-text">선결제 내역 없음</div>
                  ) : (
                    <div className="space-y-1">
                      {rows.map(r => (
                        <div key={r.name} className="flex justify-between gap-2">
                          <span className="text-ink font-semibold truncate">{r.name}</span>
                          <span className="text-gray-text flex-shrink-0">{won(r.total)} · {r.dates.join(', ')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}
            <div className="flex mt-[6px]" style={{ width: 323 }}>
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="flex-1 text-center text-[10px] text-[#6A635E]">{i + 1}월</div>
              ))}
            </div>
          </div>

          {/* 주문 추이 — 선결제 추이와 **같은 모양**으로 바로 아래 둔다.
              "충전은 늘었는데 주문은 그대로"처럼 두 줄을 겹쳐 읽으라고 나란히 놓는 것이다.
              축(1~12월)과 막대 폭이 같아야 눈이 위아래로 바로 비교한다. */}
          <div className="relative bg-[#F2F2F2] rounded-[13px] mt-[13px]" style={{ padding: 13 }}>
            <div className="flex items-baseline justify-between">
              <div className="text-[15px] font-semibold text-[#2C261F]">주문 추이</div>
              <div className={`text-[11px] ${NUM_MUTED}`}>올해 {yearlyOrders.reduce((a, b) => a + b, 0)}건</div>
            </div>
            <div className="flex items-end mt-[13px]" style={{ width: 323, height: 51 }}>
              {yearlyOrders.map((n, i) => (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-center justify-end h-full px-[1px] cursor-default"
                  title={`${i + 1}월 ${n}건`}
                >
                  <div
                    className="w-full bg-[#8C8379] rounded-t-[2px]"
                    style={{ height: Math.max(2, (n / Math.max(1, ...yearlyOrders)) * 51) }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 계정유형 도넛 — 비율 높은 순으로 정렬해 범례도 위→아래, 도넛도 12시(위)부터 시계방향으로 큰 비율부터 */}
          {(() => {
            const typesSorted = [...customerTypes].sort((a, b) => (typeCounts[b] ?? 0) - (typeCounts[a] ?? 0))
            const colorOf = (i: number) => TYPE_DONUT_COLORS[i % TYPE_DONUT_COLORS.length]
            // 유형이 1개뿐이면 범례가 짧아 박스 높이가 도넛(top 28 + size 109)보다 작아져
            // 원그래프가 박스 아래로 삐져나왔다 — minHeight로 도넛이 들어갈 높이를 보장한다
            return (
              <div className="relative bg-[#F2F2F2] rounded-[13px]" style={{ padding: 13, minHeight: 150 }}>
                <div className="text-[15px] font-semibold text-[#2C261F]">계정유형</div>
                <div className="flex flex-col gap-[8px] mt-[19px]" style={{ width: 193 }}>
                  {typesSorted.filter(t => typeCounts[t]).map((t, i) => (
                    <div
                      key={t}
                      className="flex items-center gap-[3px] cursor-pointer"
                      onMouseEnter={e => setDonutTooltip({ type: t, x: e.clientX, y: e.clientY })}
                      onMouseMove={e => setDonutTooltip(cur => cur && { ...cur, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setDonutTooltip(null)}
                    >
                      <span className="w-[13px] h-[13px] rounded-full flex-shrink-0" style={{ backgroundColor: colorOf(i) }} />
                      <span className="text-[12px] text-[#2C261F] tracking-[-0.46px] whitespace-nowrap">
                        {TYPE_LABEL[t] ?? t} ({Math.round((typeCounts[t] / typeTotal) * 100)}%, {typeCounts[t]}팀)
                      </span>
                    </div>
                  ))}
                </div>
                <div className="absolute" style={{ right: 19, top: 28 }}>
                  <DonutChart size={109} strokeWidth={21} segments={typesSorted.map((t, i) => ({
                    pct: typeCounts[t] ? Math.round((typeCounts[t] / typeTotal) * 100) : 0,
                    color: colorOf(i),
                  }))} />
                </div>
                {donutTooltip && (() => {
                  const list = accounts.filter(a => a.account_type === donutTooltip.type)
                  return (
                    <div
                      className="fixed z-50 pointer-events-none bg-white border border-gray-border rounded-xl shadow-lg px-3 py-2.5 text-[11px] min-w-[180px] max-w-[280px]"
                      style={donutTooltip.x > window.innerWidth / 2
                        ? { right: window.innerWidth - donutTooltip.x + 12, top: donutTooltip.y - 8 }
                        : { left: donutTooltip.x + 12, top: donutTooltip.y - 8 }}
                    >
                      <div className="font-bold text-ink mb-1.5">{TYPE_LABEL[donutTooltip.type] ?? donutTooltip.type} · {list.length}팀</div>
                      <div className="space-y-1 max-h-[200px] overflow-y-auto">
                        {list.map(a => (
                          <div key={a.account_code} className="flex justify-between gap-2">
                            <span className="text-ink font-semibold truncate">{a.account_name}</span>
                            <span className="text-gray-text flex-shrink-0">{won(a.current_balance)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )
          })()}

          {/* 가장 많이 주문한 고객 (이번달 기준) — 위 계정유형 박스와, 그리고 제목과 1번 항목 사이를 더 띄움 */}
          <div className="flex flex-col gap-[16px] mt-[14px]">
            <div className="text-[15px] font-semibold text-[#2C261F] whitespace-nowrap">가장 많이 주문한 고객</div>
            {topOrderedAccounts.length === 0 ? (
              <div className="text-[10px] text-[#ADADAD] py-[13px]">이번달 주문한 고객이 없습니다.</div>
            ) : (
              <div className="space-y-[13px]">
                {topOrderedAccounts.map((acc, i) => (
                  <div key={acc.account_code} className="flex items-center gap-[10px]">
                    <span className={`w-[19px] h-[19px] rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0 ${
                      i === 0 ? 'bg-[#E8E4E2] text-[#8C8379]' : 'bg-[#E5E5E5] text-[#ADADAD]'
                    }`}>{i + 1}</span>
                    <span className={`text-[13px] ${i === 0 ? 'text-[#2C261F] font-medium' : 'text-[#6A635E]'}`}>
                      {acc.account_name} ({monthlyOrderCount[acc.account_code]}건)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
            </div>
          ) : (
            <CustomerDetailPanel
              storeId={storeId}
              selected={selected}
              accountOrders={accountOrders}
              deposits={deposits}
              members={members}
              registeredAdmins={registeredAdmins}
              memberCounts={memberCounts}
              phoneRevealed={phoneRevealed}
              setPhoneRevealed={setPhoneRevealed}
              detailTab={detailTab}
              setDetailTab={setDetailTab}
              onQr={() => setAccountQr(selected.account_code)}
              onOpenStatement={handleOpenStatement}
              showInactive={showInactive}
              onEdit={openEdit}
              onRestore={handleRestoreAccount}
              onResendAdmin={handleResendAdminRegistration}
              resendLoading={resendLoading}
            />
          )}
          </div>

          {/* 계정 추가 / 금액 충전 — 항상 사이드바 하단에 고정 */}
          <div className="flex-shrink-0 flex gap-[6px] px-[26px] py-[13px]">
            <button
              onClick={() => { if (accounts.filter(a => a.is_active !== false).length < PLAN_LIMITS[plan].accounts) setAddOpen(true) }}
              className="flex-1 bg-[#E8E4E2] text-[#6A635E] rounded-[13px] flex items-center justify-center text-[21px] font-medium"
              style={{ height: 64 }}
              title={accounts.filter(a => a.is_active !== false).length >= PLAN_LIMITS[plan].accounts
                ? `${PLAN_NAMES[plan]} 플랜 한도(${PLAN_LIMITS[plan].accounts === Infinity ? '무제한' : PLAN_LIMITS[plan].accounts}) 도달`
                : undefined}
            >
              계정 추가
            </button>
            <button
              onClick={() => {
                if (selected) { setChargeOpen(true) }
                else if (filtered.length === 1) { setSelected(filtered[0]); setChargeOpen(true) }
              }}
              disabled={!selected && filtered.length !== 1}
              className="flex-1 bg-[#2C261F] text-[#F9F9F9] rounded-[13px] flex items-center justify-center text-[21px] font-medium disabled:opacity-40"
              style={{ height: 64 }}
              title={selected || filtered.length === 1 ? undefined : '왼쪽 표에서 고객을 선택하거나 검색으로 한 명으로 좁혀주세요'}
            >
              금액 충전
            </button>
          </div>
        </div>
      </div>


      {/* ── 거래처 추가 모달 — scale 제거, FIGMA_SCALE로 고정 px 재계산 (메뉴 상세 모달과 동일 패턴) ── */}
      {addOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-[40px]" onClick={() => { setAddOpen(false); setAddDupAccount(null); setAddConfirm(false) }}>
          <div
            className="bg-[#FCFCFC] rounded-[20px] shadow-2xl max-h-[85vh] flex flex-col overflow-hidden"
            style={{ width: 900 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex-shrink-0 px-[62px] pt-[39px] pb-[15px]">
              <h2 className="text-[26px] font-semibold text-ink">계정 추가</h2>
            </div>

            <div className="overflow-y-auto flex-1 px-[62px] pb-[26px]">
              <CustFormField label="선결제 계정이름">
                <input
                  value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value.slice(0, 50) }))}
                  maxLength={50} placeholder="ex) 구청 공원녹지과" className={CUST_INPUT_CLS}
                />
              </CustFormField>

              <CustFormField label="계정 유형">
                <div className="flex gap-[6px] flex-wrap">
                  {customerTypes.map(t => (
                    <button key={t} onClick={() => setNewForm(f => ({ ...f, type: t }))}
                      className={`px-[10px] py-[7px] rounded-[8px] text-[13px] font-semibold whitespace-nowrap transition-colors ${
                        newForm.type === t ? 'bg-[#D7D2CE] text-[#2C261F]' : 'bg-[#F2F2F2] text-[#787878]'
                      }`}>
                      {TYPE_LABEL[t] ?? t}
                    </button>
                  ))}
                </div>
              </CustFormField>

              <CustFormField label="선결제 유효기간">
                <div className="flex gap-[6px]">
                  {PREPAY_VALIDITY_OPTIONS.map(v => (
                    <button key={v} onClick={() => setNewForm(f => ({ ...f, prepayValidity: v }))}
                      className={`px-[10px] py-[7px] rounded-[8px] text-[13px] font-semibold whitespace-nowrap transition-colors ${
                        newForm.prepayValidity === v ? 'bg-[#D7D2CE] text-[#2C261F]' : 'bg-[#F2F2F2] text-[#787878]'
                      }`}>
                      {PREPAY_VALIDITY_LABEL[v]}
                    </button>
                  ))}
                </div>
              </CustFormField>

              <CustFormField label="관리자 이름">
                <input value={newForm.manager} onChange={e => setNewForm(f => ({ ...f, manager: e.target.value }))} className={CUST_INPUT_CLS} />
              </CustFormField>

              <CustFormField label="관리자 연락처">
                <input
                  value={newForm.phone}
                  onChange={e => { setNewForm(f => ({ ...f, phone: formatPhone(e.target.value) })); setAddDupAccount(null); setAddPhoneError(''); setAddConfirm(false) }}
                  inputMode="numeric" placeholder="010-0000-0000" className={CUST_INPUT_CLS}
                />
                {addPhoneError && <p className="text-[12px] text-danger font-semibold mt-[8px]">{addPhoneError}</p>}
                {addDupAccount && (
                  <div className="mt-[10px] px-[15px] py-[13px] rounded-[10px] bg-orange-50 border border-orange-200">
                    <p className="text-[13px] font-semibold text-orange-700 mb-[10px]">
                      이 번호로 등록된 계정이 있어요: {addDupAccount.account_name}
                    </p>
                    <div className="flex gap-[8px]">
                      <button
                        onClick={goChargeExistingAccount}
                        className="flex-1 py-[11px] rounded-[10px] text-[14px] font-semibold bg-white border border-orange-300 text-orange-700 hover:bg-orange-100 transition-colors"
                      >
                        기존 계정에 충전하기
                      </button>
                      <button
                        onClick={() => { setAddDupAccount(null); setAddConfirm(true) }}
                        className="flex-1 py-[11px] rounded-[10px] text-[14px] font-semibold bg-orange-600 text-white hover:bg-orange-700 transition-colors"
                      >
                        그래도 신규로 만들기
                      </button>
                    </div>
                  </div>
                )}
              </CustFormField>

              <CustFormField label="PIN 번호 (4자리, 선결제 주문시 사용)">
                <PinField
                  value={newForm.pin}
                  onChange={v => { setNewForm(f => ({ ...f, pin: v })); setAddPinError('') }}
                  placeholder="ex) 자주쓰는 4자리번호"
                  className={CUST_INPUT_CLS + ' font-mono tracking-[4px]'}
                />
                {addPinError && <p className="text-[12px] text-danger font-semibold mt-[8px]">{addPinError}</p>}
              </CustFormField>

              <CustFormField label="선결제 금액">
                <div className="field-wrap flex items-center border border-[#D9D9D9] rounded-[10px] px-[14px] py-[11px]">
                  <input
                    value={newForm.initialDeposit}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9-]/g, '')
                      const cleaned = raw.startsWith('-') ? '-' + raw.slice(1).replace(/-/g, '') : raw.replace(/-/g, '')
                      setNewForm(f => ({ ...f, initialDeposit: cleaned }))
                    }}
                    inputMode="numeric" placeholder="0" className="field-bare flex-1 outline-none text-[14px] text-ink"
                  />
                  <span className="text-[14px] text-ink">원</span>
                </div>
                {/* 양수일 때의 '잔액 N원'은 뺐다 — 방금 친 숫자를 바로 아래에서 한 번 더
                    읽어주는 것뿐이라 아무 말도 하지 않는다.
                    음수는 남긴다. 마이너스를 치면 '미수금'이 된다는 건 숫자만 봐선 모른다. */}
                {(() => {
                  const v = parseInt(newForm.initialDeposit.replace(/,/g, ''), 10)
                  if (!newForm.initialDeposit || isNaN(v) || v >= 0) return null
                  return (
                    <p className="text-[13px] font-semibold mt-[8px] text-danger">
                      미수금 -{won(Math.abs(v))}
                    </p>
                  )
                })()}
              </CustFormField>

              <CustFormField label="비고">
                <input value={newForm.initialDepositMemo} onChange={e => setNewForm(f => ({ ...f, initialDepositMemo: e.target.value }))} placeholder="ex) 6월 선결제" className={CUST_INPUT_CLS} />
              </CustFormField>

              {addConfirm && (
                <div className="mt-[13px] px-[15px] py-[13px] rounded-[10px] bg-green-soft border border-green/30">
                  <p className="text-[14px] font-semibold text-ink mb-[10px]">
                    {newForm.manager} {newForm.phone}로 관리자 등록 링크가 발송됩니다
                  </p>
                  <div className="flex gap-[8px]">
                    <button
                      onClick={() => setAddConfirm(false)}
                      disabled={addSubmitting}
                      className="flex-1 py-[11px] rounded-[10px] text-[14px] font-semibold bg-white border border-gray-border text-gray-text hover:bg-gray-bg transition-colors disabled:opacity-50"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleAddAccount}
                      disabled={addSubmitting}
                      className="flex-1 py-[11px] rounded-[10px] text-[14px] font-semibold bg-green text-white hover:bg-green/90 transition-colors disabled:opacity-50"
                    >
                      {addSubmitting ? '등록 중...' : '확인'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-[10px] px-[62px] py-[20px] border-t border-[#ADADAD]/30 flex-shrink-0">
              <button onClick={() => { setAddOpen(false); setAddDupAccount(null); setAddConfirm(false) }} className="px-[28px] py-[13px] rounded-[10px] bg-[#E8E4E2] text-[#6A635E] text-[15px] font-semibold hover:opacity-90 transition-opacity">
                닫기
              </button>
              <button
                onClick={openAddConfirm}
                disabled={
                  !newForm.name.trim() ||
                  !newForm.manager.trim() ||
                  !isValidManagerPhone(newForm.phone.trim()) ||
                  newForm.pin.length !== 4 ||
                  !newForm.initialDeposit ||
                  parseInt(newForm.initialDeposit.replace(/,/g, ''), 10) === 0
                }
                className="px-[28px] py-[13px] rounded-[10px] bg-ink text-white text-[15px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 정보 수정 모달 — 계정 추가 모달과 같은 디자인 시스템(900px · #FCFCFC · CustFormField) ── */}
      {editOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-[40px]" onClick={() => { setEditOpen(false); setEditPinError('') }}>
          <div
            className="modal-in bg-[#FCFCFC] rounded-[20px] shadow-2xl max-h-[85vh] flex flex-col overflow-hidden"
            style={{ width: 900 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex-shrink-0 px-[62px] pt-[39px] pb-[15px]">
              <h2 className="text-[26px] font-semibold text-ink">계정정보 수정</h2>
            </div>

            <div className="overflow-y-auto flex-1 px-[62px] pb-[26px]">
              <CustFormField label="선결제 계정이름">
                <div className="relative">
                  <input
                    value={editForm.name}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value.slice(0, 50) }))}
                    maxLength={50} className={CUST_INPUT_CLS}
                  />
                  <span className={`absolute right-[14px] bottom-[11px] text-[11px] ${editForm.name.length >= 50 ? 'text-danger' : 'text-[#ADADAD]'}`}>
                    {editForm.name.length}/50
                  </span>
                </div>
              </CustFormField>

              <CustFormField label="계정 유형">
                <div className="flex gap-[6px] flex-wrap">
                  {customerTypes.map(t => (
                    <button key={t} onClick={() => setEditForm(f => ({ ...f, type: t }))}
                      className={`px-[10px] py-[7px] rounded-[8px] text-[13px] font-semibold whitespace-nowrap transition-colors ${
                        editForm.type === t ? 'bg-[#D7D2CE] text-[#2C261F]' : 'bg-[#F2F2F2] text-[#787878]'
                      }`}>
                      {TYPE_LABEL[t] ?? t}
                    </button>
                  ))}
                </div>
              </CustFormField>

              <CustFormField label="선결제 유효기간">
                <div className="flex gap-[6px]">
                  {PREPAY_VALIDITY_OPTIONS.map(v => (
                    <button key={v} onClick={() => setEditForm(f => ({ ...f, prepayValidity: v }))}
                      className={`px-[10px] py-[7px] rounded-[8px] text-[13px] font-semibold whitespace-nowrap transition-colors ${
                        editForm.prepayValidity === v ? 'bg-[#D7D2CE] text-[#2C261F]' : 'bg-[#F2F2F2] text-[#787878]'
                      }`}>
                      {PREPAY_VALIDITY_LABEL[v]}
                    </button>
                  ))}
                </div>
              </CustFormField>

              <CustFormField label="관리자 이름">
                <MaskedField
                  value={editForm.manager}
                  masked={maskName(editForm.manager)}
                  onChange={v => setEditForm(f => ({ ...f, manager: v }))}
                  placeholder="ex) 김민수"
                />
              </CustFormField>

              <CustFormField label="관리자 연락처">
                <MaskedField
                  value={editForm.phone}
                  masked={maskPhone(editForm.phone)}
                  onChange={v => setEditForm(f => ({ ...f, phone: formatPhone(v) }))}
                  placeholder="010-0000-0000"
                  inputMode="numeric"
                />
              </CustFormField>

              <CustFormField label="PIN 번호 (4자리)">
                <PinField
                  value={editForm.pin}
                  onChange={v => { setEditForm(f => ({ ...f, pin: v })); setEditPinError('') }}
                  className={CUST_INPUT_CLS + ' font-mono tracking-[4px]'}
                />
                {editPinError && <p className="text-[12px] text-danger font-semibold mt-[6px]">{editPinError}</p>}
              </CustFormField>

              <CustFormField label="선결제 잔액">
                <div className={`w-full border border-[#D9D9D9] rounded-[10px] px-[14px] py-[11px] text-[14px] font-semibold bg-[#F2F2F2] ${selected.current_balance < 0 ? 'text-danger' : 'text-ink'}`}>
                  {won(selected.current_balance)}
                </div>
                <p className="text-[12px] text-[#ADADAD] mt-[6px]">잔액은 여기서 못 바꿔요. 금액 충전으로 올리거나 문의해 주세요</p>

                {/* 계정 비활성화 — Figma 491:2391(메뉴 상세 모달 '삭제')과 같은 속성.
                    되돌리기 어려운 동작이라 하단 CTA 줄이 아니라 본문 끝에 두고 한 번 더 묻는다. */}
                {editDeactivateConfirm ? (
                  <div className="mt-[52px] flex items-center gap-[9px]">
                    <span className="text-[13px] text-[#FF676F]">비활성화하면 복구 전까지 목록에서 안 보여요</span>
                    <button
                      onClick={handleDeleteAccount}
                      className="h-[50px] px-[26px] rounded-[13px] bg-[#FF676F] text-white text-[16px] font-medium hover:brightness-95 transition-all"
                    >
                      확인
                    </button>
                    <button
                      onClick={() => setEditDeactivateConfirm(false)}
                      className="h-[50px] px-[26px] rounded-[13px] bg-[#F2F2F2] text-[#787878] text-[16px] font-medium hover:brightness-95 transition-all"
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setEditDeactivateConfirm(true)}
                    className="mt-[52px] h-[50px] px-[26px] rounded-[13px] bg-[#FFEFEF] text-[#FF676F] text-[16px] font-medium hover:brightness-95 transition-all"
                  >
                    비활성화
                  </button>
                )}
              </CustFormField>
            </div>

            <div className="flex-shrink-0 flex items-center px-[62px] pt-[18px] pb-[32px] border-t border-[#E8E4E2]">
              <div className="flex items-center gap-[10px] ml-auto">
              <button
                onClick={() => { setEditOpen(false); setEditPinError('') }}
                className="px-[28px] py-[13px] rounded-[10px] bg-[#E8E4E2] text-[#6A635E] text-[15px] font-semibold hover:opacity-90 transition-opacity"
              >
                취소
              </button>
              <button
                onClick={handleEditAccount}
                disabled={!editForm.name.trim() || !editForm.manager.trim() || editForm.pin.length !== 4}
                className="px-[28px] py-[13px] rounded-[10px] bg-ink text-white text-[15px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                저장
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 프린터 오류 토스트 ── */}
      {printerToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-ink text-white text-[13px] font-semibold px-5 py-3 rounded-xl shadow-lg pointer-events-none">
          {printerToast}
        </div>
      )}

      {/* ── 키오스크 QR 모달 ── */}
      {kioskQr && <KioskQrModal storeId={storeId} onClose={() => setKioskQr(false)} />}

      {/* ── 거래처 고유 QR 모달 ── */}
      {accountQr && (
        <AccountQrModal
          accountCode={accountQr}
          accountName={accounts.find(a => a.account_code === accountQr)?.account_name ?? ''}
          qrSystem={accounts.find(a => a.account_code === accountQr)?.qr_system ?? 'legacy'}
          storeId={storeId}
          onClose={() => setAccountQr(null)}
        />
      )}

      {/* ── 충전 등록 모달 — scale 제거, FIGMA_SCALE로 고정 px 재계산 ── */}
      {chargeOpen && selected && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-[40px]" onClick={() => { setChargeOpen(false); setChargeError('') }}>
          <div
            className="bg-[#FCFCFC] rounded-[20px] shadow-2xl max-h-[85vh] flex flex-col overflow-hidden"
            style={{ width: 900 }}
            onClick={e => e.stopPropagation()}
          >
            {!chargeConfirm ? (
              <>
                <div className="flex-shrink-0 px-[62px] pt-[39px] pb-[15px]">
                  <h2 className="text-[26px] font-semibold text-ink">선결제 충전</h2>
                  <p className="text-[13px] text-[#6A635E] mt-[5px]">{selected.account_name}</p>
                </div>

                <div className="overflow-y-auto flex-1 px-[62px] pb-[26px]">
                  <CustFormField label="충전 금액">
                    <div className="field-wrap flex items-center border border-[#ADADAD] rounded-[10px] px-[19px] py-[17px]">
                      <input
                        value={chargeAmt ? Number(chargeAmt).toLocaleString('ko-KR') : ''}
                        onChange={e => setChargeAmt(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="0" inputMode="numeric"
                        className="field-bare flex-1 outline-none text-[18px] font-semibold text-ink"
                      />
                      <span className="text-[18px] text-ink">원</span>
                    </div>
                  </CustFormField>

                  <CustFormField label="결제수단">
                    <div className="flex flex-wrap gap-[6px]">
                      {(['신용카드','법인카드','계좌이체','무통장입금','현금','기타']).map(m => (
                        <button key={m} onClick={() => setChargeMethod(m)}
                          className={`px-[13px] py-[8px] rounded-[10px] text-[15px] font-medium whitespace-nowrap transition-colors ${
                            chargeMethod === m ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878]'
                          }`}>
                          {m}
                        </button>
                      ))}
                    </div>
                  </CustFormField>

                  <CustFormField label="선결제 일시 (실제 결제한 날짜·시간)">
                    <div className="flex gap-[8px]">
                      <input type="date" value={chargeDate} onChange={e => setChargeDate(e.target.value)}
                        max={new Date().toLocaleDateString('en-CA')}
                        className={CUST_INPUT_CLS} />
                      <input type="time" value={chargeTime} onChange={e => setChargeTime(e.target.value)}
                        className={`${CUST_INPUT_CLS} w-[167px] flex-shrink-0`} />
                    </div>
                  </CustFormField>

                  <CustFormField label="비고 (선택)">
                    <input value={chargeMemo} onChange={e => setChargeMemo(e.target.value)}
                      placeholder="예: 7월 법인카드" className={CUST_INPUT_CLS} />
                  </CustFormField>
                </div>

                <div className="flex items-center justify-end gap-[9px] px-[62px] py-[15px] border-t border-[#ADADAD]/30 flex-shrink-0">
                  <button onClick={() => { setChargeOpen(false); setChargeError('') }}
                    className="px-[21px] py-[10px] rounded-[9px] bg-[#E8E4E2] text-[#6A635E] text-[12px] font-semibold hover:opacity-90 transition-opacity">
                    취소
                  </button>
                  <button
                    onClick={() => setChargeConfirm(true)}
                    disabled={!chargeAmt || parseInt(chargeAmt) <= 0}
                    className="px-[21px] py-[10px] rounded-[9px] bg-ink text-white text-[12px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40">
                    다음
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex-shrink-0 px-[62px] pt-[39px] pb-[15px]">
                  <h2 className="text-[26px] font-semibold text-ink">충전 내용 확인</h2>
                  <p className="text-[12px] text-[#6A635E] mt-[5px]">등록 후 금액 수정은 불가합니다. 내용을 꼼꼼히 확인해주세요.</p>
                </div>

                <div className="overflow-y-auto flex-1 px-[62px] pb-[26px]">
                  <div className="bg-[#F2F2F2] rounded-[13px] p-[18px] space-y-[10px]">
                    <div className="flex justify-between items-center">
                      <span className="text-[12px] text-[#6A635E]">고객</span>
                      <span className="text-[13px] font-bold text-ink">{selected.account_name}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-[#D9D9D9] pt-[10px]">
                      <span className="text-[12px] text-[#6A635E]">충전 금액</span>
                      <span className="text-[17px] font-extrabold text-ink">+{won(parseInt(chargeAmt))}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-[#D9D9D9] pt-[10px]">
                      <span className="text-[12px] text-[#6A635E]">결제수단</span>
                      <span className="text-[12px] font-semibold text-ink">{chargeMethod}</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-[#D9D9D9] pt-[10px]">
                      <span className="text-[12px] text-[#6A635E]">선결제 일시</span>
                      <span className="text-[12px] font-semibold text-ink">{chargeDate} {chargeTime}</span>
                    </div>
                    {chargeMemo && (
                      <div className="flex justify-between items-center border-t border-[#D9D9D9] pt-[10px]">
                        <span className="text-[12px] text-[#6A635E]">비고</span>
                        <span className="text-[12px] font-semibold text-ink">{chargeMemo}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center border-t border-[#D9D9D9] pt-[10px]">
                      <span className="text-[12px] text-[#6A635E]">충전 후 잔액</span>
                      <span className="text-[13px] font-bold text-ink">{won(selected.current_balance + parseInt(chargeAmt))}</span>
                    </div>
                  </div>

                  {chargeError && (
                    <p className="text-[10px] text-danger font-semibold mt-[10px]">{chargeError}</p>
                  )}
                </div>

                <div className="flex items-center justify-end gap-[9px] px-[62px] py-[15px] border-t border-[#ADADAD]/30 flex-shrink-0">
                  <button onClick={() => { setChargeConfirm(false); setChargeError('') }}
                    className="px-[21px] py-[10px] rounded-[9px] bg-[#E8E4E2] text-[#6A635E] text-[12px] font-semibold hover:opacity-90 transition-opacity">
                    취소
                  </button>
                  <button
                    onClick={handleCharge}
                    disabled={chargeLoading}
                    className="px-[21px] py-[10px] rounded-[9px] bg-ink text-white text-[12px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40">
                    {chargeLoading ? '처리 중...' : '충전 확정'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── 이용내역서 모달 (월별 선결제·사용내역 표 + CSV 다운로드) ── */}
      {statementOpen && selected && (() => {
        const rows = buildStmtRows()
        const fmtRowDate = (iso: string) => {
          const d = new Date(iso)
          return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        }
        return (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-[40px]" onClick={() => setStatementOpen(false)}>
            <div
              className="bg-[#FCFCFC] rounded-[20px] shadow-2xl max-h-[85vh] flex flex-col overflow-hidden"
              style={{ width: 1030 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex-shrink-0 px-[41px] pt-[31px] pb-[15px]">
                <div className="flex items-center justify-between">
                  <h2 className="text-[21px] font-medium text-ink">이용내역서</h2>
                  <span className="text-[12px] text-[#6A635E]">{selected.account_name}</span>
                </div>
                <div className="flex items-center justify-between mt-[13px]">
                  <div className="flex items-center gap-[5px]">
                    <button onClick={prevStmtMonth} disabled={stmtAllTime}
                      className="px-[8px] py-[5px] text-[10px] font-bold rounded-lg border border-gray-border text-gray-text disabled:opacity-30 hover:bg-gray-bg">‹</button>
                    <span className="text-[10px] font-semibold w-[64px] text-center">{stmtAllTime ? '전체 기간' : stmtMonth}</span>
                    <button onClick={nextStmtMonth} disabled={stmtAllTime}
                      className="px-[8px] py-[5px] text-[10px] font-bold rounded-lg border border-gray-border text-gray-text disabled:opacity-30 hover:bg-gray-bg">›</button>
                    <button
                      onClick={() => setStmtAllTime(v => !v)}
                      className={`ml-[5px] text-[9px] font-bold px-[9px] py-[4px] rounded-full border transition-colors ${
                        stmtAllTime ? 'border-green bg-green-soft text-green' : 'border-gray-border text-gray-text hover:bg-gray-bg'
                      }`}
                    >
                      전체 기간
                    </button>
                  </div>
                  {/* 9px 굵은 글씨라 모달에서 거의 안 보였다. 이 모달에 들어온 목적이
                      '내역을 받아가는 것'인데 그 버튼이 가장 작았다. */}
                  <button onClick={downloadCSV} className="pressable h-[36px] px-[16px] rounded-[9px] bg-[#2C261F] text-[#FCFCFC] text-[13px] font-medium hover:opacity-90 transition-opacity flex items-center gap-[6px]">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path d="M8 2v8m0 0 3-3m-3 3L5 7M3 13h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    CSV 다운로드
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto flex-1 px-[41px] pb-[26px]">
                {stmtLoading ? (
                  <LoadingBlock py={40} size={34} />
                ) : (
                  <table className="text-[12px] border-collapse w-full">
                    <thead>
                      <tr className="bg-gray-bg text-[10px] font-bold text-gray-text uppercase">
                        <th colSpan={3} className="text-left py-[8px] border border-gray-border px-[8px]">선결제내역</th>
                        <th colSpan={5} className="text-left py-[8px] border border-gray-border px-[8px]">사용내역</th>
                        <th rowSpan={2} className="text-left py-[8px] border border-gray-border px-[8px] whitespace-nowrap">잔액</th>
                      </tr>
                      <tr className="bg-gray-bg text-[10px] font-semibold text-gray-text">
                        <th className="py-[6px] px-[8px] border border-gray-border text-left whitespace-nowrap">일자</th>
                        <th className="py-[6px] px-[8px] border border-gray-border text-left whitespace-nowrap">금액</th>
                        <th className="py-[6px] px-[8px] border border-gray-border text-left">기타</th>
                        <th className="py-[6px] px-[8px] border border-gray-border text-left whitespace-nowrap">일자</th>
                        <th className="py-[6px] px-[8px] border border-gray-border text-left whitespace-nowrap">금액</th>
                        <th className="py-[6px] px-[8px] border border-gray-border text-left">내역</th>
                        <th className="py-[6px] px-[8px] border border-gray-border text-left">비고</th>
                        <th className="py-[6px] px-[8px] border border-gray-border text-left">서명</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr><td colSpan={9} className="text-center py-[24px] text-gray-text text-[13px]">내역 없음</td></tr>
                      ) : rows.map((row, idx) => {
                        if (row.type === 'adjustment') {
                          return (
                            <tr key={idx} className="bg-orange-50">
                              <td className="py-[6px] px-[8px] border border-gray-border text-orange-600 font-medium whitespace-nowrap">
                                <div className="text-[9px] font-bold bg-orange-100 text-orange-600 px-[4px] py-[2px] rounded mb-[2px] w-fit">잔액조정</div>
                                {fmtRowDate(row.date)}
                              </td>
                              <td className="py-[6px] px-[8px] border border-gray-border text-right font-bold whitespace-nowrap" style={{ color: row.amount >= 0 ? 'var(--green)' : 'var(--danger)' }}>
                                {row.amount >= 0 ? `+${won(row.amount)}` : `-${won(Math.abs(row.amount))}`}
                              </td>
                              <td className="py-[6px] px-[8px] border border-gray-border" />
                              <td className="py-[6px] px-[8px] border border-gray-border" />
                              <td className="py-[6px] px-[8px] border border-gray-border" />
                              <td className="py-[6px] px-[8px] border border-gray-border text-gray-text text-[10px] break-words">{row.reason || '—'}</td>
                              <td className="py-[6px] px-[8px] border border-gray-border text-gray-text text-[10px]">
                                <span className="whitespace-nowrap">{won(row.balanceBefore)}</span>
                                <span className="text-gray-text mx-[2px]">→</span>
                                <span className="whitespace-nowrap">{won(row.balanceAfter)}</span>
                              </td>
                              <td className="py-[6px] px-[8px] border border-gray-border text-gray-text text-[10px]">{row.orderer ?? ''}</td>
                              <td className="py-[6px] px-[8px] border border-gray-border text-right font-bold" style={{ color: row.balanceAfter < 0 ? 'var(--danger)' : 'inherit' }}>
                                {won(row.balanceAfter)}
                              </td>
                            </tr>
                          )
                        } else if (row.type === 'deposit') {
                          return (
                            <tr key={idx} className="hover:bg-green-soft/20 transition-colors">
                              <td className="py-[6px] px-[8px] border border-gray-border text-green font-medium whitespace-nowrap">{fmtRowDate(row.date)}</td>
                              <td className="py-[6px] px-[8px] border border-gray-border text-right font-bold whitespace-nowrap" style={{ color: row.amount < 0 ? 'var(--danger)' : 'var(--green)' }}>
                                {row.amount < 0 ? `-${won(Math.abs(row.amount))}` : `+${won(row.amount)}`}
                              </td>
                              <td className="py-[6px] px-[8px] border border-gray-border text-gray-text">{row.paymentMethod}</td>
                              <td className="py-[6px] px-[8px] border border-gray-border" />
                              <td className="py-[6px] px-[8px] border border-gray-border" />
                              <td className="py-[6px] px-[8px] border border-gray-border" />
                              <td className="py-[6px] px-[8px] border border-gray-border" />
                              <td className="py-[6px] px-[8px] border border-gray-border" />
                              <td className="py-[6px] px-[8px] border border-gray-border text-right font-bold text-green">{won(row.balanceAfter)}</td>
                            </tr>
                          )
                        } else {
                          return (
                            <tr key={idx} className={`transition-colors ${row.discrepancy ? 'bg-red-50' : 'hover:bg-gray-bg/60'}`}>
                              <td className="py-[6px] px-[8px] border border-gray-border" />
                              <td className="py-[6px] px-[8px] border border-gray-border" />
                              <td className="py-[6px] px-[8px] border border-gray-border" />
                              <td className="py-[6px] px-[8px] border border-gray-border text-gray-text whitespace-nowrap">{fmtRowDate(row.date)}</td>
                              <td className="py-[6px] px-[8px] border border-gray-border text-right font-medium text-ink whitespace-nowrap">-{won(row.amount)}</td>
                              <td className="py-[6px] px-[8px] border border-gray-border text-ink break-words">{row.summary}</td>
                              <td className="py-[6px] px-[8px] border border-gray-border text-gray-text break-words">{row.note}</td>
                              <td className="py-[6px] px-[8px] border border-gray-border text-gray-text">{row.orderer}</td>
                              <td className="py-[6px] px-[8px] border border-gray-border text-right font-medium">
                                <span style={{ color: row.balanceAfter < 0 ? 'var(--danger)' : 'inherit' }}>{won(row.balanceAfter)}</span>
                                {/* 앞 행 잔액 + 충전 − 주문금액 과 실제 스냅샷이 어긋난 경우 —
                                     주문 외 경로로 잔액이 바뀌었다는 뜻이라 조용히 넘기지 않고 표시한다 */}
                                {row.discrepancy !== undefined && (
                                  <div className="mt-[2px] text-[9px] font-bold text-danger whitespace-nowrap" title="이 주문 직전에 주문·충전·조정 기록 없이 잔액이 바뀌었습니다">
                                    ⚠️ 기록 없는 잔액 변동 {row.discrepancy > 0 ? `+${won(row.discrepancy)}` : `-${won(Math.abs(row.discrepancy))}`}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        }
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="flex items-center justify-end px-[41px] py-[13px] border-t border-[#ADADAD]/30 flex-shrink-0">
                <button onClick={() => setStatementOpen(false)} className="px-[18px] py-[9px] rounded-[8px] bg-[#E8E4E2] text-[#6A635E] text-[10px] font-semibold hover:opacity-90 transition-opacity">
                  닫기
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── 다운그레이드 안내 모달 ── */}
      {downgradeModal && (() => {
        const { targetPlan, nextBillingDate } = downgradeModal
        const targetName = ({ free:'무료', basic:'베이직', pro:'프로', max:'맥스' } as Record<string,string>)[targetPlan]
        const dateStr = `${nextBillingDate.getMonth() + 1}월 ${nextBillingDate.getDate()}일`
        return (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setDowngradeModal(null)}>
            <div className="modal-in bg-white rounded-2xl p-8 w-[460px] shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="text-[18px] font-semibold text-ink mb-2">플랜 변경 안내</div>
              <p className="text-[13px] text-gray-text leading-relaxed mb-5">
                활성 고객 수가 줄어서 <strong className="text-ink">{targetName} 플랜</strong>으로 변경할 수 있어요.<br />
                다음 결제일 <strong className="text-ink">{dateStr}</strong>부터 적용되며, 그 전까지는 현재 플랜이 유지됩니다.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => scheduleDowngrade(targetPlan)}
                  className="w-full py-3 rounded-xl bg-ink text-white font-bold text-[13px] hover:bg-ink/90 transition-colors"
                >
                  {dateStr}부터 {targetName}으로 변경
                </button>
                <button
                  onClick={() => applyDowngradeNow(targetPlan)}
                  className="w-full py-3 rounded-xl border border-gray-border text-ink font-semibold text-[13px] hover:bg-gray-bg transition-colors"
                >
                  지금 즉시 변경
                </button>
                <button
                  onClick={() => setDowngradeModal(null)}
                  className="w-full py-2.5 text-gray-text text-[12px] hover:text-ink transition-colors"
                >
                  현재 플랜 유지
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// 우측 사이드 패널 — 고객 선택 시 "고객현황" 집계 대신 해당 고객 상세정보로 전환 (Figma node 644:372)
function CustomerDetailPanel({
  selected, accountOrders, deposits, members, registeredAdmins, memberCounts,
  phoneRevealed, setPhoneRevealed, detailTab, setDetailTab, onQr, onOpenStatement,
  showInactive, onEdit, onRestore, onResendAdmin, resendLoading, storeId,
}: {
  selected: DbAccount
  storeId: string
  accountOrders: Order[]
  deposits: DbDeposit[]
  members: { id: string; name: string; phone: string | null; order_count: number; last_ordered_at: string | null }[]
  registeredAdmins: Set<string>
  memberCounts: Record<string, number>
  phoneRevealed: boolean
  setPhoneRevealed: (v: boolean | ((prev: boolean) => boolean)) => void
  detailTab: 'orders' | 'charges' | 'members' | 'statement' | 'people'
  setDetailTab: (t: 'orders' | 'charges' | 'members' | 'statement' | 'people') => void
  onQr: () => void
  onOpenStatement: () => void
  showInactive: boolean
  onEdit: () => void
  onRestore: () => void
  onResendAdmin: () => void
  resendLoading: boolean
}) {
  /** 구성원을 눌러 펼쳐 볼 손님 — 고객 현황에서 쓰는 모달과 같은 것 */
  const [profileOf, setProfileOf] = useState<{ name: string; code: string; account: string } | null>(null)

  // 이 계정의 관리자 이름 — 구성원 목록에 왕관을 달기 위해.
  // account_members 에 역할 컬럼이 없어서 이름으로 맞춘다(카카오 닉네임 = 구성원 이름일 때만).
  const [adminNames, setAdminNames] = useState<Set<string>>(new Set())
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await supabase.rpc('account_admin_names', { p_account_code: selected.account_code })
      if (cancelled) return
      setAdminNames(new Set(((data ?? []) as { name: string }[]).map(r => r.name)))
    })()
    return () => { cancelled = true }
  }, [selected.account_code])

  const phoneParts = (selected.contact_phone ?? '').split('-')
  const phoneMid = phoneParts.length === 3 ? phoneParts[1] : null

  // 모든 px는 Figma 원본(2240 캔버스) 수치 × FIGMA_SCALE — src/lib/figma-scale.ts 참고.
  // 헤더(이름/연락처/통계/탭)는 flex-shrink-0로 고정, 탭 내용만 flex-1 overflow-y-auto로 스크롤.
  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 flex flex-col gap-[13px] px-[26px] pt-[26px]">
        {/* 제목 + 액션 버튼 — 긴 계정명이 버튼과 겹치지 않도록 한 줄 flex, 제목은 말줄임 */}
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-[21px] font-medium text-ink truncate">{selected.account_name}</span>
          </div>
          <div className="flex-shrink-0 flex items-center gap-[6px]">
            <button onClick={onEdit} className="bg-[#F2F2F2] rounded-[8px] px-[9px] py-[6px] text-[10px] font-medium text-[#787878] whitespace-nowrap hover:bg-[#E5E5E5] transition-colors">수정</button>
            <button onClick={onOpenStatement} className="bg-[#F2F2F2] rounded-[8px] px-[9px] py-[6px] text-[10px] font-medium text-[#787878] whitespace-nowrap hover:bg-[#E5E5E5] transition-colors">이용내역서</button>
            <button onClick={onQr} className="bg-[#F2F2F2] rounded-[8px] px-[9px] py-[6px] text-[10px] font-medium text-[#787878] whitespace-nowrap hover:bg-[#E5E5E5] transition-colors">QR보기</button>
          </div>
        </div>

        <div className="flex items-center gap-[10px] text-[14px] font-medium text-[#414141]">
          <span className="truncate">{selected.contact_person ? maskName(selected.contact_person) : '-'}</span>
          {selected.qr_system === 'kakao' && !registeredAdmins.has(selected.account_code) && (
            <PillTag label="등록대기" />
          )}
          <span className="flex-shrink-0 w-[1px] h-[17px] bg-[#414141]" />
          {selected.contact_phone ? (
            <span className="flex-shrink-0 flex items-center gap-[5px]">
              <span>{phoneParts[0]}-</span>
              {phoneMid && (
                <button
                  onClick={() => setPhoneRevealed(v => !v)}
                  className="flex items-center gap-[4px] border border-[#D9D9D9] rounded-[6px] px-[6px] py-[3px] text-[#414141]"
                >
                  <span className="font-mono text-[10px]">{phoneRevealed ? phoneMid : '••••'}</span>
                  <EyeIcon off={phoneRevealed} size={11} />
                </button>
              )}
              <span>-{phoneParts[2] ?? ''}</span>
            </span>
          ) : (
            <span className="flex-shrink-0 text-[#ADADAD]">연락처 없음</span>
          )}
          <span className="flex-shrink-0 w-[1px] h-[17px] bg-[#414141]" />
          <span className="flex-shrink-0">{TYPE_LABEL[selected.account_type]}</span>
        </div>

        {!registeredAdmins.has(selected.account_code) && selected.qr_system === 'kakao' && (
          <button onClick={onResendAdmin} disabled={resendLoading} className="text-[9px] text-orange-600 hover:underline disabled:opacity-50 text-left -mt-[8px]">
            {resendLoading ? '발송 중...' : '📨 관리자 등록 문자 재발송'}
          </button>
        )}

        {/* 선결제잔액 / 이용자수 */}
        <div className="flex gap-[4px]">
          <StatCard className="bg-[#F2F2F2] rounded-[10px] flex-1" padding={10} gap={6}>
            <div className="text-[10px] font-medium text-[#2C261F] tracking-[-0.03em]">선결제 잔액</div>
            <div className={`text-[18px] font-medium whitespace-nowrap ${selected.current_balance < 0 ? 'text-danger' : 'text-[#2C261F]'}`}>
              {selected.current_balance < 0 ? `-${won(Math.abs(selected.current_balance))}` : won(selected.current_balance)}
            </div>
          </StatCard>
          <StatCard className="bg-[#F2F2F2] rounded-[10px] flex-1" padding={10} gap={6}>
            <div className="text-[10px] font-medium text-[#2C261F] tracking-[-0.03em]">이용자수</div>
            <div className="text-[17px] font-medium text-[#1E1E1E]">{memberCounts[selected.account_code] ?? 0}명</div>
          </StatCard>
        </div>

        {/* 선결제 유효기간 + 만료 경고, 계정 비활성화/복구 */}
        <div className="flex items-center justify-between">
          <span className={`text-[10px] ${isPrepayExpired(selected.prepay_validity, deposits[0]?.created_at) ? 'text-danger font-semibold' : 'text-[#6A635E]'}`}>
            {prepayValidityDisplay(selected.prepay_validity, deposits[0]?.created_at)}
          </span>
          {/* 계정 비활성화는 "계정정보 수정" 모달 하단으로 옮겼다 — 되돌리기 어려운 동작이
              목록 옆에 노출돼 있으면 잘못 누르기 쉽다. 여기엔 복구만 남긴다. */}
          {showInactive && (
            <button onClick={onRestore} className="text-[10px] font-semibold text-green hover:underline">비활성 계정 복구</button>
          )}
        </div>

        {/* 탭 */}
        <div className="flex items-center gap-[21px]">
          {([['orders', '주문내역'], ['charges', '충전이력'], ['members', '구성원']] as const).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setDetailTab(t)}
              className={`relative text-[14px] font-medium pb-[5px] transition-colors ${detailTab === t ? 'text-ink' : 'text-[#ADADAD]'}`}
            >
              {label}
              {detailTab === t && <span className="absolute left-0 bottom-0 w-full h-[2px] bg-[#414141]" />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-[26px] pt-[13px] pb-[26px]">
        {detailTab === 'orders' && (
          accountOrders.length === 0 ? (
            <div className="text-[10px] text-[#ADADAD] py-[13px]">주문 이력이 없습니다.</div>
          ) : (
            <div className="space-y-[8px]">
              {accountOrders.slice(0, 15).map(o => {
                const dt = new Date(o.createdAt)
                const dateStr = `${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
                return (
                  <div key={o.code} className="bg-[#F2F2F2] rounded-[10px] px-[13px] py-[10px]">
                    <div className="flex items-center justify-between mb-[5px]">
                      <span className="text-[9px] text-[#787878]">{dateStr} · {o.method}</span>
                      <div className="flex items-center gap-[5px]">
                        <StatusTag status={o.status} />
                        <span className="text-[10px] font-bold text-ink">{won(o.total)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-[4px] text-[9px] text-[#787878] mb-[5px]">
                      <RevealText value={o.orderer} masked={maskName(o.orderer)} iconSize={9} />
                      {o.phone && (
                        <>
                          <span>·</span>
                          <RevealText value={o.phone} masked={maskPhone(o.phone)} iconSize={9} />
                        </>
                      )}
                    </div>
                    <div className="space-y-[3px]">
                      {o.items.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-ink truncate">{item.qty > 1 ? `${item.name} ×${item.qty}` : item.name}</span>
                          <span className="text-ink flex-shrink-0">{won(item.price * item.qty)}</span>
                        </div>
                      ))}
                    </div>
                    {o.balanceAfter !== undefined && o.status !== '취소' && (
                      <div className="text-right text-[9px] text-[#6A635E] mt-[5px]">잔액 {won(o.balanceAfter)}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}

        {detailTab === 'charges' && (
          deposits.length === 0 ? (
            <div className="text-[10px] text-[#ADADAD] py-[13px]">충전 이력이 없습니다.</div>
          ) : (
            <div className="space-y-[8px]">
              {deposits.slice(0, 15).map(d => {
                const dt = new Date(d.created_at)
                const dateStr = `${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
                return (
                  <div key={d.deposit_id} className="bg-[#F2F2F2] rounded-[10px] px-[13px] py-[10px] flex items-center justify-between">
                    <div>
                      <div className="text-[10px] font-semibold text-ink">{d.payment_method}</div>
                      <div className="text-[9px] text-[#787878]">{dateStr}{d.note ? ` · ${d.note}` : ''}</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-[12px] ${deltaClass(d.amount)}`}>{d.amount < 0 ? `-${won(Math.abs(d.amount))}` : `+${won(d.amount)}`}</div>
                      <div className={`text-[9px] text-[#6A635E] ${NUM}`}>잔액 {won(d.balance_after)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

        {detailTab === 'members' && (
          members.length === 0 ? (
            <div className="text-[10px] text-[#ADADAD] py-[13px]">이용자 정보가 없습니다.</div>
          ) : (
            <div className="space-y-[8px]">
              {/* 구성원을 누르면 그 사람의 프로필(월별 흐름·늘 시키는 것·평일/주말 시간대)을 연다.
                  이름이 곧 orders.orderer_name 이라 추가 연결 없이 그대로 맞물린다
                  (침산점 실측: 구성원 98명 중 96명이 주문 이력이 있다).
                  주문이 없는 사람은 모달이 '주문 기록이 없어요'로 받는다. */}
              {members.map(m => (
                <div
                  key={m.id}
                  onClick={() => selected && setProfileOf({
                    name: m.name, code: selected.account_code, account: selected.account_name,
                  })}
                  className="bg-[#F2F2F2] hover:bg-[#E8E4E2] cursor-pointer transition-colors rounded-[10px] px-[13px] py-[10px] flex items-center justify-between"
                >
                  <div className="flex flex-col items-start gap-[3px] min-w-0">
                    {/* 이름은 10 → 13px. 이 카드에서 가장 먼저 읽어야 할 것이 이름인데
                        전화번호(9px)와 거의 같은 크기라 훑기 어려웠다. */}
                    <span className="flex items-center gap-[5px] min-w-0">
                      {adminNames.has(m.name) && (
                        /* 관리자 — 왕관. 등록을 마친 사람이 누구인지는 점주가
                           문의를 어디로 보낼지 정할 때 쓰는 정보다 */
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="flex-shrink-0" aria-label="관리자">
                          <path d="M3 17.5h18M4 7.5l4 3.5 4-6 4 6 4-3.5-1.6 8.5H5.6L4 7.5Z"
                                fill="#E8B84B" stroke="#C99A2E" strokeWidth="1.3" strokeLinejoin="round" />
                        </svg>
                      )}
                      <RevealText
                        value={m.name} masked={maskName(m.name)} iconSize={12}
                        className="text-[13px] font-semibold text-ink"
                      />
                    </span>
                    {m.phone && (
                      <RevealText
                        value={m.phone} masked={maskPhone(m.phone)} iconSize={9}
                        className="text-[9px] text-[#787878]"
                      />
                    )}
                  </div>
                  <div className="text-right text-[9px] text-[#6A635E]">주문 {m.order_count}건</div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {profileOf && (
        <CustomerProfileModal
          storeId={storeId}
          ordererName={profileOf.name}
          accountCode={profileOf.code}
          accountName={profileOf.account}
          onClose={() => setProfileOf(null)}
        />
      )}
    </div>
  )
}

function StatusTag({ status }: { status: string }) {
  const styles: Record<string, string> = {
    '취소':   'bg-red-100 text-danger',
    '완료':   'bg-green-soft text-green',
    '조리중': 'bg-orange-100 text-orange-600',
    '주문완료': 'bg-blue-100 text-blue-600',
  }
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ml-2 ${styles[status] ?? 'bg-gray-100 text-gray-text'}`}>
      {status}
    </span>
  )
}

function AccountQrModal({ accountCode, accountName, qrSystem, storeId, onClose }: { accountCode: string; accountName: string; qrSystem: 'legacy' | 'kakao'; storeId: string; onClose: () => void }) {
  const url = qrSystem === 'kakao'
    ? `${SUNPOS_KAKAO_URL}/qr/${accountCode}`
    : `${BASE_URL}?store=${storeId}&account=${accountCode}`
  const [copied, setCopied] = useState(false)
  const qrDataUrl = useQrDataUrl(url)

  function copy() {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function saveImage() {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `QR_${accountName}.png`
    a.click()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="modal-in bg-white rounded-2xl shadow-xl p-7 w-[460px]">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[17px] font-semibold">고객 전용 QR</div>
          <button onClick={onClose} className="text-gray-text hover:text-ink text-[18px]">✕</button>
        </div>
        <div className="text-[11px] text-gray-text mb-4">
          <span className="font-semibold text-ink">{accountName}</span> 고객 전용 링크입니다.
        </div>
        {qrDataUrl ? (
          <div className="flex flex-col items-center mb-4">
            <img src={qrDataUrl} alt="Account QR" className="w-[200px] h-[200px] rounded-xl border border-gray-border mb-3" />
            <div className="text-[11px] font-mono text-gray-text break-all text-center">{url}</div>
          </div>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-gray-text text-[11px]">QR 생성 중…</div>
        )}
        <div className="flex gap-2">
          <button onClick={saveImage} disabled={!qrDataUrl}
            className="flex-1 py-[14px] rounded-xl font-bold text-[15px] border border-gray-border text-ink hover:bg-gray-bg transition-colors disabled:opacity-40">
            이미지 저장
          </button>
          <button onClick={copy}
            className={`flex-1 py-[14px] rounded-xl font-bold text-[15px] transition-colors
              ${copied ? 'bg-green-soft text-green' : 'bg-ink text-white hover:bg-ink/90'}`}>
            {copied ? '✓ 복사됨' : '링크 복사'}
          </button>
        </div>
      </div>
    </div>
  )
}

function KioskQrModal({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const url = `${BASE_URL}?store=${storeId}`
  const [copied, setCopied] = useState(false)
  const qrDataUrl = useQrDataUrl(url)

  function copy() {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function saveImage() {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = 'QR_키오스크_공용.png'
    a.click()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="modal-in bg-white rounded-2xl shadow-xl p-7 w-[460px]">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[17px] font-semibold">키오스크 공용 QR</div>
          <button onClick={onClose} className="text-gray-text hover:text-ink text-[18px]">✕</button>
        </div>
        <div className="text-[11px] text-gray-text mb-4">
          누구나 고객을 선택하고 PIN을 입력해 주문할 수 있는 공용 링크입니다.
        </div>
        {qrDataUrl ? (
          <div className="flex flex-col items-center mb-4">
            <img src={qrDataUrl} alt="Kiosk QR" className="w-[200px] h-[200px] rounded-xl border border-gray-border mb-3" />
            <div className="text-[11px] font-mono text-gray-text break-all text-center px-2">{url}</div>
          </div>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-gray-text text-[11px]">QR 생성 중…</div>
        )}
        <div className="flex gap-2">
          <button onClick={saveImage} disabled={!qrDataUrl}
            className="flex-1 py-[14px] rounded-xl font-bold text-[15px] border border-gray-border text-ink hover:bg-gray-bg transition-colors disabled:opacity-40">
            이미지 저장
          </button>
          <button onClick={copy}
            className={`flex-1 py-[14px] rounded-xl font-bold text-[15px] transition-colors
              ${copied ? 'bg-green-soft text-green' : 'bg-ink text-white hover:bg-ink/90'}`}>
            {copied ? '✓ 복사됨' : '링크 복사'}
          </button>
        </div>
      </div>
    </div>
  )
}
