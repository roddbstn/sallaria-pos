import SelectableCard from '../../../../components/auth/SelectableCard'
import PrimaryButton from '../../../../components/auth/PrimaryButton'
import type { StepProps } from '../types'

const PLANS: { id: StepProps['data']['plan']; name: string; price: number; desc: string }[] = [
  { id: 'free',  name: 'Free',  price: 0,     desc: '선결제 고객 1팀, 기간 제한 없음' },
  { id: 'basic', name: 'Basic', price: 7900,  desc: '선결제 고객 5팀까지' },
  { id: 'pro',   name: 'Pro',   price: 19900, desc: '선결제 고객 20팀까지 · 문자 자동발송' },
  { id: 'max',   name: 'Max',   price: 48900, desc: '고객 수 제한 없음 · 여러 매장 통합관리' },
]

interface PlanStepProps extends StepProps {
  submitting: boolean
  submitError: string
}

export default function PlanStep({ data, onChange, onNext, submitting, submitError }: PlanStepProps) {
  return (
    <div className="step-in flex flex-col" style={{ height: 396 }}>
      <div className="flex flex-col gap-2">
        {PLANS.map(plan => {
          const selected = data.plan === plan.id
          return (
            <SelectableCard key={plan.id} selected={selected} onClick={() => onChange({ plan: plan.id })} className="flex items-center justify-between px-4 py-3.5 text-left">
              <div>
                <div className="text-[15px] font-bold" style={{ color: 'var(--ink)' }}>{plan.name}</div>
                <div className="text-[12px] mt-0.5" style={{ color: 'var(--gray-text)' }}>{plan.desc}</div>
              </div>
              <div className="text-[14px] font-bold" style={{ color: 'var(--ink)', fontFamily: '"IBM Plex Mono",monospace' }}>
                {plan.price === 0 ? '무료' : `₩${plan.price.toLocaleString()}`}
              </div>
            </SelectableCard>
          )
        })}
      </div>

      {data.plan !== 'free' && (
        <p className="text-[11.5px] text-center mt-4 leading-relaxed" style={{ color: 'var(--gray-text)' }}>
          신청 즉시 1개월 무료체험이 시작돼요. 이후 이용 방법은 담당자가 별도로 연락드려요.
        </p>
      )}

      {submitError && (
        <p className="text-[12px] text-center mt-2" style={{ color: 'var(--danger)' }}>{submitError}</p>
      )}

      {/* mt-auto로 매장명 화면 버튼과 같은 높이(고정 396px 박스 하단)에 맞춤 */}
      <PrimaryButton onClick={onNext} disabled={submitting} className="w-full mt-auto">
        {submitting ? '저장하는 중...' : data.plan === 'free' ? '무료로 시작하기' : '신청하고 시작하기'}
      </PrimaryButton>
    </div>
  )
}
