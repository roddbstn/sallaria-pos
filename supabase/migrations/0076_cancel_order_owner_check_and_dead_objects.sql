-- cancel_order 소유권 확인 + 안 쓰는 뷰·테이블 정리. (2026-10-28)
--
-- ── 1. cancel_order 가 왜 문제였나 ────────────────────────────────────────────
-- 0075 에서 POS RPC 다섯 개에 소유권 확인을 넣었는데 cancel_order 가 빠졌다.
-- 측정한 상태(2026-10-28):
--     grantees:         PUBLIC, anon, authenticated, postgres, service_role
--     has_owner_check:  false
-- SECURITY DEFINER 라서 RLS 를 넘어간다. 즉 **order_code 만 알면 anon 키로
-- 남의 매장 주문을 취소하고 그 거래처 잔액을 환원시킬 수 있었다.** 돈이 움직인다.
--
-- ── 왜 지금은 anon 을 회수해도 되나 ──────────────────────────────────────────
-- 호출부를 전부 확인했다:
--   · sallaria-pos  src/components/OrderPopup.tsx:167   ← 세션 있는 renderer
--   · sallaria-pos  src/pages/Home.tsx:162              ← 세션 있는 renderer
--   · 두 QR웹은 database.types.ts 에만 있고 실제 호출이 없다
-- anon 경로였던 Electron 메인 프로세스 IPC(order:reject/complete/cancel)는
-- 2026-10-22 에 지웠다 — electron/index.ts:553 주석 참고. 그게 그동안
-- anon 을 회수하지 못하게 만든 유일한 걸림돌이었다.
--
-- ── 2. 뷰 세 개를 security_invoker 로 바꾸지 않고 **지우는** 이유 ────────────
-- CLAUDE.md 에 "security_invoker 로 바꾸면 anon 메뉴 조회가 깨질 수 있어
-- 조사 먼저" 라고 적혀 있었다. 조사했더니 그 걱정은 근거가 없었다.
--
-- anon 으로 직접 읽어본 결과(2026-10-28):
--     stores_with_client    8행 전체 — 점주 이름·이메일·요금제가 나온다
--     v_account_ledger    555행 전체 — 거래처명·주문자 실명·금액·비고
--     v_menu_with_options 192행      — 메뉴만
-- 세 뷰 모두 postgres 소유 + security_invoker 없음 + anon GRANT 라서
-- 바탕 테이블의 RLS 를 통째로 우회한다. Supabase 린터도 WARN 이 아니라 ERROR 다.
--
-- 그런데 **네 레포 어디에서도 쓰지 않는다.** 생성된 database.types.ts·마이그레이션·
-- docs·repomix 덤프에만 이름이 있고 실제 쿼리는 0건이다. 의존하는 뷰·함수도 0개다.
-- QR웹의 메뉴 조회는 qr_menu_board RPC 와 menus 직접 조회(RLS 정책 있음)를 쓴다.
--
-- 쓰지 않는 것에 권한을 맞춰 두면, 나중에 누가 "이미 있는 뷰네" 하고 가져다 쓴다.
-- 정의는 supabase/schema.sql 에 남아 있으니 필요해지면 security_invoker 로 다시 만든다.
--
-- ── 3. user_events ──────────────────────────────────────────────────────────
-- 0행 · 정책 0개 · 쓰는 코드 없음. 이벤트 로깅은 GA4 + Amplitude 로 갔다.
-- RLS 만 켜진 빈 테이블은 린터 경고만 남기고 아무 일도 하지 않는다.


-- ── 1. cancel_order ─────────────────────────────────────────────────────────
-- DEFAULT 를 그대로 유지한다. 빼면 'cannot remove parameter defaults' 로 거부된다.
-- 또 orders%rowtype 변수는 다른 변수와 INTO 목록을 같이 쓸 수 없다(42601) —
-- 그래서 주문을 잡고, 매장을 따로 조회한다. 0075 의 세 함수와 같은 모양이다.
create or replace function public.cancel_order(
  p_order_code uuid,
  p_allow_after_cooking boolean DEFAULT false,
  p_note text DEFAULT NULL::text
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
  select * into v_order
  from orders
  where order_code = p_order_code
  for update;

  if not found then
    raise exception 'Order not found: %', p_order_code;
  end if;

  -- 내 매장의 주문인가. 남의 주문은 '없다'고 답한다 —
  -- '권한 없음'으로 답하면 order_code 존재 여부를 알려주는 조회기가 된다.
  select a.store_id into v_store
  from accounts a
  where a.account_code = v_order.account_code;

  if v_store is null or v_store not in (select my_store_ids()) then
    raise exception 'Order not found: %', p_order_code;
  end if;

  if v_order.status = '취소' then
    raise exception 'Order already cancelled: %', p_order_code;
  end if;

  if v_order.status = '완료' then
    raise exception 'Cannot cancel a completed order: %', p_order_code;
  end if;

  if v_order.status = '조리중' and not p_allow_after_cooking then
    raise exception 'Order is already being cooked. Pass allow_after_cooking=true to force cancel.';
  end if;

  update orders
  set status     = '취소',
      note       = coalesce(p_note, note),
      updated_at = now()
  where order_code = p_order_code;

  update accounts
  set current_balance = current_balance + v_order.total_amount
  where account_code = v_order.account_code;

  return jsonb_build_object(
    'order_code', p_order_code,
    'refunded',   v_order.total_amount
  );
end;
$fn$;

-- 권한 모양의 기준은 store_notifications 다 (postgres · authenticated · service_role).
revoke execute on function public.cancel_order(uuid, boolean, text) from public, anon;
grant  execute on function public.cancel_order(uuid, boolean, text) to authenticated, service_role;

-- ── 2. 안 쓰는 뷰 세 개 ──────────────────────────────────────────────────────
drop view if exists public.stores_with_client;
drop view if exists public.v_account_ledger;
drop view if exists public.v_menu_with_options;

-- ── 3. 빈 user_events ───────────────────────────────────────────────────────
drop table if exists public.user_events;
