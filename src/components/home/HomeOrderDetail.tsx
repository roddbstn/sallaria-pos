import { won, orderToPayload, parseNote } from '../../lib/ipc'
import { maskName, maskPhone } from '../../lib/mask'
import RevealText from '../ui/RevealText'
import type { Order } from '../../lib/mock-data'

// 홈 우측의 주문 상세.
//
// 모달이 아니라 **고정 패널**이다. 조리하면서 보는 화면이라, 한 건 보려고 열고 닫는 동작이
// 끼면 안 된다. (신규 주문 팝업은 그대로 모달로 둔다 — 그건 "받을래 말래"를 묻는 거라
// 하던 일을 멈추게 하는 게 맞다.)
//
// 여기 담기는 건 우선순위 4·5 — 옵션과 요청사항이다. 목록 카드에서 뺀 둘이 여기 있다.

/** 카드와 같은 축약 — '매장 식사'는 길어서 주문번호를 밀어낸다 */
const METHOD_SHORT: Record<string, string> = {
  '포장': '포장', '배달': '배달', '매장 식사': '매장',
}

/** 주문 시각 — '10/16 14:08' */
function orderedAtLabel(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** "8,900원" 처럼 가격이 곧 이름인 필수 옵션은 메뉴값이라 줄로 세우지 않는다 */
function isPriceOption(name: string): boolean {
  return /^\d[\d,]*원$/.test(name)
}

export default function HomeOrderDetail({
  order, onComplete, onCancel, onReprint, busy,
}: {
  order:      Order
  onComplete: () => void
  onCancel:   () => void
  onReprint:  () => void
  busy:       boolean
}) {
  const qty  = order.items.reduce((s, it) => s + it.qty, 0)
  const note = parseNote(order.remarks)
  const isDelivery = order.method === '배달'
  /** 이미 끝난 주문 — 완료·취소. 더 할 수 있는 게 없다(영수증 재출력만 남는다) */
  const isSettled  = order.status === '완료' || order.status === '취소'

  return (
    <div className="h-full bg-[#FCFCFC] rounded-[14px] flex flex-col overflow-hidden">
      {/* 헤더 — 주문번호 + 영수증 재출력 */}
      <div className="flex-shrink-0 px-[28px] pt-[22px] pb-[16px] flex items-center justify-between gap-[16px]">
        {/* 카드와 같은 표기 — #번호 | 이용방법.
            이용방법에 truncate 를 걸지 않는 이유는 HomeOrderCard 와 같다 —
            '배..' 는 아무 뜻도 없다. 자를 거면 번호를 자른다. */}
        <span className="flex items-baseline min-w-0 overflow-hidden">
          <span className="text-[34px] leading-none font-semibold text-[#1E1E1E] tabular-nums truncate">
            #{order.orderNumber ?? order.code.slice(0, 5)}
          </span>
          {/* 글자 | 대신 1px 막대. font-light 로는 더 얇아지지 않고, 글꼴마다 굵기가 달라진다.
              실제 선으로 그리면 두께를 정확히 잡을 수 있다(baseline 정렬이라 self-center 로 가운데). */}
          <span className="self-center w-px h-[24px] bg-[#1E1E1E] mx-[8px] flex-shrink-0" />
          {/* 카드와 같은 규칙 — 이용방법도 주문번호와 같은 색 */}
          <span className="text-[34px] leading-none font-semibold text-[#1E1E1E] flex-shrink-0 whitespace-nowrap">
            {METHOD_SHORT[order.method] ?? order.method}
          </span>
        </span>
        <button
          onClick={onReprint}
          className="pressable flex-shrink-0 h-[38px] px-[16px] rounded-[19px] border border-[#D9D9D9] bg-[#FCFCFC] text-[14px] font-medium text-[#414141] hover:bg-[#F2F2F2]"
        >
          영수증 재출력
        </button>
      </div>

      {/* 본문 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-[28px]">
        {/* 요청사항 — 있으면 가장 먼저. 놓치면 음식을 다시 만든다.
            '요청사항' 라벨은 뺐다. 주황 박스가 이 화면에 하나뿐이라 박스 자체가 라벨 역할을 한다. */}
        {(note.customerNote || note.deliveryNote) && (
          <div className="mb-[16px] rounded-[10px] bg-[#FFF4E8] px-[14px] py-[11px]">
            <div className="text-[17px] font-medium text-[#2C261F] leading-relaxed">
              {[note.customerNote, note.deliveryNote].filter(Boolean).join(' / ')}
            </div>
          </div>
        )}

        {/* 메뉴 표 */}
        {/* 머리글 밑줄도 아래 행 구분선과 같은 #E5E5E5. 잉크색(#2C261F)으로 그었더니
            머리글만 표에서 떨어져 나와 보였다 — 여기 글자는 13px 회색이라 굵은 선이 과하다. */}
        <div className="flex items-end border-b border-[#E5E5E5] pb-[8px] text-[15px] font-normal text-[#787878]">
          <span className="flex-1">메뉴</span>
          <span className="w-[64px] text-center">수량</span>
          <span className="w-[100px] text-right">금액</span>
        </div>

        {order.items.map((it, i) => {
          const opts = (it.optionDetails ?? []).filter(o => !isPriceOption(o.name))
          return (
            <div key={i} className="py-[12px] border-b border-[#E5E5E5]">
              <div className="flex items-start">
                <span className="flex-1 text-[19px] font-medium text-[#1E1E1E] pr-[8px]">{it.name}</span>
                <span className="w-[64px] text-center text-[19px] font-medium text-[#1E1E1E] tabular-nums">{it.qty}</span>
                <span className="w-[100px] text-right text-[19px] font-medium text-[#1E1E1E] tabular-nums">
                  {won(it.price * it.qty)}
                </span>
              </div>
              {/* 옵션 추가가격은 **옵션 이름 바로 뒤**에 괄호로 붙인다.
                  전엔 오른쪽 금액 칸에 세워서 메뉴 금액 바로 아래 줄에 '+500원'이 찍혔다.
                  그런데 위 금액은 이미 옵션값이 더해진 값이라, 한 번 더 더해야 하는 것처럼
                  읽혔다. 이름 뒤에 붙이면 "이 옵션 때문에 500원"으로 읽힌다. */}
              {opts.map((o, j) => (
                <div key={j} className="mt-[4px] text-[17px] font-normal text-[#787878] pl-[14px]">
                  {o.name}
                  {o.extraPrice ? <span className="text-[#ADADAD]"> (+{won(o.extraPrice)})</span> : null}
                </div>
              ))}
            </div>
          )
        })}

        {/* 배달료는 메뉴가 아니라 별도 줄 — 영수증과 같은 규칙 */}
        {isDelivery && (order.deliveryFee ?? 0) > 0 && (
          <div className="flex items-center py-[12px] border-b border-[#E5E5E5]">
            <span className="flex-1 text-[17px] font-normal text-[#787878]">배달료</span>
            <span className="w-[64px]" />
            <span className="w-[100px] text-right text-[17px] font-normal text-[#787878] tabular-nums">
              {won(order.deliveryFee ?? 0)}
            </span>
          </div>
        )}

        {/* 최종금액 */}
        {/* 메뉴 줄과 같은 크기·굵기(19/medium) — 표의 마지막 줄로 읽히게 */}
        <div className="flex items-center py-[16px]">
          <span className="flex-1 text-[19px] font-medium text-[#1E1E1E]">최종금액</span>
          <span className="w-[64px] text-center text-[19px] font-medium text-[#1E1E1E] tabular-nums">{qty}</span>
          <span className="w-[100px] text-right text-[19px] font-medium text-[#1E1E1E] tabular-nums">
            {won(order.total)}
          </span>
        </div>

        {/* 고객 정보 — 기본은 가린다. 이 화면은 카운터 앞에서 손님에게 그대로 보인다.
            '고객 정보'라는 라벨은 뺐다. 아래 두 줄이 이미 고객 정보라서 라벨이 한 줄을 더 먹기만 했다.
            그 자리는 **주문 일시**가 쓴다 — 블록에서 유일하게 가려지지 않는 값이고,
            전화를 걸기 전에 "언제 시킨 건지"를 먼저 봐야 한다. */}
        <div className="rounded-[10px] bg-[#F7F7F7] px-[14px] py-[12px] mb-[16px]">
          <div className="mb-[6px]">
            <span className="text-[13px] font-normal text-[#787878] tabular-nums">
              {orderedAtLabel(order.createdAt)} 주문
            </span>
          </div>
          {/* 눈 버튼은 값 바로 옆에 붙는다 — 주문 팝업·고객 패널과 같은 RevealText 다.
              전엔 박스 오른쪽 위에 '보기' 글자 하나가 떨어져 있어서, 무엇을 여는 버튼인지
              가려진 값과 떨어져 보였다.
              key 를 주는 이유: 이 패널은 주문을 바꿔도 다시 그려지지 않아서, key 가 없으면
              A 를 열어둔 상태가 B 로 넘어간다. */}
          <div className="flex items-center gap-[4px] text-[15px] font-normal text-[#1E1E1E] min-w-0">
            <span className="truncate">{order.accountName}</span>
            <span className="text-[#787878] flex-shrink-0">·</span>
            <RevealText
              key={`n-${order.code}`}
              value={order.orderer} masked={maskName(order.orderer)}
              className="text-[#787878] flex-shrink-0" iconSize={13}
            />
          </div>
          {order.phone && (
            <div className="mt-[2px]">
              <RevealText
                key={`p-${order.code}`}
                value={order.phone} masked={maskPhone(order.phone)}
                className="text-[14px] font-normal text-[#787878] tabular-nums" iconSize={13}
              />
            </div>
          )}
          {isDelivery && note.deliveryAddress && (
            <div className="text-[14px] font-normal text-[#414141] mt-[6px] leading-relaxed">
              {note.deliveryAddress}
              {note.deliveryDetail && <span className="text-[#787878]"> {note.deliveryDetail}</span>}
            </div>
          )}
        </div>
      </div>

      {/* 액션 — 준비완료가 가장 크고 유일하게 색을 쓴다.
          전엔 버튼에 mr-[24px] 를 더 줘서 오른쪽 끝이 28+24=52px 였는데, 위 메뉴표·고객정보는
          모두 28px 선에서 끝난다. 세로로 내려오는 오른쪽 끝선이 버튼에서만 안쪽으로 꺾였다.

          **이미 끝난 주문에는 안 보인다.** 완료·취소된 건에 '준비 완료'와 '주문 취소'가
          그대로 떠 있으면 아직 할 일이 남은 것처럼 읽히고, 피크타임에 잘못 누르면
          끝난 주문을 다시 건드린다. 탭이 아니라 **주문 자체의 상태**로 판단한다 —
          같은 주문을 어느 목록에서 열었든 결론은 같아야 한다. */}
      {!isSettled && (
        <div className="flex-shrink-0 px-[28px] py-[18px] flex gap-[12px]">
          <button
            onClick={onCancel}
            disabled={busy}
            className="pressable w-[140px] h-[88px] rounded-[12px] border border-[#D9D9D9] bg-[#FCFCFC] text-[19px] font-medium text-[#414141] hover:bg-[#F2F2F2] disabled:opacity-40"
          >
            주문 취소
          </button>
          <button
            onClick={onComplete}
            disabled={busy}
            className="pressable flex-1 h-[88px] rounded-[12px] bg-[#E15D43] text-[#FCFCFC] text-[24px] font-semibold hover:opacity-90 disabled:opacity-40"
          >
            {isDelivery ? '배달 출발' : '준비 완료'}
          </button>
        </div>
      )}
    </div>
  )
}

/** 재출력 payload — 영수증과 같은 금액 3종(DB 값)을 쓰도록 ipc 유틸에 맡긴다 */
export function reprintPayload(order: Order, storeName: string) {
  return orderToPayload(order, storeName)
}
