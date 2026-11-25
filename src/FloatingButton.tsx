import { useRef } from 'react'
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
 * 이만큼(px) 넘게 움직여야 창을 옮기기 시작한다.
 *
 * 손으로 누르면 몇 px 는 흔들린다. 0 으로 두면 두 번 누르는 동안에도 창이
 * 미세하게 밀린다.
 */
const DRAG_SLOP = 4

export default function FloatingButton() {
  // 누른 지점(화면 좌표)과 '끌었는지' 여부. 리렌더를 일으킬 값이 아니라 ref 로 둔다.
  const start = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)

  // ── 끌어서 옮기기 ──────────────────────────────────────────────────────
  //
  // `-webkit-app-region: drag` 를 쓰면 **어디를 잡아도** 끌 수 있지만 그 영역은
  // 마우스 이벤트를 못 받는다. 그래서 직접 옮긴다 — 창 전체가 손잡이다.
  //
  // ⚠️ **한 번 누르는 것으로는 홈에 가지 않는다.** 전엔 '거의 안 움직였으면 클릭'
  //    으로 쳤는데, 창이 마우스를 따라 움직이다 보니 끌고 놓아도 클릭으로 잡혀서
  //    옮기려 할 때마다 홈으로 튀었다. 홈은 **더블클릭**으로만 간다.
  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    start.current = { x: e.screenX, y: e.screenY }
    moved.current = false
    // 창 밖으로 벗어나도 move/up 이 계속 오게 잡아둔다 — 작은 창이라 금방 벗어난다
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    void api?.floatingDragStart?.()
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return
    const dx = e.screenX - start.current.x
    const dy = e.screenY - start.current.y
    if (!moved.current && Math.abs(dx) + Math.abs(dy) > DRAG_SLOP) moved.current = true
    if (moved.current) void api?.floatingDragMove?.(dx, dy)
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!start.current) return
    start.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* 이미 풀렸다 */ }
    void api?.floatingDragEnd?.()
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
        onDoubleClick={() => { void api?.openMainFromFloating?.() }}
        title="끌어서 옮기고, 두 번 눌러 선포스 홈으로"
        aria-label="선포스 홈으로 (두 번 누르기)"
        style={{
          width: '100%', height: '100%',
          cursor: 'grab',
          display: 'block',
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
