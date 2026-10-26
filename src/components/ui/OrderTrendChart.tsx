import { useState, useRef, useLayoutEffect } from 'react'
import { rootZoom } from '../../lib/figma-scale'
import { won } from '../../lib/ipc'
import { countAxisTicks, type TrendBucket } from '../../lib/order-trend'

// 주문 추이 막대 — 주문 리포트.
//
// 증권앱 차트에서 **세 가지만** 가져왔다. 캔들은 안 쓴다 — 캔들은 시가·고가·저가·종가
// 네 값을 담는 장치인데 우리 구간엔 값이 하나(건수)뿐이라 넣을 게 없다.
//
//  1) **Y축 눈금 + 격자선** — 전엔 호버해야만 높이를 숫자로 읽을 수 있었다.
//     최대가 7건이든 70건이든 그림이 똑같아서, 보려면 사람이 호버를 반복해야 했다.
//     축은 **스크롤해도 왼쪽에 남는다**(증권 차트가 그렇게 하는 이유와 같다).
//  2) **7일 이동평균선 — 일별에서만.** 일별은 요일 노이즈(주말 0건)가 지배해서
//     생바만으론 추세가 안 보인다. 월별 다섯 칸에 평균선을 얹는 건 의미가 없다.
//
// 줌·팬·크로스헤어는 **일부러 뺐다.** 그걸 쓰려면 차트 라이브러리(40~50KB)가 필요한데,
// 피크타임에 보는 사장님 화면이 공부해야 하는 화면이 되는 쪽이 손해가 크다.
//
// 거래량 자리(주문액 띠)도 뺐다. 한 영역에 그래프가 둘이면 어느 쪽을 봐야 하는지부터
// 판단해야 해서 그림이 무거워진다. 주문액은 말풍선과 오른쪽 요약이 이미 말해준다.

const BAR_FULL    = '#6A635E'
const BAR_PARTIAL = '#C1B7AA'
const MA_LINE     = '#FF8418'
const GRID        = '#EFEDEA'

const GAP        = 4
/** 왼쪽 축 칸 — 스크롤돼도 남는 영역 */
const AXIS_W     = 34
/** X축 라벨 줄 높이 */
const XLABEL_H   = 18
/** 라벨이 서로 붙지 않는 최소 간격(px) — 이보다 촘촘하면 건너뛰며 찍는다 */
const LABEL_MIN_PX = 52
/** 이동평균 구간(일) */
const MA_WINDOW  = 7

/** 뒤쪽 w칸 평균. 앞부분은 모자란 만큼만 평균 낸다 — 선이 중간부터 시작하는 것보다 낫다 */
function movingAverage(values: number[], w: number): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - w + 1), i + 1)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

