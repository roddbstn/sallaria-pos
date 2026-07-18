import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'

type DayHours = { enabled: boolean; open: string; close: string }
type OperatingHours = Record<string, DayHours>

function defaultOperatingHours(): OperatingHours {
  const days: OperatingHours = {}
  const week = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  week.forEach(d => {
    days[d] = { enabled: d !== 'sun', open: '09:00', close: '21:00' }
  })
  days['sun'] = { enabled: false, open: '10:00', close: '18:00' }
  return days
}

function loadOperatingHours(): OperatingHours {
  try {
    const s = localStorage.getItem('pos_operating_hours')
    return s ? JSON.parse(s) : defaultOperatingHours()
  } catch {
    return defaultOperatingHours()
  }
}

function loadClosureActive(): boolean {
  try {
    const ov = JSON.parse(localStorage.getItem('pos_today_override') || 'null')
    return ov?.date === new Date().toISOString().slice(0, 10)
  } catch {
    return false
  }
}

export function useOperatingHours(
  storeId: string | undefined,
  showToast: (msg: string) => void,
) {
  const [isOpen,          setIsOpen]          = useState(false)
  const manualOverrideRef                     = useRef<{ value: boolean; until: number } | null>(null)

  const [hoursOpen,       setHoursOpen]       = useState(false)
  const [operatingHours,  setOperatingHours]  = useState<OperatingHours>(loadOperatingHours)
  const [hoursDraft,      setHoursDraft]      = useState<OperatingHours>({})

  const [offHoursConfirm, setOffHoursConfirm] = useState(false)
  const [closureOpen,     setClosureOpen]     = useState(false)
  const [closureType,     setClosureType]     = useState<'holiday' | 'early'>('holiday')
  const [closureTime,     setClosureTime]     = useState('18:00')
  const [closureActive,   setClosureActive]   = useState(loadClosureActive)

  // 운영시간 기준 자동 ON/OFF (정각에 맞춰 체크)
  useEffect(() => {
    function syncIsOpen() {
      const now = new Date()
      const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()]
      const day = operatingHours[dayKey]

      let shouldBeOpen = false
      if (day?.enabled) {
        const cur = now.getHours() * 60 + now.getMinutes()
        const [oh, om] = day.open.split(':').map(Number)
        const [ch, cm] = day.close.split(':').map(Number)
        shouldBeOpen = cur >= oh * 60 + om && cur < ch * 60 + cm
      }

      // 마감 예약 오버라이드 체크 (holiday / early)
      try {
        const ov = JSON.parse(localStorage.getItem('pos_today_override') || 'null')
        const todayStr = now.toISOString().slice(0, 10)
        if (ov?.date === todayStr) {
          if (ov.type === 'holiday') {
            shouldBeOpen = false
          } else if (ov.type === 'early' && ov.time) {
            const cur2 = now.getHours() * 60 + now.getMinutes()
            const [eh, em] = (ov.time as string).split(':').map(Number)
            if (cur2 >= eh * 60 + em) shouldBeOpen = false
          }
        }
      } catch {}

      // 수동 토글 직후 2분간은 syncIsOpen이 덮어쓰지 않음
      const mo = manualOverrideRef.current
      if (mo && Date.now() < mo.until) return
      if (mo) manualOverrideRef.current = null

      setIsOpen(prev => {
        if (prev !== shouldBeOpen && storeId) {
          supabase.from('stores').update({ is_open: shouldBeOpen }).eq('id', storeId)
        }
        return shouldBeOpen
      })
    }

    // 즉시 1회 실행 후, 다음 정각 :00초에 맞춰 인터벌 시작
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
  }, [operatingHours, storeId])

  function isCurrentlyInOperatingHours() {
    const now = new Date()
    const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()]
    const day = operatingHours[dayKey]
    if (!day?.enabled) return false
    const cur = now.getHours() * 60 + now.getMinutes()
    const [oh, om] = day.open.split(':').map(Number)
    const [ch, cm] = day.close.split(':').map(Number)
    return cur >= oh * 60 + om && cur < ch * 60 + cm
  }

  async function pushIsOpen(next: boolean) {
    setIsOpen(next)
    manualOverrideRef.current = { value: next, until: Date.now() + 2 * 60_000 }
    if (!storeId) {
      showToast('스토어 세션 없음 — 재로그인 필요')
      return
    }
    const { error } = await supabase.from('stores').update({ is_open: next }).eq('id', storeId)
    if (error) {
      showToast(`운영 상태 저장 실패: ${error.message}`)
      setIsOpen(!next)
      manualOverrideRef.current = null
    }
  }

  function toggleIsOpen() {
    if (!isOpen && !isCurrentlyInOperatingHours()) {
      setOffHoursConfirm(true)
      return
    }
    pushIsOpen(!isOpen)
  }

  function confirmForceOpen() {
    pushIsOpen(true)
    setOffHoursConfirm(false)
  }

  function saveOperatingHours() {
    setOperatingHours(hoursDraft)
    localStorage.setItem('pos_operating_hours', JSON.stringify(hoursDraft))
    setHoursOpen(false)
  }

  function confirmClosure() {
    const today = new Date().toISOString().slice(0, 10)
    localStorage.setItem('pos_today_override', JSON.stringify({
      date: today,
      type: closureType,
      time: closureType === 'early' ? closureTime : undefined,
    }))
    setClosureActive(true)
    setClosureOpen(false)
  }

  function cancelClosure() {
    localStorage.removeItem('pos_today_override')
    setClosureActive(false)
  }

  return {
    // 상태
    isOpen,        setIsOpen,
    hoursOpen,     setHoursOpen,
    operatingHours,
    hoursDraft,    setHoursDraft,
    offHoursConfirm, setOffHoursConfirm,
    closureOpen,   setClosureOpen,
    closureType,   setClosureType,
    closureTime,   setClosureTime,
    closureActive,
    manualOverrideRef,
    // 액션
    pushIsOpen,
    toggleIsOpen,
    confirmForceOpen,
    saveOperatingHours,
    confirmClosure,
    cancelClosure,
  }
}
