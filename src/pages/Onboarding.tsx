import { useState } from 'react'
import { supabase } from '../lib/supabase'

interface Props {
  clientId:   string
  onComplete: (storeId: string, storeName: string) => void
}

type Api = {
  listPorts?:      () => Promise<string[]>
  connectPrinter?: () => Promise<{ ok: boolean; error?: string }>
  updateSettings?: (p: unknown) => Promise<{ ok: boolean }>
}
const api = (): Api => (window as unknown as { api?: Api }).api ?? {}

const BAUD_RATES = [9600, 19200, 38400, 115200]

export default function Onboarding({ clientId, onComplete }: Props) {
  const [step,         setStep]         = useState<1 | 2 | 3>(1)
  const [businessName, setBusinessName] = useState('')
  const [address,      setAddress]      = useState('')
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')

  // Step 2: 프린터
  const [ports,       setPorts]       = useState<string[]>([])
  const [printerPath, setPrinterPath] = useState('')
  const [baudRate,    setBaudRate]    = useState(9600)
  const [scanning,    setScanning]    = useState(false)
  const [connecting,  setConnecting]  = useState(false)
  const [connected,   setConnected]   = useState(false)
  const [connectErr,  setConnectErr]  = useState('')

  // Step 1: 상호명 저장
  async function handleStep1(e: React.FormEvent) {
    e.preventDefault()
    if (!businessName.trim()) return
    setLoading(true)
    setError('')
    try {
      const { error: e } = await supabase
        .from('clients')
        .update({ business_name: businessName.trim() })
        .eq('id', clientId)
      if (e) throw e
      setStep(2)
      // 포트 자동 스캔
      handleScan()
    } catch (e: any) {
      setError(e.message ?? '오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // Step 2: 포트 스캔
  async function handleScan() {
    setScanning(true)
    setConnectErr('')
    const found = await api().listPorts?.() ?? []
    setPorts(found)
    if (found.length > 0) setPrinterPath(found[0])
    setScanning(false)
  }

  // Step 2: 프린터 연결
  async function handleConnect() {
    if (!printerPath) { setConnectErr('포트를 선택해 주세요.'); return }
    setConnecting(true)
    setConnectErr('')
    await api().updateSettings?.({ printer: { path: printerPath, baudRate, cutMode: 'partial' } })
    const res = await api().connectPrinter?.()
    if (res && !res.ok) {
      setConnectErr(res.error ?? '연결에 실패했습니다. 포트와 케이블을 확인해 주세요.')
    } else {
      setConnected(true)
    }
    setConnecting(false)
  }

  // Step 3: 스토어 생성
  async function handleStep3(e?: React.FormEvent) {
    e?.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { data, error: e } = await supabase
        .from('stores')
        .insert({ client_id: clientId, name: businessName.trim(), address: address.trim() || null })
        .select('id, name')
        .single()
      if (e) throw e
      onComplete(data.id, data.name)
    } catch (e: any) {
      setError(e.message ?? '오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const STEPS = ['상호명 입력', '프린터 연결', '매장 주소']

  return (
    <div className="flex h-full items-center justify-center bg-gray-bg">
      <div className="bg-white rounded-2xl p-8 w-[420px] shadow-sm">

        {/* 진행 단계 */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold
                ${step >= s ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text'}`}>
                {s}
              </div>
              {s < 3 && <div className={`w-8 h-0.5 ${step > s ? 'bg-ink' : 'bg-gray-200'}`} />}
            </div>
          ))}
          <span className="ml-2 text-[13px] text-gray-text">{STEPS[step - 1]}</span>
        </div>

        {/* ── Step 1: 상호명 ── */}
        {step === 1 && (
          <>
            <h1 className="text-[22px] font-bold text-ink mb-2">어떤 매장인가요?</h1>
            <p className="text-[13px] text-gray-text mb-6">POS 화면 상단과 QR 주문 화면에 표시됩니다.</p>
            <form onSubmit={handleStep1} className="flex flex-col gap-4">
              <div>
                <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">매장 상호명</label>
                <input
                  type="text"
                  value={businessName}
                  onChange={e => setBusinessName(e.target.value)}
                  placeholder="예: 샐러리아 침산점"
                  autoFocus
                  required
                  className="w-full border border-gray-border rounded-lg px-3 py-2.5 text-[15px] focus:outline-none focus:border-green transition-colors"
                />
              </div>
              {error && <p className="text-[13px] text-danger">{error}</p>}
              <button
                type="submit"
                disabled={!businessName.trim() || loading}
                className="w-full py-3 bg-ink text-white rounded-xl font-bold text-[14px] hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                다음
              </button>
            </form>
          </>
        )}

        {/* ── Step 2: 프린터 연결 ── */}
        {step === 2 && (
          <>
            <h1 className="text-[22px] font-bold text-ink mb-2">영수증 프린터를 연결해주세요</h1>
            <p className="text-[13px] text-gray-text mb-6">프린터가 없으면 건너뛰고 나중에 설정에서 연결할 수 있어요.</p>

            <div className="flex flex-col gap-4">
              {/* 포트 선택 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide">포트</label>
                  <button
                    onClick={handleScan}
                    disabled={scanning}
                    className="text-[12px] text-green font-semibold hover:opacity-70 transition-opacity"
                  >
                    {scanning ? '감지 중…' : '포트 감지'}
                  </button>
                </div>
                {ports.length > 0 ? (
                  <select
                    value={printerPath}
                    onChange={e => setPrinterPath(e.target.value)}
                    className="w-full border border-gray-border rounded-lg px-3 py-2.5 text-[14px] focus:outline-none focus:border-green bg-white"
                  >
                    {ports.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                ) : (
                  <div className="w-full border border-gray-border rounded-lg px-3 py-2.5 text-[14px] text-gray-text bg-gray-bg">
                    {scanning ? '포트 감지 중…' : '포트를 찾을 수 없습니다. 프린터 연결 후 다시 감지해 주세요.'}
                  </div>
                )}
              </div>

              {/* 보드레이트 */}
              <div>
                <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">통신 속도</label>
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  {BAUD_RATES.map(b => (
                    <button
                      key={b}
                      onClick={() => setBaudRate(b)}
                      className={`flex-1 py-1.5 rounded-md text-[12px] font-bold transition-all
                        ${baudRate === b ? 'bg-white shadow-sm text-ink' : 'text-gray-text'}`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              {connectErr && <p className="text-[13px] text-danger">{connectErr}</p>}

              {connected ? (
                <div className="flex items-center gap-2 bg-green-soft rounded-xl px-4 py-3">
                  <span className="text-green text-[18px]">✓</span>
                  <span className="text-[14px] font-semibold text-green">연결됐습니다!</span>
                </div>
              ) : (
                <button
                  onClick={handleConnect}
                  disabled={connecting || !printerPath}
                  className="w-full py-3 bg-ink text-white rounded-xl font-bold text-[14px] hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {connecting ? '연결 중…' : '연결하기'}
                </button>
              )}

              <button
                onClick={() => setStep(3)}
                className="text-[13px] text-gray-text hover:text-ink transition-colors text-center"
              >
                나중에 연결
              </button>
            </div>

            {connected && (
              <button
                onClick={() => setStep(3)}
                className="w-full mt-4 py-3 bg-ink text-white rounded-xl font-bold text-[14px] hover:opacity-90 transition-opacity"
              >
                다음
              </button>
            )}
          </>
        )}

        {/* ── Step 3: 주소 ── */}
        {step === 3 && (
          <>
            <h1 className="text-[22px] font-bold text-ink mb-2">매장 주소를 입력해주세요</h1>
            <p className="text-[13px] text-gray-text mb-6">나중에 설정에서 수정할 수 있어요.</p>
            <form onSubmit={handleStep3} className="flex flex-col gap-4">
              <div>
                <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">주소 (선택)</label>
                <input
                  type="text"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="예: 대구 북구 침산동"
                  autoFocus
                  className="w-full border border-gray-border rounded-lg px-3 py-2.5 text-[14px] focus:outline-none focus:border-green transition-colors"
                />
              </div>
              {error && <p className="text-[13px] text-danger">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-ink text-white rounded-xl font-bold text-[14px] hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {loading ? '생성 중...' : '시작하기'}
              </button>
              <button
                type="button"
                onClick={() => handleStep3()}
                className="text-[13px] text-gray-text hover:text-ink transition-colors text-center"
              >
                나중에 입력
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
