import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// 오픈/마감 시각 선택 드롭다운. 운영시간 모달을 띄우지 않고 버튼 바로 아래에서 고른다.
// 00:00부터 10분 간격 144개, 표기는 '오전 12:00' / '오후 01:30'.

const STEP_MIN = 10

/** 'HH:mm' → '오전 12:00' */
export function formatKoreanTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm
  const period = h < 12 ? '오전' : '오후'
  // 0시·12시는 둘 다 12로 표기 (오전 12:00 = 자정, 오후 12:00 = 정오)
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${period} ${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const TIME_OPTIONS: string[] = (() => {
  const out: string[] = []
  for (let min = 0; min < 24 * 60; min += STEP_MIN) {
    out.push(`${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`)
  }
  return out
})()

/** 'HH:mm:ss' 등으로 들어와도 'HH:mm'으로 맞춰 옵션과 비교 가능하게 한다 */
function normalize(v?: string): string | undefined {
  if (!v) return undefined
  const [h, m] = v.split(':')
  if (h === undefined || m === undefined) return undefined
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
}

interface TimeSelectProps {
  value?: string
  placeholder: string
  onChange: (value: string) => void
  /** 비활성(휴무) 요일에서도 누르면 열리게 할지 — 기본 true */
  disabled?: boolean
}

export default function TimeSelect({ value, placeholder, onChange, disabled }: TimeSelectProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // 아래 공간이 모자라면 위로 띄운다
  const [dropUp, setDropUp] = useState(false)

  const current = normalize(value)

  useEffect(() => {
    if (!open) return
    function onDocDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 열릴 때: 띄울 방향 결정 + 현재 값으로 스크롤
  useLayoutEffect(() => {
    if (!open) return
    const rect = wrapRef.current?.getBoundingClientRect()
    if (rect) setDropUp(window.innerHeight - rect.bottom < 280 && rect.top > 280)

    const list = listRef.current
    if (!list) return
    const idx = current ? TIME_OPTIONS.indexOf(current) : -1
    // 선택값이 목록 가운데쯤 오도록. 값이 없으면 맨 위(오전 12:00)에서 시작
    list.scrollTop = idx > 0 ? Math.max(0, idx * 32 - 96) : 0
  }, [open, current])

  return (
    <div ref={wrapRef} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={() => !disabled && setOpen(v => !v)}
        className="w-full h-[32px] px-[11px] rounded-[9px] bg-[#F2F2F2] flex items-center justify-between hover:bg-[#E8E4E2] transition-colors"
      >
        <span className={`text-[14px] leading-[17px] font-normal truncate ${current ? 'text-[#1E1E1E]' : 'text-[#787878]'}`}>
          {current ? formatKoreanTime(current) : placeholder}
        </span>
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M3.5 6L8 10.5L12.5 6" stroke="#6A635E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div
          ref={listRef}
          className={`absolute left-0 right-0 z-30 max-h-[260px] overflow-y-auto bg-[#FCFCFC] border border-[#E8E4E2] rounded-[10px] shadow-[0_6px_20px_rgba(0,0,0,0.12)] py-[6px] ${
            dropUp ? 'bottom-[36px]' : 'top-[36px]'
          }`}
        >
          {TIME_OPTIONS.map(t => {
            const selected = t === current
            return (
              <button
                key={t}
                type="button"
                onClick={() => { onChange(t); setOpen(false) }}
                className={`w-full h-[32px] px-[12px] text-left text-[13px] leading-[32px] transition-colors ${
                  selected ? 'bg-[#F2F2F2] text-[#2C261F] font-medium' : 'text-[#414141] font-normal hover:bg-[#F2F2F2]'
                }`}
              >
                {formatKoreanTime(t)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
