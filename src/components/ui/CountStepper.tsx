// 숫자 증감 스테퍼 — Figma node 491:4395.
//
// 회색 트랙(#F2F2F2) 안에 흰 카드가 떠 있고 좌우에 −/+ 막대가 놓인 모양.
// 같은 디자인 언어의 2칸짜리(+/− 만 있는) 변형은 아래 PlusMinusStepper.
// Figma 원본 px × 0.643(FIGMA_SCALE) 로 환산한 고정 실제 px.

import { useState } from 'react'

function Bar({ vertical = false, disabled = false }: { vertical?: boolean; disabled?: boolean }) {
  // 원본 34.17 × 4.1, radius 8 → 22 × 3, radius 5
  const color = disabled ? '#ADADAD' : '#787878'
  return (
    <span
      className="absolute rounded-[5px]"
      style={{
        width:  vertical ? 2 : 16,
        height: vertical ? 16 : 2,
        backgroundColor: color,
      }}
    />
  )
}

// 옆 칸의 필수/선택 SegmentedControl 과 같은 높이(48)로 맞춘다.
// Figma 원본(313×105 → 201×68)을 그 비율(0.706)만큼 더 줄여 142×48.
export default function CountStepper({
  value, onChange, min = 1, max = 99, suffix = '개',
}: {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  /** 숫자 뒤에 붙일 단위. 공간이 좁으면 '' 로 끈다 */
  suffix?: string
}) {
  const atMin = value <= min
  const atMax = value >= max

  return (
    <div
      className="bg-[#F2F2F2] rounded-[10px] flex items-center justify-between px-[10px]"
      style={{ width: 142, height: 48 }}
    >
      <button
        type="button"
        onClick={() => !atMin && onChange(value - 1)}
        disabled={atMin}
        aria-label="하나 줄이기"
        className="relative w-[24px] h-[24px] flex items-center justify-center disabled:cursor-not-allowed"
      >
        <Bar disabled={atMin} />
      </button>

      <div
        className="bg-[#FCFCFC] rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] flex items-center justify-center flex-shrink-0"
        style={{ width: 45, height: 42 }}
      >
        <span className="text-[15px] font-medium text-[#1E1E1E] tabular-nums">
          {value}{suffix}
        </span>
      </div>

      <button
        type="button"
        onClick={() => !atMax && onChange(value + 1)}
        disabled={atMax}
        aria-label="하나 늘리기"
        className="relative w-[24px] h-[24px] flex items-center justify-center disabled:cursor-not-allowed"
      >
        <Bar disabled={atMax} />
        <Bar vertical disabled={atMax} />
      </button>
    </div>
  )
}

/**
 * +/− 두 칸짜리 — Figma node 491:3368.
 *
 * 토글이 아니라 "누를 때마다 값이 오르내리는" 두 개의 동작 버튼이다. Figma 에선 왼쪽(+)에
 * 흰 썸이 올라와 있는데, 그건 고정 상태가 아니라 가리키고 있는 칸이라는 뜻으로 읽었다.
 * 그래서 썸이 마우스가 올라간 칸으로 미끄러진다. 아무 데도 없으면 +(왼쪽)에 쉰다.
 */
export function PlusMinusStepper({
  onPlus, onMinus,
}: {
  onPlus: () => void
  onMinus: () => void
}) {
  // 썸은 "마지막으로 누른 칸"에 머문다. 호버로 따라다니면 값을 바꾸지도 않았는데
  // 마우스가 스칠 때마다 움직여서 눌린 건지 아닌지 헷갈린다.
  const [pressed, setPressed] = useState<'plus' | 'minus'>('plus')

  return (
    <div
      className="relative bg-[#F2F2F2] rounded-[10px] flex-shrink-0"
      style={{ width: 100, height: 44 }}
    >
      <div
        className="absolute bg-[#FCFCFC] rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] transition-[left] duration-200 ease-out"
        style={{ width: 47, height: 38, top: 3, left: pressed === 'plus' ? 3 : 50 }}
      />
      {([
        { key: 'plus'  as const, label: '추가금액 100원 올리기', onClick: onPlus },
        { key: 'minus' as const, label: '추가금액 100원 내리기', onClick: onMinus },
      ]).map((b, i) => (
        <button
          key={b.key}
          type="button"
          onClick={() => { setPressed(b.key); b.onClick() }}
          aria-label={b.label}
          className="absolute top-0 h-full flex items-center justify-center"
          style={{ left: i * 50, width: 50 }}
        >
          <span className="relative w-[25px] h-[25px] flex items-center justify-center">
            <span className="absolute rounded-[5px]" style={{ width: 16, height: 2, backgroundColor: '#787878' }} />
            {b.key === 'plus' && (
              <span className="absolute rounded-[5px]" style={{ width: 2, height: 16, backgroundColor: '#787878' }} />
            )}
          </span>
        </button>
      ))}
    </div>
  )
}
