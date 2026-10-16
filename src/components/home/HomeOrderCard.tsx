import { won } from '../../lib/ipc'
import { remainingTime, remainStyle } from '../../lib/pickup-time'
import type { Order } from '../../lib/mock-data'

// 홈 좌측 목록의 주문 카드 한 장.
//
// 치수가 이 앱의 다른 어디보다 크다. 의도된 예외다 — 이 화면만 **1.5~2m 떨어진 곳에서**
// 읽혀야 하기 때문이다(주방에서 흘끗 보는 화면). 나머지 화면은 앉아서 보는 거라 13~18px 이
// 맞지만, 여기선 그 크기가 아무 역할도 못 한다.
//
// 크기 = 중요도. 점주가 정한 순서 그대로:
//   1 주문번호(34) → 2 남은시간(52) → 3 금액·개수(18) → 6 거래처명(15)
// 옵션(4)과 요청사항(5)은 카드에 넣지 않는다. 카드가 길어지면 한 화면에 보이는 주문 수가
// 줄고, 그 둘은 "이 주문을 집어 들었을 때" 보면 되는 정보다 — 우측 상세로 보낸다.

/** '매장 식사'는 카드에서 '매장'으로 — 긴 라벨이 주문번호를 밀어낸다 */
const METHOD_SHORT: Record<string, string> = {
  '포장': '포장', '배달': '배달', '매장 식사': '매장',
}

export default function HomeOrderCard({ order, selected, onClick, now }: {
  order:    Order
  selected: boolean
  onClick:  () => void
  /** 바깥에서 한 타이머로 내려준다 — 카드마다 타이머를 두면 N개가 따로 돈다 */
  now:      Date
}) {
  const remain = remainingTime(order.acceptedAt, order.prepMins, now)
  const style  = remainStyle(remain.tone)
  const qty    = order.items.reduce((s, it) => s + it.qty, 0)
  const method = METHOD_SHORT[order.method] ?? order.method

  return (
    <button
      onClick={onClick}
      className={`pressable w-full text-left rounded-[14px] px-[20px] py-[16px] flex items-center gap-[16px] transition-colors ${
        selected ? 'bg-[#FCFCFC] shadow-[0_2px_10px_rgba(0,0,0,0.10)]' : 'bg-canvas-soft hover:bg-[#F8F5F0]'
      }`}
    >
      <div className="flex-1 min-w-0">
        {/* 주문번호와 이용방법을 **같은 글자**로 잇는다.
            배지로 띄우면 눈이 두 번 멈춘다 — 둘은 "이 주문이 뭐냐"는 한 덩어리의 정보다. */}
        <div className="flex items-baseline mb-[4px] min-w-0">
          <span className="text-[34px] leading-none font-semibold text-[#1E1E1E] tabular-nums">
            #{order.orderNumber ?? order.code.slice(0, 5)}
          </span>
          {/* 글자 | 대신 1px 막대. font-light 로는 더 얇아지지 않고, 글꼴마다 굵기가 달라진다.
              실제 선으로 그리면 두께를 정확히 잡을 수 있다(baseline 정렬이라 self-center 로 가운데). */}
          <span className="self-center w-px h-[24px] bg-[#1E1E1E] mx-[10px] flex-shrink-0" />
          {/* 이용방법도 주문번호와 같은 색 — 색이 다르면 "번호 다음에 붙은 딴 정보"로 읽힌다 */}
          <span className="text-[34px] leading-none font-semibold text-[#1E1E1E] truncate">
            {method}
          </span>
        </div>
        <div className="text-[18px] font-medium text-[#2C261F] tabular-nums">
          {qty}개 · {won(order.total)}
        </div>
        <div className="text-[15px] font-normal text-[#787878] truncate mt-[2px]">
          {order.accountName}
        </div>
      </div>

      {/* 남은 시간 — 세로 구분선 오른쪽. 카드에서 가장 큰 글자 */}
      <div className="flex-shrink-0 flex items-stretch gap-[16px]">
        <span className="w-px bg-canvas-line self-stretch" />
        <div className="min-w-[96px] flex flex-col items-center justify-center px-[10px] py-[4px]">
          {/* 초과일 땐 머리말까지 같이 빨강 — 따로 놀면 한 덩어리로 안 읽힌다 */}
          <span
            className="text-[14px] font-normal leading-none mb-[5px] whitespace-nowrap"
            style={{ color: remain.tone === 'over' ? style.color : '#787878' }}
          >
            {remain.heading}
          </span>
          {remain.value == null ? (
            <span className="text-[30px] leading-none font-semibold" style={{ color: style.color }}>
              {remain.label}
            </span>
          ) : (
            // 단위도 숫자와 같은 52px/semibold. 작게 쓰면 '15'와 '분'이 따로 읽혀서
            // 멀리서는 숫자만 눈에 들어온다 — 이 화면은 1.5~2m 밖에서 보는 곳이다.
            <span className="flex items-baseline" style={{ color: style.color }}>
              <span className="text-[50px] leading-none font-semibold tabular-nums">{remain.value}</span>
              <span className="text-[50px] leading-none font-semibold">{remain.unit}</span>
              {/* 약속 시간을 넘긴 주문에만 경고 삼각형(Figma 786:693 — solar:danger-triangle-bold).
                  숫자와 머리말이 이미 빨강이지만, 멀리서 흘끗 보는 화면이라 색만으로는
                  "빨간 숫자"인지 "넘긴 주문"인지 구분이 한 박자 늦다.
                  테두리형으로 먼저 그렸다가 **꽉 찬 삼각형**으로 바꿨다 — 50px 숫자 옆에서
                  선 아이콘은 글자 획과 같은 무게라 묻힌다. 면으로 채워야 따로 보인다. */}
              {remain.tone === 'over' && (
                <svg width="27" height="27" viewBox="0 0 24 24" fill="none" className="self-center ml-[8px] flex-shrink-0">
                  <path
                    d="M9.84 3.28c.96-1.72 3.36-1.72 4.32 0l7.07 12.68c.94 1.68-.27 3.75-2.2 3.75H4.97c-1.93 0-3.14-2.07-2.2-3.75L9.84 3.28Z"
                    fill="currentColor"
                  />
                  <path d="M12 8.1v4.8" stroke="#FCFCFC" strokeWidth="2.1" strokeLinecap="round" />
                  <circle cx="12" cy="16.2" r="1.2" fill="#FCFCFC" />
                </svg>
              )}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
