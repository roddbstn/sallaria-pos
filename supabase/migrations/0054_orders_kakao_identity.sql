-- sunpos-kakao 도입 후 만들 주문 생성 로직에서 "실제로 어느 카카오 계정(이용자/관리자)이
-- 주문했는지"를 데이터로 남기기 위한 준비. 레거시(PIN 기반) 주문은 계속 NULL로 남음 — zero-touch.
ALTER TABLE orders ADD COLUMN ordered_by_user_id uuid REFERENCES auth.users(id);
ALTER TABLE orders ADD COLUMN ordered_by_link_id uuid REFERENCES user_account_links(id);

COMMENT ON COLUMN orders.ordered_by_user_id IS
  '카카오 로그인 기반 주문(sunpos-kakao)에서만 채워짐. auth.users.id. 레거시(PIN) 주문은 NULL.';
COMMENT ON COLUMN orders.ordered_by_link_id IS
  '주문 시점에 이 사람이 이 거래처에서 관리자/이용자 중 어느 역할이었는지(user_account_links.id). 레거시 주문은 NULL.';
