import { useEffect, useRef, useState } from 'react'

// 임시 휴무일 지정용 작은 캘린더 팝오버.
// 모달이 아니라 버튼 바로 위에 뜨는 팝오버라 어두운 배경 오버레이를 깔지 않는다.
// 하루만 고르거나(한 번 클릭) 기간으로 고를 수 있다(두 번째 클릭이 끝 날짜).
// 색은 선포스 토큰 — 브랜드 #6A635E / 보조 #F2F2F2 / 비활성 #ADADAD

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** start~end(포함) 사이 모든 날짜를 ISO 문자열 배열로 */
function expandRange(start: string, end: string): string[] {
  const [a, b] = start <= end ? [start, end] : [end, start]
  const out: string[] = []
  const cur = new Date(`${a}T00:00:00`)
  const last = new Date(`${b}T00:00:00`)
  while (cur <= last) {
    out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`)
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

interface MiniCalendarProps {
  /** 이미 지정된 날짜 — 점으로 표시해 중복 선택을 막지는 않되 알려준다 */
  markedDates?: string[]
  onConfirm: (dates: string[]) => void
  onClose: () => void
}

export default function MiniCalendar({ markedDates = [], onConfirm, onClose }: MiniCalendarProps) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [start, setStart] = useState<string | null>(null)
  const [end, setEnd] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  function pick(iso: string) {
    // 1클릭 = 시작, 2클릭 = 끝(기간). 이미 기간이면 새로 시작.
    if (!start || (start && end)) { setStart(iso); setEnd(null); return }
    if (iso === start) { setEnd(iso); return }
    setEnd(iso)
  }

  function shiftMonth(delta: number) {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }

  const selected = start ? (end ? expandRange(start, end) : [start]) : []
  const selectedSet = new Set(selected)
  const markedSet = new Set(markedDates)

  // 달력 그리드 — 그 달 1일이 걸린 주의 일요일부터 6주(42칸)
  const first = new Date(year, month, 1)
  const gridStart = new Date(year, month, 1 - first.getDay())
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    return {
      iso:        toISO(d.getFullYear(), d.getMonth(), d.getDate()),
      day:        d.getDate(),
      inMonth:    d.getMonth() === month && d.getFullYear() === year,
      isSunday:   d.getDay() === 0,
    }
  })

  return (
    <div
      ref={wrapRef}
      className="absolute bottom-[42px] left-0 z-40 w-[268px] bg-[#FCFCFC] border border-[#E8E4E2] rounded-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.14)] p-[14px]"
    >
      <div className="flex items-center justify-between mb-[12px]">
        <span className="text-[14px] font-bold text-[#2C261F]">날짜 또는 기간으로 선택</span>
        <button type="button" onClick={onClose} aria-label="닫기" className="text-[#787878] hover:text-[#2C261F] transition-colors">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div className="flex items-center justify-between mb-[10px]">
        <span className="text-[15px] font-semibold text-[#1E1E1E]">{year}년 {month + 1}월</span>
        <div className="flex items-center gap-[4px]">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="이전 달" className="w-[24px] h-[24px] rounded-[6px] flex items-center justify-center hover:bg-[#F2F2F2] transition-colors">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M10 3.5L5.5 8L10 12.5" stroke="#6A635E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="다음 달" className="w-[24px] h-[24px] rounded-[6px] flex items-center justify-center hover:bg-[#F2F2F2] transition-colors">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6 3.5L10.5 8L6 12.5" stroke="#6A635E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 mb-[4px]">
        {DOW.map((d, i) => (
          <span key={i} className={`h-[22px] flex items-center justify-center text-[11px] font-semibold ${i === 0 ? 'text-[#C92A2A]' : 'text-[#787878]'}`}>
            {d}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-[2px]">
        {cells.map(c => {
          const isSelected = selectedSet.has(c.iso)
          const isMarked   = markedSet.has(c.iso) && !isSelected
          return (
            <button
              key={c.iso}
              type="button"
              onClick={() => pick(c.iso)}
              className={`relative h-[30px] rounded-[7px] text-[13px] font-medium transition-colors ${
                isSelected
                  ? 'bg-[#6A635E] text-[#FCFCFC] font-bold'
                  : c.inMonth
                    ? `${c.isSunday ? 'text-[#C92A2A]' : 'text-[#1E1E1E]'} hover:bg-[#F2F2F2]`
                    : 'text-[#D7D7D7]'
              }`}
            >
              {c.day}
              {isMarked && <span className="absolute bottom-[3px] left-1/2 -translate-x-1/2 w-[3px] h-[3px] rounded-full bg-[#6A635E]" />}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between mt-[12px] pt-[10px] border-t border-[#F2F2F2]">
        <span className="text-[11px] text-[#787878]">
          {selected.length === 0 ? '날짜를 눌러주세요' : selected.length === 1 ? '하루 선택됨' : `${selected.length}일 선택됨`}
        </span>
        <button
          type="button"
          onClick={() => { if (selected.length) { onConfirm(selected); onClose() } }}
          disabled={selected.length === 0}
          className="h-[30px] px-[16px] rounded-[8px] bg-[#6A635E] text-[#FCFCFC] text-[13px] font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
        >
          확인
        </button>
      </div>
    </div>
  )
}
