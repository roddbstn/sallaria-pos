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
// 역지오코딩으로 "이 원이 칠성동·평리동·산격동까지"를 바로 읽히게 한다.
// 그래서 SDK 를 libraries=services 로 받는다(Geocoder 가 거기 들어 있다).
//
// ── 찍는 곳과 적는 곳이 다르다 ─────────────────────────────────────────────
// 침산점·2.5km 로 실제 재보고 정한 방식이다:
//     원 안쪽(0.45r·0.8r, 12점) → 침산동 8 / 칠성동2가 2 / 그 외 2  = 4종
//     원 둘레(0.92r, 12점)      → 12점이 거의 다 다른 동          = 12종
// 동 경계는 매장에서 한참 떨어진 곳에 있으니 당연하다. 안쪽을 찍으면 매장 동만
// 반복해서 나온다. **그래서 이름은 둘레에서 얻고, 적기는 안쪽에 적는다** —
// 같은 방향으로 거리를 LABEL_PULL 만큼 줄인 자리에 얹으면 태그가 원 안에 들어온다.

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

/**
 * 이름을 얻은 방향으로 거리를 이만큼 줄여 적는다.
 * 1.0 이면 태그가 테두리에 걸터앉아 반쯤 원 밖으로 나간다. 0.72 면
 * 2.5km 기준 안쪽으로 약 700m — 태그 전체가 갈색 영역 안에 들어온다.
 */
const LABEL_PULL = 0.72

/**
 * 태그끼리 최소 이만큼(반지름 대비) 떨어뜨린다. 가까운 뒤쪽 태그는 버린다.
 * 매장 핀 주변도 같은 기준으로 비워 둔다.
 *
 * 0.36 인 이유 — 원은 늘 뷰포트에 꽉 차게 맞춰지니 비율로 따지면 배율과 무관하다.
 * 460px 높이에 지름이 들어가면 1px ≈ 반지름의 1/216 이다. 둘레 열두 방향을
 * 다 적으면 이웃 태그 간격이 0.343r(≈74px)인데 '칠성동1가' 태그 폭이 ≈71px 라
 * 사실상 맞닿는다. 0.36r 로 잡으면 한 칸 건너씩 남아 60° 간격(≈148px)이 된다 —
 * 이름이 많은 것보다 **읽히는 게** 먼저다.
 */
const MIN_SEP = 0.36

/** 두 좌표 사이 거리(m) — 태그 간격을 재는 용도라 하버사인으로 충분하다 */
function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const m = ((aLat + bLat) / 2) * (Math.PI / 180)
  const x = dLng * Math.cos(m)
  return Math.sqrt(dLat * dLat + x * x) * R
}

