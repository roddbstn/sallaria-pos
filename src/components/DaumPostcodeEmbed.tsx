import { useEffect, useRef } from 'react'

// window.daum 전역 타입은 hooks/useDeliveryInfo.ts에서 declare global로 한 번만 선언함

/** 다음 우편번호 검색 — Electron은 window.open() 팝업을 막아서 모달 안에 embed() 방식으로 띄움.
 *  Settings(매장 위치)와 회원가입 온보딩(AddressStep) 양쪽에서 공용으로 씀. */
export default function DaumPostcodeEmbed({ onComplete }: { onComplete: (road: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    new window.daum.Postcode({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      oncomplete: (data: any) => {
        const road = data.roadAddress || data.autoRoadAddress || data.jibunAddress || ''
        onComplete(road)
      },
      width: '100%',
      height: '100%',
    }).embed(containerRef.current)
  }, [onComplete])

  return <div ref={containerRef} className="flex-1" />
}
