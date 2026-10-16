import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/electron/renderer'
import App from './App'
import 'pretendard/dist/web/static/pretendard-subset.css'
import './index.css'

// 메인 프로세스 init()에서 이미 잡은 DSN/release를 그대로 상속 — 여기선 호출만
Sentry.init({})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
