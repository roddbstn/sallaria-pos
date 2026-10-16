-- user_account_links.role: 개인/담당자/일반멤버(3종) → 관리자/이용자(2종)로 단순화
-- 개인 거래처의 유일한 사용자도 '관리자'로 취급 (관리자 1명 = 이용자 1명인 상태)
ALTER TABLE user_account_links DROP CONSTRAINT user_account_links_role_check;

UPDATE user_account_links SET role = '관리자' WHERE role IN ('개인', '담당자');
UPDATE user_account_links SET role = '이용자' WHERE role = '일반멤버';

ALTER TABLE user_account_links ADD CONSTRAINT user_account_links_role_check
  CHECK (role IN ('관리자', '이용자'));

-- sunpos(점주) 고객 상세 모달에서 관리자/이용자 목록을 보여주기 위한 조회용 RPC.
-- user_account_links.user_id는 auth.users를 가리키고 sunpos_users도 auth.users.id를 PK로 쓰므로,
-- PostgREST 자동 embed 대상이 아니라 SQL JOIN으로 직접 묶어서 내려준다.
CREATE OR REPLACE FUNCTION get_account_admin_users(p_account_code uuid)
RETURNS TABLE (
  role text,
  status text,
  name text,
  phone text,
  approved_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ual.role,
    ual.status,
    su.nickname AS name,
    su.phone,
    ual.approved_at,
    ual.created_at
  FROM user_account_links ual
  JOIN sunpos_users su ON su.id = ual.user_id
  WHERE ual.account_code = p_account_code
  ORDER BY (ual.role = '관리자') DESC, ual.created_at ASC;
$$;
