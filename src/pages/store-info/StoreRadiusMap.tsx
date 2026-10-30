import { useEffect, useRef, useState } from 'react'

// 매장 주변 배달 반경 — 기본 배달거리를 지도 위 원으로 보여준다. (카카오맵 JS SDK)
//
// ── file:// 에서 어떻게 뜨나 ───────────────────────────────────────────────
// 카카오는 JavaScript 키를 **등록된 도메인에서 온 요청인지**로 막는데, 이 앱은
// 프로덕션에서 화면이 file:// 로 뜨고 file:// 은 Referer 를 보내지 않는다.
// 그래서 메인 프로세스가 Referer 를 채워 보낸다 — electron/index.ts 의
// attachKakaoReferer(). 그 처리가 빠지면 여기는 조용히 '불러오지 못했어요'가 된다.
//
// ── 동 이름을 왜 찍나 ──────────────────────────────────────────────────────
// 반경을 km 로만 보면 "그래서 어디까지?"가 안 풀린다. 점주가 아는 단위는 동 이름이다.
// 원 둘레를 여덟 방향으로 찍어 역지오코딩하면 "이 원이 칠성동·침산동까지"가 바로 읽힌다.
// 그래서 SDK 를 libraries=services 로 받는다(Geocoder 가 거기 들어 있다).

const JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY as string | undefined

/** SDK 는 한 번만 받는다. services(역지오코딩)까지 같이 */
let sdkPromise: Promise<void> | null = null
function loadKakaoSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).kakao?.maps?.services) return Promise.resolve()
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise<void>((resolve, reject) => {
    if (!JS_KEY) { reject(new Error('no key')); return }
    const el = document.createElement('script')
    el.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${JS_KEY}&autoload=false&libraries=services`
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

/** 중심에서 bearing 방향으로 distM 만큼 간 좌표 */
function offset(lat: number, lng: number, distM: number, bearingDeg: number) {
  const R = 6371000
  const br = (bearingDeg * Math.PI) / 180
  const la = (lat * Math.PI) / 180
  const lo = (lng * Math.PI) / 180
  const la2 = Math.asin(Math.sin(la) * Math.cos(distM / R) + Math.cos(la) * Math.sin(distM / R) * Math.cos(br))
  const lo2 = lo + Math.atan2(
    Math.sin(br) * Math.sin(distM / R) * Math.cos(la),
    Math.cos(distM / R) - Math.sin(la) * Math.sin(la2),
  )
  return { lat: (la2 * 180) / Math.PI, lng: (lo2 * 180) / Math.PI }
}

interface AreaLabel { name: string; lat: number; lng: number; self: boolean }

export default function StoreRadiusMap({ lat, lng, radiusM, height = 460 }: {
  lat: number
  lng: number
  /** 기본 배달거리 — 이 반경으로 원을 그린다 */
  radiusM: number
  height?: number
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef     = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const circleRef  = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlaysRef = useRef<any[]>([])
  const [failed, setFailed] = useState(false)
  const [areas,  setAreas]  = useState<AreaLabel[]>([])

  // 지도는 한 번만 만든다. 거리만 바뀔 때 다시 그리면 타일이 매번 깜빡인다.
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
        const circle = new kakao.maps.Circle({
          center, radius: radiusM,
          strokeWeight: 2, strokeColor: '#8C8379', strokeOpacity: 0.9, strokeStyle: 'solid',
          fillColor: '#6A635E', fillOpacity: 0.18,
        })
        circle.setMap(map)
        circleRef.current = circle

        // ⚠️ 여기서 **바로** 화면을 원에 맞춘다.
        //    전엔 이 일을 [radiusM] effect 에만 맡겼는데, 그 effect 는 SDK 가 로드되기
        //    전에 한 번 돌고 끝난다(mapRef 가 아직 null 이라 그냥 return).
        //    그래서 처음 들어오면 level 6 그대로여서 원이 화면을 꽉 덮었다.
        map.setBounds(circle.getBounds(), 24, 24, 24, 24)
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
    map.setBounds(circle.getBounds(), 24, 24, 24, 24)
  }, [radiusM])

  // 매장이 속한 동 + 원 둘레의 동 이름을 모은다.
  // 반경이 바뀌면 둘레가 달라지므로 다시 찍는다.
  useEffect(() => {
    let dead = false
    loadKakaoSdk()
      .then(() => {
        if (dead) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kakao = (window as any).kakao
        const geocoder = new kakao.maps.services.Geocoder()

        // 중심 + 여덟 방향. 더 촘촘히 찍어도 같은 동이 반복될 뿐이다.
        const points = [
          { lat, lng, self: true },
          ...[0, 45, 90, 135, 180, 225, 270, 315].map(b => ({
            ...offset(lat, lng, radiusM * 0.92, b), self: false,
          })),
        ]

        Promise.all(points.map(p => new Promise<AreaLabel | null>(resolve => {
          geocoder.coord2RegionCode(p.lng, p.lat, (res: unknown[], status: string) => {
            if (status !== kakao.maps.services.Status.OK || !res?.length) { resolve(null); return }
            // 법정동(B) 쪽 이름을 쓴다 — 행정동(H)은 '○○1동' 처럼 쪼개져서 길다
            const r = (res as { region_type: string; region_3depth_name: string }[])
              .find(x => x.region_type === 'B') ?? (res[0] as { region_3depth_name: string })
            const name = (r as { region_3depth_name?: string }).region_3depth_name
            resolve(name ? { name, lat: p.lat, lng: p.lng, self: p.self } : null)
          })
        }))).then(list => {
          if (dead) return
          const seen = new Set<string>()
          const out: AreaLabel[] = []
          for (const a of list) {
            if (!a) continue
            // 매장 동은 반드시 넣고, 주변은 중복을 뺀다
            if (!a.self && seen.has(a.name)) continue
            seen.add(a.name)
            out.push(a)
          }
          setAreas(out)
        })
      })
      .catch(() => { /* 동 이름은 없어도 지도는 보인다 */ })
    return () => { dead = true }
  }, [lat, lng, radiusM])

  // 동 이름표를 지도에 얹는다
  useEffect(() => {
    const map = mapRef.current
    if (!map || !areas.length) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kakao = (window as any).kakao

    for (const o of overlaysRef.current) o.setMap(null)
    overlaysRef.current = []

    for (const a of areas) {
      const el = document.createElement('div')
      el.textContent = a.self ? `${a.name} (매장)` : a.name
      el.style.cssText = a.self
        ? 'background:#2C261F;color:#fff;font-size:12px;font-weight:700;padding:4px 10px;'
          + 'border-radius:999px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.3)'
        : 'background:rgba(255,255,255,0.92);color:#414141;font-size:11px;font-weight:600;'
          + 'padding:3px 8px;border-radius:999px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.2)'
      overlaysRef.current.push(
        new kakao.maps.CustomOverlay({
          map, position: new kakao.maps.LatLng(a.lat, a.lng), content: el,
          zIndex: a.self ? 3 : 2,
        }),
      )
    }
    return () => {
      for (const o of overlaysRef.current) o.setMap(null)
      overlaysRef.current = []
    }
  }, [areas])

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
        <span className="absolute left-[12px] top-[12px] z-10 rounded-[7px] bg-[#2C261F]/85 px-[10px] py-[5px] text-[12px] font-medium text-white">
          매장 반경 {radiusM >= 1000 ? `${(radiusM / 1000).toFixed(radiusM % 1000 === 0 ? 0 : 1)}km` : `${radiusM}m`}
        </span>
      )}
    </div>
  )
}
