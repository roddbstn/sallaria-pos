import { useRef, useState } from 'react'
import { api } from './lib/ipc'
import buttonArt from './assets/floating-button.svg'

// 다른 프로그램 위에 떠 있는 작은 바로가기 — 쿠팡이츠·배민이 매장 PC 에 띄우는 그것.
//
// 왜 필요한가: 매장 PC 는 보통 기존 POS 가 전체화면으로 떠 있다. 주문이 들어온 걸
// 보고 선포스로 돌아오려면 작업표시줄을 찾아 눌러야 하는데, 몇 초 안에 움직여야 하는
// 화면에서 그건 느리다.
//
// 그림은 디자인에서 받은 200×200 정사각 SVG 한 장이다(assets/floating-button.svg).
// 배경색·둥근 모서리·글자·아이콘이 전부 그 안에 있어서 여기서 따로 그리지 않는다.
//
// App 을 거치지 않는다 — 배율(viewport-scale)·전역 CSS 가 끼면 이 작은 창에서
// 그림이 찌그러진다. 치수는 electron/index.ts 의 FLOAT_W/FLOAT_H 와 한 쌍이다.

/** 창 치수와 같아야 모서리가 잘리지 않는다 (정사각형) */
export const FLOAT_W = 124
export const FLOAT_H = 124

/** 버튼 둘레 투명 여백 — 둥근 모서리가 창 가장자리에 닿아 깎이지 않게 */
const PAD = 10

/**
 * 이만큼(ms) 넘게 누르고 있으면 **옮기기 모드**로 들어간다.
 *
 * 매장은 터치 POS 다. 손가락으로는 '두 번 빠르게' 보다 '꾹 누르기' 가 훨씬 쉽고,
 * 그 사이 짧은 탭은 그대로 홈 열기로 남는다.
 */
const HOLD_MS = 300

/**
 * 탭으로 쳐주는 최대 이동(px).
 *
 * 손가락은 누르는 동안 몇 px 는 흔들린다. 이보다 많이 움직였으면 누르고 있던 게
 * 아니라 문지른 것이라, 탭도 옮기기도 아닌 것으로 본다.
 */
const TAP_SLOP = 8

export default function FloatingButton() {
  /** 누른 지점(화면 좌표). 리렌더를 일으킬 값이 아니라 ref 로 둔다 */
  const start   = useRef<{ x: number; y: number } | null>(null)
  /** 마지막 포인터 좌표 — 옮기기 모드로 들어갈 때 기준점을 여기로 당긴다 */
  const last    = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  /** 꾹 누르기 타이머 */
  const timer   = useRef<number | null>(null)
  /** 옮기기 모드인가 (꾹 누르기가 걸린 뒤) */
  const holding = useRef(false)
  /** 탭으로 치기엔 너무 많이 움직였나 */
  const strayed = useRef(false)

  /** 옮기기 모드임을 눈으로 알려준다 — 터치에서는 '잡혔다' 를 몰라서 손이 머뭇거린다 */
  const [grabbed, setGrabbed] = useState(false)

  function clearTimer() {
    if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null }
  }

  // ── 짧게 누르면 홈, 꾹 누르면 옮기기 ───────────────────────────────────
  //
  // 전엔 '움직이지 않았으면 클릭' → 나중엔 '더블클릭' 이었다. 둘 다 터치 POS 에서
  // 쓰기 나빴다 — 창이 손가락을 따라오니 '안 움직였나' 판정이 흔들리고,
  // 더블탭은 손가락으로 맞추기 번거롭다. 시간으로 가른다.
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    start.current = { x: e.screenX, y: e.screenY }
    last.current  = { x: e.screenX, y: e.screenY }
    holding.current = false
    strayed.current = false
    // 창 밖으로 벗어나도 move/up 이 계속 오게 잡아둔다 — 작은 창이라 금방 벗어난다
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)

    clearTimer()
    timer.current = window.setTimeout(() => {
      if (!start.current || strayed.current) return
      holding.current = true
      setGrabbed(true)
      // 기준점을 **지금 손가락 자리**로 당긴다. 누르고 있는 동안 몇 px 흔들린 걸
      // 그대로 두면 옮기기 시작하는 순간 창이 그만큼 튄다.
      start.current = { ...last.current }
      void api?.floatingDragStart?.()
    }, HOLD_MS)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return
    last.current = { x: e.screenX, y: e.screenY }

    if (!holding.current) {
      // 아직 꾹 누르기 전 — 많이 움직였으면 탭도 옮기기도 아니다
      const dx = e.screenX - start.current.x
      const dy = e.screenY - start.current.y
      if (Math.abs(dx) + Math.abs(dy) > TAP_SLOP) { strayed.current = true; clearTimer() }
      return
    }

    void api?.floatingDragMove?.(e.screenX - start.current.x, e.screenY - start.current.y)
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!start.current) return
    clearTimer()
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* 이미 풀렸다 */ }

    if (holding.current) {
      // 옮기던 중이었다 — 자리만 저장하고 홈에는 가지 않는다
      void api?.floatingDragEnd?.()
    } else if (!strayed.current) {
      // 짧게 눌렀다 — 홈으로
      void api?.openMainFromFloating?.()
    }

    start.current = null
    holding.current = false
    setGrabbed(false)
  }

  return (
    <div
      style={{
        width: FLOAT_W, height: FLOAT_H,
        padding: PAD,
        boxSizing: 'border-box',
        userSelect: 'none',
      } as React.CSSProperties}
    >
      <div
        role="button"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // 꾹 누르면 뜨는 기본 메뉴(우클릭·터치 홀드)를 막는다 — 옮기는 중에 끼어든다
        onContextMenu={e => e.preventDefault()}
        title="눌러서 선포스 홈으로, 꾹 눌러 옮기기"
        aria-label="선포스 홈으로 (꾹 누르면 옮기기)"
        style={{
          width: '100%', height: '100%',
          display: 'block',
          cursor: grabbed ? 'grabbing' : 'pointer',
          // ⚠️ touch-action:none 이 없으면 브라우저가 터치를 스크롤·확대로 먼저
          //    가져가서 pointermove 가 오지 않는다. 터치 POS 에서 옮기기가 안 되던
          //    이유가 이것이다.
          touchAction: 'none',
          // ⚠️ 여기서 transform/scale 을 **주지 않는다.**
          //    전역 CSS 에 `[role="button"]:active { scale: 0.95 }` 가 있어서 누르는
          //    동안 이미 줄어든다. 거기에 scale 을 또 걸면 두 속성이 곱해져
          //    (0.95 × 1.06 ≈ 1.0) 꾹 누르는 순간 원래 크기로 되돌아온 것처럼 보였다.
          //    누르고 있는 내내 줄어든 채로 두는 게 '잡고 있다' 는 신호다.
        } as React.CSSProperties}
      >
        {/* pointerEvents:none — 그림이 포인터를 가로채면 위 핸들러가 못 받는다 */}
        <img
          src={buttonArt}
          alt="선포스"
          draggable={false}
          style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
        />
      </div>
    </div>
  )
}
