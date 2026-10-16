import { useEffect, useState } from 'react'
import AuthShell from '../../../components/auth/AuthShell'
import { INITIAL_SIGNUP_DATA, type SignupData } from './types'
import PhoneStep from './steps/PhoneStep'
import OtpStep from './steps/OtpStep'

type Step = 'phone' | 'otp'

// 인증번호 유효시간(초). 발송(최초/재전송) 성공 시점부터 카운트다운 — OtpStep
// 텍스트필드 안의 MM:SS 표시와 만료 판정에 그대로 쓰인다.
// Supabase 대시보드의 SMS OTP Expiry 설정값과 맞춰둘 것.
const OTP_VALID_SEC = 5 * 60

interface PhoneAuthFlowProps {
  onCancel: () => void
  /** OTP 검증 성공 시 호출 — 이후 화면 전환은 App.tsx의 onAuthStateChange가 세션 감지해서 알아서 처리함 */
  onVerified: () => void
}

/**
 * 회원가입/로그인의 전화인증 단계만 담당 (phone → OTP).
 * 인증 성공 후 매장정보 입력은 SignupFlow(phase='onboarding')가 별도로 이어받는다 —
 * 두 흐름을 한 컴포넌트에 합쳐뒀다가 verifyOtp 직후 phase가 즉시 바뀌면서 화면이
 * 튕기는 문제가 있어서 분리함.
 */
export default function PhoneAuthFlow({ onCancel, onVerified }: PhoneAuthFlowProps) {
  const [step, setStep] = useState<Step>('phone')
  const [data, setData] = useState<SignupData>(INITIAL_SIGNUP_DATA)

  // 인증번호 유효시간 — phone/otp 화면을 오가도(이전 버튼으로 되돌아가도) 유지되도록
  // 스텝 로컬state가 아니라 여기서 관리한다.
  const [otpValidUntil, setOtpValidUntil] = useState<number | null>(null)
  const [otpRemainingSec, setOtpRemainingSec] = useState(0)

  useEffect(() => {
    if (!otpValidUntil) { setOtpRemainingSec(0); return }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((otpValidUntil - Date.now()) / 1000))
      setOtpRemainingSec(remaining)
      if (remaining <= 0) setOtpValidUntil(null)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [otpValidUntil])

  function handleSent() {
    setOtpValidUntil(Date.now() + OTP_VALID_SEC * 1000)
  }

  function patch(p: Partial<SignupData>) {
    setData(prev => ({ ...prev, ...p }))
  }

  function goNext() {
    if (step === 'phone') { setStep('otp'); return }
    onVerified()
  }

  function goBack() {
    if (step === 'phone') { onCancel(); return }
    setStep('phone')
  }

  const stepProps = { data, onChange: patch, onNext: goNext, onBack: goBack, otpRemainingSec, onSent: handleSent }
  const title = step === 'phone'
    ? '휴대폰번호 입력하고\n바로 시작하세요'
    : '인증번호를\n입력해주세요'

  return (
    <AuthShell title={title} onBack={goBack} topAlign={step === 'phone'}>
      {step === 'phone' && <PhoneStep {...stepProps} />}
      {step === 'otp'   && <OtpStep {...stepProps} />}
    </AuthShell>
  )
}
