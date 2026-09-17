import { useState, useEffect, useRef, useCallback } from 'react'
import { SegmentedControl } from '../components/SegmentedControl'
import { supabase } from '../lib/supabase'
import { track } from '../lib/firebase'
import type { PlanTier } from '../lib/plans'

/* ── 타입 ── */
type PortInfo = { path: string; manufacturer?: string; friendlyName?: string }
type Api = {
  listPorts?:      () => Promise<PortInfo[]>
  connectPrinter?: () => Promise<{ ok: boolean; error?: string }>
  updateSettings?: (p: unknown) => Promise<{ ok: boolean }>
}
const api = (): Api => (window as unknown as { api?: Api }).api ?? {}

const isWindows = navigator.userAgent.includes('Windows')
const PORT_LABEL = isWindows ? 'COM 포트' : '포트'
const BAUD_RATES = [9600, 19200, 38400, 115200]

/* ── 요금제 데이터 ── */
const ALL_PLANS = [
  {
    id:        'free' as PlanTier,
    name:      '무료',
    price:     0,
    teamLimit: '1팀',
    perday:    null,
    inherits:  null,
    extras:    ['주문 내역 관리', 'QR 오더', '잔액 차감 자동화', '영수증 출력'],
  },
  {
    id:        'basic' as PlanTier,
    name:      '베이직',
    price:     9900,
    teamLimit: '5팀까지',
    perday:    '하루 330원',
    inherits:  '무료 기능 포함',
    extras:    ['선결제 매출·주문액 정산 시각화'],
  },
  {
    id:        'pro' as PlanTier,
    name:      '프로',
    price:     23900,
    teamLimit: '20팀까지',
    perday:    '하루 797원',
    inherits:  '베이직 기능 포함',
    extras:    ['잔액 부족 경고 기준 설정', '문자 자동 발송'],
  },
  {
    id:        'max' as PlanTier,
    name:      '맥스',
    price:     43900,
    teamLimit: '제한 없음',
    perday:    '하루 1,463원',
    inherits:  '프로 기능 포함',
    extras:    ['여러 매장 등록·통합 관리'],
  },
]

/* ── 기능 비교표 데이터 ── */
type FVal = boolean | string
const FEATURE_TABLE: { label: string; free: FVal; basic: FVal; pro: FVal; max: FVal }[] = [
  { label: '선결제 고객 팀 수',                    free: '1팀',  basic: '5팀', pro: '20팀', max: '무제한' },
  { label: '주문 내역 관리',                       free: true,  basic: true,  pro: true,  max: true    },
  { label: '선결제 고객 전용 QR 오더 (모바일 웹)', free: true,  basic: true,  pro: true,  max: true    },
  { label: '잔액 차감 자동화',                     free: true,  basic: true,  pro: true,  max: true    },
  { label: '영수증 출력',                          free: true,  basic: true,  pro: true,  max: true    },
  { label: '선결제 매출·주문액 정산 시각화',       free: false, basic: true,  pro: true,  max: true    },
  { label: '잔액 부족 경고 기준 설정',             free: false, basic: false, pro: true,  max: true    },
  { label: '잔액 부족 기준 도달 시 문자 자동 발송',free: false, basic: false, pro: true,  max: true    },
  { label: '여러 매장 등록·통합 관리',             free: false, basic: false, pro: false, max: true    },
]

function getMatchedPlan(count: number): PlanTier {
  if (count === 1) return 'free'
  if (count <= 10) return 'basic'
  if (count <= 20) return 'pro'
  return 'max'
}

