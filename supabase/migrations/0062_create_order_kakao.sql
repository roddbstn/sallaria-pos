-- 카카오 로그인 기반 주문 생성 RPC. 레거시 create_order는 zero-touch 원칙상 건드리지 않고
-- 가격/스냅샷 계산 로직만 동일하게 미러링, 카카오 신원(ordered_by_user_id/link_id)을 추가로 기록.
-- p_orderer_name 파라미터 없음 — 클라이언트 자유입력 대신 서버가 auth.uid()로 검증된 이름을 사용.
CREATE OR REPLACE FUNCTION create_order_kakao(
  p_account_code  uuid,
  p_method        order_method,
  p_items         jsonb,
  p_delivery_fee  integer DEFAULT 0,
  p_orderer_phone text DEFAULT NULL,
  p_note          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link            user_account_links;
  v_orderer_name    text;
  v_order_code      uuid;
  v_balance         int;
  v_warning         int;
  v_account_number  int;
  v_store_id        uuid;
  v_is_open         boolean;
  v_subtotal        int  := 0;
  v_total           int;
  v_item            jsonb;
  v_order_item_id   uuid;
  v_opt_idx         int;
  v_opt_id          uuid;
  v_opt_name        text;
  v_opt_price       int;
  v_daily_seq       bigint;
  v_order_number    text;
  v_kst_day_start   timestamptz;
  v_kst_day_end     timestamptz;
  v_base_price      int;
  v_unit_price      int;
  v_balance_after   int;
  v_admin_phone     text;
  v_store_name      text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요해요';
  END IF;

  -- 이 계정에 승인된 관리자/이용자인지 확인 (레거시엔 없던 체크 — 카카오 흐름에선 필수)
  SELECT * INTO v_link FROM user_account_links
  WHERE account_code = p_account_code AND user_id = auth.uid() AND status = 'approved'
  ORDER BY created_at DESC LIMIT 1;

  IF v_link IS NULL THEN
    RAISE EXCEPTION '이 계정의 승인된 이용자가 아니에요';
  END IF;

  SELECT su.nickname INTO v_orderer_name FROM sunpos_users su WHERE su.id = auth.uid();
  v_orderer_name := coalesce(nullif(trim(v_orderer_name), ''), '이용자');

  v_kst_day_start := date_trunc('day', now() AT TIME ZONE 'Asia/Seoul')
                       AT TIME ZONE 'Asia/Seoul';
  v_kst_day_end   := v_kst_day_start + INTERVAL '1 day';

  SELECT current_balance, warning_threshold, account_number, store_id
    INTO v_balance, v_warning, v_account_number, v_store_id
  FROM accounts
  WHERE account_code = p_account_code
    AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found or inactive: %', p_account_code;
  END IF;

  SELECT is_open, name INTO v_is_open, v_store_name
  FROM stores
  WHERE id = v_store_id;

  IF v_is_open IS FALSE THEN
    RAISE EXCEPTION 'STORE_CLOSED';
  END IF;

  SELECT count(*) + 1 INTO v_daily_seq
  FROM orders
  WHERE ordered_at >= v_kst_day_start
    AND ordered_at <  v_kst_day_end;

  v_order_number := '1'
    || v_account_number::text
    || lpad(v_daily_seq::text, 2, '0');

  INSERT INTO orders (
    order_number,   account_code,   orderer_name,  orderer_phone,
    method,         menu_subtotal,  delivery_fee,  total_amount,
    balance_before, balance_after,  note,          store_id,
    ordered_by_user_id, ordered_by_link_id
  ) VALUES (
    v_order_number, p_account_code, v_orderer_name, p_orderer_phone,
    p_method,       0,              COALESCE(p_delivery_fee, 0), 0,
    v_balance,      0,              p_note,         v_store_id,
    auth.uid(),     v_link.id
  )
  RETURNING order_code INTO v_order_code;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP

    SELECT base_price INTO v_base_price
    FROM menus WHERE id = (v_item->>'menu_id')::uuid;

    IF NOT FOUND THEN
      v_unit_price := (v_item->>'unit_price')::int;
    ELSE
      v_unit_price := v_base_price;

      IF v_item ? 'option_item_ids' THEN
        FOR v_opt_idx IN
          SELECT generate_subscripts(
            (SELECT array_agg(x) FROM jsonb_array_elements_text(v_item->'option_item_ids') AS x),
            1
          )
        LOOP
          v_opt_id := ((v_item->'option_item_ids'->>(v_opt_idx - 1))::uuid);
          SELECT extra_price INTO v_opt_price FROM option_items WHERE id = v_opt_id;
          v_unit_price := v_unit_price + COALESCE(v_opt_price, 0);
        END LOOP;
      END IF;
    END IF;

    INSERT INTO order_items (
      order_code, menu_id, menu_name, quantity, unit_price, subtotal
    ) VALUES (
      v_order_code,
      (v_item->>'menu_id')::uuid,
      v_item->>'menu_name',
      (v_item->>'quantity')::int,
      v_unit_price,
      v_unit_price * (v_item->>'quantity')::int
    )
    RETURNING order_item_id INTO v_order_item_id;

    v_subtotal := v_subtotal + v_unit_price * (v_item->>'quantity')::int;

    IF v_item ? 'option_item_ids' THEN
      FOR v_opt_idx IN
        SELECT generate_subscripts(
          (SELECT array_agg(x) FROM jsonb_array_elements_text(v_item->'option_item_ids') AS x),
          1
        )
      LOOP
        v_opt_id   := ((v_item->'option_item_ids'->>(v_opt_idx - 1))::uuid);
        v_opt_name := COALESCE(v_item->'option_names'->>(v_opt_idx - 1), '');

        SELECT extra_price INTO v_opt_price FROM option_items WHERE id = v_opt_id;
        IF NOT FOUND THEN
          v_opt_price := COALESCE((v_item->'option_prices'->>(v_opt_idx - 1))::int, 0);
        END IF;

        INSERT INTO order_item_options (
          order_item_id, option_item_id, option_name, extra_price
        ) VALUES (
          v_order_item_id, v_opt_id, v_opt_name, v_opt_price
        );
      END LOOP;
    END IF;
  END LOOP;

  v_total := v_subtotal + COALESCE(p_delivery_fee, 0);
  v_balance_after := v_balance - v_total;

  UPDATE orders
  SET menu_subtotal = v_subtotal,
      total_amount  = v_total,
      balance_after = v_balance_after
  WHERE order_code = v_order_code;

  UPDATE accounts
  SET current_balance = v_balance_after
  WHERE account_code = p_account_code;

  -- v_orderer_name은 항상 non-null(빈 값이면 '이용자'로 fallback)이라 레거시의 null/빈문자 가드 불필요
  INSERT INTO account_members (account_code, name, phone, order_count, last_ordered_at)
  VALUES (p_account_code, trim(v_orderer_name), nullif(trim(p_orderer_phone), ''), 1, now())
  ON CONFLICT (account_code, name)
  DO UPDATE SET
    order_count     = account_members.order_count + 1,
    last_ordered_at = now(),
    phone           = COALESCE(EXCLUDED.phone, account_members.phone);

  -- 5-1: 잔액이 경고기준을 막 하회한 순간에만 1회 알림 (관리자 전화번호로)
  IF v_balance >= v_warning AND v_balance_after < v_warning THEN
    SELECT su.phone INTO v_admin_phone
    FROM user_account_links ual JOIN sunpos_users su ON su.id = ual.user_id
    WHERE ual.account_code = p_account_code AND ual.role = '관리자' AND ual.status = 'approved'
    LIMIT 1;

    IF v_admin_phone IS NOT NULL THEN
      PERFORM net.http_post(
        url := 'https://fcaoakdlbecamoyeqyha.supabase.co/functions/v1/send-notification',
        body := jsonb_build_object(
          'purpose', 'balance_alert',
          'phone', v_admin_phone,
          'params', jsonb_build_object(
            'storeName', v_store_name,
            'accountName', (SELECT account_name FROM accounts WHERE account_code = p_account_code),
            'balance', v_balance_after
          )
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjYW9ha2RsYmVjYW1veWVxeWhhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMTY1OTYsImV4cCI6MjA5Njc5MjU5Nn0.FlHwYKyddPR_ufi-vCOBFWzgSKE-_xsgGjypV6JVLpY'
        )
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'order_code',   v_order_code,
    'order_number', v_order_number
  );
END;
$$;
GRANT EXECUTE ON FUNCTION create_order_kakao(uuid, order_method, jsonb, integer, text, text) TO authenticated;
