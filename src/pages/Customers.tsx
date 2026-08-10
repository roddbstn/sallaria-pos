import { useState, useEffect, useRef, useCallback } from 'react'
import QRCode from 'qrcode'
import logoWithText from '../assets/logo-with-text.png'
import { supabase, type DbAccount, type DbDeposit } from '../lib/supabase'
import { won } from '../lib/ipc'
import { useStore } from '../lib/store-context'
import { track } from '../lib/firebase'
import type { Order } from '../lib/mock-data'
import { mapOrderRow } from '../lib/mappers'
import { useHeaderSlot } from '../lib/header-slot'

const BASE_URL = 'https://sallaria.web.app'

function useQrDataUrl(url: string) {
  const [dataUrl, setDataUrl] = useState('')
  useEffect(() => {
    if (!url) { setDataUrl(''); return }
    QRCode.toDataURL(url, { width: 200, margin: 1, color: { dark: '#1E1E1E', light: '#FFFFFF' } })
      .then(setDataUrl)
      .catch(() => setDataUrl(''))
  }, [url])
  return dataUrl
}

const TYPE_BADGE: Record<string, string> = {
  '과':  'bg-blue-100 text-blue-700',
  '기업': 'bg-purple-100 text-purple-700',
  '개인': 'bg-green-soft text-green',
  '기타': 'bg-gray-100 text-gray-text',
}


const INPUT_CLS = 'w-full border-0 border-b border-gray-border bg-transparent px-0 py-2 text-[11px] focus:outline-none focus:border-b-2 focus:border-[#16a84c] transition-colors'

