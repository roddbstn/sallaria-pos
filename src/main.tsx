import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/electron/renderer'
import App from './App'
import FloatingButton from './FloatingButton'
import { watchViewportScale } from './lib/viewport-scale'
import 'pretendard/dist/web/static/pretendard-subset.css'
import './index.css'

// 메인 프로세스 init()에서 이미 잡은 DSN/release를 그대로 상속 — 여기선 호출만
Sentry.init({})

// 바로가기 버튼 창은 **같은 번들의 다른 화면**이다 (#floating).
// electron/index.ts 의 loadRenderer(win, 'floating') 이 띄운다.
//
// App 을 거치지 않는다: 배율(watchViewportScale)·전역 레이아웃이 끼면 72px 짜리
// 투명 창에서 버튼이 찌그러진다. 여기서 바로 갈라 놓는다.
const root = ReactDOM.createRoot(document.getElementById('root')!)

if (location.hash.replace(/^#/, '').startsWith('floating')) {
  document.documentElement.style.background = 'transparent'
  document.body.style.background = 'transparent'
  document.body.style.margin = '0'
  document.body.style.overflow = 'hidden'
  root.render(
    <React.StrictMode>
      <FloatingButton />
    </React.StrictMode>
  )
} else {
  // 화면 해상도에 맞춰 #root 배율을 잡는다. **그리기 전에** 한 번 해야
  // 첫 프레임이 잘린 채로 보였다가 제자리를 찾는 깜빡임이 없다.
  watchViewportScale()
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
