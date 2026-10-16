-- #3 이용자 등록 흐름: 초대링크 발급, 등록요청(OTP검증후), 승인/거절 처리.

CREATE TABLE user_invite_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code uuid NOT NULL REFERENCES accounts(account_code) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_invite_links ENABLE ROW LEVEL SECURITY;

CREATE TABLE user_approval_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id    uuid NOT NULL REFERENCES user_account_links(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_approval_tokens ENABLE ROW LEVEL SECURITY;

-- 관리자가 호출 — 초대링크 발급 (3일 유효, 재발급시 기존 것 무효화)
CREATE OR REPLACE FUNCTION user_invite_issue_link(p_account_code uuid)
RETURNS TABLE (token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_expires timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_account_links
    WHERE user_account_links.account_code = p_account_code AND user_id = auth.uid() AND role = '관리자' AND status = 'approved'
  ) THEN
    RAISE EXCEPTION '권한이 없어요';
  END IF;

  -- OUT 파라미터 expires_at과 테이블 컬럼명이 겹쳐서 반드시 테이블명으로 명시해야 함
  UPDATE user_invite_links SET revoked_at = now()
  WHERE user_invite_links.account_code = p_account_code AND user_invite_links.revoked_at IS NULL AND user_invite_links.expires_at > now();

  -- gen_random_bytes는 pgcrypto(extensions 스키마) 소속이라 스키마 명시 필요
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_expires := now() + interval '3 days';

  INSERT INTO user_invite_links (account_code, token, expires_at)
  VALUES (p_account_code, v_token, v_expires);

  RETURN QUERY SELECT v_token, v_expires;
END;
$$;

-- 초대링크 정보 조회 (로그인 전, anon 호출)
CREATE OR REPLACE FUNCTION user_invite_link_info(p_token text)
RETURNS TABLE (
  valid       boolean,
  reason      text,
  store_name  text,
  account_name text,
  account_code uuid,
  admin_name  text,
  expires_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link    user_invite_links;
  v_account accounts;
  v_store   stores;
  v_admin_name text;
BEGIN
  -- OUT 파라미터 account_code/expires_at과 테이블 컬럼명이 겹쳐서 테이블명으로 명시함
  SELECT * INTO v_link FROM user_invite_links WHERE user_invite_links.token = p_token;

  IF v_link IS NULL THEN
    RETURN QUERY SELECT false, 'invalid', NULL::text, NULL::text, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_link.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'revoked', NULL::text, NULL::text, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_link.expires_at < now() THEN
    RETURN QUERY SELECT false, 'expired', NULL::text, NULL::text, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT * INTO v_account FROM accounts WHERE accounts.account_code = v_link.account_code;
  IF v_account IS NULL OR v_account.is_active = false THEN
    RETURN QUERY SELECT false, 'account_inactive', NULL::text, NULL::text, NULL::uuid, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO v_store FROM stores WHERE stores.id = v_account.store_id;

  SELECT su.nickname INTO v_admin_name
  FROM user_account_links ual JOIN sunpos_users su ON su.id = ual.user_id
  WHERE ual.account_code = v_link.account_code AND ual.role = '관리자' AND ual.status = 'approved'
  LIMIT 1;

  RETURN QUERY SELECT true, NULL::text, v_store.name, v_account.account_name, v_account.account_code, v_admin_name, v_link.expires_at;
END;
$$;
GRANT EXECUTE ON FUNCTION user_invite_link_info(text) TO anon, authenticated;

-- 로그인된 사람이 이미 이 거래처 이용자/관리자인지 (초대 확인 화면의 "이미 등록되어 있어요" 분기용)
CREATE OR REPLACE FUNCTION user_account_link_status(p_account_code uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 'none'; END IF;
  SELECT status INTO v_status FROM user_account_links
  WHERE account_code = p_account_code AND user_id = auth.uid()
  ORDER BY created_at DESC LIMIT 1;
  RETURN coalesce(v_status, 'none');
END;
$$;
GRANT EXECUTE ON FUNCTION user_account_link_status(uuid) TO anon, authenticated;

-- OTP 인증된 전화번호로 이용자 등록요청 제출. 관리자에게 승인요청 알림도 여기서 트리거.
CREATE OR REPLACE FUNCTION user_registration_request(p_account_code uuid, p_phone text, p_otp_id uuid)
RETURNS TABLE (status text, request_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_otp      phone_otp_verifications;
  v_account  accounts;
  v_existing user_account_links;
  v_req_id   uuid;
  v_approval_token text;
  v_requester_name text;
  v_admin_phone text;
  v_store_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요해요';
  END IF;

  SELECT * INTO v_otp FROM phone_otp_verifications WHERE id = p_otp_id;
  IF v_otp IS NULL OR v_otp.verified_at IS NULL OR v_otp.phone <> p_phone
     OR v_otp.verified_at < now() - interval '10 minutes' THEN
    RAISE EXCEPTION '전화번호 인증이 필요해요';
  END IF;

  SELECT * INTO v_account FROM accounts WHERE account_code = p_account_code;
  IF v_account IS NULL OR v_account.is_active = false THEN
    RAISE EXCEPTION '유효하지 않은 거래처예요';
  END IF;

  -- 같은 전화번호가 이미 이 거래처에 승인된 이용자면 (계정 다르게 재요청해도) 차단
  IF EXISTS (
    SELECT 1 FROM user_account_links ual JOIN sunpos_users su ON su.id = ual.user_id
    WHERE ual.account_code = p_account_code AND ual.status = 'approved' AND su.phone = p_phone
  ) THEN
    RAISE EXCEPTION '이미 등록된 번호예요';
  END IF;

  SELECT * INTO v_existing FROM user_account_links
  WHERE account_code = p_account_code AND user_id = auth.uid()
  ORDER BY created_at DESC LIMIT 1;

  IF v_existing IS NOT NULL AND v_existing.status = 'approved' THEN
    RETURN QUERY SELECT 'already_registered', v_existing.id;
    RETURN;
  END IF;

  UPDATE sunpos_users SET phone = p_phone WHERE id = auth.uid();

  IF v_existing IS NOT NULL THEN
    UPDATE user_account_links SET status = 'pending', created_at = now()
    WHERE id = v_existing.id
    RETURNING id INTO v_req_id;
  ELSE
    INSERT INTO user_account_links (user_id, account_code, store_id, role, status)
    VALUES (auth.uid(), p_account_code, v_account.store_id, '이용자', 'pending')
    RETURNING id INTO v_req_id;
  END IF;

  -- 기존 미처리 승인토큰 있으면 재사용 안 하고 새로 발급 (중복문자는 아래서 막음)
  -- OUT 파라미터 status와 컬럼명이 겹쳐서 테이블명으로 명시
  UPDATE user_approval_tokens SET status = 'processed' WHERE link_id = v_req_id AND user_approval_tokens.status = 'pending';
  -- gen_random_bytes는 pgcrypto(extensions 스키마) 소속이라 스키마 명시 필요
  v_approval_token := encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO user_approval_tokens (link_id, token) VALUES (v_req_id, v_approval_token);

  SELECT su.nickname INTO v_requester_name FROM sunpos_users su WHERE su.id = auth.uid();
  SELECT su.phone INTO v_admin_phone
  FROM user_account_links ual JOIN sunpos_users su ON su.id = ual.user_id
  WHERE ual.account_code = p_account_code AND ual.role = '관리자' AND ual.status = 'approved'
  LIMIT 1;
  SELECT s.name INTO v_store_name FROM stores s WHERE s.id = v_account.store_id;

  IF v_admin_phone IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'https://fcaoakdlbecamoyeqyha.supabase.co/functions/v1/send-notification',
      body := jsonb_build_object(
        'purpose', 'approval_request',
        'phone', v_admin_phone,
        'params', jsonb_build_object(
          'storeName', v_store_name,
          'accountName', v_account.account_name,
          'requesterName', coalesce(v_requester_name, '이용자'),
          'link', 'https://sunpos-kakao.vercel.app/approve/' || v_approval_token
        )
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjYW9ha2RsYmVjYW1veWVxeWhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMTY1OTYsImV4cCI6MjA5Njc5MjU5Nn0.FlHwYKyddPR_ufi-vCOBFWzgSKE-_xsgGjypV6JVLpY'
      )
    );
  END IF;

  RETURN QUERY SELECT 'pending', v_req_id;
END;
$$;
GRANT EXECUTE ON FUNCTION user_registration_request(uuid, text, uuid) TO anon, authenticated;

-- 승인 처리 화면 정보 조회 (로그인 불필요, 토큰이 곧 권한)
CREATE OR REPLACE FUNCTION user_approval_info(p_token text)
RETURNS TABLE (
  valid          boolean,
  reason         text,
  store_name     text,
  account_name   text,
  requester_name text,
  requester_phone text,
  requested_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_at user_approval_tokens;
  v_link user_account_links;
  v_account accounts;
  v_store stores;
BEGIN
  SELECT * INTO v_at FROM user_approval_tokens WHERE token = p_token;
  IF v_at IS NULL THEN
    RETURN QUERY SELECT false, 'invalid', NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT * INTO v_link FROM user_account_links WHERE id = v_at.link_id;
  SELECT * INTO v_account FROM accounts WHERE account_code = v_link.account_code;
  SELECT * INTO v_store FROM stores WHERE id = v_account.store_id;

  IF v_at.status = 'processed' THEN
    RETURN QUERY SELECT false,
      (CASE v_link.status WHEN 'approved' THEN 'already_approved' WHEN 'rejected' THEN 'already_rejected' ELSE 'processed' END),
      v_store.name, v_account.account_name, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    true, NULL::text, v_store.name, v_account.account_name,
    (SELECT su.nickname FROM sunpos_users su WHERE su.id = v_link.user_id),
    (SELECT su.phone FROM sunpos_users su WHERE su.id = v_link.user_id),
    v_link.created_at;
END;
$$;
GRANT EXECUTE ON FUNCTION user_approval_info(text) TO anon, authenticated;

-- 승인/거절 처리
CREATE OR REPLACE FUNCTION user_registration_approve(p_token text, p_decision text)
RETURNS TABLE (requester_name text, account_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_at user_approval_tokens;
  v_link user_account_links;
  v_account accounts;
  v_store stores;
  v_requester_name text;
  v_requester_phone text;
BEGIN
  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION '잘못된 요청이에요';
  END IF;

  SELECT * INTO v_at FROM user_approval_tokens WHERE token = p_token FOR UPDATE;
  IF v_at IS NULL OR v_at.status = 'processed' THEN
    RAISE EXCEPTION '이미 처리된 요청이에요';
  END IF;

  SELECT * INTO v_link FROM user_account_links WHERE id = v_at.link_id;
  SELECT * INTO v_account FROM accounts WHERE account_code = v_link.account_code;
  SELECT * INTO v_store FROM stores WHERE id = v_account.store_id;
  SELECT su.nickname, su.phone INTO v_requester_name, v_requester_phone FROM sunpos_users su WHERE su.id = v_link.user_id;

  UPDATE user_account_links
  SET status = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
      approved_at = CASE WHEN p_decision = 'approve' THEN now() ELSE approved_at END
  WHERE id = v_link.id;

  UPDATE user_approval_tokens SET status = 'processed' WHERE id = v_at.id;

  IF v_requester_phone IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'https://fcaoakdlbecamoyeqyha.supabase.co/functions/v1/send-notification',
      body := jsonb_build_object(
        'purpose', 'approval_result',
        'phone', v_requester_phone,
        'params', jsonb_build_object(
          'storeName', v_store.name,
          'accountName', v_account.account_name,
          'approved', (p_decision = 'approve')
        )
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjYW9ha2RsYmVjYW1veWVxeWhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMTY1OTYsImV4cCI6MjA5Njc5MjU5Nn0.FlHwYKyddPR_ufi-vCOBFWzgSKE-_xsgGjypV6JVLpY'
      )
    );
  END IF;

  RETURN QUERY SELECT coalesce(v_requester_name, '이용자'), v_account.account_name;
END;
$$;
GRANT EXECUTE ON FUNCTION user_registration_approve(text, text) TO anon, authenticated;