function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 7) return `${d.slice(0,3)}-${d.slice(3)}`
  return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`
}

export default function Customers() {
  const { storeId, storeName } = useStore()
  const { setHeaderRight } = useHeaderSlot()
  const [accounts,     setAccounts]     = useState<DbAccount[]>([])
  const [selected,     setSelected]     = useState<DbAccount | null>(null)
  const [accountOrders, setAccountOrders] = useState<Order[]>([])
  const [deposits,     setDeposits]     = useState<DbDeposit[]>([])
  const [monthlyUsage, setMonthlyUsage] = useState<Record<string, number>>({})
  const [loading,      setLoading]      = useState(true)
  const [fetchError,   setFetchError]   = useState(false)
  const [retryCount,   setRetryCount]   = useState(0)
  const [pinVisible,   setPinVisible]   = useState<string | null>(null)
  const [chargeOpen,   setChargeOpen]   = useState(false)
  const [chargeAmt,    setChargeAmt]    = useState('')
  const [chargeMemo,   setChargeMemo]   = useState('')
  const [chargeError,  setChargeError]  = useState('')
  const [search,       setSearch]       = useState('')
  const [colFilters,   setColFilters]   = useState<{ name: Set<string>; type: Set<string>; balance: Set<string> }>({ name: new Set(), type: new Set(), balance: new Set() })
  const [nameFilterSearch, setNameFilterSearch] = useState('')
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null)
  const filterDropRef  = useRef<HTMLDivElement>(null)
  const [kioskQr,      setKioskQr]      = useState(false)
  const [accountQr,    setAccountQr]    = useState<string | null>(null) // account_code
  const [detailTab,    setDetailTab]    = useState<'orders' | 'charges' | 'members' | 'statement'>('orders')
  const [members,      setMembers]      = useState<{ id: string; name: string; phone: string | null; order_count: number; last_ordered_at: string | null }[]>([])
  const [orderPage,    setOrderPage]    = useState(0)
  const [chargePage,   setChargePage]   = useState(0)
  const [calMonth,     setCalMonth]     = useState(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth() }
  })
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)

  const PAGE_SIZE = 5
  // 인라인 QR (selected 변경 시 자동 생성)
  const selectedQrUrl        = selected ? `${BASE_URL}?store=${storeId}&account=${selected.account_code}` : ''
  const selectedQrDataUrl    = useQrDataUrl(selectedQrUrl)
  const [qrCopied,     setQrCopied]     = useState(false)

  const handlePrintQr = useCallback(() => {
    if (!selected || !selectedQrDataUrl) return

    // Electron에서는 window.open 팝업이 차단되므로 숨겨진 iframe으로 인쇄
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;border:0;visibility:hidden;'
    document.body.appendChild(iframe)

    const doc = iframe.contentDocument ?? iframe.contentWindow?.document
    if (!doc) { document.body.removeChild(iframe); return }

    doc.open()
    doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${selected.account_name} QR</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100vh; }
    body {
      font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
      background: #fff;
      display: flex;
      flex-direction: column;
      align-items: center;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .header {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
    }
    h1 {
      font-size: 56px;
      font-weight: 900;
      color: #1E1E1E;
      text-align: center;
      line-height: 1.2;
      letter-spacing: -1px;
    }
    .subtitle {
      font-size: 20px;
      font-weight: 500;
      color: #727272;
      text-align: center;
    }
    img.qr { width: 420px; height: 420px; }
    .footer {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .logo-row {
      display: flex;
      align-items: flex-end;
      gap: 12px;
    }
    img.logo { width: 210px; object-fit: contain; }
    .collab {
      font-size: 22px;
      font-weight: 600;
      color: #1E1E1E;
      white-space: nowrap;
      margin-bottom: 35px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${selected.account_name}</h1>
    <p class="subtitle">${storeName} 선결제 주문</p>
  </div>
  <img class="qr" src="${selectedQrDataUrl}" alt="QR"/>
  <div class="footer">
    <div class="logo-row">
      <img class="logo" src="${logoWithText}" alt="logo"/>
      <span class="collab">×&nbsp;&nbsp;&nbsp;${storeName}</span>
    </div>
  </div>
</body>
</html>`)
    doc.close()

    // 이미지 로드 후 인쇄
    setTimeout(() => {
      iframe.contentWindow?.print()
      setTimeout(() => { document.body.removeChild(iframe) }, 1000)
    }, 400)
  }, [selected, selectedQrDataUrl])

  const [addOpen,      setAddOpen]      = useState(false)
  const [newForm,      setNewForm]      = useState({
    name: '', type: '과' as DbAccount['account_type'], org: '', manager: '', phone: '', pin: '', warnThreshold: '30000',
    initialDeposit: '', initialDepositMemo: '',
  })
  const [editOpen,     setEditOpen]     = useState(false)
  const [editForm,     setEditForm]     = useState({
    name: '', type: '과' as DbAccount['account_type'], org: '', manager: '', phone: '', pin: '', warnThreshold: '30000',
    balance: '', adjustReason: '',
  })
  const [deleteConfirm,     setDeleteConfirm]     = useState(false)
  const [hardDeleteConfirm, setHardDeleteConfirm] = useState(false)
  const [addPinError,  setAddPinError]  = useState('')
  const [editPinError, setEditPinError] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editingDepositId,  setEditingDepositId]  = useState<string | null>(null)
  const [editDepositAmt,    setEditDepositAmt]    = useState('')
  const [editDepositNote,   setEditDepositNote]   = useState('')
  const [editDepositMethod, setEditDepositMethod] = useState('신용카드')
  const [chargeMethod,      setChargeMethod]      = useState('신용카드')
  const [chargeDate,        setChargeDate]        = useState('')   // "YYYY-MM-DD"
  const [chargeTime,        setChargeTime]        = useState('')   // "HH:MM"
  const [chargeConfirm,     setChargeConfirm]     = useState(false)
  const [chargeLoading,     setChargeLoading]     = useState(false)
  const [discTooltip, setDiscTooltip] = useState<{ x: number; y: number; amount: number } | null>(null)
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
        note:         o.method === '배달' ? `배달료 포함(${(o.delivery_fee ?? 3500).toLocaleString()}원)` : o.method,
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
      ['회사명', acc.account_name, '', '담당자', acc.contact_person ?? '', '', '', '', ''],
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

  // ── selected 변경 시 충전 모달 초기화 ──────────────────────────────────────────
  useEffect(() => {
    setChargeOpen(false)
    setChargeConfirm(false)
    setChargeAmt('')
    setChargeError('')
  }, [selected?.account_code])

  // ── 마운트 / showInactive 변경 시 목록 재조회 ────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      setFetchError(false)
      setSelected(null)
      setDeleteConfirm(false)
      try {
        await Promise.all([fetchAccounts(showInactive), fetchMonthlyUsages()])
      } catch {
        setFetchError(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [showInactive, retryCount])

  // ── 컬럼 필터 드롭다운 외부 클릭 닫기 ────────────────────────────────────────
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterDropRef.current && !filterDropRef.current.contains(e.target as Node)) {
        setOpenFilterCol(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── 선택 거래처 변경 시 이력 로딩 ─────────────────────────────────────────────
  useEffect(() => {
    if (!selected) return
    fetchAccountOrders(selected.account_code)
    fetchDeposits(selected.account_code)
    fetchMembers(selected.account_code)
    setOrderPage(0)
    setChargePage(0)
  }, [selected?.account_code])

  // ── 이용내역서 탭 활성 / 월 변경 시 조회 ──────────────────────────────────────
  useEffect(() => {
    if (detailTab !== 'statement' || !selected) return
    fetchStatement(selected.account_code)
  }, [detailTab, selected?.account_code])

  // ── 공유 헤더 슬롯: 비활성 보기 · 검색 · 매장 QR · 거래처 추가 ──────────────
  useEffect(() => {
    setHeaderRight(
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => setShowInactive(v => !v)}
          className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors ${
            showInactive
              ? 'border-danger text-danger bg-red-50'
              : 'border-gray-border text-gray-text hover:bg-gray-bg'
          }`}
        >
          {showInactive ? '비활성 거래처' : '비활성 보기'}
        </button>
        <div className="relative w-52 flex-shrink-0">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="거래처명, 담당자 검색"
            className="w-full border border-gray-border rounded-lg pl-3 pr-7 py-2 text-[11px] focus:outline-none focus:border-[#16a84c] focus:bg-green-soft transition-colors"
          />
          <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="#727272" strokeWidth="1.5"/>
            <path d="M10.5 10.5L14 14" stroke="#727272" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
        <button
          onClick={() => setKioskQr(true)}
          className="px-3 py-2 bg-gray-100 rounded-lg text-[11px] font-bold hover:bg-gray-100 transition-colors"
        >
          🖨 매장 공용 QR
        </button>
        {!showInactive && (
          <button
            onClick={() => setAddOpen(true)}
            className="px-3 py-2 bg-[#16a84c] text-white rounded-lg text-[11px] font-bold hover:bg-[#128040] transition-colors"
          >
            거래처 추가
          </button>
        )}
      </div>
    )
    return () => setHeaderRight(null)
  }, [showInactive, search, setHeaderRight])

  const seqMap: Record<string, number> = {}
  accounts.forEach((a, i) => { seqMap[a.account_code] = i + 1 })

  const filtered = accounts.filter(a => {
    if (search && !a.account_name.includes(search) && !(a.organization_name ?? '').includes(search) && !(a.contact_person ?? '').includes(search)) return false
    if (colFilters.name.size > 0 && !colFilters.name.has(a.account_code)) return false
    if (colFilters.type.size > 0 && !colFilters.type.has(a.account_type)) return false
    if (colFilters.balance.size > 0) {
      const status = a.current_balance < 0 ? '음수' : a.current_balance < a.warning_threshold ? '경고' : '정상'
      if (!colFilters.balance.has(status)) return false
    }
    return true
  })
  const hasColFilter = colFilters.name.size > 0 || colFilters.type.size > 0 || colFilters.balance.size > 0
  const typeValues   = [...new Set(accounts.map(a => a.account_type))].sort()
  const balanceValues = ['정상', '경고', '음수']

  function toggleColFilter(col: 'name' | 'type' | 'balance', val: string) {
    setColFilters(prev => {
      const next = new Set(prev[col])
      next.has(val) ? next.delete(val) : next.add(val)
      return { ...prev, [col]: next }
    })
  }
  const filteredNameOptions = accounts.filter(a =>
    !nameFilterSearch || a.account_name.includes(nameFilterSearch)
  )

  function copyLink(url: string, key: string) {
    navigator.clipboard.writeText(url)
  }

  // ── 거래처 추가 ───────────────────────────────────────────────────────────────
  async function handleAddAccount() {
    if (!newForm.name.trim() || !newForm.manager.trim() || !newForm.pin.trim()) return
    if (newForm.pin.trim().length !== 4) return

    // PIN 중복 확인
    const { data: dup } = await supabase
      .from('accounts')
      .select('account_code')
      .eq('pin_code', newForm.pin.trim())
      .eq('is_active', true)
      .eq('store_id', storeId)
      .maybeSingle()
    if (dup) {
      setAddPinError('이미 존재하는 PIN번호입니다.')
      return
    }
    setAddPinError('')

    const initialBalance = parseInt(newForm.initialDeposit.replace(/,/g, ''), 10)
    const hasInitial = !isNaN(initialBalance) && initialBalance !== 0

    const { data: newAccount, error } = await supabase
      .from('accounts')
      .insert({
        account_name:      newForm.name.trim(),
        account_type:      newForm.type,
        organization_name: newForm.org.trim() || null,
        contact_person:    newForm.manager.trim(),
        contact_phone:     newForm.phone.trim() || null,
        pin_code:          newForm.pin.trim(),
        warning_threshold: parseInt(newForm.warnThreshold.replace(/,/g, ''), 10) || 30000,
        is_active:         true,
        store_id:          storeId,
        // 양수/음수 모두 초기값으로 직접 설정 (add_deposit은 양수 전용이라 직접 INSERT)
        current_balance:   hasInitial ? initialBalance : 0,
      })
      .select('account_code')
      .single()

    if (error) {
      console.error('거래처 추가 실패:', error)
      return
    }

    // 초기 잔액이 있으면 deposits에 이력 기록 (양수·음수 모두)
    if (newAccount && hasInitial) {
      const { error: depErr } = await supabase.from('deposits').insert({
        account_code: newAccount.account_code,
        amount:       initialBalance,
        note:         newForm.initialDepositMemo.trim() || '초기 잔액 등록',
      })
      if (depErr) console.error('초기 잔액 이력 기록 실패:', depErr)
    }

    await fetchAccounts().catch(() => {})
    setNewForm({ name: '', type: '과', org: '', manager: '', phone: '', pin: '', warnThreshold: '30000', initialDeposit: '', initialDepositMemo: '' })
    setAddPinError('')
    setAddOpen(false)
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
      pin:           selected.pin_code,
      warnThreshold:  String(selected.warning_threshold),
      balance:        String(selected.current_balance),
      adjustReason:   '',
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

    const newBalance   = parseInt(editForm.balance.replace(/,/g, ''), 10)
    const balanceValid = !isNaN(newBalance)
    const balanceDelta = balanceValid ? newBalance - selected.current_balance : 0

    const { error } = await supabase
      .from('accounts')
      .update({
        account_name:      editForm.name.trim(),
        account_type:      editForm.type,
        organization_name: editForm.org.trim() || null,
        contact_person:    editForm.manager.trim(),
        contact_phone:     editForm.phone.trim() || null,
        pin_code:          editForm.pin.trim(),
        warning_threshold: parseInt(editForm.warnThreshold.replace(/,/g, ''), 10) || 30000,
        ...(balanceValid ? { current_balance: newBalance } : {}),
      })
      .eq('account_code', selected.account_code)
    if (error) { console.error('수정 실패:', error); return }

    // 잔액이 바뀐 경우 balance_adjustments에 이력 기록
    if (balanceValid && balanceDelta !== 0) {
      await supabase.from('balance_adjustments').insert({
        account_code:   selected.account_code,
        store_id:       storeId,
        amount:         balanceDelta,
        balance_before: selected.current_balance,
        balance_after:  newBalance,
        reason:         editForm.adjustReason?.trim() || null,
      })
    }

    await fetchAccounts().catch(() => {})
    if (balanceValid && balanceDelta !== 0) {
      fetchStatement(selected.account_code).catch(() => {})
    }
    setSelected(prev => prev ? {
      ...prev,
      account_name:      editForm.name.trim(),
      account_type:      editForm.type,
      organization_name: editForm.org.trim() || null,
      contact_person:    editForm.manager.trim(),
      contact_phone:     editForm.phone.trim() || null,
      pin_code:          editForm.pin.trim(),
      warning_threshold: parseInt(editForm.warnThreshold.replace(/,/g, ''), 10) || 30000,
      ...(balanceValid ? { current_balance: newBalance } : {}),
    } : prev)
    setEditPinError('')
    setEditOpen(false)
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
    setDeleteConfirm(false)
  }

  // ── 충전 이력 수정 ────────────────────────────────────────────────────────────
  async function handleSaveDeposit(deposit: DbDeposit) {
    const newAmt = parseInt(editDepositAmt.replace(/[^0-9-]/g, ''), 10)
    if (isNaN(newAmt) || !selected) return

    // deposits UPDATE + accounts.current_balance 조정을 RPC로 원자적 처리
    const { error } = await supabase.rpc('update_deposit', {
      p_deposit_id:     deposit.deposit_id,
      p_amount:         newAmt,
      p_note:           editDepositNote.trim() || null,
      p_payment_method: editDepositMethod,
    })
    if (error) { console.error('충전 수정 실패:', error); return }

    await Promise.all([fetchAccounts(), fetchDeposits(selected.account_code)]).catch(() => {})
    // 잔액은 fetchAccounts 후 DB에서 다시 조회해 selected 갱신
    const { data: refreshed } = await supabase
      .from('accounts')
      .select('*')
      .eq('account_code', selected.account_code)
      .single()
    if (refreshed) setSelected(refreshed as DbAccount)
    setEditingDepositId(null)
  }

  // ── 거래처 영구 삭제 (하드) ──────────────────────────────────────────────────
  async function handleHardDeleteAccount() {
    if (!selected) return
    const { error } = await supabase
      .from('accounts')
      .delete()
      .eq('account_code', selected.account_code)
    if (error) { console.error('영구 삭제 실패:', error); return }
    await fetchAccounts(showInactive).catch(() => {})
    setSelected(null)
    setHardDeleteConfirm(false)
  }

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

  return (
    <div className="h-full flex overflow-hidden bg-gray-bg gap-3 p-3">

      {/* 잔액 불일치 툴팁 (fixed, overflow 클리핑 없음) */}
      {discTooltip && (
        <div
          className="fixed z-[9999] w-56 rounded-lg bg-ink text-white text-[10px] leading-snug px-2.5 py-2 shadow-lg pointer-events-none"
          style={{ top: discTooltip.y, right: window.innerWidth - discTooltip.x }}
        >
          <span className="font-bold text-white">이 잔액은 맞아요.</span>
          <br />
          <span className="text-gray-300">주문 당시 실제로 남아있던 금액이에요.</span>
          <br /><br />
          <span className="text-gray-400">다만 충전 기록과 {Math.abs(discTooltip.amount).toLocaleString()}원 차이가 나고 있어요. 거래처 등록 당시 초기 잔액이 기록되지 않았거나, 이전에 잔액을 수정한 적이 있는데 당시에는 그 내역이 정확히 기록되지 않아서 생긴 차이예요.</span>
          <br /><br />
          <span className="text-orange-300">8월부터는 잔액을 수정하면 이용내역서에 '잔액조정'으로 남겨지기 때문에 이 표시가 뜨지 않아요.</span>
        </div>
      )}

      {/* ── 테이블 영역 ── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white rounded-xl shadow-sm">

        {/* 헤더: 필터 초기화 버튼 (활성 시에만 표시) */}
        {hasColFilter && (
          <div className="px-5 py-2 border-b border-gray-border flex-shrink-0 flex items-center justify-end">
            <button
              onClick={() => { setColFilters({ name: new Set(), type: new Set(), balance: new Set() }); setNameFilterSearch('') }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 hover:bg-orange-100 transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              필터 초기화
            </button>
          </div>
        )}

        {/* 테이블 헤더 */}
        <div ref={filterDropRef} className="grid grid-cols-[36px_1fr_60px_80px_110px_80px_80px_90px] px-5 py-2 bg-white text-[11px] font-bold text-gray-text uppercase tracking-wide border-b-2 border-gray-border flex-shrink-0">
          <span>#</span>

          {/* 거래처명 필터 */}
          <span className="relative flex items-center gap-0.5">
            거래처명
            <button
              onClick={() => setOpenFilterCol(v => v === 'name' ? null : 'name')}
              className={`ml-0.5 rounded px-0.5 transition-colors ${colFilters.name.size > 0 ? 'text-green' : 'text-gray-border hover:text-gray-text'}`}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M3 4h18l-7 8.5V20l-4-2v-5.5L3 4z"/></svg>
            </button>
            {openFilterCol === 'name' && (
              <div className="absolute top-full left-0 z-50 mt-1 bg-white border border-gray-border rounded-xl shadow-lg py-1.5 min-w-[180px] max-h-[280px] flex flex-col">
                <div className="px-2 pb-1.5 border-b border-gray-border/50 flex-shrink-0">
                  <input
                    autoFocus
                    value={nameFilterSearch}
                    onChange={e => setNameFilterSearch(e.target.value)}
                    placeholder="검색..."
                    className="w-full text-[11px] px-2 py-1 border border-gray-border rounded-lg focus:outline-none focus:border-ink normal-case tracking-normal font-normal"
                  />
                </div>
                <div className="overflow-y-auto flex-1">
                  {filteredNameOptions.map(a => (
                    <label key={a.account_code} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-bg cursor-pointer">
                      <input
                        type="checkbox"
                        checked={colFilters.name.has(a.account_code)}
                        onChange={() => toggleColFilter('name', a.account_code)}
                        className="accent-green w-3.5 h-3.5 flex-shrink-0"
                      />
                      <span className="text-[11px] font-normal text-ink normal-case tracking-normal truncate">{a.account_name}</span>
                    </label>
                  ))}
                </div>
                {colFilters.name.size > 0 && (
                  <button onClick={() => { setColFilters(p => ({ ...p, name: new Set() })); setNameFilterSearch('') }} className="w-full text-left px-3 py-1.5 text-[11px] text-gray-text hover:text-ink border-t border-gray-border/50 flex-shrink-0 normal-case tracking-normal">
                    초기화
                  </button>
                )}
              </div>
            )}
          </span>

          {/* 유형 필터 */}
          <span className="relative flex items-center gap-0.5">
            유형
            <button
              onClick={() => setOpenFilterCol(v => v === 'type' ? null : 'type')}
              className={`ml-0.5 rounded px-0.5 transition-colors ${colFilters.type.size > 0 ? 'text-green' : 'text-gray-border hover:text-gray-text'}`}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M3 4h18l-7 8.5V20l-4-2v-5.5L3 4z"/></svg>
            </button>
            {openFilterCol === 'type' && (
              <div className="absolute top-full left-0 z-50 mt-1 bg-white border border-gray-border rounded-xl shadow-lg py-1.5 min-w-[110px]">
                {typeValues.map(val => (
                  <label key={val} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-bg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={colFilters.type.has(val)}
                      onChange={() => toggleColFilter('type', val)}
                      className="accent-green w-3.5 h-3.5"
                    />
                    <span className="text-[11px] font-normal text-ink normal-case tracking-normal">{val}</span>
                  </label>
                ))}
                {colFilters.type.size > 0 && (
                  <button onClick={() => setColFilters(p => ({ ...p, type: new Set() }))} className="w-full text-left px-3 py-1.5 text-[11px] text-gray-text hover:text-ink border-t border-gray-border/50 mt-1 normal-case tracking-normal">
                    초기화
                  </button>
                )}
              </div>
            )}
          </span>

          <span>담당자</span>
          <span>연락처</span>
          <span>PIN</span>

          {/* 현재잔액 필터 */}
          <span className="relative flex items-center gap-0.5">
            현재잔액
            <button
              onClick={() => setOpenFilterCol(v => v === 'balance' ? null : 'balance')}
              className={`ml-0.5 rounded px-0.5 transition-colors ${colFilters.balance.size > 0 ? 'text-green' : 'text-gray-border hover:text-gray-text'}`}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M3 4h18l-7 8.5V20l-4-2v-5.5L3 4z"/></svg>
            </button>
            {openFilterCol === 'balance' && (
              <div className="absolute top-full left-0 z-50 mt-1 bg-white border border-gray-border rounded-xl shadow-lg py-1.5 min-w-[110px]">
                {balanceValues.map(val => (
                  <label key={val} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-bg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={colFilters.balance.has(val)}
                      onChange={() => toggleColFilter('balance', val)}
                      className="accent-green w-3.5 h-3.5"
                    />
                    <span className={`text-[11px] font-normal normal-case tracking-normal ${val === '음수' ? 'text-danger' : val === '경고' ? 'text-orange-500' : 'text-ink'}`}>{val}</span>
                  </label>
                ))}
                {colFilters.balance.size > 0 && (
                  <button onClick={() => setColFilters(p => ({ ...p, balance: new Set() }))} className="w-full text-left px-3 py-1.5 text-[11px] text-gray-text hover:text-ink border-t border-gray-border/50 mt-1 normal-case tracking-normal">
                    초기화
                  </button>
                )}
              </div>
            )}
          </span>

          <span>이번달</span>
        </div>

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-border">
          {loading ? (
            <div className="h-full flex items-center justify-center text-gray-text text-[11px]">
              <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin mr-2" />
              불러오는 중...
            </div>
          ) : fetchError ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-text text-[11px] gap-2.5">
              <div className="text-[36px]">⚠️</div>
              <div className="font-bold text-ink text-[11px]">거래처 목록을 불러오지 못했습니다</div>
              <button
                onClick={() => setRetryCount(c => c + 1)}
                className="px-3 py-2 rounded-lg bg-ink text-white text-[11px] font-bold hover:bg-ink/80 transition-colors"
              >
                다시 시도
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-text text-[11px]">
              {search ? '검색 결과가 없습니다' : showInactive ? '비활성 거래처가 없습니다' : '등록된 거래처가 없습니다'}
            </div>
          ) : (
            filtered.map((acc) => (
              <button
                key={acc.account_code}
                onClick={() => setSelected(acc)}
                className="w-full grid grid-cols-[36px_1fr_60px_80px_110px_80px_80px_90px] px-5 py-2.5 text-left hover:bg-gray-bg transition-colors text-[11px]"
              >
                <span className="text-gray-text text-[11px]">{seqMap[acc.account_code]}</span>
                <span className="font-semibold text-ink">{acc.account_name}</span>
                <span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${TYPE_BADGE[acc.account_type]}`}>
                    {acc.account_type}
                  </span>
                </span>
                <span className="text-gray-text">{acc.contact_person ?? '—'}</span>
                <span className="text-gray-text font-mono text-[11px]">{acc.contact_phone ?? '—'}</span>
                <span
                  className="flex items-center gap-1 group"
                  onClick={e => { e.stopPropagation(); setPinVisible(v => v === acc.account_code ? null : acc.account_code) }}
                >
                  <span className="font-mono">{pinVisible === acc.account_code ? acc.pin_code : '****'}</span>
                  <svg className="w-3.5 h-3.5 text-gray-text opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className={`font-bold ${acc.current_balance < 0 ? 'text-danger' : acc.current_balance < acc.warning_threshold ? 'text-orange-500' : 'text-ink'}`}>
                  {acc.current_balance < 0 ? `- ${won(Math.abs(acc.current_balance))}` : won(acc.current_balance)}
                </span>
                <span className="text-gray-text">
                  {(monthlyUsage[acc.account_code] ?? 0) > 0
                    ? `-${won(monthlyUsage[acc.account_code])}`
                    : won(0)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── 거래처 상세 모달 ── */}
      {selected && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={() => { setSelected(null); setDeleteConfirm(false) }}>
          <div className="bg-white rounded-2xl shadow-xl w-[720px] max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>

            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-5 pt-6 pb-4 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="text-[18px] font-extrabold text-ink">{selected.account_name}</div>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${TYPE_BADGE[selected.account_type]}`}>
                  {selected.account_type}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {/* 잔액 + 충전 버튼 — 헤더 우측 */}
                <span className={`text-[11px] font-extrabold ${selected.current_balance < 0 ? 'text-danger' : selected.current_balance < selected.warning_threshold ? 'text-orange-500' : 'text-green'}`}>
                  {selected.current_balance < 0 ? `- ${won(Math.abs(selected.current_balance))}` : won(selected.current_balance)}
                </span>
                {!showInactive && (
                  <button onClick={() => {
                    const now = new Date()
                    setChargeDate(now.toLocaleDateString('en-CA'))
                    setChargeTime(`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`)
                    setChargeConfirm(false)
                    setChargeAmt('')
                    setChargeMemo('')
                    setChargeMethod('신용카드')
                    setChargeError('')
                    setChargeOpen(true)
                  }} className="px-3 py-1.5 rounded-lg bg-[#16a84c] text-white text-[11px] font-bold hover:bg-[#128040] transition-colors">
                    💳 충전
                  </button>
                )}
                {!showInactive && (
                  <button onClick={openEdit} className="px-3 py-1.5 rounded-lg border border-gray-border text-[11px] font-bold text-gray-text hover:bg-gray-bg transition-colors">
                    수정
                  </button>
                )}
                <button onClick={() => { setSelected(null); setDeleteConfirm(false) }} className="text-gray-text hover:text-ink text-[18px] ml-1">✕</button>
              </div>
            </div>

            {/* 스크롤 영역 */}
            <div className="overflow-y-auto px-5 pb-6 flex-1">

              {/* QR (좌) + 6가지 정보 (우) */}
              <div className="flex gap-5 mb-5 items-start">

                {/* 왼쪽: 인라인 QR */}
                <div className="flex flex-col items-center gap-2 flex-shrink-0">
                  {selectedQrDataUrl ? (
                    <img src={selectedQrDataUrl} alt="QR" className="w-[120px] h-[120px] rounded-xl border border-gray-border" />
                  ) : (
                    <div className="w-[120px] h-[120px] rounded-xl border border-gray-border flex items-center justify-center text-[11px] text-gray-text">
                      QR 생성 중…
                    </div>
                  )}
                  {/* 제목 */}
                  <p className="text-[11px] text-center leading-tight px-1">
                    <span className="font-semibold text-ink">{storeName}</span>
                    <span className="text-gray-text"> '{selected.account_name}' 선결제 QR</span>
                  </p>
                  {/* URL + 복사 */}
                  <div className="flex items-center gap-1 w-[120px] border border-gray-border rounded-lg px-2 py-1 bg-gray-bg">
                    <span className="flex-1 text-[10px] text-gray-text truncate text-left min-w-0" style={{ direction: 'rtl', unicodeBidi: 'plaintext' }}>
                      {selectedQrUrl}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedQrUrl)
                        setQrCopied(true)
                        setTimeout(() => setQrCopied(false), 2000)
                      }}
                      className="flex-shrink-0"
                      title="URL 복사"
                    >
                      {qrCopied ? (
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="#16a84c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="8" height="9" rx="1.5" stroke="#727272" strokeWidth="1.4"/><path d="M11 5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v6A1.5 1.5 0 0 0 4 11.5H5" stroke="#727272" strokeWidth="1.4" strokeLinecap="round"/></svg>
                      )}
                    </button>
                  </div>
                  {/* PDF 출력 / 이미지 저장 */}
                  <div className="flex gap-1 w-[120px]">
                    <button
                      disabled={!selectedQrDataUrl}
                      onClick={handlePrintQr}
                      className="flex-1 py-1.5 text-[11px] font-bold rounded-lg bg-ink text-white hover:bg-ink/90 disabled:opacity-40 transition-colors"
                    >
                      PDF 출력
                    </button>
                    <button
                      disabled={!selectedQrDataUrl}
                      onClick={() => {
                        if (!selectedQrDataUrl) return
                        const a = document.createElement('a')
                        a.href = selectedQrDataUrl
                        a.download = `QR_${selected.account_name}.png`
                        a.click()
                      }}
                      className="flex-1 py-1.5 text-[11px] font-bold rounded-lg border border-gray-border text-ink hover:bg-gray-bg disabled:opacity-40 transition-colors"
                    >
                      이미지 저장
                    </button>
                  </div>
                </div>

                {/* 오른쪽: 6가지 정보 */}
                <div className="flex-1 space-y-2 text-[11px] pt-1">
                  <InfoRow label="담당자"        value={selected.contact_person ?? '—'} />
                  <InfoRow label="연락처"        value={selected.contact_phone ?? '—'} />
                  <InfoRow label="기관명"        value={selected.organization_name ?? '—'} />
                  <InfoRow label="PIN"           value={selected.pin_code} />
                  <InfoRow label="잔액 경고 기준" value={won(selected.warning_threshold)} />
                  <InfoRow label="이번달 사용액"  value={`-${won(monthlyUsage[selected.account_code] ?? 0)}`} />
                </div>
              </div>

              {/* 이력 탭 */}
              <div className="flex gap-0 border-b border-gray-border mb-3">
                {(['orders', 'charges', 'members', 'statement'] as const).map(t => (
                  <button key={t} onClick={() => { setDetailTab(t); setOrderPage(0); setChargePage(0) }}
                    className={`px-3 py-2 text-[11px] font-bold border-b-2 transition-colors
                      ${detailTab === t ? 'border-[#16a84c] text-[#16a84c]' : 'border-transparent text-gray-text hover:text-ink'}`}>
                    {t === 'orders'    ? '주문 내역'
                      : t === 'charges'   ? '충전 이력'
                      : t === 'members'   ? `누적 주문자${members.length > 0 ? ` (${members.length})` : ''}`
                      : '이용내역서'}
                  </button>
                ))}
              </div>

              {/* 주문 내역 */}
              {detailTab === 'orders' && (() => {
                const total = accountOrders.length
                const pages = Math.ceil(total / PAGE_SIZE)
                const slice = accountOrders.slice(orderPage * PAGE_SIZE, (orderPage + 1) * PAGE_SIZE)
                return (
                  <div>
                    <div className="space-y-2">
                      {total === 0
                        ? <div className="text-[11px] text-gray-text py-2">주문 이력 없음</div>
                        : slice.map(o => {
                            const dt = new Date(o.createdAt)
                            const DAY = ['일','월','화','수','목','금','토']
                            const dateStr = dt.toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' })
                            const timeStr = dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
                            const dow = DAY[dt.getDay()]
                            return (
                              <div key={o.code} className="bg-gray-bg rounded-lg px-3 py-2 text-[11px]">
                                {/* 날짜·방법 + 합계·상태 */}
                                <div className="flex justify-between items-start mb-2">
                                  <span className="text-gray-text">{dateStr} ({dow}) {timeStr} · {o.method}</span>
                                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                                    <StatusTag status={o.status} />
                                    <span className="font-bold text-ink">{won(o.total)}</span>
                                  </div>
                                </div>
                                {/* 주문자 */}
                                <div className="text-[11px] text-gray-text mb-1">
                                  {o.orderer}{o.phone ? ` · ${o.phone}` : ''}
                                </div>
                                {/* 메뉴별 한 줄씩 */}
                                <div className="space-y-1.5 border-t border-gray-border pt-2">
                                  {o.items.map((item, idx) => (
                                    <div key={idx} className="flex justify-between items-start gap-2">
                                      <div className="min-w-0">
                                        <span className="font-semibold text-ink">
                                          {item.qty > 1 ? `${item.name} ×${item.qty}` : item.name}
                                        </span>
                                        {item.options.length > 0 && (
                                          <div className="text-[11px] text-gray-text mt-0.5 leading-snug">
                                            {item.options.join(' · ')}
                                          </div>
                                        )}
                                      </div>
                                      <span className="text-ink flex-shrink-0 font-medium">{won(item.price * item.qty)}</span>
                                    </div>
                                  ))}
                                </div>
                                {/* 주문 후 잔액 */}
                                {o.balanceAfter !== undefined && o.status !== '취소' && (
                                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-border">
                                    <span className="text-[11px] text-gray-text">주문 후 잔액</span>
                                    <span className={`text-[11px] font-bold ${o.balanceAfter < 0 ? 'text-danger' : 'text-green'}`}>
                                      {o.balanceAfter < 0 ? `- ${won(Math.abs(o.balanceAfter))}` : won(o.balanceAfter)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )
                          })
                      }
                    </div>
                    {pages > 1 && (
                      <div className="flex items-center justify-center gap-1 mt-3">
                        <button onClick={() => setOrderPage(0)} disabled={orderPage === 0}
                          className="px-2 py-1 text-[11px] font-bold rounded border border-gray-border text-gray-text disabled:opacity-30 hover:bg-gray-bg">
                          «
                        </button>
                        <button onClick={() => setOrderPage(p => p - 1)} disabled={orderPage === 0}
                          className="px-2 py-1 text-[11px] font-bold rounded border border-gray-border text-gray-text disabled:opacity-30 hover:bg-gray-bg">
                          ‹ 이전
                        </button>
                        <span className="text-[11px] text-gray-text px-1">{orderPage + 1} / {pages}</span>
                        <button onClick={() => setOrderPage(p => p + 1)} disabled={orderPage >= pages - 1}
                          className="px-2 py-1 text-[11px] font-bold rounded border border-gray-border text-gray-text disabled:opacity-30 hover:bg-gray-bg">
                          다음 ›
                        </button>
                        <button onClick={() => setOrderPage(pages - 1)} disabled={orderPage >= pages - 1}
                          className="px-2 py-1 text-[11px] font-bold rounded border border-gray-border text-gray-text disabled:opacity-30 hover:bg-gray-bg">
                          »
                        </button>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* 충전 이력 */}
              {detailTab === 'charges' && (() => {
                const { year, month } = calMonth
                const firstDay    = new Date(year, month, 1).getDay()
                const daysInMonth = new Date(year, month + 1, 0).getDate()
                const monthLabel  = `${year}년 ${month + 1}월`

                // 이 달 충전 이력
                const monthDeposits = deposits.filter(d => {
                  const dt = new Date(d.created_at)
                  return dt.getFullYear() === year && dt.getMonth() === month
                })

                // 날짜별 집계
                const dayMap: Record<number, { count: number; total: number }> = {}
                monthDeposits.forEach(d => {
                  const day = new Date(d.created_at).getDate()
                  if (!dayMap[day]) dayMap[day] = { count: 0, total: 0 }
                  dayMap[day].count++
                  dayMap[day].total += d.amount
                })
                const monthTotal = monthDeposits.reduce((s, d) => s + d.amount, 0)
                const monthCount = monthDeposits.length

                // 캘린더 셀
                const cells: (number | null)[] = []
                for (let i = 0; i < firstDay; i++) cells.push(null)
                for (let i = 1; i <= daysInMonth; i++) cells.push(i)
                while (cells.length % 7 !== 0) cells.push(null)

                const today = new Date()
                const DAY_LABELS = ['일','월','화','수','목','금','토']
                const DAY = ['일','월','화','수','목','금','토']

                return (
                  <div>
                    {/* ── 캘린더 ── */}
                    <div className="mb-4">
                      {/* 헤더: 월 이동 + 이번 달 통계 */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setCalMonth(c => { const d = new Date(c.year, c.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() } })}
                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-bg text-gray-text text-[16px] leading-none"
                          >‹</button>
                          <button
                            onClick={() => setMonthPickerOpen(true)}
                            className="text-[11px] font-bold text-ink w-[88px] text-center hover:text-green transition-colors underline underline-offset-2 decoration-dotted"
                          >{monthLabel}</button>
                          <button
                            onClick={() => setCalMonth(c => { const d = new Date(c.year, c.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() } })}
                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-bg text-gray-text text-[16px] leading-none"
                          >›</button>
                        </div>
                        <div className="text-right">
                          {monthCount > 0 ? (
                            <>
                              <p className="text-[11px] font-bold text-green">+{won(monthTotal)}</p>
                              <p className="text-[10px] text-gray-text">{monthCount}회 충전</p>
                            </>
                          ) : (
                            <p className="text-[11px] text-gray-text">충전 없음</p>
                          )}
                        </div>
                      </div>

                      {/* 월 선택 모달 */}
                      {monthPickerOpen && (() => {
                        // 충전 이력 있는 월만 집계
                        const monthSummary: Record<string, { year: number; month: number; total: number; count: number }> = {}
                        deposits.forEach(d => {
                          const dt = new Date(d.created_at)
                          const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
                          if (!monthSummary[key]) monthSummary[key] = { year: dt.getFullYear(), month: dt.getMonth(), total: 0, count: 0 }
                          monthSummary[key].total += d.amount
                          monthSummary[key].count++
                        })
                        const sortedMonths = Object.entries(monthSummary).sort((a, b) => b[0].localeCompare(a[0]))
                        const allTimeTotal = deposits.reduce((s, d) => s + d.amount, 0)

                        return (
                          <div
                            className="fixed inset-0 z-[300] flex items-center justify-center"
                            style={{ background: 'rgba(0,0,0,0.35)' }}
                            onClick={() => setMonthPickerOpen(false)}
                          >
                            <div
                              className="bg-white rounded-2xl shadow-2xl w-[280px] max-h-[420px] flex flex-col overflow-hidden"
                              onClick={e => e.stopPropagation()}
                            >
                              {/* 모달 헤더 */}
                              <div className="flex items-center justify-between px-3 pt-4 pb-3 border-b border-gray-border flex-shrink-0">
                                <span className="text-[11px] font-bold text-ink">월 선택</span>
                                <div className="flex items-center gap-2.5">
                                  <div className="text-right">
                                    <p className="text-[10px] text-gray-text leading-none mb-0.5">총 충전액</p>
                                    <p className="text-[11px] font-extrabold text-green leading-none">+{won(allTimeTotal)}</p>
                                  </div>
                                  <button onClick={() => setMonthPickerOpen(false)} className="text-gray-text text-[16px] hover:text-ink leading-none">✕</button>
                                </div>
                              </div>
                              {/* 월 리스트 */}
                              <div className="overflow-y-auto flex-1">
                                {sortedMonths.length === 0 ? (
                                  <p className="text-[11px] text-gray-text text-center py-6">충전 이력 없음</p>
                                ) : sortedMonths.map(([key, info]) => {
                                  const isSelected = calMonth.year === info.year && calMonth.month === info.month
                                  return (
                                    <button
                                      key={key}
                                      onClick={() => { setCalMonth({ year: info.year, month: info.month }); setMonthPickerOpen(false) }}
                                      className={`w-full flex items-center justify-between px-3 py-2.5 text-left border-b border-gray-border/50 transition-colors
                                        ${isSelected ? 'bg-green-soft' : 'hover:bg-gray-bg'}`}
                                    >
                                      <div>
                                        <span className={`text-[11px] font-bold ${isSelected ? 'text-green' : 'text-ink'}`}>
                                          {info.year}년 {info.month + 1}월
                                        </span>
                                        <span className="text-[10px] text-gray-text ml-2">{info.count}회</span>
                                      </div>
                                      <span className={`text-[11px] font-extrabold ${isSelected ? 'text-green' : 'text-ink'}`}>
                                        +{won(info.total)}
                                      </span>
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        )
                      })()}

                      {/* 요일 헤더 */}
                      <div className="grid grid-cols-7 mb-0.5">
                        {DAY_LABELS.map((d, i) => (
                          <div key={d} className={`text-center text-[10px] font-bold py-1 ${i === 0 ? 'text-danger' : i === 6 ? 'text-blue-500' : 'text-gray-text'}`}>{d}</div>
                        ))}
                      </div>

                      {/* 날짜 그리드 */}
                      <div className="grid grid-cols-7">
                        {cells.map((day, idx) => {
                          if (!day) return <div key={`e${idx}`} className="h-9" />
                          const hasDeposit = !!dayMap[day]
                          const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
                          const dow = (firstDay + day - 1) % 7
                          return (
                            <div key={day} className="flex flex-col items-center h-9 pt-0.5">
                              <div className={`w-6 h-6 flex items-center justify-center rounded-full text-[11px] font-semibold
                                ${isToday ? 'bg-ink text-white' : dow === 0 ? 'text-danger' : dow === 6 ? 'text-blue-500' : 'text-ink'}`}>
                                {day}
                              </div>
                              {hasDeposit && (
                                <div className="flex flex-col items-center gap-0" style={{ marginTop: 1 }}>
                                  <div className="w-1 h-1 rounded-full bg-green" />
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* ── 구분선 ── */}
                    <div className="border-t border-gray-border mb-3" />

                    {/* ── 해당 월 충전 리스트 ── */}
                    <div className="space-y-2">
                      {monthCount === 0
                        ? <div className="text-[11px] text-gray-text py-2">이 달 충전 이력 없음</div>
                        : monthDeposits.map(d => {
                            const dt   = new Date(d.created_at)
                            const date = dt.toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' })
                            const time = dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
                            const dow  = DAY[dt.getDay()]
                            const isEditing = editingDepositId === d.deposit_id

                            if (isEditing) {
                              return (
                                <div key={d.deposit_id} className="bg-green-soft/40 border border-green/30 rounded-lg px-3 py-2 text-[11px] space-y-2">
                                  <div className="flex items-center gap-2">
                                    <input
                                      autoFocus
                                      value={editDepositAmt}
                                      onChange={e => setEditDepositAmt(e.target.value.replace(/[^0-9-]/g, ''))}
                                      onKeyDown={e => { if (e.key === 'Enter') handleSaveDeposit(d); if (e.key === 'Escape') setEditingDepositId(null) }}
                                      inputMode="numeric"
                                      className="flex-1 border-0 border-b-2 border-green bg-transparent px-0 py-1 text-[11px] font-bold focus:outline-none"
                                    />
                                    <span className="text-gray-text flex-shrink-0">원</span>
                                  </div>
                                  {(() => {
                                    const newAmt = parseInt(editDepositAmt, 10)
                                    const delta = isNaN(newAmt) ? 0 : newAmt - d.amount
                                    if (delta === 0 || isNaN(newAmt)) return null
                                    return (
                                      <p className={`text-[11px] font-semibold ${delta > 0 ? 'text-green' : 'text-danger'}`}>
                                        {delta > 0 ? `▲ +${won(delta)} 잔액 증가` : `▼ ${won(Math.abs(delta))} 잔액 감소`}
                                      </p>
                                    )
                                  })()}
                                  <div>
                                    <p className="text-[10px] font-bold text-gray-text mb-1">결제수단</p>
                                    <div className="flex flex-wrap gap-1">
                                      {(['신용카드','법인카드','계좌이체','무통장입금','현금','기타']).map(m => (
                                        <button key={m} onClick={() => setEditDepositMethod(m)}
                                          className={`px-2 py-1 rounded-full border text-[10px] font-semibold transition-colors focus:outline-none
                                            ${editDepositMethod === m ? 'border-green bg-green-soft text-green' : 'border-gray-border text-gray-text hover:bg-white'}`}>
                                          {m}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  <input
                                    value={editDepositNote}
                                    onChange={e => setEditDepositNote(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleSaveDeposit(d); if (e.key === 'Escape') setEditingDepositId(null) }}
                                    placeholder="비고 (선택)"
                                    className="w-full border-0 border-b border-gray-border bg-transparent px-0 py-1 text-[11px] focus:outline-none"
                                  />
                                  <div className="flex gap-2 pt-1">
                                    <button onClick={() => setEditingDepositId(null)}
                                      className="flex-1 py-1.5 rounded-lg bg-gray-100 text-gray-text text-[11px] font-bold hover:bg-gray-200">취소</button>
                                    <button onClick={() => handleSaveDeposit(d)}
                                      className="flex-1 py-1.5 rounded-lg bg-green text-white text-[11px] font-bold hover:bg-[#015c28]">저장</button>
                                  </div>
                                </div>
                              )
                            }

                            return (
                              <div key={d.deposit_id} className="bg-gray-bg rounded-lg px-3 py-2 flex justify-between items-center text-[11px] group/dep">
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-semibold text-green">+{won(d.amount)}</span>
                                    <span className="text-[10px] font-semibold text-gray-text bg-white border border-gray-border px-1.5 py-0.5 rounded-full">
                                      {d.payment_method ?? '신용카드'}
                                    </span>
                                  </div>
                                  <div className="text-gray-text">
                                    {date} ({dow}) {time}
                                    {d.note ? ` · ${d.note}` : ''}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => { setEditingDepositId(d.deposit_id); setEditDepositAmt(String(d.amount)); setEditDepositNote(d.note ?? ''); setEditDepositMethod(d.payment_method ?? '신용카드') }}
                                    className="text-[11px] font-bold text-gray-text border border-gray-border rounded-md px-2 py-0.5 hover:bg-white hover:text-ink transition-colors opacity-0 group-hover/dep:opacity-100"
                                  >수정</button>
                                  <span className="text-[10px] font-bold text-green bg-green-soft px-2 py-0.5 rounded-full flex-shrink-0">충전</span>
                                </div>
                              </div>
                            )
                          })
                      }
                    </div>
                  </div>
                )
              })()}

              {/* 누적 주문자 */}
              {detailTab === 'members' && (
                <div>
                  {members.length === 0 ? (
                    <div className="text-[11px] text-gray-text py-2">등록된 주문자 없음</div>
                  ) : (
                    <div className="space-y-2">
                      {members.map((m, idx) => {
                        const lastDt = m.last_ordered_at ? new Date(m.last_ordered_at) : null
                        const lastStr = lastDt
                          ? lastDt.toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' })
                          : '—'
                        return (
                          <div key={m.id} className="bg-gray-bg rounded-lg px-3 py-2 flex items-center gap-2.5 text-[11px] group/member">
                            <span className="text-[11px] text-gray-text w-5 text-center flex-shrink-0">{idx + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-ink truncate">{m.name}</div>
                              <div className="text-gray-text text-[11px] mt-0.5">
                                {m.phone ?? '—'} · 마지막 {lastStr}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[11px] font-bold text-green bg-green-soft px-2 py-0.5 rounded-full">
                                {m.order_count}회
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 이용내역서 */}
              {detailTab === 'statement' && (() => {
                const rows = buildStmtRows()

                function prevMonth() {
                  if (stmtAllTime) { setStmtAllTime(false); return }
                  const [y, m] = stmtMonth.split('-').map(Number)
                  const d = new Date(y, m - 2, 1)
                  setStmtMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
                }
                function nextMonth() {
                  if (stmtAllTime) return
                  const [y, m] = stmtMonth.split('-').map(Number)
                  const d = new Date(y, m, 1)
                  setStmtMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
                }

                const fmtRowDate = (iso: string) => {
                  const d = new Date(iso)
                  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
                }

                return (
                  <div>
                    {/* 컨트롤 바 */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-1">
                        <button onClick={prevMonth} disabled={stmtAllTime}
                          className="px-2 py-1 text-[11px] font-bold rounded border border-gray-border text-gray-text disabled:opacity-30 hover:bg-gray-bg">‹</button>
                        <span className="text-[11px] font-semibold w-24 text-center">
                          {stmtAllTime ? '전체 기간' : stmtMonth}
                        </span>
                        <button onClick={nextMonth} disabled={stmtAllTime}
                          className="px-2 py-1 text-[11px] font-bold rounded border border-gray-border text-gray-text disabled:opacity-30 hover:bg-gray-bg">›</button>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setStmtAllTime(v => !v)}
                          className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition-colors
                            ${stmtAllTime ? 'border-green bg-green-soft text-green' : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}
                        >
                          전체 기간
                        </button>
                        <button
                          onClick={downloadCSV}
                          className="px-3 py-1.5 rounded-lg bg-ink text-white text-[11px] font-bold hover:bg-ink/80 transition-colors"
                        >
                          CSV 다운로드
                        </button>
                      </div>
                    </div>

                    {/* 테이블 */}
                    {stmtLoading ? (
                      <div className="flex items-center justify-center py-8 text-gray-text text-[11px]">
                        <div className="w-5 h-5 border-2 border-green border-t-transparent rounded-full animate-spin mr-2" />
                        불러오는 중...
                      </div>
                    ) : (
                      <div className="overflow-x-auto -mx-1">
                        <table className="text-[10px] border-collapse w-full">
                          <thead>
                            <tr className="bg-gray-bg text-[9px] font-bold text-gray-text uppercase">
                              <th colSpan={3} className="text-left py-1.5 border border-gray-border px-1.5">선결제내역</th>
                              <th colSpan={5} className="text-left py-1.5 border border-gray-border px-1.5">사용내역</th>
                              <th rowSpan={2} className="text-left py-1.5 border border-gray-border px-1.5 whitespace-nowrap">잔액</th>
                            </tr>
                            <tr className="bg-gray-bg text-[9px] font-semibold text-gray-text">
                              <th className="py-1 px-1.5 border border-gray-border text-left whitespace-nowrap">일자</th>
                              <th className="py-1 px-1.5 border border-gray-border text-left whitespace-nowrap">금액</th>
                              <th className="py-1 px-1.5 border border-gray-border text-left">기타</th>
                              <th className="py-1 px-1.5 border border-gray-border text-left whitespace-nowrap">일자</th>
                              <th className="py-1 px-1.5 border border-gray-border text-left whitespace-nowrap">금액</th>
                              <th className="py-1 px-1.5 border border-gray-border text-left">내역</th>
                              <th className="py-1 px-1.5 border border-gray-border text-left">비고</th>
                              <th className="py-1 px-1.5 border border-gray-border text-left">서명</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.length === 0 ? (
                              <tr>
                                <td colSpan={9} className="text-center py-5 text-gray-text text-[11px]">내역 없음</td>
                              </tr>
                            ) : rows.map((row, idx) => {
                              if (row.type === 'adjustment') {
                                return (
                                  <tr key={idx} className="bg-orange-50">
                                    {/* 선결제내역: 일자 */}
                                    <td className="py-1 px-1.5 border border-gray-border text-orange-600 font-medium whitespace-nowrap">
                                      <div className="text-[8px] font-bold bg-orange-100 text-orange-600 px-1 py-0.5 rounded mb-0.5 w-fit">잔액조정</div>
                                      {fmtRowDate(row.date)}
                                    </td>
                                    {/* 선결제내역: 금액 */}
                                    <td className="py-1 px-1.5 border border-gray-border text-right font-bold whitespace-nowrap" style={{ color: row.amount >= 0 ? 'var(--green)' : 'var(--danger)' }}>
                                      {row.amount >= 0 ? `+${won(row.amount)}` : `-${won(Math.abs(row.amount))}`}
                                    </td>
                                    {/* 선결제내역: 기타 */}
                                    <td className="py-1 px-1.5 border border-gray-border" />
                                    {/* 사용내역: 일자 */}
                                    <td className="py-1 px-1.5 border border-gray-border" />
                                    {/* 사용내역: 금액 */}
                                    <td className="py-1 px-1.5 border border-gray-border" />
                                    {/* 사용내역: 내역 */}
                                    <td className="py-1 px-1.5 border border-gray-border text-gray-text text-[9px] break-words">
                                      {row.reason || '—'}
                                    </td>
                                    {/* 사용내역: 비고 — 조정 전후 잔액 */}
                                    <td className="py-1 px-1.5 border border-gray-border text-gray-text text-[9px]">
                                      <span className="whitespace-nowrap">{won(row.balanceBefore)}</span>
                                      <span className="text-gray-text mx-0.5">→</span>
                                      <span className="whitespace-nowrap">{won(row.balanceAfter)}</span>
                                    </td>
                                    {/* 사용내역: 서명 */}
                                    <td className="py-1 px-1.5 border border-gray-border text-gray-text text-[9px]">
                                      {row.orderer ?? ''}
                                    </td>
                                    {/* 잔액 */}
                                    <td className="py-1 px-1.5 border border-gray-border text-right font-bold" style={{ color: row.balanceAfter < 0 ? 'var(--danger)' : 'inherit' }}>
                                      {won(row.balanceAfter)}
                                    </td>
                                  </tr>
                                )
                              } else if (row.type === 'deposit') {
                                return (
                                  <tr key={idx} className="hover:bg-green-soft/20 transition-colors">
                                    <td className="py-1 px-1.5 border border-gray-border text-green font-medium whitespace-nowrap">{fmtRowDate(row.date)}</td>
                                    <td className="py-1 px-1.5 border border-gray-border text-right font-bold whitespace-nowrap" style={{ color: row.amount < 0 ? 'var(--danger)' : 'var(--green)' }}>
                                      {row.amount < 0 ? `-${won(Math.abs(row.amount))}` : `+${won(row.amount)}`}
                                    </td>
                                    <td className="py-1 px-1.5 border border-gray-border text-gray-text">{row.paymentMethod}</td>
                                    <td className="py-1 px-1.5 border border-gray-border" />
                                    <td className="py-1 px-1.5 border border-gray-border" />
                                    <td className="py-1 px-1.5 border border-gray-border" />
                                    <td className="py-1 px-1.5 border border-gray-border" />
                                    <td className="py-1 px-1.5 border border-gray-border" />
                                    <td className="py-1 px-1.5 border border-gray-border text-right font-bold text-green">{won(row.balanceAfter)}</td>
                                  </tr>
                                )
                              } else {
                                return (
                                  <tr key={idx} className="hover:bg-gray-bg/60 transition-colors">
                                    <td className="py-1 px-1.5 border border-gray-border" />
                                    <td className="py-1 px-1.5 border border-gray-border" />
                                    <td className="py-1 px-1.5 border border-gray-border" />
                                    <td className="py-1 px-1.5 border border-gray-border text-gray-text whitespace-nowrap">{fmtRowDate(row.date)}</td>
                                    <td className="py-1 px-1.5 border border-gray-border text-right font-medium text-ink whitespace-nowrap">-{won(row.amount)}</td>
                                    <td className="py-1 px-1.5 border border-gray-border text-ink break-words">{row.summary}</td>
                                    <td className="py-1 px-1.5 border border-gray-border text-gray-text break-words">{row.note}</td>
                                    <td className="py-1 px-1.5 border border-gray-border text-gray-text">{row.orderer}</td>
                                    <td className="py-1 px-1.5 border border-gray-border text-right font-medium">
                                      <span style={{ color: row.balanceAfter < 0 ? 'var(--danger)' : 'inherit' }}>{won(row.balanceAfter)}</span>
                                      {row.discrepancy !== undefined && (
                                        <span
                                          className="inline-flex items-center justify-center ml-0.5 cursor-help w-3.5 h-3.5 rounded-full bg-green text-white text-[8px] font-bold"
                                          onMouseEnter={e => {
                                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                            setDiscTooltip({ x: r.right, y: r.bottom + 6, amount: row.discrepancy! })
                                          }}
                                          onMouseLeave={() => setDiscTooltip(null)}
                                        >?</span>
                                      )}
                                    </td>
                                  </tr>
                                )
                              }
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* 삭제 / 복구 — 맨 하단 */}
              <div className="pt-5 mt-5 border-t border-gray-border">
                {showInactive ? (
                  <div className="space-y-2">
                    <button onClick={handleRestoreAccount} className="w-full py-2 rounded-xl text-[11px] font-bold text-[#16a84c] hover:bg-green-soft transition-colors border border-[#16a84c]/30 focus:outline-none">
                      거래처 복구
                    </button>
                    {!hardDeleteConfirm ? (
                      <button onClick={() => setHardDeleteConfirm(true)} className="w-full py-2 rounded-xl text-[11px] font-bold text-danger hover:bg-red-50 transition-colors border border-danger/30 focus:outline-none">
                        영구 삭제
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <div className="mb-2">
                          <p className="text-[11px] text-center text-ink font-semibold leading-tight">정말 영구 삭제하시겠어요?</p>
                          <p className="text-[11px] text-center text-danger leading-tight mt-0.5">복구할 수 없습니다.</p>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setHardDeleteConfirm(false)} className="flex-1 py-2 rounded-xl text-[11px] font-bold bg-gray-100 text-gray-text hover:bg-gray-200 focus:outline-none">취소</button>
                          <button onClick={handleHardDeleteAccount} className="flex-1 py-2 rounded-xl text-[11px] font-bold bg-danger text-white hover:bg-red-700 focus:outline-none">영구 삭제 확인</button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : !deleteConfirm ? (
                  <button onClick={() => setDeleteConfirm(true)} className="w-full py-2 rounded-xl text-[11px] font-bold text-danger hover:bg-red-50 transition-colors border border-danger/30 focus:outline-none">
                    거래처 삭제
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="mb-5">
                      <p className="text-[11px] text-center text-ink font-semibold leading-tight">정말 삭제하시겠어요?</p>
                      <p className="text-[11px] text-center text-gray-text leading-tight mt-0.5">추후 복구할 수 있어요.</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setDeleteConfirm(false)} className="flex-1 py-2 rounded-xl text-[11px] font-bold bg-gray-100 text-gray-text hover:bg-gray-200 focus:outline-none">취소</button>
                      <button onClick={handleDeleteAccount} className="flex-1 py-2 rounded-xl text-[11px] font-bold bg-danger text-white hover:bg-red-700 focus:outline-none">삭제 확인</button>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ── 거래처 추가 모달 ── */}
      {addOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-[420px] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="text-[17px] font-extrabold">거래처 추가</div>
              <button onClick={() => setAddOpen(false)} className="text-gray-text hover:text-ink text-[18px]">✕</button>
            </div>

            <div className="space-y-5">
              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">거래처명 <span className="text-danger">*</span></label>
                <div className="relative">
                  <input value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value.slice(0, 25) }))}
                    maxLength={25} placeholder="예: 북구청 공원녹지과" className={INPUT_CLS} />
                  <span className={`absolute right-2.5 bottom-2 text-[10px] ${newForm.name.length >= 25 ? 'text-danger' : 'text-gray-text'}`}>
                    {newForm.name.length}/25
                  </span>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-2">유형</label>
                <div className="flex gap-2">
                  {(['과', '기업', '개인', '기타'] as DbAccount['account_type'][]).map(t => (
                    <button key={t} onClick={() => setNewForm(f => ({ ...f, type: t }))}
                      className={`flex-1 py-1.5 rounded-full border text-[11px] font-bold transition-colors focus:outline-none
                        ${newForm.type === t ? 'border-[#16a84c] text-[#16a84c] bg-green-soft' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">기관명</label>
                <input value={newForm.org} onChange={e => setNewForm(f => ({ ...f, org: e.target.value }))}
                  placeholder="예: 북구청" className={INPUT_CLS} />
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">담당자 <span className="text-danger">*</span></label>
                <input value={newForm.manager} onChange={e => setNewForm(f => ({ ...f, manager: e.target.value }))}
                  placeholder="예: 김민준" className={INPUT_CLS} />
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">연락처</label>
                <input value={newForm.phone} onChange={e => setNewForm(f => ({ ...f, phone: formatPhone(e.target.value) }))}
                  placeholder="010-0000-0000" inputMode="numeric" className={INPUT_CLS} />
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">PIN <span className="text-danger">*</span> (4자리)</label>
                <input value={newForm.pin} onChange={e => { setNewForm(f => ({ ...f, pin: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })); setAddPinError('') }}
                  placeholder="0000" maxLength={4} inputMode="numeric" className={INPUT_CLS + ' font-mono'} />
                {addPinError && <p className="text-[11px] text-danger font-semibold mt-1">{addPinError}</p>}
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">잔액 경고 기준</label>
                <input value={newForm.warnThreshold} onChange={e => setNewForm(f => ({ ...f, warnThreshold: e.target.value }))}
                  placeholder="30000" className={INPUT_CLS} />
              </div>
            </div>

            {/* 초기 잔액 */}
            <div className="mt-6 pt-5">
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-bold text-gray-text block mb-1">초기 잔액 (선택)</label>
                  <div className="flex items-baseline gap-2">
                    <input
                      value={newForm.initialDeposit}
                      onChange={e => {
                        const raw = e.target.value.replace(/[^0-9-]/g, '')
                        // 맨 앞 '-' 하나만 허용
                        const cleaned = raw.startsWith('-') ? '-' + raw.slice(1).replace(/-/g, '') : raw.replace(/-/g, '')
                        setNewForm(f => ({ ...f, initialDeposit: cleaned }))
                      }}
                      placeholder="예: 300000 또는 -15000"
                      inputMode="numeric"
                      className="flex-1 border-0 border-b-2 border-gray-border bg-transparent px-0 py-1.5 text-[16px] font-bold focus:outline-none focus:border-[#16a84c] transition-colors"
                    />
                    <span className="text-[11px] font-semibold text-gray-text flex-shrink-0">원</span>
                  </div>
                  {(() => {
                    const v = parseInt(newForm.initialDeposit.replace(/,/g, ''), 10)
                    if (!newForm.initialDeposit || isNaN(v) || v === 0) return null
                    return (
                      <p className={`text-[11px] font-bold mt-1 ${v < 0 ? 'text-danger' : 'text-green'}`}>
                        {v < 0 ? `미수금 -${won(Math.abs(v))}` : `잔액 ${won(v)}`}
                      </p>
                    )
                  })()}
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-text block mb-1">비고</label>
                  <input
                    value={newForm.initialDepositMemo}
                    onChange={e => setNewForm(f => ({ ...f, initialDepositMemo: e.target.value }))}
                    placeholder="예: 6월 선결제"
                    className={INPUT_CLS}
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2.5 mt-6">
              <button onClick={() => { setAddOpen(false); setAddPinError('') }}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-text font-bold hover:bg-gray-bg focus:outline-none">
                취소
              </button>
              <button
                onClick={handleAddAccount}
                disabled={!newForm.name.trim() || !newForm.manager.trim() || newForm.pin.length !== 4}
                className="flex-1 py-2.5 rounded-xl bg-[#16a84c] text-white font-bold hover:bg-[#128040] transition-colors focus:outline-none disabled:opacity-50">
                등록
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 정보 수정 모달 ── */}
      {editOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-[420px] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <div className="text-[17px] font-extrabold">정보 수정</div>
              <button onClick={() => setEditOpen(false)} className="text-gray-text hover:text-ink text-[18px]">✕</button>
            </div>
            <div className="space-y-5">
              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">거래처명 <span className="text-danger">*</span></label>
                <div className="relative">
                  <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value.slice(0, 25) }))}
                    maxLength={25} className={INPUT_CLS} />
                  <span className={`absolute right-2.5 bottom-2 text-[10px] ${editForm.name.length >= 25 ? 'text-danger' : 'text-gray-text'}`}>
                    {editForm.name.length}/25
                  </span>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-2">유형</label>
                <div className="flex gap-2">
                  {(['과', '기업', '개인', '기타'] as DbAccount['account_type'][]).map(t => (
                    <button key={t} onClick={() => setEditForm(f => ({ ...f, type: t }))}
                      className={`flex-1 py-1.5 rounded-full border text-[11px] font-bold transition-colors focus:outline-none
                        ${editForm.type === t ? 'border-[#16a84c] text-[#16a84c] bg-green-soft' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">기관명</label>
                <input value={editForm.org} onChange={e => setEditForm(f => ({ ...f, org: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">담당자 <span className="text-danger">*</span></label>
                <input value={editForm.manager} onChange={e => setEditForm(f => ({ ...f, manager: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">연락처</label>
                <input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: formatPhone(e.target.value) }))} inputMode="numeric" placeholder="010-0000-0000" className={INPUT_CLS} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">PIN <span className="text-danger">*</span> (4자리)</label>
                <input value={editForm.pin} onChange={e => { setEditForm(f => ({ ...f, pin: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) })); setEditPinError('') }}
                  maxLength={4} inputMode="numeric" className={INPUT_CLS + ' font-mono'} />
                {editPinError && <p className="text-[11px] text-danger font-semibold mt-1">{editPinError}</p>}
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">잔액 경고 기준</label>
                <input value={editForm.warnThreshold} onChange={e => setEditForm(f => ({ ...f, warnThreshold: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">선결제 잔액</label>
                <div className="flex items-baseline gap-2">
                  <input
                    value={editForm.balance}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9-]/g, '')
                      const cleaned = raw.startsWith('-') ? '-' + raw.slice(1).replace(/-/g, '') : raw.replace(/-/g, '')
                      setEditForm(f => ({ ...f, balance: cleaned }))
                    }}
                    inputMode="numeric"
                    className={INPUT_CLS + ' font-bold'}
                  />
                  <span className="text-[11px] font-semibold text-gray-text flex-shrink-0">원</span>
                </div>
                {(() => {
                  const v = parseInt(editForm.balance.replace(/,/g, ''), 10)
                  const delta = isNaN(v) ? 0 : v - selected.current_balance
                  if (isNaN(v) || delta === 0) return null
                  return (
                    <p className={`text-[11px] font-semibold mt-1 ${delta > 0 ? 'text-green' : 'text-danger'}`}>
                      {delta > 0 ? `▲ +${won(delta)} 증가` : `▼ ${won(delta)} 감소`}
                    </p>
                  )
                })()}
                {(() => {
                  const v = parseInt(editForm.balance.replace(/,/g, ''), 10)
                  const delta = isNaN(v) ? 0 : v - selected.current_balance
                  if (isNaN(v) || delta === 0) return null
                  return (
                    <div className="mt-2">
                      <label className="text-[11px] font-bold text-gray-text block mb-1">수정 사유 <span className="text-gray-400 text-[10px] font-normal">(필수)</span></label>
                      <input
                        value={editForm.adjustReason}
                        onChange={e => setEditForm(f => ({ ...f, adjustReason: e.target.value }))}
                        placeholder="예: 이전 잔액 이월, 오류 수정 등"
                        className={INPUT_CLS + ' text-[11px]'}
                      />
                    </div>
                  )
                })()}
              </div>
            </div>
            <div className="flex gap-2.5 mt-6">
              <button onClick={() => { setEditOpen(false); setEditPinError('') }} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-text font-bold hover:bg-gray-bg focus:outline-none">취소</button>
              <button onClick={handleEditAccount}
                disabled={(() => {
                  if (!editForm.name.trim() || !editForm.manager.trim() || editForm.pin.length !== 4) return true
                  const v = parseInt(editForm.balance.replace(/,/g, ''), 10)
                  const delta = isNaN(v) ? 0 : v - (selected?.current_balance ?? 0)
                  if (delta !== 0 && !editForm.adjustReason.trim()) return true
                  return false
                })()}
                className="flex-1 py-2.5 rounded-xl bg-[#16a84c] text-white font-bold hover:bg-[#128040] transition-colors focus:outline-none disabled:opacity-50">
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 키오스크 QR 모달 ── */}
      {kioskQr && <KioskQrModal storeId={storeId} onClose={() => setKioskQr(false)} />}

      {/* ── 거래처 고유 QR 모달 ── */}
      {accountQr && (
        <AccountQrModal
          accountCode={accountQr}
          accountName={accounts.find(a => a.account_code === accountQr)?.account_name ?? ''}
          storeId={storeId}
          onClose={() => setAccountQr(null)}
        />
      )}

      {/* ── 충전 등록 모달 ── */}
      {chargeOpen && selected && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-[380px]">

            {!chargeConfirm ? (
              /* ── 1단계: 입력 ── */
              <>
                <div className="text-[17px] font-extrabold mb-1">충전 등록</div>
                <div className="text-[11px] text-gray-text mb-5">{selected.account_name}</div>

                {/* 금액 */}
                <div className="mb-4">
                  <label className="text-[11px] font-bold text-gray-text mb-1.5 block">충전 금액</label>
                  <div className="relative">
                    <input
                      value={chargeAmt ? Number(chargeAmt).toLocaleString('ko-KR') : ''}
                      onChange={e => setChargeAmt(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="0" inputMode="numeric"
                      className="w-full border border-gray-border rounded-lg pl-3 pr-8 py-2 text-[13px] font-bold text-ink focus:outline-none transition-colors" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-gray-text pointer-events-none">원</span>
                  </div>
                </div>

                {/* 결제수단 */}
                <div className="mb-4">
                  <label className="text-[11px] font-bold text-gray-text mb-2 block">결제수단</label>
                  <div className="flex flex-wrap gap-1.5">
                    {(['신용카드','법인카드','계좌이체','무통장입금','현금','기타']).map(m => (
                      <button key={m} onClick={() => setChargeMethod(m)}
                        className={`px-3 py-1.5 rounded-full border text-[11px] font-semibold transition-colors focus:outline-none
                          ${chargeMethod === m ? 'border-green bg-green-soft text-green' : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 선결제 일시 */}
                <div className="mb-4">
                  <label className="text-[11px] font-bold text-gray-text mb-1 block">선결제 일시 <span className="font-normal text-gray-text">(실제 결제한 날짜·시간)</span></label>
                  <div className="flex gap-2">
                    <input type="date" value={chargeDate} onChange={e => setChargeDate(e.target.value)}
                      max={new Date().toLocaleDateString('en-CA')}
                      className="flex-1 border border-gray-border rounded-lg px-3 py-2 text-[11px] focus:outline-none focus:border-green" />
                    <input type="time" value={chargeTime} onChange={e => setChargeTime(e.target.value)}
                      className="w-[110px] border border-gray-border rounded-lg px-3 py-2 text-[11px] focus:outline-none focus:border-green" />
                  </div>
                </div>

                {/* 비고 */}
                <div className="mb-5">
                  <label className="text-[11px] font-bold text-gray-text mb-1 block">비고 (선택)</label>
                  <input value={chargeMemo} onChange={e => setChargeMemo(e.target.value)}
                    placeholder="예: 7월 법인카드" className={INPUT_CLS} />
                </div>

                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setChargeOpen(false); setChargeError('') }}
                    className="px-4 py-1.5 rounded-lg bg-gray-100 text-gray-text text-[11px] font-semibold hover:bg-gray-200 focus:outline-none transition-colors">
                    취소
                  </button>
                  <button
                    onClick={() => setChargeConfirm(true)}
                    disabled={!chargeAmt || parseInt(chargeAmt) <= 0}
                    className="px-4 py-1.5 rounded-lg bg-ink text-white text-[11px] font-semibold hover:bg-ink/80 transition-colors focus:outline-none disabled:opacity-50">
                    다음
                  </button>
                </div>
              </>
            ) : (
              /* ── 2단계: 최종 확인 ── */
              <>
                <div className="text-[17px] font-extrabold mb-1">충전 내용 확인</div>
                <div className="text-[11px] text-gray-text mb-5">등록 후 금액 수정은 불가합니다. 내용을 꼼꼼히 확인해주세요.</div>

                <div className="bg-gray-bg rounded-xl p-4 space-y-3 mb-5">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-text">거래처</span>
                    <span className="text-[11px] font-bold text-ink">{selected.account_name}</span>
                  </div>
                  <div className="flex justify-between items-center border-t border-gray-border pt-3">
                    <span className="text-[11px] text-gray-text">충전 금액</span>
                    <span className="text-[18px] font-extrabold text-ink">+{won(parseInt(chargeAmt))}</span>
                  </div>
                  <div className="flex justify-between items-center border-t border-gray-border pt-3">
                    <span className="text-[11px] text-gray-text">결제수단</span>
                    <span className="text-[11px] font-semibold text-ink">{chargeMethod}</span>
                  </div>
                  <div className="flex justify-between items-center border-t border-gray-border pt-3">
                    <span className="text-[11px] text-gray-text">선결제 일시</span>
                    <span className="text-[11px] font-semibold text-ink">{chargeDate} {chargeTime}</span>
                  </div>
                  {chargeMemo && (
                    <div className="flex justify-between items-center border-t border-gray-border pt-3">
                      <span className="text-[11px] text-gray-text">비고</span>
                      <span className="text-[11px] font-semibold text-ink">{chargeMemo}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center border-t border-gray-border pt-3">
                    <span className="text-[11px] text-gray-text">충전 후 잔액</span>
                    <span className="text-[11px] font-bold text-ink">{won(selected.current_balance + parseInt(chargeAmt))}</span>
                  </div>
                </div>

                {chargeError && (
                  <p className="text-[11px] text-danger font-semibold mb-3">{chargeError}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setChargeConfirm(false); setChargeError('') }}
                    className="px-4 py-1.5 rounded-lg bg-gray-100 text-gray-text text-[11px] font-semibold hover:bg-gray-200 focus:outline-none transition-colors">
                    취소
                  </button>
                  <button
                    onClick={handleCharge}
                    disabled={chargeLoading}
                    className="px-4 py-1.5 rounded-lg bg-[#16a84c] text-white text-[11px] font-semibold hover:bg-[#128040] transition-colors focus:outline-none disabled:opacity-50">
                    {chargeLoading ? '처리 중...' : '충전 확정'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-text">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  )
}

function AccountQrModal({ accountCode, accountName, storeId, onClose }: { accountCode: string; accountName: string; storeId: string; onClose: () => void }) {
  const url = `${BASE_URL}?store=${storeId}&account=${accountCode}`
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
      <div className="bg-white rounded-2xl shadow-xl p-6 w-[340px]">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[17px] font-extrabold">거래처 전용 QR</div>
          <button onClick={onClose} className="text-gray-text hover:text-ink text-[18px]">✕</button>
        </div>
        <div className="text-[11px] text-gray-text mb-4">
          <span className="font-semibold text-ink">{accountName}</span> 고객 전용 링크입니다.<br />
          스캔하면 PIN 없이 바로 주문자 입력으로 진입합니다.
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
            className="flex-1 py-2.5 rounded-xl font-bold text-[11px] border border-gray-border text-ink hover:bg-gray-bg transition-colors disabled:opacity-40">
            이미지 저장
          </button>
          <button onClick={copy}
            className={`flex-1 py-2.5 rounded-xl font-bold text-[11px] transition-colors
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
      <div className="bg-white rounded-2xl shadow-xl p-6 w-[340px]">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[17px] font-extrabold">키오스크 공용 QR</div>
          <button onClick={onClose} className="text-gray-text hover:text-ink text-[18px]">✕</button>
        </div>
        <div className="text-[11px] text-gray-text mb-4">
          누구나 거래처를 선택하고 PIN을 입력해 주문할 수 있는 공용 링크입니다.
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
            className="flex-1 py-2.5 rounded-xl font-bold text-[11px] border border-gray-border text-ink hover:bg-gray-bg transition-colors disabled:opacity-40">
            이미지 저장
          </button>
          <button onClick={copy}
            className={`flex-1 py-2.5 rounded-xl font-bold text-[11px] transition-colors
              ${copied ? 'bg-green-soft text-green' : 'bg-ink text-white hover:bg-ink/90'}`}>
            {copied ? '✓ 복사됨' : '링크 복사'}
          </button>
        </div>
      </div>
    </div>
  )
}
