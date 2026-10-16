interface PrimaryButtonProps {
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  size?: 'default' | 'lg'
  className?: string
  /** 개별 호출부에서 padding 등을 미세 조정할 때 — 공용 size 프리셋을 건드리지 않고 오버라이드용 */
  style?: React.CSSProperties
  /** true면 자리는 그대로 차지한 채 안 보이게만 함 — 등장 시 위 UI가 밀리지 않도록 */
  hidden?: boolean
  children: React.ReactNode
}

/** 인증/온보딩 공용 메인 CTA 버튼 — 다크 브라운 배경 + 밝은 텍스트, 호버 시 살짝 밝아짐 */
export default function PrimaryButton({
  onClick, type = 'button', disabled, size = 'default', className = '', style, hidden, children,
}: PrimaryButtonProps) {
  const sizeClass = size === 'lg' ? 'py-4 text-[16px]' : 'py-3.5 text-[15px]'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || hidden}
      className={`${sizeClass} rounded-[10px] font-bold transition-[filter] disabled:opacity-40 ${className}`}
      style={{ background: '#2C261F', color: '#FCFCFC', visibility: hidden ? 'hidden' : 'visible', ...style }}
      onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.filter = 'brightness(1.2)' }}
      onMouseLeave={e => { e.currentTarget.style.filter = 'none' }}
    >
      {children}
    </button>
  )
}
