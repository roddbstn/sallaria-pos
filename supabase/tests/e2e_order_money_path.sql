-- ════════════════════════════════════════════════════════════════════════════
-- E2E: 주문 생성 → 잔액 차감 → 취소 → 잔액 환원
--
-- 왜 SQL 로 쓰나: 이 제품에서 가장 비싼 버그는 UI 가 아니라 **돈이 어긋나는 것**이다.
-- CLAUDE.md 의 "테스트는 핵심 로직만, UI는 직접 클릭" 방침과도 맞는다.
-- 그리고 이 경로는 create_order RPC 한 덩어리(트랜잭션)라 SQL 로 재는 게 가장 정확하다.
--
-- 안전: 전체가 BEGIN … ROLLBACK 안에서 돈다. 실데이터로 돌리지만 **아무것도 남지 않는다.**
--       (order_number 시퀀스만 하나 소비된다 — 시퀀스는 롤백되지 않는다)
--
-- 실행:
--   psql "$DATABASE_URL" -f supabase/tests/e2e_order_money_path.sql
--   또는 Supabase SQL Editor 에 그대로 붙여넣기
--
-- 통과 기준: detail 열에 ✗ 가 하나도 없어야 한다.
--
-- 2026-10-22 침산점 실데이터 결과 (전부 OK):
--   잔액 차감    199,400 → 179,600 (−19,800 = 9,900 × 2)
--   단가 스냅샷  order_items.unit_price = 9,900
--   잔액 스냅샷  before=199,400 after=179,600
--   취소 환원    179,600 → 199,400 (정확히 복귀)
--   이중 취소    거절됨 — 이중 환불 없음
-- ════════════════════════════════════════════════════════════════════════════

begin;

create temp table e2e(n int, step text, detail text) on commit drop;

do $fn$
declare
  -- 샐러리아 침산점. 다른 매장으로 돌리려면 여기만 바꾼다.
  v_store uuid := 'c4645a2a-06b2-4a1f-bb1e-32ae0a741db6';
  v_acc uuid; v_menu uuid; v_name text; v_price int;
  v_bal0 int; v_bal1 int; v_bal2 int;
  v_res jsonb; v_code uuid; v_items int;
begin
  select account_code, current_balance into v_acc, v_bal0
    from accounts where store_id = v_store and is_active order by created_at limit 1;
  select m.id, m.name, m.base_price into v_menu, v_name, v_price
    from menus m join categories c on c.id = m.category_id
   where c.store_id = v_store and not m.is_hidden and not m.is_sold_out
   order by m.display_order limit 1;

  if v_acc is null or v_menu is null then
    raise exception '테스트 대상(거래처/메뉴)을 못 찾았다 — store_id 를 확인할 것';
  end if;

  insert into e2e values (0, '준비', format('메뉴 "%s" 단가 %s · 시작잔액 %s', v_name, v_price, v_bal0));

  -- ① 주문 생성 — 수량 2, 포장(배달료 0)
  --
  -- ⚠️ menu_name 은 **클라이언트가 보내는 값**이다(create_order 가 그대로 저장한다).
  --    단가(unit_price)는 서버가 menus 에서 조회하므로 위조되지 않는다. 이름만 믿는다.
  v_res := create_order(
    v_acc, 'E2E테스트', '포장'::order_method,
    jsonb_build_array(jsonb_build_object(
      'menu_id', v_menu, 'menu_name', v_name, 'quantity', 2, 'options', '[]'::jsonb
    )),
    0, null, 'E2E 테스트 — 롤백됨', null, null, null, null, null, null
  );
  v_code := (v_res->>'order_code')::uuid;
  select current_balance into v_bal1 from accounts where account_code = v_acc;
  select count(*) into v_items from order_items where order_code = v_code;

  -- create_order 는 {order_code, order_number} 만 돌려준다 (total_amount 없음).
  -- 총금액은 orders 행에서 읽어 확인한다.
  insert into e2e values (1, '주문 생성',
    format('order_number=%s · 주문상세 %s행', v_res->>'order_number', v_items));

  insert into e2e values (2, '총금액 = 메뉴소계 + 배달료',
    (select format('%s (기대 %s) → %s', total_amount, v_price * 2,
            case when total_amount = v_price * 2 then 'OK' else '✗' end)
       from orders where order_code = v_code));

  insert into e2e values (3, '잔액 차감',
    format('%s → %s (차감 %s) → %s', v_bal0, v_bal1, v_bal0 - v_bal1,
           case when v_bal0 - v_bal1 = v_price * 2 then 'OK' else '✗' end));

  -- 비즈니스 룰 1 — 단가는 주문 시점 스냅샷
  insert into e2e values (4, '단가 스냅샷',
    (select case when unit_price = v_price
                 then format('order_items.unit_price=%s · OK', unit_price)
                 else format('%s ≠ %s · ✗', unit_price, v_price) end
       from order_items where order_code = v_code limit 1));

  -- 주문전/후 잔액 스냅샷
  insert into e2e values (5, '주문전/후 잔액 스냅샷',
    (select format('before=%s after=%s → %s', balance_before, balance_after,
            case when balance_before = v_bal0 and balance_after = v_bal1 then 'OK' else '✗' end)
       from orders where order_code = v_code));

  -- ② 비즈니스 룰 7 — 취소 시 총금액 환원
  perform cancel_order(v_code, true, 'E2E 취소');
  select current_balance into v_bal2 from accounts where account_code = v_acc;
  insert into e2e values (6, '취소 후 잔액 환원',
    format('%s → %s (기대 %s) → %s', v_bal1, v_bal2, v_bal0,
           case when v_bal2 = v_bal0 then 'OK' else '✗' end));

  -- ③ 이중 취소 방어 — 2026-10-13 이중 환불 사고의 재발 방지선
  begin
    perform cancel_order(v_code, true, 'E2E 재취소');
    insert into e2e values (7, '이중 취소 방어', '✗ 두 번째 취소가 통과했다 — 이중 환불 위험');
  exception when others then
    insert into e2e values (7, '이중 취소 방어', format('OK — 거절: %s', sqlerrm));
  end;

  select current_balance into v_bal2 from accounts where account_code = v_acc;
  insert into e2e values (8, '이중 취소 후 잔액',
    format('%s (기대 %s) → %s', v_bal2, v_bal0,
           case when v_bal2 = v_bal0 then 'OK — 이중 환불 없음' else '✗ 이중 환불 발생' end));
end
$fn$;

select step, detail from e2e order by n;

-- ⚠️ 반드시 롤백. 실데이터로 돌렸으므로 커밋하면 가짜 주문이 남는다.
rollback;
