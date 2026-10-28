-- 점주 전용 RPC 6개에 **함수 안 매장 소유 검사**를 넣는다. (2026-10-27)
--
-- 0015 에서 anon 을 회수했지만 authenticated 는 그대로 통과했다. 즉 점주 A 가
-- 로그인한 상태로 점주 B 의 order_code / menu id / store_id 를 알면 그대로 남의
-- 가게 데이터를 건드릴 수 있었다. 매장이 두 곳인 지금은 위험이 낮지만 가맹이
-- 늘기 전에 닫는다.
--
-- 에러 메시지 원칙: **없는 것과 남의 것에 같은 말을 돌려준다.** 메시지가 다르면
-- id 를 넣어보며 남의 데이터 존재 여부를 알아낼 수 있다(update_deposit 과 같은 규칙).
--
-- 동작은 그대로다 — 검사 한 블록만 앞에 붙는다. search_path 는 프로젝트 규칙대로
-- 'public', 'extensions' 로 통일한다(approve_order 만 'public' 이었다).

-- ── 1. 주문 3종: orders → accounts → store ─────────────────────────────────
create or replace function public.soft_delete_order(p_order_code uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
DECLARE
  v_order  orders%rowtype;
  v_refund integer := 0;
  v_store  uuid;
BEGIN
  -- ⚠️ %rowtype 변수는 다른 변수와 **같은 INTO 목록에 못 들어간다**(42601).
  --    주문을 먼저 잠그고 매장은 따로 조회한다.
  SELECT * INTO v_order FROM orders WHERE order_code = p_order_code FOR UPDATE;

  SELECT a.store_id INTO v_store
  FROM accounts a WHERE a.account_code = v_order.account_code;

  IF v_store IS NULL OR v_store NOT IN (SELECT my_store_ids()) THEN
    RAISE EXCEPTION 'Order not found: %', p_order_code;
  END IF;

  IF v_order.is_deleted THEN
    RETURN jsonb_build_object('order_code', p_order_code, 'refunded', 0, 'noop', true);
  END IF;

  -- 취소 건은 cancel_order 가, 이미 환불된 건은 과거 환불이 돌려줬다
  IF v_order.status <> '취소' AND v_order.refunded_at IS NULL THEN
    v_refund := COALESCE(v_order.total_amount, 0);
  END IF;

  UPDATE orders
  SET is_deleted    = true,
      updated_at    = now(),
      refunded_at   = CASE WHEN v_refund <> 0 THEN now() ELSE refunded_at END,
      refund_amount = CASE WHEN v_refund <> 0 THEN v_refund ELSE refund_amount END
  WHERE order_code = p_order_code;

  IF v_refund <> 0 THEN
    UPDATE accounts SET current_balance = current_balance + v_refund
    WHERE account_code = v_order.account_code;
  END IF;

  RETURN jsonb_build_object('order_code', p_order_code, 'refunded', v_refund);
END;
$fn$;

create or replace function public.restore_order(p_order_code uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
DECLARE
  v_order  orders%rowtype;
  v_charge integer := 0;
  v_store  uuid;
BEGIN
  -- ⚠️ %rowtype 변수는 다른 변수와 **같은 INTO 목록에 못 들어간다**(42601).
  --    주문을 먼저 잠그고 매장은 따로 조회한다.
  SELECT * INTO v_order FROM orders WHERE order_code = p_order_code FOR UPDATE;

  SELECT a.store_id INTO v_store
  FROM accounts a WHERE a.account_code = v_order.account_code;

  IF v_store IS NULL OR v_store NOT IN (SELECT my_store_ids()) THEN
    RAISE EXCEPTION 'Order not found: %', p_order_code;
  END IF;

  IF NOT v_order.is_deleted THEN
    RETURN jsonb_build_object('order_code', p_order_code, 'charged', 0, 'noop', true);
  END IF;

  -- 삭제할 때 실제로 환불한 금액만 되돌려 받는다 (환불 안 했으면 다시 청구하지 않는다)
  IF v_order.status <> '취소' AND v_order.refunded_at IS NOT NULL THEN
    v_charge := COALESCE(v_order.refund_amount, v_order.total_amount, 0);
  END IF;

  UPDATE orders
  SET is_deleted    = false,
      updated_at    = now(),
      refunded_at   = CASE WHEN v_charge <> 0 THEN NULL ELSE refunded_at END,
      refund_amount = CASE WHEN v_charge <> 0 THEN NULL ELSE refund_amount END
  WHERE order_code = p_order_code;

  IF v_charge <> 0 THEN
    UPDATE accounts SET current_balance = current_balance - v_charge
    WHERE account_code = v_order.account_code;
  END IF;

  RETURN jsonb_build_object('order_code', p_order_code, 'charged', v_charge);
END;
$fn$;

create or replace function public.approve_order(
  p_order_code uuid, p_prep_minutes smallint DEFAULT NULL::smallint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
declare
  v_order orders%rowtype;
  v_store uuid;
begin
  -- ⚠️ %rowtype 변수는 다른 변수와 **같은 INTO 목록에 못 들어간다**(42601).
  select * into v_order from orders where order_code = p_order_code for update;

  select a.store_id into v_store
  from accounts a where a.account_code = v_order.account_code;

  if v_store is null or v_store not in (select my_store_ids()) then
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

-- ── 2. 순서 변경 2종: 배열 안에 남의 것이 하나라도 섞이면 통째로 거부 ───────
-- 일부만 거르고 나머지를 적용하면 "일부는 됐는데 일부는 안 된" 상태가 되어
-- 화면 순서와 DB 순서가 어긋난다. 순서는 전부 아니면 전무여야 한다.
create or replace function public.reorder_menus(menu_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
begin
  if exists (
    select 1 from unnest(menu_ids) as t(id)
    where not exists (
      select 1 from menus m
      where m.id = t.id and m.store_id in (select my_store_ids())
    )
  ) then
    raise exception '메뉴를 찾을 수 없어요';
  end if;

  update menus m
  set display_order = v.ord - 1
  from unnest(menu_ids) with ordinality as v(id, ord)
  where m.id = v.id;
end;
$fn$;

create or replace function public.reorder_categories(category_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
begin
  if exists (
    select 1 from unnest(category_ids) as t(id)
    where not exists (
      select 1 from categories c
      where c.id = t.id and c.store_id in (select my_store_ids())
    )
  ) then
    raise exception '카테고리를 찾을 수 없어요';
  end if;

  update categories c
  set display_order = v.ord - 1
  from unnest(category_ids) with ordinality as v(id, ord)
  where c.id = v.id;
end;
$fn$;

-- ── 3. 고객유형 이름 변경: store_id 를 인자로 받으므로 그걸 검사한다 ────────
create or replace function public.rename_account_type(
  p_store_id uuid, p_old_name text, p_new_name text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
begin
  if p_store_id is null or p_store_id not in (select my_store_ids()) then
    raise exception '매장을 찾을 수 없어요';
  end if;

  update accounts
  set account_type = p_new_name
  where store_id = p_store_id and account_type = p_old_name;
end;
$fn$;
