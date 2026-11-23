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

/** 창 치수와 같아야 그림자·모서리가 잘리지 않는다 (정사각형) */
export const FLOAT_W = 124
export const FLOAT_H = 124

/**
 * 끌기와 누르기를 **자리로 나눈다.**
 *
 * Electron 에서 `-webkit-app-region: drag` 인 영역은 click 을 받지 못한다.
 * 그래서 가운데 네모(로고)만 눌리는 버튼으로 떼어 내고, 그 둘레 띠가 손잡이다.
 * 띠를 넉넉히(한 변 기준 16px) 둬야 손으로 잡힌다.
 */
const PAD = 16

export default function FloatingButton() {
  return (
    <div
      style={{
        width: FLOAT_W, height: FLOAT_H,
        padding: PAD,
        boxSizing: 'border-box',
        // 둘레 띠가 손잡이 — 매장마다 기존 POS 버튼 위치가 달라서, 가리지 않는
        // 자리로 옮길 수 있어야 한다. 놓은 자리는 electron 쪽 'moved' 가 기억한다.
        WebkitAppRegion: 'drag',
        cursor: 'grab',
        userSelect: 'none',
      } as React.CSSProperties}
    >
      <button
        onClick={() => { void api?.openMainFromFloating?.() }}
        title="선포스 홈으로"
        aria-label="선포스 홈으로"
        style={{
          WebkitAppRegion: 'no-drag',
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          // 연갈색 — 앱이 쓰는 베이지 계열(#D7D2CE)이라 화면 어디에 둬도 튀지 않는다
          background: '#D7D2CE',
          color: '#2C261F',
          border: 'none',
          borderRadius: 18,
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
          padding: 0,
        } as React.CSSProperties}
      >
        {/* 심볼 타일은 뺀다 — 타일 자체가 배경색을 갖고 있어서 이 연갈색 위에
            올리면 네모가 두 겹으로 보인다. 글자만 쓴다(색은 currentColor). */}
        <Wordmark size={17} textOnly />
      </button>
    </div>
  )
}
