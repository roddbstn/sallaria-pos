import { useEffect } from 'react'
import Working from './Working'

// 되돌릴 수 없는 일을 하기 전에 한 번 묻는 공용 다이얼로그.
// Figma 491:1293.
//
// 전엔 삭제 확인이 모달마다 달랐다 — 어떤 데는 빨간 패널이 모달 안에서 펼쳐졌고,
// 어떤 데는 "정말 지울까요?" 한 줄에 작은 버튼 두 개였다. 같은 결정을 하는데
// 화면마다 모양이 다르면 점주는 매번 다시 읽어야 한다.
//
// 설계상 두 가지를 지킨다:
//  1) **제목이 질문이고, 대상 이름이 제목 안에 들어간다.** "삭제하시겠어요?"만 띄우면
//     무엇을 지우는지 모른 채 누르게 된다.
//  2) **무엇이 남는지를 부제로 말한다.** 카테고리 삭제의 '메뉴는 삭제되지 않아요'가
//     그것이다 — 점주가 가장 겁내는 게 메뉴가 같이 날아가는 일이다.

export default function ConfirmDialog({
  title, description, confirmLabel = '네', cancelLabel = '아니요',
  busy = false, tone = 'default', onConfirm, onCancel,
}: {
  /**
   * 질문 한 문장. 대상 이름을 포함시킨다.
   * `\n` 을 넣으면 그 자리에서 줄이 바뀐다(아래 whitespace-pre-line).
   */
  title:        string
  /** 무엇이 남는지 / 무엇이 사라지는지 */
  description?: string
  confirmLabel?: string
  cancelLabel?:  string
  busy?:         boolean
  /** 'danger' 면 확인 버튼이 빨강. 기본은 CTA 먹색(#2C261F) */
  tone?:        'default' | 'danger'
  onConfirm:    () => void
  onCancel:     () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, busy])

  return (
    // z-[90] — 이 다이얼로그는 늘 **다른 모달 위에** 뜬다(모달 안에서 삭제를 누르므로)
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40" onClick={() => !busy && onCancel()}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[16px] shadow-[0_2px_14px_rgba(44,38,31,0.12)] w-[440px] max-w-[92vw] px-[28px] pt-[32px] pb-[28px]"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-[19px] font-semibold text-[#1E1E1E] leading-[1.42] break-keep whitespace-pre-line">
          {title}
        </div>
        {description && (
          <div className="text-[13px] font-normal text-[#ADADAD] mt-[14px] leading-relaxed break-keep">
            {description}
          </div>
        )}

        {/* 둘 다 같은 폭 — '네'를 크게 만들면 눌러야 할 버튼처럼 읽힌다.
            지우는 결정에서 기본값은 '아니요' 쪽이어야 한다.
            글(질문·설명)과 행동(버튼) 사이는 글줄 간격보다 확실히 넓게 둔다 —
            붙어 있으면 설명을 다 읽기 전에 버튼으로 눈이 간다. */}
        <div className="flex gap-[10px] mt-[30px]">
          <button
            onClick={onCancel}
            disabled={busy}
            className="pressable flex-1 h-[50px] rounded-[12px] bg-[#E8E4E2] text-[#787878] text-[15px] font-medium disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`pressable flex-1 h-[50px] rounded-[12px] text-[#FCFCFC] text-[15px] font-medium disabled:opacity-40 ${
              tone === 'danger' ? 'bg-[#C92A2A]' : 'bg-[#2C261F]'
            }`}
          >
            {busy ? <Working label="처리 중" /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
