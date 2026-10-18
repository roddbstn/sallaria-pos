import { useState, useEffect, useCallback } from 'react'
import { usePersistentState } from '../hooks/usePersistentState'
import CountStepper from '../components/ui/CountStepper'
import QrPrintPanel from './QrPrintPanel'
import HubLayout, { HubSection, type HubNavItem } from '../components/hub/HubLayout'
import { playOrderSound, getSavedVolume, saveVolume } from '../lib/sound'
import { useStore } from '../lib/store-context'
import ReceiptPreview, { DEFAULT_RECEIPT_CONFIG, type ReceiptPreviewConfig } from '../components/ui/ReceiptPreview'
import PrinterDiagnosticModal, { buildDiagnosticText, type PrinterDiagnostic } from '../components/ui/PrinterDiagnosticModal'
import DiagnosticReportModal, { type DiagnosticReport } from '../components/ui/DiagnosticReportModal'
import * as Sentry from '@sentry/electron/renderer'

// 햄버거 드로어 "설정" 그룹 — `선포스-전체메뉴-화면기획.md` §4~6의 기획을 와이어프레임으로 구현.
// Figma 노드는 아직 없다. 기존 Settings.tsx의 기능을 옮겨오되, 토스 POS 벤치마크 결과를
// 반영해 문구와 구조를 바꿨다(§4-1).
//
// 가장 큰 변화 둘:
//  1) "연결 방식을 고르게" 하지 않고 [프린터 찾기]로 꽂힌 걸 찾아 목록으로 보여준다
//  2) 문서별 "매수 스테퍼" — 출력 여부와 매수를 하나의 컨트롤로 합친다(0 = 출력 안 함)

export type SettingsHubTab = 'qr' | 'printer' | 'receipt' | 'etc'

const NAV: HubNavItem<SettingsHubTab>[] = [
  { key: 'qr',      label: 'QR출력' },
  { key: 'printer', label: '프린터 연결' },
  { key: 'receipt', label: '영수증 · 증빙' },
  { key: 'etc',     label: '기타 설정' },
]

// Electron preload가 노출한 것만 추린 타입 (Settings.tsx와 동일 계약)
type ComPort = { path: string; manufacturer?: string; friendlyName?: string }
type Api = {
  getSettings?:     () => Promise<{ printer?: { portName: string } }>
  listPorts?:       () => Promise<ComPort[]>
  connectPrinter?:  () => Promise<{ ok: boolean; error?: string }>
  testPrint?:       () => Promise<{ ok: boolean; error?: string }>
  updateSettings?:  (p: unknown) => Promise<{ ok: boolean }>
  onPrinterStatus?: (cb: (s: { connected: boolean; queueLength: number }) => void) => void
  offPrinterStatus?:() => void
  // 기타 설정이 쓰는 창구 — 전체 정의는 src/vite-env.d.ts 의 PosBridge 에 있다
  appVersion?:      () => Promise<string>
  openLogs?:        () => Promise<{ ok: boolean; dir: string; error?: string }>
  keepAwake?:       (on: boolean) => Promise<{ active: boolean; platform: string }>
  updaterCheck?:    () => Promise<{ state: 'latest' | 'available' | 'no-feed' | 'error'; current: string; latest?: string; message?: string }>
  diagnostics?:     () => Promise<{
    version: string; electron: string; chrome: string; node: string
    platform: string; arch: string; osRelease: string; logDir: string
    printerPort: string; printerConnected: boolean
  }>
}
const api = (): Api => (window as unknown as { api?: Api }).api ?? {}

// ── 공용 조각 ──────────────────────────────────────────────────────────────

