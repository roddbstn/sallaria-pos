import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { won } from '../../lib/ipc'

// 매장 정보 > 배달 정보 — 거리에 따른 배달팁 설정.
//
// ── 어디에 저장되나 ────────────────────────────────────────────────────────
// stores 의 네 컬럼이다(이미 있었다. 0068 에서 계산 함수까지 만들어 뒀고 화면만 없었다):
//     delivery_tip_base_distance_m   기본 배달거리 (m)
//     delivery_tip_base_fee          기본 배달팁 (원)
//     delivery_tip_tier_distance_m   할증 단위 거리 (m)
//     delivery_tip_tier_fee          단위당 할증 (원)
//
// 계산은 DB 가 한다 — calculate_delivery_fee(). 손님 앱이 주문할 때 부르는 그 함수다.
// 그래서 여기서 미리보기를 만들 때도 **같은 규칙**을 써야 한다(아래 estimate):
//   기본거리 이내면 기본팁, 넘으면 초과분을 단위거리로 **올림**해서 단위당 할증을 더한다.
//   올림이 중요하다 — 1,050m 초과는 100m 단위에서 11칸이 아니라 11칸이다(ceil).
//
// ── 왜 미리보기를 붙였나 ───────────────────────────────────────────────────
// 네 숫자만 보여주면 점주는 "그래서 2km 손님은 얼마를 내지?"를 머릿속으로 계산해야 한다.
// 실제로 옛 MVP 에서 그 질문이 반복됐다. 거리별 금액을 바로 보여주면 숫자를 고치는
// 순간 결과가 같이 움직여서, 설정값이 맞는지 눈으로 확인된다.

interface Tip {
  baseDistanceM: number
  baseFee:       number
  tierDistanceM: number
  tierFee:       number
}

const DEFAULTS: Tip = { baseDistanceM: 1500, baseFee: 4000, tierDistanceM: 100, tierFee: 100 }

/** 미리보기용 거리 — 기본거리 안쪽 하나, 바깥 셋 */
const PREVIEW_M = [500, 1000, 2000, 3000, 5000]

/**
 * 거리 → 배달팁. **DB 의 calculate_delivery_fee 와 같은 규칙이어야 한다.**
 * 다르면 설정 화면이 보여준 금액과 손님이 실제로 낸 금액이 어긋난다.
 */
export function estimate(distanceM: number, t: Tip): number {
  if (distanceM <= t.baseDistanceM) return t.baseFee
  if (t.tierDistanceM <= 0) return t.baseFee
  const tiers = Math.ceil((distanceM - t.baseDistanceM) / t.tierDistanceM)
  return t.baseFee + tiers * t.tierFee
}

