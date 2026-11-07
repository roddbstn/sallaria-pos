import InfoTip from './InfoTip'

// 월별 추이 막대 두 가지. 고객 현황과 주문 리포트가 같이 쓴다.
//
// ── 숫자를 막대 위에 상시로 적지 않는 이유 ────────────────────────────────
// 한 화면에 차트가 서넛이면 숫자가 스물 몇 개가 된다. 추이(올랐나 내렸나)를
// 보려고 온 눈을 숫자가 먼저 붙잡는다. 대신 막대에 올리면 말풍선으로
// 근거까지 같이 보여준다 — '8월 이탈 30명 · 7월 주문자 61명 중'.

const BAR_H = 72

/** 막대에 올렸을 때만 뜨는 말풍선 */
function Tip({ text }: { text: string }) {
  return (
    // pointer-events-none — 막대 사이가 8px 밖에 안 돼서, 말풍선이 마우스를 받으면
    // 옆 막대로 넘어갈 때 깜빡인다
    <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-[6px] z-20
                    opacity-0 group-hover:opacity-100 transition-opacity duration-100">
      <div className="rounded-[7px] bg-[#2C261F] px-[8px] py-[5px] text-[11px] text-white whitespace-nowrap
                      shadow-[0_2px_8px_rgba(0,0,0,0.2)]">
        {text}
      </div>
    </div>
  )
}

function Head({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-[5px] mb-[18px]">
      <span className="text-[13px] font-normal text-[#6A635E]">{title}</span>
      {/* ⚠️ 브라우저 기본 title 속성을 쓰면 안 된다.
          똑같이 생긴 'i' 인데 **1~2초 기다려야** OS 툴팁이 뜨고 모양도 우리 것과
          다르다. 바로 옆 지표 칸의 i 는 InfoTip 이라 즉시 뜨는데 여기만 안 떠서
          "왜 이건 말풍선이 안 나오냐"가 됐다. 같은 모양이면 같게 동작해야 한다. */}
      {hint && <InfoTip text={hint} label={`${title} 설명`} />}
    </div>
  )
}

function Axis({ labels }: { labels: string[] }) {
  return (
    <>
      <div className="h-px bg-canvas-line mt-[1px]" />
      <div className="flex gap-[8px] mt-[6px]">
        {labels.map(l => (
          <span key={l} className="flex-1 text-center text-[10px] text-[#6A635E]">{l}</span>
        ))}
      </div>
    </>
  )
}

/**
 * 한 줄짜리 막대 — 개수 또는 비율.
 *
 * 축: 'count' 는 상한이 없으니 그 기간의 최대값에 맞춘다.
 *     'rate' 는 100 을 천장으로 두되 **넘으면 넘은 만큼 늘린다.**
 *       주문율은 100%를 넘을 수 있다 — 분모는 등록된 사람 수인데 주문자명은 자유
 *       입력이라 등록 안 한 이름으로도 주문이 들어온다(침산점 6월 8명/6명 = 133%).
 *       100 에서 잘라 버리면 그 달만 꽉 찬 막대가 돼 "무슨 일이 있었다"가 지워진다.
 *       천장이 100 을 넘을 때만 100% 자리에 점선을 그어 기준을 남긴다.
 */
