import { useState, useEffect, useMemo, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store-context'
import { mapOrderRow } from '../lib/mappers'
import { won, orderToPayload } from '../lib/ipc'
import { remainingTime } from '../lib/pickup-time'
import type { Order } from '../lib/mock-data'
import HomeOrderCard from '../components/home/HomeOrderCard'
import HomeOrderDetail from '../components/home/HomeOrderDetail'
import VerbalOrderModal from '../components/VerbalOrderModal'
import CancelReasonModal from '../components/ui/CancelReasonModal'
import BottomToast from '../components/BottomToast'

// ── 홈 ───────────────────────────────────────────────────────────────────────
//
// 주문 화면에서 "지금 처리할 것"만 떼어낸 화면.
//
// 왜 떼어냈나: 전에는 한 화면에 **시간축이 다른 둘**이 섞여 있었다 — 초 단위로 변하는
// 진행 중 주문과, 일·월 단위로 보는 매출 집계. 전자는 1.5~2m 떨어져 흘끗 보는 것이고
// 후자는 앉아서 들여다보는 것이라, 둘이 화면을 반씩 나눠 가지면 둘 다 제 역할을 못 한다.
// 집계는 '주문' 탭으로 옮겼다.
//
// 정보 우선순위(점주가 정한 순서): 1 주문번호 · 2 남은시간 · 3 금액/메뉴 · 4 옵션 ·
// 5 요청사항 · 6 거래처명. 1·2·3·6 은 좌측 카드에, 4·5 는 우측 상세에 둔다.

const TICK_MS = 10_000   // 분 단위 표시라 1초 갱신은 리렌더 낭비다

/** PostgREST 가 '그 컬럼 없다'고 할 때의 코드 */
const UNDEFINED_COLUMN = '42703'

/**
 * 0079(orders.cancel_reason · cancelled_at)를 조회에 넣을지.
 *
 * 2026-11-08 에 적용됐으니 지금 프로덕션에서는 **늘 들어간다.** 그래도 폴백을
 * 남겨 두는 이유: 선포스는 **설치형**이고 DB 는 한 벌이다. 로컬·브랜치 DB 나
 * 마이그레이션을 아직 안 돌린 환경에서 이 앱을 띄울 수 있다. 없는 컬럼을 그냥
 * 요청하면 조회가 **통째로** 실패해서, 취소 사유 한 줄 때문에 홈 화면이 빈다.
 * 한 번 시도해 보고 없다고 하면 그 뒤로는 안 넣는다. 세션당 한 번만 판단한다.
 */
let cancelCols = `
    cancel_reason, cancelled_at,`

export default function Home({ onOpenOrders }: { onOpenOrders?: () => void }) {
  const { storeId, storeName } = useStore()

  const [active,  setActive]  = useState<Order[]>([])
  const [done,    setDone]    = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState<'active' | 'done'>('active')
  const [picked,  setPicked]  = useState<string | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [toast,   setToast]   = useState('')
  const [verbalOpen, setVerbalOpen] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState<Order | null>(null)

  // 카드마다 타이머를 두면 N개가 따로 돈다 — 하나만 돌려서 내려준다
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  function flash(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(''), 3000)
  }

  const SELECT = () => `
    order_code, order_number, account_code, orderer_name, orderer_phone,
    ordered_at, menu_subtotal, delivery_fee, total_amount, balance_before, balance_after,
    method, status, note, is_deleted, requested_pickup_minutes, prep_minutes, accepted_at, completed_at,
    updated_at,
    delivery_departed_at,${cancelCols}
    accounts ( account_name, account_type ),
    order_items ( menu_name, quantity, unit_price, subtotal,
      order_item_options ( option_name, extra_price ) )
  `

  async function load() {
    if (!storeId) return
    setLoading(true)
    const kst = new Date(Date.now() + 9 * 3600_000)
    const dayStart = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600_000).toISOString()

    const fetchBoth = () => Promise.all([
      // 진행 중은 날짜와 무관하다 — 어제 받아서 아직 안 끝난 주문도 떠 있어야 한다
      supabase.from('orders').select(SELECT())
        .eq('store_id', storeId).eq('is_deleted', false)
        .in('status', ['주문완료', '조리중'])
        .order('ordered_at'),
      supabase.from('orders').select(SELECT())
        .eq('store_id', storeId).eq('is_deleted', false)
        .in('status', ['완료', '취소'])
        .gte('ordered_at', dayStart)
        .order('ordered_at', { ascending: false }),
    ])

    let [a, d] = await fetchBoth()
    // 0079 를 안 돌린 DB면 컬럼이 없다고 답한다 — 그 둘만 떼고 한 번 다시.
    // (아래 cancelCols 주석 참고. 떼고 나면 사유는 note 추측으로 떨어진다.)
    if (cancelCols && [a.error, d.error].some(e => e?.code === UNDEFINED_COLUMN)) {
      cancelCols = ''
      console.warn('[Home] orders.cancel_reason 이 없다 — 0079 를 안 돌린 DB다. 취소 사유는 note 추측으로 간다')
      ;[a, d] = await fetchBoth()
    }

    setActive((a.data ?? []).map(mapOrderRow))
    setDone((d.data ?? []).map(mapOrderRow))
    setLoading(false)
  }

  useEffect(() => { load() }, [storeId])

  // 새 주문·상태 변경을 실시간으로 — 주방이 보는 화면이라 새로고침을 기다릴 수 없다
  useEffect(() => {
    if (!storeId) return
    const ch = supabase
      .channel(`home:${storeId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `store_id=eq.${storeId}` },
        () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [storeId])

  // 급한 것부터 — 남은 시간이 적은 순. 아직 승인 안 된 신규는 맨 위로 올린다
  const list = useMemo(() => {
    const src = tab === 'active' ? active : done
    if (tab === 'done') return src
    return [...src].sort((x, y) => {
      const rx = remainingTime(x.acceptedAt, x.prepMins, now)
      const ry = remainingTime(y.acceptedAt, y.prepMins, now)
      if (rx.tone === 'pending' && ry.tone !== 'pending') return -1
      if (ry.tone === 'pending' && rx.tone !== 'pending') return 1
      // 화면에 찍히는 value 는 60분이 넘으면 '시간'으로 접힌다. 정렬은 접기 전 분으로 —
      // value 로 비교하면 2시간 초과(2)가 59분 초과(59)보다 덜 급해진다.
      const mx = rx.tone === 'over' ? -(rx.minutes ?? 0) : (rx.minutes ?? 0)
      const my = ry.tone === 'over' ? -(ry.minutes ?? 0) : (ry.minutes ?? 0)
      return mx - my
    })
  }, [tab, active, done, now])

  // 선택이 목록에서 사라지면(완료 처리 등) 자동으로 다음 건을 잡는다
  const selected = useMemo(
    () => list.find(o => o.code === picked) ?? list[0] ?? null,
    [list, picked],
  )

  // 헤더 한 줄 — 오늘 몇 건·얼마. 취소는 뺀다
  const todayStat = useMemo(() => {
    const ok = done.filter(o => o.status !== '취소')
    return { count: ok.length, amount: ok.reduce((s, o) => s + o.total, 0) }
  }, [done])

  /**
   * '준비 알림'을 이미 보낸 주문.
   *
   * 세션 안에서만 산다 — 보냈는지 적어두는 컬럼이 없다. 새로고침하면 지워지고
   * 버튼은 '준비 알림'으로 돌아간다. 그래도 괜찮다: 이 표시는 **못 누르게
   * 막는 장치가 아니라** "방금 보냈다"를 알려주는 글자일 뿐이고,
   * 알림은 몇 번을 보내도 손님 화면은 '준비 완료' 한 상태로 같다.
   */
  const [notified, setNotified] = useState<Set<string>>(new Set())

  /**
   * 준비 알림 — **상태를 바꾸지 않는다.**
   *
   * 전엔 '준비 완료' 한 버튼이 알림과 마감을 같이 했다. 그래서 손님에게 알리는
   * 순간 주문이 목록에서 사라졌다 — 만들어 놨지만 아직 안 가져간 주문이
   * 화면 어디에도 없었다. 선결제 픽업 매장에서 그 구간이 제일 긴데도.
   * 이제 알림은 알림만 하고, 주문은 '처리 완료'를 누를 때까지 목록에 남는다.
   *
   * 여러 번 눌러도 된다 — 손님이 안 오면 다시 부를 수 있어야 한다.
   */
  async function handleNotify(order: Order) {
    setBusy(true)
    // 배달이면 '출발'로도 읽힌다 — 손님 화면의 배달 지도가 이 시각을 본다.
    // 이미 찍혀 있으면 덮어쓰지 않는다(두 번째 알림이 출발 시각을 미루면 안 된다).
    if (order.method === '배달' && !order.deliveryDepartedAt) {
      await supabase.from('orders')
        .update({ delivery_departed_at: new Date().toISOString() })
        .eq('order_code', order.code)
    }

    const ch = supabase.channel(`orders:order_code=${order.code}`)
    await new Promise<void>(resolve => {
      ch.subscribe(st => {
        if (st !== 'SUBSCRIBED') return
        ch.send({ type: 'broadcast', event: 'ORDER_COMPLETED', payload: {} })
          .finally(() => { supabase.removeChannel(ch); resolve() })
      })
      window.setTimeout(resolve, 3000)
    })

    setBusy(false)
    setNotified(prev => new Set(prev).add(order.code))
    flash(order.method === '배달' ? '손님에게 배달 출발을 알렸어요' : '손님에게 준비 완료를 알렸어요')
    load()
  }

  async function handleComplete(order: Order) {
    setBusy(true)
    const isDelivery = order.method === '배달'
    const patch: Record<string, unknown> = { status: '완료' }
    if (isDelivery) patch.delivery_departed_at = new Date().toISOString()

    const { error } = await supabase.from('orders').update(patch).eq('order_code', order.code)
    setBusy(false)
    if (error) { flash('완료 처리에 실패했어요. 다시 시도해 주세요'); return }

    // 손님 화면에 알린다 (fire-and-forget)
    void (async () => {
      const ch = supabase.channel(`orders:order_code=${order.code}`)
      await new Promise<void>(resolve => {
        ch.subscribe(st => {
          if (st !== 'SUBSCRIBED') return
          ch.send({ type: 'broadcast', event: 'ORDER_COMPLETED', payload: {} })
            .finally(() => { supabase.removeChannel(ch); resolve() })
        })
        window.setTimeout(resolve, 3000)
      })
    })()

    setPicked(null)
    load()
  }

  async function handleCancel(order: Order, reason: string) {
    setBusy(true)
    // cancel_order 가 상태 변경과 잔액 환원을 한 트랜잭션으로 묶는다.
    // p_note 는 orders.note 에 들어가고, 손님 화면(두 QR웹)이 그걸 '취소 사유'로 읽는다 —
    // 데이터가 가는 길은 그대로고, 점주가 고른 문장이 그 자리에 들어갈 뿐이다.
    const { error } = await supabase.rpc('cancel_order', {
      p_order_code: order.code,
      p_allow_after_cooking: true,
      p_note: reason,
    })
    setBusy(false)
    setConfirmCancel(null)
    if (error) { flash(`취소 실패: ${error.message ?? '다시 시도해 주세요'}`); return }
    setPicked(null)
    load()
  }

  async function handleReprint(order: Order) {
    const w = window as unknown as { api?: { reprintOrder?: (p: unknown) => Promise<{ ok: boolean; error?: string }> } }
    const res = await w.api?.reprintOrder?.({ order: orderToPayload(order, storeName) })
    if (!res) return
    flash(res.ok ? '영수증을 출력합니다' : (res.error ?? '출력 실패'))
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-canvas">

      {/* ── 상단 ── */}
      <div className="flex-shrink-0 px-[24px] pt-[18px] pb-[14px] flex items-center gap-[20px]">
        {/* 탭과 구두주문을 아래 주문 목록과 **같은 440px 폭** 안에 양끝으로 둔다.
            구두주문이 만드는 건 결국 저 목록에 꽂히는 주문이라, 버튼이 목록 오른쪽 끝선에
            맞아 있어야 "이 칸의 버튼"으로 읽힌다. 전엔 탭 바로 옆에 붙어 있어서
            화면 가운데에 혼자 떠 있었다. */}
        <div className="w-[440px] flex-shrink-0 flex items-center justify-between gap-[20px]">
          <div className="flex items-center gap-[14px]">
            {(['active', 'done'] as const).map((t, i) => (
              <Fragment key={t}>
                {/* 두 탭 사이 세로선 — 둘 다 큰 글자라 간격만으로는 한 덩어리로 읽혔다 */}
                {i > 0 && <span className="w-px h-[22px] bg-canvas-line" />}
                <button
                  onClick={() => { setTab(t); setPicked(null) }}
                  /* inline-flex + items-center — 개수 배지를 글자 **중간 높이**에 맞추려면
                     baseline 이 아니라 가운데 정렬이어야 한다. */
                  className={`pressable-text inline-flex items-center gap-[7px] text-[28px] leading-none transition-colors ${
                    tab === t ? 'font-semibold text-[#1E1E1E]' : 'font-normal text-[#ADADAD]'
                  }`}
                >
                  <span>{t === 'active' ? '대기중' : '완료'}</span>
                  {/* 개수 배지 — 두 탭 모두. 전엔 '대기중' 에만 맨글자로 붙어 있어서
                      완료 건수는 목록을 열어 세어야 했다.
                      min-w + px 로 두 자리 이상도 알약 모양으로 늘어난다(원이 찌그러지지 않게). */}
                  {(t === 'active' ? active.length : done.length) > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[26px] h-[26px] px-[7px] rounded-full bg-[#6A635E] text-[15px] font-semibold leading-none text-[#FCFCFC]">
                      {t === 'active' ? active.length : done.length}
                    </span>
                  )}
                </button>
              </Fragment>
            ))}
          </div>

          <button
            onClick={() => setVerbalOpen(true)}
            className="pressable h-[38px] px-[18px] rounded-[19px] border border-[#8C8379] bg-transparent text-[15px] font-medium text-[#2C261F] hover:bg-canvas-soft"
          >
            구두주문
          </button>
        </div>

        {/* 오늘 한 줄 — 눌러서 주문 탭으로.
            14px 로는 옆의 버튼들(15px)보다도 작아서 묻혔다. 하루 종일 켜두고
            1.5~2m 밖에서 흘끗 보는 화면이라, 이 줄은 '오늘 얼마 벌었나'를 답하는
            유일한 자리다. 같은 줄의 '대기중 / 완료' 탭과 **같은 28px** 로 맞춘다 —
            이 줄에서 제일 중요한 둘이 같은 무게로 서야 눈이 둘 사이를 오간다. */}
        <button
          onClick={onOpenOrders}
          className="pressable-text ml-auto text-[28px] leading-none font-normal text-[#6A635E] tabular-nums"
        >
          오늘 <span className="font-semibold text-[#2C261F]">{todayStat.count}건</span>
          <span className="mx-[8px] text-[#C1B7AA]">·</span>
          <span className="font-semibold text-[#2C261F]">{won(todayStat.amount)}</span>
          <span className="ml-[8px] text-[#ADADAD]">›</span>
        </button>
      </div>

      {/* ── 본문 ── */}
      <div className="flex-1 min-h-0 flex gap-[16px] px-[24px] pb-[20px]">

        {/* 좌: 주문 목록 */}
        <div className="w-[440px] flex-shrink-0 overflow-y-auto pr-[4px] flex flex-col gap-[12px]">
          {loading ? (
            <div className="py-[80px] text-center text-[16px] font-normal text-[#787878]">불러오는 중…</div>
          ) : list.length === 0 ? (
            <div className="py-[90px] text-center">
              <div className="text-[26px] font-medium text-[#8C8379]">
                {tab === 'active' ? '새 주문이 없어요' : '오늘 완료된 주문이 없어요'}
              </div>
            </div>
          ) : list.map(o => (
            <HomeOrderCard
              key={o.code}
              order={o}
              now={now}
              notified={notified.has(o.code)}
              selected={selected?.code === o.code}
              onClick={() => setPicked(o.code)}
            />
          ))}
        </div>

        {/* 우: 상세 */}
        <div className="flex-1 min-w-0">
          {selected ? (
            <HomeOrderDetail
              order={selected}
              onNotify={() => handleNotify(selected)}
              notified={notified.has(selected.code)}
              onComplete={() => handleComplete(selected)}
              onCancel={() => setConfirmCancel(selected)}
              onReprint={() => handleReprint(selected)}
              busy={busy}
            />
          ) : (
            <div className="h-full rounded-[14px] bg-canvas-soft flex items-center justify-center">
              <span className="text-[16px] font-normal text-[#ADADAD]">주문을 선택하면 여기에 보여요</span>
            </div>
          )}
        </div>
      </div>

      {/* ── 취소 사유 선택 ── */}
      {confirmCancel && (
        <CancelReasonModal
          orderNumber={confirmCancel.orderNumber ?? confirmCancel.code.slice(0, 5)}
          busy={busy}
          onClose={() => setConfirmCancel(null)}
          onConfirm={reason => handleCancel(confirmCancel, reason)}
        />
      )}

      {verbalOpen && storeId && (
        <VerbalOrderModal
          storeId={storeId}
          onClose={() => setVerbalOpen(false)}
          onCreated={() => load()}
        />
      )}

      {/* 메뉴 화면 모드 전환 토스트와 같은 박스 — components/BottomToast.tsx */}
      <BottomToast message={toast} />
    </div>
  )
}
