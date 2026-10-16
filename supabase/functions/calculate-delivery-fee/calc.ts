// 거리별 배달팁 핵심 계산 로직 — 순수 함수만 모아둔다 (Deno/Supabase 런타임 의존성 없음).
// index.ts와 calc.test.ts 양쪽에서 가져다 쓴다.

export interface StoreDeliveryTipConfig {
  lat: number | null
  lng: number | null
  delivery_tip_base_distance_m: number
  delivery_tip_base_fee: number
  delivery_tip_tier_distance_m: number
  delivery_tip_tier_fee: number
}

// 직선거리(Haversine), 미터 단위
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// base_distance_m 이내면 base_fee, 초과분은 floor(초과거리 / tier_distance_m) × tier_fee 가산
// (안 채워진 구간은 버림 — 예: 450m 초과 + 100m당 100원 → 400원)
export function calcFee(distanceM: number, cfg: StoreDeliveryTipConfig) {
  const extraM = Math.max(distanceM - cfg.delivery_tip_base_distance_m, 0)
  const extraTiers = Math.floor(extraM / cfg.delivery_tip_tier_distance_m)
  const extraFee = extraTiers * cfg.delivery_tip_tier_fee
  return { baseFee: cfg.delivery_tip_base_fee, extraFee, deliveryFee: cfg.delivery_tip_base_fee + extraFee }
}
