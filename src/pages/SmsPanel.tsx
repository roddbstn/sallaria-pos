import { useState, useEffect } from 'react'
import { HubSection } from '../components/hub/HubLayout'
import { supabase, type DbAccount } from '../lib/supabase'
import { useStore } from '../lib/store-context'
import { won } from '../lib/ipc'
import { maskName, maskPhone } from '../lib/mask'
import { SMS_TEMPLATES, fillTemplate, smsByteLength, SMS_BYTE_LIMIT, type SmsKind } from '../lib/sms-templates'

// ── 문자 보내기 ─────────────────────────────────────────────────────────────
//
// 문자는 건당 비용이 나가고 되돌릴 수 없다. 그래서 이 화면은 "자유롭게 보내는 곳"이 아니라
// **보낼 이유가 분명한 세 상황만 여는 곳**이다:
//   1) 관리자 등록이 안 끝난 곳 — QR은 줬는데 주문을 못 받는 상태
//   2) 잔액이 0원 아래인 곳   — 다음 충전 때 정산된다는 안내
//   3) 한참 주문이 없는 곳     — 잔액이 남아 있는데 잊고 계신 경우
//
// 대상은 점주가 고르는 게 아니라 **상황이 정한다**. 상황을 고르면 해당하는 거래처만 추려지고,
// 점주는 그중에서 빼기만 할 수 있다. "전체 선택 + 빈 입력창"을 주면 쓰기 쉬운 만큼
// 잘못 쓰기도 쉬워진다.

const IDLE_DAYS = 60

interface Target {
  code:    string
  name:    string
  manager: string
  phone:   string | null
  balance: number
  /** 마지막 주문 이후 지난 일수 — null 이면 주문 이력 없음 */
  idleDays: number | null
  adminPending: boolean
}

