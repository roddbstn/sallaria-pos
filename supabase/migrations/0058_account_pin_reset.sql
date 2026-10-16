-- 거래처 공유 PIN 재설정. 계정 전체에 영향을 주는 만큼 관리자만 가능.
-- 재설정 시 이 거래처에 연결된 모든 이용자/관리자의 PIN 시도횟수·잠금도 함께 초기화.
CREATE OR REPLACE FUNCTION account_pin_reset(p_account_code uuid, p_pin_encrypted text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요해요';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_account_links
    WHERE account_code = p_account_code AND user_id = auth.uid() AND role = '관리자' AND status = 'approved'
  ) THEN
    RAISE EXCEPTION '관리자만 PIN을 재설정할 수 있어요';
  END IF;

  UPDATE accounts SET pin_encrypted = p_pin_encrypted WHERE accounts.account_code = p_account_code;

  UPDATE user_account_links
  SET pin_attempt_count = 0, pin_locked_until = NULL
  WHERE user_account_links.account_code = p_account_code;
END;
$$;
GRANT EXECUTE ON FUNCTION account_pin_reset(uuid, text) TO authenticated;
