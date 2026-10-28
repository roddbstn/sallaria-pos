import { useState, useMemo, useEffect, useRef } from 'react'
import { type Order, type OrderStatus } from '../lib/mock-data'
import { won, formatDate, orderToPayload, parseNote } from '../lib/ipc'
import { supabase } from '../lib/supabase'
import { mapOrderRow } from '../lib/mappers'
import { useStore } from '../lib/store-context'
import PeriodCalendarModal from '../components/ui/PeriodCalendarModal'
import { DataTable, DataTableHead, DataTableRow, DataTableNotice } from '../components/ui/DataTable'
import DonutChart from '../components/DonutChart'
import ScrollHint from '../components/ui/ScrollHint'
import ConfirmDialog from '../components/ui/ConfirmDialog'

// parseNote는 lib/ipc.ts에서 import

// 인라인 복사 버튼
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}
      className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 transition-colors"
      style={copied ? { backgroundColor: '#E6F4EC', color: '#017333' } : { backgroundColor: '#F2F2F2', color: '#787878' }}
    >
      {copied ? '✓ 복사됨' : '복사'}
    </button>
  )
}

// mapOrderRow는 lib/mappers.ts에서 import

// ── 상태 필터 옵션 ─────────────────────────────────────────────────────────────

// 배지 색 — 다른 배지(유형·경과시간)와 같은 규칙: 같은 색을 글자에 진하게, 배경에 12% 투명도로.
// 이용방법 색은 Dashboard 의 도넛(METHOD_COLOR)과 일부러 일치시킨다 — 같은 '배달'이
// 화면마다 다른 색이면 색이 정보가 아니라 장식이 된다.
const STATUS_COLOR: Record<string, string> = {
  '주문완료': '#3374FF',
  '조리중':   '#FF8418',
  '완료':     '#017333',
  '취소':     '#C92A2A',
}

const METHOD_COLOR: Record<string, string> = {
  '포장':      '#FF676F',
  '배달':      '#3374FF',
  '매장 식사': '#ADADAD',
}

/** 색 하나로 글자·배경을 만드는 배지 */
/** 고객 화면 유형 배지와 같은 치수(px8/py3/r6/12px medium) — 같은 성격의 꼬리표는 같아야 한다 */
function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-block px-[8px] py-[3px] rounded-[6px] text-[12px] font-medium whitespace-nowrap align-middle"
      style={{ color, backgroundColor: `${color}1F` }}
    >
      {label}
    </span>
  )
}

// ── 날짜 유틸 ─────────────────────────────────────────────────────────────────
/**
 * "에그인헬 외 2" — 목록 한 줄에 무엇을 시켰는지 보여준다.
 *
 * 거래처가 "지난달 우리 과 얼마 썼어요?"로 전화할 때 점주가 금액만 읽어 주면 상대가
 * 납득하지 못한다. 무슨 메뉴였는지가 같이 있어야 그 자리에서 끝난다.
 */
function itemsSummary(items: { name: string; qty: number }[]): string {
  if (items.length === 0) return ''
  const first = items[0]
  const head  = first.qty > 1 ? `${first.name} ${first.qty}개` : first.name
  return items.length > 1 ? `${head} 외 ${items.length - 1}` : head
}

function toYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseYMD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}



// 캘린더·좌측 날짜 패널은 걷어냈다(2026-10-13).
// 같은 일을 주문 홈의 기간선택 모달이 이미 더 잘 하고 있었고(components/ui/PeriodCalendarModal),
// 240px 패널이 표 폭을 먹어서 열을 못 늘리는 게 이 화면이 낡아 보이던 큰 이유였다.

/**
 * 필터 드롭다운 — '전체 / 값들'. 다른 화면의 정렬·휴면기간 드롭다운과 같은 모양.
 *
 * native <select> 를 쓰지 않는 이유: OS 기본 위젯이 이 앱의 다른 드롭다운과 전혀 달라서
 * 한 줄 안에 두면 그것만 튄다.
 */
