import { useEffect, useState, type ReactNode } from 'react'

// 하단 중앙 토스트 — Figma node 491:713(모드 전환) / 491:949(순서편집 안내).
//
// **이 앱의 모든 하단 안내·오류 문구가 이 박스를 쓴다.** 전엔 다섯 가지였다:
//   · 메뉴 화면      #414141 / r10 / 21px / pop 애니메이션   ← 기준
//   · App 전역 토스트 bg-ink / r-xl / 14px semibold / fadeIn
//   · 홈 화면        #2C261F / r10 / 14px normal / 그림자
//   · 고객 화면      bg-ink / r-xl / 13px semibold
//   · 업데이트 배너  bg-ink / r-xl / 14px semibold + 버튼
// 같은 역할을 하는 박스가 화면마다 다르면 점주는 "이건 다른 종류의 알림인가"를 매번 판단한다.
//
// 등장: 0에서 확 커졌다가 살짝 줄어들며 정착(.toast-pop, src/index.css) → 사라질 때 fade out.

/** 박스 치수·색 — 버튼이 들어가는 변형(업데이트 배너·일괄 작업 바)이 같은 값을 쓰도록 꺼내둔다 */
export const TOAST_BOX =
  'bg-[#414141] rounded-[10px] px-[26px] py-[13px] text-[#FCFCFC] shadow-[0_4px_16px_rgba(0,0,0,0.2)]'

export default function BottomToast({
  message, action, size = 'normal',
}: {
  message: string | null
  /** 오른쪽에 붙일 버튼 등. 있으면 토스트가 클릭을 받는다 */
  action?: ReactNode
  /**
   * 글자 크기. 기준(메뉴 화면 모드 전환)은 'large'(21px).
   * 긴 오류 문구는 21px 로 두면 화면을 넘겨서 'normal'(15px)을 쓴다.
   */
  size?: 'normal' | 'large'
}) {
  const [shown,   setShown]   = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const [animKey, setAnimKey] = useState(0)

  useEffect(() => {
    if (message) {
      setShown(message)
      setAnimKey(k => k + 1) // 같은 메시지가 연속으로 떠도 pop 애니메이션이 다시 재생되도록
      const raf = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(raf)
    } else {
      setVisible(false)
      const t = setTimeout(() => setShown(null), 300)
      return () => clearTimeout(t)
    }
  }, [message])

  if (!shown) return null

  return (
    <div
      // fixed + 높은 z — 전엔 absolute/z-10 이라 메뉴 화면 안에서만 떴고,
      // 모달 위에서 띄우면 가려졌다. 토스트는 늘 맨 위에 보여야 한다.
      className={`fixed left-1/2 -translate-x-1/2 z-[200] ${action ? '' : 'pointer-events-none'}`}
      style={{
        bottom: 50,
        opacity: visible ? 1 : 0,
        transition: visible ? undefined : 'opacity 300ms ease-in',
      }}
    >
      <div
        key={animKey}
        // nowrap 을 걸지 않는다 — 기준 문구("카테고리 모드로 바꿈")는 짧아서 한 줄로
        // 나오지만, 오류 문구는 길다. nowrap 이면 화면 밖으로 넘어간다.
        className={`relative ${TOAST_BOX} flex items-center gap-[14px] max-w-[min(760px,calc(100vw-80px))] ${
          visible ? 'toast-pop' : ''
        }`}
        style={{ transformOrigin: 'center', transform: visible ? undefined : 'scale(1)' }}
      >
        <p className={`${size === 'large' ? 'text-[21px]' : 'text-[15px]'} font-normal leading-relaxed`}>
          {shown}
        </p>
        {action}
      </div>
    </div>
  )
}
