import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { supabase, type DbAccount, type DbDeposit } from '../lib/supabase'
import { won } from '../lib/ipc'
import { useStore } from '../lib/store-context'
import type { Order, OrderStatus } from '../lib/mock-data'

const BASE_URL = 'https://sallaria.web.app'

function useQrDataUrl(url: string) {
  const [dataUrl, setDataUrl] = useState('')
  useEffect(() => {
    QRCode.toDataURL(url, { width: 200, margin: 1, color: { dark: '#1E1E1E', light: '#FFFFFF' } })
      .then(setDataUrl)
  }, [url])
  return dataUrl
}

const TYPE_BADGE: Record<string, string> = {
  '과':  'bg-blue-100 text-blue-700',
  '기업': 'bg-purple-100 text-purple-700',
  '개인': 'bg-green-soft text-green',
  '기타': 'bg-gray-100 text-gray-text',
}

const DB_METHOD_MAP: Record<string, string> = { '내점': '매장 식사', '포장': '포장', '배달': '배달' }

const INPUT_CLS = 'w-full border-0 border-b border-gray-border bg-transparent px-0 py-2 text-[14px] focus:outline-none focus:border-b-2 focus:border-[#16a84c] transition-colors'

function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 7) return `${d.slice(0,3)}-${d.slice(3)}`
  return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`
}

export default function Customers() {
  const { storeId } = useStore()
  const [accounts,     setAccounts]     = useState<DbAccount[]>([])
  const [selected,     setSelected]     = useState<DbAccount | null>(null)
  const [accountOrders, setAccountOrders] = useState<Order[]>([])
  const [deposits,     setDeposits]     = useState<DbDeposit[]>([])
  const [monthlyUsage, setMonthlyUsage] = useState<Record<string, number>>({})
  const [loading,      setLoading]      = useState(true)
  const [pinVisible,   setPinVisible]   = useState<string | null>(null)
  const [chargeOpen,   setChargeOpen]   = useState(false)
  const [chargeAmt,    setChargeAmt]    = useState('')
  const [chargeMemo,   setChargeMemo]   = useState('')
  const [search,       setSearch]       = useState('')
  const [kioskQr,      setKioskQr]      = useState(false)
  const [accountQr,    setAccountQr]    = useState<string | null>(null) // account_code
  const [detailTab,    setDetailTab]    = useState<'orders' | 'charges'>('orders')
  const [orderPage,    setOrderPage]    = useState(0)
  const [chargePage,   setChargePage]   = useState(0)

  const PAGE_SIZE = 5
  const [addOpen,      setAddOpen]      = useState(false)
  const [newForm,      setNewForm]      = useState({
    name: '', type: '과' as DbAccount['account_type'], org: '', manager: '', phone: '', pin: '', warnThreshold: '30000',
    initialDeposit: '', initialDepositMemo: '',
  })
  const [editOpen,     setEditOpen]     = useState(false)
  const [editForm,     setEditForm]     = useState({
    name: '', type: '과' as DbAccount['account_type'], org: '', manager: '', phone: '', pin: '', warnThreshold: '30000',
  })
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [addPinError,  setAddPinError]  = useState('')
  const [editPinError, setEditPinError] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  // ── 거래처 목록 조회 ──────────────────────────────────────────────────────────
  async function fetchAccounts(inactive = false) {
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('is_active', !inactive)
      .eq('store_id', storeId)
      .order('account_name')
    if (!error && data) setAccounts(data as DbAccount[])
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
        ordered_at, total_amount, method, status, note,
        accounts ( account_name ),
        order_items (
          menu_name, quantity, unit_price,
          order_item_options ( option_name )
        )
      `)
      .eq('account_code', accountCode)
      .order('ordered_at', { ascending: false })
      .limit(30)

    setAccountOrders((data ?? []).map((row: any) => ({
      code:        row.order_code,
      accountName: row.accounts?.account_name ?? '',
      orderer:     row.orderer_name,
      phone:       row.orderer_phone ?? undefined,
      method:      (DB_METHOD_MAP[row.method] ?? row.method) as Order['method'],
      status:      row.status as OrderStatus,
      items:       (row.order_items ?? []).map((item: any) => ({
        name:    item.menu_name,
        qty:     item.quantity,
        price:   item.unit_price,
        options: (item.order_item_options ?? []).map((o: any) => o.option_name as string),
      })),
      total:    row.total_amount,
      prepMins: 0,
      createdAt: row.ordered_at,
      remarks:   row.note ?? '',
    })))
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

  // ── 마운트 / showInactive 변경 시 목록 재조회 ────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      setSelected(null)
      setDeleteConfirm(false)
      await Promise.all([fetchAccounts(showInactive), fetchMonthlyUsages()])
      setLoading(false)
    }
    load()
  }, [showInactive])

  // ── 선택 거래처 변경 시 이력 로딩 ─────────────────────────────────────────────
  useEffect(() => {
    if (!selected) return
    fetchAccountOrders(selected.account_code)
    fetchDeposits(selected.account_code)
    setOrderPage(0)
    setChargePage(0)
  }, [selected?.account_code])

  const filtered = accounts.filter(a =>
    a.account_name.includes(search) ||
    (a.organization_name ?? '').includes(search) ||
    (a.contact_person ?? '').includes(search)
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
        current_balance:   isNaN(initialBalance) ? 0 : initialBalance,
      })
      .select('account_code')
      .single()

    if (error) {
      console.error('거래처 추가 실패:', error)
      return
    }

    // 초기 잔액이 양수인 경우 충전 이력에도 기록
    if (newAccount && !isNaN(initialBalance) && initialBalance > 0) {
      const { error: depErr } = await supabase.rpc('add_deposit', {
        p_account_code: newAccount.account_code,
        p_amount:       initialBalance,
        p_note:         newForm.initialDepositMemo.trim() || '초기 잔액 등록',
      })
      if (depErr) console.error('초기 충전 이력 기록 실패:', depErr)
    }

    await fetchAccounts()
    setNewForm({ name: '', type: '과', org: '', manager: '', phone: '', pin: '', warnThreshold: '30000', initialDeposit: '', initialDepositMemo: '' })
    setAddPinError('')
    setAddOpen(false)
  }

  // ── 충전 등록 ─────────────────────────────────────────────────────────────────
  async function handleCharge() {
    const amt = parseInt(chargeAmt.replace(/,/g, ''), 10)
    if (isNaN(amt) || amt <= 0 || !selected) return

    const { error } = await supabase.rpc('add_deposit', {
      p_account_code: selected.account_code,
      p_amount:       amt,
      p_note:         chargeMemo || null,
    })

    if (error) {
      console.error('충전 실패:', error)
      return
    }

    await Promise.all([fetchAccounts(), fetchDeposits(selected.account_code)])
    // 선택된 계좌의 잔액을 로컬에서도 즉시 반영
    setSelected(prev => prev ? { ...prev, current_balance: prev.current_balance + amt } : prev)
    setChargeOpen(false)
    setChargeAmt('')
    setChargeMemo('')
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
      warnThreshold: String(selected.warning_threshold),
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
      })
      .eq('account_code', selected.account_code)
    if (error) { console.error('수정 실패:', error); return }
    await fetchAccounts()
    setSelected(prev => prev ? {
      ...prev,
      account_name:      editForm.name.trim(),
      account_type:      editForm.type,
      organization_name: editForm.org.trim() || null,
      contact_person:    editForm.manager.trim(),
      contact_phone:     editForm.phone.trim() || null,
      pin_code:          editForm.pin.trim(),
      warning_threshold: parseInt(editForm.warnThreshold.replace(/,/g, ''), 10) || 30000,
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
    await fetchAccounts(showInactive)
    setSelected(null)
    setDeleteConfirm(false)
  }

  // ── 거래처 복구 ───────────────────────────────────────────────────────────────
  async function handleRestoreAccount() {
    if (!selected) return
    const { error } = await supabase
      .from('accounts')
      .update({ is_active: true })
      .eq('account_code', selected.account_code)
    if (error) { console.error('복구 실패:', error); return }
    await fetchAccounts(showInactive)
    setSelected(null)
  }

  return (
    <div className="h-full flex overflow-hidden bg-white">

      {/* ── 테이블 영역 ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-gray-border flex-shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-[20px] font-extrabold">고객관리</div>
            <button
              onClick={() => setShowInactive(v => !v)}
              className={`px-3 py-1 rounded-full text-[12px] font-bold border transition-colors ${
                showInactive
                  ? 'border-danger text-danger bg-red-50'
                  : 'border-gray-border text-gray-text hover:bg-gray-bg'
              }`}
            >
              {showInactive ? '비활성 거래처' : '비활성 보기'}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="거래처명, 담당자 검색"
              className="border border-gray-border rounded-lg px-3 py-2 text-[13px] w-52 focus:outline-none focus:border-[#16a84c] focus:bg-green-soft transition-colors"
            />
            <button
              onClick={() => setKioskQr(true)}
              className="px-4 py-2 bg-gray-100 rounded-lg text-[13px] font-bold hover:bg-gray-100 transition-colors"
            >
              🖨 키오스크 QR
            </button>
            {!showInactive && (
              <button
                onClick={() => setAddOpen(true)}
                className="px-4 py-2 bg-[#16a84c] text-white rounded-lg text-[13px] font-bold hover:bg-[#128040] transition-colors"
              >
                + 거래처 추가
              </button>
            )}
          </div>
        </div>

        {/* 테이블 헤더 */}
        <div className="grid grid-cols-[1fr_60px_80px_110px_80px_80px_90px] px-6 py-2 bg-gray-bg text-[11px] font-bold text-gray-text uppercase tracking-wide border-b border-gray-border flex-shrink-0">
          <span>거래처명</span><span>유형</span><span>담당자</span>
          <span>연락처</span><span>PIN</span><span>현재잔액</span><span>이번달</span>
        </div>

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-border">
          {loading ? (
            <div className="h-full flex items-center justify-center text-gray-text text-[13px]">
              <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin mr-2" />
              불러오는 중...
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-text text-[13px]">
              {search ? '검색 결과가 없습니다' : showInactive ? '비활성 거래처가 없습니다' : '등록된 거래처가 없습니다'}
            </div>
          ) : (
            filtered.map(acc => (
              <button
                key={acc.account_code}
                onClick={() => setSelected(acc)}
                className="w-full grid grid-cols-[1fr_60px_80px_110px_80px_80px_90px] px-6 py-3 text-left hover:bg-gray-bg transition-colors text-[13px]"
              >
                <span className="font-semibold text-ink">{acc.account_name}</span>
                <span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${TYPE_BADGE[acc.account_type]}`}>
                    {acc.account_type}
                  </span>
                </span>
                <span className="text-gray-text">{acc.contact_person ?? '—'}</span>
                <span className="text-gray-text font-mono text-[12px]">{acc.contact_phone ?? '—'}</span>
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
                <span className={`font-bold ${acc.current_balance < acc.warning_threshold ? 'text-danger' : 'text-ink'}`}>
                  {won(acc.current_balance)}
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
          <div className="bg-white rounded-2xl shadow-xl w-[540px] max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>

            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="text-[18px] font-extrabold text-ink">{selected.account_name}</div>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${TYPE_BADGE[selected.account_type]}`}>
                  {selected.account_type}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {!showInactive && (
                  <button onClick={openEdit} className="px-3 py-1.5 rounded-lg border border-gray-border text-[12px] font-bold text-gray-text hover:bg-gray-bg transition-colors">
                    정보 수정
                  </button>
                )}
                <button onClick={() => { setSelected(null); setDeleteConfirm(false) }} className="text-gray-text hover:text-ink text-[18px] ml-1">✕</button>
              </div>
            </div>

            {/* 스크롤 영역 */}
            <div className="overflow-y-auto px-6 pb-6 flex-1">

              {/* 잔액 카드 */}
              <div className={`rounded-xl p-4 mb-5 text-center ${selected.current_balance < selected.warning_threshold ? 'bg-red-50 border border-danger/30' : 'bg-green-soft'}`}>
                <div className="text-[11px] font-semibold text-gray-text mb-1">현재 선결제 잔액</div>
                <div className={`text-[32px] font-extrabold ${selected.current_balance < selected.warning_threshold ? 'text-danger' : 'text-green'}`}>
                  {won(selected.current_balance)}
                </div>
                {selected.current_balance < selected.warning_threshold && (
                  <div className="text-[11px] text-danger font-semibold mt-1">⚠ 잔액 부족</div>
                )}
              </div>

              {/* 상세 정보 2열 그리드 */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-5 text-[13px]">
                <InfoRow label="담당자"       value={selected.contact_person ?? '—'} />
                <InfoRow label="연락처"       value={selected.contact_phone ?? '—'} />
                <InfoRow label="기관명"       value={selected.organization_name ?? '—'} />
                <InfoRow label="PIN"          value={selected.pin_code} />
                <InfoRow label="잔액 경고 기준" value={won(selected.warning_threshold)} />
                <InfoRow label="이번달 사용액"  value={won(monthlyUsage[selected.account_code] ?? 0)} />
              </div>

              {/* QR + 충전 버튼 */}
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => setAccountQr(selected.account_code)}
                  className="flex-1 py-3 bg-gray-100 text-ink rounded-xl font-bold text-[14px] hover:bg-gray-200 transition-colors"
                >
                  🔲 QR 보기
                </button>
                <button
                  onClick={() => setChargeOpen(true)}
                  className="flex-[2] py-3 bg-[#16a84c] text-white rounded-xl font-bold text-[14px] hover:bg-[#128040] transition-colors"
                >
                  💳 충전 등록
                </button>
              </div>

              {/* 이력 탭 */}
              <div className="flex gap-0 border-b border-gray-border mb-3">
                {(['orders', 'charges'] as const).map(t => (
                  <button key={t} onClick={() => { setDetailTab(t); setOrderPage(0); setChargePage(0) }}
                    className={`px-4 py-2 text-[12px] font-bold border-b-2 transition-colors
                      ${detailTab === t ? 'border-[#16a84c] text-[#16a84c]' : 'border-transparent text-gray-text hover:text-ink'}`}>
                    {t === 'orders' ? '주문 내역' : '충전 이력'}
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
                        ? <div className="text-[13px] text-gray-text py-2">주문 이력 없음</div>
                        : slice.map(o => {
                            const dt = new Date(o.createdAt)
                            const DAY = ['일','월','화','수','목','금','토']
                            const dateStr = dt.toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' })
                            const timeStr = dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
                            const dow = DAY[dt.getDay()]
                            return (
                              <div key={o.code} className="bg-gray-bg rounded-lg px-3 py-2.5 text-[12px]">
                                <div className="flex justify-between items-start mb-1">
                                  <span className="text-gray-text">{dateStr} ({dow}) {timeStr} · {o.method}</span>
                                  <span className="font-bold text-ink">{won(o.total)}</span>
                                </div>
                                <div className="flex justify-between items-end">
                                  <span className="font-semibold text-ink leading-snug">{o.items.map(i => i.name).join(', ')}</span>
                                  <StatusTag status={o.status} />
                                </div>
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
                const total = deposits.length
                const pages = Math.ceil(total / PAGE_SIZE)
                const slice = deposits.slice(chargePage * PAGE_SIZE, (chargePage + 1) * PAGE_SIZE)
                return (
                  <div>
                    <div className="space-y-2">
                      {total === 0
                        ? <div className="text-[13px] text-gray-text py-2">충전 이력 없음</div>
                        : slice.map(d => (
                            <div key={d.deposit_id} className="bg-gray-bg rounded-lg px-3 py-2.5 flex justify-between items-center text-[12px]">
                              <div>
                                <div className="font-semibold text-ink">{won(d.amount)}</div>
                                <div className="text-gray-text">
                                  {(() => {
                                    const dt = new Date(d.created_at)
                                    const DAY = ['일','월','화','수','목','금','토']
                                    const date = dt.toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' })
                                    const time = dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
                                    const dow  = DAY[dt.getDay()]
                                    return `${date} (${dow}) ${time}`
                                  })()}
                                  {d.note ? ` · ${d.note}` : ''}
                                </div>
                              </div>
                              <span className="text-[10px] font-bold text-green bg-green-soft px-2 py-0.5 rounded-full">충전</span>
                            </div>
                          ))
                      }
                    </div>
                    {pages > 1 && (
                      <div className="flex items-center justify-center gap-2 mt-3">
                        <button onClick={() => setChargePage(p => p - 1)} disabled={chargePage === 0}
                          className="px-2 py-1 text-[11px] font-bold rounded border border-gray-border text-gray-text disabled:opacity-30 hover:bg-gray-bg">
                          ‹ 이전
                        </button>
                        <span className="text-[11px] text-gray-text">{chargePage + 1} / {pages}</span>
                        <button onClick={() => setChargePage(p => p + 1)} disabled={chargePage >= pages - 1}
                          className="px-2 py-1 text-[11px] font-bold rounded border border-gray-border text-gray-text disabled:opacity-30 hover:bg-gray-bg">
                          다음 ›
                        </button>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* 삭제 / 복구 — 맨 하단 */}
              <div className="pt-5 mt-5 border-t border-gray-border">
                {showInactive ? (
                  <button onClick={handleRestoreAccount} className="w-full py-2.5 rounded-xl text-[13px] font-bold text-[#16a84c] hover:bg-green-soft transition-colors border border-[#16a84c]/30 focus:outline-none">
                    거래처 복구
                  </button>
                ) : !deleteConfirm ? (
                  <button onClick={() => setDeleteConfirm(true)} className="w-full py-2.5 rounded-xl text-[13px] font-bold text-danger hover:bg-red-50 transition-colors border border-danger/30 focus:outline-none">
                    거래처 삭제
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="mb-5">
                      <p className="text-[12px] text-center text-ink font-semibold leading-tight">정말 삭제하시겠어요?</p>
                      <p className="text-[11px] text-center text-gray-text leading-tight mt-0.5">추후 복구할 수 있어요.</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setDeleteConfirm(false)} className="flex-1 py-2 rounded-xl text-[13px] font-bold bg-gray-100 text-gray-text hover:bg-gray-200 focus:outline-none">취소</button>
                      <button onClick={handleDeleteAccount} className="flex-1 py-2 rounded-xl text-[13px] font-bold bg-danger text-white hover:bg-red-700 focus:outline-none">삭제 확인</button>
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
                <input value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="예: 북구청 공원녹지과" className={INPUT_CLS} />
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-2">유형</label>
                <div className="flex gap-2">
                  {(['과', '기업', '개인', '기타'] as DbAccount['account_type'][]).map(t => (
                    <button key={t} onClick={() => setNewForm(f => ({ ...f, type: t }))}
                      className={`flex-1 py-1.5 rounded-full border text-[12px] font-bold transition-colors focus:outline-none
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
                    <span className="text-[13px] font-semibold text-gray-text flex-shrink-0">원</span>
                  </div>
                  {(() => {
                    const v = parseInt(newForm.initialDeposit.replace(/,/g, ''), 10)
                    if (!newForm.initialDeposit || isNaN(v) || v === 0) return null
                    return (
                      <p className={`text-[13px] font-bold mt-1 ${v < 0 ? 'text-danger' : 'text-green'}`}>
                        {v < 0 ? `미수금 ${won(Math.abs(v))}` : `잔액 ${won(v)}`}
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

            <div className="flex gap-3 mt-6">
              <button onClick={() => { setAddOpen(false); setAddPinError('') }}
                className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-text font-bold hover:bg-gray-bg focus:outline-none">
                취소
              </button>
              <button
                onClick={handleAddAccount}
                disabled={!newForm.name.trim() || !newForm.manager.trim() || newForm.pin.length !== 4}
                className="flex-1 py-3 rounded-xl bg-[#16a84c] text-white font-bold hover:bg-[#128040] transition-colors focus:outline-none disabled:opacity-50">
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
                <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-2">유형</label>
                <div className="flex gap-2">
                  {(['과', '기업', '개인', '기타'] as DbAccount['account_type'][]).map(t => (
                    <button key={t} onClick={() => setEditForm(f => ({ ...f, type: t }))}
                      className={`flex-1 py-1.5 rounded-full border text-[12px] font-bold transition-colors focus:outline-none
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
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setEditOpen(false); setEditPinError('') }} className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-text font-bold hover:bg-gray-bg focus:outline-none">취소</button>
              <button onClick={handleEditAccount}
                disabled={!editForm.name.trim() || !editForm.manager.trim() || editForm.pin.length !== 4}
                className="flex-1 py-3 rounded-xl bg-[#16a84c] text-white font-bold hover:bg-[#128040] transition-colors focus:outline-none disabled:opacity-50">
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
          <div className="bg-white rounded-2xl shadow-xl p-6 w-[360px]">
            <div className="text-[17px] font-extrabold mb-1">충전 등록</div>
            <div className="text-[13px] text-gray-text mb-5">{selected.account_name}</div>
            <div className="mb-4">
              <label className="text-[11px] font-bold text-gray-text mb-1 block">충전 금액</label>
              <div className="flex items-baseline gap-2">
                <input value={chargeAmt} onChange={e => setChargeAmt(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="300000"
                  inputMode="numeric"
                  className="flex-1 border-0 border-b-2 border-gray-border bg-transparent px-0 py-2 text-[18px] font-bold focus:outline-none focus:border-[#16a84c] transition-colors" />
                <span className="text-[15px] font-semibold text-gray-text flex-shrink-0">원</span>
              </div>
            </div>
            <div className="mb-5">
              <label className="text-[11px] font-bold text-gray-text mb-1 block">비고 (선택)</label>
              <input value={chargeMemo} onChange={e => setChargeMemo(e.target.value)}
                placeholder="예: 6월 충전" className={INPUT_CLS} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setChargeOpen(false)}
                className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-text font-bold hover:bg-gray-bg focus:outline-none">
                취소
              </button>
              <button
                onClick={handleCharge}
                disabled={!chargeAmt || parseInt(chargeAmt) <= 0}
                className="flex-1 py-3 rounded-xl bg-[#16a84c] text-white font-bold hover:bg-[#128040] transition-colors focus:outline-none disabled:opacity-50">
                등록
              </button>
            </div>
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
        <div className="text-[13px] text-gray-text mb-4">
          <span className="font-semibold text-ink">{accountName}</span> 고객 전용 링크입니다.<br />
          스캔하면 PIN 없이 바로 주문자 입력으로 진입합니다.
        </div>
        {qrDataUrl ? (
          <div className="flex flex-col items-center mb-4">
            <img src={qrDataUrl} alt="Account QR" className="w-[200px] h-[200px] rounded-xl border border-gray-border mb-3" />
            <div className="text-[11px] font-mono text-gray-text break-all text-center">{url}</div>
          </div>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-gray-text text-[12px]">QR 생성 중…</div>
        )}
        <div className="flex gap-2">
          <button onClick={saveImage} disabled={!qrDataUrl}
            className="flex-1 py-3 rounded-xl font-bold text-[14px] border border-gray-border text-ink hover:bg-gray-bg transition-colors disabled:opacity-40">
            이미지 저장
          </button>
          <button onClick={copy}
            className={`flex-1 py-3 rounded-xl font-bold text-[14px] transition-colors
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
        <div className="text-[13px] text-gray-text mb-4">
          누구나 거래처를 선택하고 PIN을 입력해 주문할 수 있는 공용 링크입니다.
        </div>
        {qrDataUrl ? (
          <div className="flex flex-col items-center mb-4">
            <img src={qrDataUrl} alt="Kiosk QR" className="w-[200px] h-[200px] rounded-xl border border-gray-border mb-3" />
            <div className="text-[11px] font-mono text-gray-text break-all text-center px-2">{url}</div>
          </div>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-gray-text text-[12px]">QR 생성 중…</div>
        )}
        <div className="flex gap-2">
          <button onClick={saveImage} disabled={!qrDataUrl}
            className="flex-1 py-3 rounded-xl font-bold text-[14px] border border-gray-border text-ink hover:bg-gray-bg transition-colors disabled:opacity-40">
            이미지 저장
          </button>
          <button onClick={copy}
            className={`flex-1 py-3 rounded-xl font-bold text-[14px] transition-colors
              ${copied ? 'bg-green-soft text-green' : 'bg-ink text-white hover:bg-ink/90'}`}>
            {copied ? '✓ 복사됨' : '링크 복사'}
          </button>
        </div>
      </div>
    </div>
  )
}
