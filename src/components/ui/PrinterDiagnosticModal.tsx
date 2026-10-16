import { useEffect } from 'react'

// 프린터 연결 진단 — "안 돼요" 한 줄 대신 상태를 통째로 보내는 모달.
// 점주는 '진단'이 뭔지 모르므로, 무엇을 보내는지 사람 말로 먼저 보여주고 CTA를 누르게 한다.
//
// ⚠️ 지금은 보낼 곳이 없어 클립보드 복사까지만 한다. 받는 쪽(support_tickets 테이블 → Slack)
//    이 생기면 onSubmit 안만 바꾸면 된다.

export interface PrinterDiagnostic {
  storeName:  string
  connected:  boolean
  selected:   string
  ports:      { path: string; manufacturer?: string; friendlyName?: string }[]
  copies:     { kitchen: number; customer: number; qr: number }
  appVersion: string
}

/** 사람이 읽을 수 있는 한 줄 요약 — 모달에서도 보여주고 전송 본문에도 넣는다 */
function summarize(d: PrinterDiagnostic): string {
  if (d.connected) return '프린터는 연결돼 있어요'
  if (d.ports.length === 0) return '연결된 프린터를 찾지 못했어요'
  if (!d.selected) return '프린터는 찾았지만 아직 고르지 않았어요'
  return '프린터를 찾았지만 연결에 실패했어요'
}

export function buildDiagnosticText(d: PrinterDiagnostic): string {
  return [
    `[${d.storeName || '매장'} 프린터 진단]`,
    `시각      ${new Date().toLocaleString('ko-KR')}`,
    `요약      ${summarize(d)}`,
    `연결상태  ${d.connected ? '연결됨' : '끊김'}`,
    `선택포트  ${d.selected || '(없음)'}`,
    `찾은포트  ${d.ports.length}개`,
    ...d.ports.map(p => `  - ${p.path} | ${p.friendlyName ?? ''} | ${p.manufacturer ?? ''}`),
    `출력매수  주방 ${d.copies.kitchen} / 영수증 ${d.copies.customer} / QR ${d.copies.qr}`,
    `앱버전    ${d.appVersion}`,
    `OS        ${navigator.userAgent}`,
  ].join('\n')
}

export default function PrinterDiagnosticModal({
  diagnostic, onClose, onSubmit,
}: {
  diagnostic: PrinterDiagnostic
  onClose: () => void
  onSubmit: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const d = diagnostic
  const rows: { label: string; value: string }[] = [
    { label: '프린터 상태', value: d.connected ? '연결됨' : '끊김' },
    { label: '찾은 프린터', value: `${d.ports.length}개` },
    { label: '쓰고 있는 포트', value: d.selected || '없음' },
    { label: '출력 설정', value: `주방 ${d.copies.kitchen}장 · 영수증 ${d.copies.customer}장 · QR ${d.copies.qr}장` },
    { label: '앱 버전', value: d.appVersion },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[14px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] w-[460px] max-w-[92vw] max-h-[84vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex-1 min-h-0 overflow-y-auto px-[28px] pt-[28px] pb-[22px]">
          <div className="text-[18px] font-semibold text-[#1E1E1E] mb-[6px]">
            {d.storeName || '매장'} 프린터 진단
          </div>
          {/* '진단'이 뭔지 모르는 점주에게 먼저 설명 */}
          <div className="text-[13px] font-normal text-[#787878] leading-relaxed mb-[20px]">
            지금 이 포스의 프린터 상태를 모아둔 기록이에요.
            이걸 보내주시면 전화로 하나하나 여쭤보지 않고 바로 원인을 찾을 수 있어요.
          </div>

          <div className="rounded-[11px] bg-[#F2F2F2] px-[18px] py-[6px] divide-y divide-[#E8E4E2] mb-[16px]">
            {rows.map(r => (
              <div key={r.label} className="flex items-center justify-between py-[10px] gap-[14px]">
                <span className="text-[13px] font-normal text-[#787878] flex-shrink-0">{r.label}</span>
                <span className="text-[13px] text-[#1E1E1E] text-right truncate">{r.value}</span>
              </div>
            ))}
          </div>

          <div className="text-[11px] font-normal text-[#ADADAD] leading-relaxed">
            함께 보내는 것 · 윈도우 버전, 연결된 포트 목록, 최근 출력 실패 기록<br />
            주문 내용이나 고객 정보는 보내지 않아요.
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-[#E8E4E2] px-[28px] py-[16px] flex justify-end gap-[10px]">
          <button
            onClick={onClose}
            className="h-[42px] px-[18px] rounded-[10px] bg-[#F2F2F2] text-[#787878] text-[13px] font-medium hover:bg-[#E8E4E2] transition-colors"
          >
            닫기
          </button>
          <button
            onClick={onSubmit}
            className="h-[42px] px-[20px] rounded-[10px] bg-[#2C261F] text-[#F9F9F9] text-[13px] font-medium hover:opacity-90 transition-opacity"
          >
            프린터 연결 문의하기
          </button>
        </div>
      </div>
    </div>
  )
}