/** 라벨 + 오른쪽 컨트롤 한 줄 */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-[16px] py-[11px]">
      <div className="min-w-0">
        <div className="text-[14px] font-normal text-[#1E1E1E]">{label}</div>
        {hint && <div className="text-[11px] font-normal text-[#ADADAD] mt-[3px]">{hint}</div>}
      </div>
      <div className="flex-shrink-0 flex items-center gap-[9px]">{children}</div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-[34px]">
      <div className="text-[12px] font-normal text-[#6A635E] mb-[6px]">{title}</div>
      <div className="rounded-[11px] border border-[#E8E4E2] bg-[#FCFCFC] px-[20px] py-[4px] divide-y divide-[#F2F2F2]">
        {children}
      </div>
    </div>
  )
}

/** 토스 벤치마크 — 출력 여부와 매수를 하나로. 0이면 출력 안 함 */
function Stepper({ value, onChange, max = 5 }: { value: number; onChange: (n: number) => void; max?: number }) {
  return (
    <div className="flex items-center h-[32px] rounded-[9px] bg-[#F2F2F2] overflow-hidden">
      <button
        onClick={() => onChange(Math.max(0, value - 1))}
        disabled={value <= 0}
        className="w-[30px] h-full text-[#6A635E] text-[15px] disabled:text-[#D7D7D7] hover:bg-[#E8E4E2] transition-colors"
      >
        −
      </button>
      <span className="w-[34px] text-center text-[14px] text-[#1E1E1E]">{value}</span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="w-[30px] h-full text-[#6A635E] text-[15px] disabled:text-[#D7D7D7] hover:bg-[#E8E4E2] transition-colors"
      >
        +
      </button>
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`w-[44px] h-[25px] rounded-full transition-colors relative ${on ? 'bg-[#6A635E]' : 'bg-[#ADADAD]'}`}
    >
      <span className={`absolute top-[3px] left-[3px] w-[19px] h-[19px] rounded-full bg-[#FCFCFC] transition-transform ${on ? 'translate-x-[19px]' : ''}`} />
    </button>
  )
}

