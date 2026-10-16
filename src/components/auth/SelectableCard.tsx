interface SelectableCardProps {
  selected: boolean
  onClick: () => void
  className?: string
  children: React.ReactNode
}

/** 선택 상태에 따라 테두리/배경이 바뀌는 카드형 버튼 셸 — 내부 콘텐츠는 자유 */
export default function SelectableCard({ selected, onClick, className = '', children }: SelectableCardProps) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl transition-colors ${className}`}
      style={{
        border: `1.5px solid ${selected ? '#6A635E' : 'var(--gray-border)'}`,
        background: selected ? 'rgba(106,99,94,0.10)' : '#fff',
      }}
    >
      {children}
    </button>
  )
}
