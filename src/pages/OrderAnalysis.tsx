import { useState, useEffect, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store-context'
import { won } from '../lib/ipc'
import { DB_METHOD_MAP } from '../lib/mappers'

// ── 주문 리포트 ───────────────────────────────────────────────────────────────
//
// "내일 재료 얼마나 준비하지?", "요즘 안 오는 데 어디지?"에 답하는 화면.
// 매출 리포트가 지난달을 정산하는 곳이라면 여기는 다음 주를 준비하는 곳이다.
//
// 설계 원칙: **숫자만 띄우면 엑셀이다.** 히트맵·표마다 아래에 한 줄의 문장을 붙여서,
// 점주가 머릿속으로 할 일(최댓값 찾기, 비율 환산, 주기 비교)을 화면이 대신 한다.
//
// ⚠️ 시간대: orders.ordered_at 은 UTC 다. KST 로 바꾸지 않고 집계하면 9시간 밀려서
//    저녁 6시 피크가 아침 9시로 나온다(실제 데이터로 확인함). 반드시 toKst 를 거친다.
//
// ⚠️ 기간이 두 개인 이유: 히트맵·메뉴·이용방법은 사용자가 고른 창(7/30/90일)을 쓰지만,
//    주문 주기는 고정 180일을 쓴다. 창 안의 주문만으로 주기를 재면 **정작 뜸해진 거래처가
//    창 밖에 있어서 표에서 사라진다** — 찾으려는 대상이 빠지는 집계가 된다.

const KST_OFFSET_MS = 9 * 3600_000
const DOW = ['일', '월', '화', '수', '목', '금', '토']
/** 영업시간 범위만 본다 — 새벽 칸은 늘 비어서 히트맵 대비를 희석시킨다 */
const HOURS = Array.from({ length: 15 }, (_, i) => i + 8)   // 08~22시
/** 주기 계산 기간(일). 창과 분리된 고정값 */
const CYCLE_DAYS = 180

interface WindowRow {
  dow:    number
  hour:   number
  /** 'MM.DD' (KST) — 칸을 눌렀을 때 "어느 날의 그 시간인지" 보여주기 위해 */
  date:   string
  method: string
  deliveryFee: number
}

interface MenuRow { name: string; qty: number; amount: number }
interface OptRow  { name: string; qty: number }

interface CycleRow {
  account:  string
  orders:   number
  lastDays: number | null
  avgGap:   number | null
  balance:  number
}

/** UTC ISO → KST 기준 요일·시 */
function toKst(iso: string) {
  const d = new Date(new Date(iso).getTime() + KST_OFFSET_MS)
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    dow:  d.getUTCDay(),
    hour: d.getUTCHours(),
    date: `${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}`,
  }
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-[30px]">
      <div className="text-[13px] font-medium text-[#2C261F] mb-[2px]">{title}</div>
      {hint && <div className="text-[11px] font-normal text-[#ADADAD] mb-[10px]">{hint}</div>}
      {children}
    </div>
  )
}

