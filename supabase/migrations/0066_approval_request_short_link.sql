-- 승인요청 알림 링크를 단축링크로 교체 (문자 단문 요금 유도).
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
  v_short_code text;
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

  -- 문자 단문 요금 유도를 위한 단축링크
  v_short_code := create_short_link('https://sunpos-kakao.vercel.app/approve/' || v_approval_token);

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
          'link', 'https://sunpos-kakao.vercel.app/s/' || v_short_code
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
