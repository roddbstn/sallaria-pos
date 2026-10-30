import { useEffect, useRef, useState } from 'react'

// 매장 주변 배달 반경 — 기본 배달거리를 지도 위 원으로 보여준다.
//
// ── 왜 OSM 타일인가 ────────────────────────────────────────────────────────
// POS 는 Electron 이고 프로덕션에서 화면이 file:// 로 뜬다. 카카오·네이버 지도
// JS SDK 는 **등록된 도메인**에서 온 요청인지로 막는데, file:// 은 Referer 를
// 보내지 않아 등록할 도메인 자체가 없다. (QR웹은 https 라 카카오맵을 쓴다)
// OSM 래스터 타일은 키도 도메인 제한도 없고, 여기서 필요한 건 "어디쯤 어느 만큼"뿐이다.
//
// 지도를 끌거나 확대하지 않는다. 설정값을 확인하는 그림이지 탐색하는 지도가 아니다.
//
// ⚠️ OSM 이용 정책상 출처 표기가 필수다. 아래 attribution 을 지우지 말 것.

const TILE = 256

const lngToX = (lng: number, z: number) => ((lng + 180) / 360) * 2 ** z
function latToY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}
/** 그 위도·줌에서 1픽셀이 몇 미터인가 */
function metersPerPixel(lat: number, z: number) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z
}

export default function StoreRadiusMap({ lat, lng, radiusM, height = 260 }: {
  lat: number
  lng: number
  /** 기본 배달거리 — 이 반경으로 원을 그린다 */
  radiusM: number
  height?: number
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const ready = width > 0
  const tiles: { key: string; src: string; left: number; top: number }[] = []
  let zoom = 13
  let radiusPx = 0
  let cx = 0
  let cy = 0

  if (ready) {
    // 원이 **다 들어오는** 가장 가까운 줌. 여백 26px — 원이 가장자리에 닿으면
    // 어디까지가 배달 범위인지 끊겨 보인다.
    const fit = Math.min(width, height) / 2 - 26
    for (let z = 17; z >= 6; z--) {
      zoom = z
      if (radiusM / metersPerPixel(lat, z) <= fit) break
    }
    radiusPx = radiusM / metersPerPixel(lat, zoom)

    const centerX = lngToX(lng, zoom)
    const centerY = latToY(lat, zoom)
    const originX = centerX - width / 2 / TILE
    const originY = centerY - height / 2 / TILE
    cx = width / 2
    cy = height / 2

    const max = 2 ** zoom
    for (let x = Math.floor(originX); x <= Math.floor(originX + width / TILE); x++) {
      for (let y = Math.floor(originY); y <= Math.floor(originY + height / TILE); y++) {
        if (y < 0 || y >= max) continue
        const wx = ((x % max) + max) % max
        tiles.push({
          key: `${zoom}/${wx}/${y}`,
          src: `https://tile.openstreetmap.org/${zoom}/${wx}/${y}.png`,
          left: (x - originX) * TILE,
          top:  (y - originY) * TILE,
        })
      }
    }
  }

  return (
    <div
      ref={boxRef}
      className="relative w-full overflow-hidden rounded-[11px] bg-[#EDEDED] border border-[#E8E4E2]"
      style={{ height }}
    >
      {tiles.map(t => (
        <img
          key={t.key} src={t.src} alt="" aria-hidden
          width={TILE} height={TILE} loading="lazy" draggable={false}
          className="absolute max-w-none select-none"
          style={{ left: t.left, top: t.top }}
        />
      ))}

      {ready && (
        <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
          {/* 배달 반경 — 연한 갈색(디자인 시스템 #6A635E 계열).
              채움을 옅게 둬야 아래 지도가 비쳐서 "어느 동네까지"가 읽힌다.
              불투명하게 깔면 그냥 색 원이 되고 지도를 띄운 뜻이 사라진다. */}
          <circle
            cx={cx} cy={cy} r={radiusPx}
            fill="#6A635E" fillOpacity="0.18"
            stroke="#8C8379" strokeWidth="2"
          />
          {/* 매장 — 원의 중심 */}
          <circle cx={cx} cy={cy} r={5} fill="#2C261F" stroke="#fff" strokeWidth="2" />
        </svg>
      )}

      {ready && (
        <span className="absolute left-[10px] top-[10px] rounded-[7px] bg-[#2C261F]/85 px-[9px] py-[4px] text-[11px] font-medium text-white">
          매장 반경 {radiusM >= 1000 ? `${(radiusM / 1000).toFixed(radiusM % 1000 === 0 ? 0 : 1)}km` : `${radiusM}m`}
        </span>
      )}

      <span className="absolute bottom-0 right-0 bg-white/75 px-[5px] text-[9px] leading-[13px] text-[#727272]">
        © OpenStreetMap
      </span>
    </div>
  )
}
