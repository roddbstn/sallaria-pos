import { useState, useEffect, useCallback } from 'react'
import Working from '../components/ui/Working'
import { getAppVersion } from '../lib/ipc'
import { usePersistentState } from '../hooks/usePersistentState'
import CountStepper from '../components/ui/CountStepper'
import QrPrintPanel from './QrPrintPanel'
import HubLayout, { HubSection, type HubNavItem } from '../components/hub/HubLayout'
import { playOrderSound, startOrderAlarm, stopOrderAlarm, getSavedVolume, saveVolume } from '../lib/sound'
import { useStore } from '../lib/store-context'
import ReceiptPreview, { DEFAULT_RECEIPT_CONFIG, type ReceiptPreviewConfig } from '../components/ui/ReceiptPreview'
import PrinterDiagnosticModal, { buildDiagnosticText, type PrinterDiagnostic } from '../components/ui/PrinterDiagnosticModal'
import DiagnosticReportModal, { type DiagnosticReport } from '../components/ui/DiagnosticReportModal'
import * as Sentry from '@sentry/electron/renderer'
import { usePrinterConfig } from '../hooks/usePrinterConfig'
import { usePrinterStatus, setPrinterStatus } from '../hooks/usePrinterStatus'
import {
  PAPER_CHOICES, LINK_CHOICES, BAUD_RATES, DEFAULT_TCP_PORT,
  paperChoice, effectiveLineChars, configProblem,
  type PaperWidth, type PrinterLink, type PrinterConfig,
} from '../lib/printer-paper'

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
/** 운영체제가 아는 프린터(Windows 스풀러 · macOS CUPS). 출력용이 아니라 안내용이다 */
type OsPrinter = {
  name: string; displayName: string; description: string; deviceUri: string
  /** 큐에는 있지만 지금은 못 쓰는 상태(케이블 빠짐·전원 꺼짐) */
  offline: boolean
  stateReason: string
}

