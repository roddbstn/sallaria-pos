import { api } from './lib/ipc'

// 다른 프로그램 위에 떠 있는 작은 로고 버튼 — 쿠팡이츠·배민이 매장 PC 에 띄우는 그것.
//
// 왜 필요한가: 매장 PC 는 보통 기존 POS 가 전체화면으로 떠 있다. 주문이 들어온 걸
// 보고 선포스로 돌아오려면 작업표시줄을 찾아 눌러야 하는데, 몇 초 안에 움직여야 하는
// 화면에서 그건 느리다.
//
// 이 화면은 72×72 투명 창 하나가 전부다(electron/index.ts 의 createFloatingWindow).
// App 을 거치지 않는다 — 배율(viewport-scale)·전역 CSS 가 끼면 버튼이 찌그러진다.

/** 창 한 변과 같아야 테두리가 잘리지 않는다 (FLOAT_SIZE) */
const SIZE = 72

export default function FloatingButton() {
  return (
    <div
      style={{
        width: SIZE, height: SIZE,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // 창 전체가 드래그 영역이다 — 점주가 기존 POS 버튼을 가리지 않는 자리로
        // 끌어다 둔다. 그 자리는 electron 쪽 'moved' 에서 기억한다.
        WebkitAppRegion: 'drag',
        cursor: 'grab',
      } as React.CSSProperties}
    >
      <button
        onClick={() => { void api?.openMainFromFloating?.() }}
        title="선포스 열기"
        aria-label="선포스 열기"
        style={{
          // 버튼만 클릭을 받는다 — 드래그 영역 위에서는 click 이 안 먹는다
          WebkitAppRegion: 'no-drag',
          width: 56, height: 56,
          borderRadius: 16,
          background: '#2C261F',
          color: '#FFFFFF',
          border: 'none',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em',
          boxShadow: '0 3px 10px rgba(0,0,0,0.28)',
          lineHeight: 1,
          // 한글 글꼴이 로드되기 전에도 모양이 유지되게
          fontFamily: 'Pretendard, "Apple SD Gothic Neo", "맑은 고딕", sans-serif',
        } as React.CSSProperties}
      >
        선포스
      </button>
    </div>
  )
}
