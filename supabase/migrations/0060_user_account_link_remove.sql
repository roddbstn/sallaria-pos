-- 이용자 해제. status에 'removed' 추가 + 해제 RPC (관리자만, 마지막 승인 관리자 자기해제는 막음).
ALTER TABLE user_account_links DROP CONSTRAINT user_account_links_status_check;
ALTER TABLE user_account_links ADD CONSTRAINT user_account_links_status_check
  CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected', 'removed']));

CREATE OR REPLACE FUNCTION user_account_link_remove(p_link_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target user_account_links;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요해요';
  END IF;

  SELECT * INTO v_target FROM user_account_links WHERE id = p_link_id;
  IF v_target IS NULL THEN
    RAISE EXCEPTION '대상을 찾을 수 없어요';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_account_links
    WHERE user_account_links.account_code = v_target.account_code AND user_account_links.user_id = auth.uid()
      AND user_account_links.role = '관리자' AND user_account_links.status = 'approved'
  ) THEN
    RAISE EXCEPTION '관리자만 해제할 수 있어요';
  END IF;

  -- 이 계정에 남는 승인된 관리자가 자신뿐이면 자기 자신 해제 금지 (관리자 0명 계정 방지)
  IF v_target.user_id = auth.uid() AND v_target.role = '관리자' AND (
    SELECT count(*) FROM user_account_links
    WHERE account_code = v_target.account_code AND role = '관리자' AND status = 'approved'
  ) <= 1 THEN
    RAISE EXCEPTION '마지막 관리자는 스스로를 해제할 수 없어요';
  END IF;

  UPDATE user_account_links SET status = 'removed' WHERE id = p_link_id;
END;
$$;
GRANT EXECUTE ON FUNCTION user_account_link_remove(uuid) TO authenticated;