function CheckCircle() {
  return (
    <span style={{ display:'inline-flex', width:16, height:16, borderRadius:'50%', background:'#00CE63', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      <svg width="8" height="6" viewBox="0 0 9 7" fill="none">
        <path d="M1 3.5L3.2 5.7L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  )
}
/* 기능 비교표 셀 */
function FCell({ v, isSelected }: { v: FVal; isSelected: boolean }) {
  if (v === false) return <span style={{ color:'#D1D5DB', fontSize:13 }}>—</span>
  if (v === true)  return (
    <span style={{ display:'inline-flex', width:18, height:18, borderRadius:'50%', background: isSelected ? '#00CE63' : '#E5E7EB', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
        <path d="M1 3.5L3.2 5.7L8 1" stroke={isSelected ? '#fff' : '#9CA3AF'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  )
  return <span style={{ fontSize:11, fontWeight:600, color: isSelected ? '#04A551' : '#6B7280' }}>{v}</span>
}

/* ── Props ── */
interface Props {
  clientId:   string
  onComplete: (storeId: string, storeName: string, plan: PlanTier) => void
}

/* ── 단계 라벨 ── */
const STEP_LABELS = ['요금제', '매장 정보', '메뉴 등록', '고객 등록', '프린터']

/* ── Step 2 로컬 타입 ── */
interface ObCat  { localId: string; name: string }
interface ObMenu { localId: string; catLocalId: string | null; name: string; price: string; imageFile?: File; imagePreview?: string }
/* ── 고객 행 (로컬) ── */
interface AccountRow { name: string; manager: string; pin: string; balance: string }

export default function Onboarding({ clientId, onComplete }: Props) {
  /* 공통 */
  const [step,         setStep]         = useState<0|1|2|3|4>(0)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')

  /* Step 0: 요금제 */
  const [selectedPlan, setSelectedPlan] = useState<PlanTier>('free')
  const [savedPlan,    setSavedPlan]    = useState<PlanTier | null>(null)
  const [teamCount,    setTeamCount]    = useState(3)
  const matchedPlan = getMatchedPlan(teamCount)
  useEffect(() => { setSelectedPlan(matchedPlan) }, [matchedPlan])
  const fillPct = ((teamCount - 1) / 24) * 100
  const handleRangeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTeamCount(parseInt(e.target.value, 10))
  }, [])

  /* Step 1: 매장 정보 */
  const [storeName,          setStoreName]          = useState('')
  const [representativeName, setRepresentativeName] = useState('')
  const [address,            setAddress]             = useState('')
  const [storeId,            setStoreId]             = useState('')
  const [coverFile,          setCoverFile]          = useState<File | null>(null)
  const [coverPreview,       setCoverPreview]       = useState<string | null>(null)

  /* Step 2: 카테고리 + 메뉴 */
  const [cats,        setCats]        = useState<ObCat[]>([])
  const [selectedCat, setSelectedCat] = useState<string | null>(null)   // localId
  // null catLocalId = 카테고리 없음(전체)
  const [menuItems,   setMenuItems]   = useState<ObMenu[]>([
    { localId: crypto.randomUUID(), catLocalId: null, name: '', price: '', imageFile: undefined, imagePreview: '' },
  ])
  const [newCatName,  setNewCatName]  = useState('')
  const [menusSaved,  setMenusSaved]  = useState(0)   // 저장된 메뉴 수 (step4 요약용)

  /* Step 3: 고객 */
  const [accRows,   setAccRows]   = useState<AccountRow[]>([{ name: '', manager: '', pin: '', balance: '' }])
  const [accSaved,  setAccSaved]  = useState<{ name: string }[]>([])
  const [pinError,  setPinError]  = useState('')

  /* Step 4: 프린터 */
  const [ports,       setPorts]       = useState<PortInfo[]>([])
  const [printerPath, setPrinterPath] = useState('')
  const [baudRate,    setBaudRate]    = useState(9600)
  const [scanning,    setScanning]    = useState(false)
  const [connecting,  setConnecting]  = useState(false)
  const [connected,   setConnected]   = useState(false)
  const [connectErr,  setConnectErr]  = useState('')

  /* 기존 진행 상태 복원 */
  useEffect(() => {
    supabase
      .from('clients')
      .select('business_name, plan')
      .eq('id', clientId)
      .single()
      .then(({ data }) => {
        if (data?.business_name) {
          setStoreName(data.business_name)
          if (data.plan) {
            setSelectedPlan(data.plan as PlanTier)
            setSavedPlan(data.plan as PlanTier)
          }
        }
      })
  }, [clientId])

  /* ── Step 0: 요금제 저장 ── */
  async function handleStep0() {
    setLoading(true); setError('')
    try {
      const { error: e } = await supabase
        .from('clients')
        .update({ plan: selectedPlan })
        .eq('id', clientId)
      if (e) throw e
      track('pos_plan_selected', { plan: selectedPlan })
      setStep(1)
    } catch (e: any) {
      setError(e.message ?? '오류가 발생했습니다.')
    } finally { setLoading(false) }
  }

  /* ── Step 1: 매장 생성 (뒤로 왔다가 재제출 시 UPDATE) ── */
  async function handleStep1(e: React.FormEvent) {
    e.preventDefault()
    if (!storeName.trim() || !representativeName.trim() || !address.trim() || !coverFile) return
    setLoading(true); setError('')
    try {
      await supabase.from('clients').update({ business_name: storeName.trim() }).eq('id', clientId)

      let sid = storeId
      if (sid) {
        // 뒤로가기 후 재제출 → UPDATE
        await supabase.from('stores').update({
          name: storeName.trim(),
          representative_name: representativeName.trim(),
          address: address.trim(),
        }).eq('id', sid)
      } else {
        // 기존 매장이 있는지 먼저 확인 (중복 생성 방지)
        const { data: existing } = await supabase
          .from('stores')
          .select('id')
          .eq('client_id', clientId)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (existing) {
          // 이미 매장 있음 → UPDATE만
          sid = existing.id
          setStoreId(sid)
          await supabase.from('stores').update({
            name: storeName.trim(),
            representative_name: representativeName.trim(),
            address: address.trim(),
          }).eq('id', sid)
        } else {
          // 신규 → INSERT
          const { data, error: se } = await supabase
            .from('stores')
            .insert({
              client_id: clientId,
              name: storeName.trim(),
              representative_name: representativeName.trim(),
              address: address.trim(),
            })
            .select('id')
            .single()
          if (se) throw se
          sid = data.id
          setStoreId(sid)
          track('pos_store_registered', { store_id: sid, store_name: storeName.trim(), plan: selectedPlan })
        }
      }

      // 대표 사진 업로드
      const ext = coverFile.name.split('.').pop() ?? 'jpg'
      const storagePath = `${sid}/cover.${ext}`
      const { error: upErr } = await supabase.storage
        .from('store-covers')
        .upload(storagePath, coverFile, { upsert: true, contentType: coverFile.type })
      if (upErr) throw upErr
      await supabase.from('stores').update({ cover_image_path: storagePath }).eq('id', sid)

      setStep(2)
    } catch (e: any) {
      setError(e.message ?? '오류가 발생했습니다.')
    } finally { setLoading(false) }
  }

  /* ── 뒤로가기 ── */
  function goBack() {
    setError('')
    if (step === 1) setStep(0)
    else if (step === 2) setStep(1)
    else if (step === 3) setStep(2)
    else if (step === 4) setStep(3)
  }

  /* ── Step 2: 카테고리 + 메뉴 저장 ── */
  async function handleStep2Save() {
    const validMenus = menuItems.filter(m => m.name.trim())
    if (cats.length === 0 && validMenus.length === 0) { setStep(3); return }
    setLoading(true); setError('')
    try {
      // 카테고리 INSERT → DB id 매핑
      const catIdMap: Record<string, string> = {}
      for (let i = 0; i < cats.length; i++) {
        const { data: cd, error: ce } = await supabase
          .from('categories')
          .insert({ store_id: storeId, name: cats[i].name, display_order: i + 1 })
          .select('id').single()
        if (ce) throw ce
        catIdMap[cats[i].localId] = cd.id
      }
      // 메뉴 INSERT + 이미지 업로드
      let saved = 0
      for (let i = 0; i < validMenus.length; i++) {
        const m = validMenus[i]
        const { data: md, error: me } = await supabase
          .from('menus')
          .insert({
            category_id:   m.catLocalId ? (catIdMap[m.catLocalId] ?? null) : null,
            name:          m.name.trim(),
            base_price:    parseInt(m.price.replace(/,/g, ''), 10) || 0,
            display_order: i + 1,
          })
          .select('id').single()
        if (me) throw me
        if (m.imageFile && md) {
          const ext = m.imageFile.name.split('.').pop() ?? 'jpg'
          const { data: up } = await supabase.storage
            .from('menu-images')
            .upload(`${crypto.randomUUID()}.${ext}`, m.imageFile, { contentType: m.imageFile.type })
          if (up) {
            const url = supabase.storage.from('menu-images').getPublicUrl(up.path).data.publicUrl
            await supabase.from('menus').update({ image_url: url }).eq('id', md.id)
          }
        }
        saved++
      }
      setMenusSaved(saved)
      setStep(3)
    } catch (e: any) {
      setError(e.message ?? '오류가 발생했습니다.')
    } finally { setLoading(false) }
  }

  /* ── 카테고리 추가 → 첫 메뉴 행 자동 생성 ── */
  function addCat() {
    const name = newCatName.trim()
    if (!name) return
    const catLocalId = crypto.randomUUID()
    setCats(prev => [...prev, { localId: catLocalId, name }])
    setSelectedCat(catLocalId)
    setMenuItems(prev => [...prev, { localId: crypto.randomUUID(), catLocalId, name: '', price: '', imageFile: undefined, imagePreview: '' }])
    setNewCatName('')
  }

  /* ── 메뉴 행 수정 → 마지막 행에 데이터 생기면 다음 행 자동 추가 ── */
  function updateMenuItem(localId: string, field: keyof ObMenu, val: string | File) {
    setMenuItems(prev => {
      const updated = prev.map(m => m.localId === localId ? { ...m, [field]: val } : m)
      const item = updated.find(m => m.localId === localId)
      if (!item) return updated
      const catItems = updated.filter(m => m.catLocalId === item.catLocalId)
      const isLast   = catItems[catItems.length - 1]?.localId === localId
      const hasData  = !!(item.name.trim() || item.price.trim())
      if (isLast && hasData) {
        return [...updated, { localId: crypto.randomUUID(), catLocalId: item.catLocalId, name: '', price: '', imageFile: undefined, imagePreview: '' }]
      }
      return updated
    })
  }
  function removeMenuItem(localId: string) {
    setMenuItems(prev => prev.filter(m => m.localId !== localId))
  }

  /* ── Step 3: 고객 저장 ── */
  async function handleStep3Save() {
    const valid = accRows.filter(r => r.name.trim() && r.manager.trim() && r.pin.trim().length === 4)
    if (valid.length === 0) { setStep(4); handleScan(); return }
    setLoading(true); setError(''); setPinError('')
    try {
      // PIN 중복 체크
      for (const r of valid) {
        const { data: dup } = await supabase
          .from('accounts')
          .select('account_code')
          .eq('pin_code', r.pin.trim())
          .eq('store_id', storeId)
          .eq('is_active', true)
          .maybeSingle()
        if (dup) { setPinError(`PIN ${r.pin}이 이미 사용 중입니다.`); setLoading(false); return }
      }

      const inserts = valid.map(r => ({
        store_id:       storeId,
        account_name:   r.name.trim(),
        account_type:   '기타' as const,
        contact_person: r.manager.trim(),
        pin_code:       r.pin.trim(),
        current_balance: parseInt(r.balance.replace(/,/g,''),10) || 0,
        is_active:      true,
      }))
      const { error: ae } = await supabase.from('accounts').insert(inserts)
      if (ae) throw ae
      setAccSaved(valid.map(r => ({ name: r.name.trim() })))
      setStep(4)
      handleScan()
    } catch (e: any) {
      setError(e.message ?? '오류가 발생했습니다.')
    } finally { setLoading(false) }
  }

  /* ── 프린터 스캔 ── */
  async function handleScan() {
    setScanning(true); setConnectErr('')
    const found = await api().listPorts?.() ?? []
    setPorts(found)
    if (found.length > 0) setPrinterPath(found[0].path)
    setScanning(false)
  }

  /* ── 프린터 연결 ── */
  async function handleConnect() {
    if (!printerPath) { setConnectErr(`${PORT_LABEL}를 선택해 주세요.`); return }
    setConnecting(true); setConnectErr('')
    await api().updateSettings?.({ printer: { path: printerPath, baudRate, cutMode: 'partial' } })
    const res = await api().connectPrinter?.()
    if (res && !res.ok) {
      setConnectErr(res.error ?? '연결에 실패했습니다. 포트와 케이블을 확인해 주세요.')
    } else {
      setConnected(true)
    }
    setConnecting(false)
  }

  /* ── 고객 행 편집 헬퍼 ── */
  function setAccRow(idx: number, field: keyof AccountRow, val: string) {
    setAccRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  }
  function addAccRow() { setAccRows(prev => [...prev, { name: '', manager: '', pin: '', balance: '' }]) }
  function removeAccRow(idx: number) { setAccRows(prev => prev.filter((_, i) => i !== idx)) }

  /* ── 진행 바 너비 ── */
  const progressWidth = (step === 0 || step === 2) ? 700 : 480

  return (
    <div className="relative flex h-full items-center justify-center bg-gray-bg overflow-auto py-8">
      {/* 뒤로가기 — 회색 배경 좌상단 */}
      {step > 0 && (
        <button
          onClick={goBack}
          className="absolute top-5 left-5 flex items-center gap-1.5 text-gray-text hover:text-ink transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
          <span className="text-[13px] font-semibold">이전</span>
        </button>
      )}
      <div
        className="bg-white rounded-2xl shadow-sm"
        style={{
          width: progressWidth,
          maxWidth: 'calc(100vw - 48px)',
          padding: '32px 36px',
          ...(step === 0 ? { maxHeight: 'calc(100vh - 64px)', display:'flex', flexDirection:'column' } : {}),
        }}
      >
        {/* ── 진행 단계 바 ── */}
        <div className="flex items-center gap-0 mb-8" style={{ flexShrink:0 }}>
          {STEP_LABELS.map((label, s) => (
            <div key={s} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors
                    ${step > s ? 'bg-[#00DD67] text-[#1A1A1A]' : step === s ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text'}`}
                >
                  {step > s ? (
                    <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
                      <path d="M1 4.5L4 7.5L11 1" stroke="#1A1A1A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : s + 1}
                </div>
                <span className={`text-[10px] whitespace-nowrap ${step === s ? 'text-ink font-semibold' : 'text-gray-text'}`}>
                  {label}
                </span>
              </div>
              {s < 4 && (
                <div className={`h-[1px] w-10 mx-1 mb-4 transition-colors ${step > s ? 'bg-[#00DD67]' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* ────────────────────────────────────────────────────────────
            Step 0: 요금제 선택
        ──────────────────────────────────────────────────────────── */}
        {step === 0 && (
          <div style={{ display:'flex', flexDirection:'column', minHeight:0 }}>
            <h1 className="text-[22px] font-bold text-ink mb-1">요금제를 선택해주세요</h1>
            <p className="text-[13px] text-gray-text mb-5">선결제 고객 팀 수에 맞게 추천해드려요. 언제든 변경 가능해요.</p>

            {/* 슬라이더 */}
            <div style={{ background:'#F9FBF9', border:'1px solid #E1E7E2', borderRadius:12, padding:'16px 20px', marginBottom:16, flexShrink:0 }}>
              <div style={{ marginBottom:12 }}>
                <label htmlFor="ob-teamCount" style={{ fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  나의 선결제 고객은{' '}
                  <span style={{ fontFamily:'"IBM Plex Mono",monospace', color:'#04A551' }}>
                    '{teamCount >= 25 ? '25팀 이상' : `${teamCount}팀`}'
                  </span>
                </label>
              </div>
              <style>{`
                #ob-teamCount { -webkit-appearance:none; appearance:none; width:100%; height:26px; background:transparent; cursor:pointer; outline:none; display:block; }
                #ob-teamCount::-webkit-slider-runnable-track { height:5px; border-radius:99px; background:linear-gradient(to right,#00CE63 ${fillPct}%,#E1E7E2 ${fillPct}%); }
                #ob-teamCount::-webkit-slider-thumb { -webkit-appearance:none; width:20px; height:20px; border-radius:50%; background:#fff; border:3px solid #00CE63; box-shadow:0 2px 6px rgba(4,64,32,.16); margin-top:-7.5px; }
              `}</style>
              <input type="range" id="ob-teamCount" min={1} max={25} value={teamCount} step={1} onChange={handleRangeChange} />
              <div style={{ display:'flex', justifyContent:'space-between', fontFamily:'"IBM Plex Mono",monospace', fontSize:10, color:'#79837C', marginTop:2 }}>
                {['1','5','10','20','25+'].map(v => <span key={v}>{v}</span>)}
              </div>
            </div>

            {/* ── 스크롤 영역: 카드 + 기능 비교표 ── */}
            <div style={{ overflowY:'auto', flex:1, marginBottom:14, paddingTop:14 }}>

              {/* 플랜 카드 4종 */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:14 }}>
                {ALL_PLANS.map(plan => {
                  const isSelected = selectedPlan === plan.id
                  const isMatch    = matchedPlan   === plan.id
                  const isCurrent  = savedPlan     === plan.id
                  return (
                    <button
                      key={plan.id}
                      onClick={() => setSelectedPlan(plan.id)}
                      style={{
                        border:`2px solid ${isSelected ? '#00CE63' : '#E1E7E2'}`,
                        borderRadius:12, padding:'14px 13px',
                        background: isSelected ? '#F0FBF5' : '#fff',
                        textAlign:'left', cursor:'pointer',
                        transition:'border-color 0.15s,background 0.15s',
                        position:'relative',
                        display:'flex', flexDirection:'column',
                      }}
                    >
                      {isMatch && !isCurrent && (
                        <span style={{ position:'absolute', top:-10, left:'50%', transform:'translateX(-50%)', background:'#00CE63', color:'#03301A', fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, whiteSpace:'nowrap' }}>
                          추천
                        </span>
                      )}
                      {isCurrent && (
                        <span style={{ position:'absolute', top:-10, left:'50%', transform:'translateX(-50%)', background:'#1A1A1A', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, whiteSpace:'nowrap' }}>
                          현 요금제
                        </span>
                      )}
                      {/* 이름: 고정 높이로 y축 맞춤 */}
                      <div style={{ height:22, display:'flex', alignItems:'center', fontWeight:800, fontSize:14, letterSpacing:'-0.025em', color:'#1A1A1A' }}>
                        {plan.name}
                      </div>
                      {/* 가격: 고정 높이로 y축 맞춤 */}
                      <div style={{ height:44, display:'flex', flexDirection:'column', justifyContent:'center', margin:'6px 0 0' }}>
                        <div style={{ fontFamily:'"IBM Plex Mono",monospace', fontSize:17, fontWeight:700, color:'#1A1A1A', lineHeight:1.2 }}>
                          {plan.price === 0 ? '무료' : `₩${plan.price.toLocaleString()}`}
                        </div>
                        <div style={{ fontSize:10, color:'#79837C', marginTop:2 }}>
                          {plan.price === 0 ? '기간 제한 없음' : `/ 월 · ${plan.perday}`}
                        </div>
                      </div>
                      {/* 팀 한도 뱃지 */}
                      <div style={{ padding:'5px 8px', borderRadius:7, background: isSelected ? '#D6F5E5' : '#F5F8F6', fontSize:12, fontWeight:700, color:'#1A1A1A', textAlign:'center', marginTop:8 }}>
                        {plan.teamLimit}
                      </div>
                      {/* 기능 목록 */}
                      <ul style={{ listStyle:'none', marginTop:10, display:'flex', flexDirection:'column', gap:5 }}>
                        {plan.inherits && (
                          <li style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#B0B0B0', fontWeight:400 }}>
                            <CheckCircle /><span>{plan.inherits}</span>
                          </li>
                        )}
                        {plan.extras.map(f => (
                          <li key={f} style={{ display:'flex', alignItems:'flex-start', gap:5, fontSize:11, color:'#1A1A1A', lineHeight:1.4 }}>
                            <CheckCircle /><span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </button>
                  )
                })}
              </div>

              {/* ── 기능 비교표 ── */}
              <div style={{ border:'1px solid #E1E7E2', borderRadius:10, overflow:'hidden' }}>
                {/* 헤더 */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr repeat(4,80px)', background:'#F5F8F6', borderBottom:'1px solid #E1E7E2' }}>
                  <div style={{ padding:'8px 12px', fontSize:11, fontWeight:700, color:'#79837C' }}>기능</div>
                  {ALL_PLANS.map(p => (
                    <div key={p.id} style={{ padding:'8px 0', fontSize:12, fontWeight:700, color: selectedPlan === p.id ? '#04A551' : '#9CA3AF', textAlign:'center' }}>
                      {p.name}
                    </div>
                  ))}
                </div>
                {/* 행 */}
                {FEATURE_TABLE.map((row, i) => (
                  <div
                    key={row.label}
                    style={{
                      display:'grid', gridTemplateColumns:'1fr repeat(4,80px)',
                      borderBottom: i < FEATURE_TABLE.length - 1 ? '1px solid #F0F0F0' : 'none',
                      background: i % 2 === 0 ? '#fff' : '#FAFBFA',
                    }}
                  >
                    <div style={{ padding:'7px 12px', fontSize:12.5, color:'#3D3D3D' }}>{row.label}</div>
                    {(['free','basic','pro','max'] as PlanTier[]).map(pid => (
                      <div key={pid} style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'7px 0' }}>
                        <FCell v={row[pid]} isSelected={selectedPlan === pid} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>

            </div>{/* /scroll area */}

            {/* CTA */}
            {error && <p className="text-[13px] text-danger mb-2 text-right">{error}</p>}
            <div style={{ display:'flex', justifyContent:'flex-end' }}>
              <button
                onClick={handleStep0}
                disabled={loading}
                className="py-2.5 px-6 bg-ink text-white rounded-xl font-bold text-[13px] hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {loading ? '저장 중...' : `${ALL_PLANS.find(p => p.id === selectedPlan)?.name} 플랜으로 시작하기`}
              </button>
            </div>
          </div>
        )}

        {/* ────────────────────────────────────────────────────────────
            Step 1: 매장 정보
        ──────────────────────────────────────────────────────────── */}
        {step === 1 && (
          <>
            <h1 className="text-[22px] font-bold text-ink mb-1">매장 정보를 입력해주세요</h1>
            <p className="text-[13px] text-gray-text mb-6">POS 화면 상단과 QR 주문 화면에 표시됩니다.</p>
            <form onSubmit={handleStep1} className="flex flex-col gap-4">
              <div>
                <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">매장 상호명 *</label>
                <input
                  type="text"
                  value={storeName}
                  onChange={e => setStoreName(e.target.value)}
                  placeholder="예: 행복 포케 북구점"
                  autoFocus
                  required
                  className="w-full border border-gray-border rounded-lg px-3 py-2.5 text-[14px] focus:border-green focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">대표자명 *</label>
                <input
                  type="text"
                  value={representativeName}
                  onChange={e => setRepresentativeName(e.target.value.slice(0, 10))}
                  placeholder="예: 홍길동"
                  required
                  maxLength={10}
                  className="w-full border border-gray-border rounded-lg px-3 py-2.5 text-[14px] focus:border-green focus:outline-none transition-colors"
                />
                <p className="text-[11px] text-gray-text mt-1 text-right">{representativeName.length}/10</p>
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">주소 *</label>
                <input
                  type="text"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="예: 대구 북구 침산동 123-45"
                  required
                  className="w-full border border-gray-border rounded-lg px-3 py-2.5 text-[14px] focus:border-green focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">대표 사진 *</label>
                <label className={`flex flex-col items-center justify-center w-full border rounded-lg cursor-pointer transition-colors overflow-hidden
                  ${coverFile ? 'border-green' : 'border-gray-border hover:border-gray-400'}`}
                  style={{ height: 120 }}
                >
                  {coverPreview ? (
                    <img src={coverPreview} alt="대표 사진 미리보기" className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 text-gray-text">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                      <span className="text-[12px]">클릭하여 사진 선택</span>
                      <span className="text-[11px] text-gray-300">JPG·PNG·WebP, 최대 2MB</span>
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (!f) return
                      if (f.size > 2 * 1024 * 1024) { setError('사진 파일은 2MB 이하여야 합니다.'); return }
                      setCoverFile(f)
                      setCoverPreview(URL.createObjectURL(f))
                      setError('')
                    }}
                  />
                </label>
              </div>
              {error && <p className="text-[13px] text-danger">{error}</p>}
              <button
                type="submit"
                disabled={!storeName.trim() || !representativeName.trim() || !address.trim() || !coverFile || loading}
                className="w-full py-3 bg-ink text-white rounded-xl font-bold text-[14px] hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {loading ? '생성 중...' : '다음'}
              </button>
            </form>
          </>
        )}

        {/* ────────────────────────────────────────────────────────────
            Step 2: 메뉴 등록
        ──────────────────────────────────────────────────────────── */}
        {step === 2 && (
          <>
            <h1 className="text-[22px] font-bold text-ink mb-1">판매할 메뉴를 추가해주세요</h1>
            <p className="text-[13px] text-gray-text mb-4">나중에 메뉴 관리 탭에서 언제든 수정·추가할 수 있어요.</p>

            {/* ── 2패널 레이아웃 ── */}
            <div className="flex gap-0 border border-gray-border rounded-xl overflow-hidden mb-4" style={{ height: 380 }}>

              {/* 좌측: 카테고리 패널 */}
              <div className="flex flex-col bg-gray-bg border-r border-gray-border" style={{ width: 160, flexShrink: 0 }}>
                <div className="px-3 pt-3 pb-2 text-[10px] font-bold text-gray-text uppercase tracking-wide">카테고리</div>

                {/* 카테고리 목록 */}
                <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
                  {/* 전체 (카테고리 없음) */}
                  <button
                    onClick={() => setSelectedCat(null)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-[12px] font-semibold transition-colors
                      ${selectedCat === null ? 'bg-ink text-white' : 'text-ink hover:bg-gray-200'}`}
                  >
                    전체
                  </button>
                  {cats.map(cat => (
                    <button
                      key={cat.localId}
                      onClick={() => setSelectedCat(cat.localId)}
                      className={`w-full text-left px-2.5 py-2 rounded-lg text-[12px] font-semibold transition-colors flex items-center justify-between group
                        ${selectedCat === cat.localId ? 'bg-ink text-white' : 'text-ink hover:bg-gray-200'}`}
                    >
                      <span className="truncate">{cat.name}</span>
                      <span
                        onClick={e => {
                          e.stopPropagation()
                          setCats(prev => prev.filter(c => c.localId !== cat.localId))
                          setMenuItems(prev => prev.filter(m => m.catLocalId !== cat.localId))
                          if (selectedCat === cat.localId) setSelectedCat(null)
                        }}
                        className={`ml-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] ${selectedCat === cat.localId ? 'text-white/60 hover:text-white' : 'text-gray-400 hover:text-danger'}`}
                      >✕</span>
                    </button>
                  ))}
                </div>

                {/* 카테고리 추가 입력 */}
                <div className="p-2 border-t border-gray-border">
                  <div className="flex gap-1">
                    <input
                      value={newCatName}
                      onChange={e => setNewCatName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCat() } }}
                      placeholder="카테고리명"
                      className="flex-1 min-w-0 border border-gray-border rounded-lg px-2 py-1.5 text-[11px] focus:border-green focus:outline-none transition-colors bg-white"
                    />
                    <button
                      onClick={addCat}
                      disabled={!newCatName.trim()}
                      className="w-7 h-7 rounded-lg bg-ink text-white flex items-center justify-center flex-shrink-0 hover:opacity-80 disabled:opacity-30 transition-opacity"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* 우측: 메뉴 편집 패널 */}
              <div className="flex flex-col flex-1 min-w-0 bg-white">
                <>
                  {/* 헤더 */}
                  <div className="px-4 pt-3 pb-2 grid gap-2 text-[10px] font-bold text-gray-text uppercase tracking-wide border-b border-gray-border"
                       style={{ gridTemplateColumns: '44px 1fr 110px 28px' }}>
                    <span>사진</span><span>메뉴명</span><span>가격 (원)</span><span/>
                  </div>

                  {/* 메뉴 행 목록 */}
                  <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
                    {menuItems.filter(m => m.catLocalId === selectedCat).map(m => (
                        <div key={m.localId} className="grid gap-2 items-center" style={{ gridTemplateColumns: '44px 1fr 110px 28px' }}>
                          {/* 이미지 업로드 */}
                          <div
                            className="w-10 h-9 rounded-lg border border-gray-border cursor-pointer flex items-center justify-center overflow-hidden relative hover:bg-gray-100 transition-colors flex-shrink-0 group"
                            onClick={() => (document.getElementById(`ob-img-${m.localId}`) as HTMLInputElement)?.click()}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => {
                              e.preventDefault()
                              const file = e.dataTransfer.files[0]
                              if (file?.type.startsWith('image/')) {
                                updateMenuItem(m.localId, 'imageFile', file)
                                updateMenuItem(m.localId, 'imagePreview', URL.createObjectURL(file))
                              }
                            }}
                          >
                            <input id={`ob-img-${m.localId}`} type="file" accept="image/*" className="hidden"
                              onChange={e => {
                                const f = e.target.files?.[0]
                                if (!f) return
                                updateMenuItem(m.localId, 'imageFile', f)
                                updateMenuItem(m.localId, 'imagePreview', URL.createObjectURL(f))
                              }}
                            />
                            {m.imagePreview
                              ? <img src={m.imagePreview} className="w-full h-full object-cover" alt="" />
                              : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="stroke-gray-300 group-hover:stroke-gray-500 transition-colors" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                                </svg>
                            }
                          </div>
                          <input
                            type="text"
                            value={m.name}
                            onChange={e => updateMenuItem(m.localId, 'name', e.target.value)}
                            placeholder="메뉴명"
                            className="border border-gray-border rounded-lg px-3 py-2 text-[12px] focus:border-green focus:outline-none transition-colors w-full"
                          />
                          <input
                            type="text"
                            value={m.price}
                            onChange={e => updateMenuItem(m.localId, 'price', e.target.value.replace(/[^0-9]/g,'').replace(/\B(?=(\d{3})+(?!\d))/g,','))}
                            placeholder="0"
                            className="border border-gray-border rounded-lg px-3 py-2 text-[12px] focus:border-green focus:outline-none transition-colors w-full text-right"
                          />
                          <button
                            onClick={() => removeMenuItem(m.localId)}
                            className="flex items-center justify-center w-7 h-7 rounded-lg text-gray-text hover:text-danger hover:bg-red-50 transition-colors text-[15px]"
                          >×</button>
                        </div>
                      ))}
                  </div>

                </>
              </div>
            </div>

            {error && <p className="text-[13px] text-danger mb-3">{error}</p>}

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setStep(3)}
                className="py-2.5 px-5 border border-gray-border text-gray-text rounded-xl font-semibold text-[13px] hover:bg-gray-bg transition-colors"
              >
                건너뛰기
              </button>
              <button
                onClick={handleStep2Save}
                disabled={loading || !menuItems.some(m => m.name.trim())}
                className={`py-2.5 px-6 rounded-xl font-bold text-[13px] transition-opacity
                  ${menuItems.some(m => m.name.trim())
                    ? 'bg-ink text-white hover:opacity-90 disabled:opacity-50'
                    : 'bg-[#9CA3AF] text-white cursor-not-allowed'}`}
              >
                {loading ? '저장 중...' : '다음'}
              </button>
            </div>
          </>
        )}

        {/* ────────────────────────────────────────────────────────────
            Step 3: 고객(거래처) 등록
        ──────────────────────────────────────────────────────────── */}
        {step === 3 && (
          <>
            <h1 className="text-[22px] font-bold text-ink mb-1">선결제 고객을 등록해주세요</h1>
            <p className="text-[13px] text-gray-text mb-5">고객이 PIN을 입력해 주문하는 방식이에요. 나중에 추가해도 돼요.</p>

            <div className="flex flex-col gap-3 mb-3">
              {/* 헤더 */}
              <div className="grid gap-2 text-[11px] font-bold text-gray-text uppercase tracking-wide" style={{ gridTemplateColumns:'1fr 1fr 80px 110px 28px' }}>
                <span>거래처명</span>
                <span>담당자명</span>
                <span>PIN (4자리)</span>
                <span>초기 잔액 (원)</span>
                <span></span>
              </div>

              {accRows.map((row, idx) => (
                <div key={idx} className="grid gap-2 items-center" style={{ gridTemplateColumns:'1fr 1fr 80px 110px 28px' }}>
                  <input
                    type="text"
                    value={row.name}
                    onChange={e => setAccRow(idx, 'name', e.target.value)}
                    placeholder="예: 북구청 공원과"
                    className="border border-gray-border rounded-lg px-3 py-2 text-[13px] focus:border-green focus:outline-none transition-colors w-full"
                  />
                  <input
                    type="text"
                    value={row.manager}
                    onChange={e => setAccRow(idx, 'manager', e.target.value)}
                    placeholder="예: 김담당"
                    className="border border-gray-border rounded-lg px-3 py-2 text-[13px] focus:border-green focus:outline-none transition-colors w-full"
                  />
                  <input
                    type="text"
                    value={row.pin}
                    onChange={e => setAccRow(idx, 'pin', e.target.value.replace(/\D/g,'').slice(0,4))}
                    placeholder="0000"
                    maxLength={4}
                    className="border border-gray-border rounded-lg px-3 py-2 text-[13px] focus:border-green focus:outline-none transition-colors w-full text-center tracking-widest font-mono"
                  />
                  <input
                    type="text"
                    value={row.balance}
                    onChange={e => setAccRow(idx, 'balance', e.target.value.replace(/[^0-9]/g,'').replace(/\B(?=(\d{3})+(?!\d))/g,','))}
                    placeholder="0"
                    className="border border-gray-border rounded-lg px-3 py-2 text-[13px] focus:border-green focus:outline-none transition-colors w-full text-right"
                  />
                  <button
                    onClick={() => removeAccRow(idx)}
                    disabled={accRows.length === 1}
                    className="flex items-center justify-center w-7 h-7 rounded-lg text-gray-text hover:text-danger hover:bg-red-50 transition-colors disabled:opacity-20"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={addAccRow}
              className="text-[13px] text-gray-text hover:text-[#00DD67] flex items-center gap-1 mb-2 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              고객 한 줄 추가
            </button>

            {(error || pinError) && (
              <p className="text-[13px] text-danger mb-3">{pinError || error}</p>
            )}

            <div className="flex gap-2 mt-3">
              <button
                onClick={() => { setStep(4); handleScan() }}
                className="flex-1 py-3 border border-gray-border text-gray-text rounded-xl font-semibold text-[13px] hover:bg-gray-bg transition-colors"
              >
                건너뛰기
              </button>
              <button
                onClick={handleStep3Save}
                disabled={loading || !accRows.some(r => r.name.trim() && r.manager.trim() && r.pin.trim().length === 4)}
                className={`flex-[2] py-3 rounded-xl font-bold text-[14px] transition-opacity
                  ${accRows.some(r => r.name.trim() && r.manager.trim() && r.pin.trim().length === 4)
                    ? 'bg-ink text-white hover:opacity-90 disabled:opacity-50'
                    : 'bg-[#9CA3AF] text-white cursor-not-allowed'}`}
              >
                {loading ? '저장 중...' : '다음'}
              </button>
            </div>
          </>
        )}

        {/* ────────────────────────────────────────────────────────────
            Step 4: 프린터 연결
        ──────────────────────────────────────────────────────────── */}
        {step === 4 && (
          <>
            <h1 className="text-[22px] font-bold text-ink mb-1">영수증 프린터를 연결해주세요</h1>
            <p className="text-[13px] text-gray-text mb-6">프린터가 없으면 '나중에 연결'을 누르고 시작할 수 있어요.</p>

            {/* 온보딩 요약 카드 */}
            {(menusSaved > 0 || accSaved.length > 0) && (
              <div className="bg-gray-bg rounded-xl px-4 py-3 mb-5 flex gap-4">
                {menusSaved > 0 && (
                  <div className="flex items-center gap-1.5 text-[12px] text-gray-text">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00DD67" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>
                    </svg>
                    메뉴 <strong className="text-ink">{menusSaved}개</strong> 등록
                  </div>
                )}
                {accSaved.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[12px] text-gray-text">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00DD67" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="7" r="4"/><path d="M2 21v-2a6 6 0 0 1 6-6h2"/><circle cx="17" cy="16" r="3"/><path d="M20.5 19.5 22 21"/>
                    </svg>
                    고객 <strong className="text-ink">{accSaved.length}팀</strong> 등록
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-4">
              {/* 포트 선택 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide">{PORT_LABEL}</label>
                  <button
                    onClick={handleScan}
                    disabled={scanning}
                    className="text-[12px] text-green font-semibold bg-green-soft rounded-lg px-3 py-1 hover:opacity-80 disabled:opacity-50 transition-opacity"
                  >
                    {scanning ? '감지 중…' : `${PORT_LABEL} 감지`}
                  </button>
                </div>
                {ports.length > 0 ? (
                  <select
                    value={printerPath}
                    onChange={e => setPrinterPath(e.target.value)}
                    className="w-full border border-gray-border rounded-lg px-3 py-2.5 text-[14px] focus:border-green focus:outline-none bg-white pr-8"
                  >
                    {ports.map(p => <option key={p.path} value={p.path}>{p.friendlyName ?? p.path}</option>)}
                  </select>
                ) : (
                  <div className="w-full border border-gray-border rounded-lg px-3 py-2.5 text-[14px] text-gray-text bg-gray-bg">
                    {scanning ? `${PORT_LABEL} 감지 중…` : '프린터를 연결한 뒤 감지 버튼을 눌러주세요.'}
                  </div>
                )}
              </div>

              {/* 호환 기종 안내 */}
              <div className="bg-gray-bg rounded-xl px-4 py-3 text-[11px] text-gray-text leading-relaxed">
                <p className="font-bold text-ink mb-1.5">✓ 호환 프린터 조건</p>
                <p>· <span className="font-semibold text-ink">ESC/POS</span> 지원 58mm 열감지(감열) 프린터</p>
                <p>· USB 연결 후 PC에서 <span className="font-semibold text-ink">가상 COM 포트</span>로 잡히는 제품</p>
                <p className="mt-2 font-bold text-ink mb-1">대표 호환 기종</p>
                <p>Epson TM 시리즈 · Bixolon SRP-270/280/320 · Samsung SRP 시리즈</p>
                <p className="mt-2 text-[10px] text-gray-text">WiFi·LAN·Bluetooth 연결 프린터나 80mm 프린터는 지원되지 않을 수 있어요.</p>
              </div>

              {/* 보드레이트 */}
              <div>
                <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">통신 속도</label>
                <SegmentedControl
                  options={BAUD_RATES.map(b => ({ label: String(b), value: b }))}
                  value={baudRate}
                  onChange={setBaudRate}
                />
              </div>

              {connectErr && <p className="text-[13px] text-danger">{connectErr}</p>}

              {connected ? (
                <div className="flex items-center gap-2 bg-green-soft rounded-xl px-4 py-3">
                  <span className="text-[#00DD67] text-[18px] font-bold">✓</span>
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
            </div>

            {/* 시작하기 버튼 */}
            <button
              onClick={async () => {
                // 온보딩 완료 표시 — 창 전환 후 SIGNED_IN 이벤트로 인한 온보딩 우회 방지
                await supabase.from('stores').update({ onboarding_completed: true }).eq('id', storeId)
                onComplete(storeId, storeName.trim(), selectedPlan)
              }}
              className="w-full mt-5 py-3.5 bg-[#00DD67] text-[#1A1A1A] rounded-xl font-bold text-[15px] hover:bg-[#00BB55] transition-colors"
            >
              시작하기
            </button>

            {!connected && (
              <p className="text-center text-[12px] text-gray-text mt-2">
                프린터는 설정 탭에서 나중에 연결할 수 있어요
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

