-- user_account_links에 ual_own(본인 row만, auth.uid() = user_id) 정책만 있어서
-- 점주(사장님) 세션은 어떤 row도 못 읽어 "등록대기" 배지가 영원히 안 풀리는 버그가 있었음.
-- accounts의 owner_accounts 정책과 같은 my_store_ids() 패턴으로 점주 읽기 권한 추가.
CREATE POLICY owner_read_user_account_links
  ON user_account_links
  FOR SELECT
  USING (store_id IN (SELECT my_store_ids()));
