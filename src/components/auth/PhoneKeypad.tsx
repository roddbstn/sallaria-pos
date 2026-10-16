interface PhoneKeypadProps {
  onDigit: (d: string) => void
  onBackspace: () => void
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '←']

/** PhoneStep의 전화번호 표시줄/약관 영역도 이 폭에 맞춘다 */
export const PHONE_KEYPAD_WIDTH = 260

/** 토스플레이스 스타일 숫자 키패드 (전화번호 입력 전용) */
export default function PhoneKeypad({ onDigit, onBackspace }: PhoneKeypadProps) {
  return (
    <div className="grid grid-cols-3 gap-1 mt-6 mx-auto" style={{ maxWidth: PHONE_KEYPAD_WIDTH, justifyItems: 'center' }}>
      {KEYS.map((k, i) => {
        if (k === '') return <div key={i} />
        const isBackspace = k === '←'
        return (
          <button
            key={i}
            type="button"
            onClick={() => (isBackspace ? onBackspace() : onDigit(k))}
            className="h-14 rounded-xl text-[22px] font-normal flex items-center justify-center transition-colors"
            style={{ color: 'var(--ink)', width: 64, transform: isBackspace ? undefined : 'translateY(-2px)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--gray-bg)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {k}
          </button>
        )
      })}
    </div>
  )
}
