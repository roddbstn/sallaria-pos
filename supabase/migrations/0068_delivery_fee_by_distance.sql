-- 거리기반 배달료 계산. 주소 저장/관리(CRUD)는 별도 세션에서 진행 중이라 이쪽은 건드리지 않고,
-- "위경도 2개 받아서 배달료를 계산하는 순수 함수"만 만들어둠 — 주소 기능이 완성되면
-- get_delivery_fee_estimate(store_id, 도착지 lat, lng)만 호출하면 바로 연결됨.

-- 순수 계산 함수: Haversine 거리 → 기본거리/기본요금 + 초과거리를 단위(100m or 500m)로 올림해서 할증
CREATE OR REPLACE FUNCTION calculate_delivery_fee(
  p_store_lat       double precision,
  p_store_lng       double precision,
  p_dest_lat        double precision,
  p_dest_lng        double precision,
  p_base_distance_m integer,
  p_base_fee        integer,
  p_tier_distance_m integer,
  p_tier_fee        integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_distance_m double precision;
  v_extra_m    double precision;
  v_tier_count integer;
BEGIN
  -- Haversine 공식 (지구 반지름 6,371,000m)
  v_distance_m := 6371000 * acos(
    LEAST(1.0, GREATEST(-1.0,
      cos(radians(p_store_lat)) * cos(radians(p_dest_lat)) * cos(radians(p_dest_lng) - radians(p_store_lng))
      + sin(radians(p_store_lat)) * sin(radians(p_dest_lat))
    ))
  );

  IF v_distance_m <= p_base_distance_m THEN
    RETURN p_base_fee;
  END IF;

  v_extra_m    := v_distance_m - p_base_distance_m;
  v_tier_count := ceil(v_extra_m / p_tier_distance_m);
  RETURN p_base_fee + (v_tier_count * p_tier_fee);
END;
$$;

-- 편의 래퍼: store_id로 매장 위경도+배달팁 설정을 직접 조회해서 계산.
-- 주소 기능 쪽에서는 이 함수 하나만 (store_id, 도착지 lat, 도착지 lng)로 호출하면 됨.
CREATE OR REPLACE FUNCTION get_delivery_fee_estimate(
  p_store_id uuid,
  p_dest_lat double precision,
  p_dest_lng double precision
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_store stores;
BEGIN
  SELECT * INTO v_store FROM stores WHERE id = p_store_id;

  IF v_store IS NULL OR v_store.lat IS NULL OR v_store.lng IS NULL THEN
    RAISE EXCEPTION '매장 위치가 설정되지 않았어요';
  END IF;

  RETURN calculate_delivery_fee(
    v_store.lat, v_store.lng, p_dest_lat, p_dest_lng,
    coalesce(v_store.delivery_tip_base_distance_m, 1500),
    coalesce(v_store.delivery_tip_base_fee, 4000),
    coalesce(v_store.delivery_tip_tier_distance_m, 100),
    coalesce(v_store.delivery_tip_tier_fee, 100)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION get_delivery_fee_estimate(uuid, double precision, double precision) TO anon, authenticated;
