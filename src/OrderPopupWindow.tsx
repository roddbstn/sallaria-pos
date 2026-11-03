import { useEffect, useState } from 'react'
import OrderPopup from './components/OrderPopup'
import { StoreContext, type StoreSession } from './lib/store-context'
import type { Order } from './lib/mock-data'

// 별도 창으로 뜨는 주문 알림 화면.
//
// ── 왜 따로 있나 ───────────────────────────────────────────────────────────
// 점주 대부분은 메인 POS(오케이포스 등)를 띄워 놓고 쓴다. 선포스 창이 그 뒤에
// 가려져 있으면 주문이 들어와도 화면에 아무 일도 안 일어난다. 그래서 알림 팝업만
// 떼어 내 **항상 맨 앞에 서는 창**으로 띄운다(electron/index.ts 의 popupWindow).
//
// ── 이 창이 하는 일과 안 하는 일 ───────────────────────────────────────────
// 하는 일: 메인 창이 보내준 큐를 그리고, 점주가 누른 걸 되돌려 보낸다.
// 안 하는 일: 큐를 스스로 만들지 않는다. Realtime 구독도 하지 않는다.
//   주문 큐를 두 창이 따로 들고 있으면 어느 쪽이 진짜인지가 금방 갈린다 —
//   한쪽에서 접수한 주문이 다른 쪽에 남아 있는 식으로.
//
// 접수·거부에 따르는 실제 처리(approve_order RPC · 영수증 출력 · broadcast)는
// OrderPopup 이 그대로 한다. 그 코드는 **한 벌뿐**이고 어느 창에서 돌든 같다.
// 렌더러가 다를 뿐 세션(localStorage)은 같은 파티션이라 supabase 호출도 그대로 된다.

interface PopupData {
  queue:   Order[]
  session: StoreSession
}

export default function OrderPopupWindow() {
  const [data, setData] = useState<PopupData | null>(null)

  useEffect(() => {
    const w = window as unknown as {
      api?: {
        onPopupData?:  (cb: (v: unknown) => void) => void
        offPopupData?: () => void
      }
    }
    w.api?.onPopupData?.(v => setData(v as PopupData))
    return () => { w.api?.offPopupData?.() }
  }, [])

  function send(action: { type: 'dismiss' | 'approve' | 'error'; message?: string }) {
    const w = window as unknown as { api?: { popupAction?: (p: unknown) => void } }
    w.api?.popupAction?.(action)
  }

  // 아직 첫 데이터가 안 왔거나 큐가 빈 상태.
  // 큐가 비면 메인 창이 이 창을 닫으므로 잠깐만 보이는 화면이다.
  if (!data || data.queue.length === 0) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-[#FCFCFC] text-[14px] text-[#ADADAD]">
        주문을 불러오는 중…
      </div>
    )
  }

  return (
    <StoreContext.Provider value={data.session}>
      <OrderPopup
        bare
        queue={data.queue}
        onClose={() => send({ type: 'dismiss' })}
        onApprove={() => send({ type: 'approve' })}
        onError={msg => send({ type: 'error', message: msg })}
      />
    </StoreContext.Provider>
  )
}
