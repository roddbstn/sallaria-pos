-- 거래처 공유 PIN 검증 + 5회 실패 잠금(카카오 계정+거래처 조합 기준).
-- record_pin_attempt(옛 개인별 PIN용)는 애초에 DB에 존재하지도 않던 죽은 코드였음 — 새로 만듦.
ALTER TABLE user_account_links ADD COLUMN pin_attempt_count int NOT NULL DEFAULT 0;
ALTER TABLE user_account_links ADD COLUMN pin_locked_until timestamptz;

CREATE OR REPLACE FUNCTION record_account_pin_attempt(p_account_code uuid, p_success boolean)
RETURNS TABLE (reason text, attempts_left int, locked_until timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link user_account_links;
  v_new_count int;
  v_lock timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요해요';
  END IF;

  SELECT * INTO v_link FROM user_account_links
  WHERE account_code = p_account_code AND user_id = auth.uid() AND status = 'approved'
  ORDER BY created_at DESC LIMIT 1;

  IF v_link IS NULL THEN
    RAISE EXCEPTION '권한이 없어요';
  END IF;

  IF v_link.pin_locked_until IS NOT NULL AND v_link.pin_locked_until > now() THEN
    RETURN QUERY SELECT 'locked', 0, v_link.pin_locked_until;
    RETURN;
  END IF;

  IF p_success THEN
    UPDATE user_account_links SET pin_attempt_count = 0, pin_locked_until = NULL WHERE id = v_link.id;
    RETURN QUERY SELECT 'ok', 5, NULL::timestamptz;
    RETURN;
  END IF;

  v_new_count := v_link.pin_attempt_count + 1;
  v_lock := CASE WHEN v_new_count >= 5 THEN now() + interval '5 minutes' ELSE NULL END;

  UPDATE user_account_links SET pin_attempt_count = v_new_count, pin_locked_until = v_lock WHERE id = v_link.id;

  IF v_lock IS NOT NULL THEN
    RETURN QUERY SELECT 'locked', 0, v_lock;
  ELSE
    RETURN QUERY SELECT 'wrong_pin', 5 - v_new_count, NULL::timestamptz;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION record_account_pin_attempt(uuid, boolean) TO anon, authenticated;
