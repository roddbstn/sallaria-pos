-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY DEFINER 함수 권한 정리 (2026-10-22)
--
-- 배경: CLAUDE.md 가 이미 경고하고 있던 그대로다 —
--   "SECURITY DEFINER 함수는 반드시 함수 안에서 권한을 확인한다. 클라이언트 화면에서
--    막는 것만으로는 아무 소용이 없다 — /rest/v1/rpc/<함수명> 은 anon 키만으로 바로 찔린다."
-- add_deposit 이 2026-10-18 에 그래서 고쳐졌는데, **같은 실수가 아래 함수들에 남아 있었다.**
--
-- anon 키(공개 키 — 클라이언트 번들에 그대로 들어있다)로 실제 호출해 확인한 결과:
--   update_order_status  → 204   아무 주문의 상태를 아무나 바꿀 수 있었다
--   update_deposit       → 204   충전액을 바꾸면 accounts.current_balance 가 같이 움직인다 = 돈
--   list_account_members → 200   QR 종이에 적힌 account_code 만 알면 이용자 명단이 나왔다
--   soft_delete_order    → 400 "Order not found"  ← 권한을 지나 조회까지 도달. **잔액 환불을 한다**
--   restore_order        → 400 "Order not found"  ← 같음. **잔액 재청구를 한다**
--   approve_order        → 400 "Order not found"
--   alert_overdue_accounts        → 204  알림 발송을 외부에서 트리거 가능
--   auto_close_stores_by_schedule → 204  매장 강제 마감을 외부에서 트리거 가능
--
-- ⚠️ cancel_order 는 여기 없다. electron 메인 프로세스가 anon 키 + 세션 없음으로
--    호출하고 있어서(electron/index.ts:63 → ipcMain 'order:reject') 지금 잠그면
--    점주의 '주문 거절' 버튼이 죽는다. 호출부를 renderer 로 옮긴 뒤 0013 에서 잠근다.
--
-- 검증 방법 (적용 후):
--   아래 "적용 후 확인" 블록을 그대로 실행하면 anon EXECUTE 가 전부 false 여야 한다.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 0) 공통 소유 확인 가드 ───────────────────────────────────────────────────
-- 주문 조작 함수 셋이 전부 p_order_code 하나로 주문을 찾는다. 가드를 한 군데 둔다.
create or replace function public.assert_my_order(p_order_code uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
begin
  if not exists (
    select 1 from orders
     where order_code = p_order_code
       and store_id in (select my_store_ids())
  ) then
    -- 존재하지 않는 주문과 남의 주문을 **같은 메시지로** 돌려준다.
    -- 메시지가 다르면 "이 order_code 가 실재하는지"를 알아내는 수단이 된다.
    raise exception '처리할 수 있는 주문이 아니에요';
  end if;
end;
$fn$;

revoke execute on function public.assert_my_order(uuid) from public, anon;
grant  execute on function public.assert_my_order(uuid) to authenticated;

comment on function public.assert_my_order(uuid) is
  '점주 전용 주문 조작 함수들이 맨 앞에서 호출하는 소유 확인 가드. 남의 주문/없는 주문을 같은 메시지로 거절한다.';


-- ── 1) 호출부가 아예 없는 것들 — EXECUTE 회수 ────────────────────────────────
-- 코드 전체(sallaria-pos / salaria-prepaid / sunpos-kakao)를 검색해 호출부가 0곳인 것들.
-- 기준 모양은 store_notifications (postgres · authenticated · service_role) 이지만
-- 앱에서 안 쓰이므로 postgres·service_role 만 남긴다.
revoke execute on function public.update_order_status(uuid, order_status) from public, anon, authenticated;
revoke execute on function public.list_account_members(uuid)              from public, anon, authenticated;
revoke execute on function public.order_cycle_stats(uuid, date, date)     from public, anon, authenticated;

-- cron/운영 작업 — 사람이 부를 일이 없다
revoke execute on function public.alert_overdue_accounts()        from public, anon, authenticated;
revoke execute on function public.auto_close_stores_by_schedule() from public, anon, authenticated;


