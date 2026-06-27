import { useState, useMemo, useEffect } from 'react'
import { type Order, type OrderStatus } from '../lib/mock-data'
import { won, formatDate, orderToPayload } from '../lib/ipc'
import { supabase } from '../lib/supabase'

// ── DB row → Order 변환 ───────────────────────────────────────────────────────
const DB_METHOD_MAP: Record<string, string> = { '내점': '매장 식사', '포장': '포장', '배달': '배달' }

function mapRow(row: any): Order {
  return {
    code:          row.order_code,
    orderNumber:   row.order_number ?? undefined,
    accountName:   row.accounts?.account_name ?? '',
    orderer:       row.orderer_name,
    phone:         row.orderer_phone ?? undefined,
    method:        (DB_METHOD_MAP[row.method] ?? row.method) as Order['method'],
    status:        row.status as OrderStatus,
    items:         (row.order_items ?? []).map((item: any) => ({
      name:    item.menu_name,
      qty:     item.quantity,
      price:   item.unit_price,
      options: (item.order_item_options ?? []).map((o: any) => o.option_name as string),
    })),
    total:         row.total_amount,
    prepMins:      0,
    createdAt:     row.ordered_at,
    remarks:       row.note ?? '',
    balanceBefore: row.balance_before,
    balanceAfter:  row.balance_after,
  }
}

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
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={prevNav}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-bg text-gray-text hover:text-ink transition-colors text-[18px] focus:outline-none"
        >‹</button>

        {calView === 'days' ? (
          <div className="flex gap-1 text-[13px] font-bold text-ink">
            <button onClick={() => setCalView('years')} className="hover:text-green transition-colors focus:outline-none">{viewYear}년</button>
            <button onClick={() => setCalView('months')} className="hover:text-green transition-colors focus:outline-none">{viewMonth + 1}월</button>
          </div>
        ) : calView === 'months' ? (
          <button onClick={() => setCalView('days')} className="text-[13px] font-bold text-ink hover:text-green transition-colors focus:outline-none">{viewYear}년</button>
        ) : (
          <button onClick={() => setCalView('days')} className="text-[13px] font-bold text-ink hover:text-green transition-colors focus:outline-none">{yearBase} – {yearBase + 11}</button>
        )}

        <button
          onClick={nextNav}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-bg text-gray-text hover:text-ink transition-colors text-[18px] focus:outline-none"
        >›</button>
      </div>

      {calView === 'years' && (
        <div className="grid grid-cols-4 gap-1">
          {Array.from({ length: 12 }, (_, i) => yearBase + i).map(yr => (
            <button key={yr} onClick={() => { setViewYear(yr); setCalView('months') }}
              className={`py-2 rounded-lg text-[12px] font-semibold transition-colors focus:outline-none ${viewYear === yr ? 'text-white' : 'text-ink hover:bg-gray-bg'}`}
              style={viewYear === yr ? { backgroundColor: '#017333' } : undefined}>{yr}</button>
          ))}
        </div>
      )}

      {calView === 'months' && (
        <div className="grid grid-cols-3 gap-1">
          {MONTH_NAMES.map((name, i) => (
            <button key={name} onClick={() => { setViewMonth(i); setCalView('days') }}
              className={`py-2.5 rounded-lg text-[12px] font-semibold transition-colors focus:outline-none ${viewMonth === i ? 'text-white' : 'text-ink hover:bg-gray-bg'}`}
              style={viewMonth === i ? { backgroundColor: '#017333' } : undefined}>{name}</button>
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
              if (day === null) return <div key={`e-${idx}`} className="h-9" />
              const ymd     = cellYMD(day)
              const isS     = ymd === startDate
              const isE     = ymd === endDate
              const inRange = !!(startDate && endDate && ymd > startDate && ymd < endDate)
              const isSel   = isS || isE
              const isToday = ymd === today
              const isSun   = idx % 7 === 0
              const isSat   = idx % 7 === 6
              const showStrip = !isSingleDay && (inRange || isS || isE)
              const stripLeft  = isS ? '50%' : '0'
              const stripRight = isE ? '50%' : '0'
              return (
                <div key={ymd} className="relative h-9 flex items-center justify-center">
                  {showStrip && (
                    <div style={{ position: 'absolute', top: '4px', bottom: '4px', left: stripLeft, right: stripRight, backgroundColor: '#E6F4EC', zIndex: 0 }} />
                  )}
                  <button onClick={() => onSelect(ymd)}
                    className={`relative z-10 w-8 h-8 rounded-full text-[12px] font-medium transition-colors focus:outline-none
                      ${isSel ? 'text-white' : inRange ? 'text-ink hover:bg-green-soft' : isSun ? 'text-danger hover:bg-gray-bg' : isSat ? 'text-blue-500 hover:bg-gray-bg' : 'text-ink hover:bg-gray-bg'}`}
                    style={isSel ? { backgroundColor: '#017333' } : undefined}>
                    {day}
                    {isToday && (
                      <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3 h-0.5 rounded-full" style={{ backgroundColor: isSel ? 'white' : '#017333' }} />
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

  function handleDaySelect(ymd: string) {
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

  function setQuick(start: string, end: string) {
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
    { label: '오늘',       onClick: () => setQuick(today, today) },
    { label: '어제',       onClick: () => { const y = getYesterday(); setQuick(y, y) } },
    { label: '지난 7일',   onClick: () => { const [s,e] = getLast7Days(); setQuick(s,e) } },
    { label: '이번 달',    onClick: () => { const [s,e] = getThisMonth(); setQuick(s,e) } },
    { label: '지난 달',    onClick: () => { const [s,e] = getLastMonth(); setQuick(s,e) } },
    { label: '지난 3개월', onClick: () => { const [s,e] = getLast3Months(); setQuick(s,e) } },
    { label: '지난 6개월', onClick: () => { const [s,e] = getLast6Months(); setQuick(s,e) } },
    { label: '올해',       onClick: () => { const [s,e] = getThisYear(); setQuick(s,e) } },
  ]

  return (
    <div className="w-[260px] flex-shrink-0 border-l border-gray-border flex flex-col overflow-y-auto">
      <div className="px-4 py-4 flex-1">
        <Calendar startDate={startDate} endDate={endDate} onSelect={handleDaySelect} />
        {!startDate && (
          <p className="text-[11px] text-gray-text mt-2 text-center">
            {picking === 'start' ? '시작일을 클릭하세요' : '종료일을 클릭하세요'}
          </p>
        )}
        {startDate && (
          <div className="mt-3 px-3 py-2 rounded-xl text-[12px] font-semibold text-center" style={{ backgroundColor: '#E6F4EC', color: '#017333' }}>
            {startDate && endDate && startDate !== endDate
              ? `${formatDisplay(startDate)} ~ ${formatDisplay(endDate)}`
              : startDate ? formatDisplay(startDate) : '날짜를 선택하세요'}
          </div>
        )}
        <div className="mt-4 space-y-1.5">
          <p className="text-[11px] font-bold text-gray-text mb-2">빠른 선택</p>
          {quickButtons.map(btn => (
            <button key={btn.label} onClick={btn.onClick}
              className="w-full text-left px-3 py-2 rounded-lg text-[12px] font-medium text-ink bg-gray-100 hover:bg-gray-200 transition-colors">
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 통계 카드 ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex-1 bg-gray-bg rounded-xl p-4 border border-gray-border">
      <div className="text-[11px] font-semibold text-gray-text mb-1">{label}</div>
      <div className="text-[20px] font-extrabold text-ink leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-gray-text mt-0.5">{sub}</div>}
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

// ── 날짜 범위 내 날 수 ────────────────────────────────────────────────────────
function dayCount(start: string | null, end: string | null): number {
  if (!start) return 1
  const s = parseYMD(start)
  const e = end ? parseYMD(end) : s
  return Math.max(Math.round((e.getTime() - s.getTime()) / 86400000) + 1, 1)
}

function Row({ label, value, mono, bold }: { label: string; value: string; mono?: boolean; bold?: boolean }) {
  return (
    <div className="flex justify-between text-[13px]">
      <span className="text-gray-text">{label}</span>
      <span className={`${mono ? 'font-mono' : ''} ${bold ? 'font-bold text-ink' : 'text-ink'}`}>{value}</span>
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function Orders() {
  const today = toYMD(new Date())

  const [startDate, setStartDate] = useState<string | null>(today)
  const [endDate,   setEndDate]   = useState<string | null>(today)
  const [tab,       setTab]       = useState<'주문내역' | '메뉴별매출'>('주문내역')
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all')
  const [selected,     setSelected]     = useState<Order | null>(null)
  const [selectedMenuName, setSelectedMenuName] = useState<string | null>(null)
  const [orders,   setOrders]   = useState<Order[]>([])
  const [loading,  setLoading]  = useState(false)
  const [reprintMsg, setReprintMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function fetchOrders(start: string | null, end: string | null) {
    if (!start) { setOrders([]); return }
    setLoading(true)
    const s = `${start}T00:00:00`
    const e = `${end ?? start}T23:59:59`
    const { data, error } = await supabase
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
      .gte('ordered_at', s)
      .lte('ordered_at', e)
      .order('ordered_at', { ascending: false })

    if (!error && data) setOrders(data.map(mapRow))
    setLoading(false)
  }

  // 날짜 범위 변경 시 재조회
  useEffect(() => {
    fetchOrders(startDate, endDate)
  }, [startDate, endDate])

  function handleRangeChange(s: string | null, e: string | null) {
    setStartDate(s)
    setEndDate(e)
    setSelected(null)
    setSelectedMenuName(null)
  }

  function handleTabChange(t: '주문내역' | '메뉴별매출') {
    setTab(t)
    setSelected(null)
    setSelectedMenuName(null)
  }

  // 통계 계산
  const stats = useMemo(() => {
    const valid       = orders.filter(o => o.status !== '취소')
    const totalSales  = valid.reduce((sum, o) => sum + o.total, 0)
    const days        = dayCount(startDate, endDate)
    const avgSales    = days > 0 ? Math.round(totalSales / days) : 0
    const orderCount  = valid.length
    const cancelCount = orders.filter(o => o.status === '취소').length
    return { totalSales, avgSales, orderCount, cancelCount }
  }, [orders, startDate, endDate])

  // 상태 필터 (주문내역 탭)
  const listFiltered = useMemo(
    () => orders.filter(o => statusFilter === 'all' || o.status === statusFilter),
    [orders, statusFilter],
  )

  // 메뉴별 매출
  const menuSales = useMemo(() => calcMenuSales(orders), [orders])

  return (
    <div className="h-full flex overflow-hidden bg-white">

      {/* 중앙: 통계 + 탭 + 목록 */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* 통계 카드 */}
        <div className="px-5 py-4 border-b border-gray-border flex-shrink-0">
          <div className="text-[18px] font-extrabold mb-3 text-ink">주문 관리</div>
          <div className="flex gap-3">
            <StatCard label="합계 거래액"    value={won(stats.totalSales)} sub="취소 제외" />
            <StatCard label="일 평균 거래액"  value={won(stats.avgSales)}   sub={`${dayCount(startDate, endDate)}일 기준`} />
            <StatCard label="주문 건수"       value={`${stats.orderCount}건`} sub="취소 제외" />
            <StatCard label="취소 건수"       value={`${stats.cancelCount}건`} />
          </div>
        </div>

        {/* 탭 */}
        <div className="px-5 pt-3 pb-0 flex-shrink-0 border-b border-gray-border">
          <div className="flex gap-1">
            {(['주문내역', '메뉴별매출'] as const).map(t => (
              <button key={t} onClick={() => handleTabChange(t)}
                className={`px-4 py-2 text-[13px] font-semibold border-b-2 transition-colors -mb-px
                  ${tab === t ? 'border-ink text-ink' : 'border-transparent text-gray-text hover:text-ink'}`}>
                {t === '주문내역' ? '주문 내역' : '메뉴별 거래액'}
              </button>
            ))}
          </div>
        </div>

        {/* 탭 콘텐츠 */}
        {tab === '주문내역' ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 상태 필터 */}
            <div className="px-5 py-2.5 flex gap-1 flex-shrink-0 border-b border-gray-border bg-gray-bg">
              {STATUS_OPTIONS.map(({ label, value }) => (
                <button key={value} onClick={() => setStatusFilter(value)}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors
                    ${statusFilter === value ? 'bg-ink text-white' : 'bg-white text-gray-text bg-gray-100 hover:bg-gray-200'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* 테이블 헤더 */}
            <div className="grid grid-cols-[80px_1fr_62px_80px_100px_58px] px-5 py-2 bg-gray-bg text-[11px] font-bold text-gray-text uppercase tracking-wide border-b border-gray-border flex-shrink-0">
              <span>주문번호</span>
              <span>거래처 · 주문자</span>
              <span>주문일시</span>
              <span>이용방법</span>
              <span className="text-right">금액</span>
              <span className="text-center">상태</span>
            </div>

            {/* 목록 */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-border">
              {loading ? (
                <div className="h-full flex items-center justify-center text-gray-text text-[13px]">
                  <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin mr-2" />
                  불러오는 중...
                </div>
              ) : listFiltered.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-text text-[13px]">
                  해당 기간에 주문이 없습니다
                </div>
              ) : (
                listFiltered.map(order => (
                  <button key={order.code} onClick={() => setSelected(order)}
                    className={`w-full grid grid-cols-[80px_1fr_62px_80px_100px_58px] px-5 py-3 text-left hover:bg-gray-bg transition-colors text-[13px]
                      ${selected?.code === order.code ? 'bg-green-soft' : ''}`}>
                    <span className="font-mono text-[11px] text-gray-text self-center">#{order.orderNumber ?? order.code.slice(0, 6)}</span>
                    <span className="font-semibold text-ink self-center">
                      {order.accountName}
                      <span className="text-gray-text font-normal ml-1">· {order.orderer}</span>
                    </span>
                    <span className="text-[11px] text-gray-text self-center">{formatDate(order.createdAt)}</span>
                    <span className="self-center">
                      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${METHOD_BADGE[order.method]}`}>{order.method}</span>
                    </span>
                    <span className="font-bold text-right self-center">{won(order.total)}</span>
                    <span className="text-center self-center">
                      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_BADGE[order.status]}`}>{order.status}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          /* 메뉴별 매출 탭 */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="grid grid-cols-[1fr_100px_120px] px-5 py-2 bg-gray-bg text-[11px] font-bold text-gray-text uppercase tracking-wide border-b border-gray-border flex-shrink-0">
              <span>메뉴명</span>
              <span className="text-right">주문수량</span>
              <span className="text-right">거래액</span>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-gray-border">
              {menuSales.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-text text-[13px]">
                  해당 기간에 거래액 데이터가 없습니다
                </div>
              ) : (
                menuSales.map((ms, idx) => (
                  <button key={ms.name} onClick={() => setSelectedMenuName(ms.name)}
                    className={`w-full grid grid-cols-[1fr_100px_120px] px-5 py-3 text-left text-[13px] transition-colors
                      ${selectedMenuName === ms.name ? 'bg-green-soft' : 'hover:bg-gray-bg'}`}>
                    <span className="font-semibold text-ink flex items-center gap-1.5">
                      {idx === 0 && <span>🏆</span>}
                      {ms.name}
                    </span>
                    <span className="text-right text-gray-text">{ms.qty}개</span>
                    <span className="text-right font-bold text-ink">{won(ms.total)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* 우측: 캘린더 패널 */}
      <DateRangePanel startDate={startDate} endDate={endDate} onRangeChange={handleRangeChange} />

      {/* 주문 상세 모달 */}
      {selected && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-[420px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="text-[17px] font-extrabold text-ink">주문 상세</div>
                <button onClick={() => setSelected(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-bg text-gray-text hover:text-ink transition-colors">✕</button>
              </div>
              <div className="space-y-2.5 mb-5">
                <Row label="주문번호"  value={selected.orderNumber ? `#${selected.orderNumber}` : selected.code} mono />
                <Row label="거래처"    value={selected.accountName} />
                <Row label="주문자"    value={selected.orderer} />
                {selected.phone && <Row label="연락처" value={selected.phone} />}
                <Row label="이용방법"  value={selected.method === '배달' ? '배달 (+3,500원)' : selected.method} />
                <Row label="주문일시"  value={formatDate(selected.createdAt)} />
                <Row label="합계"      value={won(selected.total)} bold />
                {selected.remarks && <Row label="요청사항" value={selected.remarks} />}
              </div>
              <div className="bg-gray-bg rounded-xl p-4 mb-5 space-y-3">
                {selected.items.map((item, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-[13px] font-semibold text-ink">
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
              <div className="flex items-center justify-between mb-5">
                <span className="text-[13px] text-gray-text font-semibold">현재 상태</span>
                <span className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${STATUS_BADGE[selected.status]}`}>{selected.status}</span>
              </div>
              <button
                onClick={async () => {
                  setReprintMsg(null)
                  const w = window as unknown as { api?: { reprintOrder?: (p: unknown) => Promise<{ ok: boolean; error?: string }> } }
                  const res = await w.api?.reprintOrder?.({ order: orderToPayload(selected) })
                  if (!res) return
                  setReprintMsg(res.ok
                    ? { ok: true,  text: '영수증을 출력합니다' }
                    : { ok: false, text: res.error ?? '출력 실패' }
                  )
                  setTimeout(() => setReprintMsg(null), 3000)
                }}
                className="w-full py-2.5 rounded-xl border-2 border-gray-border text-[13px] font-bold text-gray-text hover:bg-gray-bg transition-colors">
                🖨 영수증 재출력
              </button>
              {reprintMsg && (
                <div className={`mt-2 text-center text-[12px] font-semibold ${reprintMsg.ok ? 'text-green' : 'text-danger'}`}>
                  {reprintMsg.ok ? '✅' : '⚠️'} {reprintMsg.text}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 메뉴별 상세 모달 */}
      {tab === '메뉴별매출' && selectedMenuName && (() => {
        const ms = menuSales.find(m => m.name === selectedMenuName)!
        const relatedOrders = orders.filter(
          o => o.status !== '취소' && o.items.some(i => i.name === selectedMenuName)
        )
        return (
          <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center" onClick={() => setSelectedMenuName(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-[420px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="text-[15px] font-extrabold text-ink">{selectedMenuName}</div>
                    <div className="text-[12px] text-gray-text mt-0.5">총 {ms.qty}개 · {won(ms.total)}</div>
                  </div>
                  <button onClick={() => setSelectedMenuName(null)}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-bg text-gray-text hover:text-ink transition-colors">✕</button>
                </div>
                <div className="border-t border-gray-border mb-4" />
                <div className="text-[11px] font-bold text-gray-text mb-3 uppercase tracking-wide">주문 내역 ({relatedOrders.length}건)</div>
                <div className="space-y-3">
                  {relatedOrders.map(order => {
                    const thisItem  = order.items.find(i => i.name === selectedMenuName)!
                    const otherItems = order.items.filter(i => i.name !== selectedMenuName)
                    return (
                      <div key={order.code} className="bg-gray-bg rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-[11px] text-gray-text">{formatDate(order.createdAt)}</div>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${METHOD_BADGE[order.method]}`}>{order.method}</span>
                        </div>
                        <div className="text-[12px] font-semibold text-ink mb-2">
                          {order.accountName}<span className="text-gray-text font-normal"> · {order.orderer}</span>
                        </div>
                        <div className="bg-white rounded-lg px-3 py-2 mb-1.5 border border-green/30">
                          <div className="flex justify-between text-[12px] font-bold text-ink">
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
                        <div className="flex justify-between text-[12px] font-bold text-ink mt-2 pt-2 border-t border-gray-border">
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
