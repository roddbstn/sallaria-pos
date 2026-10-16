-- admin_registration_link_info: 'already_registered'(status='completed') 분기에서도
-- account_name을 내려주도록 보강 — 관리자 등록 완료 화면에서 계정명을 보여주기 위함.
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

  SELECT * INTO v_account FROM accounts WHERE account_code = v_link.account_code;

  IF v_link.status = 'completed' THEN
    RETURN QUERY SELECT false, 'already_registered', NULL::text, NULL::text, v_account.account_name, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

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
