import { useEffect, useState } from 'react'

// 설정 > 기타 > '진단 리포트 보내기' — 누르면 **바로 전송**되는 모달.
//
// 처음엔 클립보드 복사였는데, 그러면 점주가 복사한 걸 어딘가에 붙여넣어
// 따로 보내야 한다. 손이 두 번 더 가고, 어디로 보낼지도 애매하다.
// 지금은 Sentry 로 바로 올라간다 — 크래시는 이미 Sentry 가 자동으로 받고 있으니
// "크래시는 아닌데 이상하다"도 같은 곳으로 모으는 게 맞다.
//
// 그래도 **보내기 전에 내용을 보여준다.** 매장명·OS 가 들어가는 걸 모른 채
// 버튼만 누르게 하면 안 된다.
//
// 복사는 전송이 실패했을 때만 나타난다(오프라인 대비). 평소엔 숨겨서
// "복사? 보내기? 뭘 눌러야 하지"를 만들지 않는다.

export interface DiagnosticReport {
  /** 보낼 전문 — 화면에 보이는 것과 실제로 가는 것이 같아야 한다 */
  text: string
  /** 윗부분에 사람 말로 보여줄 요약 줄 */
  rows: { label: string; value: string }[]
}

type State = 'idle' | 'sending' | 'sent' | 'failed'

export default function DiagnosticReportModal({
  report, onSend, onClose,
}: {
  report: DiagnosticReport
  /** 전송하고 접수번호를 돌려준다. 실패하면 throw 하거나 null */
  onSend: () => Promise<string | null>
  onClose: () => void
}) {
  const [state,  setState]  = useState<State>('idle')
  const [ticket, setTicket] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function send() {
    setState('sending')
    try {
      const id = await onSend()
      setTicket(id ? id.slice(0, 8) : '')
      setState('sent')
    } catch {
      setState('failed')
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(report.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch { /* 복사까지 막히면 더 해줄 게 없다 */ }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[14px] shadow-[0_2px_10px_rgba(44,38,31,0.08)] w-[520px] max-w-[92vw] max-h-[84vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex-1 min-h-0 overflow-y-auto px-[28px] pt-[26px] pb-[20px]">
          <div className="text-[18px] font-semibold text-[#1E1E1E] mb-[6px]">진단 리포트 보내기</div>
          <div className="text-[13px] font-normal text-[#787878] leading-relaxed mb-[18px]">
            {state === 'sent'
              ? '잘 받았어요. 확인하고 연락드릴게요.'
              : '아래 내용이 선포스로 바로 전송돼요. 이걸 보내주시면 하나하나 여쭤보지 않고 원인을 찾을 수 있어요.'}
          </div>

          {state === 'sent' && (
            <div className="rounded-[11px] bg-green-soft px-[16px] py-[13px] mb-[16px]">
              <div className="text-[13px] font-medium text-[#017333]">
                보냈어요{ticket && <span className="font-normal"> · 접수번호 {ticket}</span>}
              </div>
              <div className="text-[11px] font-normal text-[#6A635E] mt-[3px]">
                문의하실 때 이 번호를 알려주시면 더 빨리 찾을 수 있어요
              </div>
            </div>
          )}

          {state === 'failed' && (
            <div className="rounded-[11px] bg-[#FFF0F0] px-[16px] py-[13px] mb-[16px]">
              <div className="text-[13px] font-medium text-danger">보내지 못했어요</div>
              <div className="text-[11px] font-normal text-[#6A635E] mt-[3px]">
                인터넷이 끊겼을 수 있어요. 아래 ‘내용 복사’로 받아서 직접 보내주셔도 돼요.
              </div>
            </div>
          )}

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
          <pre className="rounded-[11px] bg-[#F2F2F2] border border-[#E8E4E2] px-[14px] py-[12px] text-[11.5px] leading-[1.6] text-[#414141] whitespace-pre-wrap break-all font-mono max-h-[240px] overflow-y-auto">
            {report.text}
          </pre>
        </div>

        <div className="flex items-center gap-[8px] px-[28px] py-[18px] border-t border-[#E8E4E2]">
          {/* 복사는 전송이 실패했을 때만 — 평소엔 선택지를 하나로 둔다 */}
          {state === 'failed' && (
            <button
              onClick={copy}
              className="pressable h-[42px] px-[14px] rounded-[10px] bg-[#F2F2F2] text-[#1E1E1E] text-[13px] font-normal hover:bg-[#E8E4E2] transition-colors"
            >
              {copied ? '✓ 복사됨' : '내용 복사'}
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="pressable w-[86px] h-[42px] rounded-[10px] bg-[#E8E4E2] text-[#6A635E] text-[14px] font-medium hover:opacity-90"
          >
            {state === 'sent' ? '확인' : '닫기'}
          </button>
          {state !== 'sent' && (
            <button
              onClick={send}
              disabled={state === 'sending'}
              className="pressable w-[130px] h-[42px] rounded-[10px] bg-[#2C261F] text-[#FCFCFC] text-[14px] font-medium hover:opacity-90 disabled:opacity-40"
            >
              {state === 'sending' ? '보내는 중…' : state === 'failed' ? '다시 보내기' : '보내기'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
