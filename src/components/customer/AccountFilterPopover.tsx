import { useEffect, useMemo, useRef, useState } from 'react'

// 고객현황 패널의 거래처 필터 — 버튼 바로 아래에 뜨는 팝오버.
//
// 왜 모달이 아닌가: 패널의 숫자를 보면서 거래처를 켰다 껐다 하는 작업이라,
// 화면을 덮어버리면 "무엇이 어떻게 바뀌는지"를 못 본다. 팝오버는 뒤 숫자가
// 그대로 보여서 고르는 즉시 결과를 확인할 수 있다.
//
// 체크박스는 **그 거래처가 지금 집계에 들어가는지**를 그대로 나타낸다.
// 처음엔 전부 들어가므로 전부 체크된 상태로 보인다.
//
// 값은 세 가지 상태를 구분한다:
//   null       = 전체 (거래처가 새로 추가돼도 자동으로 포함된다)
//   빈 집합     = 아무 곳도 선택 안 함
//   그 외 집합  = 그 거래처들만
//
// 전체를 '빈 집합'으로 쓰던 때가 있었는데, 그러면 '전체'와 '아무것도 선택 안 함'을
// 구분할 수 없어 전체 체크를 해제할 방법 자체가 없었다. null 을 따로 두면
// "거래처가 늘면 자동 포함"이라는 성질을 지키면서도 해제가 된다.
// 보여줄 때는 null 을 '전부 체크'로 펼친다(effective).

export interface FilterableAccount {
  account_code: string
  account_name: string
  account_type: string
}

export default function AccountFilterPopover({ accounts, selected, onChange, onClose }: {
  accounts: FilterableAccount[]
  /** null 이면 전체, 빈 집합이면 아무 곳도 선택 안 함 */
  selected: Set<string> | null
  onChange: (next: Set<string> | null) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
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

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return accounts
    return accounts.filter(a =>
      a.account_name.toLowerCase().includes(needle) || a.account_type.toLowerCase().includes(needle))
  }, [accounts, q])

  const allCodes = useMemo(() => accounts.map(a => a.account_code), [accounts])
  /** 화면에 보여줄 '지금 포함된 집합'. null(= 전체)은 전부 체크로 펼친다 */
  const effective = useMemo(
    () => selected ?? new Set(allCodes),
    [selected, allCodes])
  const allOn = effective.size === allCodes.length && allCodes.length > 0

  /** 전부 켜졌으면 목록을 들고 있지 않고 null(= 전체)로 되돌린다 */
  function commit(next: Set<string>) {
    onChange(next.size === allCodes.length ? null : next)
  }

  function toggle(code: string) {
    const next = new Set(effective)
    if (next.has(code)) next.delete(code); else next.add(code)
    commit(next)
  }

  /** 전체 체크 토글 — 켜져 있으면 전부 해제, 아니면 전부 선택 */
  function toggleAll() {
    onChange(allOn ? new Set() : null)
  }

  return (
    // 패널 오른쪽 끝 버튼에 붙으므로 오른쪽 정렬 + origin 도 오른쪽 위.
    // origin 이 기본(중앙)이면 버튼에서 자라나지 않고 제자리에서 부푼다.
    <div
      ref={wrapRef}
      className="modal-in absolute right-0 top-[calc(100%+6px)] z-40 w-[268px] bg-[#FCFCFC] border border-[#E8E4E2] rounded-[12px] shadow-[0_8px_24px_rgba(0,0,0,0.14)] p-[12px]"
      style={{ transformOrigin: 'top right' }}
    >
      <div className="mb-[9px]">
        <span className="text-[13px] font-bold text-[#2C261F]">거래처 필터</span>
      </div>

      <div className="field-wrap flex items-center border border-[#D9D9D9] rounded-[8px] px-[9px] h-[30px] mb-[8px]">
        <svg width="12" height="12" viewBox="0 0 22 22" fill="none" className="flex-shrink-0">
          <circle cx="9" cy="9" r="7" stroke="#8C8379" strokeWidth="2"/>
          <path d="M14 14L19 19" stroke="#8C8379" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="거래처 검색"
          className="field-bare flex-1 min-w-0 ml-[6px] outline-none text-[12px] text-ink placeholder:text-[#ADADAD]"
        />
      </div>

      {/* 전체 — 검색 중에는 숨긴다(검색 결과와 '전체'가 같은 줄에 섞이면 헷갈린다) */}
      {!q.trim() && (
        <button
          type="button"
          onClick={toggleAll}
          className="pressable-row w-full flex items-center gap-[8px] h-[32px] px-[6px] rounded-[7px] hover:bg-[#F2F2F2] transition-colors mb-[2px]"
        >
          <span className={`w-[15px] h-[15px] rounded-[4px] flex-shrink-0 flex items-center justify-center border transition-colors ${
            allOn ? 'bg-[#6A635E] border-[#6A635E]' : 'border-[#D7D7D7] bg-[#FCFCFC]'
          }`}>
            {allOn && (
              <svg width="9" height="7" viewBox="0 0 10 8" fill="none">
                <path d="M1 4L3.8 6.6L9 1.4" stroke="#FCFCFC" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </span>
          <span className="flex-1 min-w-0 text-left text-[12px] font-semibold text-[#1E1E1E]">전체</span>
          <span className="flex-shrink-0 text-[11px] text-[#ADADAD]">{accounts.length}곳</span>
        </button>
      )}

      <div className="max-h-[232px] overflow-y-auto -mr-[4px] pr-[4px]">
        {shown.length === 0 ? (
          <div className="h-[60px] flex items-center justify-center text-[12px] text-[#ADADAD]">
            찾는 거래처가 없어요
          </div>
        ) : shown.map(a => {
          const on = effective.has(a.account_code)
          return (
            <button
              key={a.account_code}
              type="button"
              onClick={() => toggle(a.account_code)}
              className="pressable-row w-full flex items-center gap-[8px] h-[32px] px-[6px] rounded-[7px] hover:bg-[#F2F2F2] transition-colors"
            >
              <span className={`w-[15px] h-[15px] rounded-[4px] flex-shrink-0 flex items-center justify-center border transition-colors ${
                on ? 'bg-[#6A635E] border-[#6A635E]' : 'border-[#D7D7D7] bg-[#FCFCFC]'
              }`}>
                {on && (
                  <svg width="9" height="7" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.8 6.6L9 1.4" stroke="#FCFCFC" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </span>
              <span className="flex-1 min-w-0 text-left text-[12px] text-[#1E1E1E] truncate">{a.account_name}</span>
              <span className="flex-shrink-0 text-[11px] text-[#ADADAD]">{a.account_type}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-[9px] pt-[8px] border-t border-[#F2F2F2] text-[11px] text-[#787878]">
        {allOn
          ? `전체 ${accounts.length}곳`
          : effective.size === 0
            ? '선택된 거래처가 없어요 — 집계가 0으로 보입니다'
            : `${effective.size}곳 선택됨 · ${accounts.length - effective.size}곳 제외`}
      </div>
    </div>
  )
}
