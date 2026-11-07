-- 취소 사유를 note 에서 떼어낸다. (2026-11-07)
--
-- ── 무엇이 망가져 있었나 ───────────────────────────────────────────────────
-- cancel_order 가 이렇게 쓰고 있었다:
--     update orders set note = coalesce(p_note, note) ...
-- p_note 는 점주가 고른 취소 사유다. 그래서 취소하는 순간 **note 가 통째로
-- 덮어써진다.** note 에는 손님이 쓴 요청사항만 있는 게 아니다:
--     [배달주소] 대구 북구 옥산로 65 / [배달상세] 별관 3층 / [배달요청] 문 앞에 두세요
-- 이게 전부 사라진다.
--
-- 실측(2026-11-07): 취소된 배달 주문 4건 중 **3건에서 [배달주소] 가 없다.**
-- 취소 21건 중 12건은 마커 없는 note 만 남아 있어 그게 손님 요청사항인지
-- 점주가 고른 사유인지 구분할 수가 없다.
--
-- 돈이 움직이는 버그는 아니지만 **기록이 사라지는** 버그다. 취소된 배달 주문이
-- 어디로 갈 뻔했는지 나중에 확인할 방법이 없어진다.
--
-- ── 고치는 방법 ────────────────────────────────────────────────────────────
-- 사유는 사유 칸에 넣는다. note 는 손님이 쓴 것만 담는다.
--
-- ⚠️ 두 QR웹이 orders.note 를 **취소 사유로 그대로 읽어서 손님에게 보여준다**
--    (sunpos-kakao/app/(order)/success/page.tsx:185 · salaria-prepaid 같은 자리).
--    그래서 get_order_status 가 돌려주는 note 자리에는 **사유를 계속 내보낸다** —
--    QR웹을 건드리지 않고도 화면이 그대로 돌게. 저장만 갈라 둔다.

alter table public.orders
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at  timestamp with time zone;

comment on column public.orders.cancel_reason is
  '점주가 고른 주문 취소 사유. 손님이 쓴 요청사항(note)과 섞지 않는다';
comment on column public.orders.cancelled_at is
  '취소 시각. 전엔 updated_at 으로 갈음했는데 그건 아무 변경에나 움직인다';

-- 지난 취소분 중 **사유가 확실한 것만** 옮긴다.
-- 취소 사유는 POS 가 고정 목록에서 고르게 돼 있다(CancelReasonModal · OrderPopup).
-- 그 목록과 글자가 똑같은 note 만 사유로 본다 — 나머지는 손님 요청사항일 수 있어
-- 건드리지 않는다. 추측해서 옮기면 손님이 쓴 말을 점주가 한 말로 바꿔 기록하게 된다.
update public.orders
set cancel_reason = note,
    cancelled_at  = updated_at
where status = '취소'
  and cancel_reason is null
  and note in ('재료 소진', '마감시간 초과', '주문 폭주', '매장 사정', '기타',
               '주문 폭주로 조리 불가', '재료가 떨어졌어요', '마감 시간이에요');

-- 사유를 못 가려낸 취소분도 **시각만은** 채운다. updated_at 은 취소할 때 갱신되므로
-- 취소 주문에 한해서는 사실상 취소 시각이다(그 뒤로 바뀐 게 없다면).
update public.orders
set cancelled_at = updated_at
where status = '취소' and cancelled_at is null;

-- ── cancel_order 재정의 ────────────────────────────────────────────────────
-- 0076 에서 넣은 소유권 확인은 **그대로 유지한다.** 빠뜨리면 order_code 만 알면
-- 남의 매장 주문을 취소하고 잔액을 환원시킬 수 있다.
create or replace function public.cancel_order(
  p_order_code uuid,
  p_allow_after_cooking boolean default false,
  p_note text default null
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
  select * into v_order from orders where order_code = p_order_code for update;
  if not found then
    raise exception 'Order not found: %', p_order_code;
  end if;

  -- 내 매장의 주문인가. 남의 주문은 '없다'고 답한다 —
  -- '권한 없음'으로 답하면 order_code 존재 여부를 알려주는 조회기가 된다.
  select a.store_id into v_store from accounts a where a.account_code = v_order.account_code;
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

  -- ★ note 는 손대지 않는다. 손님이 쓴 말과 배달 주소가 거기 있다.
  update orders
  set status        = '취소',
      cancel_reason = coalesce(p_note, cancel_reason),
      cancelled_at  = now(),
      updated_at    = now()
  where order_code = p_order_code;

  update accounts
  set current_balance = current_balance + v_order.total_amount
  where account_code = v_order.account_code;

  return jsonb_build_object('order_code', p_order_code, 'refunded', v_order.total_amount);
end;
$fn$;

revoke execute on function public.cancel_order(uuid, boolean, text) from public, anon;
grant  execute on function public.cancel_order(uuid, boolean, text) to authenticated, service_role;

-- ── get_order_status 는 사유를 note 자리로 내보낸다 ────────────────────────
-- QR웹이 note 를 취소 사유로 읽고 있어서, 저장 위치가 바뀌어도 그쪽 화면이 그대로
-- 돌아야 한다. 취소된 주문이면 cancel_reason 을, 아니면 원래 note 를 준다.
drop function if exists public.get_order_status(uuid);

create function public.get_order_status(p_order_code uuid)
returns table(
  status                  text,
  note                    text,
  delivery_departed_at    timestamp with time zone,
  method                  text,
  delivery_lat            double precision,
  delivery_lng            double precision,
  delivery_road_address   text,
  delivery_detail_address text,
  store_lat               double precision,
  store_lng               double precision
)
language sql
stable
security definer
set search_path to 'public', 'extensions'
as $fn$
  select o.status::text,
         case when o.status = '취소' then coalesce(o.cancel_reason, o.note) else o.note end,
         o.delivery_departed_at, o.method,
         o.delivery_lat, o.delivery_lng,
         o.delivery_road_address, o.delivery_detail_address,
         s.lat, s.lng
  from orders o
  left join accounts a on a.account_code = o.account_code
  left join stores   s on s.id = a.store_id
  where o.order_code = p_order_code;
$fn$;

revoke execute on function public.get_order_status(uuid) from public;
grant  execute on function public.get_order_status(uuid) to anon, authenticated, service_role;
