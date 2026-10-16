import PrimaryButton from '../../../../components/auth/PrimaryButton'
import FloatingLabelInput from '../../../../components/auth/FloatingLabelInput'
import type { StepProps } from '../types'

// value는 acquisition_sources.source의 DB CHECK 제약과 정확히 일치해야 함
const SOURCES: { label: string; value: string }[] = [
  { label: '네이버(스마트스토어) 검색',                  value: '네이버검색' },
  { label: '인스타그램 등 SNS 광고',                      value: 'SNS광고' },
  { label: '사장님 커뮤니티(카페·밴드·오픈채팅·블로그 등)', value: '커뮤니티' },
  { label: '지인 소개',                                  value: '지인소개' },
  { label: '대리점 직원의 안내',                          value: '대리점' },
]

export default function SourceStep({ data, onChange, onNext }: StepProps) {
  const hasSelection = data.sources.length > 0

  function toggle(value: string) {
    const next = data.sources.includes(value)
      ? data.sources.filter(s => s !== value)
      : [...data.sources, value]
    onChange({ sources: next })
  }

  return (
    <div className="step-in">
      <div className="flex flex-col gap-2 mb-3">
        {SOURCES.map(({ label, value }) => {
          const checked = data.sources.includes(value)
          return (
            <button
              key={value}
              onClick={() => toggle(value)}
              className="flex items-center gap-3 px-4 py-3 text-left text-[14px] rounded-xl"
              style={{ border: 'none', background: 'transparent' }}
            >
              <span
                className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center flex-shrink-0"
                style={{ border: `2px solid ${checked ? '#6A635E' : 'var(--gray-border)'}`, background: checked ? '#6A635E' : 'transparent' }}
              >
                {checked && (
                  <svg width="10" height="7" viewBox="0 0 10 7" fill="none">
                    <path d="M1 3.5L3.5 6L9 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span style={{ color: 'var(--ink)' }}>{label}</span>
            </button>
          )
        })}

        {/* 기타 — 체크박스 없이 매장명 입력과 동일한 밑줄 스타일 */}
        <div className="px-4 pt-1">
          <FloatingLabelInput
            value={data.sourceOther}
            onChange={v => onChange({ sourceOther: v })}
            placeholder="기타 (직접 입력)"
          />
        </div>
      </div>

      <PrimaryButton onClick={onNext} hidden={!hasSelection} className="w-full mt-4">
        확인
      </PrimaryButton>

      <div className="flex justify-end mt-4">
        <button
          onClick={onNext}
          className="px-6 py-3 rounded-lg text-[13px] transition-colors"
          style={{ color: 'var(--gray-text)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--gray-bg)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          건너뛰기
        </button>
      </div>
    </div>
  )
}