export default function OrderTrendChart({
  buckets, barWidth = 12, height = 132, showAverage = false,
}: {
  buckets:   TrendBucket[]
  /** 막대 굵기. 구간이 성길수록(월별) 굵게 줘서 허전하지 않게 한다 */
  barWidth?: number
  height?:   number
  /** 7일 이동평균선 — 일별에서만 켠다 */
  showAverage?: boolean
}) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 단위를 바꾸거나 데이터가 들어오면 오른쪽 끝(최근)으로 보낸다.
  // useLayoutEffect 인 이유: 페인트 전에 끝내야 왼쪽에서 오른쪽으로 훅 미끄러지는 게 안 보인다.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [buckets])

  const step      = barWidth + GAP
  const plotW     = Math.max(0, buckets.length * step - GAP)
  const labelEvery = Math.max(1, Math.ceil(LABEL_MIN_PX / step))

  // 눈금 셋이면 충분하다 — 0 · 절반 · 최대. 더 그으면 격자가 막대보다 눈에 띈다.
  // 눈금이 정수로 떨어지는 규칙은 lib/order-trend.ts 가 들고 있다(테스트도 거기).
  const ticks    = countAxisTicks(Math.max(...buckets.map(b => b.count), 0))
  const maxCount = ticks[2]
  const ma    = showAverage ? movingAverage(buckets.map(b => b.count), MA_WINDOW) : null
  const yOf   = (count: number) => height - (count / maxCount) * (height - 10)

  const onEnter = (i: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setHover({ i, x: r.left + r.width / 2, y: r.top })
  }

  return (
    <div className="relative">
      <div className="flex">
        {/* ── 왼쪽 축 — 스크롤해도 남는다 ── */}
        <div className="relative flex-shrink-0" style={{ width: AXIS_W, height: height + XLABEL_H }}>
          {ticks.map(t => (
            <div
              key={t}
              className="absolute right-[6px] text-[10px] font-normal text-[#ADADAD] tabular-nums -translate-y-1/2"
              style={{ top: yOf(t) }}
            >
              {t}
            </div>
          ))}
        </div>

        <div className="relative flex-1 min-w-0">
          {/* ── 격자선 — 막대 영역 전체 폭에 깐다(스크롤과 무관하게 고정) ── */}
          <div className="absolute left-0 right-0 top-0 pointer-events-none" style={{ height }}>
            {ticks.map(t => (
              <div key={t} className="absolute left-0 right-0" style={{ top: yOf(t), borderTop: `1px solid ${GRID}` }} />
            ))}
          </div>

          {/* ── 스크롤 영역: 막대 · 평균선 · X라벨 · 금액 띠가 같이 움직인다 ──
              w-max + mx-auto — 칸이 적으면 가운데로 모이고, 넘치면 좌우 스크롤이 된다.
              justify-center 로 가운데 두면 넘칠 때 왼쪽 끝에 손이 닿지 않는다. */}
          <div ref={scrollRef} className="overflow-x-auto">
            <div className="w-max mx-auto">
              <div className="relative flex items-end" style={{ height, gap: GAP }}>
                {buckets.map((b, i) => (
                  <div
                    key={b.key}
                    className="h-full flex flex-col justify-end cursor-default"
                    style={{ width: barWidth }}
                    onMouseEnter={onEnter(i)}
                    onMouseLeave={() => setHover(null)}
                  >
                    {/* 0건이어도 1px 은 남긴다 — 칸이 통째로 비면 '없음'인지 '안 그려짐'인지 모른다 */}
                    <div
                      className="bar-rise w-full rounded-t-[3px] transition-opacity"
                      style={{
                        height: Math.max(1, Math.round((b.count / maxCount) * (height - 10))),
                        background: b.partial ? BAR_PARTIAL : BAR_FULL,
                        opacity: hover && hover.i !== i ? 0.4 : 1,
                        // 왼쪽부터 차례로 — 한꺼번에 솟으면 벽이 올라오는 것처럼 보인다.
                        // 칸이 많으면(일별 117칸) 전체가 0.3초를 넘지 않게 묶는다.
                        animationDelay: `${Math.min(i * 12, 300)}ms`,
                      }}
                    />
                  </div>
                ))}

                {/* 이동평균선 — 막대 위에 얹는다. 마우스를 가로채면 호버가 죽으므로 pointer-events 없음 */}
                {ma && (
                  <svg className="absolute left-0 top-0 pointer-events-none" width={plotW} height={height}>
                    <polyline
                      fill="none" stroke={MA_LINE} strokeWidth={1.5}
                      strokeLinejoin="round" strokeLinecap="round"
                      points={ma.map((v, i) => `${i * step + barWidth / 2},${yOf(v)}`).join(' ')}
                    />
                  </svg>
                )}
              </div>

              {/* ── X축 라벨 ── */}
              <div className="flex items-center" style={{ gap: GAP, height: XLABEL_H }}>
                {buckets.map((b, i) => {
                  const show = i === buckets.length - 1 || (buckets.length - 1 - i) % labelEvery === 0
                  return (
                    <div
                      key={b.key}
                      className="text-center text-[10px] font-normal text-[#ADADAD] whitespace-nowrap"
                      style={{ width: barWidth }}
                    >
                      {/* 라벨은 칸보다 넓다 — 넘쳐도 자르지 않고 가운데로 흘린다 */}
                      {show && <span className="inline-block -mx-[14px]">{b.label}</span>}
                    </div>
                  )
                })}
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* 평균선을 쓸 때만 범례 한 줄 — 선이 뭔지 모르면 그냥 방해물이다 */}
      {ma && (
        <div className="flex items-center gap-[5px] mt-[8px]" style={{ paddingLeft: AXIS_W }}>
          <span className="inline-block w-[12px] h-[2px] rounded-full" style={{ background: MA_LINE }} />
          <span className="text-[10px] font-normal text-[#ADADAD]">{MA_WINDOW}일 평균</span>
        </div>
      )}

      {/* 말풍선 — 히트맵·고객 화면 '추이' 와 같은 모양 */}
      {hover && (() => {
        const b = buckets[hover.i]
        return (
          <div
            className="fixed z-[75] pointer-events-none bg-[#FCFCFC] rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] px-[10px] py-[8px] -translate-x-1/2"
            style={{ left: hover.x / rootZoom(), bottom: (window.innerHeight - hover.y) / rootZoom() + 6 }}
          >
            {/* 제목은 **정확한 기간**이다. '10/5' 만 적으면 그게 한 주인지 두 주인지
                탭을 기억해야 알 수 있다 — 말풍선이 그걸 대신 말해준다. */}
            <div className="text-[12px] font-semibold text-ink text-center leading-[1.3] whitespace-nowrap">
              {b.range}
            </div>
            <div className="text-[11px] font-normal text-[#787878] text-center mt-[2px] whitespace-nowrap">
              {b.count === 0 ? '주문 없음' : <>{b.count}건 · {won(b.amount)}</>}
              {b.partial && <span className="text-[#ADADAD]"> · 진행 중</span>}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
