import { resolve } from 'path'
import { builtinModules } from 'module'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Node.js 내장 모듈 + electron + native addon + serialport 전체를 외부로 유지
// serialport를 번들에 인라인하면 electron-builder가 의존성으로 인식 못해 @serialport/bindings-cpp를 패키징 안 함
const mainExternal = [
  'electron',
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
  'serialport',                 // JS 레이어 — 번들 안 함 (electron-builder가 node_modules로 패키징)
  '@serialport/bindings-cpp',   // native .node
  'bufferutil',                 // ws 선택적 native addon
  'utf-8-validate',             // ws 선택적 native addon
]

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: mainExternal,
        input: resolve(__dirname, 'electron/index.ts'),
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        external: ['electron', ...builtinModules, ...builtinModules.map(m => `node:${m}`)],
        input: resolve(__dirname, 'electron/preload.ts'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/index.html'),
      },
    },
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
    plugins: [react()],
  },
})
