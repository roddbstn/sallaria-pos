import React, { useState, useEffect } from 'react'
import { SegmentedControl } from '../components/SegmentedControl'
import { playOrderSound, getSavedVolume, saveVolume } from '../lib/sound'
import { useStore } from '../lib/store-context'
import { PLAN_LIMITS, PLAN_NAMES } from '../lib/plans'
import { UpgradeModal } from './Sales'

interface PrinterSettings { portName: string }
interface ReceiptSettings  {
  menuSize:           'small' | 'normal' | 'large'
  optionSize:         'small' | 'normal' | 'large'
  customerMenuSize:   'small' | 'normal' | 'large'
  customerOptionSize: 'small' | 'normal' | 'large'
}
interface ComPort { path: string; manufacturer: string; friendlyName: string }

type DayHours = { enabled: boolean; open: string; close: string }
type BreakHours = { enabled: boolean; start: string; end: string }

interface SettingsProps {
  onOpenHours: () => void
  onOpenProfile: () => void
  operatingHours: Record<string, DayHours>
  breakTime: Record<string, BreakHours>
}

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

const isWindows = navigator.userAgent.includes('Windows')
const PORT_LABEL = isWindows ? 'COM 포트' : '포트'

const SIZE_LABELS: Record<string, string> = { small: '기본', normal: '보통', large: '크게' }

const DAY_LABELS: Record<string, string> = { mon:'월', tue:'화', wed:'수', thu:'목', fri:'금', sat:'토', sun:'일' }
const DAY_ORDER = ['mon','tue','wed','thu','fri','sat','sun']

