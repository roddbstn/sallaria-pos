import { useEffect, useMemo, useState } from 'react'

// 카테고리 추가 — 2단계(설정 → 적용할 메뉴 선택).
//
// 왜 컴포넌트로 뺐나: 같은 일을 하는 화면이 둘이다. 메뉴 화면의 '+ 카테고리 추가'와
// 카테고리 정보 화면의 '+ 카테고리 추가'. 전에는 메뉴 화면에만 모달이 있고
// 카테고리 정보 쪽은 "메뉴 화면에서 할 수 있어요" 토스트만 띄웠다 —
// 카테고리를 보러 들어온 화면에서 카테고리를 못 만드는 셈이었다.
//
// 치수·간격·단계 표시는 **옵션 추가 모달(Menus.tsx addingStoreGroup)과 같은 값**이다.
// 두 모달은 '이름을 정하고 → 적용할 메뉴를 고른다'는 똑같은 흐름이라, 다르게 생기면
// 점주가 같은 일을 두 번 배워야 한다. 숫자를 그대로 옮겨 적은 것이지 눈대중이 아니다:
//   헤더 px-30 pt-30 pb-20 · 제목 22px bold · 단계 뱃지 24px + 라벨 15px semibold(gap 26)
//   입력칸 h-48 r-10 px-16 15px · 칸 라벨 15px medium mb-10 · 블록 사이 gap-26
//   푸터 px-30 py-20 · 버튼 h-52 px-34 r-12 16px
//
// 2단계는 **선택 사항**이다 — 빈 분류로 만들어 두고 나중에 채워도 된다.

export interface AddableMenu {
  code:      string
  name:      string
  soldOut?:  boolean
}

const STEPS = [{ s: 1, label: '설정' }, { s: 2, label: '적용할 메뉴 선택' }] as const

