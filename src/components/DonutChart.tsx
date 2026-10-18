// 비율 도넛 차트 — Figma는 정적 이미지(Group137)지만 실데이터로 그려야 해서 stroke-dasharray로 직접 생성.
// Dashboard.tsx(주문유형·베스트셀러)와 Customers.tsx(계정유형)가 공용으로 씀.
// onSegmentHover: 세그먼트 위에서 마우스 움직일 때 "원본 segments 배열 기준" 인덱스를 전달 (벗어나면 null).
export default function DonutChart({
  segments, size = 169, strokeWidth = 32, onSegmentHover,
}: {
  segments: { pct: number; color: string }[]
  size?: number
  strokeWidth?: number
  onSegmentHover?: (index: number | null, e: React.MouseEvent) => void
}) {
  // ⚠️ 1px 안으로 들인다.
  //
  // (size - strokeWidth)/2 를 그대로 쓰면 스트로크 **바깥 가장자리가 viewBox 경계에
  // 정확히 닿는다**: radius + strokeWidth/2 = size/2. 그러면 사방이 반 픽셀씩 잘리고,
  // #root 에 zoom 이 걸려 있어 소수점 픽셀이 생기는 탓에 잘림이 고르지 않아
  // 원이 찌그러져 보인다. 1px 만 들여도 잘림이 사라진다.
  const INSET = 1
  const radius = (size - strokeWidth) / 2 - INSET
  const circumference = 2 * Math.PI * radius
  const hasData = segments.some(s => s.pct > 0)
  let offset = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} shapeRendering="geometricPrecision">
      {!hasData ? (
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#E5E5E5" strokeWidth={strokeWidth} />
      ) : segments
        .map((s, i) => ({ ...s, i }))
        .filter(s => s.pct > 0)
        .map(s => {
          const len = (s.pct / 100) * circumference
          const el = (
            <circle
              key={s.i} cx={size / 2} cy={size / 2} r={radius} fill="none"
              stroke={s.color} strokeWidth={strokeWidth}
              strokeDasharray={`${len} ${circumference - len}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              style={onSegmentHover ? { cursor: 'pointer' } : undefined}
              onMouseEnter={onSegmentHover ? e => onSegmentHover(s.i, e) : undefined}
              onMouseMove={onSegmentHover ? e => onSegmentHover(s.i, e) : undefined}
              onMouseLeave={onSegmentHover ? e => onSegmentHover(null, e) : undefined}
            />
          )
          offset += len
          return el
        })}
    </svg>
  )
}
