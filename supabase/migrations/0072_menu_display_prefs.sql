-- 메뉴 화면 좌측 패널 표시 설정 — 매장(stores) 단위로 저장, 어느 PC에서 열어도 동일하게 보여야 함.
-- 고객용 QR 주문 화면에는 영향 없음 (점주 POS 전용 설정).
alter table stores
  add column if not exists menu_display_mode text not null default 'category'
    check (menu_display_mode in ('category', 'individual')),
  add column if not exists menu_item_count_visible boolean not null default true,
  add column if not exists menu_category_text_size text not null default 'default'
    check (menu_category_text_size in ('default', 'large'));
