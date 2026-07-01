import { useState, useEffect } from 'react'
import { playOrderSound, getSavedVolume, saveVolume } from '../lib/sound'

interface PrinterSettings { portName: string }
interface ReceiptSettings  {
  menuSize:           'small' | 'normal' | 'large'
  optionSize:         'small' | 'normal' | 'large'
  customerMenuSize:   'small' | 'normal' | 'large'
  customerOptionSize: 'small' | 'normal' | 'large'
}
interface ComPort { path: string; manufacturer: string; friendlyName: string }

type Api = {
  getSettings?:     () => Promise<{ printer: PrinterSettings; receipt: ReceiptSettings }>
  listPorts?:       () => Promise<ComPort[]>
  connectPrinter?:  () => Promise<{ ok: boolean; error?: string }>
  testPrint?:       () => Promise<{ ok: boolean; error?: string }>
  updateSettings?:  (p: unknown) => Promise<{ ok: boolean }>
  onPrinterStatus?: (cb: (s: { connected: boolean; queueLength: number }) => void) => void
  offPrinterStatus?:() => void
}

const api = (): Api => (window as unknown as { api?: Api }).api ?? {}

const SIZE_LABELS: Record<string, string> = { small: '기본', normal: '보통', large: '크게' }

export default function Settings() {
  const [comPorts,   setComPorts]   = useState<ComPort[]>([])
  const [printer,    setPrinter]    = useState<PrinterSettings>({ portName: '' })
  const [receipt,    setReceipt]    = useState<ReceiptSettings>({ menuSize: 'normal', optionSize: 'small', customerMenuSize: 'small', customerOptionSize: 'small' })
  const [connected,  setConnected]  = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [testing,    setTesting]    = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [connectErr, setConnectErr] = useState('')
  const [testMsg,    setTestMsg]    = useState('')
  const [alertVolume,  setAlertVolume]  = useState(getSavedVolume)
  const [receiptTab, setReceiptTab] = useState<'kitchen' | 'customer'>('kitchen')

  useEffect(() => {
    const a = api()
    a.getSettings?.().then(s => {
      if (s.printer) setPrinter(s.printer)
      if (s.receipt) setReceipt(s.receipt)
    })
    a.onPrinterStatus?.(s => setConnected(s.connected))
    return () => { a.offPrinterStatus?.() }
  }, [])

  async function handleScanPorts() {
    setLoading(true)
    setConnectErr('')
    const list = await api().listPorts?.() ?? []
    setComPorts(list)
    // 포트가 하나뿐이면 자동 선택
    if (!printer.portName && list.length === 1) {
      setPrinter({ portName: list[0].path })
    }
    setLoading(false)
  }

  async function handleConnect() {
    if (!printer.portName) { setConnectErr('COM 포트를 먼저 선택해 주세요.'); return }
    setConnecting(true)
    setConnectErr('')
    await api().updateSettings?.({ printer })
    const res = await api().connectPrinter?.()
    if (res && !res.ok) {
      setConnectErr(res.error ?? '포트를 열 수 없습니다.')
    }
    setConnecting(false)
  }

  async function handleTestPrint() {
    setTesting(true)
    setTestMsg('')
    const res = await api().testPrint?.()
    setTestMsg(res?.ok ? '테스트 용지가 출력됐나요? 정상입니다!' : (res?.error ?? '출력에 실패했습니다.'))
    setTesting(false)
    setTimeout(() => setTestMsg(''), 4000)
  }

  async function handleSave() {
    saveVolume(alertVolume)
    await api().updateSettings?.({ printer, receipt })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const sizeOpts: ('small' | 'normal' | 'large')[] = ['small', 'normal', 'large']

  const previewWrap: React.CSSProperties = {
    width: 192,
    backgroundColor: '#fff',
    boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
    fontFamily: "'Courier New', Courier, monospace",
    fontSize: 8,
    lineHeight: 1.35,
    color: '#111',
    padding: '10px 16px',
    overflowX: 'hidden',
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-[600px] mx-auto px-8 py-8">
        <div className="text-[22px] font-extrabold text-ink mb-8">설정</div>

        {/* ── 주문 알림음 ── */}
        <Section title="🔔 주문 알림음">
          <Field label="볼륨">
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-gray-text w-4">🔇</span>
              <input
                type="range" min={0} max={100} value={alertVolume}
                onChange={e => setAlertVolume(Number(e.target.value))}
                className="flex-1 accent-green h-2 cursor-pointer"
              />
              <span className="text-[13px] text-gray-text">🔊</span>
              <span className="text-[13px] font-bold text-ink w-8 text-right">{alertVolume}</span>
            </div>
          </Field>
          <Field label="테스트">
            <button
              onClick={() => playOrderSound(alertVolume)}
              className="flex items-center gap-2 px-4 py-2.5 bg-ink text-white rounded-xl text-[13px] font-bold hover:opacity-90 transition-opacity"
            >
              <SoundIcon />알림음 미리 듣기
            </button>
          </Field>
        </Section>

        {/* ── 프린터 연결 (ESC/POS 시리얼) ── */}
        <Section title="프린터 연결 (COM 포트)">

          {/* 연결 상태 배지 */}
          <div className={[
            'flex items-center gap-2 px-4 py-3 rounded-xl text-[13px] font-bold',
            connected ? 'bg-[#E6F4EC] text-[#017333]' : 'bg-red-50 text-[#C92A2A]',
          ].join(' ')}>
            <span className={['w-2.5 h-2.5 rounded-full flex-shrink-0', connected ? 'bg-[#017333]' : 'bg-[#C92A2A]'].join(' ')} />
            {connected
              ? `연결됨 — ${printer.portName}`
              : printer.portName
                ? `미확인 — ${printer.portName} (연결하기 클릭)`
                : 'COM 포트가 선택되지 않았습니다'}
          </div>

          {/* STEP 1 — COM 포트 목록 */}
          <StepCard step="1" title="COM 포트 선택">
            <p className="text-[12px] text-gray-text mb-3">
              프린터 USB/시리얼 케이블을 연결한 후 목록을 불러오세요.
            </p>
            <button
              onClick={handleScanPorts}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2.5 bg-ink text-white rounded-xl text-[13px] font-bold hover:opacity-90 disabled:opacity-60 transition-opacity mb-3"
            >
              {loading
                ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />불러오는 중…</>
                : <><SearchIcon />포트 목록 새로고침</>}
            </button>

            {comPorts.length > 0 && (
              <div className="space-y-1.5">
                {comPorts.map(p => (
                  <button
                    key={p.path}
                    onClick={() => { setPrinter({ portName: p.path }); setConnectErr('') }}
                    className={[
                      'w-full text-left px-3 py-2.5 rounded-xl text-[13px] border transition-colors',
                      printer.portName === p.path
                        ? 'bg-ink text-white border-ink'
                        : 'bg-gray-50 text-ink hover:bg-gray-100 border-gray-border',
                    ].join(' ')}
                  >
                    <div className="font-bold">{p.path}</div>
                    {p.friendlyName && p.friendlyName !== p.path && (
                      <div className={['text-[11px] mt-0.5', printer.portName === p.path ? 'text-white/70' : 'text-gray-text'].join(' ')}>
                        {p.friendlyName}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {comPorts.length === 0 && !loading && (
              <p className="text-[12px] text-gray-text bg-gray-50 px-3 py-2 rounded-lg">
                목록 새로고침을 눌러 포트를 확인하세요.
              </p>
            )}

            {/* 저장된 포트가 있는데 목록 조회 전이면 표시 */}
            {comPorts.length === 0 && printer.portName && (
              <div className="text-[12px] text-gray-text bg-gray-50 px-3 py-2 rounded-lg mt-2">
                현재 선택: <strong>{printer.portName}</strong>
              </div>
            )}
          </StepCard>

          {/* STEP 2 — 연결 확인 */}
          <StepCard step="2" title="연결 확인">
            <p className="text-[12px] text-gray-text mb-3">
              포트를 선택한 후 <strong>연결하기</strong>를 눌러 통신이 되는지 확인합니다.
            </p>
            <button
              onClick={handleConnect}
              disabled={connecting || !printer.portName}
              className="flex items-center gap-2 px-4 py-2 bg-[#016f30] text-white rounded-xl text-[13px] font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {connecting
                ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />확인 중…</>
                : '연결하기'}
            </button>
            {connectErr && (
              <div className="mt-2 text-[12px] text-[#C92A2A] bg-red-50 px-3 py-2 rounded-lg">{connectErr}</div>
            )}
          </StepCard>

          {/* STEP 3 — 테스트 출력 */}
          <StepCard step="3" title="테스트 출력">
            <p className="text-[12px] text-gray-text mb-3">
              연결 후 테스트 용지를 출력해 확인해 주세요.
            </p>
            <button
              onClick={handleTestPrint}
              disabled={testing || !printer.portName}
              className={[
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold transition-opacity',
                printer.portName
                  ? 'bg-[#016f30] text-white hover:opacity-90'
                  : 'bg-gray-100 text-gray-text cursor-not-allowed',
              ].join(' ')}
            >
              {testing
                ? <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />출력 중…</>
                : <><PrintIcon />테스트 영수증 출력</>}
            </button>
            {!printer.portName && (
              <p className="mt-2 text-[11px] text-gray-text">포트 선택 후 사용할 수 있습니다.</p>
            )}
            {testMsg && (
              <div className={[
                'mt-2 text-[12px] px-3 py-2 rounded-lg',
                testMsg.includes('정상') ? 'bg-[#E6F4EC] text-[#017333]' : 'bg-red-50 text-[#C92A2A]',
              ].join(' ')}>{testMsg}</div>
            )}
          </StepCard>
        </Section>

        {/* ── 영수증 설정 (탭) ── */}
        <Section title="영수증 설정">
          <div className="flex bg-gray-100 rounded-xl p-1 mb-5">
            {([
              { id: 'kitchen',  label: '매장용 (주방)' },
              { id: 'customer', label: '고객용' },
            ] as const).map(tab => (
              <button
                key={tab.id}
                onClick={() => setReceiptTab(tab.id)}
                className={[
                  'flex-1 py-2 rounded-lg text-[13px] font-bold transition-colors',
                  receiptTab === tab.id ? 'bg-white text-ink shadow-sm' : 'text-gray-text',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {receiptTab === 'kitchen' ? (
            <>
              {([
                { key: 'menuSize' as const,   label: '메뉴명' },
                { key: 'optionSize' as const, label: '옵션' },
              ]).map(({ key, label }) => (
                <Field key={key} label={label}>
                  <div className="flex gap-2">
                    {sizeOpts.map(s => (
                      <button key={s} onClick={() => setReceipt(r => ({ ...r, [key]: s }))}
                        className={['px-4 py-2 rounded-lg text-[12px] font-bold border transition-colors',
                          receipt[key] === s ? 'bg-ink text-white border-ink' : 'bg-gray-100 text-gray-text hover:bg-gray-200'].join(' ')}>
                        {SIZE_LABELS[s]}
                      </button>
                    ))}
                  </div>
                </Field>
              ))}
              <div className="mt-3">
                <div className="text-[11px] font-bold text-gray-text mb-2">출력 미리보기 (58mm 실제 비율)</div>
                <div className="bg-gray-200 rounded-xl p-5 flex justify-center">
                  <div style={previewWrap}>
                    {/* 헤더 */}
                    <div style={{ textAlign:'center', fontWeight:'bold' }}>[주방용]</div>
                    <div style={{ textAlign:'center' }}>샐러리아 침산점 - 선결제 영수증</div>
                    <div>{'----------------------------------'}</div>
                    {/* 블록1 */}
                    <div><span>주문번호 : </span><b>1301</b></div>
                    <div>주문일시 : 2026/07/01 12:02</div>
                    <div>{'----------------------------------'}</div>
                    {/* 블록2 */}
                    <div><span>이용방법 : </span><b>배달</b></div>
                    <div>주문자   : 김경민</div>
                    <div>전화번호 : 010-1234-5678</div>
                    <div>{'----------------------------------'}</div>
                    {/* 블록3 배달 */}
                    <div>배달주소 : 대구 북구 침산동</div>
                    <div>가게요청 : 수저·포크 X</div>
                    <div>배달요청 : 문 앞에 놓아주세요</div>
                    <div>{'----------------------------------'}</div>
                    {/* 메뉴 테이블 */}
                    <div style={{ display:'flex', justifyContent:'space-between', fontWeight:'bold' }}>
                      <span>메뉴명</span><span>수량</span>
                    </div>
                    <div style={{ borderTop:'1px dotted #000', margin:'2px 0' }} />
                    {[
                      { name: '단호박 샐러드', qty: 1, opt: '레몬 드레싱' },
                      { name: '치킨텐더 랩',   qty: 1, opt: '멕시칸 소스' },
                    ].map((item, i) => {
                      const menuPx = receipt.menuSize   === 'large' ? 16 : receipt.menuSize   === 'normal' ? 12 : 8
                      const optPx  = receipt.optionSize === 'large' ? 16 : receipt.optionSize === 'normal' ? 12 : 8
                      return (
                        <div key={i}>
                          <div style={{ fontWeight:'bold', fontSize:menuPx, display:'flex', justifyContent:'space-between' }}>
                            <span>{item.name}</span><span>{item.qty}</span>
                          </div>
                          <div style={{ fontSize:optPx, color:'#555' }}>{`  > ${item.opt}`}</div>
                        </div>
                      )
                    })}
                    <div>{'----------------------------------'}</div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {([
                { key: 'customerMenuSize' as const,   label: '메뉴명' },
                { key: 'customerOptionSize' as const, label: '옵션' },
              ]).map(({ key, label }) => (
                <Field key={key} label={label}>
                  <div className="flex gap-2">
                    {sizeOpts.map(s => (
                      <button key={s} onClick={() => setReceipt(r => ({ ...r, [key]: s }))}
                        className={['px-4 py-2 rounded-lg text-[12px] font-bold border transition-colors',
                          receipt[key] === s ? 'bg-ink text-white border-ink' : 'bg-gray-100 text-gray-text hover:bg-gray-200'].join(' ')}>
                        {SIZE_LABELS[s]}
                      </button>
                    ))}
                  </div>
                </Field>
              ))}
              <div className="mt-3">
                <div className="text-[11px] font-bold text-gray-text mb-2">출력 미리보기 (58mm 실제 비율)</div>
                <div className="bg-gray-200 rounded-xl p-5 flex justify-center">
                  <div style={previewWrap}>
                    {/* 헤더 */}
                    <div style={{ textAlign:'center', fontWeight:'bold' }}>샐러리아 침산점 - 선결제 영수증</div>
                    <div>{'----------------------------------'}</div>
                    {/* 블록1 */}
                    <div><span>주문번호 : </span><b>1301</b></div>
                    <div>주문일시 : 2026/07/01 12:02</div>
                    <div>{'----------------------------------'}</div>
                    {/* 블록2 */}
                    <div><span>이용방법 : </span><b>포장</b></div>
                    <div>주문자   : 홍길동</div>
                    <div>전화번호 : 010-9876-5432</div>
                    <div>{'----------------------------------'}</div>
                    {/* 가게요청 */}
                    <div>가게요청 : 없음</div>
                    <div>{'----------------------------------'}</div>
                    {/* 메뉴 3열 테이블 */}
                    <div style={{ display:'grid', gridTemplateColumns:'1fr auto auto', gap:4, fontWeight:'bold' }}>
                      <span>메뉴명</span><span>수량</span><span>가격</span>
                    </div>
                    <div style={{ borderTop:'1px dotted #000', margin:'2px 0' }} />
                    {[
                      { name: '단호박 샐러드', qty: 1, price: '10,500원', opt: '레몬 드레싱',     optPrice: '' },
                      { name: '치킨텐더 랩',   qty: 1, price: '13,000원', opt: '멕시칸 소스',     optPrice: '+1,000원' },
                    ].map((item, i) => {
                      const menuPx = receipt.customerMenuSize   === 'large' ? 16 : receipt.customerMenuSize   === 'normal' ? 12 : 8
                      const optPx  = receipt.customerOptionSize === 'large' ? 16 : receipt.customerOptionSize === 'normal' ? 12 : 8
                      return (
                        <div key={i}>
                          <div style={{ fontWeight:'bold', fontSize:menuPx, display:'grid', gridTemplateColumns:'1fr auto auto', gap:4 }}>
                            <span>{item.name}</span><span>{item.qty}</span><span>{item.price}</span>
                          </div>
                          <div style={{ fontSize:optPx, color:'#555' }}>
                            {`  > ${item.opt}${item.optPrice ? `  ${item.optPrice}` : ''}`}
                          </div>
                        </div>
                      )
                    })}
                    <div>{'----------------------------------'}</div>
                    {/* 금액 요약 */}
                    <div>메뉴 소계 : 23,500원</div>
                    <div>{'----------------------------------'}</div>
                    <div><b>합  계   : 23,500원</b></div>
                    <div>{'----------------------------------'}</div>
                    {/* 잔액 */}
                    <div>주문전 잔액 : 200,000원</div>
                    <div><b>주문후 잔액 : 176,500원</b></div>
                  </div>
                </div>
              </div>
            </>
          )}
        </Section>

        {/* 저장 버튼 */}
        <button
          onClick={handleSave}
          className={[
            'w-full py-3.5 rounded-xl font-bold text-[15px] transition-colors mt-2',
            saved ? 'bg-green-soft text-green' : 'bg-[#16a84c] text-white hover:bg-[#128040]',
          ].join(' ')}
        >
          {saved ? '✓ 저장됨' : '설정 저장'}
        </button>

        <div className="mt-8 text-center text-[12px] text-gray-text">
          <div className="font-bold">샐러리아 POS v0.1.0</div>
          <div className="mt-0.5">Electron + React + Supabase</div>
        </div>
      </div>
    </div>
  )
}

function StepCard({ step, title, children }: { step: string; title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-border rounded-xl p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-6 h-6 rounded-full bg-ink text-white text-[11px] font-extrabold flex items-center justify-center flex-shrink-0">{step}</span>
        <span className="text-[13px] font-bold text-ink">{title}</span>
      </div>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <div className="text-[14px] font-bold text-ink mb-4 pb-2 border-b border-gray-border">{title}</div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-bold text-gray-text mb-1.5 block">{label}</label>
      {children}
    </div>
  )
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="22" y2="22" />
    </svg>
  )
}

function SoundIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  )
}

function PrintIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  )
}
