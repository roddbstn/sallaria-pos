import { useState, useMemo, useEffect, useRef } from 'react'
import { type Order } from '../lib/mock-data'
import { won, formatDate, orderToPayload, parseNote } from '../lib/ipc'
import { supabase } from '../lib/supabase'
import { mapOrderRow } from '../lib/mappers'
import { useStore } from '../lib/store-context'
import { useHeaderSlot } from '../lib/header-slot'

// parseNote는 lib/ipc.ts에서 import

// 인라인 복사 버튼
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}
      className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 transition-colors"
      style={copied ? { backgroundColor: '#E6F4EC', color: '#16a84c' } : { backgroundColor: '#F0F0F0', color: '#727272' }}
    >
      {copied ? '✓ 복사됨' : '복사'}
    </button>
  )
}

// mapOrderRow는 lib/mappers.ts에서 import

// ── 상태 필터 옵션 ─────────────────────────────────────────────────────────────
const STATUS_OPTIONS: { label: string; value: OrderStatus | 'all' }[] = [
  { label: '전체',    value: 'all' },
  { label: '주문완료', value: '주문완료' },
  { label: '조리중',  value: '조리중' },
  { label: '완료',    value: '완료' },
  { label: '취소',    value: '취소' },
]

const STATUS_BADGE: Record<string, string> = {
  '주문완료': 'bg-blue-100 text-blue-700',
  '조리중':   'bg-yellow-100 text-yellow-700',
  '완료':     'bg-green-soft text-green',
  '취소':     'bg-red-100 text-danger',
}

const METHOD_BADGE: Record<string, string> = {
  '포장':      'bg-blue-50 text-blue-600',
  '매장 식사': 'bg-purple-50 text-purple-600',
  '배달':      'bg-orange-50 text-orange-600',
}

// ── 날짜 유틸 ─────────────────────────────────────────────────────────────────
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

function formatDisplay(ymd: string): string {
  return ymd.replace(/-/g, '.')
}

function orderDate(iso: string): string {
  return iso.slice(0, 10)
}

// ── 캘린더 컴포넌트 ───────────────────────────────────────────────────────────
interface CalendarProps {
  startDate: string | null
  endDate:   string | null
  onSelect:  (ymd: string) => void
}

const WEEK_DAYS   = ['일', '월', '화', '수', '목', '금', '토']
const MONTH_NAMES = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

type CalView = 'days' | 'months' | 'years'

