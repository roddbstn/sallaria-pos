-- 전화번호 OTP 인증 모듈 (#3 이용자 등록 흐름용).
-- 코드는 해시로만 저장, 평문은 이 함수 안에서만 존재하고 send-notification으로 즉시 발송됨.
CREATE TABLE phone_otp_verifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text NOT NULL,
  code_hash     text NOT NULL,
  purpose       text NOT NULL,
  attempt_count int NOT NULL DEFAULT 0,
  verified_at   timestamptz,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX phone_otp_verifications_phone_idx ON phone_otp_verifications (phone, created_at DESC);

ALTER TABLE phone_otp_verifications ENABLE ROW LEVEL SECURITY;
-- 정책 없음 — 아래 SECURITY DEFINER 함수로만 접근

CREATE OR REPLACE FUNCTION phone_otp_request(p_phone text, p_purpose text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
  v_code text;
  v_last_request timestamptz;
BEGIN
  SELECT created_at INTO v_last_request
  FROM phone_otp_verifications
  WHERE phone = p_phone
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_last_request IS NOT NULL AND v_last_request > now() - interval '1 minute' THEN
    RAISE EXCEPTION '잠시 후 다시 시도해 주세요';
  END IF;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');

  INSERT INTO phone_otp_verifications (phone, code_hash, purpose, expires_at)
  VALUES (p_phone, encode(digest(v_code, 'sha256'), 'hex'), p_purpose, now() + interval '5 minutes')
  RETURNING id INTO v_id;

  PERFORM net.http_post(
    url := 'https://fcaoakdlbecamoyeqyha.supabase.co/functions/v1/send-notification',
    body := jsonb_build_object('purpose', 'otp', 'phone', p_phone, 'params', jsonb_build_object('code', v_code)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjYW9ha2RsYmVjYW1veWVxeWhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMTY1OTYsImV4cCI6MjA5Njc5MjU5Nn0.FlHwYKyddPR_ufi-vCOBFWzgSKE-_xsgGjypV6JVLpY'
    )
  );

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION phone_otp_verify(p_otp_id uuid, p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row phone_otp_verifications;
BEGIN
  SELECT * INTO v_row FROM phone_otp_verifications WHERE id = p_otp_id FOR UPDATE;

  IF v_row IS NULL OR v_row.expires_at < now() OR v_row.attempt_count >= 5 THEN
    RETURN false;
  END IF;

  IF v_row.code_hash = encode(digest(p_code, 'sha256'), 'hex') THEN
    UPDATE phone_otp_verifications SET verified_at = now() WHERE id = p_otp_id;
    RETURN true;
  ELSE
    UPDATE phone_otp_verifications SET attempt_count = attempt_count + 1 WHERE id = p_otp_id;
    RETURN false;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION phone_otp_request(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION phone_otp_verify(uuid, text) TO anon, authenticated;