/** 집계를 사람 말로 — 이 화면이 엑셀과 갈리는 지점 */
function Insight({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-[10px] rounded-[9px] bg-[#F2F2F2] px-[13px] py-[10px] text-[13px] font-normal text-[#1E1E1E] leading-relaxed">
      {children}
    </div>
  )
}

export default function OrderAnalysis() {
  const { storeId } = useStore()
  const [rows,    setRows]    = useState<WindowRow[]>([])
  const [menus,   setMenus]   = useState<MenuRow[]>([])
  const [opts,    setOpts]    = useState<OptRow[]>([])
  const [cycles,  setCycles]  = useState<CycleRow[]>([])
  const [dormant, setDormant] = useState<CycleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [days,    setDays]    = useState(30)

  // ── 창(window) 집계: 히트맵 · 메뉴 · 옵션 · 이용방법 ──
  useEffect(() => {
    if (!storeId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const since = new Date(Date.now() - days * 86_400_000).toISOString()

      // orders 에 store_id 가 있어 조인 없이 바로 좁혀진다
      const { data } = await supabase
        .from('orders')
        .select(`
          ordered_at, method, delivery_fee,
          order_items ( menu_name, quantity, subtotal,
            order_item_options ( option_name, quantity ) )
        `)
        .eq('store_id', storeId)
        .neq('status', '취소')
        .eq('is_deleted', false)
        .gte('ordered_at', since)

      type O = {
        ordered_at: string; method: string; delivery_fee: number | null
        order_items: {
          menu_name: string; quantity: number | null; subtotal: number | null
          order_item_options: { option_name: string | null; quantity: number | null }[] | null
        }[] | null
      }

      const built: WindowRow[] = []
      const menuMap = new Map<string, MenuRow>()
      const optMap  = new Map<string, OptRow>()

      for (const o of (data ?? []) as unknown as O[]) {
        const k = toKst(o.ordered_at)
        built.push({ dow: k.dow, hour: k.hour, date: k.date, method: o.method, deliveryFee: o.delivery_fee ?? 0 })

        for (const it of o.order_items ?? []) {
          const m = menuMap.get(it.menu_name) ?? { name: it.menu_name, qty: 0, amount: 0 }
          m.qty    += it.quantity ?? 0
          m.amount += it.subtotal ?? 0
          menuMap.set(it.menu_name, m)

          for (const oo of it.order_item_options ?? []) {
            // "8,900원" 처럼 가격 자체가 이름인 필수 그룹은 제외한다 — 세면 항상 1등이 되어
            // "인기 옵션"이라는 말이 무의미해진다 (실제 데이터에 84건 있었다)
            if (!oo.option_name || /^\d[\d,]*원$/.test(oo.option_name)) continue
            const t = optMap.get(oo.option_name) ?? { name: oo.option_name, qty: 0 }
            t.qty += oo.quantity ?? 1
            optMap.set(oo.option_name, t)
          }
        }
      }

      if (cancelled) return
      setRows(built)
      setMenus([...menuMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 8))
      setOpts([...optMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 8))
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [storeId, days])

  // ── 주기 집계: 창과 무관하게 180일 고정 ──
  useEffect(() => {
    if (!storeId) return
    let cancelled = false

    async function load() {
      const since = new Date(Date.now() - CYCLE_DAYS * 86_400_000).toISOString()

      // 계정을 따로 읽는 이유: 주문이 아예 없는 거래처가 가장 챙겨야 할 곳인데,
      // 주문에서 역으로 만들면 그 계정들이 영원히 안 보인다
      const [accRes, ordRes] = await Promise.all([
        supabase
          .from('accounts')
          .select('account_code, account_name, current_balance')
          .eq('store_id', storeId)
          .eq('is_active', true),
        supabase
          .from('orders')
          .select('account_code, ordered_at')
          .eq('store_id', storeId)
          .neq('status', '취소')
          .eq('is_deleted', false)
          .gte('ordered_at', since),
      ])

      type A = { account_code: string; account_name: string; current_balance: number | null }
      const accounts = (accRes.data ?? []) as A[]

      const times = new Map<string, number[]>()
      for (const o of (ordRes.data ?? []) as { account_code: string; ordered_at: string }[]) {
        const arr = times.get(o.account_code) ?? []
        arr.push(new Date(o.ordered_at).getTime())
        times.set(o.account_code, arr)
      }

      const built: CycleRow[] = accounts.map(a => {
        const ts = (times.get(a.account_code) ?? []).sort((x, y) => x - y)
        let avgGap: number | null = null
        if (ts.length >= 2) {
          let total = 0
          for (let i = 1; i < ts.length; i++) total += ts[i] - ts[i - 1]
          avgGap = total / (ts.length - 1) / 86_400_000
        }
        return {
          account:  a.account_name,
          orders:   ts.length,
          lastDays: ts.length ? Math.floor((Date.now() - ts[ts.length - 1]) / 86_400_000) : null,
          avgGap,
          balance:  a.current_balance ?? 0,
        }
      })

      if (cancelled) return
      setCycles(built.filter(c => c.orders > 0).sort((a, b) => b.orders - a.orders))
      setDormant(built.filter(c => c.orders === 0))
    }

    load()
    return () => { cancelled = true }
  }, [storeId])

  // ── 요일 × 시간대 ──
  // 칸마다 건수와 **그 칸을 만든 날짜들**을 같이 센다.
  // 날짜가 없으면 "토요일 9시가 왜 칠해졌지?"를 확인할 길이 없다 — 히트맵은 기간 전체를
  // 겹쳐 본 그림이라, 특정 날짜 하나와 비교하면 늘 안 맞는 것처럼 보인다.
  const grid = new Map<string, { n: number; dates: string[] }>()
  let maxCell = 0
  for (const r of rows) {
    if (r.hour < HOURS[0] || r.hour > HOURS[HOURS.length - 1]) continue
    const key = `${r.dow}-${r.hour}`
    const cur = grid.get(key) ?? { n: 0, dates: [] }
    cur.n += 1
    if (!cur.dates.includes(r.date)) cur.dates.push(r.date)
    grid.set(key, cur)
    if (cur.n > maxCell) maxCell = cur.n
  }
  const peak = [...grid.entries()].sort((a, b) => b[1].n - a[1].n)[0]
  const peakDow  = peak ? Number(peak[0].split('-')[0]) : null
  const peakHour = peak ? Number(peak[0].split('-')[1]) : null
  const peakCount = peak ? peak[1].n : 0

  // ── 이용방법 ──
  const methodCount = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.method] = (acc[r.method] ?? 0) + 1
    return acc
  }, {})
  const deliveryTotal = rows.reduce((s, r) => s + r.deliveryFee, 0)

  // 평균 주기의 2배 넘게 비었으면 신호. 7일 하한은 주기가 짧은 곳(매일 오는 곳)이
  // 이틀 쉰 것만으로 경고에 뜨는 걸 막는다
  const overdue = cycles.filter(c =>
    c.avgGap != null && c.lastDays != null && c.lastDays > c.avgGap * 2 && c.lastDays >= 7)
  const dormantWithMoney = dormant.filter(d => d.balance > 0)

  return (
    <div className="h-full overflow-y-auto bg-gray-bg px-[30px] py-[24px]">
      <div className="flex items-center justify-between mb-[20px]">
        <div className="text-[18px] font-semibold text-[#1E1E1E]">주문 리포트</div>
        <div className="flex gap-[6px]">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`pressable-tab h-[30px] px-[12px] rounded-[9px] text-[13px] font-normal ${
                days === d ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878]'
              }`}
            >
              최근 {d}일
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-[56px] text-center text-[13px] font-normal text-[#787878]">불러오는 중…</div>
      ) : (
        <>
          {rows.length === 0 ? (
            <div className="bg-[#FCFCFC] rounded-[11px] py-[48px] mb-[30px] text-center">
              <div className="text-[13px] font-normal text-[#787878]">최근 {days}일 주문이 없어요</div>
              <div className="text-[11px] font-normal text-[#ADADAD] mt-[4px]">기간을 늘리면 지난 주문을 볼 수 있어요</div>
            </div>
          ) : (
            <>
              {/* 1. 언제 몰리나 */}
              <Section title="언제 몰리나" hint={`한국 시간 기준 · 최근 ${days}일을 요일·시간대로 겹쳐 본 그림이에요. 칸에 마우스를 올리면 실제 날짜가 나와요`}>
                <div className="bg-[#FCFCFC] rounded-[11px] p-[14px] overflow-x-auto">
                  <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `28px repeat(${HOURS.length}, 26px)` }}>
                    <div />
                    {HOURS.map(h => (
                      <div key={h} className="text-[10px] font-normal text-[#ADADAD] text-center">{h}</div>
                    ))}
                    {DOW.map((d, di) => (
                      <Fragment key={di}>
                        <div className="text-[11px] font-normal text-[#787878] flex items-center">{d}</div>
                        {HOURS.map(h => {
                          const cell = grid.get(`${di}-${h}`)
                          const n = cell?.n ?? 0
                          const ratio = maxCell ? n / maxCell : 0
                          const dates = cell?.dates ?? []
                          return (
                            <div
                              key={h}
                              title={n === 0
                                ? `${d}요일 ${h}시 · 주문 없음`
                                : `${d}요일 ${h}시 · ${n}건 (${dates.slice(0, 6).join(', ')}${dates.length > 6 ? ` 외 ${dates.length - 6}일` : ''})`}
                              className="h-[26px] rounded-[4px]"
                              style={{ backgroundColor: n === 0 ? '#F2F2F2' : `rgba(106,99,94,${0.15 + ratio * 0.85})` }}
                            />
                          )
                        })}
                      </Fragment>
                    ))}
                  </div>
                </div>
                {peak && peakDow != null && peakHour != null && (
                  <Insight>
                    가장 바쁜 때는 <span className="font-medium">{DOW[peakDow]}요일 {peakHour}시</span>예요 ({peakCount}건).
                    {' '}그 시간 30분 전에 준비를 마쳐두면 밀리지 않아요.
                  </Insight>
                )}
              </Section>

              {/* 2. 많이 나간 메뉴 · 옵션 */}
              <div className="flex gap-[20px] mb-[30px]">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-[#2C261F] mb-[2px]">많이 나간 메뉴</div>
                  <div className="text-[11px] font-normal text-[#ADADAD] mb-[10px]">발주량을 정하는 기준</div>
                  <div className="bg-[#FCFCFC] rounded-[11px] p-[13px] flex flex-col gap-[9px]">
                    {menus.map((m, i) => (
                      <div key={m.name} className="flex items-center gap-[10px]">
                        <span className="w-[14px] text-[11px] font-normal text-[#ADADAD]">{i + 1}</span>
                        <span className="flex-1 min-w-0 truncate text-[13px] font-normal text-[#1E1E1E]">{m.name}</span>
                        <span className="text-[12px] font-normal text-[#787878] flex-shrink-0">{m.qty}개</span>
                        <span className="w-[78px] text-right text-[12px] font-normal text-[#1E1E1E]">{won(m.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-[#2C261F] mb-[2px]">많이 고른 옵션</div>
                  <div className="text-[11px] font-normal text-[#ADADAD] mb-[10px]">가격 선택(필수)은 메뉴값이라 제외</div>
                  <div className="bg-[#FCFCFC] rounded-[11px] p-[13px] flex flex-col gap-[9px]">
                    {opts.length === 0 ? (
                      <div className="py-[14px] text-center text-[12px] font-normal text-[#ADADAD]">선택된 옵션이 없어요</div>
                    ) : opts.map((o, i) => (
                      <div key={o.name} className="flex items-center gap-[10px]">
                        <span className="w-[14px] text-[11px] font-normal text-[#ADADAD]">{i + 1}</span>
                        <span className="flex-1 min-w-0 truncate text-[13px] font-normal text-[#1E1E1E]">{o.name}</span>
                        <span className="text-[12px] font-normal text-[#787878] flex-shrink-0">{o.qty}회</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 3. 이용방법 */}
              <Section title="이용방법" hint="배달이 늘면 배달료가 매출에 섞입니다">
                <div className="flex gap-[10px]">
                  {/* DB 값('내점')으로 세고 표시만 앱 공통 라벨('매장 식사')로 — 다른 화면과
                      용어가 어긋나면 같은 숫자를 다른 이름으로 두 번 설명하게 된다 */}
                  {(['포장', '내점', '배달'] as const).map(m => {
                    const n = methodCount[m] ?? 0
                    const pct = rows.length ? Math.round((n / rows.length) * 100) : 0
                    return (
                      <div key={m} className="flex-1 bg-[#F2F2F2] rounded-[10px] px-[14px] py-[13px]">
                        <div className="text-[12px] font-medium text-[#2C261F] mb-[6px]">{DB_METHOD_MAP[m] ?? m}</div>
                        <div className="text-[20px] font-medium text-[#2C261F]">{pct}%</div>
                        <div className="text-[11px] font-normal text-[#787878] mt-[3px]">{n}건</div>
                      </div>
                    )
                  })}
                  <div className="flex-1 bg-[#F2F2F2] rounded-[10px] px-[14px] py-[13px]">
                    <div className="text-[12px] font-medium text-[#2C261F] mb-[6px]">배달료 합계</div>
                    <div className="text-[20px] font-medium text-[#2C261F]">{won(deliveryTotal)}</div>
                    <div className="text-[11px] font-normal text-[#787878] mt-[3px]">주문액에 포함된 금액</div>
                  </div>
                </div>
              </Section>
            </>
          )}

          {/* 4. 거래처별 주문 주기 — 창과 무관하게 180일 */}
          <Section
            title="거래처별 주문 주기"
            hint={`최근 ${CYCLE_DAYS}일 기준 · 기간 선택과 무관합니다. 뜸해진 곳이 기간 밖으로 사라지면 안 되니까요`}
          >
            {cycles.length === 0 ? (
              <div className="bg-[#FCFCFC] rounded-[11px] py-[40px] text-center text-[13px] font-normal text-[#ADADAD]">
                주문 기록이 있는 거래처가 없어요
              </div>
            ) : (
              <div className="rounded-[11px] overflow-hidden">
                <div className="flex items-center bg-[#D7D2CE] border-b border-[#C1B7AA] px-[15px] h-[36px] text-[12px] font-normal text-[#6A635E]">
                  <span className="flex-1">거래처</span>
                  <span className="w-[70px] text-right">주문</span>
                  <span className="w-[90px] text-right">평균 간격</span>
                  <span className="w-[95px] text-right">마지막 주문</span>
                  <span className="w-[105px] text-right">현재 잔액</span>
                </div>
                {cycles.slice(0, 12).map((c, i, arr) => {
                  const late = c.avgGap != null && c.lastDays != null
                            && c.lastDays > c.avgGap * 2 && c.lastDays >= 7
                  return (
                    <div
                      key={c.account}
                      className={`flex items-center bg-[#FCFCFC] px-[15px] h-[40px] text-[13px] font-normal ${
                        i === arr.length - 1 ? '' : 'border-b border-[#E5E5E5]'
                      }`}
                    >
                      <span className="flex-1 truncate text-[#1E1E1E]">{c.account}</span>
                      <span className="w-[70px] text-right text-[#787878]">{c.orders}건</span>
                      <span className="w-[90px] text-right text-[#787878]">
                        {c.avgGap == null ? '—' : `${c.avgGap.toFixed(1)}일`}
                      </span>
                      <span className={`w-[95px] text-right ${late ? 'text-danger font-medium' : 'text-[#787878]'}`}>
                        {c.lastDays == null ? '—' : c.lastDays === 0 ? '오늘' : `${c.lastDays}일 전`}
                      </span>
                      <span className={`w-[105px] text-right ${c.balance < 0 ? 'text-danger' : 'text-[#1E1E1E]'}`}>
                        {won(c.balance)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {overdue.length > 0 && (
              <Insight>
                <span className="font-medium">{overdue.slice(0, 3).map(o => o.account).join(', ')}</span>
                {overdue.length > 3 ? ` 외 ${overdue.length - 3}곳` : ''}은 평소 주기보다 오래 비었어요.
                {' '}고객 · 문자 보내기에서 한 번에 연락할 수 있어요.
              </Insight>
            )}

            {dormantWithMoney.length > 0 && (
              <Insight>
                <span className="font-medium">{dormantWithMoney.length}곳</span>은 {CYCLE_DAYS}일 동안 주문이 없는데 잔액이 남아 있어요
                {' '}(합계 {won(dormantWithMoney.reduce((s, d) => s + d.balance, 0))}).
              </Insight>
            )}
          </Section>
        </>
      )}
    </div>
  )
}
