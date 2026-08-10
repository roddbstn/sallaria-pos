import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { supabase, type DbAccount } from '../lib/supabase'
import { won } from '../lib/ipc'
import { useStore } from '../lib/store-context'
import { useHeaderSlot } from '../lib/header-slot'

// ── 상수 ─────────────────────────────────────────────────────────────────────
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const MONTH_NAMES   = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
const DAY_NAMES     = ['일','월','화','수','목','금','토']
const CHART_COLORS  = ['#16a84c','#3B82F6','#F59E0B','#EF4444','#8B5CF6','#EC4899','#14B8A6','#F97316','#84CC16','#06B6D4']

// ── KST 헬퍼 ─────────────────────────────────────────────────────────────────
function monthRangeUtc(year: number, month: number) {
  return {
    start: new Date(Date.UTC(year, month,     1) - KST_OFFSET_MS).toISOString(),
    end:   new Date(Date.UTC(year, month + 1, 1) - KST_OFFSET_MS).toISOString(),
  }
}
function kstDay(iso: string): number {
  return new Date(new Date(iso).getTime() + KST_OFFSET_MS).getUTCDate()
}
function kstMonthKey(iso: string): string {
  const d = new Date(new Date(iso).getTime() + KST_OFFSET_MS)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2,'0')}`
}
function kstTimeStr(iso: string): string {
  const d = new Date(new Date(iso).getTime() + KST_OFFSET_MS)
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`
}
function daysInMonth(year: number, month: number) { return new Date(year, month + 1, 0).getDate() }
function firstDow(year: number, month: number)    { return new Date(year, month, 1).getDay() }

// ── 타입 ─────────────────────────────────────────────────────────────────────
interface MonthDeposit {
  deposit_id: string; account_code: string; account_name: string
  amount: number; note: string | null; payment_method: string | null
  created_at: string; day: number
}
interface MonthOrder {
  order_code: string; order_number: string
  account_code: string; account_name: string
  orderer_name: string; method: string
  total_amount: number; ordered_at: string; day: number
  items: { menu_name: string; quantity: number }[]
}

// 거래처 상세 패널용
interface HistoryItem {
  type:         'deposit' | 'order'
  day:          number
  amount:       number
  note?:        string | null
  created_at:   string
  orderer_name?: string | null
  menu_summary?: string | null
}
interface HistoryMonth {
  key:          string   // "YYYY-MM"
  year:         number
  month:        number   // 0-indexed
  totalDeposit: number
  totalOrder:   number
  items:        HistoryItem[]
}

// ── 도넛 차트 ─────────────────────────────────────────────────────────────────
interface DonutSegment {
  label: string
  value: number
  color: string
  tooltip: ReactNode
}

function DonutChart({ segments, size = 100 }: { segments: DonutSegment[]; size?: number }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const [animated,   setAnimated]   = useState(false)

  // 마운트 후 한 프레임 뒤에 애니메이션 시작 (12시→시계방향)
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const total = segments.reduce((s, seg) => s + seg.value, 0)
  if (total === 0 || segments.length === 0) return null

  const cx = size / 2, cy = size / 2
  // stroke 방식: 반지름 = outer/inner 중간, strokeWidth = outer-inner
  const R       = size * 0.345
  const strokeW = size * 0.15
  const C       = 2 * Math.PI * R   // 원 둘레

  let cum = 0
  const items = segments.map((seg, idx) => {
    const L = (seg.value / total) * C
    // hidden: dashOffset = cum + L (stroke이 12시 이전에 있어서 안 보임)
    // shown : dashOffset = -cum   (12시에서 cum만큼 시계방향으로 이동한 위치)
    const startDO = cum + L
    const endDO   = -cum
    cum += L
    return { L, startDO, endDO, seg, idx }
  })
  // 마지막 세그먼트가 z-top이 되어야 앞 세그먼트가 덮이지 않으므로 역순 렌더
  const reversed = [...items].reverse()

  return (
    <div className="relative flex-shrink-0">
      {/* SVG 자체를 -90° 회전해 12시에서 시작 */}
      <svg
        width={size} height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: 'rotate(-90deg)' }}
      >
        {reversed.map(({ L, startDO, endDO, seg, idx }) => (
          <circle
            key={idx}
            cx={cx} cy={cy} r={R}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeW}
            strokeDasharray={`${L} ${C}`}
            strokeDashoffset={animated ? endDO : startDO}
            opacity={hoveredIdx === null || hoveredIdx === idx ? 1 : 0.45}
            style={{
              cursor: 'pointer',
              transition: animated
                ? 'stroke-dashoffset 0.65s cubic-bezier(0.4,0,0.2,1), opacity 0.15s'
                : 'none',
            }}
            onMouseEnter={e => { setHoveredIdx(idx); setTooltipPos({ x: e.clientX, y: e.clientY }) }}
            onMouseMove={e => setTooltipPos({ x: e.clientX, y: e.clientY })}
            onMouseLeave={() => { setHoveredIdx(null); setTooltipPos(null) }}
          />
        ))}
      </svg>
      {hoveredIdx !== null && tooltipPos && (
        <div
          className="fixed z-50 pointer-events-none bg-white border border-gray-border rounded-xl shadow-lg px-3 py-2.5 text-[11px] min-w-[160px] max-w-[260px]"
          style={
            tooltipPos.x > window.innerWidth / 2
              ? { right: window.innerWidth - tooltipPos.x + 12, top: tooltipPos.y - 8 }
              : { left: tooltipPos.x + 12, top: tooltipPos.y - 8 }
          }
        >
          <div className="font-bold text-ink mb-1.5 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: segments[hoveredIdx].color }} />
            {segments[hoveredIdx].label}
          </div>
          {segments[hoveredIdx].tooltip}
        </div>
      )}
    </div>
  )
}

// ── 일자별 매출 라인 차트 ──────────────────────────────────────────────────────
interface DailySalesLineChartProps {
  depositByDay:  Record<number, number>
  orderByDay:    Record<number, number>
  totalDays:     number
  month:         number // 0-indexed
  showDeposit:   boolean
  showOrder:     boolean
}

