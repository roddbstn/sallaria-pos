import { useState } from 'react'

// 주문 취소 — 사유를 고르는 모달.
//
// 전엔 "정말 취소할까요? [아니요][취소하기]" 두 버튼뿐이었다. 그런데 취소 사유는
// 손님 화면(sallaria.web.app · sunpos-kakao)에 그대로 뜬다 — 사유가 없으면 손님은
// "매장에서 사유를 남기지 않았어요"만 보고, 왜 취소됐는지 전화로 다시 물어야 한다.
//
// 데이터가 가는 길은 그대로다: cancel_order(p_note) → orders.note → 두 QR웹.
// 바뀌는 건 그 note 를 점주가 **고를 수 있게** 된 것뿐이다.
//
// 보기를 여섯 개로 끊은 이유: 피크타임에 읽고 고르는 데 1초가 넘으면 안 된다.
// 그래서 자주 쓰는 것부터, 직접 입력은 맨 아래 한 칸.

const REASONS = [
  '재료 소진',
  '영업 종료',
  '주문 폭주로 조리 불가',
  '손님 요청으로 취소',
  '중복 주문',
] as const

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

  const isCustom = picked === '__custom__'
  const reason   = isCustom ? custom.trim() : (picked ?? '')
  const canSubmit = reason.length > 0 && !busy

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[18px] shadow-[0_2px_10px_rgba(44,38,31,0.08)] w-[440px] px-[28px] pt-[24px] pb-[22px]"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-[18px] font-semibold text-[#1E1E1E]">주문을 취소할까요?</div>
        <div className="text-[13px] font-normal text-[#787878] mt-[4px] mb-[18px]">
          #{orderNumber} · 고른 사유는 손님 화면에 그대로 보여요
        </div>

        <div className="flex flex-wrap gap-[6px] mb-[14px]">
          {REASONS.map(r => (
            <button
              key={r}
              onClick={() => setPicked(r)}
              className={`pressable-tab px-[13px] h-[34px] rounded-[10px] text-[13px] transition-colors ${
                picked === r ? 'bg-[#6A635E] text-[#FCFCFC] font-medium' : 'bg-[#F2F2F2] text-[#787878]'
              }`}
            >
              {r}
            </button>
          ))}
          <button
            onClick={() => setPicked('__custom__')}
            className={`pressable-tab px-[13px] h-[34px] rounded-[10px] text-[13px] transition-colors ${
              isCustom ? 'bg-[#6A635E] text-[#FCFCFC] font-medium' : 'bg-[#F2F2F2] text-[#787878]'
            }`}
          >
            직접 입력
          </button>
        </div>

        {isCustom && (
          <div className="field-wrap flex items-center border border-[#D9D9D9] rounded-[10px] px-[14px] py-[11px] mb-[14px]">
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
        <div className="text-[12px] font-normal text-[#ADADAD] mb-[16px]">
          취소하면 결제 금액은 선결제 잔액으로 바로 돌아갑니다.
        </div>

        <div className="flex gap-[8px] justify-end">
          <button
            onClick={onClose}
            disabled={busy}
            className="pressable w-[86px] h-[42px] rounded-[10px] bg-[#E8E4E2] text-[#6A635E] text-[14px] font-medium hover:opacity-90 disabled:opacity-40"
          >
            닫기
          </button>
          <button
            onClick={() => canSubmit && onConfirm(reason)}
            disabled={!canSubmit}
            className="pressable w-[130px] h-[42px] rounded-[10px] bg-[#C92A2A] text-[#FCFCFC] text-[14px] font-medium hover:opacity-90 disabled:opacity-40"
          >
            {busy ? '취소 중…' : '주문 취소'}
          </button>
        </div>
      </div>
    </div>
  )
}
