import { useEffect, useRef, useState } from 'react'

// 시각 하나를 고르는 팝오버 — 누른 버튼 **바로 아래**에 뜬다. DatePopover 의 짝이다.
//
// 브라우저 기본 <input type="time"> 을 쓰지 않는 이유는 date 와 같다:
// Windows 와 macOS 가 완전히 다른 위젯을 띄우고, 우리 색·모서리·글꼴이 하나도
// 안 먹는다. 바로 옆 날짜 칸은 우리 캘린더인데 시간 칸만 OS 위젯이 뜨면
// 한 줄 안에서 두 제품이 섞인 것처럼 보인다.
//
// ── 왜 5분 단위인가 ───────────────────────────────────────────────────────
// 여기서 고르는 건 '실제 선결제 일시' — 점주가 나중에 장부를 맞출 때 쓰는 값이다.
// 1분 단위로 맞출 일이 없고, 분을 60칸으로 늘리면 고르는 데 시간이 더 걸린다.
// 12칸이면 한눈에 들어오고 손가락으로도 눌린다.

/**
 * 'HH:MM' → '오후 2:35'. 빈 값이거나 시각이 아니면 null (버튼이 '시간 선택'으로 남는다).
 *
 * 범위를 꼭 본다 — 모양만 맞춰 보면 '25:00' 이 25 % 12 = 1 로 접혀서
 * **'오후 1:00' 이라는 그럴듯한 거짓말**이 된다. 틀린 시각을 보여 주느니 안 보여준다.
 */
export function timeLabel(hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${m[2]}`
}

const HOURS   = Array.from({ length: 12 }, (_, i) => i + 1)          // 1~12
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)          // 0,5,…,55

/** 지금 시각을 5분 단위로 내림 */
function nowRounded(): { h12: number; min: number; pm: boolean } {
  const d = new Date()
  const h = d.getHours()
  return { h12: h % 12 === 0 ? 12 : h % 12, min: Math.floor(d.getMinutes() / 5) * 5, pm: h >= 12 }
}

function parse(hhmm: string): { h12: number; min: number; pm: boolean } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return { h12: h % 12 === 0 ? 12 : h % 12, min, pm: h >= 12 }
}

/** 오전/오후 + 12시제 → 'HH:MM' */
export function toHHMM(h12: number, min: number, pm: boolean): string {
  const h24 = pm ? (h12 === 12 ? 12 : h12 + 12) : (h12 === 12 ? 0 : h12)
  return `${String(h24).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export default function TimePopover({ value, onPick, onClose }: {
  /** 선택된 시각 ('HH:MM'). 빈 값이면 지금 시각에서 시작한다 */
  value: string
  onPick: (hhmm: string) => void
  onClose: () => void
}) {
  const start = parse(value) ?? nowRounded()
  const [pm,  setPm]  = useState(start.pm)
  const [h12, setH12] = useState(start.h12)
  const [min, setMin] = useState(start.min)
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

  /**
   * 고르는 즉시 값을 올린다.
   *
   * 날짜와 달리 시각은 **세 번을 골라야** 하나가 된다(오전·시·분). 첫 선택에서
   * 닫아 버리면 나머지를 못 고르고, 끝까지 안 올리면 버튼에 아무 변화가 없어서
   * 눌리고 있는지가 안 보인다. 그래서 누를 때마다 올리고, 닫는 건 바깥 클릭이나
   * '완료'가 맡는다.
   */
  function push(next: { pm?: boolean; h12?: number; min?: number }) {
    const p = next.pm  ?? pm
    const h = next.h12 ?? h12
    const m = next.min ?? min
    setPm(p); setH12(h); setMin(m)
    onPick(toHHMM(h, m, p))
  }

  const cell = 'h-[30px] rounded-[7px] text-[13px] font-medium transition-colors'

  return (
    // transform-origin — DatePopover 와 같은 이유(modal-in 이 버튼에서 자라나게)
    <div
      ref={wrapRef}
      className="modal-in absolute right-0 top-[calc(100%+6px)] z-40 w-[278px] bg-[#FCFCFC] border border-[#E8E4E2] rounded-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.14)] p-[14px]"
      style={{ transformOrigin: 'top right' }}
    >
      {/* 오전/오후 — 이걸 안 고르면 12시간이 어긋난다. 그래서 맨 위 */}
      <div className="flex items-center justify-between mb-[10px]">
        <span className="text-[15px] font-semibold text-[#1E1E1E] tabular-nums">
          {timeLabel(toHHMM(h12, min, pm))}
        </span>
        <div className="flex bg-[#F2F2F2] rounded-[8px] p-[2px]">
          {([['오전', false], ['오후', true]] as const).map(([label, v]) => (
            <button
              key={label}
              type="button"
              onClick={() => push({ pm: v })}
              className={`h-[24px] px-[11px] rounded-[6px] text-[12px] font-semibold transition-colors ${
                pm === v ? 'bg-[#FCFCFC] text-[#1E1E1E] shadow-[0_1px_3px_rgba(0,0,0,0.1)]' : 'text-[#787878]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="text-[11px] font-semibold text-[#787878] mb-[4px]">시</div>
      <div className="grid grid-cols-6 gap-[2px]">
        {HOURS.map(h => (
          <button
            key={h} type="button" onClick={() => push({ h12: h })}
            className={`${cell} ${h === h12 ? 'bg-[#6A635E] text-[#FCFCFC] font-bold' : 'text-[#1E1E1E] hover:bg-[#F2F2F2]'}`}
          >
            {h}
          </button>
        ))}
      </div>

      <div className="text-[11px] font-semibold text-[#787878] mt-[10px] mb-[4px]">분</div>
      <div className="grid grid-cols-6 gap-[2px]">
        {MINUTES.map(m => (
          <button
            key={m} type="button" onClick={() => push({ min: m })}
            className={`${cell} tabular-nums ${m === min ? 'bg-[#6A635E] text-[#FCFCFC] font-bold' : 'text-[#1E1E1E] hover:bg-[#F2F2F2]'}`}
          >
            {String(m).padStart(2, '0')}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between mt-[10px] pt-[10px] border-t border-[#F2F2F2]">
        {/* 날짜 쪽 '오늘'과 같은 자리·같은 모양 — 대개 지금이다 */}
        <button
          type="button"
          onClick={() => { const n = nowRounded(); push(n) }}
          className="h-[26px] px-[12px] rounded-[7px] bg-[#F2F2F2] text-[#6A635E] text-[12px] font-semibold hover:bg-[#E8E4E2] transition-colors"
        >
          지금
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-[26px] px-[14px] rounded-[7px] bg-[#2C261F] text-[#FCFCFC] text-[12px] font-semibold hover:opacity-90 transition-opacity"
        >
          완료
        </button>
      </div>
    </div>
  )
}
