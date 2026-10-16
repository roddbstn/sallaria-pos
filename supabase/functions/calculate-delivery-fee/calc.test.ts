// 거리별 배달팁 tier 계산 단위 테스트.
// `deno test` 로 실행 (supabase CLI가 내부에서 쓰는 것과 같은 Deno 런타임).
// 실행: cd supabase/functions/calculate-delivery-fee && deno test calc.test.ts

import { assertEquals } from "jsr:@std/assert"
import { calcFee, haversineMeters, type StoreDeliveryTipConfig } from "./calc.ts"

function cfg(overrides: Partial<StoreDeliveryTipConfig> = {}): StoreDeliveryTipConfig {
  return {
    lat: null,
    lng: null,
    delivery_tip_base_distance_m: 1500,
    delivery_tip_base_fee: 4000,
    delivery_tip_tier_distance_m: 100,
    delivery_tip_tier_fee: 100,
    ...overrides,
  }
}

Deno.test("기본거리 이내면 기본팁만 적용", () => {
  const r = calcFee(1200, cfg())
  assertEquals(r, { baseFee: 4000, extraFee: 0, deliveryFee: 4000 })
})

Deno.test("기본거리와 정확히 같으면 기본팁만 적용", () => {
  const r = calcFee(1500, cfg())
  assertEquals(r, { baseFee: 4000, extraFee: 0, deliveryFee: 4000 })
})

Deno.test("초과거리는 floor — 450m 초과, 100m당 100원 → 400원 (500원 아님)", () => {
  const r = calcFee(1500 + 450, cfg())
  assertEquals(r, { baseFee: 4000, extraFee: 400, deliveryFee: 4400 })
})

Deno.test("초과거리가 tier 단위의 정확한 배수면 나머지 없이 계산", () => {
  const r = calcFee(1500 + 300, cfg())
  assertEquals(r, { baseFee: 4000, extraFee: 300, deliveryFee: 4300 })
})

Deno.test("초과거리가 tier 단위보다 작으면 할증 없음 (버림)", () => {
  const r = calcFee(1500 + 99, cfg())
  assertEquals(r, { baseFee: 4000, extraFee: 0, deliveryFee: 4000 })
})

Deno.test("500m 단위 tier 설정도 동일하게 floor 적용 — 950m 초과, 500m당 1000원 → 1000원 (나머지 450m는 버림)", () => {
  const r = calcFee(1500 + 950, cfg({ delivery_tip_tier_distance_m: 500, delivery_tip_tier_fee: 1000 }))
  assertEquals(r, { baseFee: 4000, extraFee: 1000, deliveryFee: 5000 })
})

Deno.test("상한 거리 없음 — 아주 먼 거리도 계산됨", () => {
  const r = calcFee(1500 + 10_000, cfg())
  assertEquals(r, { baseFee: 4000, extraFee: 10_000, deliveryFee: 14_000 })
})

Deno.test("haversine — 같은 좌표면 거리 0", () => {
  assertEquals(Math.round(haversineMeters(35.8714, 128.6014, 35.8714, 128.6014)), 0)
})

Deno.test("haversine — 위도 0.001도 차이는 약 111m", () => {
  const d = haversineMeters(35.8714, 128.6014, 35.8724, 128.6014)
  const diff = Math.abs(d - 111)
  if (diff > 2) throw new Error(`expected ~111m, got ${d}m`)
})
