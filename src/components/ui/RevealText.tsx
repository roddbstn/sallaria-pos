import { useState } from 'react'
import EyeIcon from './EyeIcon'

// 가린 값 + 눈 버튼. 주문 카드·주문 팝업·고객 패널이 같은 컴포넌트를 쓴다.
//
// 카드 안에 들어가는 경우가 많아 클릭이 카드 선택으로 번지지 않게 stopPropagation 한다 —
// 번호 보려다 주문이 선택되면 헷갈린다.

export default function RevealText({
  value, masked, className = '', iconSize = 14, onDark = false,
}: {
  /** 열었을 때 보여줄 실제 값 */
  value: string
  /** 닫혀 있을 때 보여줄 가린 값 */
  masked: string
  className?: string
  iconSize?: number
  /** 어두운 배경(주문 팝업) 위에서는 아이콘을 밝게 */
  onDark?: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  return (
    <button
      onClick={e => { e.stopPropagation(); setRevealed(v => !v) }}
      title={revealed ? '가리기' : '전체 보기'}
      className={`inline-flex items-center gap-[5px] ${className}`}
    >
      {revealed ? value : masked}
      <span className={onDark ? 'opacity-70 brightness-[2.6]' : ''}>
        <EyeIcon off={revealed} size={iconSize} />
      </span>
    </button>
  )
}
