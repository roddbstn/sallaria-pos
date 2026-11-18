import { useEffect, useRef } from 'react'
import { loadDaumPostcodeScript } from '../hooks/useDeliveryInfo'

// window.daum 전역 타입은 hooks/useDeliveryInfo.ts에서 declare global로 한 번만 선언함

/** 다음 우편번호 검색 — Electron은 window.open() 팝업을 막아서 모달 안에 embed() 방식으로 띄움.
 *  Settings(매장 위치)와 회원가입 온보딩(AddressStep), 구두주문(배달 주소)에서 공용으로 씀.
 *
 *  ⚠️ **스크립트는 이 컴포넌트가 직접 보장한다.**
 *  전엔 호출부가 loadDaumPostcodeScript() 를 먼저 불러줘야 했고, 구두주문 모달은 그걸
 *  안 불러서 '배달 주소 찾기' 를 누르면 바로 터졌다:
 *    Uncaught TypeError: Cannot read properties of undefined (reading 'Postcode')
 *  호출부가 기억해야 하는 순서는 언젠가 어긋난다 — 여기서 기다렸다 띄운다. */
export default function DaumPostcodeEmbed({ onComplete }: { onComplete: (road: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  // onComplete 가 매 렌더 새 함수로 와도(호출부 대부분이 인라인 화살표를 넘긴다)
  // effect 가 다시 돌지 않게 ref 에 담는다. 다시 돌면 embed 가 겹쳐 붙는다.
  const completeRef = useRef(onComplete)
  completeRef.current = onComplete

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await loadDaumPostcodeScript()
      if (cancelled || !containerRef.current) return
      new window.daum.Postcode({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        oncomplete: (data: any) => {
          const road = data.roadAddress || data.autoRoadAddress || data.jibunAddress || ''
          completeRef.current(road)
        },
        width: '100%',
        height: '100%',
      }).embed(containerRef.current)
    })()
    return () => { cancelled = true }
  }, [])

  return <div ref={containerRef} className="flex-1" />
}
