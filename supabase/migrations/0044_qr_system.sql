-- accounts 테이블에 qr_system 컬럼 추가
-- legacy = sallaria.web.app(PIN 기반, 기존 운영) / kakao = sunpos-kakao.vercel.app(카카오 로그인 기반, 신규)
-- default를 'legacy'로 잡아서 추가 → 기존 거래처는 전부 자동으로 legacy가 됨 (별도 UPDATE 불필요)
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS qr_system TEXT NOT NULL DEFAULT 'legacy'
  CHECK (qr_system IN ('legacy', 'kakao'));

-- 이후 신규 거래처부터는 기본값을 kakao로 전환
ALTER TABLE accounts
  ALTER COLUMN qr_system SET DEFAULT 'kakao';
