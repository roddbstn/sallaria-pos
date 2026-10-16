import { useState, useEffect } from 'react'
import { useStore } from '../lib/store-context'
import { supabase } from '../lib/supabase'
import { useDeliveryInfo } from '../hooks/useDeliveryInfo'
import DaumPostcodeEmbed from '../components/DaumPostcodeEmbed'
import HubLayout, { type HubNavItem } from '../components/hub/HubLayout'
import TimeSelect from '../components/ui/TimeSelect'
import MiniCalendar from '../components/ui/MiniCalendar'
import RegularHolidayModal, { type RegularHolidays } from '../components/ui/RegularHolidayModal'
import PasswordChangeModal from '../components/auth/PasswordChangeModal'
import { fromE164 } from './auth/signup/phone-format'
import { PLAN_NAMES, type PlanTier } from '../lib/plans'
import { UpgradeModal } from './Sales'
import { DAY_LABELS, DAY_ORDER, type DayHours, type BreakHours } from './Settings'
import BreakTimeModal from '../components/ui/BreakTimeModal'
import type { VacationDay } from '../hooks/useOperatingHours'

// Figma node 664:541 "매장 정보 - 매장 설정" — 2240px 캔버스 원본 px × 0.643(FIGMA_SCALE, 앱 기본
// 창 폭 1440 기준)로 환산한 고정 실제 px 레이아웃. 영업시간·주소는 새로 만들지 않고 Settings.tsx가
// 이미 쓰는 훅/상태(App.tsx에서 내려주는 operatingHours/breakTime, useDeliveryInfo)를 그대로
// 재사용하되, 화면 자체(좌측 사이드바 색상 #6A635E, 칩 스타일, 요일 그리드 등)는 Figma 그대로 구현.

const BUSINESS_TYPES_ROW1 = ['한식 · 분식', '카페 · 디저트', '샐러드 · 포케']
const BUSINESS_TYPES_ROW2 = ['샌드위치 · 베이커리', '치킨 · 버거', '기타']
const CUSTOMER_TYPES: { value: '부서' | '기업' | '개인'; label: string }[] = [
  { value: '부서', label: '부서' },
  { value: '기업', label: '기업' },
  { value: '개인', label: '개인' },
]

// Figma 수치(×0.643) 기준에서 본문 전체를 두 번 줄였다. 현재 타입 스케일:
//   좌상단 메인 제목 18/semibold(유일한 semibold) · 필드 라벨 16/medium
//   값 16~18/medium · 칩·시간·날짜 14/normal · 보조 11~13/normal
// "좌상단 메인 텍스트 외에는 얇은 체" 규칙에 따라 본문에서 semibold는 제목 하나뿐이다.

