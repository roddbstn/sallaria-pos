-- admin_registration_issue_link이 gen_random_bytes를 스키마 미지정으로 호출해서
-- "function gen_random_bytes(integer) does not exist" 에러 발생 (pgcrypto는 extensions 스키마에 있음).
-- user_invite_issue_link / create_short_link와 동일하게 extensions.gen_random_bytes로 수정.
CREATE OR REPLACE FUNCTION public.admin_registration_issue_link(p_account_code uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  INSERT INTO admin_registration_links (account_code, token)
  VALUES (p_account_code, v_token);

  RETURN v_token;
END;
$function$;
