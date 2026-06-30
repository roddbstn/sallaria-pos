import { resolve } from 'path'
import { builtinModules } from 'module'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Node.js 내장 모듈 + electron + native .node 바인딩만 외부로 유지.
// serialport JS 레이어는 Vite가 번들에 인라인 — pnpm의 비평탄 node_modules 때문에
// electron-builder가 sub-package를 추적 못하는 문제를 피하기 위함.
// @serialport/bindings-cpp(.node)만 외부 → package.json files에 명시적으로 추가.
const mainExternal = [
  'electron',
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
  '@serialport/bindings-cpp',   // native .node — package.json files에 명시적 포함
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
