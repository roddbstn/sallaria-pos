-- ════════════════════════════════════════════════════════════════════════════
-- 점주 전용 RPC 잠그기 (2026-10-25)
--
-- ⚠️ **지금 즉시 적용 권장.** update_deposit 은 실증된 취약점이다.
--
-- 2026-10-25 QA 에서 anon 권한으로 직접 호출해 확인했다(전부 롤백):
--     set role anon;
--     select update_deposit('<deposit_id>', 999999, ...);
--   → 충전액 300,000 → 999,999, 거래처 잔액 518,200 → 1,218,199 (+699,999)
--   anon 키는 모든 클라이언트 번들에 들어 있다. deposit_id 하나만 알면 끝이다.
--
-- 이 파일이 0012_harden_owner_only_rpcs.sql 을 대체한다. 0012 는 적용하지 말 것 —
-- 거기엔 list_account_members 의 anon 권한을 회수하는 내용이 있는데, 그러면
-- **sallaria.web.app 의 주문자 선택 시트가 깨진다**
-- (salaria-prepaid/components/order/orderer-sheet.tsx:77 이 anon 으로 부른다).
--
-- ── 적용 전에 확인한 것 ──────────────────────────────────────────────────────
-- 세 앱(sallaria-pos · sunpos-kakao · salaria-prepaid)에서 .rpc('<이름>' 호출부를
-- 전수 조사했다. 아래 함수들은 **POS(로그인된 점주)에서만** 부르거나 아무도 안 부른다.
--
--   update_deposit        호출부 없음          ← 가장 급함
--   order_cycle_stats     호출부 없음
--   alert_overdue_accounts 호출부 없음
--   auto_close_stores_by_schedule 호출부 없음 (스케줄러용)
--   soft_delete_order     POS Orders.tsx:376
--   restore_order         POS Orders.tsx:384
--   approve_order         POS OrderPopup.tsx:122
--   reorder_menus         POS Menus.tsx:206
--   reorder_categories    POS Menus.tsx:215 · ProductHub.tsx:925
--   rename_account_type   POS Customers.tsx:316
--
-- ⚠️ 건드리지 않는 것:
--   account_pin_reset  — anon 이지만 **함수 안에서** auth.uid() + 관리자 역할을
--                        확인한다(정상 패턴). 그대로 둔다.
--   list_account_members — QR웹이 anon 으로 쓴다. 잠그면 주문이 막힌다.
--                        (내부 검사가 없어 별도 과제로 남긴다 — 아래 주석)
--   create_order 계열 · verify_account_pin · qr_* — QR웹의 정상 경로
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. 돈을 움직이는 함수 — 점주 소유 확인을 함수 안에 넣는다 ────────────────
-- 권한 회수만으로도 anon 은 막히지만, authenticated(카카오 로그인한 **손님**)도
-- 호출할 수 있었다. 손님 계정으로 로그인만 하면 남의 충전액을 바꿀 수 있었다는 뜻이다.
-- 그래서 회수 + 내부 검사를 같이 건다.
create or replace function public.update_deposit(
  p_deposit_id uuid, p_amount integer, p_note text, p_payment_method text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
DECLARE
  v_old_amount   integer;
  v_account_code uuid;
  v_store_id     uuid;
  v_delta        integer;
  v_new_balance  integer;
BEGIN
  SELECT d.amount, d.account_code, a.store_id
  INTO v_old_amount, v_account_code, v_store_id
  FROM deposits d
  JOIN accounts a ON a.account_code = d.account_code
  WHERE d.deposit_id = p_deposit_id
  FOR UPDATE OF d;

  -- 없는 충전건과 남의 매장 충전건에 **같은 말**을 돌려준다 —
  -- 메시지가 다르면 id 를 넣어보며 남의 충전건 존재 여부를 알아낼 수 있다.
  IF v_store_id IS NULL OR v_store_id NOT IN (SELECT my_store_ids()) THEN
    RAISE EXCEPTION '충전 내역을 찾을 수 없어요';
  END IF;

  v_delta := p_amount - v_old_amount;

  UPDATE accounts
  SET current_balance = current_balance + v_delta
  WHERE account_code = v_account_code
  RETURNING current_balance INTO v_new_balance;

  UPDATE deposits
  SET amount         = p_amount,
      note           = p_note,
      payment_method = COALESCE(p_payment_method, payment_method),
      balance_after  = v_new_balance
  WHERE deposit_id = p_deposit_id;
END;
$fn$;

revoke execute on function public.update_deposit(uuid, integer, text, text) from public, anon;


-- ── 2. 호출부가 없는 함수 — anon·authenticated 에서 회수 ────────────────────
-- 아무도 안 부르므로 회수해도 깨질 것이 없다. 나중에 점주 화면에서 쓰게 되면
-- 그때 my_store_ids() 검사를 넣고 authenticated 에만 다시 준다.
revoke execute on function public.order_cycle_stats(uuid, date, date)   from public, anon, authenticated;
revoke execute on function public.alert_overdue_accounts()              from public, anon, authenticated;
revoke execute on function public.auto_close_stores_by_schedule()       from public, anon, authenticated;


-- ── 3. POS 전용 함수 — anon 에서만 회수(authenticated 는 점주가 쓴다) ────────
-- ⚠️ 이 셋은 **반드시 POS 를 먼저 배포한 상태**에서 적용할 것.
--    POS 렌더러는 점주 세션(authenticated)으로 부르므로 지금도 문제없지만,
--    메인 프로세스(anon)가 부르는 경로가 생기면 그때 깨진다. 현재는 없다.
revoke execute on function public.soft_delete_order(uuid)                    from public, anon;
revoke execute on function public.restore_order(uuid)                        from public, anon;
revoke execute on function public.approve_order(uuid, smallint)              from public, anon;
revoke execute on function public.reorder_menus(uuid[])                      from public, anon;
revoke execute on function public.reorder_categories(uuid[])                 from public, anon;
revoke execute on function public.rename_account_type(uuid, text, text)      from public, anon;


-- ── 남은 과제(이 파일에서 고치지 않음) ──────────────────────────────────────
--
-- (a) 위 3번 함수들은 권한만 좁혔을 뿐 **함수 안에 매장 소유 검사가 없다.**
--     즉 점주 A 가 로그인한 상태로 점주 B 의 order_code 를 알면 그 주문을 지울 수 있다.
--     매장이 두 곳뿐인 지금은 위험이 낮지만, 가맹이 늘기 전에 my_store_ids() 검사를
--     각 함수에 넣어야 한다.
--
-- (b) list_account_members 는 anon 이고 내부 검사도 없다 — account_code 만 알면
--     그 거래처의 주문자 명단(이름·연락처)이 나온다. account_code 는 QR 종이에
--     적혀 있다. PIN 검증을 거친 세션만 부를 수 있도록 바꿔야 하는데,
--     그러려면 QR웹이 PIN 검증 결과를 들고 다니는 구조가 필요해서 별건으로 뺀다.
--
-- (c) cancel_order 도 소유 검사가 없다(0013 이 다루려던 것). POS 배포 순서 때문에
--     미뤄둔 상태 그대로다.
