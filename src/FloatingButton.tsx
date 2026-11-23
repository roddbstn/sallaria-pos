import { useRef } from 'react'
import { api } from './lib/ipc'
import logoWithText from './assets/logo-with-text-transparent.png'

// 다른 프로그램 위에 떠 있는 작은 바로가기 — 쿠팡이츠·배민이 매장 PC 에 띄우는 그것.
//
// 왜 필요한가: 매장 PC 는 보통 기존 POS 가 전체화면으로 떠 있다. 주문이 들어온 걸
// 보고 선포스로 돌아오려면 작업표시줄을 찾아 눌러야 하는데, 몇 초 안에 움직여야 하는
// 화면에서 그건 느리다.
//
// App 을 거치지 않는다 — 배율(viewport-scale)·전역 CSS 가 끼면 이 작은 창에서
// 로고가 찌그러진다. 치수는 electron/index.ts 의 FLOAT_W/FLOAT_H 와 한 쌍이다.

/** 창 치수와 같아야 그림자·모서리가 잘리지 않는다 (정사각형) */
export const FLOAT_W = 124
export const FLOAT_H = 124

/** 버튼 둘레 여백 — 그림자가 잘리지 않을 만큼만 */
const PAD = 10

/**
 * 이만큼(px) 넘게 움직였으면 '끌었다', 아니면 '눌렀다'.
 *
 * 손으로 누르면 몇 px 는 흔들린다. 0 으로 두면 누를 때마다 미세하게 끌려서
 * 클릭이 안 먹고, 너무 크면 짧게 끌었을 때 창이 홈으로 튄다.
 */
const DRAG_SLOP = 4

// ── 로고 글자만 잘라 쓰기 ────────────────────────────────────────────────────
//
// 글자만 있는 자산이 레포에 없다. components/ui/Wordmark 의 SUNPOS_PATH 는
// **세리프(Joan Regular)** 라 로고의 산세리프 'sunpos' 와 다른 글자다 —
// 그걸 쓰면 로고가 아니라 다른 글꼴이 찍힌다.
// 그래서 락업 이미지에서 글자 영역만 잘라 쓴다. 아래 숫자는 눈대중이 아니라
// 알파 채널로 잰 값이다(2026-11-23, logo-with-text-transparent.png 725×367):
//   심볼 x 61~224 · 글자 x 260~662 · 글자 y 159~253
const IMG_W = 725
const IMG_H = 367
const TEXT_X = 260
const TEXT_Y = 159
const TEXT_W = 403
const TEXT_H = 95

/** 버튼 안에서 글자가 차지할 폭(px) */
const DRAW_W = 74
const SCALE  = DRAW_W / TEXT_W

export default function FloatingButton() {
  // 누른 지점(화면 좌표)과 '끌었는지' 여부. 리렌더를 일으킬 값이 아니라 ref 로 둔다.
  const start = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)

  // ── 끌어서 옮기기 ──────────────────────────────────────────────────────
  //
  // `-webkit-app-region: drag` 를 쓰면 **어디를 잡아도** 끌 수 있지만 그 영역은
  // click 을 못 받는다. 로고를 누르면 홈으로 가야 하니 겸할 수가 없다.
  // 그래서 직접 옮긴다 — 창 전체 어디를 잡아도 끌리고, 거의 안 움직였으면 클릭이다.
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
    // 끌지 않았으면 누른 것 — 홈으로
    if (!moved.current) void api?.openMainFromFloating?.()
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
        title="끌어서 옮기고, 눌러서 선포스 홈으로"
        aria-label="선포스 홈으로"
        style={{
          width: '100%', height: '100%',
          cursor: 'grab',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          // 밝은 연갈색 — 앱이 쓰는 베이지 계열에서 한 단계 밝힌 값
          background: '#F4EFEA',
          border: 'none',
          borderRadius: 18,
          boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
          padding: 0,
          overflow: 'hidden',
        } as React.CSSProperties}
      >
        {/* 잘라낸 글자 — 바깥 상자는 글자 크기 그대로고, 안의 이미지를 음수
            오프셋으로 밀어 글자 영역만 보이게 한다. 상자가 글자에 딱 맞으므로
            바깥 flex 의 가운데 정렬이 곧 글자의 가운데 정렬이다. */}
        <span
          style={{
            display: 'block',
            width: DRAW_W,
            height: TEXT_H * SCALE,
            position: 'relative',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <img
            src={logoWithText}
            alt="선포스"
            draggable={false}
            style={{
              position: 'absolute',
              width:  IMG_W * SCALE,
              height: IMG_H * SCALE,
              left:  -TEXT_X * SCALE,
              top:   -TEXT_Y * SCALE,
              maxWidth: 'none',
            }}
          />
        </span>
      </div>
    </div>
  )
}
