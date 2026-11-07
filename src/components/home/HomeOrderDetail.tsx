import { won, orderToPayload, parseNote } from '../../lib/ipc'
import { maskName, maskPhone } from '../../lib/mask'
import RevealText from '../ui/RevealText'
import CopyButton from '../ui/CopyButton'
import { isKnownCancelReason } from '../../lib/cancel-reason'
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
  order, onNotify, notified, onComplete, onCancel, onReprint, busy,
}: {
  order:      Order
  /** 준비 알림 — 손님에게만 알린다. 주문은 목록에 남는다 */
  onNotify:   () => void
  /** 이 세션에서 이미 알림을 보냈나 */
  notified:   boolean
  onComplete: () => void
  onCancel:   () => void
  onReprint:  () => void
  busy:       boolean
}) {
  const qty  = order.items.reduce((s, it) => s + it.qty, 0)
  const note = parseNote(order.remarks)
  const isDelivery = order.method === '배달'
  const isCancelled = order.status === '취소'
  /**
   * 취소 사유.
   *
   * note 를 그대로 쓰면 **손님이 쓴 '수저·포크 O' 가 취소 사유로 둔갑한다** —
   * cancel_order 가 사유를 note 에 덮어쓰는데, 사유 없이 취소한 주문은
   * 손님 요청사항이 그대로 남아 있기 때문이다. 고정 목록에 있는 말일 때만 사유로 본다
   * (lib/cancel-reason.ts).
   * 0079 마이그레이션이 적용되면 `order.cancelReason` 한 줄로 바뀐다.
   */
  const cancelReason = isCancelled && isKnownCancelReason(note.customerNote)
    ? (note.customerNote as string)
    : ''
  /** 이미 끝난 주문 — 완료·취소. 더 할 수 있는 게 없다(영수증 재출력만 남는다) */
  const isSettled  = order.status === '완료' || isCancelled

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
          className="pressable flex-shrink-0 h-[42px] px-[18px] rounded-[21px] border border-[#D9D9D9] bg-[#FCFCFC] text-[16px] font-medium text-[#414141] hover:bg-[#F2F2F2]"
        >
          영수증 재출력
        </button>
      </div>

      {/* 본문 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-[28px]">
        {/* 취소 사유 — **요청사항과 별개의 박스**로, 그 위에 둔다.
            전엔 요청사항 박스를 취소 사유로 바꿔치기했다. 그러면 점주가 고른 사유가
            손님이 쓴 요청사항 자리에 앉아서, 누가 쓴 말인지가 섞인다.
            둘은 성격이 다른 정보라 자리도 따로 가져야 한다.

            ⚠️ 지금은 사유를 note 에서 읽는다 — cancel_order 가 note 를 사유로
               **덮어쓰기** 때문이다(note = coalesce(p_note, note)).
               그래서 취소된 주문은 아래 요청사항 박스가 비어 보인다. 손님이 쓴 말이
               지워졌기 때문이지 안 쓴 게 아니다. 배달 주소까지 같이 지워진다
               (취소된 배달 4건 중 3건에서 [배달주소]가 사라져 있었다).
               supabase/migrations/0079_order_cancel_reason.sql 이 그걸 고친다.
               적용되면 아래 cancelReason 한 줄만 바꾸면 된다. */}
        {isCancelled && (
          <div className="mb-[12px] rounded-[10px] bg-[#FFEFEF] px-[14px] py-[12px]">
            <div className="text-[15px] font-normal text-[#C92A2A] mb-[4px]">주문 취소 사유</div>
            <div className="text-[19px] font-medium text-[#2C261F] leading-relaxed">
              {cancelReason || '사유가 기록되지 않았어요'}
            </div>
            {order.cancelledAt && (
              <div className="text-[15px] font-normal text-[#787878] mt-[6px] tabular-nums">
                {orderedAtLabel(order.cancelledAt)} 취소
              </div>
            )}
          </div>
        )}

        {/* 요청사항 — 놓치면 음식을 다시 만든다.
            '요청사항' 라벨은 뺐다. 주황 박스가 이 화면에 하나뿐이라 박스 자체가 라벨 역할을 한다.
            (취소 박스는 빨강이라 색으로 갈린다) */}
        {(() => {
          // 위에서 사유로 쓴 문장은 여기서 뺀다 — 같은 글자가 두 박스에 뜨면
          // 손님이 쓴 건지 점주가 고른 건지 더 헷갈린다
          const req = [cancelReason ? null : note.customerNote, note.deliveryNote]
            .filter(Boolean).join(' / ')
          if (!req) return null
          return (
            <div className="mb-[16px] rounded-[10px] bg-[#FFF4E8] px-[14px] py-[11px]">
              <div className="text-[19px] font-medium text-[#2C261F] leading-relaxed">{req}</div>
            </div>
          )
        })()}

        {/* 메뉴 표 */}
        {/* 머리글 밑줄도 아래 행 구분선과 같은 #E5E5E5. 잉크색(#2C261F)으로 그었더니
            머리글만 표에서 떨어져 나와 보였다 — 여기 글자는 13px 회색이라 굵은 선이 과하다. */}
        <div className="flex items-end border-b border-[#E5E5E5] pb-[8px] text-[17px] font-normal text-[#787878]">
          <span className="flex-1">메뉴</span>
          <span className="w-[64px] text-center">수량</span>
          <span className="w-[100px] text-right">금액</span>
        </div>

        {order.items.map((it, i) => {
          const opts = (it.optionDetails ?? []).filter(o => !isPriceOption(o.name))
          return (
            <div key={i} className="py-[12px] border-b border-[#E5E5E5]">
              <div className="flex items-start">
                <span className="flex-1 text-[22px] font-medium text-[#1E1E1E] pr-[8px]">{it.name}</span>
                <span className="w-[64px] text-center text-[22px] font-medium text-[#1E1E1E] tabular-nums">{it.qty}</span>
                <span className="w-[100px] text-right text-[22px] font-medium text-[#1E1E1E] tabular-nums">
                  {won(it.price * it.qty)}
                </span>
              </div>
              {/* 옵션 추가가격은 **옵션 이름 바로 뒤**에 괄호로 붙인다.
                  전엔 오른쪽 금액 칸에 세워서 메뉴 금액 바로 아래 줄에 '+500원'이 찍혔다.
                  그런데 위 금액은 이미 옵션값이 더해진 값이라, 한 번 더 더해야 하는 것처럼
                  읽혔다. 이름 뒤에 붙이면 "이 옵션 때문에 500원"으로 읽힌다. */}
              {opts.map((o, j) => (
                <div key={j} className="mt-[4px] text-[19px] font-normal text-[#787878] pl-[14px]">
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
            <span className="flex-1 text-[19px] font-normal text-[#787878]">배달료</span>
            <span className="w-[64px]" />
            <span className="w-[100px] text-right text-[19px] font-normal text-[#787878] tabular-nums">
              {won(order.deliveryFee ?? 0)}
            </span>
          </div>
        )}

        {/* 최종금액 */}
        {/* 메뉴 줄과 같은 크기·굵기(19/medium) — 표의 마지막 줄로 읽히게 */}
        <div className="flex items-center py-[16px]">
          <span className="flex-1 text-[22px] font-medium text-[#1E1E1E]">최종금액</span>
          <span className="w-[64px] text-center text-[22px] font-medium text-[#1E1E1E] tabular-nums">{qty}</span>
          <span className="w-[100px] text-right text-[22px] font-medium text-[#1E1E1E] tabular-nums">
            {won(order.total)}
          </span>
        </div>

        {/* 고객 정보 — 기본은 가린다. 이 화면은 카운터 앞에서 손님에게 그대로 보인다.
            '고객 정보'라는 라벨은 뺐다. 아래 두 줄이 이미 고객 정보라서 라벨이 한 줄을 더 먹기만 했다.
            그 자리는 **주문 일시**가 쓴다 — 블록에서 유일하게 가려지지 않는 값이고,
            전화를 걸기 전에 "언제 시킨 건지"를 먼저 봐야 한다. */}
        <div className="rounded-[10px] bg-[#F7F7F7] px-[14px] py-[12px] mb-[16px]">
          <div className="mb-[6px]">
            <span className="text-[15px] font-normal text-[#787878] tabular-nums">
              {orderedAtLabel(order.createdAt)} 주문
            </span>
          </div>
          {/* 눈 버튼은 값 바로 옆에 붙는다 — 주문 팝업·고객 패널과 같은 RevealText 다.
              전엔 박스 오른쪽 위에 '보기' 글자 하나가 떨어져 있어서, 무엇을 여는 버튼인지
              가려진 값과 떨어져 보였다.
              key 를 주는 이유: 이 패널은 주문을 바꿔도 다시 그려지지 않아서, key 가 없으면
              A 를 열어둔 상태가 B 로 넘어간다. */}
          <div className="flex items-center gap-[4px] text-[17px] font-normal text-[#1E1E1E] min-w-0">
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
                className="text-[16px] font-normal text-[#787878] tabular-nums" iconSize={15}
              />
            </div>
          )}
          {/* 배달 주소는 **복사**가 된다 — 눈으로 옮겨 적으면 숫자 하나가 틀어진다.
              도로명과 상세주소를 **줄과 버튼까지 나눠** 둔다. 붙여 넣는 곳이
              보통 둘로 갈려 있어서다(배달앱·내비는 도로명만 받고 상세주소는
              따로 적는 칸이 있다). 한 덩어리로 복사하면 거기서 사람이 손으로
              잘라내야 한다.
              (주문 팝업의 배달 주소도 같은 버튼을 쓴다) */}
          {isDelivery && note.deliveryAddress && (
            <div className="mt-[6px] flex flex-col gap-[2px]">
              <div className="flex items-center gap-[2px]">
                <span className="text-[16px] font-normal text-[#414141] leading-relaxed min-w-0">
                  {note.deliveryAddress}
                </span>
                <CopyButton variant="black" text={note.deliveryAddress} />
              </div>
              {note.deliveryDetail && (
                <div className="flex items-center gap-[2px]">
                  <span className="text-[16px] font-normal text-[#787878] leading-relaxed min-w-0">
                    {note.deliveryDetail}
                  </span>
                  <CopyButton variant="black" text={note.deliveryDetail} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 액션 — 세 개. 가장 오른쪽이 가장 크고 유일하게 색을 쓴다(주 동작 자리).
          그 자리를 **준비 알림**이 가진다. 한 주문에서 가장 자주 누르고, 늦으면
          손님이 헛걸음하는 버튼이기 때문이다.

          전엔 '준비 완료' 하나가 알림과 마감을 같이 했다. 그래서 손님에게 알리는
          순간 주문이 목록에서 사라졌다 — 만들어 놨지만 아직 안 가져간 주문이
          화면 어디에도 없었다. 선결제 픽업 매장에서 그 구간이 제일 긴데도.
          이제 셋으로 나눈다:
            주문 거부 — 돈이 환원되고 손님에게 취소가 간다. 그래서 가장 작고 가장 왼쪽
            처리 완료 — 목록에서 내린다. **알림 전에도 누를 수 있다** —
                       알리기 전에 손님이 그냥 가져가는 일이 흔하다
            준비 알림 — 손님에게만 알린다. 주문은 남는다. **여러 번 눌러도 된다** —
                       손님이 안 오면 다시 불러야 한다

          **이미 끝난 주문에는 안 보인다.** 완료·취소된 건에 버튼이 그대로 떠 있으면
          아직 할 일이 남은 것처럼 읽히고, 피크타임에 잘못 누르면 끝난 주문을 다시
          건드린다. 탭이 아니라 **주문 자체의 상태**로 판단한다. */}
      {!isSettled && (
        <div className="flex-shrink-0 px-[28px] py-[18px] flex gap-[12px]">
          <button
            onClick={onCancel}
            disabled={busy}
            className="pressable w-[118px] h-[88px] rounded-[12px] border border-[#D9D9D9] bg-[#FCFCFC] text-[19px] font-medium text-[#414141] hover:bg-[#F2F2F2] disabled:opacity-40"
          >
            주문 거부
          </button>
          <button
            onClick={onComplete}
            disabled={busy}
            className="pressable w-[118px] h-[88px] rounded-[12px] border border-[#D9D9D9] bg-[#FCFCFC] text-[19px] font-medium text-[#414141] hover:bg-[#F2F2F2] disabled:opacity-40"
          >
            처리 완료
          </button>
          <button
            onClick={onNotify}
            disabled={busy}
            className="pressable flex-1 h-[88px] rounded-[12px] bg-[#E15D43] text-[#FCFCFC] text-[24px] font-semibold hover:opacity-90 disabled:opacity-40"
          >
            {/* 한 번 보낸 뒤에는 '다시 알리기' — 눌러도 되는 버튼이라는 걸 글자로 말한다.
                막지는 않는다. 손님이 안 오면 다시 불러야 한다. */}
            {notified
              ? '다시 알리기'
              : isDelivery ? '배달 출발 알림' : '준비 알림'}
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
