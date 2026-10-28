import { useEffect, useRef, useState } from 'react'

// 날짜 하나를 고르는 팝오버 — 누른 버튼 **바로 아래**에 뜬다.
//
// 왜 MiniCalendar 를 안 쓰나:
// MiniCalendar 는 임시 휴무일용이라 (1) 기간 다중선택이고 (2) 버튼 **위로** 열리며
// (3) '확인'을 눌러야 반영된다. 선결제 일시는 하루 하나만 고르면 끝이라
// 확인 단계가 군더더기이고, 모달 상단의 필드라 위로 열면 화면 밖으로 나간다.
// 격자 모양과 색 토큰은 MiniCalendar 와 똑같이 맞춰 뒀다 — 두 캘린더가 다르게
// 생기면 같은 제품처럼 안 읽힌다.
//
// 브라우저 기본 <input type="date"> 를 쓰지 않는 이유: 플랫폼마다 생김새가 다르고
// (Windows 와 macOS 가 완전히 다른 위젯을 띄운다) 우리 색·모서리·글꼴이 하나도 안 먹는다.

const DOW = ['일', '월', '화', '수', '목', '금', '토']

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function DatePopover({ value, max, onPick, onClose }: {
  /** 선택된 날짜 (YYYY-MM-DD) */
  value: string
  /** 이 날짜보다 뒤는 못 고른다 (YYYY-MM-DD). 선결제는 미래 날짜가 있을 수 없다 */
  max?: string
  onPick: (iso: string) => void
  onClose: () => void
}) {
  const base = value ? new Date(`${value}T00:00:00`) : new Date()
  const [year, setYear]   = useState(base.getFullYear())
  const [month, setMonth] = useState(base.getMonth())
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  function shiftMonth(delta: number) {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear()); setMonth(d.getMonth())
  }

  // 그 달 1일이 걸린 주의 일요일부터 6주(42칸)
  const first = new Date(year, month, 1)
  const gridStart = new Date(year, month, 1 - first.getDay())
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
    const iso = toISO(d)
    return {
      iso, day: d.getDate(),
      inMonth:  d.getMonth() === month && d.getFullYear() === year,
      isSunday: d.getDay() === 0,
      disabled: !!max && iso > max,
    }
  })

  const todayISO = toISO(new Date())

  return (
    // transform-origin 을 왼쪽 위로 둔다 — modal-in 은 scale(0.8)에서 커지는데
    // 기본 origin(중앙)이면 버튼에서 자라나지 않고 제자리에서 부푼다.
    <div
      ref={wrapRef}
      className="modal-in absolute left-0 top-[calc(100%+6px)] z-40 w-[278px] bg-[#FCFCFC] border border-[#E8E4E2] rounded-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.14)] p-[14px]"
      style={{ transformOrigin: 'top left' }}
    >
      <div className="flex items-center justify-between mb-[10px]">
        <span className="text-[15px] font-semibold text-[#1E1E1E]">{year}년 {month + 1}월</span>
        <div className="flex items-center gap-[4px]">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="이전 달"
            className="w-[24px] h-[24px] rounded-[6px] flex items-center justify-center hover:bg-[#F2F2F2] transition-colors">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M10 3.5L5.5 8L10 12.5" stroke="#6A635E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="다음 달"
            className="w-[24px] h-[24px] rounded-[6px] flex items-center justify-center hover:bg-[#F2F2F2] transition-colors">
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
          const isSel = c.iso === value
          return (
            <button
              key={c.iso}
              type="button"
              disabled={c.disabled}
              onClick={() => { onPick(c.iso); onClose() }}
              className={`relative h-[30px] rounded-[7px] text-[13px] font-medium transition-colors ${
                isSel
                  ? 'bg-[#6A635E] text-[#FCFCFC] font-bold'
                  : c.disabled
                    ? 'text-[#E5E5E5] cursor-not-allowed'
                    : c.inMonth
                      ? `${c.isSunday ? 'text-[#C92A2A]' : 'text-[#1E1E1E]'} hover:bg-[#F2F2F2]`
                      : 'text-[#D7D7D7]'
              }`}
            >
              {c.day}
              {/* 오늘 표시 — 선결제는 대개 '오늘'이라 바로 찾을 수 있어야 한다 */}
              {c.iso === todayISO && !isSel && (
                <span className="absolute bottom-[3px] left-1/2 -translate-x-1/2 w-[3px] h-[3px] rounded-full bg-[#6A635E]" />
              )}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between mt-[10px] pt-[10px] border-t border-[#F2F2F2]">
        <span className="text-[11px] text-[#787878]">미래 날짜는 고를 수 없어요</span>
        <button
          type="button"
          onClick={() => { onPick(todayISO); onClose() }}
          className="h-[26px] px-[12px] rounded-[7px] bg-[#F2F2F2] text-[#6A635E] text-[12px] font-semibold hover:bg-[#E8E4E2] transition-colors"
        >
          오늘
        </button>
      </div>
    </div>
  )
}
