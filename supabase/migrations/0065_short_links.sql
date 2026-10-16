-- SMS 단문(90바이트) 요금 유도를 위한 자체 단축링크. bit.ly 등 외부 서비스는 무료 플랜이
-- 월 5개로 이 용도(1회용 토큰 링크)에 못 씀 — 직접 구현.
CREATE TABLE short_links (
  code       text PRIMARY KEY,
  target_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
ALTER TABLE short_links ENABLE ROW LEVEL SECURITY;
-- anon/authenticated 직접 접근 정책 없음 — SECURITY DEFINER 함수(create_short_link,
-- 그리고 /s/[code] 라우트가 쓰는 조회 RPC)를 통해서만 접근

CREATE OR REPLACE FUNCTION create_short_link(p_target_url text, p_expires_at timestamptz DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  LOOP
    v_code := encode(extensions.gen_random_bytes(4), 'hex');  -- 8자리 hex, 충돌시 재시도
    BEGIN
      INSERT INTO short_links (code, target_url, expires_at) VALUES (v_code, p_target_url, p_expires_at);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- 재시도
    END;
  END LOOP;
  RETURN v_code;
END;
$$;
GRANT EXECUTE ON FUNCTION create_short_link(text, timestamptz) TO anon, authenticated;

-- /s/[code] 라우트가 호출 — 조회 시점에 만료 체크
CREATE OR REPLACE FUNCTION resolve_short_link(p_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
BEGIN
  SELECT target_url INTO v_url FROM short_links
  WHERE code = p_code AND (expires_at IS NULL OR expires_at > now());
  RETURN v_url;
END;
$$;
GRANT EXECUTE ON FUNCTION resolve_short_link(text) TO anon, authenticated;
