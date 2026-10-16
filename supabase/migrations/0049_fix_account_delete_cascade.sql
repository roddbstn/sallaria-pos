-- delete_my_account(회원탈퇴)가 409로 실패하는 문제 수정.
-- balance_adjustments/admin_registration_links가 accounts·stores를 참조하면서
-- ON DELETE CASCADE가 없어, 해당 거래처에 이 두 테이블 행이 하나라도 있으면
-- accounts/stores 삭제 시 FK 위반으로 막혔음. 두 테이블 다 부모 없이는 의미
-- 없는 종속 레코드라 CASCADE가 맞음.

ALTER TABLE balance_adjustments DROP CONSTRAINT balance_adjustments_account_code_fkey;
ALTER TABLE balance_adjustments ADD CONSTRAINT balance_adjustments_account_code_fkey
  FOREIGN KEY (account_code) REFERENCES accounts(account_code) ON DELETE CASCADE;

ALTER TABLE balance_adjustments DROP CONSTRAINT balance_adjustments_store_id_fkey;
ALTER TABLE balance_adjustments ADD CONSTRAINT balance_adjustments_store_id_fkey
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

ALTER TABLE admin_registration_links DROP CONSTRAINT admin_registration_links_account_code_fkey;
ALTER TABLE admin_registration_links ADD CONSTRAINT admin_registration_links_account_code_fkey
  FOREIGN KEY (account_code) REFERENCES accounts(account_code) ON DELETE CASCADE;
