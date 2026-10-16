-- stores 테이블에 onboarding_completed 컬럼 추가
-- 온보딩 4단계 "시작하기" 클릭 시 TRUE로 설정됨
-- FALSE인 채로 stores 행이 존재하면 온보딩 미완 → 온보딩으로 다시 보냄
ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE;

-- 기존 매장은 이미 온보딩이 완료된 것으로 간주
UPDATE stores SET onboarding_completed = TRUE WHERE onboarding_completed = FALSE;
