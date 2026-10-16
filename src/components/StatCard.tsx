import type { CSSProperties, ReactNode } from 'react'

/**
 * "배경 카드 안에 label/value/badge가 세로로 쌓인" 반복 패턴을 위한 얇은 래퍼.
 * 기존엔 카드 자체도, 그 안의 label/value도 전부 absolute(left/top)로 겹쳐 쌓았는데,
 * 이 컴포넌트는 카드 배경만 맡고 내부는 flex-col + gap으로 자연스럽게 흐르게 한다.
 * label/value/배지 같은 내용물의 정확한 글자 크기·색상은 호출부가 그대로 children으로 넣는다.
 */
export default function StatCard({
  className = 'bg-[#F2F2F2] rounded-[20px]',
  padding = 20,
  gap = 16,
  style,
  children,
}: {
  className?: string
  padding?: number
  gap?: number
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <div className={`flex flex-col ${className}`} style={{ padding, gap, ...style }}>
      {children}
    </div>
  )
}
