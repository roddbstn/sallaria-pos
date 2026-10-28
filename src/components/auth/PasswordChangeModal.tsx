import { useEffect, useRef, useState } from 'react'
import Working from '../ui/Working'
import { supabase } from '../../lib/supabase'
import { PASSWORD_MIN_LEN } from '../../lib/auth-helpers'
import { toE164 } from '../../pages/auth/signup/phone-format'

// 계정 비밀번호 변경 — 매장 정보 > 대표자 정보에서 연다.
// 기존 QrPasswordSetupModal(휴대폰으로 QR 찍어 모바일 웹에서 진행)을 대체한다.
// 점주가 포스 앞에 앉아 있는데 휴대폰으로 QR을 찍게 하는 건 단계가 하나 더 많다.
// 여기서는 등록된 번호로 바로 SMS 6자리를 보내고, 인증되면 그 자리에서 새 비밀번호를 받는다.
//
// 보안: verifyOtp가 성공하면 해당 전화번호 소유자임이 증명되고 세션이 갱신된다.
// 그 세션으로 updateUser({ password })를 호출하므로 현재 비밀번호를 묻지 않아도 안전하다.

type Step = 'confirm' | 'otp' | 'password' | 'done'
const OTP_LEN = 6
const RESEND_SEC = 60

/** 010-1234-5678 → 010-****-5678 */
function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.length < 10) return phone
  const head = d.slice(0, 3)
  const tail = d.slice(-4)
  return `${head}-****-${tail}`
}

interface Props {
  /** 대표자 등록 전화번호 (clients.contact_phone) */
  phone: string
  onClose: () => void
  onDone: (message: string) => void
}

