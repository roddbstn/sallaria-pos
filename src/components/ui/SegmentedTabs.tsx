// 세그먼티드 탭 — #F2F2F2 트랙 위를 흰 썸이 미끄러진다.
//
// 원본은 메뉴 화면 사이드패널 상단(Figma 491:1486). 주문 리포트의 '주문 추이' 단위와
// 기간 필터가 같은 모양을 쓰면서 세 번째 복사본이 생기려 해서 여기로 모았다.
//
// 칸 폭을 고정으로 받는 이유: 썸이 `left` 를 옮겨 미끄러지는데, 칸마다 폭이 다르면
// 썸 폭도 같이 바뀌어야 해서 애니메이션이 덜컥거린다. 가장 긴 라벨에 맞춰 한 번 정한다.

/** 칸 사이 틈 — 트랙 안쪽 여백과 같은 값(원본이 3px) */
const PAD = 3

export default function SegmentedTabs<T extends string | number>({
  options, value, onChange, cellWidth = 78, height = 42,
}: {
  options: { value: T; label: string }[]
  value:   T
  onChange: (v: T) => void
  /** 가장 긴 라벨이 들어가는 폭 */
  cellWidth?: number
  height?:    number
}) {
  const cellH = height - PAD * 2
  const stepX = cellWidth + PAD
  const idx   = options.findIndex(o => o.value === value)

  return (
    <div
      className="relative flex-shrink-0 bg-[#F2F2F2] rounded-[10px]"
      style={{ width: PAD + options.length * stepX, height }}
    >
      {/* 썸 — 고른 칸이 없으면(=값이 목록에 없으면) 숨긴다 */}
      {idx >= 0 && (
        <div
          className="absolute bg-[#FCFCFC] rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] transition-[left] duration-150"
          style={{ top: PAD, left: PAD + idx * stepX, width: cellWidth, height: cellH }}
        />
      )}
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`absolute flex items-center justify-center rounded-[10px] text-[15px] font-medium whitespace-nowrap transition-colors ${
            value === o.value ? 'text-ink' : 'text-[#BDB4A7]'
          }`}
          style={{ top: PAD, left: PAD + i * stepX, width: cellWidth, height: cellH }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
