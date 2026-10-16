import SelectableCard from '../../../../components/auth/SelectableCard'
import PrimaryButton from '../../../../components/auth/PrimaryButton'
import type { StepProps } from '../types'

const CUSTOMER_TYPES: { value: string; sub: string }[] = [
  { value: '관공서', sub: '구청, 세무서, 학교 부서 등' },
  { value: '기업',   sub: '회사, 사무실, 지점 등' },
  { value: '개인',   sub: '학부모, 동네 주민, 개인 등' },
]

export default function CustomerTypeStep({ data, onChange, onNext }: StepProps) {
  function toggle(type: string) {
    const next = data.customerTypes.includes(type)
      ? data.customerTypes.filter(t => t !== type)
      : [...data.customerTypes, type]
    onChange({ customerTypes: next })
  }

  return (
    <div className="step-in flex flex-col" style={{ height: 396 }}>
      <div className="flex flex-col gap-2">
        {CUSTOMER_TYPES.map(({ value, sub }) => {
          const checked = data.customerTypes.includes(value)
          return (
            <SelectableCard key={value} selected={checked} onClick={() => toggle(value)} className="flex items-center justify-between px-4 py-3.5 text-left">
              <div>
                <div className="text-[15px] font-bold" style={{ color: 'var(--ink)' }}>{value}</div>
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--gray-text)' }}>{sub}</div>
              </div>
              <span
                className="w-[20px] h-[20px] rounded-full flex items-center justify-center flex-shrink-0"
                style={{ border: `2px solid ${checked ? '#6A635E' : 'var(--gray-border)'}`, background: checked ? '#6A635E' : 'transparent' }}
              >
                {checked && (
                  <svg width="11" height="8" viewBox="0 0 10 7" fill="none">
                    <path d="M1 3.5L3.5 6L9 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
            </SelectableCard>
          )
        })}
      </div>

      {/* mt-auto로 매장명 화면 버튼과 같은 높이(고정 396px 박스 하단)에 맞춤 */}
      <PrimaryButton onClick={onNext} hidden={data.customerTypes.length === 0} className="w-full mt-auto">
        확인
      </PrimaryButton>
    </div>
  )
}
