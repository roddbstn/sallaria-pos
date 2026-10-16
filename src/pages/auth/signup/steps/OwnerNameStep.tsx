import FloatingLabelInput from '../../../../components/auth/FloatingLabelInput'
import PrimaryButton from '../../../../components/auth/PrimaryButton'
import { useShake } from '../../../../hooks/useShake'
import type { StepProps } from '../types'

const MAX_LEN = 50

export default function OwnerNameStep({ data, onChange, onNext }: StepProps) {
  const [shake, triggerShake] = useShake(350)

  function handleChange(v: string) {
    if (v.length > MAX_LEN) {
      triggerShake()
      return
    }
    onChange({ ownerName: v })
  }

  return (
    <div className="step-in">
      <FloatingLabelInput
        value={data.ownerName}
        onChange={handleChange}
        placeholder="대표자명을 알려주세요"
        maxLength={MAX_LEN + 1}
        autoFocus
        shake={shake}
        onEnter={onNext}
      />

      <PrimaryButton onClick={onNext} hidden={data.ownerName.trim().length === 0} className="w-full mt-[280px]">
        확인
      </PrimaryButton>
    </div>
  )
}
