-- ════════════════════════════════════════════════════════════════════════════
-- 구두주문에서 보내는 '이용자 등록 문자'를 기록할 수 있게 (2026-11-18, 적용 완료)
--
-- 구두주문 1단계에서 명단에 없는 손님을 추가하면, kakao 거래처에 한해 선결제 주문
-- 등록 링크를 문자로 보낼 수 있다. 그 발송도 sms_logs 에 남겨야 한다 —
-- SmsPanel 과 같은 이유다: "보냈나 안 보냈나"를 기억에 맡기면 두 번 보내게 되고,
-- 문자는 건당 비용이 나가고 되돌릴 수 없다.
--
-- kind 체크 제약이 세 종류로 닫혀 있어서 'user_invite' 가 안 들어갔다.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.sms_logs drop constraint sms_logs_kind_check;

alter table public.sms_logs add constraint sms_logs_kind_check
  check (kind = any (array[
    'admin_pending',
    'negative_balance',
    'idle_account',
    'user_invite'      -- 구두주문 · 이용자 등록 안내 (2026-11-18)
  ]));

-- ════════════════════════════════════════════════════════════════════════════
-- 적용 후 확인
-- ════════════════════════════════════════════════════════════════════════════
-- select pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'public.sms_logs'::regclass and conname = 'sms_logs_kind_check';
