import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/electron/renderer'
import App from './App'
import { watchViewportScale } from './lib/viewport-scale'
import 'pretendard/dist/web/static/pretendard-subset.css'
import './index.css'

// 메인 프로세스 init()에서 이미 잡은 DSN/release를 그대로 상속 — 여기선 호출만
Sentry.init({})

// 화면 해상도에 맞춰 #root 배율을 잡는다. **그리기 전에** 한 번 해야
// 첫 프레임이 잘린 채로 보였다가 제자리를 찾는 깜빡임이 없다.
watchViewportScale()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
