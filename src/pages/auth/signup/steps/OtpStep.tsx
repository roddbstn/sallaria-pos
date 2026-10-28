import { useEffect, useState } from 'react'
import Working from '../../../../components/ui/Working'
import PhoneKeypad, { PHONE_KEYPAD_WIDTH } from '../../../../components/auth/PhoneKeypad'
import DigitDisplay from '../../../../components/auth/DigitDisplay'
import { supabase } from '../../../../lib/supabase'
import { useShake } from '../../../../hooks/useShake'
import { toE164 } from '../phone-format'
import type { StepProps } from '../types'

function formatMMSS(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

interface OtpStepProps extends StepProps {
  /** 인증번호 유효시간 잔여 초 — 0이면 만료. PhoneAuthFlow가 발송 시점 기준으로 공유 관리 */
  otpRemainingSec: number
  /** 재전송 성공 시(발송 시점 갱신용) 호출 */
  onSent: () => void
}

/** 전화번호 입력 화면과 동일한 밑줄 표시줄 + 키패드 디자인. 6자리 다 채우면 자동 검증(엔터 누른 것과 동일). */
export default function OtpStep({ data, onChange, onNext, otpRemainingSec, onSent }: OtpStepProps) {
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState('')
  const [shake, triggerShake] = useShake()

  const expired = otpRemainingSec <= 0

  useEffect(() => {
    if (data.otp.length === 6 && !verifying && !expired) {
      handleVerify()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.otp, expired])

  function addDigit(d: string) {
    if (data.otp.length >= 6) return
    setError('')
    onChange({ otp: data.otp + d })
  }
  function backspace() {
    setError('')
    onChange({ otp: data.otp.slice(0, -1) })
  }

  async function handleVerify() {
    setVerifying(true)
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      phone: toE164(data.phone),
      token: data.otp,
      type: 'sms',
    })
    setVerifying(false)
    if (verifyErr) {
      // Supabase 에러 메시지가 만료/무효를 한 문구로 합쳐 내려주는 경우가 있어
      // "expired" 포함 여부로만 구분 — 못 잡아내도 기존 문구로 자연스럽게 폴백됨
      const looksExpired = /expired/i.test(verifyErr.message)
      setError(looksExpired ? '인증번호가 만료됐어요. 다시 받아주세요' : '인증번호가 일치하지 않아요')
      triggerShake()
      return
    }
    onNext()
  }

  async function handleResend() {
    setResending(true)
    setError('')
    const { error: sendErr } = await supabase.auth.signInWithOtp({ phone: toE164(data.phone) })
    setResending(false)
    if (sendErr) {
      setError('재전송에 실패했어요. 잠시 후 다시 시도해주세요')
      triggerShake()
      return
    }
    onSent()
    onChange({ otp: '' })
  }

  const displayError = expired && !error ? '인증번호가 만료됐어요. 다시 받아주세요' : error

  return (
    <div className="step-in">
      <DigitDisplay
        value={data.otp}
        placeholder="인증번호 6자리"
        errorMessage={displayError}
        shake={shake}
        countdownText={otpRemainingSec > 0 ? formatMMSS(otpRemainingSec) : undefined}
        maxLength={6}
        onChangeValue={v => { setError(''); onChange({ otp: v }) }}
      />

      <PhoneKeypad onDigit={addDigit} onBackspace={backspace} />

      <div className="flex justify-end mt-8 mx-auto" style={{ maxWidth: PHONE_KEYPAD_WIDTH }}>
        <button
          onClick={handleResend}
          disabled={resending || verifying}
          className="px-4 py-2 rounded-lg text-[13px] transition-colors disabled:opacity-50"
          style={{ color: 'var(--gray-text)' }}
          onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = 'var(--gray-bg)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          {resending ? <Working label="재전송 중" /> : '인증번호 다시 받기'}
        </button>
      </div>
    </div>
  )
}
