import { useState, useId } from 'react'

interface FloatingLabelInputProps {
  value: string
  onChange: (v: string) => void
  placeholder: string
  type?: string
  maxLength?: number
  autoFocus?: boolean
  shake?: boolean
  error?: string
  onEnter?: () => void
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  /** false면 라벨이 떠오르지 않고 일반 placeholder처럼 입력 시작하면 그냥 사라짐 (기본 true) */
  floatingLabel?: boolean
}

/**
 * 토스 스타일 플로팅 라벨 인풋.
 * 비어있고 포커스 없을 땐 placeholder가 큰 글씨로 보이고,
 * 입력을 시작하거나 포커스되면 placeholder가 좌상단 작은 라벨로 떠오른다.
 * 밑줄만 있는 스타일 — 포커스 시 회색 → 웜그레이(#6A635E)로 전환.
 */
export default function FloatingLabelInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  maxLength,
  autoFocus,
  shake,
  error,
  onEnter,
  inputMode,
  floatingLabel = true,
}: FloatingLabelInputProps) {
  const [focused, setFocused] = useState(false)
  const id = useId()
  const floated = focused || value.length > 0

  return (
    <div className={`relative ${floatingLabel ? 'pt-5' : ''} ${shake ? 'shake-x' : ''}`}>
      {floatingLabel && (
        <label
          htmlFor={id}
          className="absolute left-0 transition-all duration-150 pointer-events-none"
          style={{
            top: floated ? 0 : 22,
            fontSize: floated ? 13 : 21,
            color: floated ? '#6A635E' : 'var(--gray-text)',
            fontWeight: floated ? 500 : 400,
          }}
        >
          {placeholder}
        </label>
      )}
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={floatingLabel ? undefined : placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={e => { if (e.key === 'Enter') onEnter?.() }}
        className="floating-input w-full bg-transparent outline-none py-2 text-[18px] text-ink"
        style={{
          borderBottom: `2px solid ${error ? 'var(--danger)' : focused ? '#6A635E' : 'var(--gray-border)'}`,
          transition: 'border-color 0.15s',
        }}
      />
      {error && (
        <p className="text-[12px] mt-1.5" style={{ color: 'var(--danger)' }}>{error}</p>
      )}
    </div>
  )
}