/** m → 사람이 읽는 거리 */
function distanceLabel(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)}km` : `${m}m`
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[16px] font-medium leading-[19px] text-[#414141] mb-[14px]">
      {children}
    </div>
  )
}

/** 숫자 입력 한 칸 — 뒤에 단위를 붙인다 */
function NumField({ value, onChange, unit, step = 1, max }: {
  value: number
  onChange: (n: number) => void
  unit: string
  step?: number
  max?: number
}) {
  return (
    <div className="flex items-center gap-[9px]">
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={0}
        max={max}
        step={step}
        onChange={e => {
          const n = Number(e.target.value)
          // 빈칸이나 음수는 0 으로 본다 — NaN 이 들어가면 미리보기가 통째로 깨진다
          onChange(Number.isFinite(n) && n >= 0 ? n : 0)
        }}
        className="w-[128px] h-[42px] border border-[#D9D9D9] rounded-[9px] px-[14px] text-[14px] text-[#1E1E1E] outline-none focus:border-[#6A635E] tabular-nums"
      />
      <span className="text-[14px] text-[#787878]">{unit}</span>
    </div>
  )
}

export default function DeliveryPanel({ storeId, showToast }: {
  storeId: string | null
  showToast: (msg: string) => void
}) {
  const [tip,     setTip]     = useState<Tip>(DEFAULTS)
  const [saved,   setSaved]   = useState<Tip>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)

  useEffect(() => {
    if (!storeId) return
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('stores')
        .select('delivery_tip_base_distance_m, delivery_tip_base_fee, delivery_tip_tier_distance_m, delivery_tip_tier_fee')
        .eq('id', storeId)
        .maybeSingle()
      if (cancelled) return
      // 컬럼이 null 일 수 있다(기본값이 걸려 있지만 예전 행은 비어 있을 수 있다)
      const next: Tip = {
        baseDistanceM: data?.delivery_tip_base_distance_m ?? DEFAULTS.baseDistanceM,
        baseFee:       data?.delivery_tip_base_fee        ?? DEFAULTS.baseFee,
        tierDistanceM: data?.delivery_tip_tier_distance_m ?? DEFAULTS.tierDistanceM,
        tierFee:       data?.delivery_tip_tier_fee        ?? DEFAULTS.tierFee,
      }
      setTip(next)
      setSaved(next)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [storeId])

  const dirty = JSON.stringify(tip) !== JSON.stringify(saved)
  // 단위거리가 0이면 나눗셈이 터진다. 저장 자체를 막는다
  const valid = tip.tierDistanceM > 0 && tip.baseDistanceM > 0

  async function save() {
    if (!storeId || !dirty || !valid || saving) return
    setSaving(true)
    const { error } = await supabase.from('stores').update({
      delivery_tip_base_distance_m: tip.baseDistanceM,
      delivery_tip_base_fee:        tip.baseFee,
      delivery_tip_tier_distance_m: tip.tierDistanceM,
      delivery_tip_tier_fee:        tip.tierFee,
    }).eq('id', storeId)
    setSaving(false)
    if (error) { showToast('배달팁 저장에 실패했습니다'); return }
    setSaved(tip)
    showToast('배달팁을 저장했어요')
  }

  if (loading) {
    return <div className="text-[14px] text-[#ADADAD] py-[40px]">불러오는 중…</div>
  }

  return (
    <div>
      <div className="text-[18px] font-semibold leading-[22px] text-[#1E1E1E] mb-[12px]">배달 정보</div>
      <div className="text-[14px] font-normal text-[#787878] mb-[46px] leading-relaxed">
        매장에서 배달지까지의 거리로 배달팁이 자동 계산돼요.<br />
        손님이 주문할 때 이 설정으로 금액이 매겨집니다.
      </div>

      <div className="flex gap-[72px]">
        {/* ── 왼쪽: 설정값 ── */}
        <div className="flex flex-col gap-[34px]">
          <div>
            <FieldLabel>기본 배달거리</FieldLabel>
            <NumField
              value={tip.baseDistanceM} unit="m 까지" step={100}
              onChange={n => setTip({ ...tip, baseDistanceM: n })}
            />
            <div className="text-[13px] text-[#ADADAD] mt-[8px]">
              {distanceLabel(tip.baseDistanceM)} 안쪽은 기본 배달팁만 받아요
            </div>
          </div>

          <div>
            <FieldLabel>기본 배달팁</FieldLabel>
            <NumField
              value={tip.baseFee} unit="원" step={500}
              onChange={n => setTip({ ...tip, baseFee: n })}
            />
          </div>

          <div>
            <FieldLabel>할증 단위</FieldLabel>
            <NumField
              value={tip.tierDistanceM} unit="m 마다" step={100}
              onChange={n => setTip({ ...tip, tierDistanceM: n })}
            />
            {!valid && (
              <div className="text-[13px] text-[#C92A2A] mt-[8px]">
                0보다 큰 값을 넣어주세요
              </div>
            )}
          </div>

          <div>
            <FieldLabel>할증 배달팁</FieldLabel>
            <NumField
              value={tip.tierFee} unit="원씩 추가" step={100}
              onChange={n => setTip({ ...tip, tierFee: n })}
            />
            <div className="text-[13px] text-[#ADADAD] mt-[8px]">
              기본 거리를 넘으면 {distanceLabel(tip.tierDistanceM)}마다 {won(tip.tierFee)}씩 붙어요
            </div>
          </div>

          <div className="flex justify-start pt-[6px]">
            <button
              onClick={save}
              disabled={!dirty || !valid || saving}
              className="h-[42px] px-[28px] rounded-[9px] bg-[#2C261F] text-[#F9F9F9] text-[14px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-default"
            >
              {saving ? '저장 중…' : dirty ? '저장' : '저장됨'}
            </button>
          </div>
        </div>

        {/* ── 오른쪽: 거리별 미리보기 ──
            숫자를 고치면 바로 움직인다. "그래서 2km 손님은 얼마를 내지?"를
            머릿속으로 계산하지 않아도 되게. */}
        <div className="flex-1 min-w-0 max-w-[320px]">
          <FieldLabel>거리별 배달팁</FieldLabel>
          <div className="rounded-[11px] border border-[#E8E4E2] overflow-hidden">
            <div className="flex items-center bg-[#E8E4E2] px-[18px] h-[38px] text-[12px] font-normal text-[#6A635E]">
              <span className="flex-1">배달 거리</span>
              <span className="w-[100px] text-right">배달팁</span>
            </div>
            {PREVIEW_M.map((m, i) => {
              const inBase = m <= tip.baseDistanceM
              return (
                <div
                  key={m}
                  className={`flex items-center px-[18px] h-[42px] bg-[#FCFCFC] ${
                    i > 0 ? 'border-t border-[#F2F2F2]' : ''
                  }`}
                >
                  <span className="flex-1 text-[13px] text-[#1E1E1E] tabular-nums">
                    {distanceLabel(m)}
                    {inBase && (
                      <span className="ml-[7px] text-[11px] text-[#787878]">기본 거리</span>
                    )}
                  </span>
                  <span className="w-[100px] text-right text-[13px] font-medium text-[#1E1E1E] tabular-nums">
                    {valid ? won(estimate(m, tip)) : '—'}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="text-[12px] text-[#ADADAD] mt-[12px] leading-relaxed">
            직선 거리 기준이에요. 실제 도로 거리와는 차이가 있을 수 있어요.
          </div>
        </div>
      </div>
    </div>
  )
}
