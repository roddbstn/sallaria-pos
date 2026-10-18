import { useState, useEffect } from 'react'
import HubLayout, { HubSection, HubPlaceholder, type HubNavItem } from '../components/hub/HubLayout'
import { supabase, type DbAccount } from '../lib/supabase'
import { useStore } from '../lib/store-context'
import { won } from '../lib/ipc'
import { maskName } from '../lib/mask'
import SmsPanelImpl from './SmsPanel'
import { DataTable, DataTableHead, DataTableRow, DataTableNotice, StatusTag } from '../components/ui/DataTable'
import AccountDetailModal, { type AccountDetailTarget } from '../components/customer/AccountDetailModal'
import { makeTypeColorOf, typeBadgeStyle } from '../lib/account-type-color'
import InfoTip from '../components/ui/InfoTip'

// 햄버거 드로어 "고객" 그룹에서 들어오는 전체메뉴 화면 — Figma node 532:3003(고객 현황) ·
// 570:694(계정 관리) · 570:717(QR오더) · 570:673(문자 보내기).
// 좌측 네비 + 본문 셸은 매장 정보(StoreInfo.tsx)와 동일한 구조를 그대로 따른다.
//
// ⚠️ 4개 화면 모두 아직 화면기획이 끝나지 않아서, Figma에 그려진 구성요소의 "자리"만 잡아두고
//    데이터는 비워둔 상태다. 기획이 확정되면 각 패널의 TODO를 채우면 된다.

export type CustomerHubTab = 'detail' | 'accounts' | 'sms'

const NAV: HubNavItem<CustomerHubTab>[] = [
  { key: 'detail',   label: '고객 현황' },
  { key: 'accounts', label: '계정 관리' },
  { key: 'sms',      label: '문자 보내기' },
]

// 아직 연결할 데이터가 정해지지 않은 자리 표시
const EMPTY = '—'

/** 이번 달 1일 00:00 (로컬) ISO */
function monthStartISO(): string {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), 1).toISOString()
}

export default function CustomerHub({
  initialTab, onBack,
}: {
  initialTab: CustomerHubTab
  onBack: () => void
}) {
  const [tab, setTab] = useState<CustomerHubTab>(initialTab)

  return (
    <HubLayout
      title="고객"
      items={NAV}
      activeKey={tab}
      onChange={setTab}
      onBack={onBack}
    >
      {tab === 'detail'   && <CustomerDetailPanel />}
      {tab === 'accounts' && <AccountsPanel />}
      {tab === 'sms'      && <SmsPanel />}
    </HubLayout>
  )
}

// ── 고객 현황 — Figma node 532:3003 ────────────────────────────────────────
// 회색 카드 안에 지표 8개(2행 × 4열) + 우측에 계정유형 비율 도넛. 전부 실데이터.

// 계정유형 색 — stores.customer_types 순서대로 배정(기본 3종 + 매장 추가 3종, 최대 6개)
const TYPE_COLORS = ['#FF676F', '#3374FF', '#ADADAD', '#9B59B6', '#FF8418', '#017333']

const EMPTY_RATE: RateBase = { rate: null, repeat: 0, total: 0 }

/**
 * 단골 비율 — 그 기간에 주문한 **사람** 중, **그 기간 이전에도 주문한 적 있는** 사람의 몫.
 *
 * 전엔 "그 기간 안에서 2번 이상"으로 셌는데, 그 정의는 창 길이에 휘둘린다.
 * 같은 데이터로 10월(한 달)은 37%, 최근 3개월은 66%가 나왔다 — 8월에 한 번, 9월에 한 번
 * 시킨 사람이 월 단위로는 '1회'지만 3개월 창에서는 '2회'로 잡히기 때문이다.
 * 네 수치를 나란히 놓으면 "요즘 더 끈끈해졌다"로 읽히는데 사실은 창만 다른 같은 지표였다.
 *
 * 첫 주문 시각 하나만 알면 창이 몇 달이든 "전부터 오던 사람인가"는 변하지 않는다.
 * 덤으로 당월이 과소평가되던 문제도 사라진다 — 전엔 월 중순엔 2건을 채울 시간이 없어
 * 매달 말일까지 숫자가 계속 올라갔다.
 *
 * 거래처(과)가 아니라 사람 기준인 이유: 과 단위로 세면 한 과에서 여러 명이 한 번씩만
 * 시켜도 '단골'로 잡혀서 끈끈함을 과대평가한다.
 * ⚠️ ordered_by_link_id 가 전 건 null 이라 사람 식별은 orderer_name 뿐이다(동명이인은 합쳐진다).
 *
 * @param rows      그 기간의 주문
 * @param firstSeen 주문자별 첫 주문 시각 (orderer_first_order RPC)
 * @param windowStart 기간 시작 — 이 시각보다 먼저 첫 주문을 한 사람이 '단골'
 */
function regularRateOf(
  rows: { orderer_name: string | null; status: string }[],
  firstSeen: Map<string, string>,
  windowStart: string,
): RateBase {
  const inWindow = new Set<string>()
  for (const o of rows) {
    if (o.status === '취소' || !o.orderer_name) continue
    inWindow.add(o.orderer_name)
  }
  const total   = inWindow.size
  const regular = [...inWindow].filter(n => {
    const first = firstSeen.get(n)
    return first != null && first < windowStart
  }).length
  return { rate: total > 0 ? Math.round((regular / total) * 100) : null, repeat: regular, total }
}

