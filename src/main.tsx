import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/electron/renderer'
import App from './App'
import OrderPopupWindow from './OrderPopupWindow'
import { watchViewportScale } from './lib/viewport-scale'
import 'pretendard/dist/web/static/pretendard-subset.css'
import './index.css'

// 메인 프로세스 init()에서 이미 잡은 DSN/release를 그대로 상속 — 여기선 호출만
Sentry.init({})

// 같은 번들에서 두 화면이 뜬다 — 메인 창과 '새 주문' 알림 창.
// 창마다 index.html 을 따로 만들지 않는 이유는 빌드 산출물이 둘로 갈리면
// 폰트·CSS·공통 코드가 통째로 두 벌이 되기 때문이다.
// 어느 쪽인지는 electron/index.ts 의 loadRenderer 가 붙인 hash 로 가른다.
const isOrderPopup = window.location.hash === '#order-popup'

// 화면 해상도에 맞춰 #root 배율을 잡는다. **그리기 전에** 한 번 해야
// 첫 프레임이 잘린 채로 보였다가 제자리를 찾는 깜빡임이 없다.
// 알림 창은 760px 카드 하나라 배율을 걸지 않는다 — 걸면 카드가 창을 넘친다.
if (!isOrderPopup) watchViewportScale()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isOrderPopup ? <OrderPopupWindow /> : <App />}
  </React.StrictMode>
)
