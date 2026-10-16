import { useState, useEffect, useMemo } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { useStore } from '../../lib/store-context'
import { won } from '../../lib/ipc'
import { maskName, maskPhone } from '../../lib/mask'
import { qrUrlFor } from '../../lib/qr-order'
import { typeBadgeStyle, TYPE_COLORS } from '../../lib/account-type-color'
import { DB_METHOD_MAP } from '../../lib/mappers'
import { type PrepayValidity } from '../../lib/prepay-validity'
import PrepaidTrendChart, { type TrendMonth } from '../ui/PrepaidTrendChart'
import { rollUpLedger, type LedgerEvent } from '../../lib/prepaid-ledger'
import { downloadStatementCsv } from '../../lib/prepaid-statement'
import DonutChart from '../DonutChart'
import { DataTable, DataTableHead, DataTableRow, DataTableNotice, StatusTag } from '../ui/DataTable'

// ── 계정 상세 모달 ──────────────────────────────────────────────────────────
//
// 계정 관리 표에서 한 줄을 누르면 뜬다. 전에는 '고객 현황' 화면으로 튕겨 보냈는데,
// 그 화면은 매장 전체 집계라 **방금 누른 그 거래처를 다시 찾아야 했다** — 클릭이 정보를
// 좁히는 대신 넓혀 버렸다. 그래서 그 자리에서 열리는 모달로 바꿨다.
//
// 탭으로 나눈 이유: 요청된 정보(QR·주문내역·충전이력·구성원·추이·도넛)를 한 장에 쌓으면
// 스크롤이 수천 px 가 되고 아무것도 못 찾는다. 처음 보여야 하는 건 "지금 상태"라서
// 개요 탭에 요약·QR·추이·도넛을 두고, 원장(raw 목록)은 각 탭으로 내렸다.
//
// ⚠️ 데이터 출처에 대해 실제로 확인한 것(2026-10-13, 침산점 기준):
//   · 선결제 기록의 원본은 deposits 다. user_account_links.prepaid_date/prepaid_amount 는
//     전 건 비어 있어서 쓸 수 없다. 그래서 "선결제 내역"과 "충전 이력"은 같은 표다 —
//     두 섹션으로 나누면 같은 걸 두 번 보여주게 된다.
//   · orders.ordered_by_link_id 도 전 건 null 이라 이용자 구분은 orderer_name 으로 한다.
//   · account_members(등록 명단)와 실제 주문자 수가 다르다(9명 vs 10명). 명단에 없는
//     사람도 주문하므로, 구성원 탭은 '명단', 이용자별 집계는 '실제 주문'으로 따로 둔다.

type Tab = 'overview' | 'orders' | 'deposits' | 'members'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '개요' },
  { key: 'orders',   label: '주문 내역' },
  { key: 'deposits', label: '충전 이력' },
  { key: 'members',  label: '구성원' },
]

export interface AccountDetailTarget {
  code: string
  name: string
  type: string
  typeColor: string
  adminPending: boolean
}

interface AccountInfo {
  accountName:    string
  accountType:    string
  organization:   string | null
  manager:        string | null
  phone:          string | null
  businessNumber: string | null
  balance:        number
  createdAt:      string
  qrSystem:       'legacy' | 'kakao'
  accountNumber:  number | null
  memo:           string | null
  validity:       PrepayValidity
}

interface OrderRow {
  code:      string
  orderedAt: string
  orderer:   string
  amount:    number
  method:    string
  status:    string
  /** "에그인헬1, 샐러드2" — 이용내역서의 '내역' 열 */
  menus:     string
  /** 주문 직후 잔액 스냅샷. 거래처와 금액 분쟁이 나면 이 값이 근거다 */
  balanceAfter: number | null
}

interface DepositRow {
  id:           string
  createdAt:    string
  amount:       number
  payMethod:    string | null
  balanceAfter: number | null
  note:         string | null
}

interface MemberRow {
  id:     string
  name:   string
  phone:  string | null
  orders: number
  lastAt: string | null
}

/** 'YYYY-MM' (KST) */
function monthKey(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 7)
}

function fmtDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000)
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')} `
    + `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function fmtDate(iso: string): string {
  return fmtDateTime(iso).slice(0, 10)
}

/** 최근 N개월 키를 과거→현재 순으로 */
function recentMonths(n: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-[10px] py-[7px] border-b border-[#EFEFEF] last:border-b-0">
      <span className="w-[86px] flex-shrink-0 text-[12px] font-normal text-[#ADADAD]">{label}</span>
      <span className={`flex-1 min-w-0 text-[13px] font-normal text-[#1E1E1E] break-all ${mono ? 'tabular-nums' : ''}`}>
        {value || '—'}
      </span>
    </div>
  )
}