-- ── 2) update_deposit — 돈을 움직인다. 소유 확인을 함수 안에 넣는다 ──────────
create or replace function public.update_deposit(
  p_deposit_id uuid, p_amount integer, p_note text default null, p_payment_method text default null
) returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
declare
  v_old_amount   integer;
  v_account_code uuid;
  v_delta        integer;
  v_new_balance  integer;
begin
  -- ⚠️ 권한 확인이 **먼저**다. 이 함수는 accounts.current_balance 를 직접 움직인다 —
  --    전엔 확인이 없어서 anon 키만으로 아무 거래처 잔액을 임의로 올릴 수 있었다.
  --    조회 조건에 소유 확인을 끼워 넣으면 "없는 충전 기록"과 "남의 충전 기록"이
  --    똑같이 걸러진다.
  select d.amount, d.account_code
    into v_old_amount, v_account_code
    from deposits d
    join accounts a on a.account_code = d.account_code
   where d.deposit_id = p_deposit_id
     and a.store_id in (select my_store_ids())
   for update of d;

  if v_account_code is null then
    raise exception '수정할 수 있는 충전 기록이 아니에요';
  end if;

  v_delta := p_amount - v_old_amount;

  update accounts
     set current_balance = current_balance + v_delta
   where account_code = v_account_code
  returning current_balance into v_new_balance;

  update deposits
     set amount         = p_amount,
         note           = p_note,
         payment_method = coalesce(p_payment_method, payment_method),
         balance_after  = v_new_balance
   where deposit_id = p_deposit_id;
end;
$fn$;

revoke execute on function public.update_deposit(uuid, integer, text, text) from public, anon;
grant  execute on function public.update_deposit(uuid, integer, text, text) to authenticated;


-- ── 3) 점주 전용 주문 조작 ───────────────────────────────────────────────────
-- 호출부가 renderer(Supabase 세션 있음) 뿐이라 바로 잠글 수 있다.
--   soft_delete_order → src/pages/Orders.tsx:376
--   restore_order     → src/pages/Orders.tsx:384
--   approve_order     → src/components/OrderPopup.tsx:122
-- 본문은 배포본에서 그대로 가져왔고 **맨 앞에 가드 한 줄만** 덧붙였다.

