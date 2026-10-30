import { useEffect, useRef, useState } from 'react'

// 매장 주변 배달 반경 — 기본 배달거리를 지도 위 원으로 보여준다. (카카오맵 JS SDK)
//
// ── file:// 에서 어떻게 뜨나 ───────────────────────────────────────────────
// 카카오는 JavaScript 키를 **등록된 도메인에서 온 요청인지**로 막는데, 이 앱은
// 프로덕션에서 화면이 file:// 로 뜨고 file:// 은 Referer 를 보내지 않는다.
// 그래서 메인 프로세스가 Referer 를 채워 보낸다 — electron/index.ts 의
// attachKakaoReferer(). 그 처리가 빠지면 여기는 조용히 '불러오지 못했어요'가 된다.
//
// ── 원은 SDK 가 그린다 ─────────────────────────────────────────────────────
// kakao.maps.Circle 은 **미터 단위 반지름**을 그대로 받는다. 줌이 바뀌어도 원의
// 실제 크기가 유지되므로, 픽셀 환산을 직접 할 필요가 없다.
// (전엔 OSM 타일 위에 SVG 원을 그리느라 미터→픽셀 환산을 손으로 했다)
//
// 지도를 끌거나 확대하지 않는다. 설정값을 확인하는 그림이지 탐색하는 지도가 아니다.

const JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY as string | undefined

/** SDK 는 한 번만 받는다 */
let sdkPromise: Promise<void> | null = null
function loadKakaoSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).kakao?.maps?.LatLng) return Promise.resolve()
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise<void>((resolve, reject) => {
    if (!JS_KEY) { reject(new Error('no key')); return }
    const el = document.createElement('script')
    el.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${JS_KEY}&autoload=false`
    el.async = true
    el.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).kakao.maps.load(() => resolve())
    }
    el.onerror = () => reject(new Error('sdk load failed'))
    document.head.appendChild(el)
  })
  return sdkPromise
}

export default function StoreRadiusMap({ lat, lng, radiusM, height = 260 }: {
  lat: number
  lng: number
  /** 기본 배달거리 — 이 반경으로 원을 그린다 */
  radiusM: number
  height?: number
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef    = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const circleRef = useRef<any>(null)
  const [failed, setFailed] = useState(false)

  // 지도는 한 번만 만든다. 거리만 바뀔 때 지도를 다시 그리면 타일이 매번 깜빡인다.
  useEffect(() => {
    let dead = false
    loadKakaoSdk()
      .then(() => {
        if (dead || !boxRef.current || mapRef.current) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kakao = (window as any).kakao
        const center = new kakao.maps.LatLng(lat, lng)

        const map = new kakao.maps.Map(boxRef.current, { center, level: 6 })
        map.setDraggable(false)
        map.setZoomable(false)
        mapRef.current = map

        // 배달 반경 — 연한 갈색(디자인 시스템 #6A635E 계열).
        // 채움을 옅게 둬야 아래 지도가 비쳐서 "어느 동네까지"가 읽힌다.
        // 불투명하게 깔면 그냥 색 원이 되고 지도를 띄운 뜻이 사라진다.
        circleRef.current = new kakao.maps.Circle({
          center, radius: radiusM,
          strokeWeight: 2, strokeColor: '#8C8379', strokeOpacity: 0.9, strokeStyle: 'solid',
          fillColor: '#6A635E', fillOpacity: 0.18,
        })
        circleRef.current.setMap(map)

        // 매장 — 원의 중심
        const dot = document.createElement('div')
        dot.style.cssText =
          'width:11px;height:11px;border-radius:999px;background:#2C261F;border:2px solid #fff;'
          + 'box-shadow:0 1px 3px rgba(0,0,0,0.35)'
        new kakao.maps.CustomOverlay({ map, position: center, content: dot }).setMap(map)
      })
      .catch(() => { if (!dead) setFailed(true) })
    return () => { dead = true }
  }, [lat, lng])

  // 거리가 바뀌면 원만 키우고 화면을 그 원에 맞춘다
  useEffect(() => {
    const map = mapRef.current
    const circle = circleRef.current
    if (!map || !circle) return
    circle.setRadius(radiusM)
    // 원이 다 들어오게. setBounds 가 여백까지 계산해 줌을 고른다 —
    // 미터→픽셀 환산을 직접 하지 않아도 된다.
    map.setBounds(circle.getBounds(), 18, 18, 18, 18)
  }, [radiusM])

  return (
    <div
      className="relative w-full overflow-hidden rounded-[11px] bg-[#EDEDED] border border-[#E8E4E2]"
      style={{ height }}
    >
      <div ref={boxRef} className="absolute inset-0" />

      {failed && (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[#ADADAD]">
          지도를 불러오지 못했어요
        </div>
      )}

      {!failed && (
        <span className="absolute left-[10px] top-[10px] z-10 rounded-[7px] bg-[#2C261F]/85 px-[9px] py-[4px] text-[11px] font-medium text-white">
          매장 반경 {radiusM >= 1000 ? `${(radiusM / 1000).toFixed(radiusM % 1000 === 0 ? 0 : 1)}km` : `${radiusM}m`}
        </span>
      )}
    </div>
  )
}
