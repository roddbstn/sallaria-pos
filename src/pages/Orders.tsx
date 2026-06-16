import { useState, useMemo } from 'react'
import { MOCK_ORDERS, type Order, type OrderStatus } from '../lib/mock-data'
import { won, formatDate } from '../lib/ipc'

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

/** ISO createdAt 문자열에서 'YYYY-MM-DD' 추출 */
function orderDate(iso: string): string {
  return iso.slice(0, 10)
}

// ── 캘린더 컴포넌트 ───────────────────────────────────────────────────────────
interface CalendarProps {
  startDate: string | null  // 'YYYY-MM-DD'
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

  // 달력 셀 계산
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
      {/* 네비게이션 헤더 */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={prevNav}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-bg text-gray-text hover:text-ink transition-colors text-[18px] focus:outline-none"
        >‹</button>

        {calView === 'days' ? (
          <div className="flex gap-1 text-[13px] font-bold text-ink">
            <button
              onClick={() => setCalView('years')}
              className="hover:text-green transition-colors focus:outline-none"
            >{viewYear}년</button>
            <button
              onClick={() => setCalView('months')}
              className="hover:text-green transition-colors focus:outline-none"
            >{viewMonth + 1}월</button>
          </div>
        ) : calView === 'months' ? (
          <button
            onClick={() => setCalView('days')}
            className="text-[13px] font-bold text-ink hover:text-green transition-colors focus:outline-none"
          >{viewYear}년</button>
        ) : (
          <button
            onClick={() => setCalView('days')}
            className="text-[13px] font-bold text-ink hover:text-green transition-colors focus:outline-none"
          >{yearBase} – {yearBase + 11}</button>
        )}

        <button
          onClick={nextNav}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-bg text-gray-text hover:text-ink transition-colors text-[18px] focus:outline-none"
        >›</button>
      </div>

      {/* 연도 선택 뷰 */}
      {calView === 'years' && (
        <div className="grid grid-cols-4 gap-1">
          {Array.from({ length: 12 }, (_, i) => yearBase + i).map(yr => (
            <button
              key={yr}
              onClick={() => { setViewYear(yr); setCalView('months') }}
              className={`py-2 rounded-lg text-[12px] font-semibold transition-colors focus:outline-none
                ${viewYear === yr ? 'text-white' : 'text-ink hover:bg-gray-bg'}`}
              style={viewYear === yr ? { backgroundColor: '#017333' } : undefined}
            >{yr}</button>
          ))}
        </div>
      )}

      {/* 월 선택 뷰 */}
      {calView === 'months' && (
        <div className="grid grid-cols-3 gap-1">
          {MONTH_NAMES.map((name, i) => (
            <button
              key={name}
              onClick={() => { setViewMonth(i); setCalView('days') }}
              className={`py-2.5 rounded-lg text-[12px] font-semibold transition-colors focus:outline-none
                ${viewMonth === i ? 'text-white' : 'text-ink hover:bg-gray-bg'}`}
              style={viewMonth === i ? { backgroundColor: '#017333' } : undefined}
            >{name}</button>
          ))}
        </div>
      )}

      {/* 날짜 뷰 */}
      {calView === 'days' && (
        <>
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 mb-1">
            {WEEK_DAYS.map((d, i) => (
              <div
                key={d}
                className={`text-center text-[11px] font-bold py-1
                  ${i === 0 ? 'text-danger' : i === 6 ? 'text-blue-500' : 'text-gray-text'}`}
              >{d}</div>
            ))}
          </div>

          {/* 날짜 그리드 */}
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

              // 범위 연결 strip: 단일 날짜 선택이면 strip 없음
              const showStrip = !isSingleDay && (inRange || isS || isE)
              const stripLeft  = isS ? '50%' : '0'
              const stripRight = isE ? '50%' : '0'

              return (
                <div key={ymd} className="relative h-9 flex items-center justify-center">
                  {showStrip && (
                    <div style={{
                      position: 'absolute',
                      top: '4px', bottom: '4px',
                      left: stripLeft, right: stripRight,
                      backgroundColor: '#E6F4EC',
                      zIndex: 0,
                    }} />
                  )}
                  <button
                    onClick={() => onSelect(ymd)}
                    className={`relative z-10 w-8 h-8 rounded-full text-[12px] font-medium transition-colors focus:outline-none
                      ${isSel
                        ? 'text-white'
                        : inRange
                          ? 'text-ink hover:bg-green-soft'
                          : isSun
                            ? 'text-danger hover:bg-gray-bg'
                            : isSat
                              ? 'text-blue-500 hover:bg-gray-bg'
                              : 'text-ink hover:bg-gray-bg'}`}
                    style={isSel ? { backgroundColor: '#017333' } : undefined}
                  >
                    {day}
                    {isToday && (
                      <span
                        className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3 h-0.5 rounded-full"
                        style={{ backgroundColor: isSel ? 'white' : '#017333' }}
                      />
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
  // 두 번 클릭으로 범위 선택: 첫 번째 클릭 = start, 두 번째 = end
  const [picking, setPicking] = useState<'start' | 'end'>('start')

  function handleDaySelect(ymd: string) {
    if (picking === 'start') {
      onRangeChange(ymd, null)
      setPicking('end')
    } else {
      // end가 start보다 이전이면 swap
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

  function getThisWeekRange(): [string, string] {
    const now = new Date()
    const dow  = now.getDay() // 0=일
    const mon  = new Date(now); mon.setDate(now.getDate() - dow)
    const sun  = new Date(mon); sun.setDate(mon.getDate() + 6)
    return [toYMD(mon), toYMD(sun)]
  }

  function getLast7Days(): [string, string] {
    const now  = new Date()
    const from = new Date(now); from.setDate(now.getDate() - 6)
    return [toYMD(from), today]
  }

  function getThisMonth(): [string, string] {
    const now  = new Date()
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    const to   = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return [toYMD(from), toYMD(to)]
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

  const quickButtons = [
    { label: '오늘',     onClick: () => setQuick(today, today) },
    { label: '어제',     onClick: () => { const y = getYesterday(); setQuick(y, y) } },
    { label: '이번 주',  onClick: () => { const [s,e] = getThisWeekRange(); setQuick(s,e) } },
    { label: '지난 7일', onClick: () => { const [s,e] = getLast7Days(); setQuick(s,e) } },
    { label: '이번 달',  onClick: () => { const [s,e] = getThisMonth(); setQuick(s,e) } },
    { label: '지난 달',  onClick: () => { const [s,e] = getLastMonth(); setQuick(s,e) } },
  ]

  return (
    <div className="w-[260px] flex-shrink-0 border-r border-gray-border flex flex-col overflow-y-auto">
      <div className="px-4 py-4 flex-1">
        {/* 캘린더 */}
        <Calendar
          startDate={startDate}
          endDate={endDate}
          onSelect={handleDaySelect}
        />

        {/* 안내 텍스트 */}
        <p className="text-[11px] text-gray-text mt-2 text-center">
          {picking === 'start' ? '시작일을 클릭하세요' : '종료일을 클릭하세요'}
        </p>

        {/* 선택된 날짜 범위 */}
        {startDate && (
          <div
            className="mt-3 px-3 py-2 rounded-xl text-[12px] font-semibold text-center"
            style={{ backgroundColor: '#E6F4EC', color: '#017333' }}
          >
            {startDate && endDate && startDate !== endDate
              ? `${formatDisplay(startDate)} ~ ${formatDisplay(endDate)}`
              : startDate
                ? formatDisplay(startDate)
                : '날짜를 선택하세요'}
          </div>
        )}

        {/* 빠른 선택 버튼 */}
        <div className="mt-4 space-y-1.5">
          <p className="text-[11px] font-bold text-gray-text mb-2">빠른 선택</p>
          {quickButtons.map(btn => (
            <button
              key={btn.label}
              onClick={btn.onClick}
              className="w-full text-left px-3 py-2 rounded-lg text-[12px] font-medium text-ink hover:bg-gray-bg border border-gray-border transition-colors"
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 통계 카드 ─────────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string
  value: string
  sub?: string
}

function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className="flex-1 bg-gray-bg rounded-xl p-4 border border-gray-border">
      <div className="text-[11px] font-semibold text-gray-text mb-1">{label}</div>
      <div className="text-[20px] font-extrabold text-ink leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-gray-text mt-0.5">{sub}</div>}
    </div>
  )
}

// ── 메뉴별 매출 집계 ──────────────────────────────────────────────────────────
interface MenuSales {
  name:  string
  qty:   number
  total: number
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

// ── 날짜 범위로 주문 필터 ────────────────────────────────────────────────────
function filterByDateRange(orders: Order[], start: string | null, end: string | null): Order[] {
  if (!start) return orders
  const s = start
  const e = end ?? start
  return orders.filter(o => {
    const d = orderDate(o.createdAt)
    return d >= s && d <= e
  })
}

// ── 날짜 범위 내 날 수 계산 ────────────────────────────────────────────────
function dayCount(start: string | null, end: string | null): number {
  if (!start) return 1
  const s = parseYMD(start)
  const e = end ? parseYMD(end) : s
  const diff = Math.round((e.getTime() - s.getTime()) / 86400000) + 1
  return Math.max(diff, 1)
}

// ── 우측 상세 패널 Row 헬퍼 ─────────────────────────────────────────────────
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

  // 날짜 범위 상태
  const [startDate, setStartDate] = useState<string | null>(today)
  const [endDate,   setEndDate]   = useState<string | null>(today)

  // 탭: '주문내역' | '메뉴별매출'
  const [tab, setTab] = useState<'주문내역' | '메뉴별매출'>('주문내역')

  // 상태 필터
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all')

  // 선택된 주문 (우측 상세)
  const [selected, setSelected] = useState<Order | null>(null)

  // 날짜 범위 변경 핸들러
  function handleRangeChange(s: string | null, e: string | null) {
    setStartDate(s)
    setEndDate(e)
    setSelected(null)
  }

  // 날짜 범위로 1차 필터링
  const dateFiltered = useMemo(
    () => filterByDateRange(MOCK_ORDERS, startDate, endDate),
    [startDate, endDate],
  )

  // 통계 계산 (취소 제외한 주문만 매출 합산)
  const stats = useMemo(() => {
    const valid   = dateFiltered.filter(o => o.status !== '취소')
    const totalSales  = valid.reduce((sum, o) => sum + o.total, 0)
    const days        = dayCount(startDate, endDate)
    const avgSales    = days > 0 ? Math.round(totalSales / days) : 0
    const orderCount  = dateFiltered.filter(o => o.status !== '취소').length
    const cancelCount = dateFiltered.filter(o => o.status === '취소').length
    return { totalSales, avgSales, orderCount, cancelCount }
  }, [dateFiltered, startDate, endDate])

  // 상태 필터 적용 (주문내역 탭용)
  const listFiltered = useMemo(
    () => dateFiltered.filter(o => statusFilter === 'all' || o.status === statusFilter),
    [dateFiltered, statusFilter],
  )

  // 메뉴별 매출 집계
  const menuSales = useMemo(() => calcMenuSales(dateFiltered), [dateFiltered])

  return (
    <div className="h-full flex overflow-hidden bg-white">

      {/* ── 좌측: 캘린더 패널 ── */}
      <DateRangePanel
        startDate={startDate}
        endDate={endDate}
        onRangeChange={handleRangeChange}
      />

      {/* ── 중앙: 통계 + 탭 + 목록 ── */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-border min-w-0">

        {/* 상단 통계 카드 */}
        <div className="px-5 py-4 border-b border-gray-border flex-shrink-0">
          <div className="text-[18px] font-extrabold mb-3 text-ink">주문 관리</div>
          <div className="flex gap-3">
            <StatCard
              label="합계 거래액"
              value={won(stats.totalSales)}
              sub="취소 제외"
            />
            <StatCard
              label="일 평균 거래액"
              value={won(stats.avgSales)}
              sub={`${dayCount(startDate, endDate)}일 기준`}
            />
            <StatCard
              label="주문 건수"
              value={`${stats.orderCount}건`}
              sub="취소 제외"
            />
            <StatCard
              label="취소 건수"
              value={`${stats.cancelCount}건`}
            />
          </div>
        </div>

        {/* 탭 */}
        <div className="px-5 pt-3 pb-0 flex-shrink-0 border-b border-gray-border">
          <div className="flex gap-1">
            {(['주문내역', '메뉴별매출'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-[13px] font-semibold border-b-2 transition-colors -mb-px
                  ${tab === t
                    ? 'border-ink text-ink'
                    : 'border-transparent text-gray-text hover:text-ink'}`}
              >
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
                <button
                  key={value}
                  onClick={() => setStatusFilter(value)}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors
                    ${statusFilter === value
                      ? 'bg-ink text-white'
                      : 'bg-white text-gray-text border border-gray-border hover:bg-gray-bg'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 테이블 헤더 */}
            <div className="grid grid-cols-[90px_1fr_80px_100px_80px] px-5 py-2 bg-gray-bg text-[11px] font-bold text-gray-text uppercase tracking-wide border-b border-gray-border flex-shrink-0">
              <span>주문번호</span>
              <span>거래처 · 주문자</span>
              <span>이용방법</span>
              <span className="text-right">금액</span>
              <span className="text-center">상태</span>
            </div>

            {/* 목록 */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-border">
              {listFiltered.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-text text-[13px]">
                  해당 기간에 주문이 없습니다
                </div>
              ) : (
                listFiltered.map(order => (
                  <button
                    key={order.code}
                    onClick={() => setSelected(order)}
                    className={`w-full grid grid-cols-[90px_1fr_80px_100px_80px] px-5 py-3 text-left hover:bg-gray-bg transition-colors text-[13px]
                      ${selected?.code === order.code ? 'bg-green-soft' : ''}`}
                  >
                    <span className="font-mono text-[11px] text-gray-text self-center">{order.code}</span>
                    <span className="font-semibold text-ink self-center">
                      {order.accountName}
                      <span className="text-gray-text font-normal ml-1">· {order.orderer}</span>
                    </span>
                    <span className="self-center">
                      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${METHOD_BADGE[order.method]}`}>
                        {order.method}
                      </span>
                    </span>
                    <span className="font-bold text-right self-center">{won(order.total)}</span>
                    <span className="text-center self-center">
                      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_BADGE[order.status]}`}>
                        {order.status}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          /* 메뉴별 매출 탭 */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 테이블 헤더 */}
            <div className="grid grid-cols-[1fr_100px_120px] px-5 py-2 bg-gray-bg text-[11px] font-bold text-gray-text uppercase tracking-wide border-b border-gray-border flex-shrink-0">
              <span>메뉴명</span>
              <span className="text-right">주문수량</span>
              <span className="text-right">거래액</span>
            </div>

            {/* 목록 */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-border">
              {menuSales.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-text text-[13px]">
                  해당 기간에 거래액 데이터가 없습니다
                </div>
              ) : (
                menuSales.map((ms, idx) => (
                  <div
                    key={ms.name}
                    className="grid grid-cols-[1fr_100px_120px] px-5 py-3 text-[13px] hover:bg-gray-bg transition-colors"
                  >
                    <span className="font-semibold text-ink flex items-center gap-1.5">
                      {idx === 0 && <span>🏆</span>}
                      {ms.name}
                    </span>
                    <span className="text-right text-gray-text">{ms.qty}개</span>
                    <span className="text-right font-bold text-ink">{won(ms.total)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── 우측: 주문 상세 패널 ── */}
      <div className="w-[320px] flex-shrink-0 overflow-y-auto">
        {selected ? (
          <div className="p-5">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-4">
              <div className="text-[15px] font-extrabold text-ink">주문 상세</div>
              <button
                onClick={() => setSelected(null)}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-bg text-gray-text hover:text-ink transition-colors text-[14px]"
              >
                ✕
              </button>
            </div>

            {/* 기본 정보 */}
            <div className="space-y-2.5 mb-4">
              <Row label="주문번호"  value={selected.code} mono />
              <Row label="거래처"    value={selected.accountName} />
              <Row label="주문자"    value={selected.orderer} />
              {selected.phone && <Row label="연락처" value={selected.phone} />}
              <Row label="이용방법"  value={selected.method} />
              <Row label="접수 시각" value={formatDate(selected.createdAt)} />
              <Row label="합계"      value={won(selected.total)} bold />
              {selected.remarks && <Row label="요청사항" value={selected.remarks} />}
            </div>

            {/* 주문 항목 */}
            <div className="bg-gray-bg rounded-xl p-4 mb-4 space-y-3">
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

            {/* 상태 뱃지 */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-[12px] text-gray-text font-semibold">현재 상태</span>
              <span className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${STATUS_BADGE[selected.status]}`}>
                {selected.status}
              </span>
            </div>

            {/* 영수증 재출력 버튼 */}
            <button
              className="w-full py-2.5 rounded-xl border-2 border-gray-border text-[13px] font-bold text-gray-text hover:bg-gray-bg transition-colors"
            >
              🖨 영수증 재출력
            </button>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-text text-[13px] gap-2">
            <span className="text-[28px]">📋</span>
            <span>주문을 선택하세요</span>
          </div>
        )}
      </div>
    </div>
  )
}
