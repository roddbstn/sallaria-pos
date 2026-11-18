// 브라우저에서 화면만 띄워 보는 dev 전용 설정 (Electron 없이).
// electron.vite.config.ts 는 그대로 두고, 이 설정은 renderer 만 평범한 Vite 로 서빙한다.
//
//   pnpm vite --config vite.preview.config.ts
//   → http://localhost:5178/dev/signup-preview.html
//
// 프로덕션 빌드는 이 파일을 쓰지 않는다 (electron-vite build 가 src/index.html 만 엔트리로 잡는다).

import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root:    resolve(__dirname, 'src'),
  envDir:  resolve(__dirname),          // .env 는 프로젝트 루트에 있다
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  plugins: [react()],
  server:  { port: 5178, strictPort: true },
})