type ComPort = {
  path: string; manufacturer?: string; friendlyName?: string
  vendorId?: string; productId?: string; pnpId?: string
}
type Api = {
  getSettings?:     () => Promise<{ printer?: PrinterConfig }>
  listPorts?:       () => Promise<ComPort[]>
  connectPrinter?:  () => Promise<{ ok: boolean; error?: string }>
  testPrint?:       () => Promise<{ ok: boolean; error?: string }>
  updateSettings?:  (p: unknown) => Promise<{ ok: boolean }>
  onPrinterStatus?: (cb: (s: { connected: boolean; queueLength: number }) => void) => void
  offPrinterStatus?:() => void
  // 기타 설정이 쓰는 창구 — 전체 정의는 src/vite-env.d.ts 의 PosBridge 에 있다
  appVersion?:      () => Promise<string>
  listOsPrinters?:  () => Promise<OsPrinter[]>
  openLogs?:        () => Promise<{ ok: boolean; dir: string; error?: string }>
  keepAwake?:       (on: boolean) => Promise<{ active: boolean; platform: string }>
  updaterCheck?:    () => Promise<{ state: 'latest' | 'available' | 'no-feed' | 'error'; current: string; latest?: string; message?: string }>
  diagnostics?:     () => Promise<{
    version: string; electron: string; chrome: string; node: string
    platform: string; arch: string; osRelease: string; logDir: string
    printerPort: string; printerConnected: boolean
    paperWidth: string; lineChars: number; link: string; baudRate: number; lanHost: string
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

// ── 용지·연결 공용 조각 ────────────────────────────────────────────────────
//
// 용지 넓이는 '프린터 연결'과 '영수증·증빙' 두 화면에 다 나온다. 점주가 어느 쪽에서
// 찾든 있어야 하고, 둘이 같은 값을 보여야 한다 — 그래서 usePrinterConfig 하나를
// 공유하고 컨트롤도 한 곳에서 정의한다.

function PaperWidthRow() {
  const { cfg, patch } = usePrinterConfig()
  const choice = paperChoice(cfg.paperWidth)
  return (
    <Row label="용지 넓이">
      <SegButtons
        value={choice.key}
        options={PAPER_CHOICES.map(c => ({ v: c.key, label: c.label }))}
        onChange={(v: PaperWidth) => {
          // 넓이를 바꾸면 미세조정값은 버린다. 57mm 로 옮기면서 42자가 남아 있으면
          // 구분선이 종이보다 길어 두 줄로 접힌다.
          patch({ paperWidth: v, lineChars: undefined })
        }}
      />
    </Row>
  )
}

// ── §4. 프린터 연결 ─────────────────────────────────────────────────────────

/**
 * USB-시리얼 변환 칩 제조사(VID). 값싼 영수증 프린터는 대부분 이 칩을 거쳐 붙는다 —
 * 그래서 제조사 문자열에 프린터 이름이 아니라 칩 제조사가 뜬다.
 * 프린터 모델까지는 알 수 없지만 "USB로 꽂힌 장치"라는 건 확실히 말할 수 있다.
 */
const USB_SERIAL_VIDS: Record<string, string> = {
  '1A86': 'USB 연결 장치 (CH340)',
  '0403': 'USB 연결 장치 (FTDI)',
  '067B': 'USB 연결 장치 (Prolific)',
  '10C4': 'USB 연결 장치 (Silicon Labs)',
}

/** 영수증 프린터를 직접 만드는 제조사 VID */
const PRINTER_VIDS: Record<string, string> = {
  '04B8': 'EPSON 영수증 프린터',
  '1504': 'BIXOLON 영수증 프린터',
  '0519': 'Star 영수증 프린터',
}

/**
 * macOS 가 기본으로 들고 있는 시리얼 장치. 프린터가 아니다.
 *
 * 개발 중에 이 화면을 열면 /dev/tty.debug-console · tty.wlan-debug ·
 * tty.Bluetooth-Incoming-Port 세 개가 늘 뜬다. 실제 배포는 Windows 라
 * 점주 화면에는 안 나오지만, 개발 화면에서 "프린터 3개 찾음"으로 보이면
 * 매번 헷갈린다.
 */
const MAC_SYSTEM_PORTS = ['debug-console', 'wlan-debug', 'Bluetooth-Incoming-Port']

// export 하지 않는다 — 이 파일은 컴포넌트 파일이라 함수를 export 하면
// Vite Fast Refresh 가 깨진다("isSystemPort export is incompatible").
// 다른 파일에서 필요해지면 그때 lib/ 로 옮긴다.
function isSystemPort(path: string): boolean {
  return MAC_SYSTEM_PORTS.some(n => path.includes(n))
}

/**
 * 제조사·VID/PID 로 모델명을 추정. 실제로 만난 기기만 조금씩 채우면 된다.
 *
 * ⚠️ path 로 폴백하지 않는다. 전엔 메인 프로세스가 friendlyName 이 없을 때
 *    path 를 넣어 보내서, 이 함수가 "/dev/tty.Bluetooth-Incoming-Port" 를
 *    제품명으로 알고 그대로 찍었다. path 는 아래 줄에 따로 작게 보여준다.
 */
function guessModel(p: ComPort): string {
  const s = `${p.friendlyName ?? ''} ${p.manufacturer ?? ''}`.toUpperCase()
  if (s.includes('BIXOLON') || s.includes('SRP')) return 'BIXOLON 영수증 프린터'
  if (s.includes('EPSON') || s.includes('TM-'))   return 'EPSON TM 시리즈'
  if (s.includes('SEWOO') || s.includes('SLK'))   return 'SEWOO 영수증 프린터'

  // 문자열이 비었을 때(macOS·드라이버 미설치) VID 로 한 번 더 시도
  const vid = (p.vendorId ?? '').toUpperCase()
  if (PRINTER_VIDS[vid])     return PRINTER_VIDS[vid]
  if (USB_SERIAL_VIDS[vid])  return USB_SERIAL_VIDS[vid]

  // friendlyName 이 있으면 그걸(Windows 는 "POS-80 (COM3)" 처럼 들어온다),
  // 없으면 제조사, 그마저 없으면 솔직하게 모른다고 한다.
  if (p.friendlyName) return p.friendlyName
  if (p.manufacturer) return p.manufacturer
  if (isSystemPort(p.path)) return '이 컴퓨터의 시스템 포트 (프린터 아님)'
  return '이름을 알 수 없는 장치'
}

/** 포트 이름으로 꽂힌 방식을 짐작해 사람 말로 적는다 */
function connectionHint(path: string): string {
  // Windows 네이티브 시리얼은 보통 COM1~COM2, 그 위는 USB-시리얼 변환으로 잡힌다
  const m = /^COM(\d+)$/i.exec(path)
  if (m && Number(m[1]) <= 2) return '포스기 뒤 9핀 포트에 꽂혀 있어요'
  if (path.startsWith('COM'))  return '이 포스에 USB로 꽂혀 있어요'
  // 개발용 맥에서만 보이는 것들 — 프린터로 오해하지 않게 분명히 적는다
  if (isSystemPort(path))      return '맥 기본 포트예요 — 프린터가 아닙니다'
  return '이 포스에 연결돼 있어요'
}

function PrinterPanel({ showToast }: { showToast: (msg: string) => void }) {
  // 진단에 붙는 앱 버전 — 하드코딩하면 안 된다.
  // 아래 diagnostic 에 '1.0.1' 이 박혀 있었고 실제 배포는 1.1.0 이었다. 원격 지원에서
  // "어느 버전 쓰세요?"의 답이 늘 틀려 있으면 진단 정보를 붙이는 의미가 없다.
  const [diagAppVersion, setDiagAppVersion] = useState('unknown')
  useEffect(() => { void getAppVersion().then(setDiagAppVersion) }, [])
  const { storeName } = useStore()
  const { cfg, patch } = usePrinterConfig()
  const [diagOpen, setDiagOpen] = useState(false)
  const [ports,     setPorts]     = useState<ComPort[]>([])
  /** 시리얼로는 안 잡히지만 OS 는 알고 있는 프린터 — "0개" 라고 거짓말하지 않기 위해 */
  const [osPrinters, setOsPrinters] = useState<OsPrinter[]>([])
  const [selected,  setSelected]  = usePersistentState('printer_port', '')
  // 모듈 캐시에서 읽는다 — 화면을 다시 열어도 아는 값부터 보여준다.
  // null = 아직 모름(끊김이 아니다). hooks/usePrinterStatus.ts 주석 참고.
  const status    = usePrinterStatus()
  const connected = status?.connected === true
  const unknown   = status === null
  const setConnected = (v: boolean) => setPrinterStatus({ connected: v, queueLength: status?.queueLength ?? 0 })
  const [scanning,  setScanning]  = useState(false)
  const [scanned,   setScanned]   = useState(false)

  // 문서별 매수 — 0이면 출력 안 함
  const [copies, setCopies] = usePersistentState('print_copies', { kitchen: 1, customer: 0, qr: 0 })

  useEffect(() => {
    api().getSettings?.().then(s => { if (s?.printer?.portName) setSelected(s.printer.portName) })
    // printer:status 구독은 usePrinterStatus 가 **한 곳에서만** 건다.
    // 여기서 또 걸면 preload 의 offPrinterStatus(removeAllListeners)가
    // 이 화면을 떠날 때 다른 구독까지 같이 끊는다.
  }, [])

  /** 지금 출력 대상의 이름 — 시리얼이면 COM 포트, USB 면 OS 프린터 이름 */
  const targetLabel = selected || (cfg.osPrinter ?? '')

  const scan = useCallback(async () => {
    setScanning(true)
    // 둘을 같이 본다. 시리얼 목록이 비어 있어도 OS 가 프린터를 알고 있으면
    // 그걸 알려줘야 한다 — USB 영수증 프린터는 시리얼이 아니라 '프린터'로 등록된다.
    const [list, osList] = await Promise.all([
      api().listPorts?.().then(r => r ?? []) ?? Promise.resolve([]),
      api().listOsPrinters?.().then(r => r ?? []) ?? Promise.resolve([] as OsPrinter[]),
    ])
    setPorts(list)
    setOsPrinters(osList)
    setScanned(true)
    setScanning(false)
    // 후보가 하나뿐이면 굳이 고르게 하지 않는다 (시스템 포트는 후보가 아니다)
    const candidates = list.filter(x => !isSystemPort(x.path))
    if (!selected && candidates.length === 1) setSelected(candidates[0].path)
  }, [selected])

  useEffect(() => { scan() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * USB(OS 프린터)를 출력 대상으로 고른다.
   *
   * portName 을 **비운다** — 메인 프로세스의 우선순위가 LAN > COM > OS프린터 라서,
   * 예전에 고른 COM 포트가 남아 있으면 그쪽으로 가버린다.
   */
  async function connectOsPrinter(name: string) {
    setSelected('')
    await patch({ osPrinter: name, portName: '', link: 'usb' })
    const r = await api().connectPrinter?.()
    showToast(r?.ok ? `${name} 에 연결됐어요` : `연결 실패: ${r?.error ?? '알 수 없는 오류'}`)
    setConnected(!!r?.ok)
  }

  async function connect(path: string) {
    setSelected(path)
    // ⚠️ patch 로 보낸다. 전에는 { printer: { portName } } 를 통째로 보내서
    //    settings:update 가 printer 객체를 덮어쓰며 용지 넓이·연결수단·보율을 날렸다.
    // osPrinter 를 비운다 — 둘 다 설정돼 있으면 메인 프로세스가 COM 을 먼저 쓰므로
    // 동작은 맞지만, 설정 화면과 실제 출력 대상이 어긋나 보인다.
    await patch({ portName: path, osPrinter: '' })
    const r = await api().connectPrinter?.()
    showToast(r?.ok ? '프린터에 연결됐어요' : `연결 실패: ${r?.error ?? '알 수 없는 오류'}`)
  }

  const diagnostic: PrinterDiagnostic = {
    storeName, connected, selected, ports, copies, appVersion: diagAppVersion,
    paper: {
      width:    paperChoice(cfg.paperWidth).label.replace('mm', ''),
      lineChars: effectiveLineChars(cfg),
      link:     cfg.link ?? 'serial',
      baudRate: cfg.baudRate,
      host:     cfg.host,
    },
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
      />

      {/* 연결 상태 */}
      {/* '아직 모름'을 끊김과 구분한다. 전엔 둘 다 빨간 글씨라, 화면을 다시 열 때마다
          멀쩡히 연결된 프린터를 두고 "아직 연결 전이에요"가 몇 초씩 떴다. */}
      <div className={`rounded-[11px] px-[20px] py-[14px] mb-[20px] flex items-center gap-[9px] ${
        unknown ? 'bg-[#F2F2F2]' : connected ? 'bg-[#E6F4EC]' : 'bg-[#FFEFEF]'
      }`}>
        <span className={`w-[8px] h-[8px] rounded-full flex-shrink-0 ${
          unknown ? 'bg-[#ADADAD]' : connected ? 'bg-[#00DD67]' : 'bg-[#C92A2A]'
        }`} />
        <span className={`text-[13px] ${
          unknown ? 'text-[#787878]' : connected ? 'text-[#017333]' : 'text-[#C92A2A]'
        }`}>
          {/* 연결 대상 이름은 시리얼이면 포트, USB 면 OS 프린터 이름이다.
              전엔 selected(포트)만 썼더니 USB 로 연결했을 때 '연결됨 — ' 처럼
              뒤가 비어 보였다. 구분선(—)도 뺀다. */}
          {unknown
            ? <Working label={targetLabel ? `${targetLabel} 상태 확인 중` : '프린터 상태 확인 중'} />
            : connected
              ? `연결됨 ${targetLabel}`
              : targetLabel
                ? `${targetLabel} 를 찾았지만 아직 연결 전이에요`
                : '연결된 프린터가 없어요'}
        </span>
      </div>

      {/* 프린터 찾기 — 연결 방식을 고르게 하지 않는다 (§4-1 보강) */}
      <div className="flex items-center justify-between mb-[11px]">
        {/* 개수는 아래 목록과 **같은 기준**으로 센다. 맥 기본 포트(debug-console 등)는
            프린터가 아니라서 목록에서 빼는데, 전엔 개수에는 포함돼 개발 중에 늘
            "찾은 프린터 3개"로 보였다. 뺀 게 있으면 뺐다고 적는다. */}
        <span className="text-[12px] font-normal text-[#6A635E]">
          {scanned
            ? (() => {
                const sys = ports.filter(x => isSystemPort(x.path)).length
                return `찾은 프린터 ${ports.length - sys}개${sys > 0 ? ` (시스템 포트 ${sys}개 제외)` : ''}`
              })()
            : <Working label="프린터를 찾는 중" />}
        </span>
        <SmallButton onClick={scan} disabled={scanning}>{scanning ? <Working label="찾는 중" /> : '다시 찾기'}</SmallButton>
      </div>

      <div className="rounded-[11px] border border-[#E8E4E2] overflow-hidden mb-[12px]">
        {ports.filter(x => !isSystemPort(x.path)).length === 0 ? (
          <div className="bg-[#FCFCFC] px-[20px] py-[26px]">
            {/* 바탕 없이 회색 글자만 두니 "빈 영역"처럼 보여서 안내가 눈에 안 들어왔다.
                한 단계 어두운 바탕을 깔아 '지금 이게 상태다'로 읽히게 한다. */}
            <div className="rounded-[10px] bg-[#E8E4E2] px-[16px] py-[18px] text-center text-[13px] font-normal text-[#6A635E]">
              연결된 프린터를 못 찾았어요
            </div>

            {/* USB 로 꽂아 OS 가 '프린터'로 등록한 경우 — **고를 수 있게** 보여준다.
                영수증 프린터를 USB 로 꽂으면 시리얼 포트가 아니라 '프린터'로 등록되는
                일이 흔하다(맥은 거의 항상). 그러면 위 시리얼 목록은 비는데 프린터는
                눈앞에 꽂혀 있다. 전엔 "못 찾았어요" 한 줄만 떠서 길이 없었다.
                이제 메인 프로세스가 스풀러/CUPS 에 원시 ESC/POS 를 보낼 수 있다. */}
            {osPrinters.length > 0 && (
              <div className="mt-[18px]">
                {/* ⚠️ "꽂힌" 이 아니라 "등록된" 이다 — USB 프린터를 뽑아도
                    CUPS/스풀러의 큐는 남아서 목록에 계속 보인다.
                    꺼진 기기가 몇 개인지는 여기서 빨갛게 세지 않는다. 바로 아래
                    목록의 각 줄에 '연결 안 됨' 배지로 이미 적혀 있고, 머리줄에서까지
                    빨간 글씨로 말하면 같은 말을 두 번 하면서 경고처럼만 읽힌다. */}
                <div className="text-[12px] font-medium text-[#6A635E] mb-[8px]">
                  등록된 프린터 {osPrinters.length}개
                </div>
                <div className="rounded-[10px] border border-[#E8E4E2] overflow-hidden">
                  {osPrinters.map((op, i) => {
                    const on = cfg.osPrinter === op.name
                    return (
                      <button
                        key={op.name}
                        onClick={() => connectOsPrinter(op.name)}
                        // 꺼져 있는 프린터는 고를 수 없다 — 골라봐야 출력이 안 된다.
                        disabled={op.offline}
                        className={`pressable-row w-full flex items-center px-[16px] h-[52px] bg-[#FCFCFC] text-left hover:bg-[#F9F9F9] disabled:hover:bg-[#FCFCFC] disabled:cursor-not-allowed ${
                          i > 0 ? 'border-t border-[#F2F2F2]' : ''
                        }`}
                      >
                        <span className={`w-[15px] h-[15px] rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                          op.offline ? 'border-[#E0E0E0]' : on ? 'border-[#6A635E]' : 'border-[#ADADAD]'
                        }`}>
                          {on && !op.offline && <span className="w-[7px] h-[7px] rounded-full bg-[#6A635E]" />}
                        </span>
                        <span className="min-w-0 ml-[11px] flex-1">
                          <span className={`block text-[13px] truncate ${op.offline ? 'text-[#ADADAD]' : 'text-[#1E1E1E]'}`}>
                            {op.displayName}
                          </span>
                          <span className="block text-[11px] text-[#787878] truncate">
                            {op.offline
                              ? '케이블이 빠졌거나 전원이 꺼져 있어요'
                              : (op.deviceUri || '이 컴퓨터에 등록된 프린터예요')}
                          </span>
                        </span>
                        {op.offline && (
                          <span className="flex-shrink-0 ml-[10px] text-[11px] font-medium text-[#C92A2A] px-[8px] py-[3px] rounded-[6px] bg-[#FFEFEF]">
                            연결 안 됨
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        ) : ports.filter(x => !isSystemPort(x.path)).map((p, i) => {
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

      {/* ── 일반 프린터(A4) — 영수증 프린터와 **따로** 둔다 ──
          감열 영수증기와 A4 레이저를 같이 쓰는 매장이 많다. 전엔 영수증만 설정에
          저장해 두고 A4(QR 종이)는 뽑을 때마다 브라우저 인쇄 대화상자에서 손으로
          골라야 했다 — 같은 앱 안에서 앞뒤가 안 맞는 동작이었다.
          여기서 골라 두면 대화상자 없이 바로 나간다. 비워 두면 예전 그대로다. */}
      <div className="mt-[26px]">
        <div className="flex items-center justify-between mb-[8px]">
          <span className="text-[12px] font-medium text-[#6A635E]">
            일반 프린터 (QR 종이·A4)
          </span>
          {cfg.docPrinter && (
            <button
              onClick={() => patch({ docPrinter: '' })}
              className="text-[12px] font-normal text-[#6A635E] hover:text-ink transition-colors"
            >
              해제
            </button>
          )}
        </div>

        {osPrinters.length === 0 ? (
          <div className="rounded-[10px] bg-[#F2F2F2] px-[16px] py-[14px] text-[12px] font-normal text-[#787878]">
            이 컴퓨터에 등록된 프린터가 없어요. 안 골라도 괜찮아요 — 그때는 인쇄 창이 떠요.
          </div>
        ) : (
          <div className="rounded-[10px] border border-[#E8E4E2] overflow-hidden">
            {osPrinters.map((op, i) => {
              const on = cfg.docPrinter === op.name
              return (
                <button
                  key={op.name}
                  onClick={() => patch({ docPrinter: on ? '' : op.name })}
                  disabled={op.offline}
                  className={`pressable-row w-full flex items-center px-[16px] h-[48px] bg-[#FCFCFC] text-left hover:bg-[#F9F9F9] disabled:hover:bg-[#FCFCFC] disabled:cursor-not-allowed ${
                    i > 0 ? 'border-t border-[#F2F2F2]' : ''
                  }`}
                >
                  <span className={`w-[15px] h-[15px] rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    op.offline ? 'border-[#E0E0E0]' : on ? 'border-[#6A635E]' : 'border-[#ADADAD]'
                  }`}>
                    {on && !op.offline && <span className="w-[7px] h-[7px] rounded-full bg-[#6A635E]" />}
                  </span>
                  <span className="min-w-0 ml-[11px] flex-1">
                    <span className={`block text-[13px] truncate ${op.offline ? 'text-[#ADADAD]' : 'text-[#1E1E1E]'}`}>
                      {op.displayName}
                    </span>
                    <span className="block text-[11px] text-[#787878] truncate">
                      {op.offline ? '케이블이 빠졌거나 전원이 꺼져 있어요' : 'QR 종이를 여기로 보내요'}
                    </span>
                  </span>
                  {/* 영수증 프린터로도 같은 기기를 골라 둔 경우 — 감열지에 A4 를 보내면
                      종이만 버린다. 막지는 않되(쓰는 방식이 매장마다 다르다) 알려준다. */}
                  {on && cfg.osPrinter === op.name && (
                    <span className="flex-shrink-0 ml-[10px] text-[11px] font-medium text-[#B35C00] px-[8px] py-[3px] rounded-[6px] bg-[#FFF4E8]">
                      영수증과 같은 기기
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
        <div className="text-[11px] font-normal text-[#ADADAD] mt-[6px] leading-relaxed">
          안 고르면 QR 종이를 뽑을 때 인쇄 창이 떠요.
        </div>
      </div>

      {/* 용지 넓이와 연결 수단 — 출력 비율이 여기서 정해진다.
          조사한 기기(세우·빅솔론·시원아이티)의 포트는 9핀 시리얼·USB·RJ45·블루투스 넷인데,
          앞의 셋 중 시리얼·USB·블루투스는 윈도우에서 모두 COM 포트로 잡혀 통신 코드가 같다.
          LAN 만 TCP 9100 이라 경로가 다르다. */}
      <Group title="용지와 연결">
        <PaperWidthRow />
        <Row label="연결 수단" hint={LINK_CHOICES.find(l => l.key === (cfg.link ?? 'serial'))?.hint}>
          <SegButtons
            value={(cfg.link ?? 'serial') as PrinterLink}
            options={LINK_CHOICES.map(l => ({ v: l.key, label: l.label }))}
            onChange={(v: PrinterLink) => patch({ link: v })}
          />
        </Row>

        {cfg.link === 'lan' ? (
          <>
            <Row label="프린터 IP" hint="프린터 설정 출력물이나 공유기 관리화면에서 확인할 수 있어요">
              <input
                value={cfg.host ?? ''}
                onChange={e => patch({ host: e.target.value.trim() })}
                placeholder="192.168.0.50"
                inputMode="decimal"
                className="w-[132px] h-[32px] px-[10px] rounded-[8px] bg-[#F2F2F2] text-[13px] tabular-nums text-[#1E1E1E] text-right outline-none focus:bg-[#E8E4E2]"
              />
            </Row>
            <Row label="포트" hint={`비우면 ${DEFAULT_TCP_PORT} 를 써요 (영수증 프린터 표준)`}>
              <input
                value={cfg.tcpPort ?? ''}
                onChange={e => {
                  const n = Number(e.target.value.replace(/[^0-9]/g, ''))
                  patch({ tcpPort: n > 0 ? n : undefined })
                }}
                placeholder={String(DEFAULT_TCP_PORT)}
                inputMode="numeric"
                className="w-[78px] h-[32px] px-[10px] rounded-[8px] bg-[#F2F2F2] text-[13px] tabular-nums text-[#1E1E1E] text-right outline-none focus:bg-[#E8E4E2]"
              />
            </Row>
          </>
        ) : (
          <Row label="통신 속도" hint="글자가 깨져 나오면 이걸 바꿔보세요. 대부분 9600 또는 115200">
            <select
              value={cfg.baudRate ?? 9600}
              onChange={e => patch({ baudRate: Number(e.target.value) })}
              className="h-[32px] px-[9px] rounded-[8px] bg-[#F2F2F2] text-[13px] tabular-nums text-[#1E1E1E] outline-none"
            >
              {BAUD_RATES.map(b => <option key={b} value={b}>{b.toLocaleString('ko-KR')} bps</option>)}
            </select>
          </Row>
        )}
      </Group>

      {configProblem(cfg) && (
        <div className="rounded-[11px] bg-[#FFEFEF] px-[20px] py-[13px] mb-[34px] text-[12px] text-[#C92A2A]">
          {configProblem(cfg)}
        </div>
      )}

      {/* 문제를 겪는 사람이 설정을 더 만지기 전에 먼저 보이도록 출력 문서 위에 둔다 */}
      <div className="rounded-[11px] bg-[#F2F2F2] px-[20px] py-[16px] mb-[34px]">
        <div className="text-[12px] font-medium text-[#414141] mb-[7px]">연결이 안 될 때</div>
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
/** 하단 문구 글자 수 상한 — 줄바꿈은 세지 않는다 */
const FOOTER_MAX = 20

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

      <Group title="영수증 양식">
        <PaperWidthRow />
        <Row label="메뉴명 글자 크기">
          <SegButtons value={menuSize} options={SIZE_OPTS} onChange={v => patch({ menuSize: v })} />
        </Row>
        <Row label="옵션 글자 크기">
          <SegButtons value={optionSize} options={SIZE_OPTS} onChange={v => patch({ optionSize: v })} />
        </Row>
        <Row label="금액 글자 크기">
          <SegButtons value={amountSize} options={SIZE_OPTS} onChange={v => patch({ amountSize: v })} />
        </Row>
        {/* input 이 아니라 textarea 다 — 전에는 한 줄짜리 input 이라
            **줄바꿈을 아예 입력할 수 없었다.** 인쇄 쪽(escpos)은 처음부터
            \n 으로 쪼개 가운데정렬로 찍고 있었는데 입력에서 막혀 있었다.
            20자는 줄바꿈을 뺀 글자 수로 센다 — 줄을 나눴다고 쓸 수 있는 글자가
            줄어들면 "두 줄로 쓰려니 글자가 모자라다"가 된다. */}
        <Row label="하단 문구" hint="줄바꿈하면 영수증에도 그대로 줄이 나뉘고, 가운데로 찍혀요">
          <div className="flex flex-col items-end gap-[4px]">
            <textarea
              value={footer}
              onChange={e => {
                const v = e.target.value
                const len = v.replace(/\n/g, '').length
                if (len <= FOOTER_MAX) patch({ footerText: v })
              }}
              rows={2}
              placeholder={'감사합니다\n또 오세요'}
              className="w-[220px] px-[11px] py-[7px] rounded-[9px] border border-[#ADADAD] text-[13px] text-[#1E1E1E] outline-none focus:border-[#6A635E] resize-none leading-[1.4]"
            />
            <span className="text-[11px] font-normal text-[#ADADAD] tabular-nums">
              {footer.replace(/\n/g, '').length} / {FOOTER_MAX}자
            </span>
          </div>
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
  // 알림 방식은 **둘 중 하나**다. 전에는 'N회'와 '확인할 때까지 반복'이 따로 있어서
  // 둘 다 켜면 "3회면서 무한"이라는 말이 안 되는 상태가 됐다.
  const [alarmMode,    setAlarmMode]    = usePersistentState<'count' | 'until-ack'>('alarm_mode', 'count')
  const [repeatSec,    setRepeatSec]    = usePersistentState('repeat_sec', 1)
  const [alarmCount,   setAlarmCount]   = usePersistentState('alarm_count', 1)
  // 기본 **꺼짐**. 켜두면 영업시간 내내 화면이 안 꺼져서 번인과 전기요금이 쌓인다.
  // 필요한 매장만 켜는 게 맞다(주방에서 멀리 두고 보는 경우).
  const [keepAwake,    setKeepAwake]    = usePersistentState('keep_awake', false)

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

  // 미리 듣기 — **지금 고른 방식 그대로** 들려준다.
  // 횟수대로면 그 횟수만큼, 확인할 때까지면 고른 간격으로 반복한다.
  // 전에는 늘 1회만 울려서 "반복 간격을 0.5초로 했는데 왜 한 번만 나지"가 됐다.
  const [previewing, setPreviewing] = useState(false)
  function previewAlarm() {
    if (previewing) { stopOrderAlarm(); setPreviewing(false); return }
    if (alarmMode === 'until-ack') {
      startOrderAlarm(volume, repeatSec)
      setPreviewing(true)
    } else {
      playOrderSound(volume, alarmCount)
    }
  }
  // 설정 화면을 떠날 때 미리 듣기가 계속 울리면 안 된다
  useEffect(() => () => stopOrderAlarm(), [])

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
    const sound = alarmMode === 'until-ack'
      ? `볼륨 ${volume} · 확인할 때까지 ${repeatSec}초 간격`
      : `볼륨 ${volume} · ${alarmCount}회`
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
      `알림음     ${sound}`,
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
      extra: { report: r.text, volume, alarmMode, alarmCount, repeatSec, ...(d ?? {}) },
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
          <SmallButton onClick={previewAlarm}>{previewing ? '멈추기' : '미리 듣기'}</SmallButton>
        </Row>
        <Row label="알림 방식" hint="피크타임에 주문음을 한 번 놓치면 그 주문은 증발해요">
          <SegButtons
            value={alarmMode}
            options={[
              { v: 'count' as const,     label: '횟수대로' },
              { v: 'until-ack' as const, label: '확인할 때까지' },
            ]}
            onChange={setAlarmMode}
          />
        </Row>
        {alarmMode === 'count' ? (
          <Row label="알림 횟수" hint="새 주문이 들어올 때 소리를 몇 번 낼지">
            <CountStepper value={alarmCount} min={1} max={10} suffix="회" onChange={setAlarmCount} />
          </Row>
        ) : (
          <Row label="반복 간격" hint="주문 카드를 열 때까지 이 간격으로 계속 울려요">
            <SegButtons
              value={String(repeatSec)}
              options={[
                { v: '0.5', label: '0.5초' },
                { v: '1',   label: '1초' },
                { v: '2',   label: '2초' },
                { v: '3',   label: '3초' },
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
            {checking ? <Working label="확인 중" /> : '업데이트 확인'}
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