export default function CategoryAddModal({
  menus, onClose, onCreate,
}: {
  menus:      AddableMenu[]
  onClose:    () => void
  onCreate:   (name: string, menuCodes: Set<string>) => Promise<void>
}) {
  const [step,     setStep]     = useState<1 | 2>(1)
  const [name,     setName]     = useState('')
  const [picked,   setPicked]   = useState<Set<string>>(new Set())
  const [search,   setSearch]   = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const q = search.trim().toLowerCase()

  // 카테고리로 묶지 않고 **전체 메뉴를 한 줄로** 펼친다.
  // 새 분류에 넣을 메뉴는 보통 여러 분류에 흩어져 있고(그래서 새로 묶는 것이다),
  // 묶음으로 보여주면 접힌 카테고리 안을 하나씩 열어봐야 했다.
  const visible = useMemo(
    () => menus.filter(m => !q || m.name.toLowerCase().includes(q)),
    [menus, q],
  )
  const allChecked = visible.length > 0 && visible.every(m => picked.has(m.code))

  function toggleMany(codes: string[], on: boolean) {
    setPicked(prev => {
      const next = new Set(prev)
      if (on) codes.forEach(c => next.add(c))
      else    codes.forEach(c => next.delete(c))
      return next
    })
  }

  const trimmed = name.trim()

  async function create() {
    if (!trimmed || saving) return
    setSaving(true); setError('')
    try { await onCreate(trimmed, picked); onClose() }
    catch { setError('만들지 못했어요. 다시 시도해 주세요'); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={() => !saving && onClose()}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[18px] shadow-xl w-[560px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 + 단계 표시 — 옵션 추가 모달과 같은 모양(원형 숫자 뱃지 + 단계명) */}
        <div className="px-[30px] pt-[30px] pb-[20px] flex-shrink-0">
          <div className="flex items-center justify-between mb-[20px]">
            <span className="text-[22px] font-bold text-ink">카테고리 추가</span>
            <button onClick={onClose} aria-label="닫기" className="text-gray-text hover:text-ink text-[18px]">✕</button>
          </div>
          <div className="flex items-center gap-[26px]">
            {STEPS.map(({ s, label }) => (
              <div key={s} className="flex items-center gap-[8px]">
                <span className={`w-[24px] h-[24px] rounded-full flex items-center justify-center text-[12px] font-semibold flex-shrink-0 ${
                  s === step ? 'bg-[#E8E4E2] text-ink' : 'bg-[#F2F2F2] text-[#ADADAD]'
                }`}>
                  {s}
                </span>
                <span className={`text-[15px] font-semibold whitespace-nowrap ${s === step ? 'text-ink' : 'text-[#ADADAD]'}`}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Step 1: 설정 ── */}
        {step === 1 && (
          <div className="px-[30px] pb-[24px] flex flex-col gap-[26px] overflow-y-auto">
            <div>
              <div className="text-[15px] font-medium text-ink mb-[10px]">카테고리 이름</div>
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value.slice(0, 20))}
                onKeyDown={e => { if (e.key === 'Enter' && trimmed) setStep(2) }}
                placeholder="ex) 샐러드"
                className="field-soft w-full h-[48px] border border-[#D9D9D9] rounded-[10px] px-[16px] text-[15px] text-ink placeholder:text-[#ADADAD] outline-none focus:border-[#6A635E] bg-transparent"
              />
            </div>
            {error && <div className="text-[13px] text-danger">{error}</div>}
          </div>
        )}

        {/* ── Step 2: 적용할 메뉴 선택 ── */}
        {step === 2 && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="px-[30px] pb-[18px] flex-shrink-0">
              <div className="field-wrap flex items-center gap-[10px] h-[48px] border border-[#D9D9D9] rounded-[10px] px-[16px]">
                <svg width="16" height="16" viewBox="0 0 22 22" fill="none" className="flex-shrink-0">
                  <circle cx="9" cy="9" r="7" stroke="#8C8379" strokeWidth="2" />
                  <path d="M14 14L19 19" stroke="#8C8379" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="메뉴 이름을 검색할 수 있어요"
                  className="field-bare flex-1 min-w-0 outline-none focus-visible:outline-none text-[15px] text-ink placeholder:text-[#ADADAD] bg-transparent"
                />
              </div>
            </div>

            <div className="px-[30px] pb-[10px] flex-shrink-0 flex items-center justify-between">
              <span className="text-[15px] text-[#8C8379]">메뉴 {visible.length}개</span>
              <button
                onClick={() => toggleMany(visible.map(m => m.code), !allChecked)}
                disabled={visible.length === 0}
                className="text-[15px] text-[#8C8379] hover:text-ink disabled:opacity-40 transition-colors"
              >
                메뉴 전체선택
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-[30px] pb-[10px]">
              {visible.length === 0 ? (
                <div className="text-center py-10 text-[14px] text-gray-text">
                  {q ? '검색 결과가 없습니다.' : '등록된 메뉴가 없습니다.'}
                </div>
              ) : visible.map(menu => {
                const checked = picked.has(menu.code)
                return (
                  <button
                    key={menu.code}
                    onClick={() => toggleMany([menu.code], !checked)}
                    className="pressable-row w-full flex items-center gap-[10px] px-[6px] py-[12px] text-left hover:bg-[#F9F9F9] rounded-[10px]"
                  >
                    <span className={`flex-1 min-w-0 truncate text-[15px] ${checked ? 'text-ink font-medium' : 'text-[#6A635E]'}`}>
                      {menu.name}
                    </span>
                    {menu.soldOut && <span className="text-[11px] text-danger font-bold flex-shrink-0">품절</span>}
                    <svg width="18" height="13" viewBox="0 0 20 14" fill="none" className="flex-shrink-0">
                      <path d="M1.5 7L7 12.5L18.5 1.5" stroke={checked ? '#1E1E1E' : '#DDD7D1'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )
              })}
              {error && <div className="text-[13px] text-danger pt-[8px]">{error}</div>}
            </div>
          </div>
        )}

        {/* 푸터 — 2단계에선 좌측에 적용 메뉴 개수, 우측에 이전/완료 */}
        <div className="flex items-center justify-between gap-[14px] px-[30px] py-[20px] flex-shrink-0 mt-auto">
          <span className="text-[14px] text-[#8C8379] truncate">
            {step === 2 ? `'${trimmed}' 분류에 넣을 메뉴 개수 (${picked.size}/${visible.length})` : ''}
          </span>
          <div className="flex items-center gap-[10px] flex-shrink-0">
            <button
              onClick={() => step === 2 ? setStep(1) : onClose()}
              disabled={saving}
              className="px-[34px] h-[52px] rounded-[12px] bg-[#F2F0EE] text-ink text-[16px] font-medium hover:bg-[#E8E4E2] disabled:opacity-40 transition-colors"
            >
              {step === 2 ? '이전' : '닫기'}
            </button>
            <button
              onClick={() => step === 1 ? (trimmed && setStep(2)) : create()}
              disabled={step === 1 ? !trimmed : saving}
              className="px-[34px] h-[52px] rounded-[12px] bg-[#2C261F] text-[#F9F9F9] text-[16px] font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {step === 1 ? '다음' : (saving ? '만드는 중…' : '완료')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
