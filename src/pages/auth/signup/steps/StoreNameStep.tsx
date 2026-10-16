import FloatingLabelInput from '../../../../components/auth/FloatingLabelInput'
import PrimaryButton from '../../../../components/auth/PrimaryButton'
import { useShake } from '../../../../hooks/useShake'
import type { StepProps } from '../types'

const MAX_LEN = 50

export default function StoreNameStep({ data, onChange, onNext }: StepProps) {
  const [shake, triggerShake] = useShake(350)

  function handleChange(v: string) {
    if (v.length > MAX_LEN) {
      triggerShake()
      return // 31번째 글자는 반영하지 않음
    }
    onChange({ storeName: v })
  }

  return (
    <div className="step-in">
      <FloatingLabelInput
        value={data.storeName}
        onChange={handleChange}
        placeholder="매장명을 알려주세요"
        maxLength={MAX_LEN + 1}
        autoFocus
        shake={shake}
        onEnter={onNext}
      />

      <PrimaryButton onClick={onNext} hidden={data.storeName.trim().length === 0} className="w-full mt-[280px]">
        확인
      </PrimaryButton>
    </div>
  )
}
