import { useEffect, useRef, useState } from 'react'

// 금액류 필드 표시용 — "1000" → "1,000원". 빈 값이면 빈 문자열(플레이스홀더 유지)
export function formatPriceDisplay(v: string): string {
  if (!v) return ''
  return Number(v).toLocaleString('ko-KR') + '원'
}

interface FloatingCellInputProps {
  value: string
  onChange: (v: string) => void
  label: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  autoFocus?: boolean
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  focusColor?: string
  /** 표시 전용 포맷(예: 금액에 콤마+"원"). onChange로는 항상 순수 입력값이 그대로 올라감 */
  format?: (v: string) => string
  maxLength?: number
  /** font-mono 등 값 텍스트에만 추가로 얹을 클래스(라벨엔 영향 없음) */
  inputClassName?: string
  /** maxLength와 함께 쓰면 우측 하단에 "n/max" 글자수 카운터 표시 (limit 도달 시 danger 색) */
  showCount?: boolean
}

/** 모달 내 텍스트필드 공용 — 밑줄+플로팅 라벨(빈 상태엔 큰 플레이스홀더, 포커스/입력 시 위로 작게 뜸) */
export function FloatingCellInput({
  value, onChange, label, onKeyDown, autoFocus, inputMode, focusColor = '#00DD67', format, maxLength, inputClassName = '', showCount = false,
}: FloatingCellInputProps) {
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const floated = focused || value.length > 0
  const displayValue = format ? format(value) : value

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const el = e.target
    const cursorPos = el.selectionStart ?? el.value.length
    const digitsBeforeCursor = el.value.slice(0, cursorPos).replace(/[^0-9]/g, '').length
    onChange(e.target.value)
    if (!format) return
    // 콤마/"원" 붙는 걸로 커서가 안 튀도록, 커서 앞 숫자 개수를 기준으로 재계산해서 복원
    requestAnimationFrame(() => {
      if (!inputRef.current) return
      const formatted = format(e.target.value.replace(/[^0-9]/g, ''))
      let seen = 0, pos = formatted.length
      for (let i = 0; i < formatted.length; i++) {
        if (/[0-9]/.test(formatted[i])) seen++
        if (seen === digitsBeforeCursor) { pos = i + 1; break }
      }
      inputRef.current.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="relative pt-2">
      <input
        ref={inputRef}
        type="text"
        inputMode={inputMode}
        value={displayValue}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        maxLength={maxLength}
        placeholder=" "
        className={`floating-input w-full bg-transparent border-b border-[#ADADAD] pb-1.5 text-[13px] font-normal text-ink outline-none transition-colors ${inputClassName}`}
        onFocus={e => { setFocused(true); e.currentTarget.style.borderColor = focusColor }}
        onBlur={e => { setFocused(false); e.currentTarget.style.borderColor = '' }}
      />
      <label
        className="absolute left-0 leading-none pointer-events-none transition-all duration-150"
        style={{
          top:        floated ? 0 : 8,
          fontSize:   floated ? 9 : 13,
          fontWeight: floated ? 500 : 400,
          color:      'var(--gray-text)',
          opacity:    0.85,
        }}
      >
        {label}
      </label>
      {showCount && maxLength !== undefined && (
        <span className={`absolute right-0 bottom-1.5 text-[10px] ${value.length >= maxLength ? 'text-danger' : 'text-gray-text'}`}>
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  )
}

interface FloatingCellTextareaProps {
  value: string
  onChange: (v: string) => void
  label: string
  focusColor?: string
}

/** 여러 줄 입력용 플로팅 라벨 — FloatingCellInput과 같은 인터랙션이되 textarea 전용 */
export function FloatingCellTextarea({
  value, onChange, label, focusColor = '#00DD67',
}: FloatingCellTextareaProps) {
  const [focused, setFocused] = useState(false)
  const floated = focused || value.length > 0
  return (
    <div className="relative pt-2">
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={2}
        placeholder=" "
        className="floating-input w-full bg-transparent border-b border-[#ADADAD] pb-1.5 text-[13px] font-normal text-ink outline-none resize-none transition-colors"
        onFocus={e => { setFocused(true); e.currentTarget.style.borderColor = focusColor }}
        onBlur={e => { setFocused(false); e.currentTarget.style.borderColor = '' }}
      />
      <label
        className="absolute left-0 leading-none pointer-events-none transition-all duration-150"
        style={{
          top:        floated ? 0 : 8,
          fontSize:   floated ? 9 : 13,
          fontWeight: floated ? 500 : 400,
          color:      'var(--gray-text)',
          opacity:    0.85,
        }}
      >
        {label}
      </label>
    </div>
  )
}

interface GhostButtonProps {
  onClick: () => void
  children: React.ReactNode
  className?: string
  disabled?: boolean
  size?: 'default' | 'lg'
}

/** "새로 만들기" / "항목 추가" 류 보조 버튼 — 평소 투명, 호버 시만 옅은 회색 배경 */
export function GhostButton({ onClick, children, className = '', disabled, size = 'default' }: GhostButtonProps) {
  const sizeClass = size === 'lg' ? 'px-4 py-2.5 text-[13px]' : 'px-3 py-2 text-[11px]'
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`${sizeClass} rounded-lg font-normal text-gray-text hover:bg-gray-100 transition-colors flex-shrink-0 disabled:opacity-40 ${className}`}>
      {children}
    </button>
  )
}

interface ModalCTAButtonProps {
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
  className?: string
}

/** 모달 하단 메인 CTA(추가/다음/완료 등) — 메인 그린 배경, 우측 정렬로 쓰는 걸 전제로 함 */
export function ModalCTAButton({ onClick, children, disabled, className = '' }: ModalCTAButtonProps) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`px-6 py-3 bg-[#00DD67] text-[#1A1A1A] rounded-lg text-[13px] font-semibold hover:bg-[#00BB55] transition-colors disabled:opacity-40 ${className}`}>
      {children}
    </button>
  )
}

const STEPPER_ARROW = {
  up:   'M1 4.5L4 1.5L7 4.5',
  down: 'M1 1.5L4 4.5L7 1.5',
}

interface StepperButtonProps {
  direction: 'up' | 'down'
  onStep: () => void
}

/** 금액 필드 옆 ▲▼ 버튼 — 누르고 있으면 처음 한 번 실행 후 잠깐 대기했다가 빠르게 반복 실행 */
export function StepperButton({ direction, onStep }: StepperButtonProps) {
  const timeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onStepRef   = useRef(onStep)
  onStepRef.current = onStep

  function clear() {
    if (timeoutRef.current)  clearTimeout(timeoutRef.current)
    if (intervalRef.current) clearInterval(intervalRef.current)
    timeoutRef.current = null
    intervalRef.current = null
  }

  function start() {
    onStepRef.current()
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => onStepRef.current(), 80)
    }, 400)
  }

  useEffect(() => clear, [])

  return (
    <button
      type="button"
      onMouseDown={start}
      onMouseUp={clear}
      onMouseLeave={clear}
      className="w-6 h-[18px] bg-gray-100 hover:bg-gray-200 rounded text-[9px] text-gray-text flex items-center justify-center transition-colors"
    >
      <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={STEPPER_ARROW[direction]} />
      </svg>
    </button>
  )
}
