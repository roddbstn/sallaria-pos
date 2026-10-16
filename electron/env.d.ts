/// <reference types="electron-vite/node" />

// electron-vite 가 빌드 때 치환해 넣는 환경변수.
// 선언이 없으면 import.meta.env.VITE_* 가 전부 "존재하지 않는 속성"으로 잡힌다.
// (렌더러 쪽은 src/vite-env.d.ts 의 vite/client 레퍼런스가 같은 역할을 한다)
interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?:    string
  readonly VITE_SUPABASE_URL?:  string
  readonly VITE_SUPABASE_ANON?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
