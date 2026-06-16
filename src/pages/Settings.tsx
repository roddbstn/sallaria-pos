import { useState, useEffect } from 'react'

interface PrinterSettings { path: string; baudRate: number; cutMode: 'full' | 'partial' }
interface ReceiptSettings  { menuSize: 'small' | 'normal' | 'large'; optionSize: 'small' | 'normal' | 'large' }

const BAUD_RATES = [9600, 19200, 38400, 115200]
const SIZE_LABELS: Record<string, string> = { small: '작게', normal: '보통', large: '크게' }

export default function Settings() {
  const [ports,    setPorts]    = useState<string[]>(['COM1', 'COM2', 'COM3'])
  const [printer,  setPrinter]  = useState<PrinterSettings>({ path: 'COM1', baudRate: 9600, cutMode: 'partial' })
  const [receipt,  setReceipt]  = useState<ReceiptSettings>({ menuSize: 'normal', optionSize: 'small' })
  const [saved,    setSaved]    = useState(false)
  const [testing,  setTesting]  = useState(false)

  useEffect(() => {
    const w = window as unknown as { api?: { getSettings?: Function; listPorts?: Function } }
    w.api?.getSettings?.().then((s: { printer: PrinterSettings; receipt: ReceiptSettings }) => {
      if (s.printer) setPrinter(s.printer)
      if (s.receipt) setReceipt(s.receipt)
    })
    w.api?.listPorts?.().then(setPorts)
  }, [])

  async function handleSave() {
    const w = window as unknown as { api?: { updateSettings?: Function } }
    await w.api?.updateSettings?.({ printer, receipt })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleTestPrint() {
    setTesting(true)
    const w = window as unknown as { api?: { testPrint?: Function } }
    await w.api?.testPrint?.()
    setTimeout(() => setTesting(false), 1200)
  }

  const sizeOpts: ('small' | 'normal' | 'large')[] = ['small', 'normal', 'large']

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="max-w-[640px] mx-auto px-8 py-8">
        <div className="text-[22px] font-extrabold mb-8">설정</div>

        {/* ── 프린터 설정 ── */}
        <Section title="🖨 프린터 설정">
          <Field label="COM 포트">
            <div className="flex gap-2">
              <select
                value={printer.path}
                onChange={e => setPrinter(p => ({ ...p, path: e.target.value }))}
                className="border border-gray-border rounded-lg px-3 py-2 text-[13px] flex-1"
              >
                {ports.map(p => <option key={p}>{p}</option>)}
              </select>
              <button
                onClick={() => {
                  const w = window as unknown as { api?: { listPorts?: Function } }
                  w.api?.listPorts?.().then(setPorts)
                }}
                className="px-3 py-2 border border-gray-border rounded-lg text-[12px] text-gray-text hover:bg-gray-bg"
              >
                🔄 자동 감지
              </button>
            </div>
          </Field>

          <Field label="전송속도">
            <div className="flex gap-2">
              {BAUD_RATES.map(r => (
                <button
                  key={r}
                  onClick={() => setPrinter(p => ({ ...p, baudRate: r }))}
                  className={`px-3 py-2 rounded-lg text-[12px] font-bold border transition-colors
                    ${printer.baudRate === r
                      ? 'bg-ink text-white border-ink'
                      : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </Field>

          <Field label="컷 방식">
            <div className="flex gap-2">
              {(['partial', 'full'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setPrinter(p => ({ ...p, cutMode: m }))}
                  className={`px-4 py-2 rounded-lg text-[12px] font-bold border transition-colors
                    ${printer.cutMode === m
                      ? 'bg-ink text-white border-ink'
                      : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}
                >
                  {m === 'partial' ? '부분 컷' : '완전 컷'}
                </button>
              ))}
            </div>
          </Field>

          <button
            onClick={handleTestPrint}
            disabled={testing}
            className="mt-2 px-5 py-2 bg-gray-bg border border-gray-border rounded-lg text-[13px] font-bold hover:bg-gray-100 transition-colors disabled:opacity-60"
          >
            {testing ? '출력 중…' : '🖨 테스트 출력'}
          </button>
        </Section>

        {/* ── 주방용 영수증 글자 크기 ── */}
        <Section title="📄 주방용 영수증 글자 크기">
          {([
            { key: 'menuSize',   label: '메뉴명' },
            { key: 'optionSize', label: '서브메뉴 (옵션)' },
          ] as { key: keyof ReceiptSettings; label: string }[]).map(({ key, label }) => (
            <Field key={key} label={label}>
              <div className="flex gap-2">
                {sizeOpts.map(s => (
                  <button
                    key={s}
                    onClick={() => setReceipt(r => ({ ...r, [key]: s }))}
                    className={`px-4 py-2 rounded-lg text-[12px] font-bold border transition-colors
                      ${receipt[key] === s
                        ? 'bg-ink text-white border-ink'
                        : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}
                  >
                    {SIZE_LABELS[s]}
                  </button>
                ))}
              </div>
            </Field>
          ))}

          {/* 영수증 미리보기 */}
          <div className="mt-3 border border-gray-border rounded-xl p-4 bg-gray-bg font-mono text-[12px] leading-relaxed">
            <div className="text-center font-bold mb-1">[주방용]</div>
            <div className="text-center mb-2">샐러리아 침산점</div>
            <div className="border-t border-dashed border-gray-400 my-1" />
            <div className="flex justify-between text-[11px] text-gray-text"><span>주문번호: A-0042</span><span>포장</span></div>
            <div className="text-[11px] text-gray-text">주문자: 홍길동 · 06/14 12:30</div>
            <div className="border-t border-dashed border-gray-400 my-1" />
            <div className={`font-bold ${receipt.menuSize === 'large' ? 'text-[15px]' : receipt.menuSize === 'small' ? 'text-[10px]' : 'text-[12px]'}`}>
              단호박 샐러드 × 1
            </div>
            <div className={`text-gray-text ${receipt.optionSize === 'large' ? 'text-[13px]' : receipt.optionSize === 'small' ? 'text-[9px]' : 'text-[11px]'}`}>
              &nbsp;&nbsp;▶ 레몬 드레싱
            </div>
            <div className={`font-bold ${receipt.menuSize === 'large' ? 'text-[15px]' : receipt.menuSize === 'small' ? 'text-[10px]' : 'text-[12px]'}`}>
              치킨텐더 랩 × 1
            </div>
            <div className={`text-gray-text ${receipt.optionSize === 'large' ? 'text-[13px]' : receipt.optionSize === 'small' ? 'text-[9px]' : 'text-[11px]'}`}>
              &nbsp;&nbsp;▶ 멕시칸 스파이시 소스
            </div>
          </div>
        </Section>

        {/* 저장 버튼 */}
        <button
          onClick={handleSave}
          className={`w-full py-3.5 rounded-xl font-bold text-[15px] transition-colors mt-2
            ${saved ? 'bg-green-soft text-green' : 'bg-[#16a84c] text-white hover:bg-[#128040]'}`}
        >
          {saved ? '✓ 저장됨' : '설정 저장'}
        </button>

        {/* 앱 정보 */}
        <div className="mt-8 text-center text-[12px] text-gray-text">
          <div className="font-bold">샐러리아 POS v0.1.0</div>
          <div className="mt-0.5">Electron + React + Supabase</div>
        </div>
      </div>
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
