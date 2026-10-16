-- 설정화면(관리자)에서 이용자 목록 조회. get_account_admin_users(0045)는 점주 Electron 앱의
-- clients.auth_user_id 인증 경로 전제라 카카오 auth.uid() 경로에선 재사용 불가 — 새로 만듦.
CREATE OR REPLACE FUNCTION get_my_account_members(p_account_code uuid)
RETURNS TABLE (
  link_id      uuid,
  user_id      uuid,
  role         text,
  status       text,
  nickname     text,
  phone        text,
  created_at   timestamptz,
  approved_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_account_links
    WHERE user_account_links.account_code = p_account_code AND user_account_links.user_id = auth.uid()
      AND user_account_links.role = '관리자' AND user_account_links.status = 'approved'
  ) THEN
    RAISE EXCEPTION '관리자만 조회할 수 있어요';
  END IF;

  RETURN QUERY
  SELECT ual.id, ual.user_id, ual.role, ual.status, su.nickname, su.phone, ual.created_at, ual.approved_at
  FROM user_account_links ual
  JOIN sunpos_users su ON su.id = ual.user_id
  WHERE ual.account_code = p_account_code
  ORDER BY (ual.role = '관리자') DESC, ual.created_at ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION get_my_account_members(uuid) TO authenticated;
