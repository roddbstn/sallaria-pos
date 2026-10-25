-- ════════════════════════════════════════════════════════════════════════════
-- cancel_order 를 점주 전용으로 잠근다 (2026-10-22) — 0012 의 후속
--
-- ⚠️ **먼저 POS 를 배포해야 한다.** 이 마이그레이션만 적용하고 구 버전 POS 가
--    돌고 있으면 '주문 거절' 이 깨진다. 순서:
--      1) POS 를 배포한다 (electron/index.ts 의 order:reject 핸들러가 지워진 버전)
--      2) 이 마이그레이션을 적용한다
--
-- 왜 0012 에 못 넣었나:
--   electron 메인 프로세스가 anon 키 + 세션 없이 cancel_order 를 불렀다
--   (electron/index.ts createClient(SUPABASE_URL, SUPABASE_ANON) → ipcMain 'order:reject').
--   거기서 auth.uid() 는 NULL 이라 my_store_ids() 가 빈 집합이 되고, 가드를 넣으면
--   점주의 거절 버튼이 죽는다.
--
-- 무엇을 고쳐서 풀었나:
--   그 IPC 호출이 **완전히 중복**이었다 — OrderPopup.handleReject 가 renderer 에서
--   이미 cancel_order 를 부르고 broadcast 까지 보낸 다음, 같은 일을 IPC 로 한 번 더
--   했다. 두 번째 cancel_order 는 늘 'Order already cancelled' 로 터졌고(에러를
--   아무도 읽지 않아 조용했다) broadcast 는 손님 화면에 두 번 갔다.
--   그 세 핸들러(order:reject/complete/cancel)를 지웠으니 이제 잠글 수 있다.
--
-- 남는 호출부 (전부 renderer — Supabase 세션 있음):
--   src/components/OrderPopup.tsx:167  거절
--   src/pages/Home.tsx:161             취소
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.cancel_order(
  p_order_code uuid,
  p_allow_after_cooking boolean default false,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $fn$
declare
  v_order orders%rowtype;
begin
  -- ⚠️ 권한 확인이 **먼저**다. 이 함수는 accounts.current_balance 에 총금액을
  --    되돌려준다 — 확인이 없으면 anon 키만으로 아무 주문을 취소하고 잔액을
  --    부풀릴 수 있다. (0012 의 soft_delete_order·update_deposit 과 같은 종류)
  perform assert_my_order(p_order_code);

  select * into v_order
    from orders
   where order_code = p_order_code
   for update;

  if not found then
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

revoke execute on function public.cancel_order(uuid, boolean, text) from public, anon;
grant  execute on function public.cancel_order(uuid, boolean, text) to authenticated;

-- 확인: anon_exec 가 false, auth_exec 가 true 여야 한다
-- select has_function_privilege('anon','public.cancel_order(uuid,boolean,text)','EXECUTE') as anon_exec,
--        has_function_privilege('authenticated','public.cancel_order(uuid,boolean,text)','EXECUTE') as auth_exec;