export default function PasswordChangeModal({ phone, onClose, onDone }: Props) {
  const [step,    setStep]    = useState<Step>('confirm')
  const [otp,     setOtp]     = useState('')
  const [pw,      setPw]      = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState('')
  const [cooldown, setCooldown] = useState(0)
  const otpRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  // 재전송 쿨다운 — 연타로 SMS 비용이 새는 걸 막는다
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  useEffect(() => { if (step === 'otp') otpRef.current?.focus() }, [step])

  async function sendOtp() {
    setBusy(true); setError('')
    const { error: err } = await supabase.auth.signInWithOtp({ phone: toE164(phone) })
    setBusy(false)
    if (err) { setError('인증번호 전송에 실패했어요. 잠시 후 다시 시도해주세요'); return }
    setOtp('')
    setCooldown(RESEND_SEC)
    setStep('otp')
  }

  async function verify() {
    setBusy(true); setError('')
    const { error: err } = await supabase.auth.verifyOtp({
      phone: toE164(phone), token: otp, type: 'sms',
    })
    setBusy(false)
    if (err) {
      setError(/expired/i.test(err.message) ? '인증번호가 만료됐어요. 다시 받아주세요' : '인증번호가 일치하지 않아요')
      return
    }
    setStep('password')
  }

  async function savePassword() {
    if (pw.length < PASSWORD_MIN_LEN) { setError(`비밀번호는 ${PASSWORD_MIN_LEN}자 이상이어야 해요`); return }
    if (pw !== pwConfirm)             { setError('비밀번호가 서로 달라요'); return }
    setBusy(true); setError('')
    const { error: err } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (err) { setError('비밀번호 변경에 실패했어요. 잠시 후 다시 시도해주세요'); return }
    setStep('done')
    onDone('비밀번호가 변경됐어요')
  }

  const inputCls = 'w-full h-[42px] border border-[#ADADAD] rounded-[9px] px-[14px] text-[14px] text-[#1E1E1E] outline-none focus:border-[#6A635E]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !busy && onClose()}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[16px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] w-[380px] max-w-[92vw] p-[26px]"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-[18px] font-semibold text-[#1E1E1E] mb-[6px]">계정 비밀번호 변경</div>

        {step === 'confirm' && (
          <>
            <div className="text-[13px] font-normal text-[#787878] leading-relaxed mb-[20px]">
              등록된 번호 <span className="text-[#1E1E1E]">{maskPhone(phone)}</span> 로
              인증번호 6자리를 보낼게요.
            </div>
            {error && <div className="text-[12px] text-danger mb-[12px]">{error}</div>}
            <div className="flex gap-[9px]">
              <button onClick={onClose} className="flex-1 h-[42px] rounded-[9px] bg-[#F2F2F2] text-[#787878] text-[13px] font-medium hover:bg-[#E8E4E2] transition-colors">
                취소
              </button>
              <button onClick={sendOtp} disabled={busy} className="flex-1 h-[42px] rounded-[9px] bg-[#6A635E] text-[#FCFCFC] text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
                {busy ? <Working label="전송 중" /> : '인증번호 받기'}
              </button>
            </div>
          </>
        )}

        {step === 'otp' && (
          <>
            <div className="text-[13px] font-normal text-[#787878] mb-[16px]">
              {maskPhone(phone)} 로 보낸 6자리를 입력해주세요
            </div>
            <input
              ref={otpRef}
              value={otp}
              onChange={e => { setOtp(e.target.value.replace(/\D/g, '').slice(0, OTP_LEN)); setError('') }}
              onKeyDown={e => { if (e.key === 'Enter' && otp.length === OTP_LEN) verify() }}
              inputMode="numeric"
              placeholder="000000"
              className={`${inputCls} text-center tracking-[8px] text-[18px]`}
            />
            <div className="flex items-center justify-between mt-[10px] mb-[20px]">
              {error
                ? <span className="text-[12px] text-danger">{error}</span>
                : <span className="text-[12px] text-[#ADADAD]">문자가 안 오면 스팸함도 확인해주세요</span>}
              <button
                onClick={sendOtp}
                disabled={busy || cooldown > 0}
                className="text-[12px] text-[#6A635E] font-medium disabled:text-[#ADADAD] flex-shrink-0 ml-[10px]"
              >
                {cooldown > 0 ? `재전송 ${cooldown}초` : '재전송'}
              </button>
            </div>
            <div className="flex gap-[9px]">
              <button onClick={onClose} className="flex-1 h-[42px] rounded-[9px] bg-[#F2F2F2] text-[#787878] text-[13px] font-medium hover:bg-[#E8E4E2] transition-colors">
                취소
              </button>
              <button onClick={verify} disabled={busy || otp.length !== OTP_LEN} className="flex-1 h-[42px] rounded-[9px] bg-[#6A635E] text-[#FCFCFC] text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
                {busy ? <Working label="확인 중" /> : '인증하기'}
              </button>
            </div>
          </>
        )}

        {step === 'password' && (
          <>
            <div className="text-[13px] font-normal text-[#787878] mb-[16px]">
              새 비밀번호를 입력해주세요 ({PASSWORD_MIN_LEN}자 이상)
            </div>
            <input
              type="password" value={pw} autoComplete="new-password"
              onChange={e => { setPw(e.target.value); setError('') }}
              placeholder="새 비밀번호"
              className={`${inputCls} mb-[9px]`}
            />
            <input
              type="password" value={pwConfirm} autoComplete="new-password"
              onChange={e => { setPwConfirm(e.target.value); setError('') }}
              onKeyDown={e => { if (e.key === 'Enter') savePassword() }}
              placeholder="새 비밀번호 확인"
              className={inputCls}
            />
            {error && <div className="text-[12px] text-danger mt-[10px]">{error}</div>}
            <div className="flex gap-[9px] mt-[20px]">
              <button onClick={onClose} className="flex-1 h-[42px] rounded-[9px] bg-[#F2F2F2] text-[#787878] text-[13px] font-medium hover:bg-[#E8E4E2] transition-colors">
                취소
              </button>
              <button onClick={savePassword} disabled={busy} className="flex-1 h-[42px] rounded-[9px] bg-[#6A635E] text-[#FCFCFC] text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
                {busy ? <Working label="저장 중" /> : '변경하기'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <div className="text-[13px] font-normal text-[#787878] mb-[20px]">
              비밀번호가 변경됐어요. 다음 로그인부터 새 비밀번호를 쓰면 돼요.
            </div>
            <button onClick={onClose} className="w-full h-[42px] rounded-[9px] bg-[#6A635E] text-[#FCFCFC] text-[13px] font-medium hover:opacity-90 transition-opacity">
              확인
            </button>
          </>
        )}
      </div>
    </div>
  )
}
