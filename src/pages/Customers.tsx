import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { MOCK_ACCOUNTS, MOCK_ORDERS, type Account } from '../lib/mock-data'
import { won } from '../lib/ipc'

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

const INPUT_CLS = 'w-full border-0 border-b border-gray-border bg-transparent px-0 py-2 text-[14px] focus:outline-none focus:border-b-2 focus:border-[#16a84c] transition-colors'

export default function Customers() {
  const [accounts,    setAccounts]   = useState<Account[]>(MOCK_ACCOUNTS)
  const [selected,    setSelected]   = useState<Account | null>(null)
  const [pinVisible,  setPinVisible] = useState<string | null>(null)
  const [chargeOpen,  setChargeOpen] = useState(false)
  const [chargeAmt,   setChargeAmt]  = useState('')
  const [chargeMemo,  setChargeMemo] = useState('')
  const [search,      setSearch]     = useState('')
  const [kioskQr,     setKioskQr]    = useState(false)
  const [copied,      setCopied]     = useState<string | null>(null)
  const [detailTab,   setDetailTab]  = useState<'orders' | 'charges'>('orders')
  const [addOpen,     setAddOpen]    = useState(false)
  const [newForm,     setNewForm]    = useState({
    name: '', type: '과' as Account['type'], org: '', manager: '', phone: '', pin: '', warnThreshold: '30000',
  })

  const MOCK_DEPOSITS: Record<string, { date: string; amount: number; memo: string }[]> = {
    A001: [
      { date: '2026-06-01', amount: 300000, memo: '6월 충전' },
      { date: '2026-05-02', amount: 200000, memo: '5월 충전' },
    ],
    A002: [{ date: '2026-06-03', amount: 500000, memo: '상반기 충전' }],
    A003: [{ date: '2026-05-10', amount: 150000, memo: '' }],
    A004: [{ date: '2026-04-15', amount: 100000, memo: '4월 충전' }],
    A005: [{ date: '2026-06-07', amount: 80000,  memo: '' }],
  }

  const filtered = accounts.filter(a =>
    a.name.includes(search) || a.org.includes(search) || a.manager.includes(search)
  )

  const selectedOrders = selected
    ? MOCK_ORDERS.filter(o => o.accountName === selected.name)
    : []

  function copyLink(url: string, key: string) {
    navigator.clipboard.writeText(url)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  function handleAddAccount() {
    if (!newForm.name.trim() || !newForm.manager.trim() || !newForm.pin.trim()) return
    const code = `A${String(accounts.length + 1).padStart(3, '0')}`
    setAccounts(prev => [...prev, {
      code,
      name: newForm.name.trim(),
      type: newForm.type,
      org: newForm.org.trim(),
      manager: newForm.manager.trim(),
      phone: newForm.phone.trim(),
      pin: newForm.pin.trim(),
      balance: 0,
      monthlyUsage: 0,
      warnThreshold: parseInt(newForm.warnThreshold.replace(/,/g, ''), 10) || 30000,
    }])
    setNewForm({ name: '', type: '과', org: '', manager: '', phone: '', pin: '', warnThreshold: '30000' })
    setAddOpen(false)
  }

  function handleCharge() {
    const amt = parseInt(chargeAmt.replace(/,/g, ''), 10)
    if (isNaN(amt) || amt <= 0 || !selected) return
    setAccounts(prev => prev.map(a =>
      a.code === selected.code ? { ...a, balance: a.balance + amt } : a
    ))
    setSelected(prev => prev ? { ...prev, balance: prev.balance + amt } : prev)
    setChargeOpen(false)
    setChargeAmt('')
    setChargeMemo('')
  }

  return (
    <div className="h-full flex overflow-hidden bg-white">

      {/* ── 테이블 영역 ── */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-border">

        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-gray-border flex-shrink-0 flex items-center justify-between">
          <div className="text-[20px] font-extrabold">고객관리</div>
          <div className="flex items-center gap-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="거래처명, 담당자 검색"
              className="border border-gray-border rounded-lg px-3 py-2 text-[13px] w-52 focus:outline-none focus:border-[#16a84c] focus:bg-green-soft transition-colors"
            />
            <button
              onClick={() => setKioskQr(true)}
              className="px-4 py-2 bg-gray-bg border border-gray-border rounded-lg text-[13px] font-bold hover:bg-gray-100 transition-colors"
            >
              🖨 키오스크 QR
            </button>
            <button
              onClick={() => setAddOpen(true)}
              className="px-4 py-2 bg-[#16a84c] text-white rounded-lg text-[13px] font-bold hover:bg-[#128040] transition-colors"
            >
              + 거래처 추가
            </button>
          </div>
        </div>

        {/* 테이블 헤더 */}
        <div className="grid grid-cols-[1fr_60px_80px_110px_80px_80px_90px] px-6 py-2 bg-gray-bg text-[11px] font-bold text-gray-text uppercase tracking-wide border-b border-gray-border flex-shrink-0">
          <span>거래처명</span><span>유형</span><span>담당자</span>
          <span>연락처</span><span>PIN</span><span>현재잔액</span><span>이번달</span>
        </div>

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-border">
          {filtered.map(acc => (
            <button
              key={acc.code}
              onClick={() => setSelected(acc)}
              className={`w-full grid grid-cols-[1fr_60px_80px_110px_80px_80px_90px] px-6 py-3 text-left hover:bg-gray-bg transition-colors text-[13px]
                ${selected?.code === acc.code ? 'bg-green-soft' : ''}`}
            >
              <span className="font-semibold text-ink">{acc.name}</span>
              <span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${TYPE_BADGE[acc.type]}`}>
                  {acc.type}
                </span>
              </span>
              <span className="text-gray-text">{acc.manager}</span>
              <span className="text-gray-text font-mono text-[12px]">{acc.phone}</span>
              <span
                className="flex items-center gap-1 group"
                onClick={e => { e.stopPropagation(); setPinVisible(v => v === acc.code ? null : acc.code) }}
              >
                <span className="font-mono">{pinVisible === acc.code ? acc.pin : '****'}</span>
                <span className="text-[11px] text-gray-text opacity-0 group-hover:opacity-100 transition-opacity">👁</span>
              </span>
              <span className={`font-bold ${acc.balance < acc.warnThreshold ? 'text-danger' : 'text-ink'}`}>
                {won(acc.balance)}
              </span>
              <span className="text-gray-text">{acc.monthlyUsage > 0 ? `-${won(acc.monthlyUsage)}` : won(acc.monthlyUsage)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 슬라이드 상세 패널 ── */}
      <div
        className={`flex-shrink-0 overflow-y-auto border-l border-gray-border transition-all duration-300
          ${selected ? 'w-[360px]' : 'w-0 overflow-hidden'}`}
      >
        {selected && (
          <div className="p-6 min-w-[360px]">
            {/* 패널 헤더 */}
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="text-[17px] font-extrabold text-ink">{selected.name}</div>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${TYPE_BADGE[selected.type]}`}>
                  {selected.type}
                </span>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-text hover:text-ink text-[18px]">✕</button>
            </div>

            {/* 잔액 카드 */}
            <div className={`rounded-xl p-4 mb-5 text-center ${selected.balance < selected.warnThreshold ? 'bg-red-50 border border-danger/30' : 'bg-green-soft'}`}>
              <div className="text-[11px] font-semibold text-gray-text mb-1">현재 선결제 잔액</div>
              <div className={`text-[28px] font-extrabold ${selected.balance < selected.warnThreshold ? 'text-danger' : 'text-green'}`}>
                {won(selected.balance)}
              </div>
              {selected.balance < selected.warnThreshold && (
                <div className="text-[11px] text-danger font-semibold mt-1">⚠ 잔액 부족</div>
              )}
            </div>

            {/* 상세 정보 */}
            <div className="space-y-1.5 mb-4 text-[13px]">
              <InfoRow label="담당자"       value={selected.manager} />
              <InfoRow label="연락처"       value={selected.phone} />
              <InfoRow label="기관명"       value={selected.org || '—'} />
              <InfoRow label="PIN"          value="****" />
              <InfoRow label="잔액 경고 기준" value={won(selected.warnThreshold)} />
              <InfoRow label="이번달 사용액"  value={won(selected.monthlyUsage)} />
            </div>

            {/* 충전 버튼 */}
            <button
              onClick={() => setChargeOpen(true)}
              className="w-full py-3 bg-[#16a84c] text-white rounded-xl font-bold text-[14px] hover:bg-[#128040] transition-colors mb-4"
            >
              💳 충전 등록
            </button>

            {/* 수정 / 삭제 */}
            <div className="flex gap-2 mb-6">
              <button className="flex-1 py-2 rounded-xl border-2 border-gray-border text-[13px] font-bold text-gray-text hover:bg-gray-bg transition-colors focus:outline-none">
                정보 수정
              </button>
              <button className="flex-1 py-2 rounded-xl border-2 border-danger/40 text-[13px] font-bold text-danger hover:bg-red-50 transition-colors focus:outline-none">
                거래처 삭제
              </button>
            </div>

            {/* 이력 탭 */}
            <div className="flex gap-0 border-b border-gray-border mb-3">
              {(['orders', 'charges'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setDetailTab(t)}
                  className={`px-4 py-2 text-[12px] font-bold border-b-2 transition-colors
                    ${detailTab === t ? 'border-[#16a84c] text-[#16a84c]' : 'border-transparent text-gray-text hover:text-ink'}`}
                >
                  {t === 'orders' ? '주문 내역' : '충전 이력'}
                </button>
              ))}
            </div>

            {/* 주문 내역 */}
            {detailTab === 'orders' && (
              <div className="space-y-2">
                {selectedOrders.length === 0
                  ? <div className="text-[13px] text-gray-text py-2">주문 이력 없음</div>
                  : selectedOrders.map(o => {
                      const dateStr = new Date(o.createdAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })
                      const timeStr = new Date(o.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
                      return (
                        <div key={o.code} className="bg-gray-bg rounded-lg px-3 py-2.5 text-[12px]">
                          <div className="flex justify-between items-start mb-1">
                            <span className="text-gray-text">{dateStr} {timeStr} · {o.method}</span>
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
            )}

            {/* 충전 이력 */}
            {detailTab === 'charges' && (
              <div className="space-y-2">
                {(MOCK_DEPOSITS[selected.code] ?? []).length === 0
                  ? <div className="text-[13px] text-gray-text py-2">충전 이력 없음</div>
                  : (MOCK_DEPOSITS[selected.code] ?? []).map((d, i) => (
                      <div key={i} className="bg-gray-bg rounded-lg px-3 py-2.5 flex justify-between items-center text-[12px]">
                        <div>
                          <div className="font-semibold text-ink">{won(d.amount)}</div>
                          <div className="text-gray-text">{d.date}{d.memo ? ` · ${d.memo}` : ''}</div>
                        </div>
                        <span className="text-[10px] font-bold text-green bg-green-soft px-2 py-0.5 rounded-full">충전</span>
                      </div>
                    ))
                }
              </div>
            )}
          </div>
        )}
      </div>

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
                  {(['과', '기업', '개인', '기타'] as Account['type'][]).map(t => (
                    <button key={t} onClick={() => setNewForm(f => ({ ...f, type: t }))}
                      className={`flex-1 py-1.5 rounded-full border text-[12px] font-bold transition-colors focus:outline-none
                        ${newForm.type === t ? 'border-[#16a84c] text-[#16a84c] bg-green-soft' : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}>
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
                <input value={newForm.phone} onChange={e => setNewForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="010-0000-0000" className={INPUT_CLS} />
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">PIN <span className="text-danger">*</span></label>
                <input value={newForm.pin} onChange={e => setNewForm(f => ({ ...f, pin: e.target.value }))}
                  placeholder="4자리 숫자" maxLength={4} className={INPUT_CLS + ' font-mono'} />
              </div>

              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">잔액 경고 기준</label>
                <input value={newForm.warnThreshold} onChange={e => setNewForm(f => ({ ...f, warnThreshold: e.target.value }))}
                  placeholder="30000" className={INPUT_CLS} />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setAddOpen(false)}
                className="flex-1 py-3 rounded-xl border-2 border-gray-border text-gray-text font-bold hover:bg-gray-bg focus:outline-none">
                취소
              </button>
              <button onClick={handleAddAccount}
                className="flex-1 py-3 rounded-xl bg-[#16a84c] text-white font-bold hover:bg-[#128040] transition-colors focus:outline-none">
                등록
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 키오스크 QR 모달 ── */}
      {kioskQr && (
        <KioskQrModal onClose={() => setKioskQr(false)} />
      )}

      {/* ── 충전 등록 모달 ── */}
      {chargeOpen && selected && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-[360px]">
            <div className="text-[17px] font-extrabold mb-1">충전 등록</div>
            <div className="text-[13px] text-gray-text mb-5">{selected.name}</div>
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
                className="flex-1 py-3 rounded-xl border-2 border-gray-border text-gray-text font-bold hover:bg-gray-bg focus:outline-none">
                취소
              </button>
              <button onClick={handleCharge}
                className="flex-1 py-3 rounded-xl bg-[#16a84c] text-white font-bold hover:bg-[#128040] transition-colors focus:outline-none">
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

function KioskQrModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const qrDataUrl = useQrDataUrl(BASE_URL)

  function copy() {
    navigator.clipboard.writeText(BASE_URL)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
            <div className="text-[12px] font-mono text-gray-text">{BASE_URL}</div>
          </div>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-gray-text text-[12px]">QR 생성 중…</div>
        )}
        <button onClick={copy}
          className={`w-full py-3 rounded-xl font-bold text-[14px] transition-colors
            ${copied ? 'bg-green-soft text-green' : 'bg-ink text-white hover:bg-ink/90'}`}>
          {copied ? '✓ 링크 복사됨' : '링크 복사'}
        </button>
      </div>
    </div>
  )
}
