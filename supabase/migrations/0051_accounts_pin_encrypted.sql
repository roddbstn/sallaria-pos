-- accounts.pin_code는 레거시 평문 4자리 PIN 전용(character(4)) — kakao 흐름의 암호화된 PIN을
-- 여기 넣으려다 "value too long for type character(4)" 에러가 났음. 별도 컬럼으로 분리.
-- legacy 계정은 계속 pin_code(평문)를 쓰고, kakao 계정은 pin_encrypted(암호화)를 씀.
ALTER TABLE accounts ADD COLUMN pin_encrypted text;

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
  VALUES (auth.uid(), v_link.account_code, v_account.store_id, '관리자', 'approved', now());

  UPDATE accounts SET pin_encrypted = p_pin_encrypted WHERE account_code = v_link.account_code;

  UPDATE admin_registration_links
  SET status = 'completed', consumed_at = now()
  WHERE id = v_link.id;
END;
$$;