function Stat({ label, value, sub, danger = false }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="flex-1 min-w-0 bg-[#F2F2F2] rounded-[10px] px-[14px] py-[12px]">
      <div className="text-[11px] font-normal text-[#787878] mb-[5px] truncate">{label}</div>
      <div className={`text-[17px] font-medium truncate ${danger ? 'text-danger' : 'text-[#2C261F]'}`}>{value}</div>
      {sub && <div className="text-[11px] font-normal text-[#ADADAD] mt-[3px] truncate">{sub}</div>}
    </div>
  )
}

function SubTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-[10px]">
      <div className="text-[13px] font-medium text-[#2C261F]">{children}</div>
      {hint && <div className="text-[11px] font-normal text-[#ADADAD] mt-[1px]">{hint}</div>}
    </div>
  )
}

export default function AccountDetailModal({ target, onClose }: {
  target: AccountDetailTarget
  onClose: () => void
}) {
  const { storeId } = useStore()
  const [tab,      setTab]      = useState<Tab>('overview')
  const [loading,  setLoading]  = useState(true)
  const [info,     setInfo]     = useState<AccountInfo | null>(null)
  const [orders,   setOrders]   = useState<OrderRow[]>([])
  const [deposits, setDeposits] = useState<DepositRow[]>([])
  const [members,  setMembers]  = useState<MemberRow[]>([])
  // 수기 조정 — 잔액을 움직이는 세 번째 축. 빠뜨리면 추이가 어긋난다
  const [adjustments, setAdjustments] = useState<{ at: string; amount: number; reason: string | null }[]>([])
  const [qrImg,    setQrImg]    = useState('')
  const [revealed, setRevealed] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  // 금액 충전 — Customers 화면의 충전 폼을 통째로 가져오지 않고, 이 모달에서 바로 끝낼 수
  // 있는 최소한(금액·결제수단·비고)만 둔다. 저장은 같은 RPC(add_deposit)를 쓴다.
  const [chargeOpen,   setChargeOpen]   = useState(false)
  const [chargeAmt,    setChargeAmt]    = useState('')
  const [chargeMethod, setChargeMethod] = useState('신용카드')
  const [chargeMemo,   setChargeMemo]   = useState('')
  const [charging,     setCharging]     = useState(false)
  const [chargeError,  setChargeError]  = useState('')
  const [reloadKey,    setReloadKey]    = useState(0)

  // ESC 로 닫기 — 모달 안 표가 길어서 닫기 버튼이 스크롤 밖으로 밀릴 수 있다
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const [accRes, ordRes, depRes, memRes, adjRes] = await Promise.all([
        supabase.from('accounts')
          .select('account_name, account_type, organization_name, contact_person, contact_phone, business_number, current_balance, created_at, qr_system, account_number, memo, prepay_validity')
          .eq('account_code', target.code)
          .single(),
        supabase.from('orders')
          .select('order_code, ordered_at, orderer_name, total_amount, method, status, balance_after, order_items(menu_name, quantity)')
          .eq('account_code', target.code)
          .eq('is_deleted', false)
          .order('ordered_at', { ascending: false }),
        supabase.from('deposits')
          .select('deposit_id, created_at, amount, payment_method, balance_after, note')
          .eq('account_code', target.code)
          .order('created_at', { ascending: false }),
        supabase.from('account_members')
          .select('id, name, phone, order_count, last_ordered_at')
          .eq('account_code', target.code)
          .order('order_count', { ascending: false }),
        supabase.from('balance_adjustments')
          .select('created_at, amount, reason')
          .eq('account_code', target.code),
      ])

      if (cancelled) return

      const a = accRes.data as {
        account_name: string; account_type: string; organization_name: string | null
        contact_person: string | null; contact_phone: string | null; business_number: string | null
        current_balance: number | null; created_at: string; qr_system: string | null
        account_number: number | null; memo: string | null; prepay_validity: PrepayValidity | null
      } | null

      if (a) {
        setInfo({
          accountName:    a.account_name,
          accountType:    a.account_type,
          organization:   a.organization_name,
          manager:        a.contact_person,
          phone:          a.contact_phone,
          businessNumber: a.business_number,
          balance:        a.current_balance ?? 0,
          createdAt:      a.created_at,
          qrSystem:       a.qr_system === 'kakao' ? 'kakao' : 'legacy',
          accountNumber:  a.account_number,
          memo:           a.memo,
          validity:       (a.prepay_validity ?? 'none') as PrepayValidity,
        })
      }

      setOrders(((ordRes.data ?? []) as unknown as {
        order_code: string; ordered_at: string; orderer_name: string | null
        total_amount: number | null; method: string; status: string
        balance_after: number | null
        order_items: { menu_name: string; quantity: number | null }[] | null
      }[]).map(o => ({
        code:      o.order_code,
        orderedAt: o.ordered_at,
        orderer:   o.orderer_name ?? '(미입력)',
        amount:    o.total_amount ?? 0,
        method:    o.method,
        status:    o.status,
        balanceAfter: o.balance_after,
        // 이용내역서 원본과 같은 표기: "메뉴명<수량>" 을 쉼표로
        menus: (o.order_items ?? [])
          .map(it => `${it.menu_name}${it.quantity ?? 1}`)
          .join(', '),
      })))

      setDeposits(((depRes.data ?? []) as {
        deposit_id: string; created_at: string; amount: number | null
        payment_method: string | null; balance_after: number | null; note: string | null
      }[]).map(d => ({
        id:           d.deposit_id,
        createdAt:    d.created_at,
        amount:       d.amount ?? 0,
        payMethod:    d.payment_method,
        balanceAfter: d.balance_after,
        note:         d.note,
      })))

      setMembers(((memRes.data ?? []) as {
        id: string; name: string; phone: string | null
        order_count: number | null; last_ordered_at: string | null
      }[]).map(m => ({
        id:     m.id,
        name:   m.name,
        phone:  m.phone,
        orders: m.order_count ?? 0,
        lastAt: m.last_ordered_at,
      })))

      setAdjustments(((adjRes.data ?? []) as { created_at: string; amount: number | null; reason: string | null }[])
        .map(b => ({ at: b.created_at, amount: b.amount ?? 0, reason: b.reason })))

      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [target.code, reloadKey])

  // QR — 계정 관리 표·QR출력 화면과 같은 규칙(qr_system)으로 주소를 만든다
  useEffect(() => {
    if (!info || !storeId) return
    const url = qrUrlFor({ account_code: target.code, qr_system: info.qrSystem }, storeId)
    QRCode.toDataURL(url, { width: 400, margin: 0, color: { dark: '#1E1E1E', light: '#FFFFFF' } })
      .then(setQrImg)
      .catch(() => setQrImg(''))
  }, [info, storeId, target.code])

  // ── 집계 ──
  const valid = useMemo(() => orders.filter(o => o.status !== '취소'), [orders])

  const totals = useMemo(() => {
    const orderAmount   = valid.reduce((s, o) => s + o.amount, 0)
    const depositAmount = deposits.reduce((s, d) => s + d.amount, 0)
    return {
      orderAmount,
      orderCount:   valid.length,
      depositAmount,
      depositCount: deposits.length,
      avg:          valid.length ? Math.round(orderAmount / valid.length) : 0,
      cancelled:    orders.length - valid.length,
    }
  }, [valid, deposits, orders.length])

  const months = useMemo(() => recentMonths(6), [])

  // 월별 추이 — 잔액은 balance_after 스냅샷이 아니라 **원장 누적**으로 낸다.
  // deposits.balance_after 가 대부분 0이라 스냅샷을 믿으면 잔액이 바닥으로 찍힌다
  // (lib/prepaid-ledger.ts 주석 참고).
  const trendMonths = useMemo<TrendMonth[]>(() => {
    const events: LedgerEvent[] = [
      ...deposits.map(d => ({ at: d.createdAt, delta: d.amount, kind: 'deposit' as const, amount: d.amount })),
      ...valid.map(o => ({ at: o.orderedAt, delta: -o.amount, kind: 'order' as const, amount: o.amount })),
      ...adjustments.map(b => ({ at: b.at, delta: b.amount, kind: 'adjust' as const, amount: Math.abs(b.amount) })),
    ]
    // 차트는 최근 6개월만 보여주므로, 그 앞의 거래는 시작 잔액으로 접어 넣는다
    const cutoff = months[0]
    const opening = events
      .filter(e => e.at.slice(0, 7) < cutoff)
      .reduce((s2, e) => s2 + e.delta, 0)
    return rollUpLedger(events.filter(e => e.at.slice(0, 7) >= cutoff), months, opening)
      .map(m => ({ key: m.key, deposit: m.deposit, order: m.order, balance: m.balance, active: m.active }))
  }, [deposits, valid, adjustments, months])

  // 이용자별 — account_members(명단)가 아니라 실제 주문의 orderer_name 기준
  const byOrderer = useMemo(() => {
    const map = new Map<string, { name: string; count: number; amount: number; lastAt: string }>()
    for (const o of valid) {
      const cur = map.get(o.orderer) ?? { name: o.orderer, count: 0, amount: 0, lastAt: o.orderedAt }
      cur.count  += 1
      cur.amount += o.amount
      if (o.orderedAt > cur.lastAt) cur.lastAt = o.orderedAt
      map.set(o.orderer, cur)
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [valid])

  // 도넛은 상위 6명 + 나머지 묶음 — 10명 넘으면 조각이 실오라기가 된다
  const donut = useMemo(() => {
    const top  = byOrderer.slice(0, 6)
    const rest = byOrderer.slice(6)
    const restCount = rest.reduce((s, r) => s + r.count, 0)
    const items = [
      ...top.map((t, i) => ({ label: t.name, count: t.count, color: TYPE_COLORS[i % TYPE_COLORS.length] })),
      ...(restCount > 0 ? [{ label: `외 ${rest.length}명`, count: restCount, color: '#D7D7D7' }] : []),
    ]
    const total = items.reduce((s, x) => s + x.count, 0)
    return items.map(x => ({ ...x, pct: total ? (x.count / total) * 100 : 0 }))
  }, [byOrderer])

  async function submitCharge() {
    const amt = parseInt(chargeAmt.replace(/,/g, ''), 10)
    if (isNaN(amt) || amt <= 0 || charging) return
    setCharging(true); setChargeError('')
    // Customers 화면과 같은 RPC — 잔액 UPDATE 와 deposits INSERT 가 한 트랜잭션이다
    const { error } = await supabase.rpc('add_deposit', {
      p_account_code:   target.code,
      p_amount:         amt,
      p_note:           chargeMemo.trim() || null,
      p_payment_method: chargeMethod,
    })
    setCharging(false)
    if (error) { setChargeError('충전에 실패했어요. 다시 시도해 주세요.'); return }
    setChargeOpen(false)
    setChargeAmt(''); setChargeMemo('')
    setReloadKey(k => k + 1)   // 잔액·충전이력·추이를 다시 읽는다
  }

  const lastOrder   = valid[0]    ?? null
  const lastDeposit = deposits[0] ?? null

  // 내보낼 수 있는 달 — 충전이나 주문이 하나라도 있는 달만. 최신순
  const exportMonths = useMemo(() => {
    const set = new Set<string>()
    for (const o of orders)   set.add(monthKey(o.orderedAt))
    for (const d of deposits) set.add(monthKey(d.createdAt))
    return [...set].sort().reverse()
  }, [orders, deposits])

  function exportStatement(period: string) {
    if (!info) return
    setExportOpen(false)
    downloadStatementCsv({
      period,
      account: {
        accountName:    info.accountName,
        manager:        info.manager,
        phone:          info.phone,
        businessNumber: info.businessNumber,
      },
      deposits: deposits.map(d => ({
        createdAt: d.createdAt, amount: d.amount,
        note: d.note, balanceAfter: d.balanceAfter,
      })),
      orders: orders.map(o => ({
        orderedAt: o.orderedAt, amount: o.amount, menus: o.menus,
        method: o.method, orderer: o.orderer,
        balanceAfter: o.balanceAfter, cancelled: o.status === '취소',
      })),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-[20px]" onClick={onClose}>
      <div
        className="modal-in relative bg-[#FCFCFC] rounded-[14px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] w-[980px] max-w-full max-h-[88vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* ── 헤더 ── */}
        <div className="flex-shrink-0 px-[28px] pt-[24px] pb-[16px] border-b border-[#E5E5E5]">
          <div className="flex items-start justify-between gap-[16px]">
            <div className="min-w-0">
              <div className="flex items-center gap-[8px] mb-[6px]">
                <span className="text-[19px] font-semibold text-[#1E1E1E] truncate">{target.name}</span>
                <span
                  className="flex-shrink-0 px-[7px] h-[20px] leading-[20px] rounded-[5px] text-[11px] font-medium"
                  style={typeBadgeStyle(target.typeColor)}
                >
                  {target.type}
                </span>
                {target.adminPending && <StatusTag label="등록대기" />}
              </div>
              <div className="text-[12px] font-normal text-[#787878]">
                {info?.organization ? `${info.organization} · ` : ''}
                관리자 {revealed ? (info?.manager || '—') : (maskName(info?.manager) || '—')}
                {info?.phone ? ` · ${revealed ? info.phone : maskPhone(info.phone)}` : ''}
                <button
                  onClick={() => setRevealed(v => !v)}
                  className="ml-[8px] text-[11px] font-normal text-[#ADADAD] hover:text-[#787878] underline underline-offset-2"
                >
                  {revealed ? '가리기' : '보기'}
                </button>
              </div>
            </div>
            <div className="flex items-start gap-[14px] flex-shrink-0">
              <div className="text-right">
                <div className="text-[11px] font-normal text-[#787878] mb-[2px]">현재 잔액</div>
                <div className={`text-[22px] font-semibold ${(info?.balance ?? 0) < 0 ? 'text-danger' : 'text-[#2C261F]'}`}>
                  {won(info?.balance ?? 0)}
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="닫기"
                className="w-[28px] h-[28px] flex items-center justify-center rounded-[7px] text-[#ADADAD] hover:bg-[#F2F2F2] hover:text-[#787878] transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          {/* 탭 */}
          <div className="flex gap-[6px] mt-[16px]">
            {TABS.map(t => {
              const count = t.key === 'orders'   ? orders.length
                          : t.key === 'deposits' ? deposits.length
                          : t.key === 'members'  ? members.length : null
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`pressable-tab h-[32px] px-[14px] rounded-[9px] text-[13px] font-normal ${
                    tab === t.key ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878]'
                  }`}
                >
                  {t.label}{count !== null && count > 0 ? ` ${count}` : ''}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── 본문 ── */}
        <div className="flex-1 min-h-0 overflow-y-auto px-[28px] py-[22px]">
          {loading ? (
            <div className="py-[80px] text-center text-[13px] font-normal text-[#787878]">불러오는 중…</div>
          ) : tab === 'overview' ? (
            <>
              {/* 요약 */}
              <div className="flex gap-[10px] mb-[24px]">
                <Stat label="총 충전액" value={won(totals.depositAmount)} sub={`${totals.depositCount}회`} />
                <Stat label="총 주문액" value={won(totals.orderAmount)}   sub={`${totals.orderCount}건`} />
                <Stat label="건당 평균" value={won(totals.avg)} />
                <Stat
                  label="마지막 주문"
                  value={lastOrder ? fmtDate(lastOrder.orderedAt) : '—'}
                  sub={lastOrder ? maskName(lastOrder.orderer) : '주문 없음'}
                />
                <Stat
                  label="마지막 충전"
                  value={lastDeposit ? fmtDate(lastDeposit.createdAt) : '—'}
                  sub={lastDeposit ? won(lastDeposit.amount) : '충전 없음'}
                />
              </div>

              <div className="flex gap-[20px] mb-[24px]">
                {/* 기본 정보 */}
                <div className="flex-1 min-w-0">
                  <SubTitle>기본 정보</SubTitle>
                  <div className="bg-[#FCFCFC] border border-[#E5E5E5] rounded-[10px] px-[14px] py-[6px]">
                    <Field label="계정명"     value={info?.accountName ?? ''} />
                    <Field label="유형"       value={info?.accountType ?? ''} />
                    <Field label="기관명"     value={info?.organization ?? ''} />
                    <Field label="계정 번호"   value={info?.accountNumber != null ? `#${info.accountNumber}` : ''} mono />
                    <Field label="등록일시"    value={info ? fmtDateTime(info.createdAt) : ''} mono />
                    <Field label="비고"       value={info?.memo ?? ''} />
                  </div>
                </div>

                {/* QR */}
                <div className="w-[228px] flex-shrink-0">
                  <SubTitle>QR 오더</SubTitle>
                  <div className="bg-[#FCFCFC] border border-[#E5E5E5] rounded-[10px] p-[14px] flex flex-col items-center">
                    {qrImg ? (
                      <img src={qrImg} alt="계정 QR" className="w-[150px] h-[150px] rounded-[8px]" />
                    ) : (
                      <div className="w-[150px] h-[150px] rounded-[8px] bg-[#F2F2F2] flex items-center justify-center text-[11px] font-normal text-[#ADADAD]">
                        QR 생성 중…
                      </div>
                    )}
                    {/* URL 은 띄우지 않는다. 손님이 읽을 주소가 아니라 QR 이 들고 있는 값일 뿐인데,
                        10px 로 세 줄씩 깔려서 QR 자체보다 자리를 더 먹었다.
                        (주소가 필요하면 QR출력 화면에서 종이로 뽑는다) */}
                  </div>
                </div>
              </div>

              {/* 추이 + 도넛 */}
              <div className="flex gap-[20px] mb-[24px]">
                <div className="flex-1 min-w-0">
                  <SubTitle>선결제 · 주문액 추이 (최근 6개월)</SubTitle>
                  <div className="bg-[#FCFCFC] border border-[#E5E5E5] rounded-[10px] px-[16px] pt-[16px] pb-[12px]">
                    <PrepaidTrendChart months={trendMonths} />
                  </div>
                </div>

                <div className="w-[300px] flex-shrink-0">
                  <SubTitle hint="실제 주문 기록 기준 (등록 명단과 다를 수 있어요)">이용자별 주문 현황</SubTitle>
                  <div className="bg-[#FCFCFC] border border-[#E5E5E5] rounded-[10px] p-[16px]">
                    {donut.length === 0 ? (
                      <div className="py-[40px] text-center text-[12px] font-normal text-[#ADADAD]">주문이 없어요</div>
                    ) : (
                      <div className="flex items-center gap-[14px]">
                        <div className="flex-shrink-0">
                          <DonutChart segments={donut.map(d => ({ pct: d.pct, color: d.color }))} size={104} strokeWidth={22} />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col gap-[5px]">
                          {donut.map(d => (
                            <div key={d.label} className="flex items-center gap-[6px] text-[11px] font-normal">
                              <i className="w-[8px] h-[8px] rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                              <span className="flex-1 min-w-0 truncate text-[#1E1E1E]">
                                {d.label.startsWith('외 ') ? d.label : (revealed ? d.label : maskName(d.label))}
                              </span>
                              <span className="text-[#787878] flex-shrink-0">{Math.round(d.pct)}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 이용자별 집계 표 */}
              <SubTitle hint="주문 건수 많은 순">이용자별 주문</SubTitle>
              <DataTable>
                <DataTableHead>
                  <span className="flex-1">이용자</span>
                  <span className="w-[80px] text-right">주문</span>
                  <span className="w-[110px] text-right">주문액</span>
                  <span className="w-[80px] text-right">비중</span>
                  <span className="w-[130px] text-right">마지막 주문</span>
                </DataTableHead>
                {byOrderer.length === 0 ? (
                  <DataTableNotice>주문 기록이 없어요</DataTableNotice>
                ) : byOrderer.slice(0, 12).map((u, i, arr) => (
                  <DataTableRow key={u.name} last={i === arr.length - 1}>
                    <span className="flex-1 truncate">{revealed ? u.name : maskName(u.name)}</span>
                    <span className="w-[80px] text-right text-[#787878]">{u.count}건</span>
                    <span className="w-[110px] text-right">{won(u.amount)}</span>
                    <span className="w-[80px] text-right text-[#787878]">
                      {totals.orderCount ? Math.round((u.count / totals.orderCount) * 100) : 0}%
                    </span>
                    <span className="w-[130px] text-right text-[#787878]">{fmtDate(u.lastAt)}</span>
                  </DataTableRow>
                ))}
              </DataTable>
            </>
          ) : tab === 'orders' ? (
            <>
              <SubTitle hint={totals.cancelled > 0 ? `취소 ${totals.cancelled}건 포함` : undefined}>
                주문 내역 {orders.length}건
              </SubTitle>
              <DataTable>
                <DataTableHead>
                  <span className="w-[130px]">주문일시</span>
                  <span className="flex-1">주문자</span>
                  <span className="w-[90px]">이용방법</span>
                  <span className="w-[90px]">상태</span>
                  <span className="w-[110px] text-right">금액</span>
                </DataTableHead>
                {orders.length === 0 ? (
                  <DataTableNotice>주문 기록이 없어요</DataTableNotice>
                ) : orders.map((o, i, arr) => (
                  <DataTableRow key={o.code} last={i === arr.length - 1}>
                    <span className="w-[130px] text-[#787878] tabular-nums">{fmtDateTime(o.orderedAt)}</span>
                    <span className="flex-1 truncate">{revealed ? o.orderer : maskName(o.orderer)}</span>
                    <span className="w-[90px] text-[#787878]">{DB_METHOD_MAP[o.method] ?? o.method}</span>
                    <span className={`w-[90px] ${o.status === '취소' ? 'text-danger' : 'text-[#787878]'}`}>{o.status}</span>
                    <span className={`w-[110px] text-right ${o.status === '취소' ? 'text-[#ADADAD] line-through' : ''}`}>
                      {won(o.amount)}
                    </span>
                  </DataTableRow>
                ))}
              </DataTable>
            </>
          ) : tab === 'deposits' ? (
            <>
              <SubTitle hint="선결제(충전) 기록이 곧 이 표예요 — 매장에서 카드로 받은 그 건들입니다">
                충전 이력 {deposits.length}건 · 합계 {won(totals.depositAmount)}
              </SubTitle>
              <DataTable>
                <DataTableHead>
                  <span className="w-[130px]">충전일시</span>
                  <span className="w-[100px]">결제수단</span>
                  <span className="flex-1">비고</span>
                  <span className="w-[110px] text-right">충전액</span>
                  <span className="w-[110px] text-right">충전 후 잔액</span>
                </DataTableHead>
                {deposits.length === 0 ? (
                  <DataTableNotice>충전 기록이 없어요</DataTableNotice>
                ) : deposits.map((d, i, arr) => (
                  <DataTableRow key={d.id} last={i === arr.length - 1}>
                    <span className="w-[130px] text-[#787878] tabular-nums">{fmtDateTime(d.createdAt)}</span>
                    <span className="w-[100px] text-[#787878]">{d.payMethod ?? '—'}</span>
                    <span className="flex-1 truncate text-[#787878]">{d.note ?? '—'}</span>
                    <span className="w-[110px] text-right text-[#017333] font-medium">+{won(d.amount)}</span>
                    <span className="w-[110px] text-right">{d.balanceAfter != null ? won(d.balanceAfter) : '—'}</span>
                  </DataTableRow>
                ))}
              </DataTable>
            </>
          ) : (
            <>
              <SubTitle hint="등록된 명단이에요. 명단에 없는 사람도 주문할 수 있어서 '이용자별 주문'과 수가 다를 수 있어요">
                구성원 {members.length}명
              </SubTitle>
              <DataTable>
                <DataTableHead>
                  <span className="flex-1">이름</span>
                  <span className="w-[150px]">연락처</span>
                  <span className="w-[90px] text-right">주문</span>
                  <span className="w-[130px] text-right">마지막 주문</span>
                </DataTableHead>
                {members.length === 0 ? (
                  <DataTableNotice>등록된 구성원이 없어요</DataTableNotice>
                ) : members.map((m, i, arr) => (
                  <DataTableRow key={m.id} last={i === arr.length - 1}>
                    <span className="flex-1 truncate">{revealed ? m.name : maskName(m.name)}</span>
                    <span className="w-[150px] text-[#787878] tabular-nums">
                      {m.phone ? (revealed ? m.phone : maskPhone(m.phone)) : '—'}
                    </span>
                    <span className="w-[90px] text-right text-[#787878]">{m.orders}건</span>
                    <span className="w-[130px] text-right text-[#787878]">
                      {m.lastAt ? fmtDate(m.lastAt) : '—'}
                    </span>
                  </DataTableRow>
                ))}
              </DataTable>
            </>
          )}
        </div>

        {/* ── 하단 바 — 좌: 이용내역서(문서 내보내기) / 우: 충전·닫기 ── */}
        <div className="flex-shrink-0 border-t border-[#ADADAD] shadow-[0px_-5px_24.3px_4px_rgba(0,0,0,0.06)] px-[28px] py-[14px] flex items-center justify-between gap-[10px]">
          <div className="relative">
            <button
              onClick={() => setExportOpen(v => !v)}
              disabled={loading || exportMonths.length === 0}
              className="pressable h-[42px] px-[16px] rounded-[10px] bg-[#F2F2F2] text-[#787878] text-[14px] font-medium disabled:opacity-40 hover:opacity-90"
            >
              이용내역서
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setExportOpen(false)} />
                {/* 푸터에 있으니 위로 펼친다 */}
                <div className="absolute left-0 bottom-full mb-[6px] z-30 w-[150px] max-h-[260px] overflow-y-auto bg-[#FCFCFC] border border-[#E5E5E5] rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)]">
                  <button
                    onClick={() => exportStatement('all')}
                    className="w-full px-[13px] h-[34px] text-left text-[12px] font-normal text-[#1E1E1E] hover:bg-[#F2F2F2] transition-colors"
                  >
                    전체 기간
                  </button>
                  <div className="border-t border-[#E5E5E5]" />
                  {exportMonths.slice(0, 12).map(m => (
                    <button
                      key={m}
                      onClick={() => exportStatement(m)}
                      className="w-full px-[13px] h-[34px] text-left text-[12px] font-normal text-[#1E1E1E] hover:bg-[#F2F2F2] transition-colors"
                    >
                      {m.slice(0, 4)}년 {Number(m.slice(5, 7))}월
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-[10px]">
            <button
              onClick={() => { setChargeOpen(true); setChargeError('') }}
              className="pressable w-[100px] h-[42px] rounded-[10px] bg-[#2C261F] text-[#F9F9F9] text-[14px] font-medium hover:opacity-90"
            >
              금액 충전
            </button>
            <button
              onClick={onClose}
              className="pressable w-[86px] h-[42px] rounded-[10px] bg-[#E8E4E2] text-[#6A635E] text-[14px] font-medium hover:opacity-90"
            >
              닫기
            </button>
          </div>
        </div>

        {/* 금액 충전 — 이 모달 위에 겹쳐 띄운다 */}
        {chargeOpen && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30" onClick={() => setChargeOpen(false)}>
            <div
              className="modal-in bg-[#FCFCFC] rounded-[14px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] w-[380px] overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="px-[24px] pt-[22px] pb-[18px]">
                <div className="text-[16px] font-semibold text-[#1E1E1E] mb-[4px]">금액 충전</div>
                <div className="text-[11px] font-normal text-[#ADADAD] mb-[18px]">{target.name}</div>

                <div className="text-[12px] font-normal text-[#6A635E] mb-[6px]">충전 금액</div>
                <div className="relative mb-[16px]">
                  <input
                    value={chargeAmt}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9]/g, '')
                      setChargeAmt(raw ? Number(raw).toLocaleString('ko-KR') : '')
                    }}
                    placeholder="0"
                    inputMode="numeric"
                    autoFocus
                    className="w-full h-[44px] pl-[14px] pr-[34px] rounded-[10px] border border-[#D9D9D9] bg-[#FCFCFC] text-[16px] text-right text-[#1E1E1E] outline-none focus:border-[#6A635E] transition-colors"
                  />
                  <span className="absolute right-[14px] top-1/2 -translate-y-1/2 text-[14px] text-[#787878] pointer-events-none">원</span>
                </div>

                <div className="text-[12px] font-normal text-[#6A635E] mb-[6px]">결제수단</div>
                <div className="flex flex-wrap gap-[6px] mb-[16px]">
                  {(['신용카드', '법인카드', '계좌이체', '무통장입금', '현금', '기타']).map(m => (
                    <button
                      key={m}
                      onClick={() => setChargeMethod(m)}
                      className={`pressable-tab px-[11px] h-[30px] rounded-[9px] text-[12px] font-normal ${
                        chargeMethod === m ? 'bg-[#6A635E] text-[#FCFCFC] font-medium' : 'bg-[#F2F2F2] text-[#787878]'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                <div className="text-[12px] font-normal text-[#6A635E] mb-[6px]">비고 (선택)</div>
                <input
                  value={chargeMemo}
                  onChange={e => setChargeMemo(e.target.value)}
                  placeholder="예: 10월분 선결제"
                  className="w-full h-[40px] px-[14px] rounded-[10px] border border-[#D9D9D9] bg-[#FCFCFC] text-[13px] text-[#1E1E1E] outline-none focus:border-[#6A635E] transition-colors"
                />

                {chargeError && (
                  <div className="mt-[12px] text-[12px] font-normal text-danger">{chargeError}</div>
                )}
              </div>

              <div className="border-t border-[#E5E5E5] px-[24px] py-[13px] flex justify-end gap-[8px]">
                <button
                  onClick={() => setChargeOpen(false)}
                  className="pressable w-[76px] h-[40px] rounded-[10px] bg-[#E8E4E2] text-[#6A635E] text-[13px] font-medium hover:opacity-90"
                >
                  취소
                </button>
                <button
                  onClick={submitCharge}
                  disabled={!chargeAmt || charging}
                  className="pressable w-[96px] h-[40px] rounded-[10px] bg-[#2C261F] text-[#F9F9F9] text-[13px] font-medium disabled:bg-[#E8E4E2] disabled:text-[#ADADAD] hover:opacity-90"
                >
                  {charging ? '저장 중…' : '충전'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
