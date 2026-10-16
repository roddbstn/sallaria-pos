import { useState } from 'react'
import { api, orderToPayload } from '../../lib/ipc'
import type { Order } from '../../lib/mock-data'

interface Props {
  order: Order
  storeName: string
  /** 접수(영수증 출력) 완료 후 호출 — 온보딩을 다음 스텝으로 넘기는 용도 */
  onDone: () => void
}

type Stage = 'summary' | 'approve' | 'printing'

const PREP_PRESETS = [5, 10, 15, 20, 25, 30]

/**
 * 온보딩 전용 — 실제 주문이 온 것처럼 보여주는 가상 주문 카드.
 * OrderPopup과 달리 Supabase RPC는 전혀 호출하지 않고(가짜 주문이라 대응할 실제 행이 없음),
 * 접수 시 영수증 출력 IPC(order:approve)만 직접 호출한다 — 이게 실제 프린터로 종이가 나오는 유일한 경로.
 */
export default function FakeOrderPopup({ order, storeName, onDone }: Props) {
  const [stage,    setStage]    = useState<Stage>('summary')
  const [prepMins, setPrepMins] = useState(15)

  async function handleConfirm() {
    setStage('printing')
    await api.approveOrder({ order: orderToPayload(order, storeName), prepMins })
    onDone()
  }

  return (
    <div className="fixed inset-0 z-[400] bg-black/50 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-white rounded-2xl overflow-hidden flex flex-col" style={{ width: 400, maxHeight: 'calc(100vh - 40px)' }}>
        <div className="bg-ink px-5 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-medium text-[16px]">#{order.orderNumber}</span>
            <span className="text-white/60 text-[13px] font-medium">방금 주문</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-white/80 text-[13px]">{order.accountName} · {order.orderer}</span>
            <span className="text-white font-semibold text-[20px] leading-none">{order.method}</span>
          </div>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1">
          {stage === 'summary' && (
            <>
              <div className="bg-gray-bg rounded-xl p-4 mb-4 space-y-3">
                {order.items.map((item, i) => (
                  <div key={i} className="flex justify-between text-[15px] font-semibold">
                    <span>{item.name} · {item.qty}개</span>
                    <span className="text-[12px] font-normal text-gray-text">{(item.price * item.qty).toLocaleString()}원</span>
                  </div>
                ))}
                <div className="border-t border-gray-border pt-2.5 mt-2.5 flex justify-between items-center">
                  <span className="font-semibold text-[15px]">합계</span>
                  <span className="text-ink text-[20px] font-bold">{order.total.toLocaleString()}원</span>
                </div>
              </div>
              <button
                onClick={() => setStage('approve')}
                style={{ background: '#2C261F', color: '#FCFCFC' }}
                className="w-full py-3 rounded-[10px] font-bold text-[15px] transition-opacity hover:opacity-90"
              >
                승인
              </button>
            </>
          )}

          {stage === 'approve' && (
            <>
              <div className="text-[13px] font-bold mb-3">예상 소요시간</div>
              <div className="flex items-center justify-center gap-4 mb-3">
                <button
                  onClick={() => setPrepMins(p => Math.max(1, p - 1))}
                  className="w-10 h-10 rounded-xl bg-gray-100 text-gray-text text-[20px] flex items-center justify-center flex-shrink-0"
                >
                  −
                </button>
                <div className="w-24 text-center flex-shrink-0">
                  <span className="text-[42px] font-extrabold leading-none tabular-nums" style={{ color: '#6A635E' }}>{prepMins}</span>
                  <span className="text-[15px] font-semibold text-gray-text ml-1">분</span>
                </div>
                <button
                  onClick={() => setPrepMins(p => Math.min(90, p + 1))}
                  className="w-10 h-10 rounded-xl bg-gray-100 text-gray-text text-[20px] flex items-center justify-center flex-shrink-0"
                >
                  +
                </button>
              </div>
              <div className="grid grid-cols-6 gap-1 mb-4">
                {PREP_PRESETS.map(m => (
                  <button
                    key={m}
                    onClick={() => setPrepMins(m)}
                    className={`py-1.5 rounded-lg font-medium text-[12px] border transition-colors
                      ${prepMins === m ? 'bg-ink text-white border-ink' : 'text-gray-text border-gray-border'}`}
                  >
                    {m}분
                  </button>
                ))}
              </div>
              <button
                onClick={handleConfirm}
                style={{ background: '#2C261F', color: '#FCFCFC' }}
                className="w-full py-3 rounded-[10px] font-bold text-[15px] transition-opacity hover:opacity-90"
              >
                접수
              </button>
            </>
          )}

          {stage === 'printing' && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-10 h-10 rounded-full border-4 border-gray-200 animate-spin" style={{ borderTopColor: '#6A635E' }} />
              <span className="text-[13px] text-gray-text">영수증 출력 중...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