function FilterSelect({ value, onChange, allLabel, options }: {
  value:    string
  onChange: (v: string) => void
  allLabel: string
  options:  string[]
}) {
  const [open, setOpen] = useState(false)
  const active = value !== 'all'
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`pressable-tab h-[30px] pl-[11px] pr-[8px] rounded-[9px] text-[12px] font-normal flex items-center gap-[5px] ${
          active ? 'bg-[#6A635E] text-[#FCFCFC] font-medium hover:brightness-110' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
        }`}
      >
        {active ? value : allLabel}
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M4 6.5L8 10.5L12 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-[4px] z-30 min-w-[128px] bg-[#FCFCFC] border border-[#E5E5E5] rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] overflow-hidden">
            {['all', ...options].map(opt => (
              <button
                key={opt}
                onClick={() => { onChange(opt); setOpen(false) }}
                className={`w-full px-[12px] h-[32px] text-left text-[12px] transition-colors ${
                  opt === value ? 'bg-[#F2F2F2] text-[#2C261F] font-medium' : 'text-[#414141] font-normal hover:bg-[#F2F2F2]'
                }`}
              >
                {opt === 'all' ? allLabel : opt}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── 통계 카드 ─────────────────────────────────────────────────────────────────
/**
 * 베이지 바탕 위에 뜨는 카드 면 — 왼쪽 데이터 칼럼과 오른쪽 표 카드가 같은 값을 쓴다.
 *
 * 그림자에서 **spread(네 번째 값) 1px 를 뺐다.** spread 는 블러 전에 그림자를 사방으로
 * 1px 키우는 값이라, 모서리에 흐릿하지 않은 회색 테두리가 한 겹 생긴다 — 흰 배경에선
 * 티가 안 나는데 바탕색(#F2F2F2) 위에선 "이상한 회색 선"으로 보였다.
 * 색도 순수 검정 대신 잉크(#2C261F) 계열로 바꿨다. 따뜻한 바탕 위의 중성 검정 그림자는
 * 푸르스름하게 뜬다.
 */
const CARD_SURFACE = 'bg-[#FCFCFC] shadow-[0_2px_10px_rgba(44,38,31,0.08)]'

function StatCard({ label, value, sub, wide }: { label: string; value: string; sub?: string; wide?: boolean }) {
  return (
    <div className={`${wide ? 'flex-[2]' : 'flex-[1]'} ${CARD_SURFACE} rounded-[12px] px-[16px] py-[17px]`}>
      <div className="text-[12px] font-normal text-[#787878] mb-[8px]">{label}</div>
      {/* 이 칼럼의 주인공. 17 → 20 → 25px 으로 두 번 올렸다.
          옆 표 본문이 13px 이라 20px 도 "요약"으로 안 읽혔다. 굵기도 medium → semibold. */}
      <div className="text-[25px] font-semibold text-[#2C261F] leading-tight whitespace-nowrap">{value}</div>
      {sub && <div className="text-[11px] font-normal text-[#ADADAD] mt-[3px]">{sub}</div>}
    </div>
  )
}

// ── 메뉴별 매출 집계 ──────────────────────────────────────────────────────────
interface MenuSales { name: string; qty: number; total: number }

// ── 분석 박스(주문유형 · 많이 팔린 상품 · 고객유형) ─────────────────────────
//
// 전엔 Dashboard.tsx 의 우측 400px 사이드패널에 있었다. 사이드패널을 없애면서
// 통계 4박스와 같은 칼럼으로 옮겼다. 중요한 건 **기준 기간이 하나가 됐다**는 것 —
// 전에는 사이드패널이 자기만의 오늘/이번주/이번달을 들고 있어서, 왼쪽 '합계 주문액'과
// 오른쪽 도넛의 건수가 서로 다른 기간을 가리켰다. 나란히 놓고 보면 그건 틀린 숫자다.

const METHOD_ORDER = ['포장', '배달', '매장 식사'] as const
const METHOD_SHORT: Record<string, string> = { '포장': '포장', '배달': '배달', '매장 식사': '매장' }
const BEST_COLORS = ['#FF676F', '#3374FF', '#F5A623', '#7ED321', '#9B59B6', '#1ABC9C', '#E67E22', '#2C3E50', '#ADADAD', '#BDC3C7']

/** 계정 유형 막대 — DB 에 '과'와 '부서'가 섞여 있다(레거시). 같은 것으로 묶는다 */
const ACCOUNT_TYPE_BUCKETS = ['부서', '기업', '개인', '기타'] as const
function accountBucket(type: string | undefined): typeof ACCOUNT_TYPE_BUCKETS[number] | null {
  if (!type) return null
  if (type === '과' || type === '부서') return '부서'
  if (type === '기업') return '기업'
  if (type === '개인') return '개인'
  return '기타'
}

type ChartTooltip =
  // 'list' 는 두 그래프가 같이 쓴다. 그런데 **세는 단위가 다르다** —
  // 주문 유형은 '건'(주문 수)이고 메뉴는 '개'(판매 수량)다. 금액도 다르다:
  // 주문 유형은 주문 총액, 메뉴는 그 메뉴 줄의 금액.
  // 전엔 둘 다 '주문 수 / 주문 총액'으로 계산해서, 메뉴 툴팁이 표와 어긋났다
  // (표: 훈제오리 8개 76,000원 ↔ 툴팁: 7건 87,500원 — 7은 그 메뉴가 들어간 '주문 수',
  //  87,500은 그 주문들의 **총액**이라 다른 메뉴 값까지 섞여 있었다).
  // 그래서 세는 일을 부르는 쪽이 하고, 여기엔 결과만 담는다.
  | { kind: 'list';    label: string; total: number; countLabel: string
      rows: { key: string; time: string; amount: number }[]; x: number; y: number }
  | { kind: 'account'; label: string; count: number; amount: number;  x: number; y: number }

/** 분석 박스 껍데기 — StatCard 와 **같은 언어**(#F2F2F2 / r10 / 11px 라벨)로 맞춘다.
 *  전엔 제목이 15px semibold 라 옆의 StatCard 숫자보다 커서 따로 노는 블록처럼 보였다. */
function StatBox({ title, right, children }: {
  title: string
  /** 제목 줄 오른쪽에 들어가는 것(토글 버튼 등) */
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className={`${CARD_SURFACE} rounded-[12px] px-[16px] py-[15px]`}>
      <div className="flex items-center justify-between gap-[8px] mb-[12px]">
        <span className="text-[12px] font-normal text-[#787878]">{title}</span>
        {right}
      </div>
      {children}
    </div>
  )
}

function calcMenuSales(orders: Order[]): MenuSales[] {
  const map = new Map<string, MenuSales>()
  for (const order of orders) {
    if (order.status === '취소') continue
    for (const item of order.items) {
      const existing = map.get(item.name)
      if (existing) {
        existing.qty   += item.qty
        existing.total += item.price * item.qty
      } else {
        map.set(item.name, { name: item.name, qty: item.qty, total: item.price * item.qty })
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total)
}

// ── 거래처별 매출 집계 ────────────────────────────────────────────────────────
interface AccountSales { name: string; count: number; ordererCount: number; total: number }

function calcAccountSales(orders: Order[]): AccountSales[] {
  const map = new Map<string, { count: number; orderers: Set<string>; total: number }>()
  for (const order of orders) {
    if (order.status === '취소') continue
    const existing = map.get(order.accountName)
    if (existing) {
      existing.count += 1
      existing.orderers.add(order.orderer)
      existing.total += order.total
    } else {
      map.set(order.accountName, { count: 1, orderers: new Set([order.orderer]), total: order.total })
    }
  }
  return Array.from(map.entries())
    .map(([name, v]) => ({ name, count: v.count, ordererCount: v.orderers.size, total: v.total }))
    .sort((a, b) => b.total - a.total)
}

// ── 날짜 범위 내 날 수 ────────────────────────────────────────────────────────
function dayCount(start: string | null, end: string | null): number {
  if (!start) return 1
  const s = parseYMD(start)
  const e = end ? parseYMD(end) : s
  return Math.max(Math.round((e.getTime() - s.getTime()) / 86400000) + 1, 1)
}

function Row({ label, value, mono, bold }: { label: string; value: string; mono?: boolean; bold?: boolean }) {
  return (
    <div className="flex justify-between items-baseline text-[13px] gap-3">
      <span className="text-[#787878] flex-shrink-0">{label}</span>
      <span className={`max-w-[55%] text-right break-words ${mono ? 'font-mono tabular-nums' : ''} ${bold ? 'font-medium text-[#1E1E1E]' : 'text-[#1E1E1E]'}`}>{value}</span>
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export type OrdersTab = '주문내역' | '메뉴별매출' | '거래처별매출'

/**
 * @param initialTab 햄버거 드로어에서 "주문 리포트"/"주문 내역" 중 무엇으로 들어왔는지.
 *   드로어 항목 3개가 전부 같은 화면의 같은 탭으로 떨어지던 걸 구분하려고 받는다.
 */
export default function Orders({ initialTab = '주문내역' }: { initialTab?: OrdersTab } = {}) {
  const { storeName, storeId } = useStore()
  const today = toYMD(new Date())

  const [startDate, setStartDate] = useState<string | null>(today)
  const [endDate,   setEndDate]   = useState<string | null>(today)
  const [tab,       setTab]       = useState<OrdersTab>(initialTab)
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all')
  const [methodFilter, setMethodFilter] = useState<string | 'all'>('all')
  // 전에는 이용방법·상태 필터가 '표 머리글을 클릭하면 순환'하는 방식이었다. 눌러 보기 전엔
  // 거기에 필터가 있다는 걸 알 수 없어서, 명시적인 필터 바로 올렸다.
  const [query,        setQuery]        = useState('')
  const [periodLabel,  setPeriodLabel]  = useState<string>('오늘')
  const [periodOpen,   setPeriodOpen]   = useState(false)
  const [selected,     setSelected]     = useState<Order | null>(null)
  const [selectedMenuName,    setSelectedMenuName]    = useState<string | null>(null)
  const [selectedAccountName, setSelectedAccountName] = useState<string | null>(null)
  const [chartTooltip, setChartTooltip] = useState<ChartTooltip | null>(null)
  const listScrollRef = useRef<HTMLDivElement | null>(null)
  const [orders,      setOrders]      = useState<Order[]>([])
  const [loading,     setLoading]     = useState(false)
  const [reprintMsg,  setReprintMsg]  = useState<{ ok: boolean; text: string } | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)
  const [deleteConfirmCode, setDeleteConfirmCode] = useState<string | null>(null)

  // ── 거래처 제외 필터 ────────────────────────────────────────────────────────
  const [excludedAccounts, setExcludedAccounts] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('pos_excluded_accounts') || '[]')
      return new Set(Array.isArray(saved) ? saved : [])
    } catch { return new Set() }
  })
  const [showAccountFilter, setShowAccountFilter] = useState(false)
  const filterBtnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem('pos_excluded_accounts', JSON.stringify([...excludedAccounts]))
  }, [excludedAccounts])

  // 팝오버 외부 클릭 시 닫기
  useEffect(() => {
    if (!showAccountFilter) return
    function onDown(e: MouseEvent) {
      if (filterBtnRef.current && !filterBtnRef.current.contains(e.target as Node)) {
        setShowAccountFilter(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showAccountFilter])

  async function fetchOrders(start: string | null, end: string | null, deleted = showDeleted) {
    if (!start) { setOrders([]); return }
    setLoading(true)
    const s = `${start}T00:00:00`
    const e = `${end ?? start}T23:59:59`

    // 활성 거래처 코드 조회 (숨김 거래처 주문 제외용)
    const { data: activeAccs } = storeId
      ? await supabase.from('accounts').select('account_code').eq('store_id', storeId).eq('is_active', true)
      : { data: null }
    const activeCodes = (activeAccs ?? []).map(a => a.account_code as string)

    const baseQuery = supabase
      .from('orders')
      .select(`
        order_code, order_number, orderer_name, orderer_phone,
        ordered_at, total_amount, menu_subtotal, delivery_fee, balance_before, balance_after,
        method, status, note, is_deleted, requested_pickup_minutes, prep_minutes, accepted_at, completed_at,
        accounts ( account_name, account_type ),
        order_items (
          order_item_id, menu_name, quantity, unit_price,
          order_item_options ( id, option_name, extra_price )
        )
      `)
      .gte('ordered_at', s)
      .lte('ordered_at', e)
      .eq('is_deleted', deleted)
      .order('ordered_at', { ascending: false })

    const { data, error } = await (
      activeCodes.length > 0 ? baseQuery.in('account_code', activeCodes) : baseQuery
    )

    if (!error && data) setOrders(data.map(mapOrderRow))
    setLoading(false)
  }

  // 삭제는 잔액 환원까지 한 트랜잭션으로 묶어야 한다 — is_deleted 만 바꾸면 "지웠는데
  // 돈은 깎인 채"가 된다(2026-10-13까지 그랬다). 취소 건은 cancel_order 가 이미
  // 환원했으므로 RPC 안에서 이중 환원을 막는다.
  async function handleDeleteOrder(code: string) {
    const { error } = await supabase.rpc('soft_delete_order', { p_order_code: code })
    if (error) { console.error('삭제 실패:', error); return }
    setDeleteConfirmCode(null)
    setSelected(null)
    fetchOrders(startDate, endDate, false)
  }

  async function handleRestoreOrder(orderCode: string) {
    const { error } = await supabase.rpc('restore_order', { p_order_code: orderCode })
    if (error) { console.error('복구 실패:', error); return }
    setSelected(null)
    fetchOrders(startDate, endDate, true)
  }

  // 날짜 범위 or 삭제 보기 토글 시 재조회
  useEffect(() => {
    setDeleteConfirmCode(null)
    fetchOrders(startDate, endDate, showDeleted)
  }, [startDate, endDate, showDeleted])

  function handleRangeChange(s: string | null, e: string | null, label?: string) {
    setStartDate(s)
    setEndDate(e)
    if (label !== undefined) setPeriodLabel(label)
    setSelected(null)
    setSelectedMenuName(null)
    setDeleteConfirmCode(null)
  }

  // 기간 프리셋 — 좌측 240px 패널에 세로로 쌓여 있던 8개를 가로 칩으로 줄였다.
  // 나머지(지난 3·6개월, 올해)는 기간 선택 모달에서 직접 고르면 된다.
  const PERIOD_PRESETS: { label: string; range: () => [string, string] }[] = [
    { label: '오늘',    range: () => [today, today] },
    { label: '어제',    range: () => { const d = new Date(); d.setDate(d.getDate() - 1); const y = toYMD(d); return [y, y] } },
    { label: '지난 7일', range: () => { const d = new Date(); d.setDate(d.getDate() - 6); return [toYMD(d), today] } },
    { label: '이번 달',  range: () => { const n = new Date(); return [toYMD(new Date(n.getFullYear(), n.getMonth(), 1)), today] } },
    { label: '지난 달',  range: () => {
        const n = new Date()
        return [toYMD(new Date(n.getFullYear(), n.getMonth() - 1, 1)), toYMD(new Date(n.getFullYear(), n.getMonth(), 0))]
      } },
  ]

  function handleTabChange(t: '주문내역' | '메뉴별매출' | '거래처별매출') {
    setTab(t)
    setSelected(null)
    setSelectedMenuName(null)
    setSelectedAccountName(null)
  }

  // 거래처 제외 필터 적용된 주문
  const filteredOrders = useMemo(
    () => excludedAccounts.size === 0
      ? orders
      : orders.filter(o => !excludedAccounts.has(o.accountName)),
    [orders, excludedAccounts],
  )

  // 팝오버용 — 전체 거래처 목록 (필터 무관)
  const allAccountSales = useMemo(() => calcAccountSales(orders), [orders])

  /**
   * 거래처 필터 목록 — 기간 매출 + **제외 중인데 이 기간 주문이 없는 거래처**.
   *
   * calcAccountSales 는 그 기간 주문에서만 만들어진다. 그래서 제외해 둔 거래처가
   * 그 기간에 주문이 없으면 목록에서 통째로 사라졌다 — 버튼에는 '제외 중'이라고
   * 떠 있는데 정작 그 창에서는 풀 방법이 없었다(한 번 제외하면 그 계정이 다시
   * 주문할 때까지 못 되돌린다). 0건으로라도 자리를 만들어 준다.
   */
  const filterRows = useMemo(() => {
    const present = new Set(allAccountSales.map(a => a.name))
    const missing = [...excludedAccounts]
      .filter(n => !present.has(n))
      .sort((a, b) => a.localeCompare(b, 'ko'))
      .map(name => ({ name, count: 0, ordererCount: 0, total: 0 }))
    return [...allAccountSales, ...missing]
  }, [allAccountSales, excludedAccounts])

  // 삭제된 주문 토글 · 거래처 필터는 **탭 줄 오른쪽 끝**에 아이콘으로 둔다.
  // 전에는 공유 헤더 바(setHeaderRight)에 주입해서, 화면 레이아웃에 속하지 않고
  // 상단에 혼자 떠 있었다 — 어느 화면의 버튼인지 알기 어려웠다.

  // 통계 계산 (제외 필터 반영)
  const stats = useMemo(() => {
    const valid       = filteredOrders.filter(o => o.status !== '취소')
    const totalSales  = valid.reduce((sum, o) => sum + o.total, 0)
    const days        = dayCount(startDate, endDate)
    const avgSales    = days > 0 ? Math.round(totalSales / days) : 0
    const orderCount  = valid.length
    const cancelCount = filteredOrders.filter(o => o.status === '취소').length
    return { totalSales, avgSales, orderCount, cancelCount }
  }, [filteredOrders, startDate, endDate])

  // 상태 필터 (주문내역 탭)
  const listFiltered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return filteredOrders.filter(o => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false
      if (methodFilter !== 'all' && o.method !== methodFilter) return false
      if (!q) return true
      // 거래처·주문자·주문번호·메뉴명까지 — 전화 응대 중에 찾는 단서가 그 넷 중 하나다
      return o.accountName.toLowerCase().includes(q)
        || o.orderer.toLowerCase().includes(q)
        || (o.orderNumber ?? '').toLowerCase().includes(q)
        || o.items.some(it => it.name.toLowerCase().includes(q))
    })
  }, [filteredOrders, statusFilter, methodFilter, query])

  // 메뉴별 매출
  const menuSales = useMemo(() => calcMenuSales(filteredOrders), [filteredOrders])

  // 거래처별 매출
  const accountSales = useMemo(() => calcAccountSales(filteredOrders), [filteredOrders])

  // ── 분석 박스 3개의 재료 ───────────────────────────────────────────────────
  //
  // 기준은 **filteredOrders**(기간 + 거래처 필터)다. listFiltered(이용방법·상태·검색까지)가
  // 아니다 — 이용방법을 '포장'으로 거르면 주문유형 도넛이 100% 포장이 돼서 아무 말도 못 한다.
  // 위 StatCard 4개와 같은 모집단을 써야 7박스의 숫자가 서로 맞는다.
  const okOrders = useMemo(() => filteredOrders.filter(o => o.status !== '취소'), [filteredOrders])

  const methodCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const o of okOrders) m[o.method] = (m[o.method] ?? 0) + 1
    return m
  }, [okOrders])
  const methodTotal = Object.values(methodCounts).reduce((s2, n) => s2 + n, 0)
  // 비율 큰 순 — 도넛이 12시 방향부터 시계방향으로 큰 조각부터 그려지도록 범례와 공용 정렬
  const methodOrderSorted = useMemo(
    () => [...METHOD_ORDER].sort((a2, b2) => (methodCounts[b2] ?? 0) - (methodCounts[a2] ?? 0)),
    [methodCounts],
  )

  // 메뉴 기준 판매 수량. 옵션·카테고리 기준은 뺐다 —
  // 옵션은 '드레싱 X' 같은 게 1위로 올라와 아무 결정에도 못 쓰이고,
  // 카테고리는 주문 데이터에 없어서 메뉴 조인을 한 번 더 해야 한다.
  const bestList = useMemo(() => {
    const map: Record<string, number> = {}
    for (const o of okOrders) {
      for (const item of o.items) map[item.name] = (map[item.name] ?? 0) + item.qty
    }
    return Object.entries(map).map(([label, count]) => ({ label, count })).sort((a2, b2) => b2.count - a2.count)
  }, [okOrders])
  const bestTotal = bestList.reduce((s2, b2) => s2 + b2.count, 0)

  const accountBars = useMemo(() => {
    const totals: Record<string, number> = {}
    const names:  Record<string, Set<string>> = {}
    for (const o of okOrders) {
      const bucket = accountBucket(o.accountType)
      if (!bucket) continue
      totals[bucket] = (totals[bucket] ?? 0) + o.total
      ;(names[bucket] ??= new Set()).add(o.accountName)
    }
    return ACCOUNT_TYPE_BUCKETS
      // '기타'는 실제로 쓰는 매장이 거의 없다 — 0이면 빈 막대로 자리만 먹으니 뺀다
      .filter(label => label !== '기타' || (totals[label] ?? 0) > 0)
      .map(label => ({ label, amount: totals[label] ?? 0, accountCount: names[label]?.size ?? 0 }))
  }, [okOrders])
  const maxAccountBar = Math.max(1, ...accountBars.map(b2 => b2.amount))

  const hhmm = (iso: string) =>
    new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })

  /** 메뉴 툴팁 — 수량과 금액을 **그 메뉴 줄만** 센다(메뉴별 주문액 표와 같은 식) */
  function showListTooltip(label: string, e: React.MouseEvent) {
    let qty = 0, total = 0
    const rows: { key: string; time: string; amount: number }[] = []
    for (const o of okOrders) {
      // 같은 메뉴가 한 주문에 두 줄로 들어갈 수 있다(옵션이 다르면) — 합쳐서 한 행으로
      const lines = o.items.filter(it => it.name === label)
      if (lines.length === 0) continue
      const lineQty    = lines.reduce((t, it) => t + it.qty, 0)
      const lineAmount = lines.reduce((t, it) => t + it.price * it.qty, 0)
      qty   += lineQty
      total += lineAmount
      rows.push({ key: o.code, time: hhmm(o.createdAt), amount: lineAmount })
    }
    setChartTooltip({ kind: 'list', label, total, countLabel: `${qty}개`, rows, x: e.clientX, y: e.clientY })
  }

  /** 이용방법 툴팁 — 이쪽은 '건'과 '주문 총액'이 맞다 */
  function showMethodTooltip(method: string, e: React.MouseEvent) {
    const hit = okOrders.filter(o => o.method === method)
    setChartTooltip({
      kind: 'list', label: METHOD_SHORT[method] ?? method,
      total: hit.reduce((s2, o) => s2 + o.total, 0),
      countLabel: `${hit.length}건`,
      rows: hit.map(o => ({ key: o.code, time: hhmm(o.createdAt), amount: o.total })),
      x: e.clientX, y: e.clientY,
    })
  }
  const trackTooltip = (e: React.MouseEvent) =>
    setChartTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : t)

  return (
    // 바탕은 canvas(베이지). 전엔 #F9F9F9 를 칠해서, OrdersTab 이 깔아둔 베이지를
    // 이 화면 왼쪽 절반만 덮어버렸다 — 오른쪽 사이드패널과 색이 갈라져 보였다.
    <div className="h-full flex overflow-hidden bg-canvas gap-3 p-3">

      {/* ── 왼쪽: 데이터만 ──────────────────────────────────────────────────
           숫자 4개와 분석 3개를 한 칼럼에 모았다. 한 줄에 7개를 늘어놓는 안은 접었다 —
           1440px 에서 박스당 190px 인데 주문유형 도넛만 109px + 범례 160px 이라 안 들어간다.
           380px 고정: 도넛(109) + 범례(160) + 좌우 여백이 들어가는 최소 폭. */}
      <div className="w-[380px] flex-shrink-0 flex flex-col gap-2.5 overflow-y-auto">

        {/* 숫자 4개 — 380px 에 가로 4개는 95px 씩이라 '합계 주문액' 금액이 잘린다. 2×2 로 */}
        <div className="grid grid-cols-2 gap-2.5 flex-shrink-0">
          {/* 윗줄은 '얼마 / 몇 건' — 같이 읽는 한 쌍이다.
              아랫줄은 그걸 나눈 값(일 평균)과 빼는 값(취소). */}
          <StatCard label="합계 주문액"    value={won(stats.totalSales)} />
          <StatCard label="주문 건수"       value={`${stats.orderCount}건`} />
          <StatCard label="일 평균 주문액"  value={won(stats.avgSales)} />
          <StatCard label="취소 건수"       value={`${stats.cancelCount}건`} />
        </div>

        {/* 주문유형 — 도넛 + 범례 */}
        <StatBox title="주문 유형">
          {methodTotal === 0 ? (
            <div className="py-[18px] text-center text-[12px] text-[#ADADAD]">이 기간에 주문이 없어요</div>
          ) : (
            <div className="flex items-center justify-between gap-[10px]">
              <div className="flex flex-col gap-[8px] min-w-0">
                {methodOrderSorted.map(m => (
                  <div
                    key={m}
                    className="flex items-center gap-[5px] cursor-pointer"
                    onMouseEnter={e => showMethodTooltip(m, e)}
                    onMouseMove={trackTooltip}
                    onMouseLeave={() => setChartTooltip(null)}
                  >
                    <span className="w-[11px] h-[11px] rounded-full flex-shrink-0" style={{ backgroundColor: METHOD_COLOR[m] }} />
                    <span className="text-[12px] text-[#2C261F] whitespace-nowrap">
                      {METHOD_SHORT[m]} ({Math.round(((methodCounts[m] ?? 0) / methodTotal) * 100)}%, {methodCounts[m] ?? 0}건)
                    </span>
                  </div>
                ))}
              </div>
              <DonutChart
                size={92} strokeWidth={18}
                segments={methodOrderSorted.map(m => ({
                  pct: ((methodCounts[m] ?? 0) / methodTotal) * 100,
                  color: METHOD_COLOR[m],
                }))}
                onSegmentHover={(idx, e) => {
                  if (idx === null) { setChartTooltip(null); return }
                  showMethodTooltip(methodOrderSorted[idx], e)
                }}
              />
            </div>
          )}
        </StatBox>

        {/* 가장 많이 팔린 상품 — 메뉴/옵션 토글 + 상위 3 + 전체 분포 도넛 */}
        <StatBox title="가장 많이 팔린 메뉴">
          {bestList.length === 0 ? (
            <div className="py-[18px] text-center text-[12px] text-[#ADADAD]">이 기간에 판매가 없어요</div>
          ) : (
            <div className="flex items-center justify-between gap-[10px]">
              <div className="flex flex-col gap-[10px] min-w-0 flex-1">
                {bestList.slice(0, 3).map((b2, i) => (
                  <div
                    key={b2.label}
                    className="flex items-center gap-[7px] cursor-pointer min-w-0"
                    onMouseEnter={e => showListTooltip(b2.label, e)}
                    onMouseMove={trackTooltip}
                    onMouseLeave={() => setChartTooltip(null)}
                  >
                    <span className={`flex-shrink-0 w-[17px] h-[17px] rounded-full flex items-center justify-center text-[11px] font-bold ${
                      i === 0 ? 'bg-[#E8E4E2] text-[#8C8379]' : 'bg-[#E5E5E5] text-[#ADADAD]'
                    }`}>{i + 1}</span>
                    <span className={`text-[12px] font-medium truncate ${i === 0 ? 'text-[#2C261F]' : 'text-[#6A635E]'}`}>
                      {b2.label} ({b2.count})
                    </span>
                  </div>
                ))}
              </div>
              <DonutChart
                size={64} strokeWidth={12}
                // ⚠️ Math.round 를 쓰면 안 된다. 메뉴가 40개쯤 되는 매장에서는 대부분이
                //    1% 미만이라 전부 0 으로 깎여 **도넛에서 사라지고**, 남은 것들은 죄다
                //    1~4% 로 뭉개져 큰 순서가 보이지 않는다. 소수점 그대로 넘기면
                //    합이 정확히 100 이 되고 12시부터 큰 조각 순으로 제대로 깔린다.
                segments={bestList.map((b2, i) => ({
                  pct: bestTotal ? (b2.count / bestTotal) * 100 : 0,
                  color: BEST_COLORS[i % BEST_COLORS.length],
                }))}
                onSegmentHover={(idx, e) => {
                  if (idx === null) { setChartTooltip(null); return }
                  showListTooltip(bestList[idx].label, e)
                }}
              />
            </div>
          )}
        </StatBox>

        {/* 고객 유형별 주문액 — 막대 */}
        <StatBox title="고객 유형별 주문액">
          {accountBars.every(b2 => b2.amount === 0) ? (
            <div className="py-[18px] text-center text-[12px] text-[#ADADAD]">이 기간에 주문이 없어요</div>
          ) : (
            <>
              <div className="flex items-end justify-center gap-[22px]" style={{ height: 51 }}>
                {accountBars.map((b2, i2) => (
                  <div
                    key={b2.label}
                    className="flex flex-col items-center justify-end h-full cursor-pointer"
                    style={{ width: 20 }}
                    onMouseEnter={e => setChartTooltip({ kind: 'account', label: b2.label, count: b2.accountCount, amount: b2.amount, x: e.clientX, y: e.clientY })}
                    onMouseMove={trackTooltip}
                    onMouseLeave={() => setChartTooltip(null)}
                  >
                    <div
                      className="bar-rise w-[20px] bg-[#C1B7AA] rounded-t-[6px]"
                      style={{
                        height: Math.max(2, Math.round((b2.amount / maxAccountBar) * 51)),
                        animationDelay: `${i2 * 30}ms`,
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="h-px bg-canvas-line mt-[1px] mx-auto" style={{ width: 140 }} />
              <div className="flex justify-center gap-[22px] mt-[7px]">
                {accountBars.map(b2 => (
                  <span key={b2.label} className="text-[12px] text-ink text-center" style={{ width: 20 }}>{b2.label}</span>
                ))}
              </div>
            </>
          )}
        </StatBox>
      </div>

      {/* ── 오른쪽: 주문 내역 표만 ──────────────────────────────────────────
           탭·필터 칩이 다시 흰 면(#FCFCFC) 위에 올라간다. 베이지 바탕 위에서는
           #F2F2F2 칩이 명도 8단계 차이라 버튼으로 안 읽혔다.
           면 순서: 바탕 #F2F2F2 → 카드 #FCFCFC → 표 #F9F9F9(--canvas-soft) */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[#FCFCFC] rounded-[13px] p-3 gap-3">

        {/* 탭 + 우측 아이콘 두 개(삭제된 주문 · 거래처 필터) */}
        <div className="flex-shrink-0 flex items-center gap-[6px]">
          {(['주문내역', '메뉴별매출', '거래처별매출'] as const).map(t => (
            <button key={t} onClick={() => handleTabChange(t)}
              className={`pressable-tab h-[30px] px-[13px] rounded-[9px] text-[12px] font-normal
                ${tab === t ? 'bg-[#2C261F] text-[#FCFCFC] font-medium hover:brightness-125' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'}`}>
              {t === '주문내역' ? '주문 내역' : t === '메뉴별매출' ? '메뉴별 주문액' : '거래처별 주문액'}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-[6px]">
            {/* 삭제된 주문 — 쓰레기통. 켜져 있으면 색으로 알려준다(아이콘만으론 상태가 안 보인다) */}
            {tab === '주문내역' && (
              <button
                onClick={() => { setShowDeleted(v => !v); setSelected(null) }}
                title={showDeleted ? '일반 주문으로 돌아가기' : '삭제된 주문 보기'}
                aria-pressed={showDeleted}
                className={`pressable-tab w-[30px] h-[30px] rounded-[9px] flex items-center justify-center ${
                  showDeleted ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878]'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M2.5 4.5h11M6 4.5V3a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5v1.5M4 4.5l.6 8a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8"
                        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M6.8 7v4M9.2 7v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
            )}

            {/* 거래처 필터 — 깔때기. 제외 중인 수가 있으면 배지로 띄운다 */}
            <div ref={filterBtnRef} className="relative">
              <button
                onClick={() => setShowAccountFilter(v => !v)}
                title={excludedAccounts.size > 0 ? `${excludedAccounts.size}곳 제외 중` : '거래처 필터'}
                className={`pressable-tab w-[30px] h-[30px] rounded-[9px] flex items-center justify-center ${
                  excludedAccounts.size > 0 ? 'bg-[#FF8418] text-[#FCFCFC] hover:brightness-110' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M2 3.5h12L9.3 8.8v3.9l-2.6 1.3V8.8L2 3.5Z"
                        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {excludedAccounts.size > 0 && (
                <span className="absolute -top-[4px] -right-[4px] min-w-[15px] h-[15px] px-[3px] rounded-full bg-[#C92A2A] text-[#FCFCFC] text-[9px] font-medium leading-[15px] text-center pointer-events-none">
                  {excludedAccounts.size}
                </span>
              )}

              {showAccountFilter && (
                <div className="absolute right-0 top-full mt-[5px] w-[280px] bg-[#FCFCFC] rounded-[11px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] border border-[#E5E5E5] z-30 overflow-hidden">
                  <div className="px-3 py-2.5 border-b border-[#E5E5E5]">
                    <div className="flex items-center justify-between mb-[8px]">
                      <span className="text-[13px] font-medium text-[#1E1E1E]">거래처 필터</span>
                      <span className="text-[11px] font-normal text-[#ADADAD]">
                        {filterRows.length - excludedAccounts.size}/{filterRows.length}곳
                      </span>
                    </div>
                    {/* 전체선택 — 한 곳만 보고 싶을 때 '전체 해제 → 하나 체크'가 가장 빠르다 */}
                    <div className="flex gap-[6px]">
                      <button
                        onClick={() => setExcludedAccounts(new Set())}
                        disabled={excludedAccounts.size === 0}
                        className="pressable-tab flex-1 h-[28px] rounded-[8px] bg-[#F2F2F2] text-[#787878] text-[11px] font-normal transition-colors hover:bg-[#E8E4E2] disabled:opacity-40 disabled:hover:bg-[#F2F2F2]"
                      >
                        전체 선택
                      </button>
                      <button
                        onClick={() => setExcludedAccounts(new Set(filterRows.map(a => a.name)))}
                        disabled={excludedAccounts.size === filterRows.length}
                        className="pressable-tab flex-1 h-[28px] rounded-[8px] bg-[#F2F2F2] text-[#787878] text-[11px] font-normal transition-colors hover:bg-[#E8E4E2] disabled:opacity-40 disabled:hover:bg-[#F2F2F2]"
                      >
                        전체 해제
                      </button>
                    </div>
                  </div>
                  <div className="max-h-[420px] overflow-y-auto">
                    {filterRows.length === 0 ? (
                      <div className="px-4 py-5 text-center text-[12px] font-normal text-[#ADADAD]">이 기간에 주문이 없어요</div>
                    ) : filterRows.map(acc => (
                      <label key={acc.name} className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#F2F2F2] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!excludedAccounts.has(acc.name)}
                          onChange={e => {
                            setExcludedAccounts(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) next.delete(acc.name)
                              else next.add(acc.name)
                              return next
                            })
                          }}
                          className="w-4 h-4 flex-shrink-0"
                        />
                        <span className="flex-1 text-[12px] text-ink truncate">{acc.name}</span>
                        {/* 0건은 '이 기간에 주문이 없다'는 뜻이지 '매출 0원'이 아니다.
                            숫자만 두면 실적이 0 인 거래처로 읽힌다. */}
                        {acc.count === 0 ? (
                          <span className="flex-shrink-0 text-[11px] font-normal text-[#ADADAD] whitespace-nowrap">
                            해당 기간 미주문
                          </span>
                        ) : (
                          <div className="text-right flex-shrink-0">
                            <div className="text-[11px] font-normal text-[#ADADAD]">{acc.count}건</div>
                            <div className="text-[11px] font-medium text-[#1E1E1E]">{won(acc.total)}</div>
                          </div>
                        )}
                      </label>
                    ))}
                  </div>
                  <div className="border-t border-[#E5E5E5] px-3 py-2 bg-[#F9F9F9]">
                    <button
                      onClick={() => setShowAccountFilter(false)}
                      className="w-full h-[32px] rounded-[9px] bg-[#2C261F] text-[#FCFCFC] text-[12px] font-medium hover:opacity-90 transition-opacity"
                    >
                      닫기
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 탭 콘텐츠 */}
        {tab === '주문내역' ? (
          <div className="flex-1 flex flex-col overflow-hidden gap-3">

            {/* ── 필터 바 ──
                 기간·이용방법·상태·검색을 한 줄에 모았다. 전엔 기간이 좌측 240px 캘린더,
                 이용방법·상태는 "표 머리글 클릭하면 순환"이라 발견할 수가 없었다. */}
            <div className="flex-shrink-0 flex items-center gap-[8px] flex-wrap">
              {PERIOD_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => { const [a, b] = p.range(); handleRangeChange(a, b, p.label) }}
                  className={`pressable-tab h-[30px] px-[11px] rounded-[9px] text-[12px] font-normal ${
                    periodLabel === p.label ? 'bg-[#6A635E] text-[#FCFCFC] font-medium hover:brightness-110' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                onClick={() => setPeriodOpen(true)}
                className={`pressable-tab h-[30px] px-[11px] rounded-[9px] text-[12px] font-normal ${
                  periodLabel === '직접 선택' ? 'bg-[#6A635E] text-[#FCFCFC] font-medium hover:brightness-110' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
                }`}
              >
                기간 선택
              </button>

              {/* 지금 보고 있는 기간을 글자로 — 칩만 보면 "지난 7일"이 며칠부터인지 모른다 */}
              <span className="text-[11px] font-normal text-[#ADADAD] tabular-nums">
                {startDate
                  ? (endDate && endDate !== startDate ? `${startDate} ~ ${endDate}` : startDate)
                  : '기간 미선택'}
              </span>

              <span className="w-px h-[20px] bg-[#E5E5E5] mx-[2px]" />

              <FilterSelect
                value={methodFilter}
                onChange={setMethodFilter}
                allLabel="이용방법 전체"
                options={['포장', '매장 식사', '배달']}
              />
              <FilterSelect
                value={statusFilter}
                onChange={v => setStatusFilter(v as OrderStatus | 'all')}
                allLabel="상태 전체"
                options={['주문완료', '조리중', '완료', '취소']}
              />

              <div className="ml-auto relative">
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="거래처 · 주문자 · 메뉴 검색"
                  className="w-[220px] h-[30px] pl-[30px] pr-[10px] rounded-[9px] border border-[#D9D9D9] bg-[#FCFCFC] text-[12px] text-[#1E1E1E] outline-none focus:border-[#6A635E] transition-colors"
                />
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="absolute left-[10px] top-1/2 -translate-y-1/2 pointer-events-none">
                  <circle cx="7" cy="7" r="4.5" stroke="#ADADAD" strokeWidth="1.5" />
                  <path d="M10.5 10.5L14 14" stroke="#ADADAD" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </div>
            </div>

            {/* ── 표 ──
                 열 구성은 기획서(계획 문서)의 주문 내역 스펙 그대로:
                 일시 · 주문번호 · 거래처·주문자 · 메뉴 · 방법 · 상태 · 금액 · 주문 후 잔액.
                 '주문 후 잔액'이 핵심이다 — 거래처와 금액 분쟁이 나면 이 열 하나로 끝난다. */}
            <div className="relative flex-1 min-h-0">
              {/* 고정 머리글(43px) 아래에 뜨도록 위 화살표를 내린다 */}
              <ScrollHint scrollRef={listScrollRef} topOffset={55} />
              <div ref={listScrollRef} className="h-full overflow-y-auto rounded-[13px] bg-canvas-soft">
              <DataTable>
                <DataTableHead density="comfortable">
                  <span className="w-[124px]">주문일시</span>
                  <span className="w-[88px]">주문번호</span>
                  <span className="flex-1 min-w-0 pl-[10px]">거래처 · 주문자</span>
                  <span className="w-[74px]">이용방법</span>
                  <span className="w-[68px]">상태</span>
                  <span className="w-[92px] text-right">금액</span>
                  <span className="w-[100px] text-right">주문 후 잔액</span>
                </DataTableHead>

                {loading ? (
                  <DataTableNotice>불러오는 중…</DataTableNotice>
                ) : listFiltered.length === 0 ? (
                  <DataTableNotice>
                    {query.trim()
                      ? `'${query.trim()}' 에 맞는 주문이 없어요`
                      : '이 기간에 주문이 없어요'}
                  </DataTableNotice>
                ) : listFiltered.map((order, i, arr) => (
                  <DataTableRow
                    key={order.code}
                    density="comfortable"
                    last={i === arr.length - 1}
                    onClick={() => { setSelected(order); setDeleteConfirmCode(null) }}
                  >
                    <span className="w-[124px] text-[13px] text-[#787878] tabular-nums">{formatDate(order.createdAt)}</span>
                    {/* 주문번호는 전화 응대에서 가장 먼저 대조하는 값이라 회색 11px 로 묻어두면 안 된다 */}
                    <span className="w-[88px] text-[15px] font-normal text-[#1E1E1E] tabular-nums truncate">
                      #{order.orderNumber ?? order.code.slice(0, 6)}
                    </span>
                    <span className="flex-1 min-w-0 pl-[10px] pr-[10px]">
                      <span className="block text-[15px] font-medium text-[#1E1E1E] truncate">
                        {order.accountName}
                        <span className="text-[#787878] font-normal ml-[5px]">· {order.orderer}</span>
                      </span>
                      {/* 메뉴 요약 — 금액만 읽어 주면 거래처가 납득하지 못한다 */}
                      <span className="block text-[12px] font-normal text-[#ADADAD] truncate">
                        {itemsSummary(order.items)}
                      </span>
                    </span>
                    <span className="w-[74px]">
                      <Badge label={order.method} color={METHOD_COLOR[order.method] ?? '#ADADAD'} />
                    </span>
                    <span className="w-[68px]">
                      <Badge label={order.status} color={STATUS_COLOR[order.status] ?? '#787878'} />
                    </span>
                    <span className={`w-[92px] text-right text-[15px] tabular-nums ${
                      order.status === '취소' ? 'text-[#ADADAD] line-through' : 'font-medium text-[#1E1E1E]'
                    }`}>
                      {won(order.total)}
                    </span>
                    <span className={`w-[100px] text-right text-[13px] font-normal tabular-nums ${
                      order.balanceAfter == null ? 'text-[#ADADAD]'
                      : order.balanceAfter < 0 ? 'text-[#3374FF]' : 'text-[#787878]'
                    }`}>
                      {order.balanceAfter == null ? '—' : won(order.balanceAfter)}
                    </span>
                  </DataTableRow>
                ))}
              </DataTable>
              </div>
            </div>
          </div>
        ) : tab === '메뉴별매출' ? (
          /* 메뉴별 매출 탭 */
          <div className="flex-1 flex flex-col overflow-hidden rounded-[13px] bg-canvas-soft">
            <div className="grid grid-cols-[1fr_68px_88px_76px] px-[15px] h-[43px] items-center bg-[#D7D2CE] text-[15px] font-medium text-[#6A635E] border-b border-[#C1B7AA] flex-shrink-0">
              <span className="whitespace-nowrap overflow-hidden">메뉴명</span>
              <span className="whitespace-nowrap overflow-hidden text-right">주문수량</span>
              <span className="whitespace-nowrap overflow-hidden text-right">주문액</span>
              <span className="whitespace-nowrap overflow-hidden text-right">평균단가</span>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-[#E5E5E5] last:[&>button]:border-b-0">
              {menuSales.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-text text-[12px]">
                  해당 기간에 주문액 데이터가 없습니다
                </div>
              ) : (
                menuSales.map((ms, idx) => (
                  <button key={ms.name} onClick={() => setSelectedMenuName(ms.name)}
                    className={`pressable-row w-full grid grid-cols-[1fr_68px_88px_76px] px-[15px] h-[46px] items-center text-left text-[15px]
                      ${selectedMenuName === ms.name ? 'bg-[#E8E4E2]' : 'hover:bg-white/40'}`}>
                    <span className="font-semibold text-ink flex items-center gap-1.5 min-w-0 overflow-hidden">
                      {idx === 0 && <span className="flex-shrink-0">🏆</span>}
                      <span className="truncate">{ms.name}</span>
                    </span>
                    <span className="text-right text-[13px] text-gray-text">{ms.qty}개</span>
                    <span className="text-right font-medium text-[#1E1E1E] tabular-nums">{won(ms.total)}</span>
                    <span className="text-right text-[13px] text-gray-text">{won(Math.round(ms.total / ms.qty / 10) * 10)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          /* 거래처별 주문액 탭 */
          <div className="flex-1 flex flex-col overflow-hidden rounded-[13px] bg-canvas-soft">
            <div className="grid grid-cols-[1fr_72px_72px_120px] px-[15px] h-[43px] items-center bg-[#D7D2CE] text-[15px] font-medium text-[#6A635E] border-b border-[#C1B7AA] flex-shrink-0">
              <span className="whitespace-nowrap overflow-hidden">거래처명</span>
              <span className="whitespace-nowrap overflow-hidden text-right">주문건수</span>
              <span className="whitespace-nowrap overflow-hidden text-right">주문인 수</span>
              <span className="whitespace-nowrap overflow-hidden text-right">주문액</span>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-[#E5E5E5] last:[&>button]:border-b-0">
              {accountSales.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-text text-[12px]">
                  해당 기간에 주문액 데이터가 없습니다
                </div>
              ) : (
                accountSales.map((as, idx) => (
                  <button key={as.name} onClick={() => setSelectedAccountName(as.name)}
                    className={`pressable-row w-full grid grid-cols-[1fr_72px_72px_120px] px-[15px] h-[46px] items-center text-left text-[15px]
                      ${selectedAccountName === as.name ? 'bg-[#E8E4E2]' : 'hover:bg-white/40'}`}>
                    <span className="font-semibold text-ink flex items-center gap-1.5 min-w-0 overflow-hidden">
                      {idx === 0 && <span className="flex-shrink-0">🏆</span>}
                      <span className="truncate">{as.name}</span>
                    </span>
                    <span className="text-right text-[13px] text-gray-text">{as.count}건</span>
                    <span className="text-right text-[13px] text-gray-text">{as.ordererCount}명</span>
                    <span className="text-right font-medium text-[#1E1E1E] tabular-nums">{won(as.total)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>{/* end 오른쪽 칼럼 */}

      {/* 도넛·막대 공용 호버 툴팁.
          fixed + 마우스 좌표라 박스 밖으로 넘칠 수 있어 화면 오른쪽 절반이면 왼쪽으로 편다. */}
      {chartTooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-[#FCFCFC] border border-[#E5E5E5] rounded-[11px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] px-3 py-2.5 text-[11px] min-w-[160px] max-w-[260px]"
          style={chartTooltip.x > window.innerWidth / 2
            ? { right: window.innerWidth - chartTooltip.x + 12, top: chartTooltip.y - 8 }
            : { left: chartTooltip.x + 12, top: chartTooltip.y - 8 }}
        >
          {chartTooltip.kind === 'account' ? (
            <>
              <div className="font-bold text-ink mb-1">{chartTooltip.label} · {chartTooltip.count}곳</div>
              <div className="text-gray-text">합계 {won(chartTooltip.amount)}</div>
            </>
          ) : (
            <>
              <div className="font-bold text-ink mb-1.5">
                {chartTooltip.label} · {chartTooltip.countLabel} · 합계 {won(chartTooltip.total)}
              </div>
              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                {chartTooltip.rows.length === 0 ? (
                  <div className="text-gray-text">주문 내역이 없습니다</div>
                ) : chartTooltip.rows.map(r => (
                  <div key={r.key} className="flex justify-between gap-2">
                    <span className="text-gray-text flex-shrink-0">{r.time}</span>
                    <span className="text-ink font-semibold truncate text-right tabular-nums">{won(r.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 기간 선택 — 주문 홈과 같은 모달을 쓴다 */}
      {periodOpen && (
        <PeriodCalendarModal
          onClose={() => setPeriodOpen(false)}
          onApply={(s2, e2) => { handleRangeChange(s2, e2, '직접 선택'); setPeriodOpen(false) }}
        />
      )}

      {/* ── 주문 상세 모달 ──────────────────────────────────────────────────
          이 앱의 모달 틀을 그대로 따른다(OptionGroupEditModal · CategoryEditModal):
            헤더(제목만) / 스크롤 본문 / 테두리로 나뉜 푸터(약한 행동 왼쪽 · 주 행동 오른쪽)
          전엔 이것만 혼자 달랐다 — 오른쪽 위 ✕ 로 닫고, 본문·버튼이 한 덩어리로 흐르고,
          글자는 12px 로 다른 모달(13px)보다 한 단계 작았다. */}
      {selected && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center" onClick={() => setSelected(null)}>
          <div
            className="modal-in bg-[#FCFCFC] rounded-[18px] shadow-[0_2px_10px_rgba(44,38,31,0.08)] w-[460px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* 헤더 — 제목과 상태를 한 줄에. 상태는 이 주문을 어떻게 다룰지 정하는 값이라
                맨 위에 있어야 한다(전엔 제목 아래 오른쪽에 따로 떨어져 있었다) */}
            <div className="flex-shrink-0 px-[28px] pt-[24px] pb-[16px] flex items-center justify-between gap-[12px]">
              <div className="text-[18px] font-semibold text-[#1E1E1E]">주문 상세</div>
              <Badge label={selected.status} color={STATUS_COLOR[selected.status] ?? '#787878'} />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-[28px] pb-[20px]">
              <div className="space-y-[7px] mb-[18px]">
                <Row label="주문번호"  value={selected.orderNumber ? `#${selected.orderNumber}` : selected.code} mono />
                <Row label="거래처"    value={selected.accountName} />
                <Row label="주문자"    value={selected.orderer} />
                {selected.phone && (
                  <div className="flex justify-between items-baseline text-[13px] gap-3">
                    <span className="text-[#787878] flex-shrink-0">연락처</span>
                    <span className="flex items-center text-[#1E1E1E]">
                      {selected.phone}
                      <CopyBtn text={selected.phone} />
                    </span>
                  </div>
                )}
                <Row label="이용방법"  value={selected.method === '배달' ? '배달 (+3,500원)' : selected.method} />
                <Row label="주문일시"  value={formatDate(selected.createdAt)} />
                {selected.remarks && (() => {
                  const { deliveryAddress, deliveryDetail, deliveryNote, customerNote } = parseNote(selected.remarks)
                  return (
                    <>
                      {customerNote && <Row label="가게 요청사항" value={customerNote} />}
                      {deliveryAddress && (
                        <>
                          <div className="flex justify-between items-baseline text-[13px] gap-3">
                            <span className="text-[#787878] flex-shrink-0">배달 주소</span>
                            <span className="flex items-center text-[#1E1E1E] text-right max-w-[60%]">
                              <span className="truncate">{deliveryAddress}</span>
                              <CopyBtn text={deliveryAddress} />
                            </span>
                          </div>
                          {deliveryDetail && (
                            <div className="flex justify-between items-baseline text-[13px] gap-3">
                              <span className="text-[#787878] flex-shrink-0">배달 상세</span>
                              <span className="flex items-center text-[#1E1E1E]">
                                <span className="truncate">{deliveryDetail}</span>
                                <CopyBtn text={deliveryDetail} />
                              </span>
                            </div>
                          )}
                          {deliveryNote && (
                            <div className="flex justify-between items-baseline text-[13px] gap-3">
                              <span className="text-[#787878] flex-shrink-0">배달 요청사항</span>
                              <span className="flex items-center text-[#1E1E1E] text-right max-w-[60%]">
                                <span className="truncate">{deliveryNote}</span>
                                <CopyBtn text={deliveryNote} />
                              </span>
                            </div>
                          )}
                        </>
                      )}
                      {!deliveryAddress && !customerNote && <Row label="요청사항" value={selected.remarks} />}
                    </>
                  )
                })()}
              </div>

              {/* 주문 내용 — 다른 모달의 목록과 같은 테두리 카드(CategoryEditModal 메뉴 목록과 동일) */}
              <div className="text-[12px] font-medium text-[#2C261F] mb-[7px]">주문 내용</div>
              <div className="rounded-[11px] border border-[#E8E4E2] overflow-hidden">
                {selected.items.map((item, i) => (
                  <div key={i} className={`px-[13px] py-[10px] ${i > 0 ? 'border-t border-[#F2F2F2]' : ''}`}>
                    <div className="flex justify-between gap-[10px] text-[13px] text-[#1E1E1E]">
                      <span className="min-w-0">{item.name} × {item.qty}</span>
                      <span className="flex-shrink-0 tabular-nums">{won(item.price * item.qty)}</span>
                    </div>
                    {item.options.length > 0 && (
                      <div className="text-[11px] font-normal text-[#787878] mt-[3px] leading-relaxed">
                        {item.options.map(o => `· ${o}`).join('  ')}
                      </div>
                    )}
                  </div>
                ))}
                <div className="flex justify-between px-[13px] py-[10px] border-t border-[#E8E4E2] bg-[#F9F9F9]">
                  <span className="text-[13px] font-medium text-[#2C261F]">합계</span>
                  <span className="text-[14px] font-medium text-[#1E1E1E] tabular-nums">{won(selected.total)}</span>
                </div>
              </div>

              {reprintMsg && (
                <div className={`mt-[12px] text-[12px] font-normal ${reprintMsg.ok ? 'text-[#2C261F]' : 'text-danger'}`}>
                  {reprintMsg.text}
                </div>
              )}
            </div>

            {/* 푸터 — 약한 행동(삭제) 왼쪽, 주 행동(재출력) 오른쪽 */}
            <div className="flex-shrink-0 modal-footer px-[28px] py-[14px] flex items-center justify-between">
              {selected.isDeleted ? (
                <span className="text-[12px] text-[#ADADAD]">삭제된 주문이에요</span>
              ) : (
                <button
                  onClick={() => setDeleteConfirmCode(selected.code)}
                  className="h-[30px] px-[11px] rounded-[8px] text-[#C92A2A] text-[12px] hover:bg-[#FFEFEF] transition-colors"
                >
                  삭제
                </button>
              )}
              <div className="flex items-center gap-[9px]">
                <button
                  onClick={() => setSelected(null)}
                  className="h-[38px] px-[16px] rounded-[9px] bg-[#F2F2F2] text-[#787878] text-[13px] font-medium hover:bg-[#E8E4E2] transition-colors"
                >
                  닫기
                </button>
                {selected.isDeleted ? (
                  <button
                    onClick={() => handleRestoreOrder(selected.code)}
                    className="h-[38px] px-[20px] rounded-[9px] bg-[#2C261F] text-[#F9F9F9] text-[13px] font-medium hover:opacity-90 transition-opacity"
                  >
                    주문 복구
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      setReprintMsg(null)
                      const w = window as unknown as { api?: { reprintOrder?: (p: unknown) => Promise<{ ok: boolean; error?: string }> } }
                      const res = await w.api?.reprintOrder?.({ order: orderToPayload(selected, storeName) })
                      if (!res) return
                      setReprintMsg(res.ok
                        ? { ok: true,  text: '영수증을 출력합니다' }
                        : { ok: false, text: res.error ?? '출력 실패' }
                      )
                      setTimeout(() => setReprintMsg(null), 3000)
                    }}
                    className="h-[38px] px-[20px] rounded-[9px] bg-[#2C261F] text-[#F9F9F9] text-[13px] font-medium hover:opacity-90 transition-opacity"
                  >
                    영수증 재출력
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 주문 삭제 확인 — 카테고리 삭제와 같은 다이얼로그 */}
      {deleteConfirmCode && (
        <ConfirmDialog
          title="이 주문을 삭제하시겠어요?"
          description="매출 집계에서 빠지고, 차감했던 잔액은 거래처에 돌아가요. 주문 내역에서 다시 복구할 수 있어요."
          tone="danger"
          confirmLabel="삭제"
          cancelLabel="아니요"
          onConfirm={() => { const c = deleteConfirmCode; setDeleteConfirmCode(null); handleDeleteOrder(c) }}
          onCancel={() => setDeleteConfirmCode(null)}
        />
      )}

      {/* 거래처별 상세 모달 */}
      {tab === '거래처별매출' && selectedAccountName && (() => {
        const as = accountSales.find(a => a.name === selectedAccountName)!
        const relatedOrders = orders.filter(
          o => o.status !== '취소' && o.accountName === selectedAccountName
        )
        return (
          <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center" onClick={() => setSelectedAccountName(null)}>
            <div className="modal-in bg-[#FCFCFC] rounded-[18px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] w-[460px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-[15px] font-semibold text-[#1E1E1E]">{selectedAccountName}</div>
                    <div className="text-[11px] text-gray-text mt-0.5">총 {as.count}건 · {won(as.total)}</div>
                  </div>
                  <button onClick={() => setSelectedAccountName(null)}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-bg text-gray-text hover:text-ink transition-colors">✕</button>
                </div>
                <div className="border-t border-gray-border mb-3" />
                <div className="text-[12px] font-medium text-[#2C261F] mb-2.5">주문 내역 ({relatedOrders.length}건)</div>
                <div className="space-y-2.5">
                  {relatedOrders.map(order => (
                    <div key={order.code} className="bg-[#F2F2F2] rounded-[10px] p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-gray-text">{formatDate(order.createdAt)}</span>
                        <div className="flex items-center gap-1.5">
                          <Badge label={order.method} color={METHOD_COLOR[order.method] ?? '#ADADAD'} />
                          <span className="text-[11px] font-medium text-[#1E1E1E]">{won(order.total)}</span>
                        </div>
                      </div>
                      <div className="text-[11px] text-gray-text mb-1">{order.orderer}</div>
                      <div className="space-y-0.5">
                        {order.items.map((item, i) => (
                          <div key={i} className="flex justify-between text-[11px]">
                            <span className="text-ink">{item.name} × {item.qty}</span>
                            <span className="text-gray-text">{won(item.price * item.qty)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* 메뉴별 상세 모달 */}
      {tab === '메뉴별매출' && selectedMenuName && (() => {
        const ms = menuSales.find(m => m.name === selectedMenuName)!
        const relatedOrders = orders.filter(
          o => o.status !== '취소' && o.items.some(i => i.name === selectedMenuName)
        )
        return (
          <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center" onClick={() => setSelectedMenuName(null)}>
            {/* 스크롤은 **안쪽 영역에만** 건다.
                전에는 overflow-y-auto 가 둥근 모서리를 가진 바깥 컨테이너에 걸려 있어
                스크롤바가 모달 위쪽 모서리 밖으로 삐져나왔다.
                머리말(제목·닫기)은 스크롤 밖에 고정 — 긴 목록에서 제목이 사라지지 않는다. */}
            <div className="modal-in bg-[#FCFCFC] rounded-[18px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] w-[460px] max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-6 pt-6 pb-3 flex-shrink-0 border-b border-gray-border">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[15px] font-semibold text-[#1E1E1E]">{selectedMenuName}</div>
                    <div className="text-[11px] text-gray-text mt-0.5">총 {ms.qty}개 · {won(ms.total)}</div>
                  </div>
                  <button onClick={() => setSelectedMenuName(null)}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-bg text-gray-text hover:text-ink transition-colors">✕</button>
                </div>
              </div>
              <div className="px-6 pb-6 pt-4 flex-1 min-h-0 overflow-y-auto">
                <div className="text-[12px] font-medium text-[#2C261F] mb-2.5">주문 내역 ({relatedOrders.length}건)</div>
                <div className="space-y-2.5">
                  {relatedOrders.map(order => {
                    const thisItem  = order.items.find(i => i.name === selectedMenuName)!
                    const otherItems = order.items.filter(i => i.name !== selectedMenuName)
                    return (
                      <div key={order.code} className="bg-[#F2F2F2] rounded-[10px] p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="text-[11px] font-normal text-[#787878]">{formatDate(order.createdAt)}</div>
                          <Badge label={order.method} color={METHOD_COLOR[order.method] ?? '#ADADAD'} />
                        </div>
                        <div className="text-[11px] font-semibold text-ink mb-1.5">
                          {order.accountName}<span className="text-gray-text font-normal"> · {order.orderer}</span>
                        </div>
                        <div className="bg-[#FCFCFC] rounded-[9px] px-3 py-1.5 mb-1.5 border border-[#E5E5E5]">
                          <div className="flex justify-between text-[11px] font-medium text-[#1E1E1E]">
                            <span>{selectedMenuName} × {thisItem.qty}</span>
                            <span>{won(thisItem.price * thisItem.qty)}</span>
                          </div>
                          {thisItem.options.length > 0 && (
                            <div className="text-[11px] text-gray-text mt-0.5">{thisItem.options.map(o => `▶ ${o}`).join('  ')}</div>
                          )}
                        </div>
                        {otherItems.map((item, i) => (
                          <div key={i} className="flex justify-between text-[11px] text-gray-text px-1 py-0.5">
                            <span>{item.name} × {item.qty}</span>
                            <span>{won(item.price * item.qty)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between text-[11px] font-medium text-[#1E1E1E] mt-1.5 pt-1.5 border-t border-[#E5E5E5]">
                          <span>주문 합계</span><span>{won(order.total)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