export function TrendBars({ title, hint, data, color, kind }: {
  title: string
  hint?: string
  /** value 가 null 이면 잴 수 없었던 달(그 달 주문자 0명) — 회색 바닥선만 */
  data:  { label: string; value: number | null; tip: string }[]
  color: string
  kind:  'count' | 'rate'
}) {
  const peak = Math.max(0, ...data.map(d => d.value ?? 0))
  const axis = kind === 'count' ? Math.max(1, peak) : Math.max(100, peak)

  return (
    <div>
      <Head title={title} hint={hint} />
      <div className="relative flex items-end gap-[8px]" style={{ height: BAR_H }}>
        {kind === 'rate' && axis > 100 && (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-[#D9D9D9] pointer-events-none"
            style={{ bottom: (100 / axis) * BAR_H }}
          >
            <span className="absolute right-0 -top-[12px] text-[9px] text-[#ADADAD]">100%</span>
          </div>
        )}
        {data.map(d => (
          <div key={d.label} className="flex-1 flex flex-col items-center justify-end h-full group relative">
            <Tip text={d.tip} />
            <div
              className="w-full rounded-t-[3px] transition-opacity group-hover:opacity-80"
              style={{
                height: !d.value ? 2 : Math.max(3, (d.value / axis) * BAR_H),
                backgroundColor: !d.value ? '#E5E5E5' : color,
              }}
            />
          </div>
        ))}
      </div>
      <Axis labels={data.map(d => d.label)} />
    </div>
  )
}

export interface FlowBar {
  label:       string
  newcomers:   number
  retained:    number
  resurrected: number
  churned:     number
  tip:         string
}

/**
 * 손님 드나듦 — 신규·유지·복귀를 **위로 쌓고**, 이탈을 축 아래로 내린다.
 *
 * 왜 이 모양인가: 이탈률 하나로는 "유입이 이탈을 메우고 있나"가 안 보인다.
 * 위아래로 갈라 놓으면 그 균형이 막대 길이 차이로 바로 읽힌다 —
 * 침산점 8월은 위 44 아래 30 이라 간신히 메웠고, 7월은 위 61 아래 3 이었다.
 *
 * 위아래가 **같은 눈금**을 쓴다. 각자 최대값에 맞추면 이탈 3명짜리 막대와
 * 30명짜리 막대가 비슷해 보여서, 비교하라고 만든 그림이 비교를 막는다.
 */
export function FlowBars({ title, hint, data }: {
  title: string
  hint?: string
  data:  FlowBar[]
}) {
  const up   = Math.max(...data.map(d => d.newcomers + d.retained + d.resurrected), 0)
  const down = Math.max(...data.map(d => d.churned), 0)
  const unit = Math.max(1, up, down)          // 위아래 공통 눈금
  const UP_H = 64, DOWN_H = 34                 // 아래는 덜 쓰이니 얕게
  const px   = (n: number, h: number) => (n / unit) * h

  const SEG = [
    { key: 'newcomers'   as const, color: '#6A635E', name: '신규' },
    { key: 'retained'    as const, color: '#A39A90', name: '유지' },
    { key: 'resurrected' as const, color: '#D7CEC4', name: '복귀' },
  ]

  return (
    <div>
      <Head title={title} hint={hint} />

      {/* 범례 — 네 칸이라 색만으로는 못 외운다 */}
      <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[3px] mb-[8px]">
        {[...SEG, { key: 'churned' as const, color: '#E8808A', name: '이탈' }].map(s => (
          <span key={s.key} className="flex items-center gap-[4px] text-[10px] text-[#787878]">
            <span className="w-[7px] h-[7px] rounded-[2px]" style={{ backgroundColor: s.color }} />
            {s.name}
          </span>
        ))}
      </div>

      <div className="flex gap-[8px]">
        {data.map(d => (
          <div key={d.label} className="flex-1 group relative">
            {/* 위 — 들어온 사람 */}
            <div className="relative flex flex-col justify-end" style={{ height: UP_H }}>
              <Tip text={d.tip} />
              {/* 쌓는 순서는 아래부터 신규 → 유지 → 복귀.
                  신규를 바닥에 두는 건 매달 바닥이 같은 뜻이어야 눈이 따라가기 때문이다. */}
              <div className="flex flex-col-reverse">
                {SEG.map(s => d[s.key] > 0 && (
                  <div key={s.key} style={{ height: px(d[s.key], UP_H), backgroundColor: s.color }} />
                ))}
              </div>
            </div>
            {/* 0 선 */}
            <div className="h-px bg-[#C1B7AA]" />
            {/* 아래 — 빠진 사람 */}
            <div style={{ height: DOWN_H }}>
              {d.churned > 0 && (
                <div style={{ height: px(d.churned, UP_H), backgroundColor: '#E8808A' }} />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-[8px] mt-[2px]">
        {data.map(d => (
          <span key={d.label} className="flex-1 text-center text-[10px] text-[#6A635E]">{d.label}</span>
        ))}
      </div>
    </div>
  )
}