function DailySalesLineChart({ depositByDay, orderByDay, totalDays, month, showDeposit, showOrder }: DailySalesLineChartProps) {
  const [hoverDay,    setHoverDay]    = useState<number | null>(null)
  const [tooltipSide, setTooltipSide] = useState<'left' | 'right'>('right')
  const [reveal,     setReveal]     = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)

  // 마운트 시 하단→상단 reveal 애니메이션
  useEffect(() => {
    setReveal(false)
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setReveal(true)))
    return () => cancelAnimationFrame(id)
  }, [depositByDay, orderByDay])

  const W = 600, H = 160
  const padLeft = 40, padRight = 20, padBottom = 30, padTop = 16
  const chartW = W - padLeft - padRight
  const chartH = H - padTop - padBottom

  // 데이터가 하나라도 있는지 확인
  const hasData = Object.keys(depositByDay).length > 0 || Object.keys(orderByDay).length > 0

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-[120px] text-[12px] text-gray-text">
        이번 달 데이터 없음
      </div>
    )
  }

  // 최대값 계산 (y축 스케일링)
  let maxVal = 0
  for (let d = 1; d <= totalDays; d++) {
    maxVal = Math.max(maxVal, depositByDay[d] ?? 0, orderByDay[d] ?? 0)
  }
  if (maxVal === 0) maxVal = 100000

  // y축 눈금 계산 (만 원 단위로 예쁘게)
  function niceMax(v: number) {
    const units = [10000, 50000, 100000, 200000, 500000, 1000000, 2000000, 5000000]
    for (const u of units) {
      const ticks = Math.ceil(v / u)
      if (ticks <= 5) return { step: u, count: ticks }
    }
    const step = Math.ceil(v / 5 / 10000) * 10000
    return { step, count: Math.ceil(v / step) }
  }
  const { step, count } = niceMax(maxVal)
  const yMax = step * count

  // y축 레이블 포맷
  function fmtY(v: number) {
    if (v === 0) return '0'
    if (v >= 10000) return `${v / 10000}만`
    return `${v}`
  }

  // x좌표 계산
  function xOf(day: number) {
    return padLeft + ((day - 1) / Math.max(totalDays - 1, 1)) * chartW
  }
  // y좌표 계산
  function yOf(val: number) {
    return padTop + chartH - (val / yMax) * chartH
  }

  // SVG 폴리라인 포인트 생성
  function buildPoints(data: Record<number, number>) {
    const pts: { x: number; y: number }[] = []
    for (let d = 1; d <= totalDays; d++) {
      pts.push({ x: xOf(d), y: yOf(data[d] ?? 0) })
    }
    return pts
  }

  // 직선 패스 생성 (L 커맨드)
  function buildPath(pts: { x: number; y: number }[]) {
    if (pts.length === 0) return ''
    let d = `M ${pts[0].x} ${pts[0].y}`
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i].x} ${pts[i].y}`
    }
    return d
  }

  // 영역 채우기 패스 (아래로 닫음)
  function buildAreaPath(pts: { x: number; y: number }[]) {
    if (pts.length === 0) return ''
    const line = buildPath(pts)
    const bottom = padTop + chartH
    return `${line} L ${pts[pts.length - 1].x} ${bottom} L ${pts[0].x} ${bottom} Z`
  }

  const depPts  = buildPoints(depositByDay)
  const ordPts  = buildPoints(orderByDay)
  const depPath = buildPath(depPts)
  const ordPath = buildPath(ordPts)
  const depArea = buildAreaPath(depPts)
  const ordArea = buildAreaPath(ordPts)

  // y축 눈금선 및 레이블
  const yTicks: number[] = []
  for (let i = 0; i <= count; i++) yTicks.push(i * step)

  // x축 표시할 날 (5, 10, 15, 20, 25, 마지막 날)
  const xLabels = new Set([5, 10, 15, 20, 25, totalDays].filter(d => d <= totalDays))

  // SVG CTM을 이용해 viewport 좌표 → SVG user-space 좌표로 정확하게 변환
  function onSvgMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const svgX = pt.matrixTransform(svg.getScreenCTM()!.inverse()).x
    const day  = Math.round(((svgX - padLeft) / chartW) * (totalDays - 1)) + 1
    setHoverDay(Math.max(1, Math.min(totalDays, day)))
    setTooltipSide(svgX > W / 2 ? 'left' : 'right')
  }

  const hoverX = hoverDay !== null ? xOf(hoverDay) : null
  const hoverDepAmt = hoverDay !== null ? (depositByDay[hoverDay] ?? 0) : 0
  const hoverOrdAmt = hoverDay !== null ? (orderByDay[hoverDay] ?? 0) : 0

  return (
    <div className="relative select-none" onMouseLeave={() => setHoverDay(null)}>
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        className="overflow-visible"
        onMouseMove={onSvgMouseMove}
      >
        {/* y축 눈금선 (가로 점선) — 애니메이션 없음 */}
        {yTicks.map(v => (
          <line
            key={v}
            x1={padLeft} y1={yOf(v)}
            x2={W - padRight} y2={yOf(v)}
            stroke="#D7D7D7" strokeWidth="1" strokeDasharray="4 3"
          />
        ))}
        {/* y축 레이블 */}
        {yTicks.map(v => (
          <text
            key={v}
            x={padLeft - 5} y={yOf(v) + 4}
            textAnchor="end" fontSize="10" fill="#727272"
          >{fmtY(v)}</text>
        ))}

        {/* 차트 라인/면적 — 하단에서 상단으로 reveal */}
        <g
          style={{
            transform: `scaleY(${reveal ? 1 : 0})`,
            transformOrigin: `${padLeft}px ${padTop + chartH}px`,
            transition: reveal ? 'transform 0.65s cubic-bezier(0.4,0,0.2,1)' : 'none',
          }}
        >
          {showOrder   && <path d={ordArea} fill="#6B7280" fillOpacity="0.10" />}
          {showDeposit && <path d={depArea} fill="#16a84c" fillOpacity="0.13" />}
          {showOrder   && <path d={ordPath} fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
          {showDeposit && <path d={depPath} fill="none" stroke="#16a84c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
        </g>

        {/* x축 레이블 */}
        {Array.from(xLabels).map(d => (
          <text
            key={d}
            x={xOf(d)} y={H - 6}
            textAnchor="middle" fontSize="10" fill="#727272"
          >{d}일</text>
        ))}

        {/* 호버: 수직선 — snapped day x 위치 */}
        {hoverDay !== null && hoverX !== null && (
          <line
            x1={hoverX} y1={padTop}
            x2={hoverX} y2={padTop + chartH}
            stroke="#AAAAAA" strokeWidth="1" strokeDasharray="3 3"
          />
        )}

        {/* 호버: 데이터 포인트 원 — snapped day 위치 */}
        {hoverDay !== null && (
          <>
            {showOrder   && hoverOrdAmt > 0 && (
              <circle cx={xOf(hoverDay)} cy={yOf(hoverOrdAmt)} r="4" fill="#6B7280" />
            )}
            {showDeposit && hoverDepAmt > 0 && (
              <circle cx={xOf(hoverDay)} cy={yOf(hoverDepAmt)} r="4" fill="#16a84c" />
            )}
          </>
        )}
      </svg>

      {/* 호버 툴팁 */}
      {hoverDay !== null && ((showDeposit && hoverDepAmt > 0) || (showOrder && hoverOrdAmt > 0)) && (
        <div
          className="absolute z-10 pointer-events-none bg-white border border-gray-border rounded-xl shadow-lg px-3 py-2.5 text-[11px] min-w-[140px]"
          style={{
            top: '12px',
            ...(tooltipSide === 'right'
              ? { left: `calc(${((hoverX! / W) * 100).toFixed(1)}% + 10px)` }
              : { right: `calc(${(((W - hoverX!) / W) * 100).toFixed(1)}% + 10px)` }
            ),
          }}
        >
          <div className="font-bold text-ink mb-1.5">{month + 1}월 {hoverDay}일</div>
          {showDeposit && (
            <div className="flex items-center gap-1.5 mb-1">
              <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#16a84c' }} />
              <span className="text-gray-text">선결제</span>
              <span className="ml-auto font-bold text-green">{hoverDepAmt > 0 ? `+${hoverDepAmt.toLocaleString()}원` : '—'}</span>
            </div>
          )}
          {showOrder && (
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#6B7280' }} />
              <span className="text-gray-text">주문</span>
              <span className="ml-auto font-bold text-ink">{hoverOrdAmt > 0 ? `-${hoverOrdAmt.toLocaleString()}원` : '—'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Sales() {
  const { storeId } = useStore()
  const now = new Date()

  // ── 월 상태 ───────────────────────────────────────────────────────────────
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())

  // ── 메인 데이터 ───────────────────────────────────────────────────────────
  const [deposits, setDeposits] = useState<MonthDeposit[]>([])
  const [orders,   setOrders]   = useState<MonthOrder[]>([])
  const [accounts, setAccounts] = useState<DbAccount[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(false)

  // ── 캘린더 필터 ───────────────────────────────────────────────────────────
  const [filterAccount, setFilterAccount] = useState<string | null>(null)
  const [selectedDay,   setSelectedDay]   = useState<number | null>(null)
  const [showDeposit,   setShowDeposit]   = useState(true)
  const [showOrder,     setShowOrder]     = useState(true)

  // ── 거래처 상세 패널 ──────────────────────────────────────────────────────
  const [panelAccount,    setPanelAccount]    = useState<DbAccount | null>(null)
  const [historyLoading,  setHistoryLoading]  = useState(false)
  const [historyMonths,   setHistoryMonths]   = useState<HistoryMonth[]>([])
  const [expandedMonthKey, setExpandedMonthKey] = useState<string | null>(null)

  // ── 거래처 제외 필터 ──────────────────────────────────────────────────────
  const [excludedAccounts,   setExcludedAccounts]   = useState<Set<string>>(new Set())
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false)
  const filterDropdownRef = useRef<HTMLDivElement>(null)

  const { setHeaderRight } = useHeaderSlot()

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()
  const fetchIdRef     = useRef(0)

  // ── 메인 데이터 패치 ──────────────────────────────────────────────────────
  async function fetchData() {
    if (!storeId) return
    const thisId = ++fetchIdRef.current
    setLoading(true); setError(false)
    setDeposits([]); setOrders([])

    try {
      const { start, end } = monthRangeUtc(year, month)

      const { data: accData, error: accErr } = await supabase
        .from('accounts').select('*')
        .eq('store_id', storeId).eq('is_active', true).order('account_name')
      if (accErr) throw accErr
      if (thisId !== fetchIdRef.current) return

      const accountCodes = (accData ?? []).map(a => a.account_code as string)

      const [depResult, ordResult] = await Promise.all([
        accountCodes.length > 0
          ? supabase.from('deposits')
              .select('deposit_id, account_code, amount, note, payment_method, created_at')
              .in('account_code', accountCodes)
              .gte('created_at', start).lt('created_at', end)
              .order('created_at', { ascending: true })
          : Promise.resolve({ data: [] as any[], error: null }),
        accountCodes.length > 0
          ? supabase.from('orders')
              .select('order_code, order_number, account_code, orderer_name, method, total_amount, ordered_at, order_items(menu_name, quantity)')
              .eq('store_id', storeId).neq('status', '취소')
              .in('account_code', accountCodes)
              .gte('ordered_at', start).lt('ordered_at', end)
          : Promise.resolve({ data: [] as any[], error: null }),
      ])
      if (depResult.error) throw depResult.error
      if (ordResult.error) throw ordResult.error
      if (thisId !== fetchIdRef.current) return

      const nameMap: Record<string, string> = {}
      for (const a of accData ?? []) nameMap[a.account_code] = a.account_name

      setDeposits((depResult.data ?? []).map(d => ({
        deposit_id: d.deposit_id, account_code: d.account_code,
        account_name: nameMap[d.account_code] ?? '',
        amount: d.amount, note: d.note ?? null,
        payment_method: d.payment_method ?? null,
        created_at: d.created_at, day: kstDay(d.created_at),
      })))
      setOrders((ordResult.data ?? []).map(o => ({
        order_code: o.order_code, order_number: o.order_number,
        account_code: o.account_code, account_name: nameMap[o.account_code] ?? '',
        orderer_name: o.orderer_name, method: o.method,
        total_amount: o.total_amount, ordered_at: o.ordered_at,
        day: kstDay(o.ordered_at),
        items: (o.order_items ?? []).map((i: any) => ({ menu_name: i.menu_name, quantity: i.quantity })),
      })))
      setAccounts(accData ?? [])
    } catch {
      if (thisId !== fetchIdRef.current) return
      setError(true)
    } finally {
      if (thisId === fetchIdRef.current) setLoading(false)
    }
  }

  // ── 거래처 상세 히스토리 패치 ─────────────────────────────────────────────
  async function fetchAccountHistory(accountCode: string) {
    setHistoryLoading(true)
    setHistoryMonths([])
    try {
      const [depRes, ordRes] = await Promise.all([
        supabase.from('deposits')
          .select('deposit_id, amount, note, payment_method, created_at')
          .eq('account_code', accountCode)
          .order('created_at', { ascending: false }),
        supabase.from('orders')
          .select('order_code, total_amount, ordered_at, orderer_name, order_items(menu_name, quantity)')
          .eq('account_code', accountCode).neq('status', '취소')
          .order('ordered_at', { ascending: false }),
      ])
      if (depRes.error || ordRes.error) throw new Error()

      // 월별로 묶기
      const monthMap: Record<string, HistoryMonth> = {}
      const getOrCreate = (iso: string) => {
        const key = kstMonthKey(iso)
        if (!monthMap[key]) {
          const d = new Date(new Date(iso).getTime() + KST_OFFSET_MS)
          monthMap[key] = {
            key, year: d.getUTCFullYear(), month: d.getUTCMonth(),
            totalDeposit: 0, totalOrder: 0, items: [],
          }
        }
        return monthMap[key]
      }

      for (const d of depRes.data ?? []) {
        const m = getOrCreate(d.created_at)
        m.totalDeposit += d.amount
        m.items.push({ type: 'deposit', day: kstDay(d.created_at), amount: d.amount, note: d.note, created_at: d.created_at })
      }
      for (const o of ordRes.data ?? []) {
        const m = getOrCreate(o.ordered_at)
        m.totalOrder += o.total_amount
        const menuSummary = (o.order_items ?? []).map((i: any) => i.quantity > 1 ? `${i.menu_name} ×${i.quantity}` : i.menu_name).join(', ')
        m.items.push({ type: 'order', day: kstDay(o.ordered_at), amount: o.total_amount, created_at: o.ordered_at, orderer_name: o.orderer_name, menu_summary: menuSummary || null })
      }

      // 각 월 items를 날짜 오름차순 정렬
      const sorted = Object.values(monthMap)
        .map(m => ({ ...m, items: m.items.sort((a, b) => a.created_at.localeCompare(b.created_at)) }))
        .sort((a, b) => b.key.localeCompare(a.key))  // 최신 월 먼저

      setHistoryMonths(sorted)

      // 현재 보고 있는 달을 기본 펼침
      const currentKey = `${year}-${String(month + 1).padStart(2,'0')}`
      if (sorted.some(m => m.key === currentKey)) setExpandedMonthKey(currentKey)
      else if (sorted.length > 0) setExpandedMonthKey(sorted[0].key)
    } catch {
      // 실패 시 빈 상태 유지
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    setSelectedDay(null)
    fetchData()
  }, [storeId, year, month])

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
        setFilterDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // 거래처 표시 필터 → 공유 헤더 슬롯에 주입
  useEffect(() => {
    if (accounts.length === 0) {
      setHeaderRight(null)
      return
    }
    setHeaderRight(
      <div className="relative flex-shrink-0" ref={filterDropdownRef}>
        <button
          onClick={() => setFilterDropdownOpen(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors ${
            excludedAccounts.size > 0
              ? 'border-orange-300 bg-orange-50 text-orange-700'
              : 'border-gray-border text-gray-text bg-white hover:bg-gray-bg'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
          </svg>
          {excludedAccounts.size === 0
            ? `전체 거래처 (${accounts.length})`
            : `${accounts.length - excludedAccounts.size}/${accounts.length}개 표시 중`}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform duration-150 ${filterDropdownOpen ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {filterDropdownOpen && (
          <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-border rounded-xl shadow-lg w-[230px] overflow-hidden">
            {/* 전체 선택 / 해제 */}
            <div
              onClick={() => setExcludedAccounts(excludedAccounts.size === 0
                ? new Set(accounts.map(a => a.account_code))
                : new Set()
              )}
              className="flex items-center gap-2.5 px-3 py-2.5 border-b border-gray-border/50 hover:bg-gray-bg cursor-pointer"
            >
              <div className={`w-[16px] h-[16px] rounded-[4px] border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                excludedAccounts.size === 0
                  ? 'bg-[#16a84c] border-[#16a84c]'
                  : excludedAccounts.size < accounts.length
                    ? 'bg-white border-gray-border'
                    : 'bg-white border-gray-border'
              }`}>
                {excludedAccounts.size === 0 && (
                  <svg width="9" height="6" viewBox="0 0 10 7" fill="none"><path d="M1 3.5L3.5 6L9 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                )}
                {excludedAccounts.size > 0 && excludedAccounts.size < accounts.length && (
                  <div className="w-2 h-0.5 bg-gray-400 rounded" />
                )}
              </div>
              <span className="text-[13px] font-bold text-ink">전체 선택</span>
            </div>
            {/* 개별 거래처 */}
            <div className="max-h-[260px] overflow-y-auto">
              {accounts.map(acc => {
                const included = !excludedAccounts.has(acc.account_code)
                return (
                  <div
                    key={acc.account_code}
                    onClick={() => setExcludedAccounts(prev => {
                      const next = new Set(prev)
                      if (next.has(acc.account_code)) next.delete(acc.account_code)
                      else next.add(acc.account_code)
                      return next
                    })}
                    className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-bg cursor-pointer"
                  >
                    <div className={`w-[16px] h-[16px] rounded-[4px] border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      included ? 'bg-[#16a84c] border-[#16a84c]' : 'bg-white border-gray-border'
                    }`}>
                      {included && (
                        <svg width="9" height="6" viewBox="0 0 10 7" fill="none"><path d="M1 3.5L3.5 6L9 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] text-ink truncate">{acc.account_name}</div>
                      {acc.organization_name && acc.organization_name !== acc.account_name && (
                        <div className="text-[10px] text-gray-text truncate">{acc.organization_name}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
    return () => setHeaderRight(null)
  }, [accounts, excludedAccounts, filterDropdownOpen])

  // 제외된 거래처가 상세 패널에 열려 있으면 자동 닫기
  useEffect(() => {
    if (filterAccount && excludedAccounts.has(filterAccount)) {
      setFilterAccount(null); setPanelAccount(null); setHistoryMonths([]); setSelectedDay(null)
    }
  }, [excludedAccounts])

  // ── 월 이동 ───────────────────────────────────────────────────────────────
  function prevMonth() {
    setSelectedDay(null)
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else             { setMonth(m => m - 1) }
  }
  function nextMonth() {
    if (isCurrentMonth) return
    setSelectedDay(null)
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else              { setMonth(m => m + 1) }
  }

  // ── 파생 데이터 ───────────────────────────────────────────────────────────
  // 제외 필터 적용된 표시용 데이터
  const visibleDeposits = useMemo(() =>
    excludedAccounts.size === 0 ? deposits : deposits.filter(d => !excludedAccounts.has(d.account_code)),
    [deposits, excludedAccounts]
  )
  const visibleOrders = useMemo(() =>
    excludedAccounts.size === 0 ? orders : orders.filter(o => !excludedAccounts.has(o.account_code)),
    [orders, excludedAccounts]
  )

  const filteredDeposits = useMemo(() =>
    filterAccount ? visibleDeposits.filter(d => d.account_code === filterAccount) : visibleDeposits,
    [visibleDeposits, filterAccount]
  )
  const dayAmountMap = useMemo(() => {
    const map: Record<number, number> = {}
    for (const d of filteredDeposits) map[d.day] = (map[d.day] ?? 0) + d.amount
    return map
  }, [filteredDeposits])
  const dayOrderMap = useMemo(() => {
    const map: Record<number, number> = {}
    for (const o of visibleOrders) {
      if (filterAccount && o.account_code !== filterAccount) continue
      map[o.day] = (map[o.day] ?? 0) + o.total_amount
    }
    return map
  }, [visibleOrders, filterAccount])
  const dayDepositCountMap = useMemo(() => {
    const map: Record<number, number> = {}
    for (const d of filteredDeposits) map[d.day] = (map[d.day] ?? 0) + 1
    return map
  }, [filteredDeposits])
  const dayOrderCountMap = useMemo(() => {
    const map: Record<number, number> = {}
    for (const o of visibleOrders) {
      if (filterAccount && o.account_code !== filterAccount) continue
      map[o.day] = (map[o.day] ?? 0) + 1
    }
    return map
  }, [visibleOrders, filterAccount])
  const selectedDayDeposits = useMemo(() =>
    selectedDay !== null ? filteredDeposits.filter(d => d.day === selectedDay) : [],
    [filteredDeposits, selectedDay]
  )
  const monthTotalDeposit = filteredDeposits.reduce((s, d) => s + d.amount, 0)
  const filteredOrders    = filterAccount ? visibleOrders.filter(o => o.account_code === filterAccount) : visibleOrders
  const monthTotalOrder   = filteredOrders.reduce((s, o) => s + o.total_amount, 0)
  const selectedDayOrders = useMemo(() =>
    selectedDay !== null ? filteredOrders.filter(o => o.day === selectedDay) : [],
    [filteredOrders, selectedDay]
  )
  const accountStats = useMemo(() => {
    const depByAcc: Record<string, number> = {}
    const ordByAcc: Record<string, number> = {}
    for (const d of visibleDeposits) depByAcc[d.account_code] = (depByAcc[d.account_code] ?? 0) + d.amount
    for (const o of visibleOrders)   ordByAcc[o.account_code] = (ordByAcc[o.account_code] ?? 0) + o.total_amount
    return accounts
      .filter(acc => !excludedAccounts.has(acc.account_code))
      .map(acc => ({ acc, monthDeposit: depByAcc[acc.account_code] ?? 0, monthOrder: ordByAcc[acc.account_code] ?? 0 }))
      .filter(r => r.monthDeposit > 0 || r.monthOrder > 0 || r.acc.current_balance !== 0)
      .sort((a, b) => b.monthDeposit - a.monthDeposit || b.monthOrder - a.monthOrder)
  }, [visibleDeposits, visibleOrders, accounts, excludedAccounts])
  // 원형 그래프용: 거래처별 충전 내역 (일별)
  const depositChartData = useMemo(() => {
    const accMap: Record<string, { name: string; total: number; days: Record<number, number> }> = {}
    for (const d of filteredDeposits) {
      if (!accMap[d.account_code]) accMap[d.account_code] = { name: d.account_name, total: 0, days: {} }
      accMap[d.account_code].total += d.amount
      accMap[d.account_code].days[d.day] = (accMap[d.account_code].days[d.day] ?? 0) + d.amount
    }
    return Object.entries(accMap)
      .map(([, v]) => v)
      .sort((a, b) => b.total - a.total)
  }, [filteredDeposits])

  // 원형 그래프용: 거래처별 주문 내역 (일별)
  const orderChartData = useMemo(() => {
    const accMap: Record<string, { name: string; total: number; days: Record<number, number> }> = {}
    for (const o of filteredOrders) {
      if (!accMap[o.account_code]) accMap[o.account_code] = { name: o.account_name, total: 0, days: {} }
      accMap[o.account_code].total += o.total_amount
      accMap[o.account_code].days[o.day] = (accMap[o.account_code].days[o.day] ?? 0) + o.total_amount
    }
    return Object.entries(accMap)
      .map(([, v]) => v)
      .sort((a, b) => b.total - a.total)
  }, [filteredOrders])

  const tableTotals = {
    deposit: accountStats.reduce((s, r) => s + r.monthDeposit, 0),
    order:   accountStats.reduce((s, r) => s + r.monthOrder, 0),
  }
  const calCells = useMemo<(number | null)[]>(() => {
    const cells: (number | null)[] = [
      ...Array(firstDow(year, month)).fill(null),
      ...Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1),
    ]
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [year, month])

  const monthLabel = `${year}년 ${MONTH_NAMES[month]}`
  const filterName = filterAccount ? (accounts.find(a => a.account_code === filterAccount)?.account_name ?? '') : null
  const todayKstDay = isCurrentMonth ? now.getDate() : -1
  const todayKstDow = isCurrentMonth ? DAY_NAMES[new Date(now.getTime() + KST_OFFSET_MS).getUTCDay()] : ''

  // ── 렌더 ──────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-gray-bg overflow-hidden p-3">

      {/* ── 본문 ── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-green border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-text">
          <div className="text-[40px]">⚠️</div>
          <div className="text-[16px] font-bold text-ink">데이터를 불러오지 못했습니다</div>
          <div className="text-[13px]">네트워크 상태를 확인하고 다시 시도해주세요.</div>
          <button onClick={fetchData} className="mt-1 px-5 py-2 rounded-lg bg-ink text-white text-[13px] font-bold hover:bg-ink/80">
            다시 시도
          </button>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden bg-white rounded-xl shadow-sm">

          {/* ── 좌측 메인 ── */}
          <div className="flex-1 overflow-y-auto px-8 py-5 space-y-4 min-w-0">

            {/* ── 월 네비게이터 (카드 바로 위, 좌측정렬) ── */}
            <div className="flex items-center gap-2">
              <button
                onClick={prevMonth}
                className="w-7 h-7 rounded-lg bg-white hover:bg-gray-200 border border-gray-border flex items-center justify-center text-[16px] text-ink transition-colors"
              >‹</button>
              <span className="text-[14px] font-extrabold text-ink">{monthLabel}</span>
              <button
                onClick={nextMonth}
                disabled={isCurrentMonth}
                className="w-7 h-7 rounded-lg bg-white hover:bg-gray-200 border border-gray-border flex items-center justify-center text-[16px] text-ink transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >›</button>
            </div>

            {/* ── 요약 카드 ── */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl px-3 py-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-gray-text mb-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{MONTH_NAMES[month]} 선결제 매출</span>
                      {filterName && (
                        <>
                          <span className="text-gray-border">·</span>
                          <span className="text-green">{filterName}</span>
                          <button onClick={() => setFilterAccount(null)} className="text-[10px] text-gray-text hover:text-ink bg-gray-100 rounded px-1.5 py-0.5">필터 해제</button>
                        </>
                      )}
                    </div>
                    <div className="text-[28px] font-extrabold text-green">+{won(monthTotalDeposit)}</div>
                    {(() => {
                      if (filterName) return null
                      const visibleAccounts = accounts.filter(a => !excludedAccounts.has(a.account_code))
                      const charged = new Set(visibleDeposits.map(d => d.account_code)).size
                      const total   = visibleAccounts.length
                      if (total === 0) return null
                      if (charged === 0) return <div className="text-[11px] text-gray-text mt-1">{MONTH_NAMES[month]} 충전 거래처 없음</div>
                      if (charged === total) return <div className="text-[11px] text-green font-semibold mt-1">전체 {total}곳 모두 충전</div>
                      return <div className="text-[11px] text-gray-text mt-1">전체 {total}곳 중 {charged}곳 충전</div>
                    })()}
                  </div>
                  {depositChartData.length > 0 && (
                    <DonutChart
                      size={90}
                      segments={depositChartData.map((d, i) => ({
                        label: d.name,
                        value: d.total,
                        color: CHART_COLORS[i % CHART_COLORS.length],
                        tooltip: (
                          <div className="space-y-1">
                            {Object.entries(d.days)
                              .sort(([a], [b]) => Number(a) - Number(b))
                              .map(([day, amt]) => (
                                <div key={day} className="flex justify-between gap-4 text-[10px]">
                                  <span className="text-gray-text">{month + 1}월 {day}일</span>
                                  <span className="font-bold text-green">+{won(amt)}</span>
                                </div>
                              ))}
                            <div className="border-t border-gray-border/50 pt-1 mt-1 flex justify-between text-[10px] font-bold">
                              <span>합계</span><span className="text-green">+{won(d.total)}</span>
                            </div>
                          </div>
                        ),
                      }))}
                    />
                  )}
                </div>
              </div>
              <div className="bg-white rounded-2xl px-3 py-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-gray-text mb-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{MONTH_NAMES[month]} 주문액</span>
                      {filterName && (
                        <>
                          <span className="text-gray-border">·</span>
                          <span className="text-green">{filterName}</span>
                        </>
                      )}
                    </div>
                    <div className="text-[28px] font-extrabold text-ink">-{won(monthTotalOrder)}</div>
                    <div className="text-[11px] text-gray-text mt-1">
                      취소 주문 제외
                    </div>
                  </div>
                  {orderChartData.length > 0 && (
                    <DonutChart
                      size={90}
                      segments={orderChartData.map((d, i) => ({
                        label: d.name,
                        value: d.total,
                        color: CHART_COLORS[i % CHART_COLORS.length],
                        tooltip: (
                          <div className="space-y-1">
                            {Object.entries(d.days)
                              .sort(([a], [b]) => Number(a) - Number(b))
                              .map(([day, amt]) => (
                                <div key={day} className="flex justify-between gap-4 text-[10px]">
                                  <span className="text-gray-text">{month + 1}월 {day}일</span>
                                  <span className="font-bold text-ink">-{won(amt)}</span>
                                </div>
                              ))}
                            <div className="border-t border-gray-border/50 pt-1 mt-1 flex justify-between text-[10px] font-bold">
                              <span>합계</span><span>-{won(d.total)}</span>
                            </div>
                          </div>
                        ),
                      }))}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* ── 일자별 매출 그래프 ── */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-3 py-2.5 border-b border-gray-border flex items-center justify-between">
                <div className="text-[13px] font-extrabold text-ink">일자별 매출</div>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    onClick={() => {
                      // 이미 선결제만 보이는 상태 → 둘 다 보이기
                      if (showDeposit && !showOrder) { setShowDeposit(true); setShowOrder(true) }
                      // 그 외 → 선결제만 보이기
                      else { setShowDeposit(true); setShowOrder(false) }
                    }}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full transition-opacity ${showDeposit ? 'opacity-100' : 'opacity-35'}`}
                  >
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#16a84c' }} />
                    <span className={showDeposit ? 'text-ink font-semibold' : 'text-gray-text'}>선결제</span>
                  </button>
                  <button
                    onClick={() => {
                      // 이미 주문만 보이는 상태 → 둘 다 보이기
                      if (showOrder && !showDeposit) { setShowDeposit(true); setShowOrder(true) }
                      // 그 외 → 주문만 보이기
                      else { setShowDeposit(false); setShowOrder(true) }
                    }}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full transition-opacity ${showOrder ? 'opacity-100' : 'opacity-35'}`}
                  >
                    <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#6B7280' }} />
                    <span className={showOrder ? 'text-ink font-semibold' : 'text-gray-text'}>주문</span>
                  </button>
                </div>
              </div>
              <div className="px-3 py-3">
                <DailySalesLineChart
                  depositByDay={dayAmountMap}
                  orderByDay={dayOrderMap}
                  totalDays={daysInMonth(year, month)}
                  month={month}
                  showDeposit={showDeposit}
                  showOrder={showOrder}
                />
              </div>
            </div>

            {/* ── 충전 캘린더 ── */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-3 py-2.5 border-b border-gray-border flex items-start justify-between">
                <div>
                  <div className="text-[13px] font-extrabold text-ink">충전 캘린더</div>
                  <div className="text-[11px] text-gray-text mt-0.5">
                    클릭하여 상세 내역을 확인해보세요
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <div className="text-[12px] font-extrabold text-ink">
                    {year}년 {MONTH_NAMES[month]}{isCurrentMonth ? ` ${todayKstDay}일 (${todayKstDow})` : ''}
                  </div>
                  <div className="text-[11px] text-gray-text">{month + 1}월 1일 ~ {month + 1}월 {daysInMonth(year, month)}일</div>
                  {Object.keys(dayAmountMap).length === 0 && (
                    <span className="text-[10px] text-gray-text bg-gray-100 rounded px-2 py-0.5">{MONTH_NAMES[month]} 충전 없음</span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-7 border-b border-gray-border/50">
                {DAY_NAMES.map((d, i) => (
                  <div key={d} className={`py-2 text-center text-[11px] font-bold
                    ${i === 0 ? 'text-danger' : i === 6 ? 'text-blue-500' : 'text-gray-text'}`}>{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {calCells.map((day, i) => {
                  if (!day) return (
                    <div key={`empty-${i}`} className={`min-h-[60px] border-b border-gray-border/30 bg-gray-bg/40 ${i % 7 !== 6 ? 'border-r border-gray-border/30' : ''}`} />
                  )
                  const amount      = dayAmountMap[day]
                  const orderAmount = dayOrderMap[day]
                  const isSelected  = selectedDay === day
                  const isToday     = day === todayKstDay
                  const dow         = i % 7
                  const isClickable = !!(amount || orderAmount)
                  return (
                    <div
                      key={day}
                      onClick={() => { if (isClickable) setSelectedDay(isSelected ? null : day) }}
                      className={[
                        'min-h-[60px] p-1.5 border-b border-gray-border/30 flex flex-col transition-colors',
                        i % 7 !== 6 ? 'border-r border-gray-border/30' : '',
                        isClickable ? 'cursor-pointer' : '',
                        isSelected ? 'bg-green-soft' : isClickable ? 'hover:bg-green-soft/40' : '',
                      ].join(' ')}
                    >
                      {isToday ? (
                        <span className={`inline-flex items-center justify-center w-[22px] h-[22px] rounded-[5px] bg-gray-200 text-[12px] font-semibold flex-shrink-0 ${dow === 0 ? 'text-danger' : dow === 6 ? 'text-blue-500' : 'text-ink'}`}>{day}</span>
                      ) : (
                        <span className={`text-[12px] font-semibold leading-none flex-shrink-0 ${dow === 0 ? 'text-danger' : dow === 6 ? 'text-blue-500' : 'text-ink'}`}>{day}</span>
                      )}
                      {(amount || orderAmount) ? (
                        <div className="mt-auto space-y-0.5">
                          {amount ? <div className="text-[10px] font-bold leading-tight text-green">+{won(amount)} <span className="font-normal opacity-70">({dayDepositCountMap[day] ?? 0})</span></div> : null}
                          {orderAmount ? <div className="text-[10px] font-normal leading-tight text-gray-text">-{won(orderAmount)} <span className="opacity-70">({dayOrderCountMap[day] ?? 0})</span></div> : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ── 거래처별 정산 테이블 ── */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <div className="px-3 py-2.5 border-b border-gray-border">
                <div className="text-[13px] font-extrabold text-ink">거래처별 정산</div>
                <div className="text-[11px] text-gray-text mt-0.5">
                  충전·주문액은 <strong className="text-ink">{monthLabel} 기준</strong>이며 현재 잔액은 <strong className="text-ink">실시간</strong> ({now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} 기준)입니다. 행을 클릭하면 캘린더가 해당 거래처로 필터됩니다.
                </div>
              </div>
              {accountStats.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <div className="text-[28px] mb-2">📭</div>
                  <div className="text-[13px] font-bold text-ink">거래 내역이 없습니다</div>
                  <div className="text-[11px] text-gray-text mt-1">{monthLabel}에 충전하거나 주문한 거래처가 없고<br />잔액이 남은 거래처도 없습니다</div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-border bg-gray-bg/50">
                        <th className="px-5 py-2.5 text-left  text-[11px] font-bold text-gray-text">거래처</th>
                        <th className="px-4 py-2.5 text-right text-[11px] font-bold text-gray-text whitespace-nowrap">{MONTH_NAMES[month]} 선결제 매출</th>
                        <th className="px-4 py-2.5 text-right text-[11px] font-bold text-gray-text whitespace-nowrap">{MONTH_NAMES[month]} 주문액</th>
                        <th className="px-5 py-2.5 text-right text-[11px] font-bold text-gray-text whitespace-nowrap">현재 잔액</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-border/40">
                      {accountStats.map(({ acc, monthDeposit, monthOrder }) => {
                        const isFiltered  = filterAccount === acc.account_code
                        const isPanelOpen = panelAccount?.account_code === acc.account_code
                        const balNeg = acc.current_balance < 0
                        const balLow = !balNeg && acc.current_balance < acc.warning_threshold
                        return (
                          <tr
                            key={acc.account_code}
                            onClick={() => {
                              const opening = !isPanelOpen
                              setFilterAccount(opening ? acc.account_code : null)
                              setSelectedDay(null)
                              if (opening) {
                                setPanelAccount(acc)
                                fetchAccountHistory(acc.account_code)
                              } else {
                                setPanelAccount(null)
                                setHistoryMonths([])
                              }
                            }}
                            className={`cursor-pointer transition-colors ${isPanelOpen ? 'bg-green-soft' : isFiltered ? 'bg-green-soft/50' : 'hover:bg-gray-bg'}`}
                          >
                            <td className="px-5 py-2.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[12px] font-semibold text-ink">{acc.account_name}</span>
                              </div>
                              {acc.organization_name && acc.organization_name !== acc.account_name && <div className="text-[11px] text-gray-text">{acc.organization_name}</div>}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={`text-[12px] font-semibold ${monthDeposit > 0 ? 'text-green' : 'text-gray-text'}`}>
                                {monthDeposit > 0 ? won(monthDeposit) : '—'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={`text-[12px] font-semibold ${monthOrder > 0 ? 'text-ink' : 'text-gray-text'}`}>
                                {monthOrder > 0 ? won(monthOrder) : '—'}
                              </span>
                            </td>
                            <td className="px-5 py-2.5 text-right">
                              <span className={`text-[12px] font-bold ${balNeg ? 'text-danger' : balLow ? 'text-orange-500' : 'text-ink'}`}>
                                {won(acc.current_balance)}
                              </span>
                              {balNeg && <div className="text-[10px] text-danger font-medium">다음 충전 시 정산</div>}
                              {balLow && <div className="text-[10px] text-orange-500 font-medium">잔액 부족 임박</div>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-border bg-gray-bg/50">
                        <td className="px-5 py-2.5 text-[11px] font-bold text-gray-text">합계 ({accountStats.length}개 거래처)</td>
                        <td className="px-4 py-2.5 text-right text-[12px] font-extrabold text-green">{won(tableTotals.deposit)}</td>
                        <td className="px-4 py-2.5 text-right text-[12px] font-extrabold text-ink">{won(tableTotals.order)}</td>
                        <td className="px-5 py-2.5" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            <div className="h-4" />
          </div>

          {/* ── 우측 패널 ── */}
          {panelAccount ? (
            /* ── 거래처 상세 패널 ── */
            <div className="w-[280px] flex-shrink-0 border-l border-gray-border bg-white flex flex-col overflow-hidden">
              {/* 헤더 */}
              <div className="px-4 py-3 border-b border-gray-border flex items-start justify-between flex-shrink-0">
                <div className="min-w-0">
                  <div className="text-[13px] font-extrabold text-ink truncate">{panelAccount.account_name}</div>
                  <div className="text-[11px] text-gray-text mt-0.5">
                    현재 잔액&nbsp;
                    <span className="font-bold text-gray-text">
                      {won(panelAccount.current_balance)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => { setPanelAccount(null); setHistoryMonths([]); setFilterAccount(null) }}
                  className="text-gray-text hover:text-ink text-[20px] leading-none flex-shrink-0 ml-2 mt-0.5"
                >×</button>
              </div>

              {/* 월별 아코디언 */}
              <div className="flex-1 overflow-y-auto">
                {historyLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <div className="w-6 h-6 border-3 border-green border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : historyMonths.length === 0 ? (
                  <div className="px-4 py-10 text-center text-[11px] text-gray-text">거래 내역이 없습니다</div>
                ) : (
                  historyMonths.map(hm => {
                    const isExpanded = expandedMonthKey === hm.key
                    const hmLabel   = `${hm.year}년 ${MONTH_NAMES[hm.month]}`
                    return (
                      <div key={hm.key} className="border-b border-gray-border/50">
                        {/* 월 헤더 행 — 클릭으로 펼침/접음 */}
                        <button
                          onClick={() => setExpandedMonthKey(isExpanded ? null : hm.key)}
                          className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-bg transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`text-[11px] transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                            <span className="text-[12px] font-bold text-ink">{hmLabel}</span>
                          </div>
                          <div className="text-right flex-shrink-0 ml-2">
                            {hm.totalDeposit > 0 && (
                              <div className="text-[11px] font-semibold text-green">+{won(hm.totalDeposit)}</div>
                            )}
                            {hm.totalOrder > 0 && (
                              <div className="text-[11px] font-semibold text-gray-text">-{won(hm.totalOrder)}</div>
                            )}
                          </div>
                        </button>

                        {/* 일별 상세 — 펼쳐진 상태 */}
                        {isExpanded && (
                          <div className="border-t border-gray-border/50 bg-gray-bg divide-y divide-gray-border/40">
                            {hm.items.map((item, idx) => (
                              <div key={idx} className="px-4 py-2 flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <span className="text-[11px] text-gray-text">
                                    {hm.month + 1}월 {item.day}일
                                  </span>
                                  {item.type === 'deposit' && item.note && (
                                    <div className="text-[10px] text-gray-text truncate">{item.note}</div>
                                  )}
                                  {item.type === 'order' && (
                                    <>
                                      {item.orderer_name && <div className="text-[10px] text-gray-text">{item.orderer_name}</div>}
                                      {item.menu_summary && <div className="text-[10px] text-gray-text truncate">{item.menu_summary}</div>}
                                    </>
                                  )}
                                  <div className="text-[10px] text-gray-text/70">{kstTimeStr(item.created_at)}</div>
                                </div>
                                <span className={`text-[11px] flex-shrink-0
                                  ${item.type === 'deposit' ? 'font-bold text-green' : 'font-normal text-gray-text'}`}>
                                  {item.type === 'deposit' ? '+' : '-'}{won(item.amount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ) : selectedDay !== null ? (
            /* ── 날짜 상세 패널 ── */
            <div className="w-[260px] flex-shrink-0 border-l border-gray-border bg-white flex flex-col overflow-hidden">
              {/* 헤더 */}
              <div className="px-4 py-3 border-b border-gray-border flex items-start justify-between flex-shrink-0">
                <div>
                  <div className="text-[14px] font-extrabold text-ink">{month + 1}월 {selectedDay}일</div>
                  <div className="mt-1 space-y-0.5">
                    {selectedDayDeposits.length > 0 && (
                      <div className="text-[11px] text-gray-text">
                        충전 {selectedDayDeposits.length}건&nbsp;
                        <span className="text-green font-bold">{won(selectedDayDeposits.reduce((s, d) => s + d.amount, 0))}</span>
                      </div>
                    )}
                    {selectedDayOrders.length > 0 && (
                      <div className="text-[11px] text-gray-text">
                        주문 {selectedDayOrders.length}건&nbsp;
                        <span className="font-bold text-ink">{won(selectedDayOrders.reduce((s, o) => s + o.total_amount, 0))}</span>
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={() => setSelectedDay(null)} className="text-gray-text hover:text-ink text-[20px] leading-none flex-shrink-0 mt-0.5">×</button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {/* 충전 내역 */}
                {selectedDayDeposits.length > 0 && (
                  <div>
                    <div className="mx-3 my-2.5 flex">
                      <span className="text-[12px] font-bold text-ink bg-[#F3F4F6] rounded-md px-2.5 py-1">충전</span>
                    </div>
                    <div className="divide-y divide-gray-border/40">
                      {selectedDayDeposits.map(d => (
                        <div key={d.deposit_id} className="px-4 py-2.5">
                          <div className="flex items-start justify-between gap-2 mb-0.5">
                            <span className="text-[11px] font-semibold text-ink leading-snug">{d.account_name}</span>
                            <span className="text-[12px] font-bold text-green flex-shrink-0">+{won(d.amount)}</span>
                          </div>
                          {d.note && <div className="text-[11px] text-gray-text">{d.note}</div>}
                          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                            <span className="text-[10px] text-gray-text">{kstTimeStr(d.created_at)}</span>
                            {d.payment_method && (
                              <span className="text-[10px] bg-gray-100 text-gray-text px-1.5 py-0.5 rounded font-medium">{d.payment_method}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 주문 내역 */}
                {selectedDayOrders.length > 0 && (
                  <div>
                    <div className="mx-3 my-2.5 flex">
                      <span className="text-[12px] font-bold text-ink bg-[#F3F4F6] rounded-md px-2.5 py-1">주문</span>
                    </div>
                    <div className="divide-y divide-gray-border/40">
                      {selectedDayOrders.map(o => (
                        <div key={o.order_code} className="px-4 py-2.5">
                          <div className="flex items-start justify-between gap-2 mb-0.5">
                            <span className="text-[11px] font-semibold text-ink leading-snug">{o.account_name}</span>
                            <span className="text-[12px] font-bold text-ink flex-shrink-0">{won(o.total_amount)}</span>
                          </div>
                          <div className="text-[11px] text-gray-text">{o.orderer_name} · {o.method}</div>
                          <div className="text-[11px] text-gray-text mt-0.5">
                            {o.items.map((item, i) => (
                              <span key={i}>{item.quantity > 1 ? `${item.menu_name} ×${item.quantity}` : item.menu_name}{i < o.items.length - 1 ? ', ' : ''}</span>
                            ))}
                          </div>
                          <div className="text-[10px] text-gray-text/70 mt-0.5">{kstTimeStr(o.ordered_at)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedDayDeposits.length === 0 && selectedDayOrders.length === 0 && (
                  <div className="px-4 py-8 text-center text-[11px] text-gray-text">내역이 없습니다</div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
