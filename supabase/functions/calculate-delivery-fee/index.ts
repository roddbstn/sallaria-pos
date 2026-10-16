// 거리별 배달팁 계산 — 배달주소 입력 즉시 호출.
// salaria-prepaid(QR 주문), sunpos-kakao(카카오 로그인 주문) 양쪽에서
// supabase.functions.invoke('calculate-delivery-fee', { body: { store_id, road_address } }) 로 호출한다.
//
// 1) road_address가 오면 지오코딩, lat/lng가 오면(저장된 주소 재사용) 그대로 사용
// 2) stores에서 매장 좌표 + 배달팁 설정(기본거리/기본팁/추가거리단위/할증액) 조회
// 3) 직선거리(Haversine) 계산
// 4) base_distance_m 이내면 base_fee, 초과분은 floor(초과거리 / tier_distance_m) × tier_fee 가산
//    (안 채워진 구간은 버림 — 예: 450m 초과 + 100m당 100원 → 400원)
//
// 지오코딩 로직은 ../_shared/geocode.ts 에 있다 (geocode-address와 공유).
// tier 계산 순수 함수는 ./calc.ts 에 있다 (calc.test.ts 에서 Deno 런타임 의존성 없이 테스트).

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { geocode, corsHeaders } from "../_shared/geocode.ts"
import { calcFee, haversineMeters, type StoreDeliveryTipConfig } from "./calc.ts"

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let payload: { store_id?: string; road_address?: string; lat?: number; lng?: number }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'invalid payload' }, 400)
  }

  const storeId = payload?.store_id
  const roadAddress = payload?.road_address?.trim()
  // 저장된 주소를 재사용할 때는 저장 시점의 lat/lng를 그대로 보내 재지오코딩을 건너뛸 수 있다.
  const knownLat = typeof payload?.lat === 'number' ? payload.lat : null
  const knownLng = typeof payload?.lng === 'number' ? payload.lng : null
  if (!storeId || (!roadAddress && (knownLat == null || knownLng == null))) {
    return json({ error: 'missing store_id or road_address/lat+lng' }, 400)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: store, error: storeError } = await supabase
    .from('stores')
    .select('lat, lng, delivery_tip_base_distance_m, delivery_tip_base_fee, delivery_tip_tier_distance_m, delivery_tip_tier_fee')
    .eq('id', storeId)
    .single()

  if (storeError || !store) {
    return json({ error: '매장 정보를 찾을 수 없습니다.' }, 404)
  }
  if (store.lat == null || store.lng == null) {
    return json({ error: '매장 위치가 아직 설정되지 않았습니다. 사장님 앱 설정에서 매장 위치를 먼저 등록해 주세요.' }, 422)
  }

  const coords = knownLat != null && knownLng != null
    ? { lat: knownLat, lng: knownLng }
    : await geocode(roadAddress!)
  if (!coords) {
    return json({ error: '배달 주소로 좌표를 찾지 못했습니다.' }, 404)
  }

  const distanceM = Math.round(haversineMeters(store.lat, store.lng, coords.lat, coords.lng))
  const { baseFee, extraFee, deliveryFee } = calcFee(distanceM, store as StoreDeliveryTipConfig)

  return json({
    distance_m:   distanceM,
    delivery_fee: deliveryFee,
    base_fee:     baseFee,
    extra_fee:    extraFee,
    lat:          coords.lat,
    lng:          coords.lng,
  }, 200)
})
