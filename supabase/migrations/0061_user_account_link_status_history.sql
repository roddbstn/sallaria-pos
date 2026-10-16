-- "이 사람이 언제까지 승인대기였는지" 같은 이력 조회를 위한 상태 전환 감사 로그.
-- pending→approved→removed→pending... 전체 사이클을 보존 (단일 컬럼 덮어쓰기 대신).
CREATE TABLE user_account_link_status_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id    uuid NOT NULL REFERENCES user_account_links(id) ON DELETE CASCADE,
  status     text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES auth.users(id)
);
ALTER TABLE user_account_link_status_history ENABLE ROW LEVEL SECURITY;

-- 1) 관리자 등록 완료 시 최초 'approved' 기록
CREATE OR REPLACE FUNCTION admin_registration_complete(p_token text, p_pin_encrypted text)
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

  UPDATE accounts SET pin_encrypted = p_pin_encrypted WHERE account_code = v_link.account_code;

  UPDATE admin_registration_links
  SET status = 'completed', consumed_at = now()
  WHERE id = v_link.id;
END;
$$;

-- 2) 이용자 등록요청(신규/재요청) 시 'pending' 기록
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

  INSERT INTO user_account_link_status_history (link_id, status, changed_by)
  VALUES (v_req_id, 'pending', auth.uid());

  UPDATE user_approval_tokens SET status = 'processed' WHERE link_id = v_req_id AND user_approval_tokens.status = 'pending';
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

-- 3) 승인/거절 시 'approved'/'rejected' 기록
-- 주의: 이 함수는 토큰 기반(로그인 불필요)이라 auth.uid()로 실행자를 특정할 수 없음 — changed_by는 NULL로 남음.
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

  INSERT INTO user_account_link_status_history (link_id, status, changed_by)
  VALUES (v_link.id, CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END, NULL);

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

-- 4) 이용자 해제 시 'removed' 기록
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

  IF v_target.user_id = auth.uid() AND v_target.role = '관리자' AND (
    SELECT count(*) FROM user_account_links
    WHERE account_code = v_target.account_code AND role = '관리자' AND status = 'approved'
  ) <= 1 THEN
    RAISE EXCEPTION '마지막 관리자는 스스로를 해제할 수 없어요';
  END IF;

  UPDATE user_account_links SET status = 'removed' WHERE id = p_link_id;

  INSERT INTO user_account_link_status_history (link_id, status, changed_by)
  VALUES (p_link_id, 'removed', auth.uid());
END;
$$;
