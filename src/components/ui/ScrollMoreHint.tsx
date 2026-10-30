import { useEffect, useRef, useState } from 'react'

/**
 * "아래로 더 있어요" 신호 — 스크롤 영역 바닥에 뜨는 동그란 꺾쇠.
 * 모양은 고객 표에서 쓰던 것과 같다 (Figma 497:1775).
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * 주문팝업의 주문 내역 칸은 높이가 고정이다(오른쪽 접수 버튼이 따라 내려가면
 * 안 되니까). 메뉴가 서너 개 넘어가면 아래가 잘리는데, 스크롤바는 요즘 OS 에서
 * 손을 대기 전까지 숨어 있어서 **잘린 줄 모른다.** 피크타임에 옵션 한 줄을
 * 못 보고 접수하면 그대로 오주문이 된다.
 *
 * ── 언제 보이나 ─────────────────────────────────────────────────────────────
 * 넘칠 때만, 그리고 바닥에 닿기 전까지만. 끝까지 내리면 사라진다 —
 * 더 볼 게 없는데 계속 튕기면 그때부터는 잔소리다.
 *
 * 내용이 바뀌면(주문이 넘어가면) 다시 재므로 카드마다 알아서 맞는다.
 */
export default function ScrollMoreHint({ targetRef }: {
  /** 감시할 스크롤 컨테이너 */
  targetRef: React.RefObject<HTMLElement | null>
}) {
  const [show, setShow] = useState(false)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const el = targetRef.current
    if (!el) return

    const measure = () => {
      // 바닥에서 8px 안쪽이면 '다 봤다'로 친다 — 1px 단위로 따지면
      // 소수점 높이 때문에 끝까지 내려도 안 사라지는 기기가 있다.
      const more = el.scrollHeight - el.clientHeight - el.scrollTop > 8
      setShow(more)
    }

    // 스크롤은 자주 울린다. 프레임당 한 번으로 묶는다.
    const onScroll = () => {
      if (rafRef.current !== null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        measure()
      })
    }

    measure()
    el.addEventListener('scroll', onScroll, { passive: true })
    // 내용·크기가 바뀌면 다시 잰다(이미지가 늦게 로드되는 경우가 많다)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)

    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [targetRef])

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute bottom-[10px] left-1/2 -translate-x-1/2 transition-opacity duration-200 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="scroll-nudge w-[34px] h-[34px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.18)] flex items-center justify-center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M6 9.5l6 6 6-6" stroke="#8C8379" strokeWidth="2.6"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  )
}