export default function StoreRadiusMap({ lat, lng, radiusM, storeName, height = 460 }: {
  lat: number
  lng: number
  /** 기본 배달거리 — 이 반경으로 원을 그린다 */
  radiusM: number
  /** 가운데 핀에 적을 매장 이름 */
  storeName?: string
  height?: number
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef     = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const circleRef  = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pinRef  = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tagsRef = useRef<any[]>([])
  const roRef = useRef<ResizeObserver | null>(null)
  /**
   * 점주가 직접 지도를 움직였나.
   *
   * 자동 맞춤(setBounds)과 손으로 하는 조작은 서로 싸운다 — 한참 끌어서 보고 있는데
   * 창 크기가 조금 바뀌었다고 원래 자리로 튕겨 돌아가면 그건 고장으로 보인다.
   * 그래서 **한 번이라도 끌거나 휠을 굴리면 자동 맞춤을 멈춘다.**
   * 반경 버튼을 새로 누르는 건 명시적인 행동이니 그때는 다시 맞추고 이 표시를 지운다.
   */
  const touchedRef = useRef(false)
  const [failed, setFailed] = useState(false)
  const [areas,  setAreas]  = useState<AreaLabel[]>([])
  /**
   * 지도가 만들어졌나 — **ref 가 아니라 state 로 둔다.**
   * ref 에 담아두면 오버레이 effect 가 "지도 아직 없음"으로 한 번 돌고 끝난다.
   * ref 가 채워져도 리렌더가 안 되니 다시 돌 일이 없기 때문이다.
   */
  const [ready, setReady] = useState(false)

  // 지도는 한 번만 만든다. 거리만 바뀔 때 다시 그리면 타일이 매번 깜빡인다.
  useEffect(() => {
    let dead = false
    const box = boxRef.current
    const markTouched = () => { touchedRef.current = true }
    // 휠은 SDK 로드와 상관없이 DOM 에 붙여 둔다 — 정리(remove)까지 한 자리에서 끝난다
    box?.addEventListener('wheel', markTouched, { passive: true })

    loadKakaoSdk()
      .then(() => {
        if (dead || !boxRef.current || mapRef.current) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kakao = (window as any).kakao
        const center = new kakao.maps.LatLng(lat, lng)

        // 끌어서 옮기고 휠로 확대·축소할 수 있다(카카오맵 기본값이라 따로 켤 게 없다).
        const map = new kakao.maps.Map(boxRef.current, { center, level: 6 })
        mapRef.current = map
        setReady(true)

        // 사용자가 손댄 순간을 잡는다.
        // zoom_changed 는 쓰지 않는다 — setBounds 가 스스로 발생시켜서
        // "내가 바꾼 것"과 "사용자가 바꾼 것"이 구분이 안 된다.
        // dragstart 와 휠은 사람 손에서만 나온다.
        kakao.maps.event.addListener(map, 'dragstart', markTouched)

        // 배달 반경 — 연한 갈색(디자인 시스템 #6A635E 계열).
        // 채움을 옅게 둬야 아래 지도가 비쳐서 "어느 동네까지"가 읽힌다.
        const circle = new kakao.maps.Circle({
          center, radius: radiusM,
          strokeWeight: 2, strokeColor: '#8C8379', strokeOpacity: 0.9, strokeStyle: 'solid',
          fillColor: '#6A635E', fillOpacity: 0.18,
        })
        circle.setMap(map)
        circleRef.current = circle

        // ⚠️ 화면 맞춤은 **컨테이너에 크기가 생긴 뒤에** 해야 한다.
        //
        //    두 번 틀렸다:
        //      1) [radiusM] effect 에만 맡겼더니, 그 effect 는 SDK 로드 전에 한 번
        //         돌고 끝나서(mapRef 가 null) 아예 안 불렸다.
        //      2) 생성 직후에 바로 불렀더니, 그 시점엔 flex 레이아웃이 아직 안 잡혀
        //         지도 뷰포트가 0×0 이다. 0×0 에 맞춘 줌은 뜻이 없어서 결국
        //         level 6 그대로처럼 보였다.
        //    그래서 크기를 지켜보다가 처음 0이 아닌 순간에 relayout + setBounds 한다.
        //    창 크기가 바뀔 때도 같은 경로로 다시 맞는다 —
        //    단 점주가 직접 움직인 뒤라면 relayout 만 하고 자리는 건드리지 않는다.
        const ro = new ResizeObserver(() => {
          if (!boxRef.current || boxRef.current.clientWidth === 0) return
          map.relayout()
          if (touchedRef.current) return
          const c = circleRef.current
          if (c) map.setBounds(c.getBounds(), 24, 24, 24, 24)
        })
        ro.observe(boxRef.current)
        roRef.current = ro
      })
      .catch(() => { if (!dead) setFailed(true) })
    return () => {
      dead = true
      box?.removeEventListener('wheel', markTouched)
      roRef.current?.disconnect()
      roRef.current = null
    }
  }, [lat, lng])

  // 거리가 바뀌면 원만 키우고 화면을 그 원에 맞춘다
  useEffect(() => {
    const map = mapRef.current
    const circle = circleRef.current
    if (!map || !circle) return
    circle.setRadius(radiusM)
    // 반경 버튼을 누른 건 "이 거리를 보여줘"라는 뜻이다. 끌어놓은 자리가 있어도
    // 여기서는 다시 맞추고, 그 뒤로는 또 사용자 쪽에 맡긴다.
    touchedRef.current = false
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

        // 둘레 가까이(0.92r) 를 30° 간격으로 열두 방향 — 서로 다른 동이 거의
        // 한 점당 하나씩 나오는 자리다. 중간(0.55r)도 여섯 방향 더 찍어서
        // 둘레에서 안 걸리는 동(원 안에만 들어오는 작은 동)을 줍는다.
        // bearing·dist 를 들고 다니는 이유는 **적는 자리를 따로 계산**하기 때문이다.
        const RINGS: [number, number, number][] = [
          // [반지름 비율, 방향 간격, 시작 방향]
          [0.92, 30,  0],
          [0.55, 60, 15],
        ]
        const points = [
          { lat, lng, bearing: 0, dist: 0, self: true },
          ...RINGS.flatMap(([frac, step, from]) => {
            const out: { lat: number; lng: number; bearing: number; dist: number; self: boolean }[] = []
            for (let b = from; b < from + 360; b += step) {
              const dist = radiusM * frac
              out.push({ ...offset(lat, lng, dist, b), bearing: b, dist, self: false })
            }
            return out
          }),
        ]

        Promise.all(points.map(p => new Promise<AreaLabel | null>(resolve => {
          geocoder.coord2RegionCode(p.lng, p.lat, (res: unknown[], status: string) => {
            if (status !== kakao.maps.services.Status.OK || !res?.length) {
              // 조용히 비우면 "동 이름이 왜 안 뜨지"를 영영 못 쫓는다.
              console.warn('[StoreRadiusMap] coord2RegionCode', status, p.lat, p.lng)
              resolve(null); return
            }
            // 법정동(B) 쪽 이름을 쓴다 — 행정동(H)은 '○○1동' 처럼 쪼개져서 길다
            const r = (res as { region_type: string; region_3depth_name: string }[])
              .find(x => x.region_type === 'B') ?? (res[0] as { region_3depth_name: string })
            const name = (r as { region_3depth_name?: string }).region_3depth_name
            if (!name) { resolve(null); return }
            // 찍은 자리가 아니라 **당긴 자리**를 담는다 (위 LABEL_PULL 설명 참고)
            const at = p.self ? { lat, lng } : offset(lat, lng, p.dist * LABEL_PULL, p.bearing)
            resolve({ name, lat: at.lat, lng: at.lng, self: p.self })
          })
        }))).then(list => {
          if (dead) return
          const seen = new Set<string>()
          const out: AreaLabel[] = []
          const sep = radiusM * MIN_SEP
          for (const a of list) {
            if (!a) continue
            // 매장 동은 반드시 넣고, 주변은 중복을 뺀다
            if (!a.self && seen.has(a.name)) continue
            if (!a.self) {
              // 매장 핀을 가리거나 앞서 넣은 태그에 붙는 자리는 버린다.
              // 둘레를 촘촘히 찍는 건 **이름을 고르게 긁어오려고** 하는 것이고,
              // 긁어온 걸 다 적을 필요는 없다.
              if (metersBetween(lat, lng, a.lat, a.lng) < sep) continue
              if (out.some(b => !b.self && metersBetween(b.lat, b.lng, a.lat, a.lng) < sep)) continue
            }
            seen.add(a.name)
            out.push(a)
          }
          setAreas(out)
        })
      })
      .catch(e => {
        // 동 이름은 없어도 지도와 매장 핀은 보인다(아래 effect 가 따로 그린다).
        console.warn('[StoreRadiusMap] 동 이름 조회 실패', e)
      })
    return () => { dead = true }
  }, [lat, lng, radiusM])

  // 매장 핀 — 이름을 단 태그 + 꼬리 + 점. (sunpos-kakao 의 지도 핀과 같은 어법)
  //
  // ⚠️ 동 이름표와 **반드시 따로** 그린다. 전에는 한 effect 안에 같이 있었고
  //    맨 위가 `if (!map || !areas.length) return` 이었다. 그래서 동 이름 조회가
  //    실패하면(= areas 가 0개) 매장 핀까지 통째로 사라졌다 — 실제로 그렇게 됐다.
  //    핀은 지오코딩과 아무 상관이 없다. 좌표는 이미 props 로 들어와 있다.
  //
  // yAnchor:1 이 콘텐츠 맨 아래(점)를 좌표에 맞추므로 transform 을 따로 주지 않는다 —
  // 거기서 한 번 더 보정하면 핀이 떠서 가리키는 곳이 어긋난다(QR웹에서 겪었다).
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kakao = (window as any).kakao

    // 이름이 아직 없으면 매장이 속한 동으로, 그것도 없으면 '매장'으로 버틴다
    const label = storeName || areas.find(a => a.self)?.name || '매장'
    const pin = document.createElement('div')
    pin.style.cssText = 'display:flex;flex-direction:column;align-items:center'
    pin.innerHTML =
      `<span style="background:#2C261F;color:#fff;font-size:12px;font-weight:700;`
      + `padding:4px 11px;border-radius:999px;white-space:nowrap;`
      + `box-shadow:0 1px 4px rgba(0,0,0,0.3)">${label}</span>`
      + `<span style="width:2px;height:8px;background:#2C261F"></span>`
      + `<span style="width:9px;height:9px;border-radius:999px;background:#2C261F;`
      + `border:2px solid #fff;margin-top:-3px;box-shadow:0 1px 2px rgba(0,0,0,0.3)"></span>`

    const overlay = new kakao.maps.CustomOverlay({
      map, position: new kakao.maps.LatLng(lat, lng), content: pin, yAnchor: 1, zIndex: 4,
    })
    pinRef.current = overlay
    return () => {
      overlay.setMap(null)
      pinRef.current = null
    }
  }, [ready, lat, lng, storeName, areas])

  // 주변 동 이름표 — 원 안쪽에 조그만 알약으로
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kakao = (window as any).kakao

    for (const a of areas) {
      if (a.self) continue
      const el = document.createElement('div')
      el.textContent = a.name
      el.style.cssText =
        'background:rgba(255,255,255,0.92);color:#414141;font-size:11px;font-weight:600;'
        + 'padding:3px 8px;border-radius:999px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.2)'
      tagsRef.current.push(
        new kakao.maps.CustomOverlay({
          map, position: new kakao.maps.LatLng(a.lat, a.lng), content: el, zIndex: 2,
        }),
      )
    }
    return () => {
      for (const o of tagsRef.current) o.setMap(null)
      tagsRef.current = []
    }
  }, [ready, areas])

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
        <span className="pointer-events-none absolute left-[12px] top-[12px] z-10 rounded-[7px] bg-[#2C261F]/85 px-[10px] py-[5px] text-[12px] font-medium text-white">
          매장 반경 {radiusM >= 1000 ? `${(radiusM / 1000).toFixed(radiusM % 1000 === 0 ? 0 : 1)}km` : `${radiusM}m`}
        </span>
      )}
    </div>
  )
}
