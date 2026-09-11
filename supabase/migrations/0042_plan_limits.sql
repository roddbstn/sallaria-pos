-- ============================================================
-- SunPOS 요금제별 기능 한도 테이블
-- plan_tier ENUM은 0041_plan_column.sql 에서 이미 생성됨
-- ============================================================

CREATE TABLE IF NOT EXISTS plan_limits (
  plan                  plan_tier PRIMARY KEY,
  max_accounts          integer   NOT NULL DEFAULT 1,   -- -1 = 제한 없음
  max_stores            integer   NOT NULL DEFAULT 1,   -- -1 = 제한 없음
  sms_enabled           boolean   NOT NULL DEFAULT false,
  analytics_enabled     boolean   NOT NULL DEFAULT false,
  menu_images_enabled   boolean   NOT NULL DEFAULT false,
  qr_order_enabled      boolean   NOT NULL DEFAULT true
);

-- 기능 정의 데이터
INSERT INTO plan_limits
  (plan,    max_accounts, max_stores, sms_enabled, analytics_enabled, menu_images_enabled, qr_order_enabled)
VALUES
  ('free',   1,           1,          false,        false,             false,               true),
  ('basic',  10,          1,          false,        true,              true,                true),
  ('pro',    20,          1,          true,         true,              true,                true),
  ('max',   -1,          -1,          true,         true,              true,                true)
ON CONFLICT (plan) DO UPDATE SET
  max_accounts        = EXCLUDED.max_accounts,
  max_stores          = EXCLUDED.max_stores,
  sms_enabled         = EXCLUDED.sms_enabled,
  analytics_enabled   = EXCLUDED.analytics_enabled,
  menu_images_enabled = EXCLUDED.menu_images_enabled,
  qr_order_enabled    = EXCLUDED.qr_order_enabled;

-- RLS: anon 포함 누구든 읽기 허용 (요금제 정보는 공개)
ALTER TABLE plan_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plan_limits 읽기 허용" ON plan_limits;
CREATE POLICY "plan_limits 읽기 허용"
  ON plan_limits FOR SELECT
  USING (true);
