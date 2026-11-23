import { api } from './lib/ipc'
import Wordmark from './components/ui/Wordmark'

// 다른 프로그램 위에 떠 있는 작은 바로가기 — 쿠팡이츠·배민이 매장 PC 에 띄우는 그것.
//
// 왜 필요한가: 매장 PC 는 보통 기존 POS 가 전체화면으로 떠 있다. 주문이 들어온 걸
// 보고 선포스로 돌아오려면 작업표시줄을 찾아 눌러야 하는데, 몇 초 안에 움직여야 하는
// 화면에서 그건 느리다.
//
// App 을 거치지 않는다 — 배율(viewport-scale)·전역 CSS 가 끼면 이 작은 창에서
// 로고가 찌그러진다. 치수는 electron/index.ts 의 FLOAT_W/FLOAT_H 와 한 쌍이다.

/** 창 치수와 같아야 그림자·모서리가 잘리지 않는다 */
export const FLOAT_W = 124
export const FLOAT_H = 116

export default function FloatingButton() {
  const goHome = () => { void api?.openMainFromFloating?.() }

  return (
    <div
      style={{
        width: FLOAT_W, height: FLOAT_H,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 10,
        background: '#FCFCFC',
        borderRadius: 20,
        boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
        // 창 전체가 손잡이다 — 어디를 잡아도 끌린다. 매장마다 기존 POS 의 버튼 줄
        // 위치가 달라서, 가리지 않는 자리로 옮길 수 있어야 한다.
        // (드래그 영역은 클릭을 안 받으므로, 누르는 자리는 아래 버튼으로 따로 둔다)
        WebkitAppRegion: 'drag',
        cursor: 'grab',
        userSelect: 'none',
        boxSizing: 'border-box',
      } as React.CSSProperties}
    >
      {/* 로고 — 앱 전체가 쓰는 Wordmark 의 심볼. 여기서 직접 그리지 않는다 */}
      <Wordmark size={54} symbolOnly />

      {/* 맨 아래 한 줄 — 이게 누르는 자리다 */}
      <button
        onClick={goHome}
        title="선포스 홈으로"
        style={{
          WebkitAppRegion: 'no-drag',
          background: 'transparent',
          border: 'none',
          padding: '2px 6px',
          cursor: 'pointer',
          color: '#8E8681',
          fontSize: 11,
          fontWeight: 400,
          letterSpacing: '-0.02em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          fontFamily: 'Pretendard, "Apple SD Gothic Neo", "맑은 고딕", sans-serif',
        } as React.CSSProperties}
      >
        선포스 바로가기
      </button>
    </div>
  )
}
