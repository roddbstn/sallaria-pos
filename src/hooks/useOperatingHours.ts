import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

type DayHours = { enabled: boolean; open: string; close: string }
type OperatingHours = Record<string, DayHours>

export type DayBreak = { enabled: boolean; start: string; end: string }
export type BreakTime = Record<string, DayBreak>

/** 정기 휴무일 — stores.regular_holidays */
export type RegularHolidaysValue = { cycle: 'weekly' | 'biweekly'; days: string[] }

/** 토스트 문구용 — 저장 결과를 사람 말로 되돌려준다 */
const DAY_KO: Record<string, string> = {
  mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일',
}

export type VacationDay = {
  id?: string
  date: string        // 'YYYY-MM-DD'
  type: 'holiday' | 'custom'
  openTime?: string   // custom일 때만
  closeTime?: string  // custom일 때만
}

function defaultOperatingHours(): OperatingHours {
  const week = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  const hours: OperatingHours = {}
  week.forEach(d => {
    hours[d] = { enabled: d !== 'sun', open: '09:00', close: '21:00' }
  })
  hours['sun'] = { enabled: false, open: '10:00', close: '18:00' }
  return hours
}

function defaultBreakTime(): BreakTime {
  const week = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  const bt: BreakTime = {}
  week.forEach(d => { bt[d] = { enabled: false, start: '14:00', end: '17:00' } })
  return bt
}

// today_override.type 종류:
//   'holiday'    → 오늘 전일 휴무
//   'early'      → 운영시간 중 수동 종료 (time 이후 닫힘)
//   'force_open' → 운영시간 외 강제 열기