interface DetailStats {
  monthOrderAmount:  number
  monthDepositAmount: number
  accountCount:      number
  newAccountCount:   number
  monthOrderCount:   number
  depositCycleDays:  number | null
  memberCount:       number
  monthOrderRate:    number
  /** 최근 2주 재주문자 비율(%). 그 기간에 주문한 사람이 없으면 null */
  repeatRate:        number | null
  repeatBase:        { repeat: number; total: number }
  typeRatio:         { label: string; count: number; color: string }[]
  topCustomers:      { name: string; orders: number; amount: number }[]
  /** 최근 6개월 월별 추이 — 두 차트가 같은 x축을 쓴다 */
  monthly:           MonthPoint[]
  /** 재주문자 비율을 창(window)만 바꿔 다시 잰 값들 */
  repeatThisMonth:   RateBase
  repeatLastMonth:   RateBase
  repeat3Months:     RateBase
}

/** 월 한 칸 — 주문율과 재주문율을 같이 들고 다닌다(차트 두 개가 같은 배열을 쓴다) */
interface MonthPoint {
  /** '7월' */
  label:       string
  /** 그 달에 한 번이라도 주문한 계정 ÷ 그때까지 만들어진 계정 */
  orderRate:   number
  /** 그 달 주문자 중 2회 이상 주문한 사람 비율. 주문자가 없으면 null */
  repeatRate:  number | null
}

interface RateBase {
  /** 비율(%). 그 기간에 주문자가 없으면 null */
  rate:   number | null
  repeat: number
  total:  number
}

/**
 * 월별 비율 막대 — 주문율·재주문율이 같은 모양을 쓴다.
 *
 * 둘 다 0~100% 라 세로 축을 100 으로 고정한다. 최대값에 맞춰 늘리면 "35% 가 꽉 찬 막대"가
 * 돼서 좋아 보이는 착시가 생긴다. 비율 지표는 눈금이 고정이어야 달끼리 비교가 된다.
 */
function RateBars({ title, hint, data, color }: {
  title: string
  /** 제목 옆 'i' 에 붙는 설명. 고객 화면 표의 '추이' 안내와 같은 방식 */
  hint?: string
  data:  { label: string; value: number | null }[]
  color: string
}) {
  const H = 56
  return (
    <div>
      <div className="flex items-center gap-[5px] mb-[12px]">
        <span className="text-[13px] font-normal text-[#6A635E]">{title}</span>
        {hint && (
          <span
            title={hint}
            className="w-[13px] h-[13px] rounded-full bg-[#E8E4E2] text-[#787878] text-[9px] flex items-center justify-center cursor-default flex-shrink-0"
          >
            i
          </span>
        )}
      </div>
      <div className="flex items-end gap-[8px]" style={{ height: H }}>
        {data.map(d => (
          <div key={d.label} className="flex-1 flex flex-col items-center justify-end h-full group relative">
            {d.value !== null && (
              <span className="text-[10px] text-[#6A635E] mb-[3px] tabular-nums">{d.value}%</span>
            )}
            <div
              className="w-full rounded-t-[3px]"
              style={{
                height: d.value === null ? 2 : Math.max(2, (d.value / 100) * (H - 16)),
                backgroundColor: d.value === null ? '#E5E5E5' : color,
              }}
            />
          </div>
        ))}
      </div>
      <div className="h-px bg-canvas-line mt-[1px]" />
      <div className="flex gap-[8px] mt-[6px]">
        {data.map(d => (
          <span key={d.label} className="flex-1 text-center text-[10px] text-[#6A635E]">{d.label}</span>
        ))}
      </div>
    </div>
  )
}

/** 재주문율 칸 — 비율 + "주문자 N명 중 M명" 근거를 같이 보여준다 */
function repeatCell(label: string, r: RateBase) {
  return {
    label,
    value: r.rate === null ? EMPTY : `${r.rate}%`,
    // 여기엔 숫자만. 정의 문장('전부터 오던 손님')을 네 칸에 다 넣었더니 칸 폭(~190px)을
    // 넘겨 옆 칸 글자 위로 겹쳤다. 설명은 박스 오른쪽 아래에 한 번만 둔다.
    sub:   r.total === 0 ? '주문 없음' : `주문자 ${r.total}명 중 ${r.repeat}명`,
  }
}

