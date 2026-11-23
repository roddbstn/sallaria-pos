import logoSymbol from '../../assets/logo-symbol.png'
import { SUNPOS_VIEWBOX, SUNPOS_FLIP, SUNPOS_PATH, SUNPOS_ASPECT } from '../../assets/sunpos-wordmark'

// 선포스 워드마크 — 심볼 타일 + "sunpos".
// Figma 827:724(락업) · 827:709(심볼). 글자는 Joan Regular 를 패스로 구운 것
// (왜 폰트가 아닌지는 assets/sunpos-wordmark.ts 주석 참고).
//
// 모든 비율은 **타일 한 변(size)** 기준이다. Figma 원본이 타일 647px 기준이라
// 거기서 나눠 둔 값이고, 레퍼런스 락업 이미지를 재서 교차검증했다(오차 0.2%).

/** 타일 오른쪽 끝 ~ 글자 **잉크** 왼쪽 끝.
 *
 * Figma 의 간격은 183/647 = 0.2828 인데 그건 **요소 사이** 값이다. 우리는 글자를
 * 잉크 박스(viewBox 가 x=34 부터 시작)로 놓기 때문에 's' 의 좌측 사이드베어링
 * 34units × (600/647) = 0.0315T 가 빠져 있다. 그만큼 더해야 Figma 와 같아진다.
 * (0.2828 그대로 쓰면 글자가 타일에 0.03T 만큼 붙는다 — 실제로 렌더해서 확인했다) */
const GAP = 0.2828 + 0.0315

/** 타일 윗변 ~ 글자 잉크 윗변. 글자가 타일보다 크고 아래로 내려와 있다 */
const TEXT_TOP = 0.3720

/** 글자 잉크 높이(x-height + p 디센더). Figma 폰트크기 600/647 × 0.746em */
const TEXT_H = 0.6918

const TEXT_W = TEXT_H * SUNPOS_ASPECT          // 2.596
const TOTAL_W = 1 + GAP + TEXT_W               // 3.879

export default function Wordmark({ size = 40, symbolOnly = false, className = '' }: {
  /** 심볼 타일 한 변의 px. 글자 크기·간격이 전부 여기서 나온다 */
  size?: number
  /** 글자 없이 심볼만 — 좁은 자리용 */
  symbolOnly?: boolean
  className?: string
}) {
  // 타일 PNG 에는 둥근 모서리가 이미 구워져 있다(코너 알파 0).
  // 여기서 borderRadius 를 또 주면 그 위를 한 번 더 깎는다 — 주지 않는다.
  const tile = (
    <img
      src={logoSymbol}
      alt="선포스"
      style={{ width: size, height: size }}
      className="object-contain"
    />
  )

  if (symbolOnly) return <span className={`inline-block ${className}`}>{tile}</span>

  // 바깥 상자 높이를 타일과 같게(size) 두고 글자는 absolute 로 띄운다.
  // 'p' 디센더가 타일 아랫변보다 6% 더 내려오는데(레퍼런스도 그렇다),
  // 그걸 상자 높이에 반영하면 이 컴포넌트를 쓰는 화면들의 세로 간격이 전부 틀어진다.
  return (
    <span
      className={`relative inline-block align-middle ${className}`}
      style={{ width: size * TOTAL_W, height: size }}
      role="img"
      aria-label="선포스"
    >
      <span className="absolute left-0 top-0" aria-hidden>{tile}</span>
      <svg
        viewBox={SUNPOS_VIEWBOX}
        className="absolute text-[#1F1F1F]"
        style={{
          left: size * (1 + GAP),
          top: size * TEXT_TOP,
          width: size * TEXT_W,
          height: size * TEXT_H,
          overflow: 'visible',
        }}
        aria-hidden
      >
        <g transform={SUNPOS_FLIP}>
          <path d={SUNPOS_PATH} fill="currentColor" />
        </g>
      </svg>
    </span>
  )
}
