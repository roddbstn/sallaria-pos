import { useEffect, useState } from 'react'

// 설정 > 기타 > '진단 리포트 복사' — 복사하기 전에 **무엇을 보내는지 보여주는** 모달.
//
// 전에는 누르면 그냥 클립보드에 복사되고 토스트만 떴다. 점주 입장에서는
// 뭐가 복사됐는지 모른 채 그걸 남에게 보내야 한다. 매장명·OS 같은 게 들어가니
// 보내기 전에 눈으로 확인할 수 있어야 한다.
//
// PrinterDiagnosticModal 과 같은 구조를 쓴다 — 설명 먼저, 내용 다음, CTA 마지막.
// 다른 점은 여기서는 **전문을 그대로** 보여준다는 것이다. 요약만 보여주면
// "그래서 뭐가 복사된 거지"가 그대로 남는다.

export interface DiagnosticReport {
  /** 복사될 전문 — 화면에 보이는 것과 클립보드로 가는 것이 같아야 한다 */
  text: string
  /** 윗부분에 사람 말로 보여줄 요약 줄 */
  rows: { label: string; value: string }[]
}

export default function DiagnosticReportModal({
  report, onClose,
}: {
  report: DiagnosticReport
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function copy() {
    try {
      await navigator.clipboard.writeText(report.text)
      setCopied(true); setFailed(false)
      // 모달을 바로 닫지 않는다 — "복사됨"을 본 뒤 직접 닫게 한다.
      // 자동으로 닫히면 복사가 됐는지 확신이 안 선다.
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[14px] shadow-[0_2px_10px_rgba(44,38,31,0.08)] w-[520px] max-w-[92vw] max-h-[84vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex-1 min-h-0 overflow-y-auto px-[28px] pt-[26px] pb-[20px]">
          <div className="text-[18px] font-semibold text-[#1E1E1E] mb-[6px]">진단 리포트</div>
          <div className="text-[13px] font-normal text-[#787878] leading-relaxed mb-[18px]">
            문제가 생겼을 때 아래 내용을 그대로 보내주세요.
            이걸 보내주시면 하나하나 여쭤보지 않고 바로 원인을 찾을 수 있어요.
          </div>

          {report.rows.length > 0 && (
            <div className="rounded-[11px] bg-[#F2F2F2] px-[18px] py-[6px] divide-y divide-[#E8E4E2] mb-[16px]">
              {report.rows.map(r => (
                <div key={r.label} className="flex items-center justify-between py-[10px]">
                  <span className="text-[13px] font-normal text-[#787878]">{r.label}</span>
                  <span className="text-[13px] font-medium text-[#1E1E1E] text-right ml-[16px] truncate max-w-[300px]">
                    {r.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="text-[12px] font-medium text-[#2C261F] mb-[7px]">보낼 내용 전문</div>
          {/* 고정폭 글꼴 — 줄 맞춤이 살아야 받는 쪽에서 읽기 쉽다 */}
          <pre className="rounded-[11px] bg-[#F2F2F2] border border-[#E8E4E2] px-[14px] py-[12px] text-[11.5px] leading-[1.6] text-[#414141] whitespace-pre-wrap break-all font-mono max-h-[260px] overflow-y-auto">
            {report.text}
          </pre>
        </div>

        <div className="flex gap-[8px] justify-end px-[28px] py-[18px] border-t border-[#E8E4E2]">
          <button
            onClick={onClose}
            className="pressable w-[86px] h-[42px] rounded-[10px] bg-[#E8E4E2] text-[#6A635E] text-[14px] font-medium hover:opacity-90"
          >
            닫기
          </button>
          <button
            onClick={copy}
            className="pressable w-[130px] h-[42px] rounded-[10px] bg-[#2C261F] text-[#FCFCFC] text-[14px] font-medium hover:opacity-90"
          >
            {failed ? '복사 실패' : copied ? '✓ 복사됨' : '복사하기'}
          </button>
        </div>
      </div>
    </div>
  )
}
