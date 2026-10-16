-- 관리자 최초 등록 링크(1회용, 무기한 유효) 저장 테이블
CREATE TABLE admin_registration_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code uuid NOT NULL REFERENCES accounts(account_code),
  token        text NOT NULL UNIQUE,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_registration_links_pending_idx
  ON admin_registration_links (account_code) WHERE consumed_at IS NULL;

ALTER TABLE admin_registration_links ENABLE ROW LEVEL SECURITY;
-- 정책을 두지 않음 — 아래 SECURITY DEFINER 함수를 통해서만 접근

-- 점주(sunpos)가 고객 추가 시 또는 재발송 버튼 클릭 시 호출.
-- 이미 관리자 등록이 완료된 계정이면 막고, 기존 미소진 링크는 무효화(삭제) 후 새 링크 발급.
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

  DELETE FROM admin_registration_links
  WHERE account_code = p_account_code AND consumed_at IS NULL;

  v_token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO admin_registration_links (account_code, token)
  VALUES (p_account_code, v_token);

  RETURN v_token;
END;
$$;

-- 관리자 등록 링크를 받은 사람이 카카오 로그인 + PIN 설정을 마쳤을 때 호출.
-- auth.uid()로 현재 로그인된 사람을 그대로 관리자로 연결 (클라이언트가 준 id를 신뢰하지 않음).
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
  WHERE token = p_token AND consumed_at IS NULL
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

  UPDATE admin_registration_links SET consumed_at = now() WHERE id = v_link.id;
END;
$$;
