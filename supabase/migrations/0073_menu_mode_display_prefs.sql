-- 개별메뉴 모드(화면 편집) 표시 설정 — 매장(stores) 단위로 저장, 어느 PC에서 열어도 동일하게 보여야 함.
-- 고객용 QR 주문 화면에는 영향 없음 (점주 POS 전용 설정). 카테고리 모드의 menu_item_count_visible/menu_category_text_size와 별개.
alter table stores
  add column if not exists menu_item_image_visible boolean not null default true,
  add column if not exists menu_name_text_size text not null default 'default'
    check (menu_name_text_size in ('default', 'large'));
