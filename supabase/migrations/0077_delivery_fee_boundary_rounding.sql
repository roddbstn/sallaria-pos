-- 배달료가 경계에서 한 칸 더 붙던 것. (2026-10-30)
--
-- ── 무엇이 문제였나 ────────────────────────────────────────────────────────
-- Haversine 을 double 로 계산하는데, 결과가 의도한 거리보다 백만분의 1m쯤 크게 나온다.
-- 그 티끌을 아래 ceil 이 **한 칸으로 키웠다**:
--
--     2000m 손님 → 2000.000001743
--     (2000.000001743 - 1500) / 100 = 5.00000001743 → ceil → 6칸
--     → 4,600원.  4,500원이어야 한다.
--
-- 실측(2026-10-30, 기본 1500m/4000원 · 100m당 100원):
--     거리      고치기 전   고친 뒤
--     1600m      4,200      4,100
--     2000m      4,600      4,500
--     5000m      7,600      7,500
--
-- 경계에 선 손님만 까닭 없이 한 칸을 더 냈다. 금액이 작아 아무도 신고하지 않았겠지만,
-- 설정 화면(매장 정보 > 배달 정보)이 보여주는 미리보기와도 어긋났다 —
-- 미리보기는 500/1000/2000처럼 **딱 떨어지는 거리**를 쓰는데 하필 거기가 어긋나는 자리다.
--
-- ── 어떻게 고쳤나 ──────────────────────────────────────────────────────────
-- 거리를 mm 자리에서 끊는다(numeric, 소수 3자리). 배달 거리에서 mm 아래는 아무 뜻이 없고,
-- 그 아래를 버리면 부동소수 티끌이 통째로 사라진다. 진짜 2000.6m 는 그대로 6칸이다.
--
-- 덤으로 단위거리 0 가드도 넣었다. 설정 화면이 0 저장을 막지만, DB 가 0으로 나누면
-- 함수 전체가 터져서 주문이 안 들어간다 — 스스로 버티게 둔다.

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
  v_distance_m numeric;
  v_extra_m    numeric;
  v_tier_count integer;
BEGIN
  v_distance_m := round((6371000 * acos(
    LEAST(1.0, GREATEST(-1.0,
      cos(radians(p_store_lat)) * cos(radians(p_dest_lat)) * cos(radians(p_dest_lng) - radians(p_store_lng))
      + sin(radians(p_store_lat)) * sin(radians(p_dest_lat))
    ))
  ))::numeric, 3);

  IF v_distance_m <= p_base_distance_m THEN
    RETURN p_base_fee;
  END IF;

  IF p_tier_distance_m <= 0 THEN
    RETURN p_base_fee;
  END IF;

  v_extra_m    := v_distance_m - p_base_distance_m;
  v_tier_count := ceil(v_extra_m / p_tier_distance_m);
  RETURN p_base_fee + (v_tier_count * p_tier_fee);
END;
$$;
