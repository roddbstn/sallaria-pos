-- 거래처 고정 QR(/qr/[accountCode]) 진입점용 조회 RPC.
-- 로그인 전/후 공통으로 호출 — 로그인 전엔 link_status가 'none'으로 나옴.
CREATE OR REPLACE FUNCTION qr_account_info(p_account_code uuid)
RETURNS TABLE (
  valid           boolean,
  reason          text,
  store_id        uuid,
  store_name      text,
  account_name    text,
  current_balance integer,
  link_id         uuid,
  role            text,
  link_status     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account accounts;
  v_store   stores;
  v_link    user_account_links;
BEGIN
  SELECT * INTO v_account FROM accounts WHERE accounts.account_code = p_account_code;
  IF v_account IS NULL OR v_account.is_active = false THEN
    RETURN QUERY SELECT false, 'invalid', NULL::uuid, NULL::text, NULL::text, NULL::integer, NULL::uuid, NULL::text, 'none'::text;
    RETURN;
  END IF;

  SELECT * INTO v_store FROM stores WHERE stores.id = v_account.store_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT * INTO v_link FROM user_account_links
    WHERE user_account_links.account_code = p_account_code AND user_id = auth.uid()
    ORDER BY created_at DESC LIMIT 1;
  END IF;

  RETURN QUERY SELECT
    true, NULL::text,
    v_store.id, v_store.name,
    v_account.account_name, v_account.current_balance,
    v_link.id, v_link.role,
    coalesce(v_link.status, 'none');
END;
$$;
GRANT EXECUTE ON FUNCTION qr_account_info(uuid) TO anon, authenticated;
