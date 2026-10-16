-- admin_registration_links에 status 추가 — DELETE로 지우면 "재발송으로 대체됨"과
-- "URL이 원래부터 잘못됨"을 구분할 수 없어서, 소진/대체 여부를 남겨두는 방식으로 변경.
ALTER TABLE admin_registration_links
  ADD COLUMN status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'completed', 'superseded'));

CREATE OR REPLACE FUNCTION admin_registration_issue_link(p_account_code uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM accounts a
    JOIN stores s   ON s.id = a.store_id
    JOIN clients c  ON c.id = s.client_id
    WHERE a.account_code = p_account_code AND c.auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION '권한이 없어요';
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_account_links
    WHERE account_code = p_account_code AND role = '관리자' AND status = 'approved'
  ) THEN
    RAISE EXCEPTION '이미 관리자 등록이 완료된 계정이에요';
  END IF;

  UPDATE admin_registration_links
  SET status = 'superseded'
  WHERE account_code = p_account_code AND status = 'pending';

  v_token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO admin_registration_links (account_code, token)
  VALUES (p_account_code, v_token);

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION admin_registration_complete(p_token text, p_pin_encrypted text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link    admin_registration_links;
  v_account accounts;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요해요';
  END IF;

  SELECT * INTO v_link FROM admin_registration_links
  WHERE token = p_token AND status = 'pending'
  FOR UPDATE;

  IF v_link IS NULL THEN
    RAISE EXCEPTION '유효하지 않은 링크예요';
  END IF;

  SELECT * INTO v_account FROM accounts WHERE account_code = v_link.account_code;

  IF v_account IS NULL OR v_account.is_active = false THEN
    RAISE EXCEPTION '더 이상 유효하지 않은 거래처예요';
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_account_links
    WHERE account_code = v_link.account_code AND role = '관리자' AND status = 'approved'
  ) THEN
    RAISE EXCEPTION '이미 관리자 등록이 완료된 계정이에요';
  END IF;

  INSERT INTO user_account_links (user_id, account_code, store_id, role, status, approved_at)
  VALUES (auth.uid(), v_link.account_code, v_account.store_id, '관리자', 'approved', now());

  UPDATE accounts SET pin_code = p_pin_encrypted WHERE account_code = v_link.account_code;

  UPDATE admin_registration_links
  SET status = 'completed', consumed_at = now()
  WHERE id = v_link.id;
END;
$$;

-- 링크를 열었을 때(로그인 전) 화면에 보여줄 정보 + 예외 분기 판정. anon도 호출 가능해야 함
-- (로그인 전 화면이므로) — 그래서 SECURITY DEFINER로 accounts/stores를 직접 안 노출하고 필요한 값만 내려줌.
CREATE OR REPLACE FUNCTION admin_registration_link_info(p_token text)
RETURNS TABLE (
  valid          boolean,
  reason         text,
  store_name     text,
  store_address  text,
  account_name   text,
  contact_person text,
  contact_phone  text,
  current_balance integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link    admin_registration_links;
  v_account accounts;
  v_store   stores;
BEGIN
  SELECT * INTO v_link FROM admin_registration_links WHERE token = p_token;

  IF v_link IS NULL THEN
    RETURN QUERY SELECT false, 'invalid', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  IF v_link.status = 'superseded' THEN
    RETURN QUERY SELECT false, 'superseded', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  IF v_link.status = 'completed' THEN
    RETURN QUERY SELECT false, 'already_registered', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  SELECT * INTO v_account FROM accounts WHERE account_code = v_link.account_code;

  IF v_account IS NULL OR v_account.is_active = false THEN
    RETURN QUERY SELECT false, 'account_inactive', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  SELECT * INTO v_store FROM stores WHERE id = v_account.store_id;

  RETURN QUERY SELECT
    true, NULL::text,
    v_store.name, v_store.address,
    v_account.account_name, v_account.contact_person, v_account.contact_phone,
    v_account.current_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_registration_link_info(text) TO anon, authenticated;