create or replace function public.soft_delete_order(p_order_code uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
declare
  v_order  orders%rowtype;
  v_refund integer := 0;
begin
  perform assert_my_order(p_order_code);   -- ← 추가된 가드

  select * into v_order from orders where order_code = p_order_code for update;
  if not found then
    raise exception 'Order not found: %', p_order_code;
  end if;
  if v_order.is_deleted then
    return jsonb_build_object('order_code', p_order_code, 'refunded', 0, 'noop', true);
  end if;

  -- 취소 건은 cancel_order 가, 이미 환불된 건은 과거 환불이 돌려줬다
  if v_order.status <> '취소' and v_order.refunded_at is null then
    v_refund := coalesce(v_order.total_amount, 0);
  end if;

  update orders
     set is_deleted    = true,
         updated_at    = now(),
         refunded_at   = case when v_refund <> 0 then now() else refunded_at end,
         refund_amount = case when v_refund <> 0 then v_refund else refund_amount end
   where order_code = p_order_code;

  if v_refund <> 0 then
    update accounts set current_balance = current_balance + v_refund
     where account_code = v_order.account_code;
  end if;

  return jsonb_build_object('order_code', p_order_code, 'refunded', v_refund);
end;
$fn$;

create or replace function public.restore_order(p_order_code uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
declare
  v_order  orders%rowtype;
  v_charge integer := 0;
begin
  perform assert_my_order(p_order_code);   -- ← 추가된 가드

  select * into v_order from orders where order_code = p_order_code for update;
  if not found then
    raise exception 'Order not found: %', p_order_code;
  end if;
  if not v_order.is_deleted then
    return jsonb_build_object('order_code', p_order_code, 'charged', 0, 'noop', true);
  end if;

  -- 삭제할 때 실제로 환불한 금액만 되돌려 받는다 (환불 안 했으면 다시 청구하지 않는다)
  if v_order.status <> '취소' and v_order.refunded_at is not null then
    v_charge := coalesce(v_order.refund_amount, v_order.total_amount, 0);
  end if;

  update orders
     set is_deleted    = false,
         updated_at    = now(),
         refunded_at   = case when v_charge <> 0 then null else refunded_at end,
         refund_amount = case when v_charge <> 0 then null else refund_amount end
   where order_code = p_order_code;

  if v_charge <> 0 then
    update accounts set current_balance = current_balance - v_charge
     where account_code = v_order.account_code;
  end if;

  return jsonb_build_object('order_code', p_order_code, 'charged', v_charge);
end;
$fn$;

create or replace function public.approve_order(p_order_code uuid, p_prep_minutes smallint default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
declare
  v_order orders%rowtype;
begin
  perform assert_my_order(p_order_code);   -- ← 추가된 가드

  select * into v_order from orders where order_code = p_order_code for update;

  if not found then
    raise exception 'Order not found: %', p_order_code;
  end if;

  if v_order.status <> '주문완료' then
    raise exception 'Order is not in pending status (current: %): %', v_order.status, p_order_code;
  end if;

  update orders
     set status       = '조리중',
         prep_minutes = coalesce(p_prep_minutes, prep_minutes),
         accepted_at  = now(),
         updated_at   = now()
   where order_code = p_order_code;

  return jsonb_build_object(
    'order_code',   p_order_code,
    'prep_minutes', p_prep_minutes,
    'accepted_at',  now()
  );
end;
$fn$;

revoke execute on function public.soft_delete_order(uuid)           from public, anon;
revoke execute on function public.restore_order(uuid)               from public, anon;
revoke execute on function public.approve_order(uuid, smallint)     from public, anon;
grant  execute on function public.soft_delete_order(uuid)           to authenticated;
grant  execute on function public.restore_order(uuid)               to authenticated;
grant  execute on function public.approve_order(uuid, smallint)     to authenticated;


-- ── 4) 메뉴·카테고리 순서 / 거래처 유형 이름 ─────────────────────────────────
-- 전엔 id 목록만 받아 그대로 UPDATE 했다 — 남의 매장 메뉴 id 를 섞어 보내면
-- 그 매장 메뉴 순서가 바뀐다. 소유한 매장 것만 건드리도록 조건을 추가한다.
--   reorder_menus      → src/pages/Menus.tsx:189
--   reorder_categories → src/pages/Menus.tsx:198
--   rename_account_type→ src/pages/Customers.tsx:257

create or replace function public.reorder_menus(menu_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
begin
  update menus m
     set display_order = v.ord - 1
    from unnest(menu_ids) with ordinality as v(id, ord)
   where m.id = v.id
     -- menus 에는 store_id 가 없다. 카테고리를 거쳐 매장을 확인한다.
     and m.category_id in (
       select c.id from categories c where c.store_id in (select my_store_ids())
     );
end;
$fn$;

create or replace function public.reorder_categories(category_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
begin
  update categories c
     set display_order = v.ord - 1
    from unnest(category_ids) with ordinality as v(id, ord)
   where c.id = v.id
     and c.store_id in (select my_store_ids());
end;
$fn$;

create or replace function public.rename_account_type(p_store_id uuid, p_old_name text, p_new_name text)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
begin
  -- p_store_id 를 그대로 믿지 않는다 — 호출자가 소유한 매장인지 확인한다.
  if p_store_id not in (select my_store_ids()) then
    raise exception '이 매장의 설정을 바꿀 수 없어요';
  end if;

  update accounts
     set account_type = p_new_name
   where store_id = p_store_id and account_type = p_old_name;
end;
$fn$;

revoke execute on function public.reorder_menus(uuid[])                   from public, anon;
revoke execute on function public.reorder_categories(uuid[])              from public, anon;
revoke execute on function public.rename_account_type(uuid, text, text)   from public, anon;
grant  execute on function public.reorder_menus(uuid[])                   to authenticated;
grant  execute on function public.reorder_categories(uuid[])              to authenticated;
grant  execute on function public.rename_account_type(uuid, text, text)   to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 적용 후 확인 — anon_exec 가 전부 false 여야 한다
-- ════════════════════════════════════════════════════════════════════════════
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname in (
--   'update_order_status','update_deposit','list_account_members','order_cycle_stats',
--   'alert_overdue_accounts','auto_close_stores_by_schedule',
--   'soft_delete_order','restore_order','approve_order',
--   'reorder_menus','reorder_categories','rename_account_type','assert_my_order')
-- order by p.proname;
