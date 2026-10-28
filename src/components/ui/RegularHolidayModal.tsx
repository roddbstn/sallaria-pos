import { useEffect, useRef, useState } from 'react'

// 정기 휴무일 모달 — Figma node 664:730(매주) / 666:852(격주).
// 주기 드롭다운(매주·격주) + 요일 칩(복수 선택) + 하단 닫기/확인.
// Figma 2240 캔버스 원본 px × 0.643(FIGMA_SCALE) 환산:
//   모달 1402×741 → 902×476 · radius 30→19 · 제목 40→26 · 칩 28→18 · CTA 32→21 / h100→64

export type HolidayCycle = 'weekly' | 'biweekly'
export interface RegularHolidays {
  cycle: HolidayCycle
  days:  string[]
}

const CYCLE_LABEL: Record<HolidayCycle, string> = { weekly: '매주', biweekly: '격주' }
const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: '월' }, { key: 'tue', label: '화' }, { key: 'wed', label: '수' },
  { key: 'thu', label: '목' }, { key: 'fri', label: '금' }, { key: 'sat', label: '토' },
  { key: 'sun', label: '일' },
]

interface Props {
  initial: RegularHolidays | null
  onConfirm: (value: RegularHolidays) => void
  onClose: () => void
}

export default function RegularHolidayModal({ initial, onConfirm, onClose }: Props) {
  const [cycle, setCycle] = useState<HolidayCycle>(initial?.cycle ?? 'weekly')
  const [days,  setDays]  = useState<string[]>(initial?.days ?? [])
  const [cycleOpen, setCycleOpen] = useState(false)
  const cycleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!cycleOpen) return
    function onDown(e: MouseEvent) {
      if (!cycleRef.current?.contains(e.target as Node)) setCycleOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [cycleOpen])

  function toggleDay(key: string) {
    setDays(prev => prev.includes(key) ? prev.filter(d => d !== key) : [...prev, key])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[18px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] w-[560px] max-w-[92vw] max-h-[82vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 본문 — Figma: 좌측 패딩 120→77, 제목 top 139→89 */}
        <div className="flex-1 min-h-0 overflow-y-auto px-[34px] pt-[34px] pb-[28px]">
          <div className="text-[18px] font-semibold text-[#1E1E1E] mb-[26px]">정기 휴무일</div>

          {/* 주기 드롭다운 — Figma 664:770: w 240→154 · h 79→51 · border #ADADAD · radius 15→10 */}
          <div ref={cycleRef} className="relative inline-block mb-[20px]">
            <button
              type="button"
              onClick={() => setCycleOpen(v => !v)}
              className="w-[118px] h-[40px] px-[14px] border border-[#ADADAD] rounded-[9px] flex items-center justify-between bg-[#FCFCFC] hover:bg-[#F9F9F9] transition-colors"
            >
              <span className="text-[14px] text-[#1E1E1E]">{CYCLE_LABEL[cycle]}</span>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={`transition-transform ${cycleOpen ? 'rotate-180' : ''}`}>
                <path d="M3.5 6L8 10.5L12.5 6" stroke="#787878" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {cycleOpen && (
              <div className="absolute top-[44px] left-0 w-[118px] z-10 bg-[#FCFCFC] border border-[#E8E4E2] rounded-[9px] shadow-[0_6px_20px_rgba(0,0,0,0.12)] py-[5px]">
                {(Object.keys(CYCLE_LABEL) as HolidayCycle[]).map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { setCycle(c); setCycleOpen(false) }}
                    className={`w-full h-[34px] px-[14px] text-left text-[14px] transition-colors ${
                      c === cycle ? 'bg-[#F2F2F2] text-[#2C261F] font-semibold' : 'text-[#414141] hover:bg-[#F2F2F2]'
                    }`}
                  >
                    {CYCLE_LABEL[c]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 요일 칩 — Figma: w 91→59 · h 59→38 · radius 15→10 · gap 14→9 · 28→18 */}
          <div className="flex items-center gap-[7px]">
            {DAYS.map(d => {
              const on = days.includes(d.key)
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => toggleDay(d.key)}
                  className={`w-[46px] h-[32px] rounded-[9px] text-[14px] text-center transition-colors ${
                    on ? 'bg-[#6A635E] text-[#FCFCFC] font-medium' : 'bg-[#F2F2F2] text-[#787878] font-medium hover:bg-[#E8E4E2]'
                  }`}
                >
                  {d.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* 하단 바 — Figma 664:775: 윗방향 그림자가 있는 구분선 + 닫기/확인 */}
        <div className="bg-[#FCFCFC] flex-shrink-0 px-[34px] py-[16px] flex justify-end gap-[10px]">
          <button
            type="button"
            onClick={onClose}
            className="w-[86px] h-[44px] rounded-[10px] bg-[#E8E4E2] text-[#6A635E] text-[14px] font-medium hover:opacity-90 transition-opacity"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={() => { onConfirm({ cycle, days }); onClose() }}
            className="w-[118px] h-[44px] rounded-[10px] bg-[#2C261F] text-[#F9F9F9] text-[14px] font-medium hover:opacity-90 transition-opacity"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  )
}
