-- delete_my_account()의 마지막 줄 `DELETE FROM auth.users WHERE id = auth.uid()`는
-- Supabase가 auth.users를 보호하고 있어서 실제로는 0건 삭제되고 조용히 넘어감(에러도 없음) —
-- 겉보기엔 성공한 것처럼 보이지만 auth.users에 고아 행이 남는 버그였음.
-- auth.users 삭제는 Admin API로만 가능해서 delete-auth-user Edge Function으로 옮기고,
-- 이 함수는 DB 쪽(clients/stores/accounts 등) 정리만 담당하도록 함.
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
  DECLARE
    v_client_id     uuid;
    v_store_ids     uuid[];
    v_account_codes uuid[];
  BEGIN
    SELECT id INTO v_client_id FROM clients WHERE auth_user_id = auth.uid();
    IF v_client_id IS NULL THEN RETURN; END IF;

    SELECT array_agg(id) INTO v_store_ids FROM stores WHERE client_id = v_client_id;

    IF v_store_ids IS NOT NULL THEN
      SELECT array_agg(account_code) INTO v_account_codes
      FROM accounts WHERE store_id = ANY(v_store_ids);

      IF v_account_codes IS NOT NULL THEN
        DELETE FROM deposits  WHERE account_code = ANY(v_account_codes);
        DELETE FROM orders    WHERE account_code = ANY(v_account_codes);
        DELETE FROM accounts  WHERE account_code = ANY(v_account_codes);
      END IF;

      DELETE FROM menus
      WHERE category_id IN (SELECT id FROM categories WHERE store_id = ANY(v_store_ids));

      DELETE FROM option_groups WHERE store_id = ANY(v_store_ids);
      DELETE FROM categories    WHERE store_id = ANY(v_store_ids);
      DELETE FROM stores        WHERE client_id = v_client_id;
    END IF;

    DELETE FROM clients WHERE id = v_client_id;
  END;
  $function$;