export default function Settings({ onOpenHours, onOpenProfile, operatingHours, breakTime }: SettingsProps) {
  const { storeName, plan } = useStore()
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [comPorts,   setComPorts]   = useState<ComPort[]>([])
  const [printer,    setPrinter]    = useState<PrinterSettings>({ portName: '' })
  const [receipt,    setReceipt]    = useState<ReceiptSettings>({ menuSize: 'normal', optionSize: 'normal', customerMenuSize: 'normal', customerOptionSize: 'normal' })
  const [connected,  setConnected]  = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [testing,    setTesting]    = useState(false)
  const [connectErr, setConnectErr] = useState('')
  const [testMsg,    setTestMsg]    = useState('')
  const [alertVolume,  setAlertVolume]  = useState(getSavedVolume)
  const [receiptTab, setReceiptTab] = useState<'kitchen' | 'customer'>('kitchen')
  const [previewType, setPreviewType] = useState<'개인' | '과' | '기업'>('과')

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
    if (!printer.portName) { setConnectErr(`${PORT_LABEL}를 먼저 선택해 주세요.`); return }
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

  // receipt 변경 시 자동저장 (500ms 디바운스)
  useEffect(() => {
    const t = setTimeout(() => { api().updateSettings?.({ printer, receipt }) }, 500)
    return () => clearTimeout(t)
  }, [receipt])

  const sizeOpts: ('small' | 'normal' | 'large')[] = ['small', 'normal', 'large']

  const previewWrap: React.CSSProperties = {
    width: 200,
    backgroundColor: '#fff',
    boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
    fontFamily: "'Courier New', Courier, monospace",
    fontSize: 11,
    lineHeight: 1.3,
    letterSpacing: '0px',
    color: '#111',
    padding: '8px 10px',
    overflow: 'hidden',
  }
  const scaleWrap: React.CSSProperties = {
    width: '134%',
    transform: 'scaleX(0.75)',
    transformOrigin: 'left top',
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-bg">
      <div className="max-w-[640px] mx-auto px-3 py-3 space-y-3">
        {/* ── 계정 / 요금제 ── */}
        <Section title={storeName || '매장명'} noBorder action={
          <button onClick={onOpenProfile}
            className="px-3 py-1.5 rounded-lg text-[12px] font-bold text-[#008F42] bg-[#E6F4EC] hover:bg-[#C9EAD5] transition-colors">
            프로필 보기
          </button>
        }>
          <div className="space-y-3">
            <div className="bg-gray-bg rounded-xl p-3 space-y-2">
              <div className="flex justify-between text-[12px]">
                <span className="text-gray-text">거래처 한도</span>
                <span className="font-semibold text-ink">
                  {PLAN_LIMITS[plan].accounts === Infinity ? '무제한' : `${PLAN_LIMITS[plan].accounts}개`}
                </span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-gray-text">매장 한도</span>
                <span className="font-semibold text-ink">
                  {PLAN_LIMITS[plan].stores === Infinity ? '무제한' : `${PLAN_LIMITS[plan].stores}개`}
                </span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-gray-text">매출 분석</span>
                <span className={`font-semibold ${PLAN_LIMITS[plan].analytics ? 'text-green' : 'text-gray-text'}`}>
                  {PLAN_LIMITS[plan].analytics ? '사용 가능' : '미지원'}
                </span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-gray-text">SMS 알림</span>
                <span className={`font-semibold ${PLAN_LIMITS[plan].sms ? 'text-green' : 'text-gray-text'}`}>
                  {PLAN_LIMITS[plan].sms ? '사용 가능' : '미지원'}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-[13px] text-gray-text">
                <span className="font-semibold text-ink">{PLAN_NAMES[plan]}</span> <span className="text-[#C8C8C8]">구독중</span>
              </div>
              <button onClick={() => setUpgradeOpen(true)}
                className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-[#008F42] bg-[#E6F4EC] hover:bg-[#C9EAD5] transition-colors">
                요금제 변경
              </button>
            </div>
            <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
          </div>
        </Section>

        {/* ── 운영시간 설정 ── */}
        <Section title="운영시간">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div>
              <div className="text-[13px] font-semibold text-ink">요일별 운영 스케줄</div>
              <div className="text-[12px] text-gray-text mt-0.5">영업 시작·종료 시간 및 브레이크타임을 설정합니다</div>
            </div>
            <button
              onClick={onOpenHours}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-ink rounded-lg text-[11px] font-semibold hover:bg-gray-200 transition-colors flex-shrink-0"
            >
              <ClockIcon /> 시간 설정
            </button>
          </div>

          {/* 현재 운영시간 요약 */}
          <div className="bg-gray-bg rounded-xl px-4 py-3">
            <div className="grid grid-cols-7 gap-1">
              {DAY_ORDER.map(day => {
                const h = operatingHours[day]
                const b = breakTime[day]
                const enabled = h?.enabled ?? false
                return (
                  <div key={day} className="flex flex-col items-center gap-1">
                    <span className={`text-[11px] font-bold ${enabled ? 'text-ink' : 'text-gray-text'}`}>
                      {DAY_LABELS[day]}
                    </span>
                    {enabled ? (
                      <>
                        <span className="text-[10px] font-semibold text-green leading-tight text-center bg-green-soft rounded px-1.5 py-0.5">{h.open}</span>
                        <span className="text-[9px] text-gray-text leading-none">~</span>
                        <span className="text-[10px] font-semibold text-white leading-tight text-center bg-[#6B7280] rounded px-1.5 py-0.5">{h.close}</span>
                        {b?.enabled && (
                          <span className="text-[9px] text-gray-text leading-tight text-center mt-0.5">
                            {b.start}~{b.end}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-[10px] text-gray-text mt-1">휴무</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </Section>

        {/* ── 주문 알림음 ── */}
        <Section title="주문 알림음">
          <Field label="볼륨">
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-gray-text w-4">🔇</span>
              <input
                type="range" min={0} max={100} value={alertVolume}
                onChange={e => setAlertVolume(Number(e.target.value))}
                onMouseUp={e => saveVolume(Number((e.target as HTMLInputElement).value))}
                onTouchEnd={e => saveVolume(Number((e.target as HTMLInputElement).value))}
                className="flex-1 h-2 cursor-pointer volume-slider"
                style={{ background: `linear-gradient(to right, #00DD67 0%, #00DD67 ${alertVolume}%, #E5E7EB ${alertVolume}%, #E5E7EB 100%)` }}
              />
              <span className="text-[13px] text-gray-text">🔊</span>
              <span className="text-[13px] font-bold text-ink w-8 text-right">{alertVolume}</span>
            </div>
          </Field>
          <Field label="테스트">
            <button
              onClick={() => playOrderSound(alertVolume)}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-ink rounded-lg text-[11px] font-semibold hover:bg-gray-200 transition-colors"
            >
              <SoundIcon />알림음 미리 듣기
            </button>
          </Field>
        </Section>

        {/* ── 프린터 연결 (ESC/POS 시리얼) ── */}
        <Section title={`프린터 연결 (${PORT_LABEL})`}>

          {/* 연결 상태 배지 */}
          <div className={[
            'flex items-center gap-2 px-4 py-3 rounded-xl text-[13px] font-bold',
            connected ? 'bg-[#E6F4EC] text-[#008F42]' : 'bg-red-50 text-[#C92A2A]',
          ].join(' ')}>
            <span className={['w-2.5 h-2.5 rounded-full flex-shrink-0', connected ? 'bg-[#00DD67]' : 'bg-[#C92A2A]'].join(' ')} />
            {connected
              ? `연결됨 — ${printer.portName}`
              : printer.portName
                ? `미확인 — ${printer.portName} (연결하기 클릭)`
                : `${PORT_LABEL}가 선택되지 않았습니다`}
          </div>

          {/* 호환 기종 안내 */}
          <div className="bg-gray-bg rounded-xl px-4 py-3 text-[11px] text-gray-text leading-relaxed">
            <p className="font-bold text-ink mb-1.5">✓ 호환 프린터 조건</p>
            <p>· <span className="font-semibold text-ink">ESC/POS</span> 지원 58mm 열감지(감열) 프린터</p>
            <p>· USB 연결 후 PC에서 <span className="font-semibold text-ink">가상 COM 포트</span>로 잡히는 제품</p>
            <p className="mt-1.5 font-semibold text-ink">대표 호환 기종</p>
            <p>Epson TM 시리즈 · Bixolon SRP-270/280/320 · Samsung SRP 시리즈</p>
            <p className="mt-1.5 text-[10px]">WiFi·LAN·Bluetooth 연결 프린터나 80mm 프린터는 지원되지 않을 수 있어요.</p>
          </div>

          {/* STEP 1 — COM 포트 목록 */}
          <StepCard step="1" title={`${PORT_LABEL} 선택`}>
            <p className="text-[12px] text-gray-text mb-3">
              프린터 USB/시리얼 케이블을 연결한 후 목록을 불러오세요.
            </p>
            <button
              onClick={handleScanPorts}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-ink rounded-lg text-[11px] font-semibold hover:bg-gray-200 disabled:opacity-60 transition-colors mb-3"
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
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 text-ink rounded-lg text-[11px] font-semibold hover:bg-gray-200 disabled:opacity-50 transition-colors"
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
                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors',
                printer.portName
                  ? 'bg-gray-100 text-ink hover:bg-gray-200'
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
                testMsg.includes('정상') ? 'bg-[#E6F4EC] text-[#008F42]' : 'bg-red-50 text-[#C92A2A]',
              ].join(' ')}>{testMsg}</div>
            )}
          </StepCard>
        </Section>

        {/* ── 영수증 설정 (탭) ── */}
        <Section title="영수증 설정">
          <SegmentedControl
            options={[
              { label: '매장용 (주방)', value: 'kitchen'  as const },
              { label: '고객용',        value: 'customer' as const },
            ]}
            value={receiptTab}
            onChange={setReceiptTab}
            size="md"
            rounded="xl"
            className="mb-5"
          />

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
                        className={['px-3 py-1 rounded-lg text-[11px] font-bold border transition-colors',
                          receipt[key] === s ? 'bg-ink text-white border-ink' : 'bg-gray-100 text-gray-text border-gray-border hover:bg-gray-200'].join(' ')}>
                        {SIZE_LABELS[s]}
                      </button>
                    ))}
                  </div>
                </Field>
              ))}
              <div className="mt-3">
                <div className="text-[13px] font-semibold text-gray-text mb-1.5">출력 미리보기 (58mm 실제 비율)</div>
                {/* 예시 유형 탭 */}
                <div className="flex gap-1.5 mb-3">
                  {(['개인', '과', '기업'] as const).map(t => (
                    <button key={t} onClick={() => setPreviewType(t)}
                      className={['px-3 py-1 rounded-lg text-[11px] font-bold border transition-colors',
                        previewType === t ? 'bg-ink text-white border-ink' : 'bg-gray-100 text-gray-text border-gray-border hover:bg-gray-200'].join(' ')}>
                      {t === '개인' ? '개인 (픽업)' : t === '과' ? '과 (매장식사)' : '기업 (배달)'}
                    </button>
                  ))}
                </div>
                <div className="bg-gray-200 rounded-xl p-5 flex justify-center">
                  <div style={previewWrap}>
                    {(() => {
                      const menuPx = receipt.menuSize   === 'large' ? 16 : receipt.menuSize   === 'normal' ? 12 : 8
                      const optPx  = receipt.optionSize === 'large' ? 16 : receipt.optionSize === 'normal' ? 12 : 8
                      const ex = previewType === '개인'
                        ? { orderer: '홍길동', phone: '010-****-1234', method: '포장', account: '홍길동', type: '개인', delivery: false, subtotal: 16500, total: 16500 }
                        : previewType === '과'
                        ? { orderer: '김민준', phone: '010-****-5678', method: '매장 식사', account: '중구청 OO과', type: '과', delivery: false, subtotal: 16500, total: 16500 }
                        : { orderer: '이서연', phone: '010-****-9012', method: '배달', account: 'OO기업', type: '기업', delivery: true, subtotal: 16500, total: 20000 }
                      const options = [
                        { name: '생연어 포케 100g', price: 5500 },
                        { name: '현미밥', price: 0 },
                        { name: '아보카도 추가', price: 1500 },
                      ]
                      return <div style={scaleWrap}>
                        <div style={{ textAlign:'center', fontWeight:'bold' }}>[주방용]</div>
                        <div style={{ textAlign:'center' }}>{storeName || '매장명'} - 선결제 영수증</div>
                        <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        <div><span>주문번호 : </span><b>11602</b></div>
                        <div>주문일시 : 2026/07/20 12:30</div>
                        <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        <div><span>이용방법 : </span><b>{ex.method}</b></div>
                        <div>주문자   : {ex.orderer}</div>
                        <div>전화번호 : {ex.phone}</div>
                        <div>거래처   : {ex.account}</div>
                        <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        {ex.delivery ? <>
                          <div>배달주소 : 대구 북구 침산로21길 23</div>
                          <div>배달상세 : 103동 907호</div>
                          <div>가게요청 : 없음</div>
                          <div>배달요청 : 문 앞에 두고 초인종 눌러주세요.</div>
                          <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        </> : <>
                          <div>가게요청 : 없음</div>
                          <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        </>}
                        <div style={{ display:'grid', gridTemplateColumns:'1fr auto auto', gap:4 }}>
                          <span style={{ fontWeight:'bold' }}>메뉴명</span>
                          <span style={{ fontWeight:'bold', textAlign:'right' }}>수량</span>
                          <span style={{ fontWeight:'bold', textAlign:'right' }}>가격</span>
                          <div style={{ gridColumn:'1/-1', borderTop:'1px dotted #000', margin:'2px 0' }} />
                          <span style={{ fontWeight:'bold', fontSize:menuPx }}>포케+음료세트</span>
                          <span style={{ fontWeight:'bold', fontSize:menuPx, textAlign:'right' }}>1</span>
                          <span style={{ fontWeight:'bold', fontSize:menuPx, textAlign:'right' }}>14,400원</span>
                          {options.map((o, i) => (
                            <React.Fragment key={i}>
                              <div style={{ fontSize:optPx, color:'#555', gridColumn:'1/3', paddingLeft:6 }}>{`> ${o.name}`}</div>
                              <div style={{ fontSize:optPx, color:'#555', textAlign:'right', whiteSpace:'nowrap' }}>
                                {o.price > 0 ? `+${o.price.toLocaleString('ko-KR')}원` : ''}
                              </div>
                            </React.Fragment>
                          ))}
                        </div>
                        <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        <div>메뉴 소계 : {ex.subtotal.toLocaleString('ko-KR')}원</div>
                        {ex.delivery && <div>배달료   : 3,500원</div>}
                        <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        <div style={{ fontWeight:'bold' }}>합    계 : {ex.total.toLocaleString('ko-KR')}원</div>
                        <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        <div>주문전 잔액 : 864,800원</div>
                        <div style={{ fontWeight:'bold' }}>주문후 잔액 : {(864800 - ex.total).toLocaleString('ko-KR')}원</div>
                      </div>
                    })()}
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
                        className={['px-3 py-1 rounded-lg text-[11px] font-bold border transition-colors',
                          receipt[key] === s ? 'bg-ink text-white border-ink' : 'bg-gray-100 text-gray-text border-gray-border hover:bg-gray-200'].join(' ')}>
                        {SIZE_LABELS[s]}
                      </button>
                    ))}
                  </div>
                </Field>
              ))}
              <div className="mt-3">
                <div className="text-[13px] font-semibold text-gray-text mb-1.5">출력 미리보기 (58mm 실제 비율)</div>
                {/* 예시 유형 탭 (kitchen과 공유) */}
                <div className="flex gap-1.5 mb-3">
                  {(['개인', '과', '기업'] as const).map(t => (
                    <button key={t} onClick={() => setPreviewType(t)}
                      className={['px-3 py-1 rounded-lg text-[11px] font-bold border transition-colors',
                        previewType === t ? 'bg-ink text-white border-ink' : 'bg-gray-100 text-gray-text border-gray-border hover:bg-gray-200'].join(' ')}>
                      {t === '개인' ? '개인 (픽업)' : t === '과' ? '과 (매장식사)' : '기업 (배달)'}
                    </button>
                  ))}
                </div>
                <div className="bg-gray-200 rounded-xl p-5 flex justify-center">
                  <div style={previewWrap}>
                    {(() => {
                      const menuPx = receipt.customerMenuSize   === 'large' ? 16 : receipt.customerMenuSize   === 'normal' ? 12 : 8
                      const optPx  = receipt.customerOptionSize === 'large' ? 16 : receipt.customerOptionSize === 'normal' ? 12 : 8
                      const ex = previewType === '개인'
                        ? { orderer: '홍길동', phone: '010-****-1234', method: '포장', account: '홍길동', type: '개인', delivery: false, subtotal: 16500, total: 16500 }
                        : previewType === '과'
                        ? { orderer: '김민준', phone: '010-****-5678', method: '매장 식사', account: '중구청 OO과', type: '과', delivery: false, subtotal: 16500, total: 16500 }
                        : { orderer: '이서연', phone: '010-****-9012', method: '배달', account: 'OO기업', type: '기업', delivery: true, subtotal: 16500, total: 20000 }
                      const options = [
                        { name: '생연어 포케 100g', price: 5500 },
                        { name: '현미밥', price: 0 },
                        { name: '아보카도 추가', price: 1500 },
                      ]
                      return <div style={scaleWrap}>
                        <div style={{ textAlign:'center', fontWeight:'bold' }}>[고객용]</div>
                        <div style={{ textAlign:'center' }}>{storeName || '매장명'} - 선결제 영수증</div>
                        <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        <div><span>주문번호 : </span><b>11602</b></div>
                        <div>주문일시 : 2026/07/20 12:30</div>
                        <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        <div><span>이용방법 : </span><b>{ex.method}</b></div>
                        <div>주문자   : {ex.orderer}</div>
                        <div>전화번호 : {ex.phone}</div>
                        <div>거래처   : {ex.account}</div>
                        <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        {ex.delivery ? <>
                          <div>배달주소 : 대구 북구 침산로21길 23</div>
                          <div>배달상세 : 103동 907호</div>
                          <div>가게요청 : 없음</div>
                          <div>배달요청 : 문 앞에 두고 초인종 눌러주세요.</div>
                          <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        </> : <>
                          <div>가게요청 : 없음</div>
                          <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        </>}
                        {/* 메뉴 3열 테이블 */}
                        <div style={{ display:'grid', gridTemplateColumns:'1fr auto auto', gap:4 }}>
                          <span style={{ fontWeight:'bold' }}>메뉴명</span>
                          <span style={{ fontWeight:'bold', textAlign:'right' }}>수량</span>
                          <span style={{ fontWeight:'bold', textAlign:'right' }}>가격</span>
                          <div style={{ gridColumn:'1/-1', borderTop:'1px dotted #000', margin:'2px 0' }} />
                          <span style={{ fontWeight:'bold', fontSize:menuPx }}>포케+음료세트</span>
                          <span style={{ fontWeight:'bold', fontSize:menuPx, textAlign:'right' }}>1</span>
                          <span style={{ fontWeight:'bold', fontSize:menuPx, textAlign:'right' }}>16,500원</span>
                          {options.map((o, i) => (
                            <React.Fragment key={i}>
                              <div style={{ fontSize:optPx, color:'#555', gridColumn:'1/3', paddingLeft:6 }}>{`> ${o.name}`}</div>
                              <div style={{ fontSize:optPx, color:'#555', textAlign:'right', whiteSpace:'nowrap' }}>
                                {o.price > 0 ? `+${o.price.toLocaleString('ko-KR')}원` : ''}
                              </div>
                            </React.Fragment>
                          ))}
                        </div>
                        <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        <div>메뉴 소계 : {ex.subtotal.toLocaleString('ko-KR')}원</div>
                        {ex.delivery && <div>배달료   : 3,500원</div>}
                        <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        <div style={{ fontWeight:'bold' }}>합    계 : {ex.total.toLocaleString('ko-KR')}원</div>
                        <div style={{ borderTop:'1px dashed #999', margin:'3px 0' }} />
                        <div>주문전 잔액 : 864,800원</div>
                        <div style={{ fontWeight:'bold' }}>주문후 잔액 : {(864800 - ex.total).toLocaleString('ko-KR')}원</div>
                      </div>
                    })()}
                  </div>
                </div>
              </div>
            </>
          )}
        </Section>

        <div className="text-center text-[12px] text-gray-text pb-4">
          <div className="font-bold">프리POS v0.1.0</div>
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

function Section({ title, action, children, noBorder }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; noBorder?: boolean }) {
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className={`px-4 py-3 flex items-center justify-between ${noBorder ? '' : 'border-b border-gray-border'}`}>
        <span className="text-[14px] font-bold text-ink">{title}</span>
        {action}
      </div>
      <div className="px-4 py-4 space-y-4">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[13px] font-semibold text-gray-text mb-1.5 block">{label}</label>
      {children}
    </div>
  )
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
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