interface SentLog {
  id:           string
  kind:         SmsKind
  body:         string
  sent_count:   number
  failed_count: number
  created_at:   string
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

export default function SmsPanel() {
  const { storeId, storeName } = useStore()
  const [targets, setTargets] = useState<Target[]>([])
  const [logs,    setLogs]    = useState<SentLog[]>([])
  const [loading, setLoading] = useState(true)
  const [kind,    setKind]    = useState<SmsKind>('admin_pending')
  const [draft,   setDraft]   = useState(SMS_TEMPLATES[0].draft)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const [result,  setResult]  = useState('')

  const template = SMS_TEMPLATES.find(t => t.kind === kind)!

  useEffect(() => {
    if (!storeId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const { data: accRows } = await supabase
        .from('accounts')
        .select('account_code, account_name, contact_person, contact_phone, current_balance, qr_system')
        .eq('store_id', storeId).eq('is_active', true)
        .order('account_name')
      const accounts = (accRows ?? []) as DbAccount[]
      const codes = accounts.map(a => a.account_code)

      if (codes.length === 0) {
        if (!cancelled) { setTargets([]); setLoading(false) }
        return
      }

      const [{ data: orders }, { data: admins }, { data: sent }] = await Promise.all([
        supabase.from('orders').select('account_code, ordered_at, status').in('account_code', codes),
        supabase.from('user_account_links')
          .select('account_code').eq('role', '관리자').eq('status', 'approved').in('account_code', codes),
        supabase.from('sms_logs')
          .select('id, kind, body, sent_count, failed_count, created_at')
          .eq('store_id', storeId).order('created_at', { ascending: false }).limit(20),
      ])

      const lastOrder = new Map<string, string>()
      for (const o of (orders ?? []) as { account_code: string; ordered_at: string; status: string }[]) {
        if (o.status === '취소') continue
        const prev = lastOrder.get(o.account_code)
        if (!prev || o.ordered_at > prev) lastOrder.set(o.account_code, o.ordered_at)
      }
      const registered = new Set((admins ?? []).map((r: { account_code: string }) => r.account_code))

      if (cancelled) return
      setTargets(accounts.map(a => ({
        code:    a.account_code,
        name:    a.account_name,
        manager: a.contact_person ?? '',
        phone:   a.contact_phone,
        balance: a.current_balance,
        idleDays: daysSince(lastOrder.get(a.account_code) ?? null),
        adminPending: a.qr_system === 'kakao' && !registered.has(a.account_code),
      })))
      setLogs((sent ?? []) as SentLog[])
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [storeId])

  // 상황이 대상을 정한다 — 점주는 여기서 빼기만 할 수 있다
  const matched = targets.filter(t => {
    if (kind === 'admin_pending')    return t.adminPending
    if (kind === 'negative_balance') return t.balance < 0
    return t.idleDays == null || t.idleDays >= IDLE_DAYS
  })
  const sendable = matched.filter(t => t.phone && !excluded.has(t.code))
  const noPhone  = matched.filter(t => !t.phone)

  // 미리보기는 첫 대상 기준 — 거래처명·잔액이 치환된 실제 문구를 보여준다
  const sample = sendable[0] ?? matched[0]
  const preview = fillTemplate(draft, {
    store:   storeName,
    account: sample?.name ?? '거래처',
    balance: sample ? won(sample.balance) : '0원',
  })
  const bytes = smsByteLength(preview)
  const isLms = bytes > SMS_BYTE_LIMIT

  function pickKind(next: SmsKind) {
    setKind(next)
    setDraft(SMS_TEMPLATES.find(t => t.kind === next)!.draft)
    setExcluded(new Set())
    setResult('')
  }

  function toggleExclude(code: string) {
    setExcluded(prev => {
      const n = new Set(prev)
      if (n.has(code)) n.delete(code); else n.add(code)
      return n
    })
  }

  async function send() {
    setSending(true)
    setConfirm(false)
    let ok = 0
    let failed = 0
    let lastError = ''

    for (const t of sendable) {
      const text = fillTemplate(draft, {
        store: storeName, account: t.name, balance: won(t.balance),
      })
      try {
        const { error } = await supabase.functions.invoke('send-notification', {
          body: { purpose: 'custom', phone: t.phone, params: { text } },
        })
        if (error) throw error
        ok += 1
      } catch (e) {
        failed += 1
        lastError = (e as Error).message ?? '발송 실패'
      }
    }

    // 성공이든 실패든 남긴다 — "보냈나 안 보냈나"를 기억에 맡기면 두 번 보내게 된다
    await supabase.from('sms_logs').insert({
      store_id:     storeId,
      kind,
      body:         draft,
      recipients:   sendable.map(t => ({ account_code: t.code, account_name: t.name, phone: t.phone })),
      sent_count:   ok,
      failed_count: failed,
      error:        failed > 0 ? lastError : null,
    })

    const { data: sent } = await supabase.from('sms_logs')
      .select('id, kind, body, sent_count, failed_count, created_at')
      .eq('store_id', storeId).order('created_at', { ascending: false }).limit(20)
    setLogs((sent ?? []) as SentLog[])

    setSending(false)
    setResult(failed === 0 ? `${ok}명에게 보냈어요` : `${ok}명 성공 · ${failed}명 실패`)
  }

  return (
    <div>
      <HubSection title="문자 보내기" />

      {loading ? (
        <div className="py-[56px] text-center text-[13px] font-normal text-[#787878]">불러오는 중…</div>
      ) : (
        <>
          {/* 어떤 상황인가 — 이게 대상을 정한다 */}
          <div className="mb-[8px] text-[12px] font-medium text-[#2C261F]">어떤 상황인가요?</div>
          <div className="flex gap-[8px] mb-[8px]">
            {SMS_TEMPLATES.map(t => {
              const count = targets.filter(x =>
                t.kind === 'admin_pending' ? x.adminPending
                : t.kind === 'negative_balance' ? x.balance < 0
                : (x.idleDays == null || x.idleDays >= IDLE_DAYS)).length
              return (
                <button
                  key={t.kind}
                  onClick={() => pickKind(t.kind)}
                  className={`h-[32px] px-[12px] rounded-[9px] text-[13px] font-normal transition-colors ${
                    kind === t.kind ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
                  }`}
                >
                  {t.label} {count}곳
                </button>
              )
            })}
          </div>
          <div className="mb-[22px] text-[11px] font-normal text-[#ADADAD]">{template.why}</div>

          <div className="flex gap-[36px]">
            {/* 좌: 문구 */}
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium text-[#2C261F] mb-[8px]">보낼 문구</div>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value.slice(0, 300))}
                rows={4}
                className="field-soft w-full rounded-[9px] border border-[#D9D9D9] px-[13px] py-[11px] text-[13px] text-[#1E1E1E] outline-none resize-none leading-relaxed"
              />
              <div className="mt-[6px] text-[11px] font-normal text-[#ADADAD]">
                {'{매장} {거래처} {잔액}'} 은 보낼 때 실제 값으로 바뀝니다
              </div>

              <div className="mt-[14px] text-[12px] font-medium text-[#2C261F] mb-[8px]">미리보기</div>
              <div className="rounded-[9px] bg-[#F2F2F2] px-[13px] py-[11px] text-[13px] text-[#1E1E1E] leading-relaxed whitespace-pre-wrap">
                {preview}
              </div>
              <div className={`mt-[6px] text-[11px] font-normal ${isLms ? 'text-danger' : 'text-[#ADADAD]'}`}>
                {bytes}바이트 · {isLms ? 'LMS (단가가 올라가요)' : 'SMS'}
              </div>
            </div>

            {/* 우: 받는 사람 */}
            <div className="flex-shrink-0" style={{ width: 300 }}>
              <div className="text-[12px] font-medium text-[#2C261F] mb-[8px]">
                받는 사람 ({sendable.length}명)
              </div>
              <div className="rounded-[9px] bg-[#F2F2F2] p-[10px] max-h-[260px] overflow-y-auto flex flex-col gap-[6px]">
                {matched.length === 0 ? (
                  <div className="py-[26px] text-center text-[12px] font-normal text-[#ADADAD]">
                    해당하는 거래처가 없어요
                  </div>
                ) : matched.map(t => {
                  const off = excluded.has(t.code) || !t.phone
                  return (
                    <div
                      key={t.code}
                      className={`flex items-center gap-[8px] bg-[#FCFCFC] rounded-[7px] px-[10px] py-[8px] ${off ? 'opacity-50' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={!off}
                        disabled={!t.phone}
                        onChange={() => toggleExclude(t.code)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] text-[#1E1E1E] truncate">{t.name}</div>
                        <div className="text-[11px] text-[#787878]">
                          {t.manager ? maskName(t.manager) : '관리자 없음'}
                          {t.phone ? ` · ${maskPhone(t.phone)}` : ' · 연락처 없음'}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {noPhone.length > 0 && (
                <div className="mt-[7px] text-[11px] font-normal text-danger">
                  {noPhone.length}곳은 연락처가 없어 보낼 수 없어요. 고객 현황에서 등록해 주세요
                </div>
              )}

              <button
                onClick={() => setConfirm(true)}
                disabled={sendable.length === 0 || sending || !draft.trim()}
                className="mt-[14px] w-full h-[44px] rounded-[10px] bg-[#2C261F] text-[#F9F9F9] text-[14px] font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {sending ? '보내는 중…' : `${sendable.length}명에게 보내기`}
              </button>
              {result && (
                <div className="mt-[8px] text-[12px] font-normal text-[#017333] text-center">{result}</div>
              )}
            </div>
          </div>

          {/* 발송 이력 — 문자는 되돌릴 수 없으니 뭘 언제 보냈는지가 남아야 한다 */}
          <div className="mt-[30px]">
            <div className="text-[12px] font-medium text-[#2C261F] mb-[8px]">최근 발송</div>
            {logs.length === 0 ? (
              <div className="py-[20px] text-center text-[12px] font-normal text-[#ADADAD]">보낸 문자가 없어요</div>
            ) : (
              <div className="flex flex-col gap-[6px]">
                {logs.map(l => {
                  const t = SMS_TEMPLATES.find(x => x.kind === l.kind)
                  const d = new Date(l.created_at)
                  return (
                    <div key={l.id} className="flex items-center gap-[10px] bg-[#F2F2F2] rounded-[8px] px-[13px] py-[9px]">
                      <span className="text-[11px] text-[#787878] flex-shrink-0 w-[92px]">
                        {`${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`}
                      </span>
                      <span className="text-[12px] text-[#1E1E1E] flex-shrink-0 w-[110px]">{t?.label ?? l.kind}</span>
                      <span className="text-[11px] text-[#787878] flex-1 min-w-0 truncate">{l.body}</span>
                      <span className={`text-[11px] flex-shrink-0 ${l.failed_count > 0 ? 'text-danger' : 'text-[#787878]'}`}>
                        {l.sent_count}명{l.failed_count > 0 ? ` · 실패 ${l.failed_count}` : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* 보내기 확인 — 돈이 나가고 되돌릴 수 없으므로 한 단계 둔다 */}
      {confirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={() => setConfirm(false)}>
          <div className="modal-in bg-[#FCFCFC] rounded-[14px] shadow-xl w-[420px] px-[28px] pt-[24px] pb-[22px]" onClick={e => e.stopPropagation()}>
            <div className="text-[18px] font-semibold text-[#1E1E1E] mb-[8px]">
              {sendable.length}명에게 문자를 보낼까요?
            </div>
            <div className="text-[13px] font-normal text-[#787878] leading-relaxed mb-[16px]">
              {template.label} · 건당 요금이 발생하고 취소할 수 없어요.
            </div>
            <div className="rounded-[9px] bg-[#F2F2F2] px-[13px] py-[11px] text-[12px] text-[#1E1E1E] leading-relaxed whitespace-pre-wrap mb-[20px]">
              {preview}
            </div>
            <div className="flex justify-end gap-[8px]">
              <button
                onClick={() => setConfirm(false)}
                className="h-[44px] px-[20px] rounded-[10px] bg-[#E8E4E2] text-[#6A635E] text-[14px] font-medium hover:brightness-95 transition-all"
              >
                취소
              </button>
              <button
                onClick={send}
                className="h-[44px] px-[20px] rounded-[10px] bg-[#2C261F] text-[#F9F9F9] text-[14px] font-medium hover:opacity-90 transition-opacity"
              >
                보내기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
