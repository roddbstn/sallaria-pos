import { useRef } from 'react'
import { PHONE_KEYPAD_WIDTH } from './PhoneKeypad'

interface DigitDisplayProps {
  value: string
  placeholder: string
  format?: (v: string) => string
  /** 있으면 밑줄이 빨간색, 바로 아래 좌측정렬로 이 메시지 표시 */
  errorMessage?: string
  /** true로 바뀌는 순간마다 흔들림 애니메이션을 다시 재생(같은 에러가 반복돼도 매번 흔들리게) */
  shake?: boolean
  /** 있으면 텍스트필드 내부 우측에 "MM:SS" 형태로 표시(연한 회색, 에러 시 빨간색) — 인증번호 유효시간 카운트다운용 */
  countdownText?: string
  /** 입력 가능한 최대 자리수 — 실제 키보드 입력 시 이 길이로 잘라냄(전화번호 11, 인증번호 6) */
  maxLength: number
  /** 화면을 클릭해서 포커스한 뒤 실제 키보드로 입력했을 때 호출 — 숫자 외 문자는 여기서 걸러서 넘김 */
  onChangeValue: (v: string) => void
}

/** 키패드와 짝을 이루는 밑줄 숫자 표시줄 — 값 없으면 회색 플레이스홀더, 에러 시 빨간줄+흔들림.
 *  화면엔 큰 글씨로 표시만 하고, 투명한 input을 겹쳐둬서 클릭 시 포커스되어 실제 키보드로도 입력 가능 */
export default function DigitDisplay({ value, placeholder, format, errorMessage, shake, countdownText, maxLength, onChangeValue }: DigitDisplayProps) {
  const display = value ? (format ? format(value) : value) : placeholder
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="mx-auto relative" style={{ maxWidth: PHONE_KEYPAD_WIDTH }}>
      <div
        className={`pb-2 flex items-end justify-between cursor-text ${shake ? 'shake-x' : ''}`}
        style={{ borderBottom: `2px solid ${errorMessage ? 'var(--danger)' : 'var(--gray-border)'}` }}
        onClick={() => inputRef.current?.focus()}
      >
        <span className="text-[30px] tracking-wide" style={{ fontWeight: 300, color: value ? 'var(--ink)' : 'var(--gray-text)' }}>
          {display}
        </span>
        {/* 실제 키보드 입력용 — 시각적으로는 숨기되 포커스/타이핑은 받음 */}
        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={value}
          onChange={e => onChangeValue(e.target.value.replace(/\D/g, '').slice(0, maxLength))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-text"
          aria-label={placeholder}
        />
        {countdownText && (
          <span
            className="text-[14px] tabular-nums"
            style={{
              fontWeight: 400,
              color: errorMessage ? 'var(--danger)' : 'var(--gray-text)',
              opacity: errorMessage ? 1 : 0.55,
            }}
          >
            {countdownText}
          </span>
        )}
      </div>
      {/* absolute 배치 — 레이아웃 흐름에서 빠져서 아래 요소(키패드) 위치에 영향 안 줌 */}
      {errorMessage && (
        <p
          className="absolute left-0 text-left text-[12px]"
          style={{ top: '100%', marginTop: 6, color: 'var(--danger)' }}
        >
          {errorMessage}
        </p>
      )}
    </div>
  )
}
