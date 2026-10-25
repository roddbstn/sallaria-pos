import { useState } from 'react'
import { won } from '../../lib/ipc'
import { ledgerMonthKey } from '../../lib/prepaid-ledger'
import { signColor } from '../../lib/sign-color'

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
  /**
   * 그 달의 수기 조정 합계(구두주문 차감 등). 0이면 안 보여준다.
   *
   * 없으면 안 되는 이유: 월말 잔액은 `충전 − 주문 + 조정` 누적인데, 말풍선에
   * 조정을 안 적으면 "6월 충전 X, 주문 Y 인데 월말이 X−Y 가 아니네?" 가 된다.
   * 실제로 그 질문을 받았다 — 침산점 6월의 −69,100(6/30 구두주문 3건 수기 차감)이
   * 안 보였기 때문이다.
   */
  adjust?: number
}

const BARS = [
  { key: 'deposit' as const, label: '충전',      color: '#6A635E' },
  { key: 'order'   as const, label: '주문',      color: '#8C8379' },
  { key: 'balance' as const, label: '월말 잔액', color: '#C1B7AA' },
]

/**
 * 잔액 막대의 이름 — 이번 달만 '현재 잔액'.
 *
 * 아직 안 끝난 달에 '월말 잔액'이라고 적으면 거짓말이다. 10월 23일에 보는 10월 값은
 * 10월 31일의 잔액이 아니라 **지금 이 순간의 잔액**이다. 달이 바뀌면(11/1) 그 10월 값은
 * 더 이상 변하지 않으므로 그때부터 '월말 잔액'이 맞는 말이 된다.
 *
 * 기준 월은 KST — 막대의 key 도 ledgerMonthKey(KST)로 만들어지므로 같은 시간대를 써야
 * 자정 전후로 한 달이 어긋나지 않는다.
 */
function balanceLabel(monthKey: string): string {
  return monthKey === ledgerMonthKey(new Date().toISOString()) ? '현재 잔액' : '월말 잔액'
}

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
      {/* 범례 — 가운데 위. 차트를 읽기 전에 색이 뭘 뜻하는지 먼저 보여야 한다.
          잔액은 그냥 '잔액' 이다 — 지난 달들은 월말 값이고 이번 달은 지금 값이라,
          범례 한 줄로는 둘 다 맞는 말이 '잔액' 뿐이다. 정확한 이름은 말풍선이 댄다. */}
      <div className="flex items-center justify-center gap-[16px] mb-[14px]">
        {BARS.map(b => (
          <span key={b.key} className="flex items-center gap-[5px] text-[11px] font-normal text-[#787878]">
            <i className="w-[6px] h-[11px] rounded-full" style={{ backgroundColor: b.color }} />
            {b.key === 'balance' ? '잔액' : b.label}
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
          // 조정까지 더해야 월말 잔액 변화와 맞는다
          const net = m.deposit - m.order + (m.adjust ?? 0)
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
                    {/* 이번 달이면 '현재 잔액' — 아직 안 끝난 달을 월말이라 부르지 않는다 */}
                    <span className="text-[#ADADAD] w-[48px]">
                      {b.key === 'balance' ? balanceLabel(m.key) : b.label}
                    </span>
                    <span className="text-[#FCFCFC] tabular-nums ml-auto">{won(m[b.key])}</span>
                  </div>
                ))}
                {/* 수기 조정이 있는 달만 한 줄 더 — 없는 달에 0원을 적으면 읽을 게 늘기만 한다 */}
                {!!m.adjust && (
                  <div className="flex items-center gap-[8px] text-[11px] leading-[17px]">
                    <i className="w-[5px] h-[9px] rounded-full flex-shrink-0 bg-[#8C8379] opacity-40" />
                    <span className="text-[#ADADAD] w-[48px]">수기 조정</span>
                    <span className="text-[#FCFCFC] tabular-nums ml-auto">
                      {m.adjust > 0 ? '+' : '−'}{Math.abs(m.adjust).toLocaleString('ko-KR')}원
                    </span>
                  </div>
                )}
                <div className="border-t border-[#6A635E] mt-[7px] pt-[7px] text-[11px] leading-[17px] tabular-nums">
                  {/* 조정이 있으면 식에도 같이 적는다 — 말풍선 안에서 월말 잔액이 계산되게 */}
                  <span className="text-[#ADADAD]">충전 − 주문{m.adjust ? ' + 조정' : ''} = </span>
                  <span className="font-medium" style={{ color: signColor(net) }}>
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
