import { useEffect, useState } from 'react'
import PhoneKeypad, { PHONE_KEYPAD_WIDTH } from '../../../../components/auth/PhoneKeypad'
import DigitDisplay from '../../../../components/auth/DigitDisplay'
import PrimaryButton from '../../../../components/auth/PrimaryButton'
import { supabase } from '../../../../lib/supabase'
import { toE164 } from '../phone-format'
import type { StepProps } from '../types'

function formatPhoneDisplay(digits: string): string {
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`
}

const TERMS = [
  '[필수] 서비스 이용약관 동의',
  '[필수] 개인정보 수집·이용 동의서',
]

interface PhoneStepProps extends StepProps {
  /** 발송 성공 시 호출 — OtpStep의 인증번호 유효시간 카운트다운 시작용 */
  onSent: () => void
}

/** 토스 스타일 숫자 키패드 기반 전화번호 입력 */
export default function PhoneStep({ data, onChange, onNext, onSent }: PhoneStepProps) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  // 최초 진입 시 010 미리 채워두기
  useEffect(() => {
    if (!data.phone) onChange({ phone: '010' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function addDigit(d: string) {
    if (data.phone.length >= 11) return
    setError('')
    onChange({ phone: data.phone + d })
  }
  function backspace() {
    setError('')
    onChange({ phone: data.phone.slice(0, -1) })
  }

  async function handleSend() {
    setSending(true)
    setError('')
    const { error: sendErr } = await supabase.auth.signInWithOtp({ phone: toE164(data.phone) })
    setSending(false)
    if (sendErr) {
      setError('인증번호 발송에 실패했어요. 번호를 확인하고 다시 시도해주세요.')
      return
    }
    onSent()
    onNext()
  }

  return (
    <div className="step-in">
      <DigitDisplay
        value={data.phone}
        placeholder="휴대폰 번호"
        format={formatPhoneDisplay}
        maxLength={11}
        onChangeValue={v => { setError(''); onChange({ phone: v }) }}
      />

      <PhoneKeypad onDigit={addDigit} onBackspace={backspace} />

      {/* 약관 동의 — 자동 체크 */}
      <div className="flex flex-col gap-1.5 mt-5 mx-auto" style={{ maxWidth: PHONE_KEYPAD_WIDTH }}>
        {TERMS.map(term => (
          <div key={term} className="flex items-center justify-between">
            <span className="text-[13px]" style={{ fontWeight: 300, color: 'var(--gray-text)' }}>{term}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--gray-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </div>
        ))}
      </div>

      {error && (
        <p className="text-[12px] text-center mt-3" style={{ color: 'var(--danger)' }}>{error}</p>
      )}

      <PrimaryButton
        onClick={handleSend}
        disabled={sending}
        hidden={data.phone.length < 10}
        className="block w-full mt-5 mx-auto"
        style={{ maxWidth: PHONE_KEYPAD_WIDTH }}
      >
        {sending ? '...' : '동의하고 보내기'}
      </PrimaryButton>
    </div>
  )
}
