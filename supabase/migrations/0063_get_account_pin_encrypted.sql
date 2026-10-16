-- /api/pin 의 verify_account 액션이 accounts.pin_encrypted를 직접 select 하는데,
-- accounts의 RLS(anon만 읽기 허용, authenticated는 점주 소유 매장 전용)에 막혀
-- 카카오 로그인한 이용자는 자기 계정 PIN도 못 읽는 버그가 있었음. SECURITY DEFINER RPC로 우회.
CREATE OR REPLACE FUNCTION get_account_pin_encrypted(p_account_code uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pin text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요해요';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_account_links
    WHERE account_code = p_account_code AND user_id = auth.uid() AND status = 'approved'
  ) THEN
    RAISE EXCEPTION '권한이 없어요';
  END IF;

  SELECT pin_encrypted INTO v_pin FROM accounts WHERE account_code = p_account_code;
  RETURN v_pin;
END;
$$;
GRANT EXECUTE ON FUNCTION get_account_pin_encrypted(uuid) TO authenticated;
