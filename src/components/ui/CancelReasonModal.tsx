import { useState, useRef, useEffect } from 'react'
import Working from './Working'

// 주문 취소 — 사유를 고르는 모달. Figma 827:708(닫힘) · 494:895(펼침).
//
// 전엔 "정말 취소할까요? [아니요][취소하기]" 두 버튼뿐이었다. 그런데 취소 사유는
// 손님 화면(sallaria.web.app · sunpos-kakao)에 그대로 뜬다 — 사유가 없으면 손님은
// "매장에서 사유를 남기지 않았어요"만 보고, 왜 취소됐는지 전화로 다시 물어야 한다.
//
// 데이터가 가는 길은 그대로다: cancel_order(p_note) → orders.note → 두 QR웹.
//
// 칩 여러 개가 아니라 **드롭다운 하나**인 이유(Figma 결정):
// 칩은 모달 높이가 사유 개수만큼 늘어나고, 여섯 개가 두 줄로 흐르면 "어디까지가
// 선택지인지"가 한눈에 안 들어왔다. 드롭다운은 닫혀 있을 때 한 줄이라 모달이
// 늘 같은 크기고, 고른 값이 그 자리에 그대로 남아 확인이 된다.
//
// 치수는 Figma 원본 × FIGMA_SCALE(1440/2240 ≈ 0.643) 로 환산한 값이다.

const REASONS = [
  '재료 소진',
  '영업 종료',
  '주문 폭주로 조리 불가',
  '손님 요청으로 취소',
  '중복 주문',
  '직접 입력',
] as const

const CUSTOM = '직접 입력'

export default function CancelReasonModal({ orderNumber, onClose, onConfirm, busy }: {
  /** 머리말에 띄울 주문번호 — 여러 건이 쌓인 화면에서 "어느 주문"인지가 먼저다 */
  orderNumber: string
  onClose: () => void
  /** 고른 사유(또는 직접 입력)를 그대로 넘긴다 */
  onConfirm: (reason: string) => void
  busy: boolean
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const [open,   setOpen]   = useState(false)
  const selectRef = useRef<HTMLDivElement>(null)

  const isCustom  = picked === CUSTOM
  const reason    = isCustom ? custom.trim() : (picked ?? '')
  const canSubmit = reason.length > 0 && !busy

  // 목록 밖을 누르면 목록만 닫는다 — 모달까지 닫히면 고르던 걸 잃는다
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!selectRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="modal-in relative bg-[#FCFCFC] rounded-[19px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)]"
        style={{ width: 354 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: 19 }}>
          <div className="text-[21px] font-semibold text-black leading-none" style={{ marginTop: 7 }}>
            주문을 취소하시겠어요?
          </div>
          <div className="text-[12px] font-normal text-[#787878]" style={{ marginTop: 8 }}>
            #{orderNumber} · 고른 사유는 손님 화면에 그대로 보여요
          </div>

          {/* ── 사유 선택 ──
              열린 목록은 모달 안에서 아래로 밀지 않고 **위에 떠오른다**(absolute).
              밀어내면 모달 높이가 들썩이고 아래 버튼이 따라 움직여서, 고르는 중에
              '네' 버튼 위치가 바뀐다. Figma 도 같은 방식(494:895)이다. */}
          <div ref={selectRef} className="relative" style={{ marginTop: 17 }}>
            <button
              onClick={() => setOpen(v => !v)}
              className={`pressable-soft w-full flex items-center justify-between rounded-[10px] border bg-[#FCFCFC] text-left transition-colors ${
                open ? 'border-[#6A635E]' : 'border-[#ADADAD]'
              }`}
              style={{ height: 51, paddingLeft: 19, paddingRight: 17 }}
            >
              <span className={`text-[16px] truncate ${picked ? 'text-[#1E1E1E]' : 'text-[#787878]'}`}>
                {picked ?? '주문 취소 사유를 선택하세요'}
              </span>
              <svg
                width="14" height="9" viewBox="0 0 14 9" fill="none"
                className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
              >
                <path d="M1 1L7 7L13 1" stroke="#787878" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {open && (
              <div
                className="absolute left-0 right-0 z-10 rounded-[10px] border border-[#ADADAD] bg-[#FCFCFC] overflow-hidden shadow-[0px_4px_14px_rgba(0,0,0,0.10)]"
                style={{ top: 51 + 6 }}
              >
                {REASONS.map(r => (
                  <button
                    key={r}
                    onClick={() => { setPicked(r); setOpen(false) }}
                    className={`pressable-row w-full text-left flex items-center transition-colors ${
                      picked === r ? 'bg-[#F2F2F2]' : 'hover:bg-[#F9F9F9]'
                    }`}
                    style={{ height: 44, paddingLeft: 19, paddingRight: 19 }}
                  >
                    <span className="text-[15px] text-[#1E1E1E]">{r}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {isCustom && (
            <div
              className="field-wrap flex items-center border border-[#D9D9D9] rounded-[10px]"
              style={{ marginTop: 10, paddingLeft: 15, paddingRight: 15, height: 44 }}
            >
              <input
                value={custom}
                onChange={e => setCustom(e.target.value)}
                placeholder="손님에게 보일 문장을 적어주세요"
                maxLength={40}
                autoFocus
                className="field-bare flex-1 outline-none text-[14px] text-ink placeholder:text-[#ADADAD]"
              />
            </div>
          )}

          {/* 환원은 묻지 않고 늘 한다 — cancel_order 가 상태 변경과 함께 트랜잭션으로 묶는다.
              "취소했는데 돈이 안 돌아갔다"가 가장 나쁜 결과라 선택지로 두지 않는다. */}
          <div className="text-[12px] font-normal text-[#ADADAD]" style={{ marginTop: 14 }}>
            취소하면 결제 금액은 선결제 잔액으로 바로 돌아갑니다.
          </div>

          {/* 두 버튼이 같은 폭 — '네'를 크게 만들면 눌러야 할 버튼처럼 읽힌다.
              되돌릴 수 없는 결정에서 기본값은 '아니요' 쪽이어야 한다. */}
          <div className="flex" style={{ gap: 7, marginTop: 17 }}>
            <button
              onClick={onClose}
              disabled={busy}
              className="pressable flex-1 rounded-[13px] bg-[#E8E4E2] text-[#6A635E] text-[19px] font-semibold disabled:opacity-40"
              style={{ height: 57 }}
            >
              아니요
            </button>
            <button
              onClick={() => canSubmit && onConfirm(reason)}
              disabled={!canSubmit}
              className="pressable flex-1 rounded-[13px] bg-[#FFA8AC] text-[#F9F9F9] text-[19px] font-semibold disabled:opacity-40"
              style={{ height: 57 }}
            >
              {busy ? <Working label="취소 중" /> : '네'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
