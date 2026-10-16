import PrimaryButton from '../../../../components/auth/PrimaryButton'
import type { StepProps } from '../types'

// TODO: 실제 업종 목록 확정 필요 — 지금은 선결제 식당 타겟 업종으로 임시 구성함
const BUSINESS_TYPES = ['한식·분식', '샐러드·포케', '샌드위치·베이커리', '카페·디저트', '치킨·버거', '기타']

export default function BusinessTypeStep({ data, onChange, onNext }: StepProps) {
  return (
    <div className="step-in flex flex-col" style={{ height: 396 }}>
      <div className="grid grid-cols-2 gap-2">
        {BUSINESS_TYPES.map(type => {
          const selected = data.businessType === type
          return (
            <button
              key={type}
              onClick={() => onChange({ businessType: selected ? '' : type })}
              className="py-3.5 text-[14px] font-semibold rounded-xl transition-colors"
              style={{ border: 'none', background: selected ? '#6A635E' : '#F2F2F2', color: selected ? '#FCFCFC' : '#787878' }}
            >
              {type}
            </button>
          )
        })}
      </div>

      {/* mt-auto로 매장명 화면 버튼과 같은 높이(고정 396px 박스 하단)에 맞춤 */}
      <div className="mt-auto">
        <p className="text-[12px] text-center mb-3" style={{ color: 'var(--gray-text)' }}>
          나중에 변경할 수 있어요
        </p>
        <PrimaryButton onClick={onNext} hidden={!data.businessType} className="w-full">
          확인
        </PrimaryButton>
      </div>
    </div>
  )
}
