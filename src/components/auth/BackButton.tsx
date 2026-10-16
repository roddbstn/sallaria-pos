interface BackButtonProps {
  onClick: () => void
}

/** 연한 회색 박스형 "이전" 버튼 — 테두리 없음, 얇은 텍스트. 화면 크기와 무관하게 자체 높이를 가짐 */
export default function BackButton({ onClick }: BackButtonProps) {
  return (
    <button
      onClick={onClick}
      className="h-[54px] px-7 rounded-lg text-[15px] flex items-center justify-center flex-shrink-0 transition-colors"
      style={{ background: 'transparent', color: '#333333', fontWeight: 400 }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--gray-bg)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      이전
    </button>
  )
}
