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

/** 인증/온보딩 공용 메인 CTA 버튼 — 다크 브라운 배경 + 밝은 텍스트, 호버 시 살짝 밝아짐.
 *
 * 굵기는 **font-medium**. 서비스 안쪽 CTA(SupportModal·CategoryAddModal·BreakTimeModal 등
 * #2C261F 버튼 전부)가 medium 인데 여기만 bold 였다. 글꼴은 원래부터 같은 Pretendard 라
 * 달라 보이던 건 굵기 하나였다 — 로그인 전후가 다른 제품처럼 읽히던 이유. */
export default function PrimaryButton({
  onClick, type = 'button', disabled, size = 'default', className = '', style, hidden, children,
}: PrimaryButtonProps) {
  const sizeClass = size === 'lg' ? 'py-4 text-[16px]' : 'py-3.5 text-[15px]'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || hidden}
      className={`${sizeClass} rounded-[10px] font-medium transition-[filter] disabled:opacity-40 ${className}`}
      style={{ background: '#2C261F', color: '#FCFCFC', visibility: hidden ? 'hidden' : 'visible', ...style }}
      onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.filter = 'brightness(1.2)' }}
      onMouseLeave={e => { e.currentTarget.style.filter = 'none' }}
    >
      {children}
    </button>
  )
}
