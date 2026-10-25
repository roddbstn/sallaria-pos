import { useState } from 'react'

// 시작일~종료일 범위를 고르는 캘린더 모달. 주문 홈(기간선택)과 주문 내역이 함께 쓴다.
//
// Dashboard.tsx 안에만 있던 걸 끌어냈다 — 주문 내역이 쓰던 좌측 240px 캘린더 패널은
// 같은 일을 다른 모양으로 하고 있었고, 표가 좁아지는 대가까지 치르고 있었다.
//
/** Date → 'YYYY-MM-DD' (로컬 기준) */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 디자인 시스템 정리(2026-10-13): 모달 셸·푸터 버튼을 RegularHolidayModal 과 같은 규칙으로
// 맞췄다(#FCFCFC / radius 14 / 상단 그림자 구분선 / h-44 버튼 / font-medium).
//
// 범위 표시 규칙 — 이전에는 날짜 칸 전체 높이의 띠가 원 "중심"에서 시작해 원보다 두꺼웠고,
// 원도 칸을 꽉 채워서 둘이 한 덩어리로 뭉쳤다. 세 가지를 분리했다:
//   1. 원은 칸보다 작게(34px 고정) — 칸 여백이 숨 쉴 자리가 된다
//   2. 띠는 원보다 얇게(26px) 그리고 세로 중앙 정렬 — 원이 띠 위로 올라온다
//   3. 띠는 원의 바깥 끝이 아니라 원 반지름만큼 안쪽에서 시작 — 원에서 띠가 자라나 보인다
export default function PeriodCalendarModal({ onClose, onApply }: { onClose: () => void; onApply: (start: string, end: string) => void }) {
  const today = new Date()
  const [calYear,  setCalYear]  = useState(today.getFullYear())
  const [calMonth, setCalMonth] = useState(today.getMonth()) // 0-indexed
  const [rangeStart, setRangeStart] = useState<string | null>(null)
  const [rangeEnd,   setRangeEnd]   = useState<string | null>(null)

  function pickDate(dateStr: string) {
    if (!rangeStart || (rangeStart && rangeEnd)) {
      setRangeStart(dateStr)
      setRangeEnd(null)
    } else {
      if (dateStr < rangeStart) { setRangeEnd(rangeStart); setRangeStart(dateStr) }
      else { setRangeEnd(dateStr) }
    }
  }

  function applyPreset(start: Date, end: Date) {
    setRangeStart(ymd(start))
    setRangeEnd(ymd(end))
    setCalYear(end.getFullYear())
    setCalMonth(end.getMonth())
  }

  /** 그 주의 월요일 (일요일은 지난주로 본다 — 한국에서 주는 월요일 시작) */
  function mondayOf(d: Date): Date {
    const dow = d.getDay()
    const mon = new Date(d)
    mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
    return mon
  }

  const PRESETS: { label: string; get: () => readonly [Date, Date] }[] = [
    { label: '오늘',   get: () => [today, today] },
    { label: '이번주', get: () => [mondayOf(today), today] },
    { label: '지난주', get: () => {
        const thisMon = mondayOf(today)
        const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7)
        const lastSun = new Date(thisMon); lastSun.setDate(thisMon.getDate() - 1)
        return [lastMon, lastSun]
      } },
    { label: '이번달', get: () => [new Date(today.getFullYear(), today.getMonth(), 1), today] },
    { label: '지난달', get: () => {
        const m  = today.getMonth() - 1
        const y  = today.getFullYear() + (m < 0 ? -1 : 0)
        const mm = (m + 12) % 12
        return [new Date(y, mm, 1), new Date(y, mm + 1, 0)]
      } },
  ]

  /** 현재 선택이 이 프리셋과 같은지 — 눌린 게 보여야 두 번 누르지 않는다 */
  function isActivePreset(p: { get: () => readonly [Date, Date] }): boolean {
    if (!rangeStart || !rangeEnd) return false
    const [s, e] = p.get()
    return ymd(s) === rangeStart && ymd(e) === rangeEnd
  }

  const firstDay     = new Date(calYear, calMonth, 1).getDay()
  const daysInMonth  = new Date(calYear, calMonth + 1, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)

  const rangeLabel = rangeStart
    ? rangeEnd && rangeEnd !== rangeStart
      ? `${rangeStart.replace(/-/g, '.')} ~ ${rangeEnd.replace(/-/g, '.')}`
      : rangeStart.replace(/-/g, '.')
    : '날짜를 선택해 주세요'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[18px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] w-[420px] max-w-[92vw] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-[28px] pt-[28px] pb-[22px]">
          <div className="flex items-center justify-between mb-[4px]">
            <div className="text-[18px] font-semibold text-[#1E1E1E]">기간 선택</div>
            <button
              onClick={onClose}
              aria-label="닫기"
              className="w-[26px] h-[26px] flex items-center justify-center rounded-[7px] text-[#ADADAD] hover:bg-[#F2F2F2] hover:text-[#787878] transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className={`text-[12px] font-normal mb-[18px] ${rangeStart ? 'text-[#787878]' : 'text-[#ADADAD]'}`}>
            {rangeLabel}
          </div>

          {/* 프리셋 — 자주 쓰는 범위는 캘린더를 두 번 누르지 않게 */}
          <div className="flex gap-[6px] mb-[20px]">
            {PRESETS.map(p => {
              const on = isActivePreset(p)
              return (
                <button
                  key={p.label}
                  onClick={() => { const [s, e] = p.get(); applyPreset(s, e) }}
                  className={`pressable-tab flex-1 h-[32px] rounded-[9px] text-[12px] font-normal ${
                    on ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878]'
                  }`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>

          {/* 월 이동 */}
          <div className="flex items-center justify-between mb-[6px]">
            <button
              onClick={() => { const d = new Date(calYear, calMonth - 1, 1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth()) }}
              aria-label="이전 달"
              className="w-[28px] h-[28px] flex items-center justify-center rounded-[8px] text-[#787878] hover:bg-[#F2F2F2] transition-colors"
            >
              <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                <path d="M6 1L1 6L6 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="text-[14px] font-medium text-[#1E1E1E]">{calYear}년 {calMonth + 1}월</span>
            <button
              onClick={() => { const d = new Date(calYear, calMonth + 1, 1); setCalYear(d.getFullYear()); setCalMonth(d.getMonth()) }}
              aria-label="다음 달"
              className="w-[28px] h-[28px] flex items-center justify-center rounded-[8px] text-[#787878] hover:bg-[#F2F2F2] transition-colors"
            >
              <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                <path d="M1 1L6 6L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-7">
            {['일','월','화','수','목','금','토'].map((d, i) => (
              <div
                key={d}
                className={`text-center text-[11px] font-normal py-[6px] ${
                  i === 0 ? 'text-[#FF676F]' : i === 6 ? 'text-[#3374FF]' : 'text-[#ADADAD]'
                }`}
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {cells.map((dateStr, i) => {
              if (!dateStr) return <div key={`e${i}`} className="h-[40px]" />
              const isStart  = dateStr === rangeStart
              const isEnd    = dateStr === rangeEnd
              const hasRange = !!rangeStart && !!rangeEnd && rangeEnd !== rangeStart
              const inRange  = hasRange && dateStr > rangeStart! && dateStr < rangeEnd!
              const isFuture = dateStr > ymd(today)

              // 띠(26px)가 원(34px)보다 얇고, 원 반지름(17px)만큼 안쪽에서 시작한다.
              // inset-y 로 중앙 정렬 → 원이 띠를 덮으면서 자연스럽게 이어진다.
              const BAND = 'absolute top-1/2 -translate-y-1/2 h-[26px] bg-[#F2F2F2] pointer-events-none'
              return (
                <div key={dateStr} className="relative h-[40px] flex items-center justify-center">
                  {inRange && <div className={`${BAND} left-0 right-0`} />}
                  {hasRange && isStart && <div className={`${BAND} right-0`} style={{ left: 'calc(50% + 2px)' }} />}
                  {hasRange && isEnd   && <div className={`${BAND} left-0`}  style={{ right: 'calc(50% + 2px)' }} />}
                  <button
                    disabled={isFuture}
                    onClick={() => pickDate(dateStr)}
                    className={`relative w-[34px] h-[34px] flex items-center justify-center text-[13px] rounded-full transition-colors
                      ${isFuture ? 'text-[#D7D7D7] cursor-not-allowed' : ''}
                      ${isStart || isEnd
                        ? 'bg-[#2C261F] text-[#FCFCFC] font-medium'
                        : isFuture ? 'font-normal' : 'text-[#1E1E1E] font-normal hover:bg-[#E8E4E2]'}`}
                  >
                    {Number(dateStr.slice(8, 10))}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* 하단 바 — RegularHolidayModal 과 같은 규칙 */}
        <div className="flex-shrink-0 modal-footer px-[28px] py-[16px] flex justify-end gap-[10px]">
          <button
            onClick={onClose}
            className="w-[86px] h-[44px] rounded-[10px] bg-[#E8E4E2] text-[#6A635E] text-[14px] font-medium hover:opacity-90 transition-opacity"
          >
            취소
          </button>
          <button
            onClick={() => rangeStart && onApply(rangeStart, rangeEnd ?? rangeStart)}
            disabled={!rangeStart}
            className="w-[118px] h-[44px] rounded-[10px] bg-[#2C261F] text-[#F9F9F9] text-[14px] font-medium hover:opacity-90 transition-opacity disabled:bg-[#E8E4E2] disabled:text-[#ADADAD] disabled:cursor-not-allowed"
          >
            적용
          </button>
        </div>
      </div>
    </div>
  )
}