function Calendar({ startDate, endDate, onSelect }: CalendarProps) {
  const today = toYMD(new Date())
  const [viewYear,  setViewYear]  = useState(() => new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth())
  const [calView,   setCalView]   = useState<CalView>('days')
  const [yearBase,  setYearBase]  = useState(() => Math.floor(new Date().getFullYear() / 12) * 12)

  function prevNav() {
    if (calView === 'years')  setYearBase(b => b - 12)
    else if (calView === 'months') setViewYear(y => y - 1)
    else {
      if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
      else setViewMonth(m => m - 1)
    }
  }
  function nextNav() {
    if (calView === 'years')  setYearBase(b => b + 12)
    else if (calView === 'months') setViewYear(y => y + 1)
    else {
      if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
      else setViewMonth(m => m + 1)
    }
  }

  const firstDay  = new Date(viewYear, viewMonth, 1)
  const lastDay   = new Date(viewYear, viewMonth + 1, 0)
  const startWday = firstDay.getDay()
  const totalDays = lastDay.getDate()
  const cells: (number | null)[] = [
    ...Array(startWday).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  function cellYMD(day: number): string {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const isSingleDay = startDate && endDate && startDate === endDate

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-2.5">
        <button
          onClick={prevNav}
          className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-bg text-gray-text hover:text-ink transition-colors text-[18px] focus:outline-none"
        >‹</button>

        {calView === 'days' ? (
          <div className="flex gap-1 text-[12px] font-bold text-ink">
            <button onClick={() => setCalView('years')} className="hover:text-green transition-colors focus:outline-none">{viewYear}년</button>
            <button onClick={() => setCalView('months')} className="hover:text-green transition-colors focus:outline-none">{viewMonth + 1}월</button>
          </div>
        ) : calView === 'months' ? (
          <button onClick={() => setCalView('days')} className="text-[12px] font-bold text-ink hover:text-green transition-colors focus:outline-none">{viewYear}년</button>
        ) : (
          <button onClick={() => setCalView('days')} className="text-[12px] font-bold text-ink hover:text-green transition-colors focus:outline-none">{yearBase} – {yearBase + 11}</button>
        )}

        <button
          onClick={nextNav}
          className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-bg text-gray-text hover:text-ink transition-colors text-[18px] focus:outline-none"
        >›</button>
      </div>

      {calView === 'years' && (
        <div className="grid grid-cols-4 gap-1">
          {Array.from({ length: 12 }, (_, i) => yearBase + i).map(yr => (
            <button key={yr} onClick={() => { setViewYear(yr); setCalView('months') }}
              className={`py-1.5 rounded-lg text-[11px] font-semibold transition-colors focus:outline-none ${viewYear === yr ? 'text-white' : 'text-ink hover:bg-gray-bg'}`}
              style={viewYear === yr ? { backgroundColor: '#16a84c' } : undefined}>{yr}</button>
          ))}
        </div>
      )}

      {calView === 'months' && (
        <div className="grid grid-cols-3 gap-1">
          {MONTH_NAMES.map((name, i) => (
            <button key={name} onClick={() => { setViewMonth(i); setCalView('days') }}
              className={`py-2 rounded-lg text-[11px] font-semibold transition-colors focus:outline-none ${viewMonth === i ? 'text-white' : 'text-ink hover:bg-gray-bg'}`}
              style={viewMonth === i ? { backgroundColor: '#16a84c' } : undefined}>{name}</button>
          ))}
        </div>
      )}

      {calView === 'days' && (
        <>
          <div className="grid grid-cols-7 mb-1">
            {WEEK_DAYS.map((d, i) => (
              <div key={d} className={`text-center text-[11px] font-bold py-1 ${i === 0 ? 'text-danger' : i === 6 ? 'text-blue-500' : 'text-gray-text'}`}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, idx) => {
              if (day === null) return <div key={`e-${idx}`} className="h-8" />
              const ymd     = cellYMD(day)
              const isS     = ymd === startDate
              const isE     = ymd === endDate
              const inRange = !!(startDate && endDate && ymd > startDate && ymd < endDate)
              const isSel   = isS || isE
              const isToday = ymd === today
              const isSun   = idx % 7 === 0
              const isSat   = idx % 7 === 6
              const showStrip = !isSingleDay && startDate !== null && endDate !== null && (inRange || isS || isE)
              const stripLeft  = isS ? '50%' : '0'
              const stripRight = isE ? '50%' : '0'
              return (
                <div key={ymd} className="relative h-8 flex items-center justify-center">
                  {showStrip && (
                    <div style={{ position: 'absolute', top: '3px', bottom: '3px', left: stripLeft, right: stripRight, backgroundColor: '#E6F4EC', zIndex: 0 }} />
                  )}
                  <button onClick={() => onSelect(ymd)}
                    className={`relative z-10 w-7 h-7 rounded-full text-[11px] font-medium transition-colors focus:outline-none
                      ${isSel ? 'text-white' : inRange ? 'text-ink hover:bg-green-soft' : isSun ? 'text-danger hover:bg-gray-bg' : isSat ? 'text-blue-500 hover:bg-gray-bg' : 'text-ink hover:bg-gray-bg'}`}
                    style={isSel ? { backgroundColor: '#16a84c' } : undefined}>
                    {day}
                    {isToday && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3 h-0.5 rounded-full" style={{ backgroundColor: isSel ? 'white' : '#16a84c' }} />
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── 좌측 패널 — 캘린더 + 날짜 범위 ──────────────────────────────────────────
interface DateRangePanelProps {
  startDate: string | null
  endDate:   string | null
  onRangeChange: (start: string | null, end: string | null) => void
}

function DateRangePanel({ startDate, endDate, onRangeChange }: DateRangePanelProps) {
  const [picking, setPicking] = useState<'start' | 'end'>('start')
  const [activeQuick, setActiveQuick] = useState<string | null>('오늘')

  function handleDaySelect(ymd: string) {
    setActiveQuick(null)
    if (picking === 'start') {
      onRangeChange(ymd, null)
      setPicking('end')
    } else {
      if (startDate && ymd < startDate) {
        onRangeChange(ymd, startDate)
      } else {
        onRangeChange(startDate, ymd)
      }
      setPicking('start')
    }
  }

  function setQuick(label: string, start: string, end: string) {
    setActiveQuick(label)
    onRangeChange(start, end)
    setPicking('start')
  }

  const today = toYMD(new Date())

  function getLast7Days(): [string, string] {
    const now  = new Date()
    const from = new Date(now); from.setDate(now.getDate() - 6)
    return [toYMD(from), today]
  }
  function getThisMonth(): [string, string] {
    const now  = new Date()
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return [toYMD(from), today]
  }
  function getLastMonth(): [string, string] {
    const now  = new Date()
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to   = new Date(now.getFullYear(), now.getMonth(), 0)
    return [toYMD(from), toYMD(to)]
  }
  function getYesterday(): string {
    const d = new Date(); d.setDate(d.getDate() - 1); return toYMD(d)
  }
  function getLast3Months(): [string, string] {
    const now  = new Date()
    const from = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    return [toYMD(from), today]
  }
  function getLast6Months(): [string, string] {
    const now  = new Date()
    const from = new Date(now.getFullYear(), now.getMonth() - 6, 1)
    return [toYMD(from), today]
  }
  function getThisYear(): [string, string] {
    const now  = new Date()
    return [toYMD(new Date(now.getFullYear(), 0, 1)), today]
  }

  const quickButtons = [
    { label: '오늘',       onClick: () => setQuick('오늘',       today, today) },
    { label: '어제',       onClick: () => { const y = getYesterday(); setQuick('어제', y, y) } },
    { label: '지난 7일',   onClick: () => { const [s,e] = getLast7Days();   setQuick('지난 7일',   s, e) } },
    { label: '이번 달',    onClick: () => { const [s,e] = getThisMonth();   setQuick('이번 달',    s, e) } },
    { label: '지난 달',    onClick: () => { const [s,e] = getLastMonth();   setQuick('지난 달',    s, e) } },
    { label: '지난 3개월', onClick: () => { const [s,e] = getLast3Months(); setQuick('지난 3개월', s, e) } },
    { label: '지난 6개월', onClick: () => { const [s,e] = getLast6Months(); setQuick('지난 6개월', s, e) } },
    { label: '올해',       onClick: () => { const [s,e] = getThisYear();    setQuick('올해',       s, e) } },
  ]

  return (
    <div className="w-[240px] flex-shrink-0 flex flex-col overflow-y-auto bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="px-3 py-3 flex-1">
        <Calendar startDate={startDate} endDate={endDate} onSelect={handleDaySelect} />
        {!startDate && (
          <p className="text-[11px] text-gray-text mt-2 text-center">
            {picking === 'start' ? '시작일을 클릭하세요' : '종료일을 클릭하세요'}
          </p>
        )}
        {startDate && (
          <div className="mt-2.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold text-center" style={{ backgroundColor: '#E6F4EC', color: '#16a84c' }}>
            {startDate && endDate && startDate !== endDate
              ? `${formatDisplay(startDate)} ~ ${formatDisplay(endDate)}`
              : startDate ? formatDisplay(startDate) : '날짜를 선택하세요'}
          </div>
        )}
        <div className="mt-3 space-y-1">
          <p className="text-[11px] font-bold text-gray-text mb-1.5">빠른 선택</p>
          {quickButtons.map(btn => (
            <button key={btn.label} onClick={btn.onClick}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors
                ${activeQuick === btn.label
                  ? 'bg-green-soft text-green font-bold'
                  : 'bg-gray-100 text-ink hover:bg-gray-200'}`}>
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 통계 카드 ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, wide }: { label: string; value: string; sub?: string; wide?: boolean }) {
  return (
    <div className={`${wide ? 'flex-[2]' : 'flex-[1]'} bg-white rounded-xl shadow-sm p-3`}>
      <div className="text-[11px] font-medium text-ink mb-1">{label}</div>
      <div className="text-[16px] font-extrabold text-ink leading-tight whitespace-nowrap">{value}</div>
      {sub && <div className="text-[10px] text-[#AAAAAA] mt-0.5">{sub}</div>}
    </div>
  )
}

// ── 메뉴별 매출 집계 ──────────────────────────────────────────────────────────
interface MenuSales { name: string; qty: number; total: number }

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
    <div className="flex justify-between text-[12px]">
      <span className="text-gray-text">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} ${bold ? 'font-bold text-ink' : 'text-ink'}`}>{value}</span>
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function Orders() {
  const { storeName, storeId } = useStore()
  const { setHeaderRight } = useHeaderSlot()
  const today = toYMD(new Date())

  const [startDate, setStartDate] = useState<string | null>(today)
  const [endDate,   setEndDate]   = useState<string | null>(today)
  const [tab,       setTab]       = useState<'주문내역' | '메뉴별매출' | '거래처별매출'>('주문내역')
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all')
  const [methodFilter, setMethodFilter] = useState<string | 'all'>('all')
  const [selected,     setSelected]     = useState<Order | null>(null)
  const [selectedMenuName,    setSelectedMenuName]    = useState<string | null>(null)
  const [selectedAccountName, setSelectedAccountName] = useState<string | null>(null)
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
        ordered_at, total_amount, balance_before, balance_after,
        method, status, note, is_deleted,
        accounts ( account_name ),
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

  async function handleDeleteOrder(code: string) {
    const { error } = await supabase
      .from('orders')
      .update({ is_deleted: true })
      .eq('order_code', code)
    if (error) { console.error('삭제 실패:', error); return }
    setDeleteConfirmCode(null)
    setSelected(null)
    fetchOrders(startDate, endDate, false)
  }

  async function handleRestoreOrder(orderCode: string) {
    const { error } = await supabase
      .from('orders')
      .update({ is_deleted: false })
      .eq('order_code', orderCode)
    if (error) { console.error('복구 실패:', error); return }
    setSelected(null)
    fetchOrders(startDate, endDate, true)
  }

  // 날짜 범위 or 삭제 보기 토글 시 재조회
  useEffect(() => {
    setDeleteConfirmCode(null)
    fetchOrders(startDate, endDate, showDeleted)
  }, [startDate, endDate, showDeleted])

  function handleRangeChange(s: string | null, e: string | null) {
    setStartDate(s)
    setEndDate(e)
    setSelected(null)
    setSelectedMenuName(null)
    setDeleteConfirmCode(null)
  }

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

  // 거래처 필터 버튼을 공유 헤더 바에 주입
  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2">
        {tab === '주문내역' && (
          <button
            onClick={() => { setShowDeleted(v => !v); setSelected(null) }}
            className={`px-3 py-2 rounded-lg text-[11px] font-bold transition-colors
              ${showDeleted ? 'bg-gray-400 text-white hover:bg-gray-500' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
            {showDeleted ? '← 일반 주문' : '삭제된 주문'}
          </button>
        )}
        <div ref={filterBtnRef} className="relative">
          <button
            onClick={() => setShowAccountFilter(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold transition-colors
              ${excludedAccounts.size > 0
                ? 'bg-orange-500 text-white hover:bg-orange-600'
                : 'bg-[#16a84c] text-white hover:bg-[#128040]'}`}
          >
            {excludedAccounts.size > 0 ? `${excludedAccounts.size}명 제외 중` : '거래처 필터'}
          </button>

        {showAccountFilter && (
          <div className="absolute right-0 top-full mt-1 w-[280px] bg-white rounded-xl shadow-xl border border-gray-border z-30 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-border">
              <span className="text-[12px] font-bold text-ink">거래처 필터</span>
              {excludedAccounts.size > 0 && (
                <button
                  onClick={() => setExcludedAccounts(new Set())}
                  className="text-[11px] text-orange-600 font-semibold hover:text-orange-800 transition-colors"
                >
                  모두 포함
                </button>
              )}
            </div>
            <div className="max-h-[240px] overflow-y-auto">
              {allAccountSales.length === 0 ? (
                <div className="px-4 py-5 text-center text-[12px] text-gray-text">이 기간에 주문이 없습니다</div>
              ) : allAccountSales.map(acc => (
                <label key={acc.name} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-bg cursor-pointer">
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
                    className="w-4 h-4 accent-[#16a84c] flex-shrink-0"
                  />
                  <span className="flex-1 text-[12px] text-ink truncate">{acc.name}</span>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[11px] text-gray-text">{acc.count}건</div>
                    <div className="text-[11px] font-semibold text-ink">{won(acc.total)}</div>
                  </div>
                </label>
              ))}
            </div>
            <div className="border-t border-gray-border px-3 py-2 bg-gray-bg">
              <button
                onClick={() => setShowAccountFilter(false)}
                className="w-full py-1.5 rounded-lg bg-ink text-white text-[12px] font-bold hover:bg-ink/80 transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    )
    return () => setHeaderRight(null)
  }, [showAccountFilter, excludedAccounts, allAccountSales, tab, showDeleted])

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
  const listFiltered = useMemo(
    () => filteredOrders.filter(o =>
      (statusFilter === 'all' || o.status === statusFilter) &&
      (methodFilter === 'all' || o.method === methodFilter)
    ),
    [filteredOrders, statusFilter, methodFilter],
  )

  const STATUS_CYCLE: (OrderStatus | 'all')[] = ['all', '주문완료', '조리중', '완료', '취소']
  const METHOD_CYCLE: (string | 'all')[] = ['all', '포장', '매장 식사', '배달']

  function cycleStatus() {
    const idx = STATUS_CYCLE.indexOf(statusFilter)
    setStatusFilter(STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length])
  }
  function cycleMethod() {
    const idx = METHOD_CYCLE.indexOf(methodFilter)
    setMethodFilter(METHOD_CYCLE[(idx + 1) % METHOD_CYCLE.length])
  }

  // 메뉴별 매출
  const menuSales = useMemo(() => calcMenuSales(filteredOrders), [filteredOrders])

  // 거래처별 매출
  const accountSales = useMemo(() => calcAccountSales(filteredOrders), [filteredOrders])

  return (
    <div className="h-full flex overflow-hidden bg-gray-bg gap-3 p-3">

      {/* 중앙 */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0 gap-3">

        {/* 통계 카드 */}
        <div className="flex gap-2.5 flex-shrink-0">
          <StatCard label="합계 주문액"    value={won(stats.totalSales)} sub={excludedAccounts.size > 0 ? `${excludedAccounts.size}개 제외` : '취소 제외'} wide />
          <StatCard label="일 평균 주문액"  value={won(stats.avgSales)}   sub={`${dayCount(startDate, endDate)}일 기준`} wide />
          <StatCard label="주문 건수"       value={`${stats.orderCount}건`} sub={excludedAccounts.size > 0 ? `${excludedAccounts.size}개 제외` : '취소 제외'} />
          <StatCard label="취소 건수"       value={`${stats.cancelCount}건`} />
        </div>

        {/* 탭 + 콘텐츠 */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0 bg-white rounded-xl shadow-sm">

        {/* 탭 */}
        <div className="px-4 pt-2.5 pb-0 flex-shrink-0 border-b border-gray-border">
          <div className="flex gap-1">
            {(['주문내역', '메뉴별매출', '거래처별매출'] as const).map(t => (
              <button key={t} onClick={() => handleTabChange(t)}
                className={`px-3 py-1.5 text-[12px] font-semibold border-b-2 transition-colors -mb-px
                  ${tab === t ? 'border-ink text-ink' : 'border-transparent text-gray-text hover:text-ink'}`}>
                {t === '주문내역' ? '주문 내역' : t === '메뉴별매출' ? '메뉴별 주문액' : '거래처별 주문액'}
              </button>
            ))}
          </div>
        </div>

        {/* 탭 콘텐츠 */}
        {tab === '주문내역' ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 테이블 헤더 */}
            <div className="grid grid-cols-[60px_1fr_62px_66px_80px_58px] px-4 py-1.5 bg-gray-bg text-[11px] font-bold text-gray-text uppercase tracking-wide border-b border-gray-border flex-shrink-0">
              <span>주문번호</span>
              <span>거래처 · 주문자</span>
              <span>주문일시</span>
              <button
                onClick={cycleMethod}
                className={`flex items-center gap-0.5 transition-colors ${methodFilter !== 'all' ? 'text-[#16a84c]' : 'hover:text-ink'}`}>
                이용방법{methodFilter !== 'all' && <span className="font-normal ml-0.5">({methodFilter})</span>}
              </button>
              <span className="text-right">금액</span>
              <button
                onClick={cycleStatus}
                className={`text-center transition-colors ${statusFilter !== 'all' ? 'text-[#16a84c]' : 'hover:text-ink'}`}>
                상태{statusFilter !== 'all' && <span className="font-normal ml-0.5">({statusFilter})</span>}
              </button>
            </div>

            {/* 목록 */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-border">
              {loading ? (
                <div className="h-full flex items-center justify-center text-gray-text text-[12px]">
                  <div className="w-5 h-5 border-2 border-green border-t-transparent rounded-full animate-spin mr-2" />
                  불러오는 중...
                </div>
              ) : listFiltered.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-text text-[12px]">
                  해당 기간에 주문이 없습니다
                </div>
              ) : (
                listFiltered.map(order => {
                  return (
                    <button key={order.code}
                      className={`w-full grid grid-cols-[60px_1fr_62px_66px_80px_58px] px-4 py-2.5 text-[12px] transition-colors items-center text-left
                        ${selected?.code === order.code ? 'bg-green-soft' : 'hover:bg-gray-bg'}`}
                      onClick={() => { setSelected(order); setDeleteConfirmCode(null) }}>
                        <span className="font-mono text-[11px] text-gray-text">#{order.orderNumber ?? order.code.slice(0, 6)}</span>
                        <span className="font-semibold text-ink whitespace-nowrap overflow-hidden text-ellipsis">
                          {order.accountName}
                          <span className="text-gray-text font-normal ml-1">· {order.orderer}</span>
                        </span>
                        <span className="text-[11px] text-gray-text">{formatDate(order.createdAt)}</span>
                        <span>
                          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${METHOD_BADGE[order.method]}`}>{order.method}</span>
                        </span>
                        <span className="font-bold text-right">{won(order.total)}</span>
                        <span className="text-center">
                          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_BADGE[order.status]}`}>{order.status}</span>
                        </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        ) : tab === '메뉴별매출' ? (
          /* 메뉴별 매출 탭 */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="grid grid-cols-[1fr_68px_88px_76px] px-4 py-1.5 bg-gray-bg text-[11px] font-bold text-gray-text uppercase tracking-wide border-b border-gray-border flex-shrink-0">
              <span>메뉴명</span>
              <span className="text-right">주문수량</span>
              <span className="text-right">주문액</span>
              <span className="text-right">평균단가</span>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-border">
              {menuSales.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-text text-[12px]">
                  해당 기간에 주문액 데이터가 없습니다
                </div>
              ) : (
                menuSales.map((ms, idx) => (
                  <button key={ms.name} onClick={() => setSelectedMenuName(ms.name)}
                    className={`w-full grid grid-cols-[1fr_68px_88px_76px] px-4 py-2.5 text-left text-[12px] transition-colors
                      ${selectedMenuName === ms.name ? 'bg-green-soft' : 'hover:bg-gray-bg'}`}>
                    <span className="font-semibold text-ink flex items-center gap-1.5">
                      {idx === 0 && <span>🏆</span>}
                      {ms.name}
                    </span>
                    <span className="text-right text-gray-text">{ms.qty}개</span>
                    <span className="text-right font-bold text-ink">{won(ms.total)}</span>
                    <span className="text-right text-gray-text">{won(Math.round(ms.total / ms.qty / 10) * 10)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          /* 거래처별 주문액 탭 */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="grid grid-cols-[1fr_72px_72px_120px] px-4 py-1.5 bg-gray-bg text-[11px] font-bold text-gray-text uppercase tracking-wide border-b border-gray-border flex-shrink-0">
              <span>거래처명</span>
              <span className="text-right">주문건수</span>
              <span className="text-right">주문인 수</span>
              <span className="text-right">주문액</span>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-border">
              {accountSales.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-text text-[12px]">
                  해당 기간에 주문액 데이터가 없습니다
                </div>
              ) : (
                accountSales.map((as, idx) => (
                  <button key={as.name} onClick={() => setSelectedAccountName(as.name)}
                    className={`w-full grid grid-cols-[1fr_72px_72px_120px] px-4 py-2.5 text-left text-[12px] transition-colors
                      ${selectedAccountName === as.name ? 'bg-green-soft' : 'hover:bg-gray-bg'}`}>
                    <span className="font-semibold text-ink flex items-center gap-1.5">
                      {idx === 0 && <span>🏆</span>}
                      {as.name}
                    </span>
                    <span className="text-right text-gray-text">{as.count}건</span>
                    <span className="text-right text-gray-text">{as.ordererCount}명</span>
                    <span className="text-right font-bold text-ink">{won(as.total)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
        </div>{/* end 탭+콘텐츠 흰 박스 */}
      </div>{/* end 중앙 컬럼 */}

      {/* 우측: 캘린더 패널 */}
      <DateRangePanel startDate={startDate} endDate={endDate} onRangeChange={handleRangeChange} />

      {/* 주문 상세 모달 */}
      {selected && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-[400px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="text-[15px] font-extrabold text-ink">주문 상세</div>
                <button onClick={() => setSelected(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-bg text-gray-text hover:text-ink transition-colors">✕</button>
              </div>
              <div className="space-y-2 mb-4">
                <Row label="주문번호"  value={selected.orderNumber ? `#${selected.orderNumber}` : selected.code} mono />
                <Row label="거래처"    value={selected.accountName} />
                <Row label="주문자"    value={selected.orderer} />
                {selected.phone && (
                  <div className="flex justify-between text-[12px]">
                    <span className="text-gray-text">연락처</span>
                    <span className="flex items-center text-ink">
                      {selected.phone}
                      <CopyBtn text={selected.phone} />
                    </span>
                  </div>
                )}
                <Row label="이용방법"  value={selected.method === '배달' ? '배달 (+3,500원)' : selected.method} />
                <Row label="주문일시"  value={formatDate(selected.createdAt)} />
                <Row label="합계"      value={won(selected.total)} bold />
                {selected.remarks && (() => {
                  const { deliveryAddress, deliveryDetail, deliveryNote, customerNote } = parseNote(selected.remarks)
                  return (
                    <>
                      {customerNote && <Row label="가게 요청사항" value={customerNote} />}
                      {deliveryAddress && (
                        <>
                          <div className="flex justify-between text-[12px]">
                            <span className="text-gray-text">배달 주소</span>
                            <span className="flex items-center text-ink text-right max-w-[60%]">
                              <span className="truncate">{deliveryAddress}</span>
                              <CopyBtn text={deliveryAddress} />
                            </span>
                          </div>
                          {deliveryDetail && (
                            <div className="flex justify-between text-[12px]">
                              <span className="text-gray-text">배달 상세</span>
                              <span className="flex items-center text-ink">
                                <span className="truncate">{deliveryDetail}</span>
                                <CopyBtn text={deliveryDetail} />
                              </span>
                            </div>
                          )}
                          {deliveryNote && (
                            <div className="flex justify-between text-[12px]">
                              <span className="text-gray-text">배달 요청사항</span>
                              <span className="flex items-center text-ink text-right max-w-[60%]">
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
              <div className="bg-gray-bg rounded-xl p-3 mb-4 space-y-2.5">
                {selected.items.map((item, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-[12px] font-semibold text-ink">
                      <span>{item.name} × {item.qty}</span>
                      <span>{won(item.price * item.qty)}</span>
                    </div>
                    {item.options.length > 0 && (
                      <div className="text-[11px] text-gray-text mt-0.5 ml-1">
                        {item.options.map(o => `▶ ${o}`).join('  ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-[12px] text-gray-text font-semibold">현재 상태</span>
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${STATUS_BADGE[selected.status]}`}>{selected.status}</span>
              </div>
              {selected.isDeleted ? (
                <button
                  onClick={() => handleRestoreOrder(selected.code)}
                  className="w-full py-2 rounded-xl text-[12px] font-bold text-green hover:bg-green-soft transition-colors border border-green/30">
                  주문 복구
                </button>
              ) : (
                <>
                  {deleteConfirmCode === selected.code ? (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="flex-1 text-[12px] text-danger font-semibold">정말 삭제할까요?</span>
                      <button onClick={() => handleDeleteOrder(selected.code)}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-bold bg-danger text-white hover:bg-red-700 transition-colors">
                        삭제
                      </button>
                      <button onClick={() => setDeleteConfirmCode(null)}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-gray-100 text-gray-text hover:bg-gray-200 transition-colors">
                        취소
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteConfirmCode(selected.code)}
                      className="w-full py-2 rounded-xl text-[12px] font-bold bg-[#FFCDD2] text-[#C62828] hover:bg-red-200 transition-colors mb-2">
                      주문 삭제
                    </button>
                  )}
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
                    className="w-full py-2 rounded-xl border-2 border-gray-border text-[12px] font-bold text-gray-text hover:bg-gray-bg transition-colors">
                    🖨 영수증 재출력
                  </button>
                  {reprintMsg && (
                    <div className={`mt-2 text-center text-[11px] font-semibold ${reprintMsg.ok ? 'text-green' : 'text-danger'}`}>
                      {reprintMsg.ok ? '✅' : '⚠️'} {reprintMsg.text}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 거래처별 상세 모달 */}
      {tab === '거래처별매출' && selectedAccountName && (() => {
        const as = accountSales.find(a => a.name === selectedAccountName)!
        const relatedOrders = orders.filter(
          o => o.status !== '취소' && o.accountName === selectedAccountName
        )
        return (
          <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center" onClick={() => setSelectedAccountName(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-[400px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-[14px] font-extrabold text-ink">{selectedAccountName}</div>
                    <div className="text-[11px] text-gray-text mt-0.5">총 {as.count}건 · {won(as.total)}</div>
                  </div>
                  <button onClick={() => setSelectedAccountName(null)}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-bg text-gray-text hover:text-ink transition-colors">✕</button>
                </div>
                <div className="border-t border-gray-border mb-3" />
                <div className="text-[11px] font-bold text-gray-text mb-2.5 uppercase tracking-wide">주문 내역 ({relatedOrders.length}건)</div>
                <div className="space-y-2.5">
                  {relatedOrders.map(order => (
                    <div key={order.code} className="bg-gray-bg rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-gray-text">{formatDate(order.createdAt)}</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${METHOD_BADGE[order.method]}`}>{order.method}</span>
                          <span className="text-[11px] font-bold text-ink">{won(order.total)}</span>
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
            <div className="bg-white rounded-2xl shadow-xl w-[400px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-[14px] font-extrabold text-ink">{selectedMenuName}</div>
                    <div className="text-[11px] text-gray-text mt-0.5">총 {ms.qty}개 · {won(ms.total)}</div>
                  </div>
                  <button onClick={() => setSelectedMenuName(null)}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-bg text-gray-text hover:text-ink transition-colors">✕</button>
                </div>
                <div className="border-t border-gray-border mb-3" />
                <div className="text-[11px] font-bold text-gray-text mb-2.5 uppercase tracking-wide">주문 내역 ({relatedOrders.length}건)</div>
                <div className="space-y-2.5">
                  {relatedOrders.map(order => {
                    const thisItem  = order.items.find(i => i.name === selectedMenuName)!
                    const otherItems = order.items.filter(i => i.name !== selectedMenuName)
                    return (
                      <div key={order.code} className="bg-gray-bg rounded-xl p-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="text-[11px] text-gray-text">{formatDate(order.createdAt)}</div>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${METHOD_BADGE[order.method]}`}>{order.method}</span>
                        </div>
                        <div className="text-[11px] font-semibold text-ink mb-1.5">
                          {order.accountName}<span className="text-gray-text font-normal"> · {order.orderer}</span>
                        </div>
                        <div className="bg-white rounded-lg px-3 py-1.5 mb-1.5 border border-green/30">
                          <div className="flex justify-between text-[11px] font-bold text-ink">
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
                        <div className="flex justify-between text-[11px] font-bold text-ink mt-1.5 pt-1.5 border-t border-gray-border">
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
