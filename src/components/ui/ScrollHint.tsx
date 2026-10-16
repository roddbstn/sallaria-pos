import { useEffect, useState, type RefObject } from 'react'
import { FIGMA_SCALE } from '../../lib/figma-scale'

// 표 위에 떠 있는 스크롤 화살표. Figma node 494:1256 / 497:1775 / 497:1786.
//
// 왜 필요한가: 표가 화면보다 길 때 "아직 아래가 있다"는 걸 알려주는 게 스크롤바뿐인데,
// 이 앱은 바탕이 밝아서 얇은 스크롤바가 거의 안 보인다. 점주가 18행까지만 있는 줄 알고
// 덮는 일이 생긴다.
//
// 규칙은 셋뿐이다:
//   맨 위  → 아래 화살표만
//   맨 아래 → 위 화살표만
//   중간   → 둘 다
// 눌리면 한 화면씩 움직인다. 버튼처럼 생긴 게 안 눌리면 그게 더 이상하다.

/** Figma 67px 원 → 앱 스케일 */
const SIZE = Math.round(67 * FIGMA_SCALE)

function HintButton({ dir, onClick, style }: {
  dir: 'up' | 'down'
  onClick: () => void
  style: React.CSSProperties
}) {
  return (
    <button
      onClick={onClick}
      aria-label={dir === 'up' ? '위로' : '아래로'}
      style={{ width: SIZE, height: SIZE, ...style }}
      // 그림자는 CARD_SURFACE 와 같은 값. Figma 원본(spread 1px)은 이 크기의 원에서
      // 가장자리에 회색 테두리가 한 겹 보인다.
      className="pressable absolute left-1/2 -translate-x-1/2 z-20 rounded-full bg-[#FCFCFC] shadow-[0_2px_10px_rgba(44,38,31,0.08)] flex items-center justify-center hint-fade"
    >
      <svg width={SIZE * 0.36} height={SIZE * 0.36} viewBox="0 0 24 24" fill="none"
           style={{ transform: dir === 'up' ? undefined : 'rotate(180deg)' }}>
        <path d="M5 15L12 8L19 15" stroke="#ADADAD" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

export default function ScrollHint({ scrollRef, topOffset = 12, bottomOffset = 12 }: {
  /** 스크롤이 일어나는 엘리먼트 */
  scrollRef: RefObject<HTMLElement | null>
  /** 위 화살표를 띄울 위치(px). 고정 헤더가 있으면 그 높이만큼 내려야 한다 */
  topOffset?: number
  bottomOffset?: number
}) {
  const [show, setShow] = useState({ up: false, down: false })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    function measure() {
      const n = scrollRef.current
      if (!n) return
      // 1px 여유 — 끝에 닿아도 소수점 때문에 0 이 안 되는 경우가 있다
      const canUp   = n.scrollTop > 1
      const canDown = n.scrollTop + n.clientHeight < n.scrollHeight - 1
      setShow(prev => (prev.up === canUp && prev.down === canDown) ? prev : { up: canUp, down: canDown })
    }

    measure()
    el.addEventListener('scroll', measure, { passive: true })
    // 행이 늘거나 줄어도 다시 잰다 — 필터를 바꾸면 스크롤이 생겼다 없어졌다 한다
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)

    return () => { el.removeEventListener('scroll', measure); ro.disconnect() }
  }, [scrollRef])

  function page(dir: -1 | 1) {
    const n = scrollRef.current
    if (!n) return
    n.scrollBy({ top: dir * (n.clientHeight - 60), behavior: 'smooth' })
  }

  if (!show.up && !show.down) return null

  return (
    <>
      {show.up   && <HintButton dir="up"   onClick={() => page(-1)} style={{ top: topOffset }} />}
      {show.down && <HintButton dir="down" onClick={() => page(1)}  style={{ bottom: bottomOffset }} />}
    </>
  )
}
