import { resolve } from 'path'
import { builtinModules } from 'module'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Node.js 내장 모듈 + electron + native addon만 외부로 유지
// 나머지 JS 패키지(@supabase, ws, electron-store 등)는 번들에 포함
const mainExternal = [
  'electron',
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
  'serialport',
  /^@serialport\//,
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
