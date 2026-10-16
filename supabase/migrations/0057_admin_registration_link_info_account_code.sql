-- done 화면에서 이용자 초대링크를 바로 발급하려면 account_code가 필요함.
-- 리턴 컬럼 목록이 바뀌므로 DROP 후 재생성.
DROP FUNCTION admin_registration_link_info(text);

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

  -- OUT 파라미터 account_code와 겹쳐서 테이블명으로 명시
  SELECT * INTO v_account FROM accounts WHERE accounts.account_code = v_link.account_code;

  IF v_link.status = 'completed' THEN
    RETURN QUERY SELECT false, 'already_registered', NULL::text, NULL::text, v_account.account_name, NULL::text, NULL::text, NULL::integer, v_account.account_code;
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
GRANT EXECUTE ON FUNCTION admin_registration_link_info(text) TO anon, authenticated;
