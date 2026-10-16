-- 카카오 로그인한 손님(authenticated)이 메뉴를 못 읽던 버그 수정.
-- categories/menus/option_items는 anon만 공개 읽기가 있었고, authenticated는 점주(my_store_ids())
-- 전용 ALL 정책뿐이라 로그인한 손님은 오히려 아무 메뉴도 못 봤음 — anon 정책과 동일 조건으로
-- authenticated 읽기 정책을 추가.
CREATE POLICY authenticated_read_categories ON categories
  FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY authenticated_read_menus ON menus
  FOR SELECT TO authenticated
  USING (is_hidden = false);

CREATE POLICY authenticated_read_option_items ON option_items
  FOR SELECT TO authenticated
  USING (is_hidden = false);

CREATE POLICY authenticated_read_option_groups ON option_groups
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY authenticated_read_menu_option_groups ON menu_option_groups
  FOR SELECT TO authenticated
  USING (true);

-- accounts/account_members: anon 정책과 달리 "본인이 링크된 계정만" 으로 범위를 좁힘
-- (menu 페이지의 잔액 실시간구독 + checkout의 최근 주문자 선택 기능에 필요)
CREATE POLICY authenticated_read_own_linked_accounts ON accounts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_account_links
      WHERE user_account_links.account_code = accounts.account_code
        AND user_account_links.user_id = auth.uid()
        AND user_account_links.status = 'approved'
    )
  );

CREATE POLICY authenticated_read_linked_account_members ON account_members
  FOR SELECT TO authenticated
  USING (
    account_code IN (
      SELECT account_code FROM user_account_links
      WHERE user_id = auth.uid() AND status = 'approved'
    )
  );
