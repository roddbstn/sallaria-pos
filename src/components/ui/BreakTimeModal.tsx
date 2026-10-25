import { useState } from 'react'
import type { BreakTime, DayBreak } from '../../hooks/useOperatingHours'

// 브레이크 타임 설정.
//
// 저장만 하면 끝이다 — 가게 문을 여닫는 건 DB cron(auto_close_stores_by_schedule)이
// 매분 돌면서 stores.break_time 을 읽어 is_open 을 내리고(시작) 올린다(종료).
// 요일마다 다른 값도 거기서 그대로 처리된다. 이 모달은 그 값을 쓰는 창구일 뿐이다.
//
// '일괄로'를 기본으로 둔 이유: 요일마다 다른 브레이크를 두는 매장은 드물다.
// 일곱 줄을 다 보여주고 시작하면 대부분은 같은 값을 일곱 번 입력하게 된다.

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const DAY_KO: Record<string, string> = {
  mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일',
}

/** 00:00~23:30, 30분 간격 */
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0')
  const m = i % 2 === 0 ? '00' : '30'
  return `${h}:${m}`
})

function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      // pr 을 따로 키운다 — select 의 기본 화살표는 오른쪽 테두리에 거의 붙어서 그려진다.
      // appearance-none 으로 지우고 직접 그리는 방법도 있지만, 네이티브 드롭다운이
      // 터치에서 더 안정적이라 화살표는 두고 여백만 준다.
      className="h-[34px] pl-[10px] pr-[26px] rounded-[9px] border border-[#D9D9D9] bg-[#FCFCFC] text-[14px] text-ink outline-none focus:border-[#6A635E] transition-colors"
    >
      {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
    </select>
  )
}

export default function BreakTimeModal({ initial, onConfirm, onClose }: {
  initial: BreakTime
  onConfirm: (next: BreakTime) => void
  onClose: () => void
}) {
  // 들어올 때 이미 요일마다 값이 다르면 '요일별'로 열어준다 —
  // 일괄 화면으로 열면 공들여 맞춰둔 요일별 설정을 모르고 덮어쓰게 된다.
  const enabledDays = DAYS.filter(d => initial[d]?.enabled)
  const mixed = enabledDays.length > 0 && enabledDays.some(d =>
    initial[d].start !== initial[enabledDays[0]].start ||
    initial[d].end   !== initial[enabledDays[0]].end)

  const [mode, setMode] = useState<'all' | 'each'>(mixed ? 'each' : 'all')
  const [draft, setDraft] = useState<BreakTime>(() => {
    const d: BreakTime = {}
    DAYS.forEach(k => { d[k] = { ...(initial[k] ?? { enabled: false, start: '14:00', end: '17:00' }) } })
    return d
  })

  // 일괄 화면의 공통 값 — 켜진 요일이 있으면 그 값, 없으면 기본값
  const base: DayBreak = draft[enabledDays[0] ?? 'mon'] ?? { enabled: false, start: '14:00', end: '17:00' }
  const [allStart, setAllStart] = useState(base.start)
  const [allEnd,   setAllEnd]   = useState(base.end)
  const [allDays,  setAllDays]  = useState<string[]>(enabledDays.length ? [...enabledDays] : [])

  function patch(day: string, p: Partial<DayBreak>) {
    setDraft(d => ({ ...d, [day]: { ...d[day], ...p } }))
  }

  function handleConfirm() {
    if (mode === 'each') { onConfirm(draft); return }
    // 일괄: 고른 요일만 켜고 같은 시간, 나머지는 끈다(시간 값은 남겨 둔다 — 다시 켤 때 그대로)
    const next: BreakTime = {}
    DAYS.forEach(d => {
      next[d] = allDays.includes(d)
        ? { enabled: true, start: allStart, end: allEnd }
        : { ...draft[d], enabled: false }
    })
    onConfirm(next)
  }

  const invalid = mode === 'all'
    ? allDays.length > 0 && allStart >= allEnd
    : DAYS.some(d => draft[d].enabled && draft[d].start >= draft[d].end)

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[18px] shadow-[0_2px_10px_rgba(44,38,31,0.08)] w-[460px] px-[28px] pt-[24px] pb-[22px]"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-[18px] font-semibold text-[#1E1E1E]">브레이크 타임</div>
        <div className="text-[13px] font-normal text-[#787878] mt-[4px] mb-[18px] leading-relaxed">
          설정한 시간이 되면 가게가 자동으로 닫히고, 끝나면 다시 열려요
        </div>

        <div className="flex gap-[6px] mb-[18px]">
          {([['all', '일괄로'], ['each', '요일별로']] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setMode(v)}
              className={`pressable-tab flex-1 h-[36px] rounded-[10px] text-[14px] transition-colors ${
                mode === v ? 'bg-[#6A635E] text-[#FCFCFC] font-medium' : 'bg-[#F2F2F2] text-[#787878]'
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        {mode === 'all' ? (
          <>
            <div className="flex items-center gap-[8px] mb-[16px]">
              <TimeSelect value={allStart} onChange={setAllStart} />
              <span className="text-[14px] text-[#787878]">부터</span>
              <TimeSelect value={allEnd} onChange={setAllEnd} />
              <span className="text-[14px] text-[#787878]">까지</span>
            </div>
            <div className="text-[13px] font-normal text-[#6A635E] mb-[8px]">적용할 요일</div>
            <div className="flex gap-[6px]">
              {DAYS.map(d => (
                <button
                  key={d}
                  onClick={() => setAllDays(a => a.includes(d) ? a.filter(x => x !== d) : [...a, d])}
                  className={`pressable-tab w-[42px] h-[36px] rounded-[10px] text-[14px] transition-colors ${
                    allDays.includes(d) ? 'bg-[#6A635E] text-[#FCFCFC] font-medium' : 'bg-[#F2F2F2] text-[#787878]'
                  }`}
                >
                  {DAY_KO[d]}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-[8px]">
            {DAYS.map(d => (
              <div key={d} className="flex items-center gap-[8px]">
                <button
                  onClick={() => patch(d, { enabled: !draft[d].enabled })}
                  className={`pressable-tab w-[42px] h-[34px] rounded-[9px] text-[14px] flex-shrink-0 transition-colors ${
                    draft[d].enabled ? 'bg-[#6A635E] text-[#FCFCFC] font-medium' : 'bg-[#F2F2F2] text-[#787878]'
                  }`}
                >
                  {DAY_KO[d]}
                </button>
                {draft[d].enabled ? (
                  <>
                    <TimeSelect value={draft[d].start} onChange={v => patch(d, { start: v })} />
                    <span className="text-[14px] text-[#787878]">~</span>
                    <TimeSelect value={draft[d].end} onChange={v => patch(d, { end: v })} />
                  </>
                ) : (
                  <span className="text-[13px] text-[#ADADAD]">브레이크 없음</span>
                )}
              </div>
            ))}
          </div>
        )}

        {invalid && (
          <div className="text-[12px] text-danger mt-[14px]">
            시작 시간이 종료 시간보다 빨라야 해요
          </div>
        )}

        <div className="flex gap-[8px] justify-end mt-[22px]">
          <button
            onClick={onClose}
            className="pressable w-[86px] h-[42px] rounded-[10px] bg-[#E8E4E2] text-[#6A635E] text-[14px] font-medium hover:opacity-90"
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            disabled={invalid}
            className="pressable w-[110px] h-[42px] rounded-[10px] bg-[#2C261F] text-[#FCFCFC] text-[14px] font-medium hover:opacity-90 disabled:opacity-40"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
