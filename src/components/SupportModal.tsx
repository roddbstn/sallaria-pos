import { useEffect, useState } from 'react'
import Working from './ui/Working'
import { supabase } from '../lib/supabase'
import { getAppVersion } from '../lib/ipc'
import { useStore } from '../lib/store-context'

// 앱 안의 유일한 문의 입구.
//
// 전화번호·이메일·카카오 채널을 따로 열지 않는 이유: 1인 운영이라 입구가 늘어나는 만큼
// 놓칠 확률이 늘어난다. 입구는 하나로 두고, 대신 사장님이 설명하지 않아도 되도록
// 진단 정보를 자동으로 붙여 보낸다 — "안 돼요" 한 줄로도 원인을 좁힐 수 있게.
//
// 저장은 support_tickets. insert 하면 DB 트리거가 Edge Function을 거쳐 Slack으로 흘린다.
// (앱에서 직접 Slack을 부르지 않는다 — 보낸 직후 앱이 죽어도 티켓은 남아야 하므로)

const KINDS = [
  { key: 'printer',  label: '프린터·출력' },
  { key: 'order',    label: '주문·결제' },
  { key: 'account',  label: '거래처·잔액' },
  { key: 'idea',     label: '이런 기능이 있으면 좋겠어요' },
  { key: 'etc',      label: '기타' },
] as const
type Kind = typeof KINDS[number]['key']

export default function SupportModal({ onClose, showToast }: {
  onClose: () => void
  showToast: (msg: string) => void
}) {
  const { storeId, storeName } = useStore()
  const [kind, setKind] = useState<Kind>('printer')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !sending) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, sending])

  async function send() {
    if (!storeId) { showToast('매장 정보를 불러오지 못했어요. 다시 로그인해 주세요'); return }
    setSending(true)

    const kindLabel = KINDS.find(k => k.key === kind)?.label ?? kind
    // 버전은 하드코딩하지 않는다 — 메인 프로세스의 app.getVersion() 이 유일한 진실
    const appVersion = await getAppVersion()
    const { error } = await supabase.from('support_tickets').insert({
      store_id: storeId,
      source:   'help_request',
      summary:  `[${kindLabel}] ${body.trim().slice(0, 60) || '내용 없음'}`,
      payload: {
        kind,
        message:    body.trim(),
        storeName,
        appVersion,
        // 사장님이 따로 안 적어도 되게 — 기기 정보는 우리가 붙인다
        userAgent:  navigator.userAgent,
        screen:     `${window.innerWidth}x${window.innerHeight}`,
        sentAt:     new Date().toISOString(),
      },
    })
    setSending(false)
    if (error) { showToast(`보내지 못했어요: ${error.message}`); return }
    setDone(true)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={() => !sending && onClose()}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[18px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] w-[460px] max-w-[92vw] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {done ? (
          <>
            <div className="px-[28px] pt-[28px] pb-[22px]">
              <div className="text-[18px] font-semibold text-[#1E1E1E] mb-[6px]">보냈어요</div>
              <div className="text-[13px] font-normal text-[#787878] leading-relaxed">
                평일 10:00~18:00에 확인하고 보통 2시간 안에 답을 드려요.<br />
                급한 출력 문제면 설정 &gt; 프린터 연결의 <span className="text-[#6A635E]">프린터 연결 진단</span>도 같이 보내주시면 더 빨라요.
              </div>
            </div>
            <div className="px-[28px] py-[16px] flex justify-end modal-footer">
              <button onClick={onClose} className="h-[50px] px-[26px] rounded-[13px] bg-[#2C261F] text-[#F9F9F9] text-[16px] font-medium hover:opacity-90 transition-all">
                확인
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-[28px] pt-[28px] pb-[18px]">
              <div className="text-[18px] font-semibold text-[#1E1E1E] mb-[6px]">선포스에 의견 보내기</div>
              <div className="text-[13px] font-normal text-[#787878] leading-relaxed">
                불편한 점이나 바라는 기능을 적어주세요.
              </div>
            </div>

            <div className="px-[28px] pb-[22px]">
              <div className="flex flex-wrap gap-[6px] mb-[16px]">
                {KINDS.map(k => (
                  <button
                    key={k.key}
                    onClick={() => setKind(k.key)}
                    className={`h-[32px] px-[12px] rounded-[9px] text-[13px] transition-colors ${
                      kind === k.key ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>

              <textarea
                value={body}
                onChange={e => setBody(e.target.value.slice(0, 1000))}
                autoFocus
                rows={5}
                placeholder="예) 점심에 주문서가 가끔 안 나와요 / 주문 내역을 엑셀로 받고 싶어요"
                className="w-full border border-[#D9D9D9] rounded-[10px] px-[14px] py-[11px] text-[14px] text-[#1E1E1E] outline-none resize-none leading-relaxed"
              />
              <div className="flex justify-between items-center mt-[7px]">
                <span className="text-[11px] text-[#ADADAD]">평일 10:00~18:00 · 보통 2시간 안에 답변</span>
                <span className="text-[11px] text-[#ADADAD]">{body.length}/1000</span>
              </div>
            </div>

            <div className="px-[28px] py-[16px] flex justify-end gap-[10px] modal-footer">
              <button
                onClick={onClose}
                className="h-[50px] px-[26px] rounded-[13px] bg-[#E8E4E2] text-[#6A635E] text-[16px] font-medium hover:brightness-95 transition-all"
              >
                취소
              </button>
              <button
                onClick={send}
                disabled={sending || body.trim().length === 0}
                className="h-[50px] px-[26px] rounded-[13px] bg-[#2C261F] text-[#F9F9F9] text-[16px] font-medium hover:opacity-90 disabled:opacity-40 transition-all"
              >
                {sending ? <Working label="보내는 중" /> : '보내기'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
