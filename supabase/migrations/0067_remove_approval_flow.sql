-- "초대링크 one-way 등록" 체제로 전환. OTP 기반 승인요청/승인 흐름 전체 제거.
-- 이유: 초대링크 자체가 관리자가 준 것이므로 그게 곧 승인 — 별도 승인 대기가 불필요한 리소스.
DROP FUNCTION user_registration_request(p_account_code uuid, p_phone text, p_otp_id uuid);
DROP FUNCTION user_registration_approve(p_token text, p_decision text);
DROP FUNCTION phone_otp_request(p_phone text, p_purpose text);
DROP FUNCTION phone_otp_verify(p_otp_id uuid, p_code text);
DROP TABLE user_approval_tokens;
DROP TABLE phone_otp_verifications;

-- PIN은 이제 점주가 계정 생성 시점에 매장에서 바로 설정(accounts.pin_encrypted) —
-- 온라인 관리자 등록 흐름에서 PIN 단계 자체가 사라짐.
DROP FUNCTION admin_registration_complete(p_token text, p_pin_encrypted text);

CREATE OR REPLACE FUNCTION admin_registration_complete(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link    admin_registration_links;
  v_account accounts;
  v_link_id uuid;
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
  VALUES (auth.uid(), v_link.account_code, v_account.store_id, '관리자', 'approved', now())
  RETURNING id INTO v_link_id;

  INSERT INTO user_account_link_status_history (link_id, status, changed_by)
  VALUES (v_link_id, 'approved', auth.uid());

  UPDATE admin_registration_links
  SET status = 'completed', consumed_at = now()
  WHERE id = v_link.id;
END;
$$;

-- done 화면에서 "잔액부족시 OOO로 알림톡" 한 줄 표시용 — already_registered 분기에도
-- contact_phone/current_balance를 채워서 반환 (기존엔 NULL이었음)
CREATE OR REPLACE FUNCTION admin_registration_link_info(p_token text)
RETURNS TABLE (
  valid           boolean,
  reason          text,
  store_name      text,
  store_address   text,
  account_name    text,
  contact_person  text,
  contact_phone   text,
  current_balance integer,
  account_code    uuid
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
    RETURN QUERY SELECT false, 'invalid', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  IF v_link.status = 'superseded' THEN
    RETURN QUERY SELECT false, 'superseded', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_account FROM accounts WHERE accounts.account_code = v_link.account_code;

  IF v_link.status = 'completed' THEN
    RETURN QUERY SELECT
      false, 'already_registered', NULL::text, NULL::text,
      v_account.account_name, NULL::text, v_account.contact_phone,
      v_account.current_balance, v_account.account_code;
    RETURN;
  END IF;

  IF v_account IS NULL OR v_account.is_active = false THEN
    RETURN QUERY SELECT false, 'account_inactive', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_store FROM stores WHERE id = v_account.store_id;

  RETURN QUERY SELECT
    true, NULL::text,
    v_store.name, v_store.address,
    v_account.account_name, v_account.contact_person, v_account.contact_phone,
    v_account.current_balance, v_account.account_code;
END;
$$;

-- 초대링크 "one-way" 등록: 링크를 쓰는 즉시 승인(approved) — 관리자가 링크를 준 것 자체가 승인.
CREATE OR REPLACE FUNCTION user_invite_complete(p_token text)
RETURNS TABLE (account_code uuid, account_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link     user_invite_links;
  v_account  accounts;
  v_existing user_account_links;
  v_link_id  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요해요';
  END IF;

  SELECT * INTO v_link FROM user_invite_links WHERE user_invite_links.token = p_token;
  IF v_link IS NULL OR v_link.revoked_at IS NOT NULL OR v_link.expires_at < now() THEN
    RAISE EXCEPTION '유효하지 않은 초대링크예요';
  END IF;

  SELECT * INTO v_account FROM accounts WHERE accounts.account_code = v_link.account_code;
  IF v_account IS NULL OR v_account.is_active = false THEN
    RAISE EXCEPTION '더 이상 유효하지 않은 거래처예요';
  END IF;

  SELECT * INTO v_existing FROM user_account_links
  WHERE user_account_links.account_code = v_link.account_code AND user_id = auth.uid()
  ORDER BY created_at DESC LIMIT 1;

  IF v_existing IS NOT NULL AND v_existing.status = 'approved' THEN
    RETURN QUERY SELECT v_account.account_code, v_account.account_name;
    RETURN;
  END IF;

  IF v_existing IS NOT NULL THEN
    v_link_id := v_existing.id;
    UPDATE user_account_links SET status = 'approved', approved_at = now() WHERE id = v_link_id;
  ELSE
    INSERT INTO user_account_links (user_id, account_code, store_id, role, status, approved_at)
    VALUES (auth.uid(), v_link.account_code, v_account.store_id, '이용자', 'approved', now())
    RETURNING id INTO v_link_id;
  END IF;

  INSERT INTO user_account_link_status_history (link_id, status, changed_by)
  VALUES (v_link_id, 'approved', auth.uid());

  RETURN QUERY SELECT v_account.account_code, v_account.account_name;
END;
$$;
GRANT EXECUTE ON FUNCTION user_invite_complete(text) TO authenticated;
