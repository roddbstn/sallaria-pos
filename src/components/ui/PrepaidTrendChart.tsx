import { useState } from 'react'
import { won } from '../../lib/ipc'

// 월별 충전 · 주문 · 월말 잔액 막대 — 계정 상세 모달과 월별 잔액 모달이 같이 쓴다.
//
// 두 화면이 같은 것을 다른 모양으로 그리고 있었다. 하나로 합쳐서, 색과 읽는 법이
// 화면을 옮겨도 같게 만든다.
//
// 숫자는 막대 아래에 적지 않는다. 여섯 달이면 여섯 줄, 열두 달이면 열두 줄이 깔려서
// 정작 막대보다 글자가 먼저 보였다. 대신 **마우스를 올린 달만** 말풍선으로 펼친다 —
// 보고 싶은 건 언제나 한 달씩이다.
//
// ⚠️ 증감 색: 한국 회계 관습대로 **+는 빨강, −는 파랑**이다. 웹 기본(초록/빨강)과 반대라
//    헷갈리기 쉬우니 바꾸지 말 것.

export interface TrendMonth {
  key:     string            // 'YYYY-MM'
  deposit: number
  order:   number
  balance: number
  /** 그 달에 실제 거래가 있었는지 — 없으면 잔액은 직전 달에서 이어진 값이다 */
  active:  boolean
}

const BARS = [
  { key: 'deposit' as const, label: '충전',      color: '#6A635E' },
  { key: 'order'   as const, label: '주문',      color: '#8C8379' },
  { key: 'balance' as const, label: '월말 잔액', color: '#C1B7AA' },
]

export default function PrepaidTrendChart({ months, height = 140, barWidth = 9 }: {
  months:    TrendMonth[]
  height?:   number
  barWidth?: number
}) {
  const [hover, setHover] = useState<string | null>(null)

  const max = Math.max(1, ...months.flatMap(m => [m.deposit, m.order, m.balance]))
  const barH = (v: number) => v <= 0 ? 0 : Math.max(3, (v / max) * height)

  return (
    <div>
      {/* 범례 — 가운데 위. 차트를 읽기 전에 색이 뭘 뜻하는지 먼저 보여야 한다 */}
      <div className="flex items-center justify-center gap-[16px] mb-[14px]">
        {BARS.map(b => (
          <span key={b.key} className="flex items-center gap-[5px] text-[11px] font-normal text-[#787878]">
            <i className="w-[6px] h-[11px] rounded-full" style={{ backgroundColor: b.color }} />
            {b.label}
          </span>
        ))}
      </div>

      <div className="relative">
        <div className="flex items-end gap-[6px]" style={{ height }}>
          {months.map(m => {
            const on = hover === m.key
            return (
              <div
                key={m.key}
                onMouseEnter={() => setHover(m.key)}
                onMouseLeave={() => setHover(h => (h === m.key ? null : h))}
                className="flex-1 min-w-0 h-full flex items-end justify-center gap-[4px] rounded-[6px] transition-colors"
                style={{ backgroundColor: on ? '#F2F2F2' : 'transparent' }}
              >
                {BARS.map(b => (
                  <div
                    key={b.key}
                    className="flex-shrink-0 rounded-full"
                    style={{ width: barWidth, height: barH(m[b.key]), backgroundColor: b.color }}
                  />
                ))}
              </div>
            )
          })}
        </div>

        {/* 말풍선 — 올린 달 위에 띄운다 */}
        {hover && (() => {
          const i = months.findIndex(m => m.key === hover)
          const m = months[i]
          if (!m) return null
          const net = m.deposit - m.order
          // 가장자리 달이면 말풍선이 잘리므로 안쪽으로 당긴다
          const pct = ((i + 0.5) / months.length) * 100
          const shift = pct < 22 ? '0%' : pct > 78 ? '-100%' : '-50%'
          return (
            <div
              className="absolute z-20 pointer-events-none"
              style={{ left: `${pct}%`, bottom: height + 10, transform: `translateX(${shift})` }}
            >
              <div className="bg-[#2C261F] rounded-[9px] px-[13px] py-[10px] shadow-[0px_2px_10px_rgba(0,0,0,0.2)] whitespace-nowrap">
                <div className="text-[11px] font-medium text-[#FCFCFC] mb-[7px]">
                  {Number(m.key.slice(5, 7))}월
                  {!m.active && <span className="text-[#ADADAD] font-normal"> · 거래 없음</span>}
                </div>
                {BARS.map(b => (
                  <div key={b.key} className="flex items-center gap-[8px] text-[11px] leading-[17px]">
                    <i className="w-[5px] h-[9px] rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
                    <span className="text-[#ADADAD] w-[48px]">{b.label}</span>
                    <span className="text-[#FCFCFC] tabular-nums ml-auto">{won(m[b.key])}</span>
                  </div>
                ))}
                <div className="border-t border-[#6A635E] mt-[7px] pt-[7px] text-[11px] leading-[17px] tabular-nums">
                  <span className="text-[#ADADAD]">충전 − 주문 = </span>
                  {/* 한국 회계 관습: 플러스 빨강, 마이너스 파랑 */}
                  <span className="font-medium" style={{ color: net >= 0 ? '#FF676F' : '#6AA8FF' }}>
                    {net >= 0 ? '+' : '−'}{Math.abs(net).toLocaleString('ko-KR')}원
                  </span>
                </div>
              </div>
            </div>
          )
        })()}
      </div>

      {/* 월 이름만 — 숫자는 말풍선으로 */}
      <div className="flex border-t border-[#E5E5E5] pt-[8px] mt-[6px]">
        {months.map(m => (
          <div key={m.key} className="flex-1 min-w-0 text-center">
            <div className={`text-[11px] font-normal whitespace-nowrap ${
              hover === m.key ? 'text-[#1E1E1E] font-medium' : m.active ? 'text-[#787878]' : 'text-[#D7D7D7]'
            }`}>
              {Number(m.key.slice(5, 7))}월
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
