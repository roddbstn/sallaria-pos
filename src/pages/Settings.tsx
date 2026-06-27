import { useState, useEffect } from 'react'
import { playOrderSound, getSavedVolume, saveVolume } from '../lib/sound'

interface PrinterSettings { path: string; baudRate: number; cutMode: 'full' | 'partial' }
interface ReceiptSettings  { menuSize: 'small' | 'normal' | 'large'; optionSize: 'small' | 'normal' | 'large' }

type Api = {
  getSettings?:    () => Promise<{ printer: PrinterSettings; receipt: ReceiptSettings }>
  listPorts?:      () => Promise<string[]>
  connectPrinter?: () => Promise<{ ok: boolean; error?: string }>
  testPrint?:      () => Promise<{ ok: boolean; error?: string }>
  updateSettings?: (p: unknown) => Promise<{ ok: boolean }>
  onPrinterStatus?:  (cb: (s: { connected: boolean; queueLength: number }) => void) => void
  offPrinterStatus?: () => void
}

const api = (): Api => (window as unknown as { api?: Api }).api ?? {}

const SIZE_LABELS: Record<string, string> = { small: '기본', normal: '보통', large: '크게' }
const BAUD_RATES = [9600, 19200, 38400, 115200]

export default function Settings() {
  const [ports,      setPorts]      = useState<string[]>([])
  const [printer,    setPrinter]    = useState<PrinterSettings>({ path: '', baudRate: 9600, cutMode: 'partial' })
  const [receipt,    setReceipt]    = useState<ReceiptSettings>({ menuSize: 'normal', optionSize: 'small' })
  const [connected,  setConnected]  = useState(false)
  const [scanning,   setScanning]   = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [testing,    setTesting]    = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [connectErr, setConnectErr] = useState('')
  const [testMsg,    setTestMsg]    = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [alertVolume,  setAlertVolume]  = useState(getSavedVolume)

  // 초기 설정 로드 + 프린터 상태 구독
  useEffect(() => {
    const a = api()
    a.getSettings?.().then(s => {
      if (s.printer) setPrinter(s.printer)
      if (s.receipt) setReceipt(s.receipt)
    })
    a.onPrinterStatus?.(s => setConnected(s.connected))
    return () => { a.offPrinterStatus?.() }
  }, [])

  // 포트 자동 감지
  async function handleScan() {
    setScanning(true)
    setConnectErr('')
    const found = await api().listPorts?.() ?? []
    setPorts(found)
    if (found.length > 0 && !printer.path) {
      setPrinter(p => ({ ...p, path: found[0] }))
    }
    setScanning(false)
  }

  // 연결
  async function handleConnect() {
    if (!printer.path) { setConnectErr('포트를 먼저 선택해 주세요.'); return }
    setConnecting(true)
    setConnectErr('')
    // 설정 저장 후 연결
    await api().updateSettings?.({ printer, receipt })
    const res = await api().connectPrinter?.()
    if (res && !res.ok) {
      setConnectErr(res.error ?? '연결에 실패했습니다. 포트와 케이블을 확인해 주세요.')
    }
    setConnecting(false)
  }

  // 테스트 출력
  async function handleTestPrint() {
    setTesting(true)
    setTestMsg('')
    const res = await api().testPrint?.()
    if (res?.ok) {
      setTestMsg('종이가 나왔나요? 출력이 완료됐습니다!')
    } else {
      setTestMsg(res?.error ?? '출력에 실패했습니다.')
    }
    setTesting(false)
    setTimeout(() => setTestMsg(''), 4000)
  }

  // 설정 저장
  async function handleSave() {
    saveVolume(alertVolume)
    await api().updateSettings?.({ printer, receipt })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const sizeOpts: ('small' | 'normal' | 'large')[] = ['small', 'normal', 'large']

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
                type="range"
                min={0}
                max={100}
                value={alertVolume}
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
            <p className="text-[11px] text-gray-text mt-1.5">딩동 차임 후 "선결제 주문!" 음성이 재생됩니다.</p>
          </Field>
        </Section>

        {/* ── 프린터 연결 ── */}
        <Section title="프린터 연결">

          {/* 연결 상태 배지 */}
          <div className={[
            'flex items-center gap-2 px-4 py-3 rounded-xl text-[13px] font-bold mb-2',
            connected ? 'bg-[#E6F4EC] text-[#017333]' : 'bg-red-50 text-[#C92A2A]',
          ].join(' ')}>
            <span className={['w-2.5 h-2.5 rounded-full', connected ? 'bg-[#017333]' : 'bg-[#C92A2A]'].join(' ')} />
            {connected ? '프린터가 연결되어 있습니다' : '프린터가 연결되어 있지 않습니다'}
          </div>

          {/* STEP 1 — 포트 감지 */}
          <StepCard step="1" title="프린터 포트 찾기">
            <p className="text-[12px] text-gray-text mb-3">
              프린터를 PC에 연결한 후 아래 버튼을 눌러 주세요.
            </p>
            <button
              onClick={handleScan}
              disabled={scanning}
              className="flex items-center gap-2 px-4 py-2.5 bg-ink text-white rounded-xl text-[13px] font-bold hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              {scanning ? (
                <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />감지 중…</>
              ) : (
                <><SearchIcon />포트 자동 감지</>
              )}
            </button>
            {ports.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {ports.map(p => (
                  <button
                    key={p}
                    onClick={() => { setPrinter(prev => ({ ...prev, path: p })); setConnectErr('') }}
                    className={[
                      'px-3 py-1.5 rounded-lg text-[12px] font-bold border transition-colors',
                      printer.path === p
                        ? 'bg-ink text-white border-ink'
                        : 'bg-gray-100 text-gray-text hover:bg-gray-200',
                    ].join(' ')}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
            {ports.length === 0 && !scanning && (
              <p className="mt-2 text-[11px] text-gray-text">감지된 포트가 없습니다. 케이블 연결을 확인해 주세요.</p>
            )}
          </StepCard>

          {/* STEP 2 — 연결 */}
          <StepCard step="2" title="프린터 연결하기">
            <p className="text-[12px] text-gray-text mb-3">
              포트를 선택한 후 <strong>연결하기</strong>를 눌러 주세요.
            </p>
            <div className="flex gap-2 items-center">
              <select
                value={printer.path}
                onChange={e => { setPrinter(p => ({ ...p, path: e.target.value })); setConnectErr('') }}
                className="border border-gray-border rounded-lg px-3 py-2 text-[13px] flex-1"
              >
                {printer.path === '' && <option value="">포트 선택…</option>}
                {ports.map(p => <option key={p}>{p}</option>)}
                {/* 포트 감지 전에도 수동 입력 가능하도록 */}
                {printer.path && !ports.includes(printer.path) && (
                  <option value={printer.path}>{printer.path}</option>
                )}
              </select>
              <button
                onClick={handleConnect}
                disabled={connecting || !printer.path}
                className="flex items-center gap-2 px-4 py-2 bg-[#016f30] text-white rounded-xl text-[13px] font-bold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
              >
                {connecting ? (
                  <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />연결 중…</>
                ) : '연결하기'}
              </button>
            </div>
            {connectErr && (
              <div className="mt-2 text-[12px] text-[#C92A2A] bg-red-50 px-3 py-2 rounded-lg">
                {connectErr}
              </div>
            )}
          </StepCard>

          {/* STEP 3 — 테스트 출력 */}
          <StepCard step="3" title="테스트 출력">
            <p className="text-[12px] text-gray-text mb-3">
              연결이 완료되면 테스트 용지를 출력해 확인해 주세요.
            </p>
            <button
              onClick={handleTestPrint}
              disabled={testing || !connected}
              className={[
                'flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold transition-opacity',
                connected
                  ? 'bg-[#016f30] text-white hover:opacity-90'
                  : 'bg-gray-100 text-gray-text cursor-not-allowed',
              ].join(' ')}
            >
              {testing ? (
                <><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />출력 중…</>
              ) : (
                <><PrintIcon />테스트 영수증 출력</>
              )}
            </button>
            {!connected && (
              <p className="mt-2 text-[11px] text-gray-text">연결 후 사용할 수 있습니다.</p>
            )}
            {testMsg && (
              <div className={[
                'mt-2 text-[12px] px-3 py-2 rounded-lg',
                testMsg.includes('완료') ? 'bg-[#E6F4EC] text-[#017333]' : 'bg-red-50 text-[#C92A2A]',
              ].join(' ')}>
                {testMsg}
              </div>
            )}
          </StepCard>
        </Section>

        {/* ── 고급 설정 ── */}
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className="text-[12px] text-gray-text font-bold mb-4 flex items-center gap-1 hover:text-ink transition-colors"
        >
          {showAdvanced ? '▲' : '▼'} 고급 설정 (전송속도 · 컷 방식)
        </button>

        {showAdvanced && (
          <Section title="고급 설정">
            <Field label="전송속도 (보드레이트)">
              <div className="flex gap-2">
                {BAUD_RATES.map(r => (
                  <button
                    key={r}
                    onClick={() => setPrinter(p => ({ ...p, baudRate: r }))}
                    className={[
                      'px-3 py-2 rounded-lg text-[12px] font-bold border transition-colors',
                      printer.baudRate === r
                        ? 'bg-ink text-white border-ink'
                        : 'bg-gray-100 text-gray-text hover:bg-gray-200',
                    ].join(' ')}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-text mt-1.5">보통 9600으로 설정하면 됩니다.</p>
            </Field>

            <Field label="컷 방식">
              <div className="flex gap-2">
                {(['partial', 'full'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setPrinter(p => ({ ...p, cutMode: m }))}
                    className={[
                      'px-4 py-2 rounded-lg text-[12px] font-bold border transition-colors',
                      printer.cutMode === m
                        ? 'bg-ink text-white border-ink'
                        : 'bg-gray-100 text-gray-text hover:bg-gray-200',
                    ].join(' ')}
                  >
                    {m === 'partial' ? '부분 컷 (권장)' : '완전 컷'}
                  </button>
                ))}
              </div>
            </Field>
          </Section>
        )}

        {/* ── 주방용 영수증 글자 크기 ── */}
        <Section title="주방용 영수증 글자 크기">
          {([
            { key: 'menuSize',   label: '메뉴명' },
            { key: 'optionSize', label: '옵션' },
          ] as { key: keyof ReceiptSettings; label: string }[]).map(({ key, label }) => (
            <Field key={key} label={label}>
              <div className="flex gap-2">
                {sizeOpts.map(s => (
                  <button
                    key={s}
                    onClick={() => setReceipt(r => ({ ...r, [key]: s }))}
                    className={[
                      'px-4 py-2 rounded-lg text-[12px] font-bold border transition-colors',
                      receipt[key] === s
                        ? 'bg-ink text-white border-ink'
                        : 'bg-gray-100 text-gray-text hover:bg-gray-200',
                    ].join(' ')}
                  >
                    {SIZE_LABELS[s]}
                  </button>
                ))}
              </div>
            </Field>
          ))}

          {/* 미리보기 */}
          <div className="mt-2">
            <div className="text-[11px] font-bold text-gray-text mb-2">출력 미리보기 (58mm 실제 비율)</div>
            <div className="bg-gray-200 rounded-xl p-5 flex justify-center">
              <div style={{
                width: 192,
                backgroundColor: '#fff',
                boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: 8,
                lineHeight: 1.35,
                color: '#111',
                padding: '10px 16px',
                overflowX: 'hidden',
              }}>
                <div style={{ textAlign: 'center', fontWeight: 'bold' }}>[주방용]</div>
                <div style={{ textAlign: 'center' }}>샐러리아 침산점</div>
                <div>{'--------------------------------'}</div>
                <div>주문번호: 1101</div>
                <div>이용방법: 포장   주문자: 홍길동</div>
                <div>{'--------------------------------'}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                  <span>메뉴명</span><span>수량</span>
                </div>
                <div>{'--------------------------------'}</div>
                {([
                  { name: '단호박 샐러드', qty: 1, opt: '레몬 드레싱' },
                  { name: '치킨텐더 랩',   qty: 1, opt: '멕시칸 스파이시' },
                ] as const).map((item, i) => {
                  const menuPx = receipt.menuSize   === 'large' ? 16 : receipt.menuSize   === 'normal' ? 12 : 8
                  const optPx  = receipt.optionSize === 'large' ? 16 : receipt.optionSize === 'normal' ? 12 : 8
                  return (
                    <div key={i}>
                      <div style={{ fontWeight: 'bold', fontSize: menuPx, display: 'flex', justifyContent: 'space-between' }}>
                        <span>{item.name}</span><span>{item.qty}</span>
                      </div>
                      <div style={{ fontSize: optPx, color: '#555' }}>{`  ▶ ${item.opt}`}</div>
                    </div>
                  )
                })}
                <div>{'--------------------------------'}</div>
                <div style={{ height: 43 }} />
              </div>
            </div>
          </div>
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
        <span className="w-6 h-6 rounded-full bg-ink text-white text-[11px] font-extrabold flex items-center justify-center flex-shrink-0">
          {step}
        </span>
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
