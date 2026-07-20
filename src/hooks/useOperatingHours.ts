import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

type DayHours = { enabled: boolean; open: string; close: string }
type OperatingHours = Record<string, DayHours>

function defaultOperatingHours(): OperatingHours {
  const week = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  const hours: OperatingHours = {}
  week.forEach(d => {
    hours[d] = { enabled: d !== 'sun', open: '09:00', close: '21:00' }
  })
  hours['sun'] = { enabled: false, open: '10:00', close: '18:00' }
  return hours
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
  const [hoursDraft,      setHoursDraft]      = useState<OperatingHours>({})
  const [offHoursConfirm, setOffHoursConfirm] = useState(false)
  const [closureOpen,     setClosureOpen]     = useState(false)
  const [closureType,     setClosureType]     = useState<'holiday' | 'early'>('holiday')
  const [closureTime,     setClosureTime]     = useState('18:00')
  const [closureActive,   setClosureActive]   = useState(false)
  const [overrideType,    setOverrideType]    = useState<'holiday' | 'early' | 'force_open' | null>(null)

  // ── DB에서 로드 ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!storeId) return
    supabase
      .from('stores')
      .select('operating_hours, today_override, auto_open_enabled')
      .eq('id', storeId)
      .single()
      .then(({ data }) => {
        if (!data) return
        setAutoOpenEnabled(data.auto_open_enabled ?? true)
        if (data.operating_hours) setOperatingHours(data.operating_hours as OperatingHours)

        const ov = data.today_override as { date: string; type: string; time?: string } | null
        const today = new Date().toISOString().slice(0, 10)
        if (ov?.date === today) {
          const t = ov.type as 'holiday' | 'early' | 'force_open'
          setOverrideType(t)
          setClosureActive(t !== 'force_open')
          if (t === 'holiday' || t === 'early') setClosureType(t as 'holiday' | 'early')
          if (ov.time) setClosureTime(ov.time)
        } else if (ov) {
          // 날짜 지난 오버라이드 자동 정리
          supabase.from('stores').update({ today_override: null }).eq('id', storeId)
        }
      })
  }, [storeId])

  // ── 1분마다 스케줄 기반 자동 ON/OFF ──────────────────────────────────────────
  useEffect(() => {
    if (!autoOpenEnabled) return

    function syncIsOpen() {
      const now    = new Date()
      const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()]
      const day    = operatingHours[dayKey]

      let shouldBeOpen = false
      if (day?.enabled) {
        const cur  = now.getHours() * 60 + now.getMinutes()
        const [oh, om] = day.open.split(':').map(Number)
        const [ch, cm] = day.close.split(':').map(Number)
        shouldBeOpen = cur >= oh * 60 + om && cur < ch * 60 + cm
      }

      // 오버라이드 적용
      if (overrideType === 'force_open') {
        shouldBeOpen = true                       // 운영시간 외 강제 열기
      } else if (overrideType === 'holiday') {
        shouldBeOpen = false                      // 오늘 전일 휴무
      } else if (overrideType === 'early') {
        const cur  = now.getHours() * 60 + now.getMinutes()
        const [eh, em] = closureTime.split(':').map(Number)
        if (cur >= eh * 60 + em) shouldBeOpen = false   // 조기 마감 시각 이후
      }

      setIsOpen(prev => {
        if (prev !== shouldBeOpen && storeId) {
          supabase.from('stores').update({ is_open: shouldBeOpen }).eq('id', storeId)
        }
        return shouldBeOpen
      })
    }

    syncIsOpen()
    let intervalId: ReturnType<typeof setInterval> | null = null
    const msToNextMinute = 60_000 - (Date.now() % 60_000)
    const timeoutId = setTimeout(() => {
      syncIsOpen()
      intervalId = setInterval(syncIsOpen, 60_000)
    }, msToNextMinute)
    return () => {
      clearTimeout(timeoutId)
      if (intervalId !== null) clearInterval(intervalId)
    }
  }, [autoOpenEnabled, operatingHours, overrideType, closureTime, storeId])

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
    setHoursOpen(false)
    if (!storeId) return
    const { error } = await supabase.from('stores').update({ operating_hours: hoursDraft }).eq('id', storeId)
    if (error) showToast(`운영시간 저장 실패: ${error.message}`)
  }

  // 운영시간 설정 모달에서 "오늘 마감" 확정 (holiday / early)
  async function confirmClosure() {
    await applyOverride(closureType, closureType === 'early' ? closureTime : undefined)
    setClosureOpen(false)
  }

  async function cancelClosure() {
    await clearOverride()
  }

  return {
    isOpen,           setIsOpen,
    autoOpenEnabled,
    hoursOpen,        setHoursOpen,
    operatingHours,
    hoursDraft,       setHoursDraft,
    offHoursConfirm,  setOffHoursConfirm,
    closureOpen,      setClosureOpen,
    closureType,      setClosureType,
    closureTime,      setClosureTime,
    closureActive,
    overrideType,
    toggleIsOpen,
    toggleAutoOpenEnabled,
    confirmForceOpen,
    saveOperatingHours,
    confirmClosure,
    cancelClosure,
  }
}