function SegButtons<T extends string>({ value, options, onChange }: {
  value: T
  options: { v: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-[5px]">
      {options.map(o => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`h-[30px] px-[11px] rounded-[8px] text-[12px] transition-colors ${
            value === o.v ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function SmallButton({ onClick, children, disabled, tone = 'plain' }: {
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
  tone?: 'plain' | 'dark'
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-[30px] px-[12px] rounded-[8px] text-[12px] font-medium disabled:opacity-40 transition-opacity ${
        tone === 'dark' ? 'bg-[#2C261F] text-[#F9F9F9] hover:opacity-90' : 'bg-[#F2F2F2] text-[#1E1E1E] hover:bg-[#E8E4E2]'
      }`}
    >
      {children}
    </button>
  )
}

/** 못 쓰는 기능을 숨기지 않고 "왜 + 어디로"를 같이 준다 (토스 벤치마크 3) */
function NotYet({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] font-normal text-[#ADADAD]">{children}</span>
}

// ── 허브 ───────────────────────────────────────────────────────────────────

export default function SettingsHub({
  initialTab, onBack, showToast,
}: {
  initialTab: SettingsHubTab
  onBack: () => void
  showToast: (msg: string) => void
}) {
  const [tab, setTab] = useState<SettingsHubTab>(initialTab)

  return (
    <HubLayout title="설정" items={NAV} activeKey={tab} onChange={setTab} onBack={onBack}>
      {tab === 'qr'      && <QrPrintPanel />}
      {tab === 'printer' && <PrinterPanel showToast={showToast} />}
      {tab === 'receipt' && <ReceiptPanel showToast={showToast} />}
      {tab === 'etc'     && <EtcPanel     showToast={showToast} />}
    </HubLayout>
  )
}

// ── §4. 프린터 연결 ─────────────────────────────────────────────────────────

/** VID/PID·제조사 문자열로 모델명을 추정. 실제로 만난 기기만 조금씩 채우면 된다. */
function guessModel(p: ComPort): string {
  const s = `${p.friendlyName ?? ''} ${p.manufacturer ?? ''}`.toUpperCase()
  if (s.includes('BIXOLON') || s.includes('SRP')) return 'BIXOLON 영수증 프린터'
  if (s.includes('EPSON') || s.includes('TM-'))   return 'EPSON TM 시리즈'
  if (s.includes('SEWOO') || s.includes('SLK'))   return 'SEWOO 영수증 프린터'
  return p.friendlyName || p.manufacturer || '알 수 없는 프린터'
}

/** 포트 이름으로 꽂힌 방식을 짐작해 사람 말로 적는다 */
function connectionHint(path: string): string {
  // Windows 네이티브 시리얼은 보통 COM1~COM2, 그 위는 USB-시리얼 변환으로 잡힌다
  const m = /^COM(\d+)$/i.exec(path)
  if (m && Number(m[1]) <= 2) return '포스기 뒤 9핀 포트에 꽂혀 있어요'
  if (path.startsWith('COM'))  return '이 포스에 USB로 꽂혀 있어요'
  return '이 포스에 연결돼 있어요'
}

function PrinterPanel({ showToast }: { showToast: (msg: string) => void }) {
  const { storeName } = useStore()
  const [diagOpen, setDiagOpen] = useState(false)
  const [ports,     setPorts]     = useState<ComPort[]>([])
  const [selected,  setSelected]  = usePersistentState('printer_port', '')
  const [connected, setConnected] = useState(false)
  const [scanning,  setScanning]  = useState(false)
  const [scanned,   setScanned]   = useState(false)
  const [testing,   setTesting]   = useState(false)

  // 문서별 매수 — 0이면 출력 안 함
  const [copies, setCopies] = usePersistentState('print_copies', { kitchen: 1, customer: 0, qr: 0 })

  useEffect(() => {
    api().getSettings?.().then(s => { if (s?.printer?.portName) setSelected(s.printer.portName) })
    api().onPrinterStatus?.(s => setConnected(s.connected))
    return () => api().offPrinterStatus?.()
  }, [])

  const scan = useCallback(async () => {
    setScanning(true)
    const list = (await api().listPorts?.()) ?? []
    setPorts(list)
    setScanned(true)
    setScanning(false)
    // 후보가 하나뿐이면 굳이 고르게 하지 않는다
    if (!selected && list.length === 1) setSelected(list[0].path)
  }, [selected])

  useEffect(() => { scan() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function connect(path: string) {
    setSelected(path)
    await api().updateSettings?.({ printer: { portName: path } })
    const r = await api().connectPrinter?.()
    showToast(r?.ok ? '프린터에 연결됐어요' : `연결 실패: ${r?.error ?? '알 수 없는 오류'}`)
  }

  async function test() {
    setTesting(true)
    const r = await api().testPrint?.()
    setTesting(false)
    showToast(r?.ok ? '테스트 영수증을 출력했어요' : `출력 실패: ${r?.error ?? '프린터를 먼저 연결해주세요'}`)
  }

  const diagnostic: PrinterDiagnostic = {
    storeName, connected, selected, ports, copies, appVersion: '1.0.1',
  }

  /**
   * 점주의 "안 돼요"를 구조화된 기록으로 바꾸는 장치 (§4-3 · 운영문서 §5.3).
   * ⚠️ 받을 곳이 아직 없어 지금은 클립보드 복사까지만 한다.
   *    support_tickets 테이블이 생기면 여기서 insert하고, 그 테이블이 Slack으로 흘러간다.
   */
  async function submitDiagnostic() {
    try {
      await navigator.clipboard.writeText(buildDiagnosticText(diagnostic))
      showToast('진단 내용을 복사했어요. 카카오톡 문의에 붙여넣어 보내주세요')
    } catch {
      showToast('복사에 실패했어요')
    }
    setDiagOpen(false)
  }

  return (
    <div>
      <HubSection
        title="프린터 연결"
        action={<SmallButton onClick={test} disabled={!connected || testing}>{testing ? '출력 중…' : '테스트 출력'}</SmallButton>}
      />

      {/* 연결 상태 */}
      <div className={`rounded-[11px] px-[20px] py-[14px] mb-[20px] flex items-center gap-[9px] ${
        connected ? 'bg-[#E6F4EC]' : 'bg-[#FFEFEF]'
      }`}>
        <span className={`w-[8px] h-[8px] rounded-full flex-shrink-0 ${connected ? 'bg-[#00DD67]' : 'bg-[#C92A2A]'}`} />
        <span className={`text-[13px] ${connected ? 'text-[#017333]' : 'text-[#C92A2A]'}`}>
          {connected ? `연결됨 — ${selected}` : selected ? `${selected} 를 찾았지만 아직 연결 전이에요` : '연결된 프린터가 없어요'}
        </span>
      </div>

      {/* 프린터 찾기 — 연결 방식을 고르게 하지 않는다 (§4-1 보강) */}
      <div className="flex items-center justify-between mb-[11px]">
        <span className="text-[12px] font-normal text-[#6A635E]">
          {scanned ? `찾은 프린터 ${ports.length}개` : '프린터를 찾는 중…'}
        </span>
        <SmallButton onClick={scan} disabled={scanning}>{scanning ? '찾는 중…' : '다시 찾기'}</SmallButton>
      </div>

      <div className="rounded-[11px] border border-[#E8E4E2] overflow-hidden mb-[12px]">
        {ports.length === 0 ? (
          <div className="bg-[#FCFCFC] py-[34px] text-center text-[13px] font-normal text-[#ADADAD]">
            연결된 프린터를 못 찾았어요
          </div>
        ) : ports.map((p, i) => {
          const on = p.path === selected
          return (
            <button
              key={p.path}
              onClick={() => connect(p.path)}
              className={`pressable-row w-full flex items-center px-[20px] h-[56px] bg-[#FCFCFC] text-left hover:bg-[#F9F9F9] ${
                i > 0 ? 'border-t border-[#F2F2F2]' : ''
              }`}
            >
              <span className={`w-[15px] h-[15px] rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                on ? 'border-[#6A635E]' : 'border-[#ADADAD]'
              }`}>
                {on && <span className="w-[7px] h-[7px] rounded-full bg-[#6A635E]" />}
              </span>
              <span className="min-w-0 ml-[11px]">
                <span className="block text-[13px] text-[#1E1E1E] truncate">{guessModel(p)}</span>
                <span className="block text-[11px] text-[#787878] truncate">{connectionHint(p.path)}</span>
              </span>
              <span className="text-[11px] text-[#ADADAD] ml-auto pl-[11px] flex-shrink-0">{p.path}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-[9px] mb-[34px]">
        <SmallButton onClick={() => showToast('IP로 직접 추가는 준비 중이에요 (네트워크 프린터는 2단계)')}>
          IP로 직접 추가
        </SmallButton>
      </div>

      {/* 문제를 겪는 사람이 설정을 더 만지기 전에 먼저 보이도록 출력 문서 위에 둔다 */}
      <div className="rounded-[11px] bg-[#F2F2F2] px-[20px] py-[16px] mb-[34px]">
        <div className="text-[12px] font-medium text-[#414141] mb-[7px]">연결이 안 되나요?</div>
        <ul className="text-[11px] font-normal text-[#787878] leading-[1.9] list-disc pl-[15px]">
          <li>프린터 전원과 선이 꽂혀 있는지 확인해 주세요</li>
          <li>다른 프로그램(기존 POS)이 프린터를 쓰고 있으면 잡히지 않아요</li>
          <li>그래도 안 되면 아래에서 지금 상태를 확인하고 문의해 주세요</li>
        </ul>
        <div className="flex justify-start mt-[10px]">
          <SmallButton tone="dark" onClick={() => setDiagOpen(true)}>프린터 연결 진단</SmallButton>
        </div>
      </div>

      {/* 문서별 매수 — 토스 벤치마크 2 */}
      <Group title="출력 문서">
        <Row label="주방 주문서" hint="조리용. 0으로 두면 출력하지 않아요">
          <Stepper value={copies.kitchen} onChange={n => setCopies(c => ({ ...c, kitchen: n }))} />
        </Row>
        <Row label="고객 영수증" hint="선결제 잔액이 함께 찍혀요">
          <Stepper value={copies.customer} onChange={n => setCopies(c => ({ ...c, customer: n }))} />
        </Row>
        <Row label="QR 안내증" hint="거래처 QR·PIN 안내">
          <Stepper value={copies.qr} onChange={n => setCopies(c => ({ ...c, qr: n }))} />
        </Row>
      </Group>

      {/* 어떤 문서가 어떻게 찍히는지 — 매수를 정하기 전에 모양부터 보여준다 */}
      <div className="mb-[34px]">
        <div className="text-[12px] font-normal text-[#6A635E] mb-[6px]">출력 미리보기</div>
        <ReceiptPreview />
      </div>

      {diagOpen && (
        <PrinterDiagnosticModal
          diagnostic={diagnostic}
          onClose={() => setDiagOpen(false)}
          onSubmit={submitDiagnostic}
        />
      )}


    </div>
  )
}

// ── §5. 영수증 · 증빙 ──────────────────────────────────────────────────────

type TextSize = 'normal' | 'large'
// '작게'는 뺐다 — 감열 영수증에서 1배 높이는 읽기 어렵고, 실제로 고르는 사람도 없었다
const SIZE_OPTS: { v: TextSize; label: string }[] = [
  { v: 'normal', label: '보통' }, { v: 'large', label: '크게' },
]

function ReceiptPanel({ showToast }: { showToast: (msg: string) => void }) {
  const [cfg, setCfg] = usePersistentState<ReceiptPreviewConfig>('receipt_config', DEFAULT_RECEIPT_CONFIG)
  const patch = (p: Partial<ReceiptPreviewConfig>) => setCfg(c => ({ ...c, ...p }))

  // ⚠️ localStorage 에만 두면 미리보기만 바뀌고 실제 영수증은 그대로다.
  //    인쇄는 메인 프로세스(electron/escpos.ts)가 electron-store 의 receipt 설정을 읽어
  //    하므로, 바뀔 때마다 그쪽으로도 보내야 한다. 실제로 이게 빠져 있어서
  //    글자 크기·하단 문구·잔액 토글이 전부 미리보기 전용이었다.
  useEffect(() => {
    api().updateSettings?.({
      receipt: {
        menuSize:           cfg.menuSize,
        optionSize:         cfg.optionSize,
        customerMenuSize:   cfg.menuSize,
        customerOptionSize: cfg.optionSize,
        amountSize:         cfg.amountSize,
        footerText:         cfg.footerText,
        showBalance:        cfg.showBalance,
      },
    })
  }, [cfg])
  const { menuSize, optionSize, amountSize, footerText: footer } = cfg

  return (
    <div>
      <HubSection title="영수증 · 증빙" />

      <Group title="영수증 모양">
        <Row label="용지 폭">
          <span className="text-[13px] text-[#1E1E1E]">58mm</span>
          <NotYet>80mm 준비 중</NotYet>
        </Row>
        <Row label="메뉴명 글자 크기">
          <SegButtons value={menuSize} options={SIZE_OPTS} onChange={v => patch({ menuSize: v })} />
        </Row>
        <Row label="옵션 글자 크기">
          <SegButtons value={optionSize} options={SIZE_OPTS} onChange={v => patch({ optionSize: v })} />
        </Row>
        <Row label="금액 글자 크기">
          <SegButtons value={amountSize} options={SIZE_OPTS} onChange={v => patch({ amountSize: v })} />
        </Row>
        <Row label="하단 문구">
          <input
            value={footer}
            onChange={e => patch({ footerText: e.target.value })}
            placeholder="감사합니다. 또 오세요"
            className="h-[32px] w-[220px] px-[11px] rounded-[9px] border border-[#ADADAD] text-[13px] text-[#1E1E1E] outline-none focus:border-[#6A635E]"
          />
        </Row>
      </Group>

      {/* 위에서 바꾼 글자 크기·하단 문구·잔액 표시가 그대로 반영된다 */}
      <div className="mb-[34px]">
        <div className="text-[12px] font-normal text-[#6A635E] mb-[6px]">미리보기</div>
        <ReceiptPreview config={cfg} initialKind="customer" />
      </div>

      {/* 선결제 증빙 — 카카오를 빼고 PDF → 문자 */}
      <div className="mb-[12px]">
        <div className="text-[12px] font-normal text-[#6A635E] mb-[6px]">선결제 증빙</div>
        <div className="rounded-[11px] border border-[#E8E4E2] bg-[#FCFCFC] px-[20px] py-[18px]">
          <div className="flex items-center justify-between gap-[16px]">
            <div className="min-w-0">
              <div className="text-[14px] font-normal text-[#1E1E1E]">선결제 영수증을 문자로 보내요</div>
              <div className="text-[11px] font-normal text-[#ADADAD] mt-[3px]">
                거래처 담당자에게 PDF 링크를 문자로 보냅니다. 링크는 90일간 열람할 수 있어요
              </div>
            </div>
            <SmallButton tone="dark" onClick={() => showToast('선결제 영수증 보내기는 준비 중이에요')}>
              선결제 영수증 보내기
            </SmallButton>
          </div>
        </div>
      </div>

      <div className="rounded-[11px] border border-[#E8E4E2] overflow-hidden">
        <div className="flex items-center bg-[#E8E4E2] px-[20px] h-[36px] text-[11px] font-normal text-[#6A635E]">
          <span className="w-[100px]">보낸 날짜</span>
          <span className="flex-1 min-w-0">거래처</span>
          <span className="w-[100px] text-right">금액</span>
          <span className="w-[120px] text-right">받는 번호</span>
          <span className="w-[70px] text-right">상태</span>
        </div>
        <div className="bg-[#FCFCFC] py-[34px] text-center text-[12px] font-normal text-[#ADADAD]">
          아직 보낸 증빙이 없어요
        </div>
      </div>

      <div className="mt-[12px] text-[11px] font-normal text-[#ADADAD]">
        문자 본문에는 금액과 거래처명을 넣지 않아요. 문자는 평문으로 남고 잘못 보내면 회수가 안 되니, 내용은 링크 안에만 둡니다.
      </div>
    </div>
  )
}

// ── §6. 기타 설정 ──────────────────────────────────────────────────────────

function EtcPanel({ showToast }: { showToast: (msg: string) => void }) {
  const { storeName } = useStore()
  const [volume,       setVolume]       = useState(getSavedVolume)
  const [repeatAlarm,  setRepeatAlarm]  = usePersistentState('repeat_alarm', false)
  const [repeatSec,    setRepeatSec]    = usePersistentState('repeat_sec', 10)
  const [alarmCount,   setAlarmCount]   = usePersistentState('alarm_count', 1)
  const [keepAwake,    setKeepAwake]    = usePersistentState('keep_awake', true)

  const [appVersion,  setAppVersion]  = useState('—')
  const [checking,    setChecking]    = useState(false)
  const [updateMsg,   setUpdateMsg]   = useState('')
  const [report,      setReport]      = useState<DiagnosticReport | null>(null)

  // 버전은 package.json 이 아니라 메인 프로세스(app.getVersion())에서 받는다.
  // 전에는 '1.0.1' 이 화면에 박혀 있어서 실제 버전과 달랐다.
  useEffect(() => { api().appVersion?.().then(setAppVersion).catch(() => setAppVersion('—')) }, [])

  // 화면 꺼짐 방지는 저장만 하면 아무 일도 안 일어난다 — 메인 프로세스의
  // powerSaveBlocker 를 실제로 켜고 꺼야 한다. 토글이 바뀔 때마다 반영한다.
  useEffect(() => { api().keepAwake?.(keepAwake).catch(() => {}) }, [keepAwake])

  async function checkUpdate() {
    setChecking(true); setUpdateMsg('')
    try {
      const r = await api().updaterCheck?.()
      // Electron 밖(브라우저 미리보기)에서는 창구가 없다
      if (!r) { setUpdateMsg('이 환경에서는 확인할 수 없어요'); return }
      if (r.state === 'available')     setUpdateMsg(`새 버전 ${r.latest} 이 있어요. 받는 중이에요`)
      else if (r.state === 'latest')   setUpdateMsg(`최신 버전이에요 (${r.current})`)
      else if (r.state === 'no-feed')  setUpdateMsg('지금은 자동 업데이트가 준비되지 않았어요. 새 버전은 설치파일로 전달드려요')
      else                             setUpdateMsg('확인에 실패했어요. 인터넷 연결을 확인해 주세요')
    } catch {
      setUpdateMsg('확인에 실패했어요')
    } finally {
      setChecking(false)
    }
  }

  async function openLogs() {
    const r = await api().openLogs?.()
    if (!r)        { showToast('이 환경에서는 열 수 없어요'); return }
    if (!r.ok)     { showToast('로그 폴더를 열지 못했어요'); return }
    showToast('로그 폴더를 열었어요')
  }

  /**
   * 보내기 전에 보여줄 내용을 만든다.
   *
   * 무엇을 넣을지는 "실제로 들어오는 문의"로 정했다 —
   * 되묻지 않고 원인을 좁힐 수 있는 것만 남긴다.
   *   "영수증이 안 나와요" → 프린터 포트·연결 상태
   *   "소리가 안 나요"     → 알림음 설정(볼륨 0, 횟수, 반복)
   *   그 외 전부          → 버전·플랫폼
   */
  async function buildReport() {
    const d = await api().diagnostics?.().catch(() => null)
    const now = new Date().toLocaleString('ko-KR')
    const sound = `볼륨 ${volume} · ${alarmCount}회 · 반복 ${repeatAlarm ? `${repeatSec}초` : '끔'}`
    const rows = [
      { label: '매장',    value: storeName || '(미설정)' },
      { label: '앱 버전', value: d ? `${d.version} (${d.platform} ${d.arch})` : appVersion },
      { label: '프린터',  value: d ? (d.printerConnected ? `연결됨 (${d.printerPort})` : '끊김') : '알 수 없음' },
      { label: '알림음',  value: volume === 0 ? `${sound} — 볼륨이 0이에요` : sound },
    ]
    const text = [
      '[선포스 진단]',
      `시각       ${now}`,
      `매장       ${storeName || '(미설정)'}`,
      `앱 버전    ${d?.version ?? appVersion}`,
      ...(d ? [
        `플랫폼     ${d.platform} ${d.arch} (OS ${d.osRelease})`,
        `Electron   ${d.electron} / Chrome ${d.chrome} / Node ${d.node}`,
        `프린터     ${d.printerConnected ? '연결됨' : '끊김'} / 포트 ${d.printerPort || '(미설정)'}`,
        `로그폴더   ${d.logDir}`,
      ] : ['(메인 프로세스 정보를 읽지 못했어요)']),
      `알림음     볼륨 ${volume} / ${alarmCount}회 / 반복 ${repeatAlarm ? `${repeatSec}초` : '끔'}`,
      `UA         ${navigator.userAgent}`,
    ].join('\n')
    setReport({ text, rows })
  }

  /**
   * 보내기 — 점주가 복사해서 어딘가에 붙여넣는 대신 Sentry 로 바로 올린다.
   * 크래시는 이미 Sentry 가 자동으로 받고 있고(main.tsx 에서 init),
   * 이건 "크래시는 아닌데 이상하다"를 점주가 직접 올리는 창구다.
   *
   * 접수번호(Sentry event id)를 돌려주는 게 중요하다 — 점주가 "보냈어요"만 보면
   * 진짜 갔는지 알 수 없고, 나중에 어느 건인지 짚을 수도 없다.
   */
  async function sendReport(r: DiagnosticReport): Promise<string | null> {
    const d = await api().diagnostics?.().catch(() => null)
    return Sentry.captureMessage(`[진단 리포트] ${storeName || '매장 미설정'}`, {
      level: 'info',
      tags: {
        kind: 'diagnostic-report',
        store: storeName || 'unknown',
        printer: d ? (d.printerConnected ? 'connected' : 'disconnected') : 'unknown',
      },
      extra: { report: r.text, volume, alarmCount, repeatAlarm, repeatSec, ...(d ?? {}) },
    }) ?? null
  }

  return (
    <div>
      <HubSection title="기타 설정" />

      <Group title="알림">
        <Row label="새 주문 알림음">
          <input
            type="range" min={0} max={100} value={volume}
            onChange={e => setVolume(Number(e.target.value))}
            onMouseUp={e => saveVolume(Number((e.target as HTMLInputElement).value))}
            className="w-[120px] h-[4px] cursor-pointer volume-slider"
            style={{ background: `linear-gradient(to right, #6A635E 0%, #6A635E ${volume}%, #E5E7EB ${volume}%, #E5E7EB 100%)` }}
          />
          <span className="text-[12px] text-[#787878] w-[26px] text-right">{volume}</span>
          <SmallButton onClick={() => playOrderSound(volume, alarmCount)}>미리 듣기</SmallButton>
        </Row>
        <Row label="알림 횟수" hint="새 주문이 들어올 때 소리를 몇 번 낼지">
          <CountStepper value={alarmCount} min={1} max={10} suffix="회" onChange={setAlarmCount} />
        </Row>
        <Row label="주문을 확인할 때까지 알림 반복" hint="피크타임에 주문음을 한 번 놓치면 그 주문은 증발해요">
          <Toggle on={repeatAlarm} onChange={setRepeatAlarm} />
        </Row>
        {repeatAlarm && (
          <Row label="반복 간격">
            <SegButtons
              value={String(repeatSec)}
              options={[
                { v: '1',  label: '1초' },
                { v: '2',  label: '2초' },
                { v: '3',  label: '3초' },
                { v: '5',  label: '5초' },
                { v: '10', label: '10초' },
              ]}
              onChange={v => setRepeatSec(Number(v))}
            />
          </Row>
        )}
      </Group>

      {/* '시작 화면'은 뺐다 — 고르게 해놓고 실제로는 아무 데도 안 쓰이고 있었다.
          '주문 처리' 묶음(자동 접수·완료 숨기기·취소 가능 단계)도 통째로 뺐다.
          셋 다 localStorage 에 값만 쌓고 읽는 곳이 한 군데도 없었다 — 켜도 꺼도
          동작이 같은 스위치는 점주에게 "설정했는데 왜 그대로지"만 남긴다. */}
      <Group title="화면">
        <Row label="영업 중 화면 꺼짐 방지" hint="주문을 보는 동안 모니터가 절전으로 꺼지지 않아요">
          <Toggle on={keepAwake} onChange={setKeepAwake} />
        </Row>
      </Group>

      <Group title="데이터">
        <Row label="진단 리포트 보내기" hint="문제가 생겼을 때 눌러주세요. 무엇이 가는지 먼저 보여드려요">
          <SmallButton onClick={buildReport}>내용 보기</SmallButton>
        </Row>
        <Row label="앱 버전">
          <span className="text-[13px] text-[#1E1E1E] tabular-nums">{appVersion}</span>
          <SmallButton onClick={checkUpdate} disabled={checking}>
            {checking ? '확인 중…' : '업데이트 확인'}
          </SmallButton>
        </Row>
        {updateMsg && (
          <div className="pl-[2px] pb-[10px] text-[12px] font-normal text-[#6A635E]">{updateMsg}</div>
        )}
        <Row label="로그 폴더 열기" hint="문제가 생긴 시각의 기록이 들어 있어요">
          <SmallButton onClick={openLogs}>열기</SmallButton>
        </Row>
      </Group>

      {report && (
        <DiagnosticReportModal
          report={report}
          onSend={() => sendReport(report)}
          onClose={() => setReport(null)}
        />
      )}
    </div>
  )
}