function CustomerDetailPanel() {
  const { storeId } = useStore()
  const [stats,   setStats]   = useState<DetailStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!storeId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const mStart = monthStartISO()

      // 활성 거래처가 기준점 — 주문/충전/이용자 집계를 전부 이 목록으로 좁힌다
      const { data: accRows } = await supabase
        .from('accounts')
        .select('account_code, account_name, account_type, created_at')
        .eq('store_id', storeId)
        .eq('is_active', true)
      const accounts = (accRows ?? []) as Pick<DbAccount, 'account_code' | 'account_name' | 'account_type' | 'created_at'>[]
      const codes = accounts.map(a => a.account_code)

      if (codes.length === 0) {
        if (!cancelled) {
          setStats({
            monthOrderAmount: 0, monthDepositAmount: 0, accountCount: 0, newAccountCount: 0,
            monthOrderCount: 0, depositCycleDays: null, memberCount: 0, monthOrderRate: 0,
            repeatRate: null, repeatBase: { repeat: 0, total: 0 },
            typeRatio: [], topCustomers: [], monthly: [],
            repeatThisMonth: EMPTY_RATE, repeatLastMonth: EMPTY_RATE, repeat3Months: EMPTY_RATE,
          })
          setLoading(false)
        }
        return
      }

      // 재주문은 '달'이 아니라 '최근 2주' 창이라서 월 집계와 기간이 다르다 — 쿼리를 따로 둔다
      const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString()

      // 월별 차트 2개와 '이번달/저번달/최근3개월' 재주문율은 전부 같은 원본에서 나온다 —
      // 창만 다르지 재료가 같아서, 쿼리를 창마다 쪼개면 같은 행을 네 번 받게 된다.
      const sixMonthsAgo = new Date()
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
      sixMonthsAgo.setDate(1)
      sixMonthsAgo.setHours(0, 0, 0, 0)

      const [{ data: monthOrders }, { data: monthDeposits }, { data: allDeposits }, { data: members }, { data: recentOrders }, { data: halfYearOrders }] =
        await Promise.all([
          supabase.from('orders').select('account_code, total_amount, status').in('account_code', codes).gte('ordered_at', mStart),
          supabase.from('deposits').select('amount').in('account_code', codes).gte('created_at', mStart),
          supabase.from('deposits').select('account_code, created_at').in('account_code', codes).order('created_at'),
          supabase.from('account_members').select('account_code').in('account_code', codes),
          supabase.from('orders')
            .select('orderer_name, status')
            .in('account_code', codes)
            .gte('ordered_at', twoWeeksAgo),
          supabase.from('orders')
            .select('account_code, orderer_name, ordered_at, status')
            .in('account_code', codes)
            .gte('ordered_at', sixMonthsAgo.toISOString()),
        ])

      // 주문자별 첫 주문 시각 — 단골 판정의 기준. 전체 주문을 내리지 않고 RPC 로 받는다
      // (침산점 기준 93행). 6개월치 주문만으로는 그 앞의 이력을 알 수 없어 5월이 0%로 찍힌다.
      const { data: firstRows } = await supabase.rpc('orderer_first_order', { p_store_id: storeId })
      const firstSeen = new Map<string, string>(
        ((firstRows ?? []) as { orderer_name: string; first_at: string }[])
          .map(r => [r.orderer_name, r.first_at]),
      )

      // 취소 주문은 매출에서 뺀다 (고객 화면의 사용액 집계와 같은 규칙)
      const valid = (monthOrders ?? []).filter((o: { status: string }) => o.status !== '취소')

      const amountByAccount: Record<string, number> = {}
      const countByAccount:  Record<string, number> = {}
      for (const o of valid as { account_code: string; total_amount: number }[]) {
        amountByAccount[o.account_code] = (amountByAccount[o.account_code] ?? 0) + (o.total_amount ?? 0)
        countByAccount[o.account_code]  = (countByAccount[o.account_code] ?? 0) + 1
      }

      // 선결제 주기 = 같은 거래처의 연속 충전 간격 평균(일). 충전이 2번 미만이면 산출 불가.
      const depositsByAccount: Record<string, string[]> = {}
      for (const d of (allDeposits ?? []) as { account_code: string; created_at: string }[]) {
        (depositsByAccount[d.account_code] ??= []).push(d.created_at)
      }
      const gaps: number[] = []
      for (const dates of Object.values(depositsByAccount)) {
        for (let i = 1; i < dates.length; i++) {
          gaps.push((new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000)
        }
      }
      const depositCycleDays = gaps.length > 0
        ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)
        : null

      const typeCounts: Record<string, number> = {}
      for (const a of accounts) typeCounts[a.account_type] = (typeCounts[a.account_type] ?? 0) + 1

      // 재주문자 비율 — 최근 2주에 주문한 사람 중 2번 이상 주문한 사람의 몫.
      // 거래처(과)가 아니라 **사람(주문자명)** 기준이다. 과 단위로 세면 한 과에서
      // 여러 명이 한 번씩만 시켜도 "재주문"으로 잡혀서 끈끈함을 과대평가한다.
      // ⚠️ ordered_by_link_id 가 전 건 null 이라 사람 식별은 orderer_name 뿐이다(동명이인은 합쳐진다).
      const recent2w = regularRateOf(
        (recentOrders ?? []) as { orderer_name: string | null; status: string }[],
        firstSeen, twoWeeksAgo,
      )
      const repeatTotal = recent2w.total
      const repeatCount = recent2w.repeat

      // ── 월별 추이 ──────────────────────────────────────────────────────
      // 주문율 분모는 "그 달까지 만들어진 계정"이다. 지금 계정 수로 과거를 나누면
      // 최근에 늘어난 거래처 때문에 지난달들이 실제보다 낮게 찍힌다.
      type HalfRow = { account_code: string; orderer_name: string | null; ordered_at: string; status: string }
      const halfRows = (halfYearOrders ?? []) as HalfRow[]
      const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`

      const rowsByMonth = new Map<string, HalfRow[]>()
      for (const r of halfRows) {
        const k = monthKey(new Date(r.ordered_at))
        ;(rowsByMonth.get(k) ?? rowsByMonth.set(k, []).get(k)!).push(r)
      }

      const monthly: MonthPoint[] = []
      for (let back = 5; back >= 0; back--) {
        const d = new Date()
        d.setDate(1)
        d.setMonth(d.getMonth() - back)
        const k    = monthKey(d)
        const rows = rowsByMonth.get(k) ?? []
        const ok   = rows.filter(r => r.status !== '취소')

        // 그 달 말까지 존재하던 계정만 분모에 넣는다
        const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString()
        const base = accounts.filter(a => a.created_at < monthEnd).length
        const ordered = new Set(ok.map(r => r.account_code)).size

        monthly.push({
          label:      `${d.getMonth() + 1}월`,
          orderRate:  base > 0 ? Math.round((ordered / base) * 100) : 0,
          repeatRate: regularRateOf(rows, firstSeen, d.toISOString()).rate,
        })
      }

      // ── 창만 바꿔 다시 잰 재주문율 ───────────────────────────────────────
      const now        = new Date()
      const thisStart  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const lastStart  = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
      const threeStart = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString()
      const inRange = (from: string, to?: string) =>
        halfRows.filter(r => r.ordered_at >= from && (!to || r.ordered_at < to))

      const orderedAccounts = Object.keys(countByAccount).length
      const nameByCode = Object.fromEntries(accounts.map(a => [a.account_code, a.account_name]))

      const next: DetailStats = {
        monthOrderAmount:   Object.values(amountByAccount).reduce((a, b) => a + b, 0),
        monthDepositAmount: (monthDeposits ?? []).reduce((s: number, d: { amount: number }) => s + (d.amount ?? 0), 0),
        accountCount:       accounts.length,
        newAccountCount:    accounts.filter(a => a.created_at >= mStart).length,
        monthOrderCount:    valid.length,
        depositCycleDays,
        memberCount:        (members ?? []).length,
        monthOrderRate:     Math.round((orderedAccounts / accounts.length) * 100),
        repeatRate:         repeatTotal > 0 ? Math.round((repeatCount / repeatTotal) * 100) : null,
        repeatBase:         { repeat: repeatCount, total: repeatTotal },
        monthly,
        repeatThisMonth:    regularRateOf(inRange(thisStart), firstSeen, thisStart),
        repeatLastMonth:    regularRateOf(inRange(lastStart, thisStart), firstSeen, lastStart),
        repeat3Months:      regularRateOf(inRange(threeStart), firstSeen, threeStart),
        typeRatio: Object.entries(typeCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([label, count], i) => ({ label, count, color: TYPE_COLORS[i % TYPE_COLORS.length] })),
        topCustomers: Object.entries(countByAccount)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([code, orders]) => ({
            name:   nameByCode[code] ?? code,
            orders,
            amount: amountByAccount[code] ?? 0,
          })),
      }
      if (!cancelled) { setStats(next); setLoading(false) }
    }

    load()
    return () => { cancelled = true }
  }, [storeId])

  // 4열 그리드에 흘린다. 9번째(재주문자 비율)는 자연히 3행 첫 칸으로 간다 —
  // 행을 손으로 쪼개 두면 지표를 하나 더할 때마다 레이아웃을 다시 짜게 된다.
  const cells: { label: string; value: string; sub?: string; link?: boolean; info?: string }[] = stats ? [
    { label: '이번달 주문액',   value: won(stats.monthOrderAmount),   link: true },
    { label: '이번달 선결제액', value: won(stats.monthDepositAmount), link: true },
    { label: '총계정수',        value: `${stats.accountCount}팀` },
    { label: '이번달 신규 계정', value: `${stats.newAccountCount}팀` },
    { label: '이번달 주문수',   value: `${stats.monthOrderCount}건` },
    { label: '선결제 주기',     value: stats.depositCycleDays === null ? EMPTY : `${stats.depositCycleDays}일` },
    { label: '총이용자수',      value: `${stats.memberCount}명` },
    { label: '이번달 주문율',   value: `${stats.monthOrderRate}%` },
    // 단골 비율 네 개 — 창(window)만 다른 같은 지표라 **한 줄에 나란히** 둔다.
    // 정의가 "그 기간 이전에도 주문한 적 있는 사람"이라 창 길이에 휘둘리지 않아, 이제 나란히
    // 놓고 비교해도 된다(전 정의로는 창이 길수록 기계적으로 높아져서 거짓 비교가 됐다).
    // 4열 그리드의 마지막 행이 정확히 이 넷이 된다(앞의 8개가 두 줄을 채운다).
    {
      label: '최근 2주 단골 비율',
      value: stats.repeatRate === null ? EMPTY : `${stats.repeatRate}%`,
      sub:   stats.repeatBase.total === 0
        ? '최근 2주 주문 없음'
        : `주문자 ${stats.repeatBase.total}명 중 ${stats.repeatBase.repeat}명`,
      // 정의는 네 칸 중 첫 칸에만 단다 — 같은 지표라 한 번이면 충분하다
      info: '단골 = 그 기간 이전에도 주문한 적 있는 손님\n\n주문자 이름 기준이고, 취소된 주문은 빼고 셉니다.',
    },
    repeatCell('이번달 단골 비율',   stats.repeatThisMonth),
    repeatCell('저번달 단골 비율',   stats.repeatLastMonth),
    repeatCell('최근 3개월 단골 비율', stats.repeat3Months),
  ] : []

  const typeTotal = stats?.typeRatio.reduce((s, t) => s + t.count, 0) ?? 0
  return (
    <div>
      {/* 계정유형 비율은 박스 **밖** 제목 줄 오른쪽. 지표와 같은 비중으로 박스 안에 넣었더니
          "이번달 주문액"과 같은 무게로 읽혔는데, 이건 자주 바뀌지 않는 배경 정보다.
          도넛 대신 가로 막대인 이유: 96px 도넛 + 2열 범례가 박스 폭의 1/4 을 먹었다.
          한 줄 막대는 같은 정보를 1/3 높이로 말한다. */}
      <HubSection
        title="고객 현황"
        action={!loading && stats && typeTotal > 0 ? (
          <div className="flex items-center gap-[12px]">
            <div className="flex h-[8px] w-[140px] rounded-full overflow-hidden">
              {stats.typeRatio.map(t => (
                <div key={t.label} style={{ width: `${(t.count / typeTotal) * 100}%`, backgroundColor: t.color }} />
              ))}
            </div>
            <div className="flex items-center gap-[10px]">
              {stats.typeRatio.map(t => (
                <span key={t.label} className="flex items-center gap-[4px] text-[11px] font-normal text-[#6A635E] whitespace-nowrap">
                  <span className="w-[7px] h-[7px] rounded-full" style={{ backgroundColor: t.color }} />
                  {t.label} {Math.round((t.count / typeTotal) * 100)}%
                </span>
              ))}
            </div>
          </div>
        ) : undefined}
      />

      {loading || !stats ? (
        <div className="bg-[#F2F2F2] rounded-[20px] py-[66px] text-center text-[13px] font-normal text-[#787878]">
          불러오는 중…
        </div>
      ) : (
        <div className="bg-[#F2F2F2] rounded-[20px] px-[46px] py-[36px] flex items-start gap-[40px]">
          <div className="flex-1 min-w-0 grid grid-cols-4 gap-x-[26px] gap-y-[36px]">
            {cells.map(stat => (
              <div key={stat.label}>
                <div className="flex items-center gap-[4px] text-[13px] font-normal text-[#6A635E] mb-[10px]">
                  {/* i 는 '단골' 바로 뒤에 붙인다 — 라벨 끝(…비율)에 달면 무엇의 설명인지 흐려진다 */}
                  {stat.info
                    ? <>
                        {stat.label.split('단골')[0]}단골
                        <InfoTip text={stat.info} label="단골 설명" />
                        {stat.label.split('단골')[1]}
                      </>
                    : stat.label}
                  {stat.link && (
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6 3.5L10.5 8L6 12.5" stroke="#6A635E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  )}
                </div>
                <div className="text-[22px] font-medium text-[#1E1E1E] whitespace-nowrap">{stat.value}</div>
                {stat.sub && (
                  <div className="text-[11px] font-normal text-[#ADADAD] mt-[4px] leading-snug">{stat.sub}</div>
                )}
              </div>
            ))}
          </div>

          {/* 월별 추이 둘 — 같은 6개월 x축을 위아래로 겹쳐 읽는다.
              "주문율은 올랐는데 재주문율은 그대로"처럼 두 줄을 한 번에 비교하라고 나란히 둔다. */}
          <div className="flex-shrink-0 w-[300px] flex flex-col gap-[26px]">
            <RateBars
              title="월별 주문율 추이"
              hint="그 달에 한 번이라도 주문한 거래처 비율이에요. 분모는 그 달까지 등록된 거래처 수입니다."
              color="#6A635E"
              data={stats.monthly.map(m => ({ label: m.label, value: m.orderRate }))}
            />
            <RateBars
              title="월별 단골 비율"
              color="#C1B7AA"
              data={stats.monthly.map(m => ({ label: m.label, value: m.repeatRate }))}
            />

          </div>
        </div>
      )}

      {/* 주문 많은 손님 — 이번 달 주문 건수 상위 5팀 */}
      <div className="mt-[46px]">
        <HubSection title="주문 많은 손님" />
        {loading || !stats ? null : stats.topCustomers.length === 0 ? (
          <HubPlaceholder note="이번 달 주문이 아직 없어요" />
        ) : (
          <div className="rounded-[13px] overflow-hidden border border-[#E8E4E2]">
            {stats.topCustomers.map((c, i) => (
              <div
                key={c.name}
                className={`flex items-center px-[26px] h-[46px] bg-[#FCFCFC] ${i > 0 ? 'border-t border-[#F2F2F2]' : ''}`}
              >
                <span className="w-[32px] text-[12px] font-medium text-[#6A635E]">{i + 1}</span>
                <span className="flex-1 min-w-0 text-[13px] font-normal text-[#1E1E1E] truncate">{c.name}</span>
                <span className="w-[100px] text-right text-[12px] font-normal text-[#787878]">{c.orders}건</span>
                <span className="w-[140px] text-right text-[13px] font-medium text-[#1E1E1E]">{won(c.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 계정 관리 — Figma node 570:694 ─────────────────────────────────────────
// 표 헤더는 Figma 그대로(순번 / 계정 이름 / 관리자 / 추이 / 이용자수 / 잔액), 행은 비워둔다.
// ── 계정 관리 — Figma node 570:694 ─────────────────────────────────────────
//
// 고객 화면(Customers.tsx)이 "지금 들어온 주문을 처리하는 곳"이라면 여기는 "거래처 장부를
// 정리하는 곳"이다. 상품 허브의 메뉴 상세와 같은 역할 분담.
//
// 왜 카카오 연결 승인함으로 짓지 않았나: 주문자(account_members)는 102명인데 카카오 계정
// 연결은 1건이다. 이 서비스는 실제로 QR + 이름입력으로 돌아가므로, 승인 큐를 전면에 두면
// 빈 화면이 된다. 승인 대기는 생겼을 때만 목록 위에 한 줄로 띄운다.

interface AccountRow {
  code:         string
  name:         string
  type:         string
  manager:      string
  phone:        string | null
  balance:      number
  memberCount:  number
  monthOrders:  number
  monthAmount:  number
  lastDepositAt: string | null
  /** 마지막 주문으로부터 지난 일수 — null 이면 주문 이력 없음 */
  idleDays:     number | null
  /** 카카오 QR 거래처인데 관리자 등록이 아직 안 끝났는가 */
  adminPending: boolean
}

type AccountFilter = 'all' | 'negative' | 'idle'
type AccountSort   = 'balance' | 'amount' | 'deposit' | 'name'

// 미주문 기간 — 업종마다 주문 주기가 달라서(매일 시키는 구청 과 vs 분기에 한 번인 기업)
// 하나로 못 박으면 어떤 매장에선 전부 휴면이고 어떤 매장에선 아무도 안 걸린다. 점주가 고른다.
const IDLE_OPTIONS = [14, 30, 60, 100] as const
const IDLE_LABEL: Record<number, string> = { 14: '2주', 30: '한 달', 60: '두 달', 100: '100일' }

const FILTERS: { key: AccountFilter; label: string }[] = [
  { key: 'all',      label: '전체' },
  { key: 'negative', label: '잔액 음수' },
  { key: 'idle',     label: '미주문' },
]

const SORTS: { key: AccountSort; label: string }[] = [
  { key: 'balance', label: '잔액 적은순' },
  { key: 'amount',  label: '이번 달 주문액순' },
  { key: 'deposit', label: '충전 오래된순' },
  { key: 'name',    label: '이름순' },
]

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

/** 고객 현황·상품 허브와 같은 회색 박스 카드 */
function SummaryCard({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex-1 bg-[#F2F2F2] rounded-[10px] px-[14px] py-[13px]">
      <div className="text-[12px] font-medium text-[#2C261F] mb-[6px]">{label}</div>
      <div className={`text-[20px] font-medium ${warn ? 'text-danger' : 'text-[#2C261F]'}`}>{value}</div>
    </div>
  )
}

function AccountsPanel() {
  const { storeId } = useStore()
  // 행을 누르면 '고객 현황'으로 보내는 대신 그 자리에서 상세 모달을 띄운다.
  // 화면을 갈아타면 방금 누른 거래처를 그 화면에서 다시 찾아야 했다.
  const [detail, setDetail] = useState<AccountDetailTarget | null>(null)
  const [rows,    setRows]    = useState<AccountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q,       setQ]       = useState('')
  const [filter,  setFilter]  = useState<AccountFilter>('all')
  const [sort,    setSort]    = useState<AccountSort>('balance')
  const [sortOpen, setSortOpen] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [idleDaysOpt, setIdleDaysOpt] = useState<number>(60)
  const [idleOpen, setIdleOpen] = useState(false)

  // 유형 배지 색은 고객 화면·계정유형 도넛과 같은 기준(건수 많은 순)을 쓴다
  const typeCounts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.type] = (acc[r.type] ?? 0) + 1
    return acc
  }, {})
  const typeColorOf = makeTypeColorOf(Object.keys(typeCounts), typeCounts)

  useEffect(() => {
    if (!storeId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const mStart = monthStartISO()

      const { data: accRows } = await supabase
        .from('accounts')
        .select('account_code, account_name, account_type, contact_person, contact_phone, current_balance, qr_system')
        .eq('store_id', storeId)
        .eq('is_active', true)
        .order('account_name')
      const accounts = (accRows ?? []) as DbAccount[]
      const codes = accounts.map(a => a.account_code)

      if (codes.length === 0) {
        if (!cancelled) { setRows([]); setLoading(false) }
        return
      }

      // 주문·충전·이용자를 한 번씩만 긁어 와서 거래처별로 접는다.
      // 거래처마다 쿼리를 날리면 27번 왕복한다 — 목록 화면에서 그만한 값어치가 없다.
      const [{ data: orders }, { data: deposits }, { data: members }, { data: admins }] = await Promise.all([
        supabase.from('orders')
          .select('account_code, total_amount, status, ordered_at')
          .in('account_code', codes),
        supabase.from('deposits')
          .select('account_code, created_at')
          .in('account_code', codes)
          .order('created_at', { ascending: false }),
        supabase.from('account_members').select('account_code').in('account_code', codes),
        // 관리자 등록이 끝난 거래처 — 카카오 QR 거래처만 의미가 있다
        supabase.from('user_account_links')
          .select('account_code')
          .eq('role', '관리자').eq('status', 'approved')
          .in('account_code', codes),
      ])

      const monthOrders = new Map<string, { count: number; amount: number }>()
      const lastOrderAt = new Map<string, string>()
      for (const o of (orders ?? []) as { account_code: string; total_amount: number; status: string; ordered_at: string }[]) {
        if (o.status === '취소') continue
        const prev = lastOrderAt.get(o.account_code)
        if (!prev || o.ordered_at > prev) lastOrderAt.set(o.account_code, o.ordered_at)
        if (o.ordered_at < mStart) continue
        const cur = monthOrders.get(o.account_code) ?? { count: 0, amount: 0 }
        cur.count += 1
        cur.amount += o.total_amount ?? 0
        monthOrders.set(o.account_code, cur)
      }

      const lastDeposit = new Map<string, string>()
      for (const d of (deposits ?? []) as { account_code: string; created_at: string }[]) {
        if (!lastDeposit.has(d.account_code)) lastDeposit.set(d.account_code, d.created_at)
      }

      const registered = new Set((admins ?? []).map((r: { account_code: string }) => r.account_code))

      const memberCount = new Map<string, number>()
      for (const m of (members ?? []) as { account_code: string }[]) {
        memberCount.set(m.account_code, (memberCount.get(m.account_code) ?? 0) + 1)
      }

      const built: AccountRow[] = accounts.map(a => {
        const mo = monthOrders.get(a.account_code)
        return {
          code:          a.account_code,
          name:          a.account_name,
          type:          a.account_type,
          manager:       a.contact_person ?? '',
          phone:         a.contact_phone,
          balance:       a.current_balance,
          memberCount:   memberCount.get(a.account_code) ?? 0,
          monthOrders:   mo?.count  ?? 0,
          monthAmount:   mo?.amount ?? 0,
          lastDepositAt: lastDeposit.get(a.account_code) ?? null,
          idleDays:      daysSince(lastOrderAt.get(a.account_code) ?? null),
          adminPending:  a.qr_system === 'kakao' && !registered.has(a.account_code),
        }
      })

      if (!cancelled) { setRows(built); setLoading(false) }
    }

    load()
    return () => { cancelled = true }
  }, [storeId])

  const negCount  = rows.filter(r => r.balance < 0).length
  const idleCount = rows.filter(r => r.idleDays == null || r.idleDays >= idleDaysOpt).length

  const visible = rows
    .filter(r => {
      if (filter === 'negative') return r.balance < 0
      if (filter === 'idle')     return r.idleDays == null || r.idleDays >= idleDaysOpt
      return true
    })
    .filter(r => {
      if (!q.trim()) return true
      const needle = q.trim().toLowerCase()
      return r.name.toLowerCase().includes(needle) || r.manager.toLowerCase().includes(needle)
    })
    .sort((a, b) => {
      if (sort === 'balance') return a.balance - b.balance
      if (sort === 'amount')  return b.monthAmount - a.monthAmount
      if (sort === 'name')    return a.name.localeCompare(b.name, 'ko')
      // 충전 오래된순 — 충전 이력이 없는 쪽을 가장 앞에
      if (!a.lastDepositAt) return -1
      if (!b.lastDepositAt) return 1
      return a.lastDepositAt.localeCompare(b.lastDepositAt)
    })

  function toggle(code: string) {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code); else next.add(code)
      return next
    })
  }

  const allVisibleChecked = visible.length > 0 && visible.every(r => checked.has(r.code))

  return (
    <div>
      <HubSection title="계정 관리" />

      {loading ? (
        <div className="py-[56px] text-center text-[13px] font-normal text-[#787878]">불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div className="py-[56px] text-center text-[13px] font-normal text-[#ADADAD]">등록된 거래처가 없어요</div>
      ) : (
        <>
          <div className="flex gap-[10px] mb-[20px]">
            <SummaryCard label="전체 거래처" value={`${rows.length}곳`} />
            <SummaryCard label="잔액 음수"   value={`${negCount}곳`} warn={negCount > 0} />

            {/* 미주문 — 기간을 점주가 고른다 */}
            <div className="flex-1 bg-[#F2F2F2] rounded-[10px] px-[14px] py-[13px] relative">
              <button
                onClick={() => setIdleOpen(v => !v)}
                className="flex items-center gap-[5px] text-[12px] font-medium text-[#2C261F] mb-[6px] hover:opacity-70 transition-opacity"
              >
                {IDLE_LABEL[idleDaysOpt]} 이상 미주문
                <svg width="9" height="6" viewBox="0 0 16 10" fill="none"><path d="M1 1L8 8L15 1" stroke="#6A635E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <div className="text-[20px] font-medium text-[#2C261F]">{idleCount}곳</div>
              {idleOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setIdleOpen(false)} />
                  <div className="absolute left-[10px] top-[38px] z-30 bg-[#FCFCFC] rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] py-[5px] w-[110px]">
                    {IDLE_OPTIONS.map(d => (
                      <button
                        key={d}
                        onClick={() => { setIdleDaysOpt(d); setIdleOpen(false) }}
                        className={`w-full text-left px-[13px] py-[7px] text-[13px] hover:bg-[#F2F2F2] ${
                          idleDaysOpt === d ? 'text-[#1E1E1E] font-medium' : 'text-[#787878] font-normal'
                        }`}
                      >
                        {IDLE_LABEL[d]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 검색 · 필터 · 정렬 */}
          <div className="flex items-center gap-[10px] mb-[14px]">
            <div className="relative">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="absolute left-[11px] top-1/2 -translate-y-1/2 pointer-events-none">
                <circle cx="7" cy="7" r="4.6" stroke="#ADADAD" strokeWidth="1.5"/>
                <path d="M10.5 10.5L14 14" stroke="#ADADAD" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="거래처·관리자 검색"
                className="field-soft h-[32px] w-[200px] pl-[30px] pr-[11px] rounded-[9px] border border-[#D9D9D9] text-[13px] text-[#1E1E1E] outline-none"
              />
            </div>
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`h-[32px] px-[12px] rounded-[9px] text-[13px] font-normal transition-colors ${
                  filter === f.key ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
                }`}
              >
                {f.label}
              </button>
            ))}
            <div className="relative ml-auto">
              <button
                onClick={() => setSortOpen(v => !v)}
                className="h-[32px] px-[12px] rounded-[9px] bg-[#F2F2F2] text-[#1E1E1E] text-[13px] font-normal flex items-center gap-[6px] hover:bg-[#E8E4E2] transition-colors"
              >
                {SORTS.find(s => s.key === sort)?.label}
                <svg width="10" height="6" viewBox="0 0 16 10" fill="none"><path d="M1 1L8 8L15 1" stroke="#6A635E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              {sortOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setSortOpen(false)} />
                  <div className="absolute right-0 top-[36px] z-30 bg-[#FCFCFC] rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] py-[5px] w-[150px]">
                    {SORTS.map(s => (
                      <button
                        key={s.key}
                        onClick={() => { setSort(s.key); setSortOpen(false) }}
                        className={`w-full text-left px-[13px] py-[7px] text-[13px] hover:bg-[#F2F2F2] ${sort === s.key ? 'text-[#1E1E1E] font-medium' : 'text-[#787878] font-normal'}`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 목록 */}
          <DataTable>
            <DataTableHead>
              <span className="w-[30px]">
                <input
                  type="checkbox"
                  checked={allVisibleChecked}
                  onChange={() => setChecked(allVisibleChecked ? new Set() : new Set(visible.map(r => r.code)))}
                />
              </span>
              <span className="flex-1 min-w-0">거래처({visible.length}곳)</span>
              <span className="w-[150px]">관리자</span>
              <span className="w-[90px] text-right">이용자</span>
              <span className="w-[110px] text-right">이번 달 주문</span>
              <span className="w-[120px] text-right">최근 충전</span>
              <span className="w-[120px] text-right">잔액</span>
            </DataTableHead>

            {visible.length === 0 ? (
              <DataTableNotice>조건에 맞는 거래처가 없어요</DataTableNotice>
            ) : visible.map((r, i) => {
              const neg  = r.balance < 0
              const dep  = daysSince(r.lastDepositAt)
              return (
                <DataTableRow key={r.code} last={i === visible.length - 1}>
                  <span className="w-[30px]" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={checked.has(r.code)} onChange={() => toggle(r.code)} />
                  </span>
                  <button
                    onClick={() => setDetail({
                      code: r.code, name: r.name, type: r.type,
                      typeColor: typeColorOf(r.type), adminPending: r.adminPending,
                    })}
                    className="flex-1 min-w-0 text-left flex items-center gap-[7px] hover:underline underline-offset-2 decoration-[#D7D7D7]"
                  >
                    <span className="text-[13px] text-[#1E1E1E] truncate">{r.name}</span>
                    <span
                      className="flex-shrink-0 px-[6px] h-[18px] leading-[18px] rounded-[5px] text-[11px] font-medium"
                      style={typeBadgeStyle(typeColorOf(r.type))}
                    >
                      {r.type}
                    </span>
                  </button>
                  <span className="w-[150px] flex items-center gap-[5px] text-[12px] text-[#787878]">
                    <span className="truncate">{r.manager ? maskName(r.manager) : '—'}</span>
                    {r.adminPending && <StatusTag label="등록대기" />}
                  </span>
                  <span className="w-[90px] text-right text-[12px] text-[#787878]">{r.memberCount}명</span>
                  <span className="w-[110px] text-right text-[12px] text-[#1E1E1E]">
                    {r.monthOrders > 0 ? `${r.monthOrders}건 · ${won(r.monthAmount)}` : '—'}
                  </span>
                  <span className={`w-[120px] text-right text-[12px] ${dep != null && dep > 30 ? 'text-[#ADADAD]' : 'text-[#787878]'}`}>
                    {dep == null ? '없음' : dep === 0 ? '오늘' : `${dep}일 전`}
                  </span>
                  <span className={`w-[120px] text-right text-[13px] ${neg ? 'text-danger font-medium' : 'text-[#1E1E1E]'}`}>
                    {won(r.balance)}
                  </span>
                </DataTableRow>
              )
            })}
          </DataTable>

          {/* 일괄 작업 — 이 화면의 존재 이유. 개별 처리는 고객 화면에서 이미 된다 */}
          <div className="mt-[14px] flex items-center gap-[10px]">
            <span className="text-[12px] font-normal text-[#787878]">
              {checked.size > 0 ? `${checked.size}곳 선택됨` : '여러 곳을 골라 한 번에 처리할 수 있어요'}
            </span>
            <div className="ml-auto flex gap-[8px]">
              <button
                disabled={checked.size === 0}
                onClick={() => exportBalanceCsv(visible.filter(r => checked.has(r.code)))}
                className="h-[32px] px-[13px] rounded-[9px] bg-[#F2F2F2] text-[#1E1E1E] text-[13px] font-normal hover:bg-[#E8E4E2] disabled:opacity-40 transition-colors"
              >
                잔액 현황 내보내기
              </button>
            </div>
          </div>

        </>
      )}

      {detail && <AccountDetailModal target={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

/** 세금계산서·정산 요청이 들어올 때 쓰는 내보내기. 엑셀이 바로 여는 UTF-8 BOM 포함 */
function exportBalanceCsv(rows: AccountRow[]) {
  const header = ['거래처', '유형', '관리자', '이용자수', '이번달주문건', '이번달주문액', '최근충전일', '현재잔액']
  const body = rows.map(r => [
    r.name, r.type, r.manager, r.memberCount, r.monthOrders, r.monthAmount,
    r.lastDepositAt ? r.lastDepositAt.slice(0, 10) : '',
    r.balance,
  ])
  const csv = [header, ...body]
    .map(line => line.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `잔액현황_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function SmsPanel() {
  return <SmsPanelImpl />
}