export function useOperatingHours(
  storeId: string | undefined,
  showToast: (msg: string) => void,
) {
  const [isOpen,          setIsOpen]          = useState(false)
  const [autoOpenEnabled, setAutoOpenEnabled] = useState(true)
  const [hoursOpen,       setHoursOpen]       = useState(false)
  const [operatingHours,  setOperatingHours]  = useState<OperatingHours>(defaultOperatingHours)
  const [breakTime,       setBreakTime]       = useState<BreakTime>(defaultBreakTime)
  const [hoursDraft,      setHoursDraft]      = useState<OperatingHours>({})
  const [breakDraft,      setBreakDraft]      = useState<BreakTime>({})
  const [offHoursConfirm, setOffHoursConfirm] = useState(false)
  const [closureOpen,     setClosureOpen]     = useState(false)
  const [closureType,     setClosureType]     = useState<'holiday' | 'early'>('early')
  const [closureTime,     setClosureTime]     = useState('18:00')
  const [closureActive,   setClosureActive]   = useState(false)
  const [overrideType,    setOverrideType]    = useState<'holiday' | 'early' | 'force_open' | null>(null)

  // 휴가 예약
  const [vacationDays,    setVacationDays]    = useState<VacationDay[]>([])
  const [vacationOpen,    setVacationOpen]    = useState(false)
  const [regularHolidays, setRegularHolidays] = useState<RegularHolidaysValue | null>(null)

  // ── DB에서 로드 ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!storeId) return
    supabase
      .from('stores')
      .select('operating_hours, break_time, today_override, auto_open_enabled, regular_holidays')
      .eq('id', storeId)
      .single()
      .then(({ data }) => {
        if (!data) return
        setAutoOpenEnabled(data.auto_open_enabled ?? true)
        if (data.operating_hours) setOperatingHours(data.operating_hours as OperatingHours)
        if (data.break_time)      setBreakTime(data.break_time as BreakTime)
        setRegularHolidays((data.regular_holidays as RegularHolidaysValue | null) ?? null)

        const ov = data.today_override as { date: string; type: string; time?: string } | null
        const today = new Date().toISOString().slice(0, 10)
        if (ov?.date === today) {
          const t = ov.type as 'holiday' | 'early' | 'force_open'
          setOverrideType(t)
          setClosureActive(t !== 'force_open')
          if (t === 'holiday' || t === 'early') setClosureType(t as 'holiday' | 'early')
          if (ov.time) setClosureTime(ov.time)
        } else if (ov) {
          // today_override는 타입 무관하게 당일만 유효 (force_open도 예외 아님) — 날짜 지나면 삭제
          supabase.from('stores').update({ today_override: null }).eq('id', storeId)
        }
      })

    // 휴가 예약 로드
    supabase
      .from('store_vacation_days')
      .select('id, date, type, open_time, close_time')
      .eq('store_id', storeId)
      .gte('date', new Date().toISOString().slice(0, 10))
      .order('date')
      .then(({ data }) => {
        if (!data) return
        setVacationDays(data.map((r: any): VacationDay => ({
          id:        r.id,
          date:      r.date,
          type:      r.type,
          openTime:  r.open_time  ?? undefined,
          closeTime: r.close_time ?? undefined,
        })))
      })
  }, [storeId])

  // is_open의 진실 공급원은 서버 pg_cron(auto_close_stores_by_schedule, 매분 실행)이다.
  // 이 훅은 더 이상 클라이언트에서 별도로 스케줄을 계산해 is_open을 쓰지 않는다 —
  // 예전엔 클라이언트도 동일 로직을 중복 계산해 매분 DB에 썼는데, 서버와 판단이
  // 어긋날 때마다(자정 넘은 오버라이드, 휴가 예약 등) 두 프로세스가 서로 값을
  // 계속 덮어써서 홈 화면 토글이 뒤집히는 버그가 있었다.
  // isOpen은 App.tsx에서 초기 로드(store.is_open)와 Realtime 구독으로만 갱신된다.

  // ── 헬퍼: is_open DB 업데이트 ────────────────────────────────────────────────
  async function pushIsOpen(next: boolean) {
    setIsOpen(next)
    if (!storeId) { showToast('스토어 세션 없음 — 재로그인 필요'); return }
    const { error } = await supabase.from('stores').update({ is_open: next }).eq('id', storeId)
    if (error) { showToast(`운영 상태 저장 실패: ${error.message}`); setIsOpen(!next) }
  }

  // ── 헬퍼: today_override DB 업데이트 ─────────────────────────────────────────
  async function applyOverride(type: 'holiday' | 'early' | 'force_open', time?: string) {
    if (!storeId) return
    const today    = new Date().toISOString().slice(0, 10)
    const override = { date: today, type, ...(time ? { time } : {}) }
    const { error } = await supabase.from('stores').update({ today_override: override }).eq('id', storeId)
    if (error) { showToast(`설정 저장 실패: ${error.message}`); return }
    setOverrideType(type)
    setClosureActive(type !== 'force_open')
    if (type === 'holiday' || type === 'early') setClosureType(type)
    if (time) setClosureTime(time)
  }

  async function clearOverride() {
    if (!storeId) return
    const { error } = await supabase.from('stores').update({ today_override: null }).eq('id', storeId)
    if (error) { showToast(`설정 해제 실패: ${error.message}`); return }
    setOverrideType(null)
    setClosureActive(false)
  }

  // ── 공개 함수 ─────────────────────────────────────────────────────────────────

  function isCurrentlyInOperatingHours() {
    const now    = new Date()
    const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()]
    const day    = operatingHours[dayKey]
    if (!day?.enabled) return false
    const cur  = now.getHours() * 60 + now.getMinutes()
    const [oh, om] = day.open.split(':').map(Number)
    const [ch, cm] = day.close.split(':').map(Number)
    return cur >= oh * 60 + om && cur < ch * 60 + cm
  }

  async function toggleIsOpen() {
    if (isOpen) {
      // 종료로 전환
      if (isCurrentlyInOperatingHours()) {
        // 운영시간 중 수동 종료 → 조기마감 오버라이드 (syncIsOpen이 다시 열지 않도록)
        const now  = new Date()
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        await applyOverride('early', time)
      }
      await pushIsOpen(false)
    } else {
      // 운영으로 전환
      if (!isCurrentlyInOperatingHours() && overrideType !== 'force_open') {
        // 운영시간 외 → 강제 열기 확인 모달
        setOffHoursConfirm(true)
        return
      }
      if (overrideType) await clearOverride()
      await pushIsOpen(true)
    }
  }

  async function confirmForceOpen() {
    // 운영시간 외 강제 열기 확정 → force_open 오버라이드
    await applyOverride('force_open')
    await pushIsOpen(true)
    setOffHoursConfirm(false)
  }

  async function toggleAutoOpenEnabled() {
    const next = !autoOpenEnabled
    setAutoOpenEnabled(next)
    if (!storeId) return
    const { error } = await supabase.from('stores').update({ auto_open_enabled: next }).eq('id', storeId)
    if (error) { showToast(`자동 운영 설정 저장 실패: ${error.message}`); setAutoOpenEnabled(!next) }
  }

  async function saveOperatingHours() {
    setOperatingHours(hoursDraft)
    setBreakTime(breakDraft)
    setHoursOpen(false)
    if (!storeId) return
    const { error } = await supabase.from('stores').update({
      operating_hours: hoursDraft,
      break_time:      breakDraft,
    }).eq('id', storeId)
    if (error) showToast(`운영시간 저장 실패: ${error.message}`)
  }

  /**
   * 브레이크 타임 저장 — 매장 설정 화면의 전용 모달에서 바로 반영한다.
   *
   * 영업시간 모달(saveOperatingHours)의 draft 흐름을 타지 않는 이유: 그쪽은 7요일 영업시간과
   * 브레이크를 한꺼번에 들고 다니는 큰 폼이고, 여기선 브레이크만 바꾸러 들어온다.
   * 같은 draft 를 쓰면 브레이크만 고치려다 영업시간까지 덮어쓸 수 있다.
   *
   * 저장만 하면 끝이다 — 가게 문을 여닫는 건 DB cron(auto_close_stores_by_schedule)이
   * 매분 돌면서 break_time 을 읽어 is_open 을 올리고 내린다. 요일별로 다른 값도 거기서 처리된다.
   */
  async function saveBreakTime(next: BreakTime) {
    setBreakTime(next)
    setBreakDraft(next)   // 영업시간 모달을 나중에 열어도 같은 값이 보이도록
    if (!storeId) return
    const { error } = await supabase.from('stores').update({ break_time: next }).eq('id', storeId)
    if (error) showToast(`브레이크 타임 저장 실패: ${error.message}`)
  }

  // 매장 설정 화면에서 요일 하나의 오픈/마감 시각만 바로 바꿔 저장한다.
  // (운영시간 모달의 draft 흐름을 타지 않고 단건 반영 — 드롭다운에서 고르면 즉시 저장)
  async function setDayTime(day: string, field: 'open' | 'close', value: string) {
    const prev = operatingHours[day] ?? { enabled: true, open: '09:00', close: '21:00' }
    const next = { ...operatingHours, [day]: { ...prev, enabled: true, [field]: value } }
    setOperatingHours(next)
    if (!storeId) return
    const { error } = await supabase.from('stores').update({ operating_hours: next }).eq('id', storeId)
    if (error) showToast(`영업시간 저장 실패: ${error.message}`)
  }

  // 정기 휴무일 저장 — 주기+요일을 stores.regular_holidays에 기록한다.
  // '매주'면 해당 요일을 영업시간에서도 꺼서 영업시간 그리드와 어긋나지 않게 맞춘다.
  // '격주'는 매주 쉬는 게 아니라서 영업시간은 건드리지 않는다.
  async function saveRegularHolidays(value: RegularHolidaysValue) {
    setRegularHolidays(value)
    const patch: Record<string, unknown> = { regular_holidays: value }

    let nextHours = operatingHours
    if (value.cycle === 'weekly') {
      nextHours = { ...operatingHours }
      for (const day of Object.keys(nextHours)) {
        nextHours[day] = { ...nextHours[day], enabled: !value.days.includes(day) }
      }
      setOperatingHours(nextHours)
      patch.operating_hours = nextHours
    }

    if (!storeId) return
    const { error } = await supabase.from('stores').update(patch).eq('id', storeId)
    if (error) { showToast(`정기 휴무일 저장 실패: ${error.message}`); return }

    // 임시 휴무일과 같은 조작감 — 저장됐다는 신호가 없으면 눌렀는지 알 수 없다.
    // 요일을 다 지운 건 "해제"라서 문구를 따로 준다.
    if (value.days.length === 0) {
      showToast('정기 휴무일이 해제되었습니다')
    } else {
      // 클릭한 순서가 아니라 주 순서로 — "토·화" 가 아니라 "화·토"
      const label = Object.keys(DAY_KO)
        .filter(d => value.days.includes(d))
        .map(d => DAY_KO[d])
        .join('·')
      const cycle = value.cycle === 'weekly' ? '매주' : '격주'
      showToast(`정기 휴무일이 ${cycle} ${label}요일로 저장되었습니다`)
    }
  }

  // 운영시간 설정 모달에서 "조기마감" 확정
  async function confirmClosure() {
    await applyOverride(closureType, closureType === 'early' ? closureTime : undefined)
    setClosureOpen(false)
  }

  async function cancelClosure() {
    await clearOverride()
  }

  // 휴가 예약 저장
  async function saveVacationDays(days: VacationDay[]) {
    if (!storeId) return
    const today = new Date().toISOString().slice(0, 10)

    // 기존 미래 휴가 모두 삭제 후 재삽입 (간단한 전략)
    await supabase
      .from('store_vacation_days')
      .delete()
      .eq('store_id', storeId)
      .gte('date', today)

    if (days.length > 0) {
      const rows = days.map(d => ({
        store_id:   storeId,
        date:       d.date,
        type:       d.type,
        open_time:  d.openTime  ?? null,
        close_time: d.closeTime ?? null,
      }))
      const { error } = await supabase.from('store_vacation_days').insert(rows)
      if (error) { showToast(`휴가 저장 실패: ${error.message}`); return }
    }

    setVacationDays(days)
    setVacationOpen(false)
    showToast('휴가 예약이 저장되었습니다')
  }

  async function deleteVacationDay(date: string) {
    if (!storeId) return
    await supabase
      .from('store_vacation_days')
      .delete()
      .eq('store_id', storeId)
      .eq('date', date)
    setVacationDays(prev => prev.filter(v => v.date !== date))
  }

  return {
    isOpen,           setIsOpen,
    autoOpenEnabled,
    hoursOpen,        setHoursOpen,
    operatingHours,
    breakTime,
    saveBreakTime,
    hoursDraft,       setHoursDraft,
    breakDraft,       setBreakDraft,
    offHoursConfirm,  setOffHoursConfirm,
    closureOpen,      setClosureOpen,
    closureType,      setClosureType,
    closureTime,      setClosureTime,
    closureActive,
    overrideType,
    vacationDays,
    vacationOpen,     setVacationOpen,
    toggleIsOpen,
    toggleAutoOpenEnabled,
    confirmForceOpen,
    saveOperatingHours,
    setDayTime,
    regularHolidays,
    saveRegularHolidays,
    confirmClosure,
    cancelClosure,
    saveVacationDays,
    deleteVacationDay,
  }
}