// 활성/비활성 칩 — 활성 bg #6A635E + #FCFCFC bold, 비활성 bg #F2F2F2 + #787878 medium
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-[32px] px-[11px] rounded-[9px] text-[14px] leading-[17px] whitespace-nowrap transition-colors ${
        active ? 'bg-[#6A635E] text-[#FCFCFC] font-normal' : 'bg-[#F2F2F2] text-[#787878] font-normal'
      }`}
    >
      {children}
    </button>
  )
}

// Figma: label 32/600 #414141. label↔값 간격은 43→28(=25px)로 모든 라벨 공통
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[16px] font-medium leading-[19px] text-[#414141] mb-[25px]">
      {children}
    </div>
  )
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
      <path d="M6 3.5L10.5 8L6 12.5" stroke="#6A635E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// Figma Group 89: 19×19 X, stroke #2C261F
function CloseIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="flex-shrink-0">
      <path d="M2 2L10 10M10 2L2 10" stroke="#2C261F" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  )
}

// Figma Frame 187/188: w 330.63→213(→190) · bg #F2F2F2 · radius 15→10 · #787878
function SectionPill({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-[32px] w-[178px] px-[11px] rounded-[9px] bg-[#F2F2F2] flex items-center justify-between hover:bg-[#E8E4E2] transition-colors"
    >
      <span className="text-[14px] leading-[17px] font-normal text-[#787878]">{label}</span>
      <ChevronIcon />
    </button>
  )
}

// Figma Frame 189: bg #E8E4E2 · radius 10→6 · #2C261F
function DateChip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <div className="pressable h-[32px] px-[11px] rounded-[6px] bg-[#E8E4E2] flex items-center gap-[10px] flex-shrink-0">
      <span className="text-[14px] leading-[17px] font-normal text-[#2C261F] whitespace-nowrap">{label}</span>
      {onRemove && (
        <button onClick={onRemove} aria-label={`${label} 삭제`} className="hover:opacity-60 transition-opacity">
          <CloseIcon />
        </button>
      )}
    </div>
  )
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토']

/** '2026-09-24' → '2026.9.24(토)' — Figma 칩 표기 그대로 */
function formatVacationDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const dow = WEEKDAY_KO[new Date(y, m - 1, d).getDay()]
  return `${y}.${m}.${d}(${dow})`
}

type StoreInfoTab = 'store' | 'representative'
const STORE_INFO_NAV: HubNavItem<StoreInfoTab>[] = [
  { key: 'store',          label: '매장 설정' },
  { key: 'representative', label: '대표자 정보' },
]

interface StoreInfoProps {
  onBack: () => void
  onOpenHours: () => void
  onAddVacationDays: (dates: string[]) => void
  onDeleteVacationDay: (date: string) => void
  onSetDayTime: (day: string, field: 'open' | 'close', value: string) => void
  onSignOut: () => void
  /** 정기 휴무일 — stores.regular_holidays (null이면 미설정) */
  regularHolidays: RegularHolidays | null
  onSaveRegularHolidays: (value: RegularHolidays) => void
  onSaveBreakTime: (value: Record<string, BreakHours>) => void
  operatingHours: Record<string, DayHours>
  breakTime: Record<string, BreakHours>
  vacationDays: VacationDay[]
  showToast: (msg: string) => void
}

export default function StoreInfo({
  onBack, onOpenHours, onAddVacationDays, onDeleteVacationDay, onSetDayTime,
  onSignOut, operatingHours, breakTime, vacationDays, regularHolidays, onSaveRegularHolidays,
  onSaveBreakTime, showToast,
}: StoreInfoProps) {
  const { storeId, clientId, storeName, plan } = useStore()
  const [navTab, setNavTab] = useState<StoreInfoTab>('store')

  return (
    <HubLayout
      title="매장 정보"
      items={STORE_INFO_NAV}
      activeKey={navTab}
      onChange={setNavTab}
      onBack={onBack}
    >
      {navTab === 'store' ? (
        <StoreSettingsPanel
          storeId={storeId}
          clientId={clientId}
          storeName={storeName}
          onOpenHours={onOpenHours}
          onAddVacationDays={onAddVacationDays}
          onDeleteVacationDay={onDeleteVacationDay}
          onSetDayTime={onSetDayTime}
          operatingHours={operatingHours}
          breakTime={breakTime}
          vacationDays={vacationDays}
          regularHolidays={regularHolidays}
          onSaveRegularHolidays={onSaveRegularHolidays}
          onSaveBreakTime={onSaveBreakTime}
          showToast={showToast}
        />
      ) : (
        <RepresentativePanel storeId={storeId} clientId={clientId} plan={plan} showToast={showToast} onSignOut={onSignOut} />
      )}
    </HubLayout>
  )
}

function StoreSettingsPanel({
  storeId, clientId, storeName, onOpenHours, onAddVacationDays,
  onDeleteVacationDay, onSetDayTime, operatingHours, vacationDays,
  regularHolidays, onSaveRegularHolidays, breakTime, onSaveBreakTime, showToast,
}: {
  storeId: string
  clientId: string
  storeName: string
  onOpenHours: () => void
  onAddVacationDays: (dates: string[]) => void
  onDeleteVacationDay: (date: string) => void
  onSetDayTime: (day: string, field: 'open' | 'close', value: string) => void
  operatingHours: Record<string, DayHours>
  breakTime: Record<string, BreakHours>
  vacationDays: VacationDay[]
  regularHolidays: RegularHolidays | null
  onSaveRegularHolidays: (value: RegularHolidays) => void
  onSaveBreakTime: (value: Record<string, BreakHours>) => void
  showToast: (msg: string) => void
}) {
  const delivery = useDeliveryInfo(storeId, showToast)
  const [editingLocation, setEditingLocation] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [regularOpen, setRegularOpen] = useState(false)
  const [breakOpen, setBreakOpen] = useState(false)

  const [businessTypes, setBusinessTypes] = useState<string[]>([])
  const [customerTypes, setCustomerTypes] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function load() {
      const [{ data: client }, { data: store }] = await Promise.all([
        supabase.from('clients').select('business_type').eq('id', clientId).maybeSingle(),
        supabase.from('stores').select('customer_types').eq('id', storeId).maybeSingle(),
      ])
      setBusinessTypes(client?.business_type ? client.business_type.split(',').filter(Boolean) : [])
      setCustomerTypes(store?.customer_types ?? [])
      setLoaded(true)
    }
    if (storeId && clientId) load()
  }, [storeId, clientId])

  async function saveBusinessTypes(next: string[]) {
    setBusinessTypes(next)
    const { error } = await supabase.from('clients').update({ business_type: next.join(',') }).eq('id', clientId)
    if (error) showToast('업종 유형 저장에 실패했습니다')
  }
  async function saveCustomerTypes(next: string[]) {
    setCustomerTypes(next)
    const { error } = await supabase.from('stores').update({ customer_types: next }).eq('id', storeId)
    if (error) showToast('선결제 고객유형 저장에 실패했습니다')
  }

  async function handleSaveLocation() {
    const ok = await delivery.saveLocation()
    if (ok) setEditingLocation(false)
  }

  // Figma: 월/화/수는 좌측 그룹, 목/금/토/일은 우측 그룹 — 2열로 나란히
  const DAY_COL1 = DAY_ORDER.slice(0, 3)
  const DAY_COL2 = DAY_ORDER.slice(3)

  // 오픈/마감 박스는 운영시간 모달을 띄우지 않고 그 자리에서 드롭다운으로 고른다.
  // 휴무 요일은 "휴무" 상태를 유지하되, 누르면 영업시간 모달로 보내 다시 켤 수 있게 한다.
  function DayRow({ day }: { day: string }) {
    const h = operatingHours[day]
    const enabled = h?.enabled ?? false
    return (
      <div className="flex items-center gap-[24px] w-full">
        <span className="text-[13px] leading-[16px] font-medium text-[#414141] w-[14px] flex-shrink-0">{DAY_LABELS[day]}</span>
        {enabled ? (
          <span className="flex-1 min-w-0 flex items-center gap-[6px]">
            <TimeSelect value={h.open}  placeholder="오픈 시간" onChange={v => onSetDayTime(day, 'open', v)} />
            <span className="text-[15px] leading-[18px] text-[#ADADAD] flex-shrink-0">~</span>
            <TimeSelect value={h.close} placeholder="마감 시간" onChange={v => onSetDayTime(day, 'close', v)} />
          </span>
        ) : (
          <button
            onClick={onOpenHours}
            className="flex-1 min-w-0 h-[32px] px-[11px] rounded-[9px] bg-[#F2F2F2] flex items-center justify-between hover:bg-[#E8E4E2] transition-colors"
          >
            <span className="text-[14px] leading-[17px] font-normal text-[#787878]">휴무</span>
            <ChevronIcon />
          </button>
        )}
      </div>
    )
  }

  // 정기 휴무일은 stores.regular_holidays(주기 + 요일)가 원본. 미설정 매장은 영업시간에서
  // 꺼둔 요일을 매주 휴무로 간주해 보여준다(기존 데이터 호환).
  const regularCycleLabel = regularHolidays?.cycle === 'biweekly' ? '격주' : '매주'
  const regularOffDays = regularHolidays
    ? DAY_ORDER.filter(d => regularHolidays.days.includes(d))
    : DAY_ORDER.filter(d => !(operatingHours[d]?.enabled ?? false))
  const sortedVacationDays = [...vacationDays].sort((a, b) => a.date.localeCompare(b.date))

  // 켜진 브레이크만 칩으로. 꺼진 요일은 시간 값이 남아 있어도 보여주지 않는다 —
  // 다시 켤 때 그 값을 그대로 쓰기 위해 지우지 않고 enabled 만 내린다.
  const breakChips = DAY_ORDER
    .filter(d => breakTime[d]?.enabled)
    .map(d => ({ day: d, start: breakTime[d].start, end: breakTime[d].end }))

  return (
    <div>
      {/* Figma: 36/600 #1E1E1E, 아래 라벨까지 120→77 */}
      <div className="text-[18px] font-semibold leading-[22px] text-[#1E1E1E] mb-[40px]">매장 설정</div>

      {/* 상단 2×2 — Figma는 매장명/업종 유형을 top 313, 주소/선결제 고객유형을 top 573에
          "행 정렬"해 뒀다. grid를 쓰면 좌우 높이가 달라도 2행 시작선이 자동으로 맞는다.
          열 간격 102→66. 행 간격은 섹션 간격(56px)과 동일하게 맞춤 */}
      <div className="grid grid-cols-2 gap-x-[60px] gap-y-[56px] mb-[56px]">
        {/* 매장명 */}
        <div>
          <FieldLabel>매장명</FieldLabel>
          {/* Figma 664:541에 매장명 옆 버튼이 없어 제거했다. 매장명 변경은 프로필 모달에서 한다. */}
          <div className="text-[17px] font-medium leading-[21px] text-[#1E1E1E] truncate">{storeName || '매장명 미설정'}</div>
        </div>

        {/* 업종 유형 */}
        <div>
          <FieldLabel>업종유형</FieldLabel>
          {!loaded ? (
            <div className="text-[14px] leading-[17px] font-normal text-[#787878]">불러오는 중…</div>
          ) : (
            <div className="flex flex-col gap-[10px]">
              <div className="flex flex-wrap gap-[10px]">
                {BUSINESS_TYPES_ROW1.map(t => (
                  <Chip key={t} active={businessTypes.includes(t)} onClick={() => saveBusinessTypes(businessTypes.includes(t) ? businessTypes.filter(x => x !== t) : [...businessTypes, t])}>
                    {t}
                  </Chip>
                ))}
              </div>
              <div className="flex flex-wrap gap-[10px]">
                {BUSINESS_TYPES_ROW2.map(t => (
                  <Chip key={t} active={businessTypes.includes(t)} onClick={() => saveBusinessTypes(businessTypes.includes(t) ? businessTypes.filter(x => x !== t) : [...businessTypes, t])}>
                    {t}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 주소 — Figma Rectangle 49/50: h 79→51, radius 15→10,
            내부 좌패딩 40→26, 본문 32→21, 두 박스 간격 20→13 */}
        <div>
          <FieldLabel>주소</FieldLabel>
          {!editingLocation ? (
            delivery.roadAddress ? (
              <div className="flex flex-col gap-[11px]">
                <div className="h-[42px] border border-[#D9D9D9] rounded-[9px] pl-[21px] pr-[8px] flex items-center justify-between gap-[12px]">
                  <span className="text-[15px] leading-[18px] font-normal text-[#1E1E1E] truncate">{delivery.roadAddress}</span>
                  <button onClick={() => setEditingLocation(true)} className="h-[32px] px-[11px] rounded-[9px] bg-[#F2F2F2] text-[#1E1E1E] text-[14px] leading-[17px] font-normal hover:bg-[#E8E4E2] transition-colors flex-shrink-0">
                    변경
                  </button>
                </div>
                {delivery.addressDetail && (
                  <div className="h-[42px] border border-[#D9D9D9] rounded-[9px] px-[21px] flex items-center">
                    <span className="text-[15px] leading-[18px] font-normal text-[#1E1E1E] truncate">{delivery.addressDetail}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-[42px] bg-[#F2F2F2] rounded-[9px] pl-[21px] pr-[8px] flex items-center justify-between gap-[12px]">
                <span className="text-[14px] leading-[17px] font-normal text-[#787878]">매장 주소가 아직 등록되지 않았어요</span>
                <button onClick={() => setEditingLocation(true)} className="h-[32px] px-[11px] rounded-[9px] bg-[#6A635E] text-[#FCFCFC] text-[14px] leading-[17px] font-medium hover:opacity-90 transition-opacity flex-shrink-0">
                  등록
                </button>
              </div>
            )
          ) : (
            <div className="flex flex-col gap-[11px]">
              <div className="flex gap-[9px]">
                <input
                  type="text" value={delivery.draftAddress} readOnly placeholder="주소 검색을 눌러주세요"
                  className="flex-1 min-w-0 h-[42px] border border-[#D9D9D9] rounded-[9px] px-[21px] text-[14px] text-[#1E1E1E] bg-[#F9F9F9]"
                />
                <button onClick={delivery.openAddressSearch} className="h-[42px] px-[14px] bg-[#F2F2F2] text-[#1E1E1E] rounded-[9px] text-[13px] font-medium hover:bg-[#E8E4E2] transition-colors flex-shrink-0">
                  주소 검색
                </button>
              </div>
              <input
                type="text" value={delivery.draftDetail} onChange={e => delivery.setDraftDetail(e.target.value)}
                placeholder="상세 주소 (선택)"
                className="w-full h-[42px] border border-[#D9D9D9] rounded-[9px] px-[21px] text-[14px] text-[#1E1E1E] outline-none focus:border-[#6A635E]"
              />
              <div className="flex justify-end gap-[9px]">
                {delivery.roadAddress && (
                  <button onClick={() => setEditingLocation(false)} className="h-[32px] px-[14px] bg-[#F2F2F2] text-[#787878] rounded-[9px] text-[13px] font-medium hover:bg-[#E8E4E2] transition-colors">
                    취소
                  </button>
                )}
                <button
                  onClick={handleSaveLocation}
                  disabled={delivery.savingLocation || !delivery.draftAddress.trim()}
                  className="h-[32px] px-[16px] bg-[#6A635E] text-[#FCFCFC] rounded-[9px] text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-colors"
                >
                  {delivery.savingLocation ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          )}
          {delivery.addressModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => delivery.setAddressModalOpen(false)}>
              <div className="bg-white rounded-2xl shadow-xl w-[420px] h-[520px] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-border flex-shrink-0">
                  <span className="text-[15px] font-bold text-ink">주소 검색</span>
                  <button onClick={() => delivery.setAddressModalOpen(false)} className="text-gray-text hover:text-ink">✕</button>
                </div>
                <DaumPostcodeEmbed onComplete={delivery.completeAddressSearch} />
              </div>
            </div>
          )}
        </div>

        {/* 선결제 고객유형 */}
        <div>
          <FieldLabel>선결제 고객유형</FieldLabel>
          <div className="flex flex-wrap gap-[10px]">
            {CUSTOMER_TYPES.map(t => (
              <Chip key={t.value} active={customerTypes.includes(t.value)} onClick={() => saveCustomerTypes(customerTypes.includes(t.value) ? customerTypes.filter(x => x !== t.value) : [...customerTypes, t.value])}>
                {t.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      {/* 영업시간 — Figma: 월~수(좌) / 목~일(우) 2열. 각 행은 요일 + 오픈박스 + ~ + 마감박스.
           행 간격 74→48, 열 간격 167→108, 요일↔박스 40→26.
           클릭 시 기존 "시간 설정" 모달 재사용 */}
      <div className="mb-[32px]">
        <FieldLabel>영업시간</FieldLabel>
        <div className="grid grid-cols-2 gap-x-[96px] items-start">
          <div className="flex flex-col gap-[42px]">
            {DAY_COL1.map(day => <DayRow key={day} day={day} />)}
          </div>
          <div className="flex flex-col gap-[42px]">
            {DAY_COL2.map(day => <DayRow key={day} day={day} />)}
          </div>
        </div>
      </div>

      {/* 브레이크 타임 — 휴무일보다 위.
           휴무일은 한 달에 몇 번 손대는 설정이고 브레이크는 매일 걸리는 규칙이라,
           자주 확인할 쪽이 먼저 보여야 한다.
           저장만 하면 끝 — 가게 문은 DB cron 이 break_time 을 읽어 자동으로 여닫는다. */}
      <div>
        <FieldLabel>브레이크 타임</FieldLabel>
        <div className="relative inline-block">
          <SectionPill label="브레이크 타임 설정" onClick={() => setBreakOpen(true)} />
        </div>
        {breakOpen && (
          <BreakTimeModal
            initial={breakTime}
            onConfirm={next => { onSaveBreakTime(next); setBreakOpen(false) }}
            onClose={() => setBreakOpen(false)}
          />
        )}
        {/* mb-[52px] — 아래 '휴무일' 라벨과 충분히 떨어뜨린다.
            칩 한 줄과 다음 섹션 제목이 붙어 있으면 칩이 휴무일 것처럼 읽힌다. */}
        <div className="mt-[17px] mb-[52px]">
          <div className="flex flex-wrap gap-[11px]">
            {breakChips.length === 0 ? (
              <span className="text-[14px] font-normal text-[#ADADAD]">설정된 브레이크 타임이 없어요</span>
            ) : breakChips.map(({ day, start, end }) => (
              <DateChip
                key={day}
                label={`${DAY_LABELS[day]} ${start}~${end}`}
                onRemove={() => onSaveBreakTime({
                  ...breakTime,
                  [day]: { ...breakTime[day], enabled: false },
                })}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 휴무일 — Figma: 임시 휴무일(좌) / 정기 휴무일(우). 각각 pill 아래에 날짜 칩 목록.
           임시 휴무일은 store_vacation_days(휴가 예약 모달)와 연결, 정기 휴무일은
           영업시간에서 꺼둔 요일을 그대로 보여준다. pill↔칩 29→19 */}
      <div>
        <FieldLabel>휴무일</FieldLabel>
        <div className="grid grid-cols-2 gap-x-[96px] items-start">
          <div>
            {/* 캘린더는 버튼 바로 위에 뜨는 팝오버 — 모달이 아니라 배경을 어둡게 덮지 않는다 */}
            <div className="relative inline-block">
              <SectionPill label="임시 휴무일" onClick={() => setCalendarOpen(v => !v)} />
              {calendarOpen && (
                <MiniCalendar
                  markedDates={sortedVacationDays.map(v => v.date)}
                  onConfirm={onAddVacationDays}
                  onClose={() => setCalendarOpen(false)}
                />
              )}
            </div>
            <div className="mt-[17px]">
              <div className="flex flex-wrap gap-[11px]">
                {sortedVacationDays.map(v => (
                  <DateChip
                    key={v.date}
                    label={formatVacationDate(v.date)}
                    onRemove={() => onDeleteVacationDay(v.date)}
                  />
                ))}
              </div>
            </div>
          </div>
          <div>
            <SectionPill label="정기 휴무일" onClick={() => setRegularOpen(true)} />
            {regularOpen && (
              <RegularHolidayModal
                initial={regularHolidays ?? { cycle: 'weekly', days: regularOffDays }}
                onConfirm={onSaveRegularHolidays}
                onClose={() => setRegularOpen(false)}
              />
            )}
            <div className="mt-[17px]">
              {/* X로 바로 해제 — 임시 휴무일 칩과 같은 조작감.
                  모달을 열어 요일을 끄는 방법도 그대로 남아 있다.
                  regularHolidays 가 아직 null(영업시간에서 유추한 상태)이면
                  이 조작이 곧 첫 저장이 되므로 cycle 은 기본값 weekly 로 확정한다. */}
              <div className="flex flex-wrap gap-[11px]">
                {regularOffDays.map(d => (
                  <DateChip
                    key={d}
                    label={`${regularCycleLabel} ${DAY_LABELS[d]}요일`}
                    onRemove={() => onSaveRegularHolidays({
                      cycle: regularHolidays?.cycle ?? 'weekly',
                      days:  regularOffDays.filter(x => x !== d),
                    })}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 대표자 정보 — Figma node 578:878 ──────────────────────────────────────
// 좌: 대표자명 / 대표자 전화번호(+변경) / 계정 비밀번호(+변경) / 요금제(+변경)
// 우: 보유 매장 목록 (현재 매장에 체크)
// 하단 우측: 로그아웃
function RepresentativePanel({
  storeId, clientId, plan, showToast, onSignOut,
}: {
  storeId: string
  clientId: string
  plan: PlanTier
  showToast: (msg: string) => void
  onSignOut: () => void
}) {
  const [ownerName, setOwnerName] = useState('')
  const [phone,     setPhone]     = useState('')
  const [stores,    setStores]    = useState<{ id: string; name: string }[]>([])
  const [loaded,    setLoaded]    = useState(false)
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false)
  const [pwModalOpen,        setPwModalOpen]        = useState(false)
  // 요금제 변경 — Sales.tsx 의 요금제 비교 모달을 그대로 쓴다(팀 수 슬라이더 + 추천)
  const [planModalOpen,      setPlanModalOpen]      = useState(false)

  // 대표자명은 clients.owner_name, 전화번호는 auth.users.phone 이 진실이다.
  // 예전엔 stores.representative_name 을 읽었는데, 매장이 여러 개면 매장마다 다른 이름이
  // 들어가 "어느 쪽이 대표자인가"가 애매해졌다. 대표자는 사업자(client)당 한 명이라
  // clients 로 단일화하고(consolidate_owner_name_to_clients) 옛 컬럼은 더 읽지 않는다.
  useEffect(() => {
    async function load() {
      const [{ data: storeRows }, { data: clientRow }, { data: auth }] = await Promise.all([
        supabase.from('stores').select('id, name').eq('client_id', clientId).order('created_at'),
        supabase.from('clients').select('owner_name').eq('id', clientId).maybeSingle(),
        supabase.auth.getUser(),
      ])
      setStores((storeRows ?? []) as { id: string; name: string }[])
      setOwnerName(clientRow?.owner_name ?? '')
      setPhone(fromE164(auth.user?.phone))
      setLoaded(true)
    }
    if (clientId) load()
  }, [clientId])

  const planPeriod = '' // 구독 기간은 아직 저장하는 곳이 없어 비워둔다 (Figma엔 2026.9.2 ~ 2026.10.2)

  return (
    <div>
      <div className="text-[18px] font-semibold leading-[22px] text-[#1E1E1E] mb-[68px]">대표자 정보</div>

      <div className="grid grid-cols-2 gap-x-[60px] gap-y-[56px]">
        {/* ── 좌: 대표자명 ── */}
        <div>
          <FieldLabel>대표자명</FieldLabel>
          <div className="text-[17px] font-medium leading-[21px] text-[#1E1E1E]">
            {loaded ? (ownerName || '미등록') : '\u2014'}
          </div>
        </div>

        {/* ── 우: 보유 매장 (2행에 걸쳐 표시) ── */}
        <div className="row-span-4">
          <FieldLabel>보유 매장</FieldLabel>
          <div className="flex flex-col gap-[9px]">
            {!loaded ? (
              <div className="text-[14px] font-normal text-[#787878]">불러오는 중…</div>
            ) : stores.length === 0 ? (
              <div className="text-[14px] font-normal text-[#ADADAD]">등록된 매장이 없어요</div>
            ) : stores.map(s => {
              const current = s.id === storeId
              return (
                <div
                  key={s.id}
                  className={`h-[58px] rounded-[9px] px-[21px] flex items-center justify-between ${
                    current ? 'bg-[#E8E4E2]' : 'border border-[#ADADAD]'
                  }`}
                >
                  <span className="text-[16px] font-normal text-[#1E1E1E] truncate">{s.name}</span>
                  {/* 체크는 "지금 로그인된 매장" 표시 — 선택 UI가 아니라 상태 표시다 */}
                  <span
                    className={`w-[19px] h-[19px] rounded-[5px] flex-shrink-0 flex items-center justify-center ${
                      current ? 'bg-[#BDB4A7]' : 'border border-[#BDB4A7]'
                    }`}
                    title={current ? '지금 사용 중인 매장' : undefined}
                  >
                    {current && (
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6.2L4.8 8.5L9.5 3.8" stroke="#FCFCFC" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── 좌: 대표자 전화번호 ── */}
        <div>
          <FieldLabel>대표자 전화번호</FieldLabel>
          <div className="flex items-center gap-[12px]">
            <span className="text-[17px] font-medium leading-[21px] text-[#1E1E1E]">
              {loaded ? (phone || '미등록') : '\u2014'}
            </span>
            <button
              onClick={() => showToast('전화번호 변경은 준비 중이에요')}
              className="h-[32px] px-[11px] rounded-[9px] bg-[#F2F2F2] text-[#1E1E1E] text-[14px] leading-[17px] font-normal hover:bg-[#E8E4E2] transition-colors flex-shrink-0"
            >
              변경
            </button>
          </div>
        </div>

        {/* ── 좌: 계정 비밀번호 — 실제 값은 절대 내려받지 않고 마스킹만 ── */}
        <div>
          <FieldLabel>계정 비밀번호</FieldLabel>
          <div className="flex items-center gap-[12px]">
            <span className="text-[17px] font-medium leading-[21px] text-[#1E1E1E] tracking-[2px]">••••••••</span>
            <button
              onClick={() => {
                if (!phone) { showToast('등록된 전화번호가 없어 인증을 보낼 수 없어요'); return }
                setPwModalOpen(true)
              }}
              className="h-[32px] px-[11px] rounded-[9px] bg-[#F2F2F2] text-[#1E1E1E] text-[14px] leading-[17px] font-normal hover:bg-[#E8E4E2] transition-colors flex-shrink-0"
            >
              변경
            </button>
          </div>
        </div>

        {/* ── 좌: 요금제 ── */}
        <div>
          <div className="flex items-baseline gap-[10px] mb-[25px]">
            <span className="text-[15px] font-medium leading-[18px] text-[#414141]">요금제</span>
            {planPeriod && <span className="text-[12px] font-normal text-[#ADADAD]">{planPeriod}</span>}
          </div>
          <div className="flex items-center gap-[12px]">
            <span className="text-[17px] font-medium leading-[21px] text-[#1E1E1E]">{PLAN_NAMES[plan]}</span>
            <button
              onClick={() => setPlanModalOpen(true)}
              className="h-[32px] px-[11px] rounded-[9px] bg-[#F2F2F2] text-[#1E1E1E] text-[14px] leading-[17px] font-normal hover:bg-[#E8E4E2] transition-colors flex-shrink-0"
            >
              변경
            </button>
          </div>
        </div>
      </div>

      {/* ── 로그아웃 — Figma: 우측 하단, bg #FFEFEF / text #FF676F ── */}
      <div className="flex justify-end mt-[68px]">
        <button
          onClick={() => setSignOutConfirmOpen(true)}
          className="h-[50px] px-[26px] rounded-[13px] bg-[#FFEFEF] text-[#FF676F] text-[16px] font-medium hover:brightness-95 transition-all"
        >
          로그아웃
        </button>
      </div>

      {pwModalOpen && (
        <PasswordChangeModal
          phone={phone}
          onClose={() => setPwModalOpen(false)}
          onDone={showToast}
        />
      )}

      <UpgradeModal open={planModalOpen} onClose={() => setPlanModalOpen(false)} />

      {signOutConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSignOutConfirmOpen(false)}>
          {/* 다른 모달과 같은 시스템 — #FCFCFC · rounded-14 · 하단 구분선 + 우측 CTA */}
          <div
            className="modal-in bg-[#FCFCFC] rounded-[14px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] w-[420px] max-w-[92vw] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-[28px] pt-[28px] pb-[22px]">
              <div className="text-[18px] font-semibold text-[#1E1E1E] mb-[6px]">로그아웃 하시겠어요?</div>
              <div className="text-[13px] font-normal text-[#787878] leading-relaxed">
                다시 사용하려면 비밀번호로 로그인해야 해요.
              </div>
            </div>
            <div className="border-t border-[#E8E4E2] px-[28px] py-[16px] flex justify-end gap-[10px]">
              <button
                onClick={() => setSignOutConfirmOpen(false)}
                className="h-[50px] px-[26px] rounded-[13px] bg-[#E8E4E2] text-[#6A635E] text-[16px] font-medium hover:brightness-95 transition-all"
              >
                취소
              </button>
              <button
                onClick={onSignOut}
                className="h-[50px] px-[26px] rounded-[13px] bg-[#FFEFEF] text-[#FF676F] text-[16px] font-medium hover:brightness-95 transition-all"
              >
                로그아웃
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
