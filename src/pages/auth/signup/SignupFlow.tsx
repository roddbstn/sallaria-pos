import { useState } from 'react'
import AuthShell from '../../../components/auth/AuthShell'
import { INITIAL_SIGNUP_DATA, type SignupData } from './types'

import PasswordStep from './steps/PasswordStep'
import StoreNameStep from './steps/StoreNameStep'
import SourceStep from './steps/SourceStep'
import OwnerNameStep from './steps/OwnerNameStep'
import AddressStep from './steps/AddressStep'
import BusinessTypeStep from './steps/BusinessTypeStep'
import CustomerTypeStep from './steps/CustomerTypeStep'
import PrinterSetupStep from './steps/PrinterSetupStep'
import PlanStep from './steps/PlanStep'

type Step = 'password' | 'storeName' | 'source' | 'ownerName' | 'address' | 'businessType' | 'customerType' | 'printerSetup' | 'plan'

const ORDER: Step[] = ['password', 'storeName', 'source', 'ownerName', 'address', 'businessType', 'customerType', 'printerSetup', 'plan']

// storeName/ownerName/address는 필드 플레이스홀더가 곧 제목과 같은 문구라
// 왼쪽 제목을 따로 안 두고 title을 생략한다(중복 방지)
const STEP_META: Record<Step, { title?: string; subtitle?: string }> = {
  password:     { title: '로그인에 쓸\n비밀번호를 설정해주세요' },
  storeName:    {},
  source:       { title: '선포스를 어떻게 알고\n설치하셨나요?' },
  ownerName:    {},
  address:      {},
  businessType: { title: '업종유형을\n선택해주세요' },
  customerType: { title: '선결제 고객유형을\n모두 선택해주세요', subtitle: '중복 선택 가능해요' },
  printerSetup: { title: '프린터를 연결하고\n주문을 받아보세요' },
  plan:         { title: '요금제를\n선택해주세요', subtitle: '언제든 바꿀 수 있어요' },
}

interface SignupFlowProps {
  /** 저장 실패 시 reject해야 함 — 실패하면 다음 화면(welcome)으로 안 넘어가고 에러만 보여줌 */
  onComplete: (data: SignupData) => Promise<void>
  /** 넘기면 첫 스텝(매장명)에서 "이전" 버튼이 보임. 안 넘기면 숨김 —
   *  전화인증 직후엔 돌아갈 화면이 없으므로 보통 생략함 */
  onCancel?: () => void
  initialData?: Partial<SignupData>
  /** 이미 비밀번호가 설정돼 있으면(= onboarding 재진입) password 스텝을 건너뛰고 storeName부터 시작.
   *  App.tsx가 clients/stores 프리필과 같은 시점에 확인해서 내려준다. */
  hasPassword: boolean
}

/** 회원가입 프로필 입력 — 매장명부터 요금제까지 7단계. 전화인증은 PhoneAuthFlow가 별도로 담당. */
export default function SignupFlow({ onComplete, onCancel, initialData, hasPassword }: SignupFlowProps) {
  const [step, setStep] = useState<Step>(hasPassword ? 'storeName' : 'password')
  const [data, setData] = useState<SignupData>({ ...INITIAL_SIGNUP_DATA, ...initialData })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function patch(p: Partial<SignupData>) {
    setData(prev => ({ ...prev, ...p }))
  }

  async function goNext() {
    const idx = ORDER.indexOf(step)
    if (idx === ORDER.length - 1) {
      setSubmitting(true)
      setSubmitError('')
      try {
        await onComplete(data)
      } catch {
        setSubmitError('저장에 실패했어요. 다시 시도해주세요')
      } finally {
        setSubmitting(false)
      }
      return
    }
    setStep(ORDER[idx + 1])
  }

  function goBack() {
    const idx = ORDER.indexOf(step)
    if (idx === 0) { onCancel?.(); return }
    setStep(ORDER[idx - 1])
  }

  const stepIdx = ORDER.indexOf(step)
  const canGoBack = stepIdx > 0 || !!onCancel
  const stepProps = { data, onChange: patch, onNext: goNext, onBack: goBack, submitting, submitError }
  const meta = STEP_META[step]
  // source(체크리스트형)만 기존 중앙정렬 유지, 나머지는 전화번호/인증번호 입력
  // 화면과 같은 높이(topAlign)에서 시작 — 확인 버튼은 각 스텝 내부에서
  // 큰 margin-top으로 아래쪽에 배치됨
  const topAlign = step !== 'source'

  return (
    <AuthShell title={meta.title} subtitle={meta.subtitle} onBack={canGoBack ? goBack : undefined} topAlign={topAlign}>
      {step === 'password'     && <PasswordStep {...stepProps} />}
      {step === 'storeName'    && <StoreNameStep {...stepProps} />}
      {step === 'source'       && <SourceStep {...stepProps} />}
      {step === 'ownerName'    && <OwnerNameStep {...stepProps} />}
      {step === 'address'      && <AddressStep {...stepProps} />}
      {step === 'businessType' && <BusinessTypeStep {...stepProps} />}
      {step === 'customerType' && <CustomerTypeStep {...stepProps} />}
      {step === 'printerSetup' && <PrinterSetupStep {...stepProps} />}
      {step === 'plan'         && <PlanStep {...stepProps} />}
    </AuthShell>
  )
}
