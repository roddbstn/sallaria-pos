import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { won } from '../../lib/ipc'

// 매장 정보 > 배달 정보 — 거리에 따른 배달팁 설정.
// 구조는 배민 셀프서비스의 '가게배달 추가 배달팁'을 따른다.
//
// ── 어디에 저장되나 ────────────────────────────────────────────────────────
// stores 의 네 컬럼이다(이미 있었다. 0068 에서 계산 함수까지 만들어 뒀고 화면만 없었다):
//     delivery_tip_base_distance_m   기본 배달거리 (m)
//     delivery_tip_base_fee          기본 배달팁 (원)
//     delivery_tip_tier_distance_m   할증 단위 거리 (m) — 100 고정
//     delivery_tip_tier_fee          단위당 할증 (원)
//
// ── 왜 자유 입력이 아니라 선택지인가 ───────────────────────────────────────
// 기본 배달거리는 1~3km 를 0.5km 단위로 고른다. 전엔 m 단위 숫자칸이었는데,
// 1,437m 같은 값을 넣을 이유가 없고 넣으면 손님에게 설명하기만 어려워진다.
// 할증 단위도 100m 로 고정했다 — 바꿀 일이 없는 값을 입력칸으로 두면
// "여길 뭘로 해야 하지"라는 고민만 만든다.
//
// 계산은 DB 가 한다 — calculate_delivery_fee(). 손님 앱이 주문할 때 부르는 그 함수다.
// 아래 estimate 는 **그 함수와 같은 규칙**이어야 한다(미리보기가 거짓말하면 안 된다).

interface Tip {
  baseDistanceM: number
  baseFee:       number
  tierDistanceM: number
  tierFee:       number
}

/** 할증 단위는 100m 고정 */
const TIER_DISTANCE_M = 100

/** 기본 배달거리 선택지 — 1km ~ 3km, 0.5km 단위 */
const BASE_DISTANCES = [1000, 1500, 2000, 2500, 3000]

/** 할증 배달팁 허용 범위 */
const TIER_FEE_MIN = 100
const TIER_FEE_MAX = 300

const DEFAULTS: Tip = {
  baseDistanceM: 1500, baseFee: 4000,
  tierDistanceM: TIER_DISTANCE_M, tierFee: 100,
}

/** 미리보기용 거리 */
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
    <div className="text-[16px] font-medium leading-[19px] text-[#414141]">{children}</div>
  )
}

function Hint({ children, tone = 'muted' }: {
  children: React.ReactNode
  tone?: 'muted' | 'danger'
}) {
  return (
    <div className={`text-[13px] leading-relaxed mt-[8px] ${
      tone === 'danger' ? 'text-[#C92A2A]' : 'text-[#ADADAD]'
    }`}>
      {children}
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
      const next: Tip = {
        baseDistanceM: data?.delivery_tip_base_distance_m ?? DEFAULTS.baseDistanceM,
        baseFee:       data?.delivery_tip_base_fee        ?? DEFAULTS.baseFee,
        // 단위는 100m 고정이다. 예전 행에 다른 값이 들어 있어도 여기서 맞춘다 —
        // 화면이 "100m당"이라고 적어놓고 뒤에서 500m 로 계산하면 안 된다.
        tierDistanceM: TIER_DISTANCE_M,
        tierFee:       data?.delivery_tip_tier_fee        ?? DEFAULTS.tierFee,
      }
      setTip(next)
      setSaved(next)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [storeId])

  const dirty    = JSON.stringify(tip) !== JSON.stringify(saved)
  const feeInRange = tip.tierFee >= TIER_FEE_MIN && tip.tierFee <= TIER_FEE_MAX
  const valid    = feeInRange && tip.baseFee >= 0

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

  // 평소엔 연한 테두리, 손을 대면 진해진다. 입력칸이 여러 개 있는 화면에서
  // 모두 진한 테두리면 **칸들이 먼저 보이고 글자가 나중에 보인다.**
  const FIELD =
    'h-[42px] rounded-[9px] border border-[#EDEDED] px-[14px] text-[14px] text-[#1E1E1E] '
    + 'outline-none focus:border-[#6A635E] transition-colors tabular-nums'

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
        <div className="flex flex-col gap-[40px] flex-shrink-0">
          {/* 기본 배달거리 — 자유 입력이 아니라 선택 */}
          <div>
            <FieldLabel>기본 배달거리</FieldLabel>
            <div className="text-[13px] text-[#787878] leading-relaxed mt-[7px] mb-[16px]">
              기본 배달팁을 적용할 거리를 선택해주세요.<br />
              기본 배달거리에는 할증 배달팁이 적용되지 않습니다.
            </div>
            <div className="flex gap-[8px]">
              {BASE_DISTANCES.map(m => {
                const on = tip.baseDistanceM === m
                return (
                  <button
                    key={m}
                    onClick={() => setTip({ ...tip, baseDistanceM: m })}
                    className={`h-[38px] px-[16px] rounded-[9px] text-[14px] whitespace-nowrap transition-colors ${
                      on
                        ? 'bg-[#6A635E] text-[#FCFCFC] font-medium'
                        : 'bg-[#F2F2F2] text-[#787878] font-normal hover:bg-[#E8E4E2]'
                    }`}
                  >
                    {distanceLabel(m)}
                  </button>
                )
              })}
            </div>
          </div>

          {/* 기본 배달팁 — 위에서 고른 거리까지 받는 금액 */}
          <div>
            <FieldLabel>기본 배달팁</FieldLabel>
            <div className="flex items-center gap-[9px] mt-[16px]">
              <input
                type="number" min={0} step={500}
                value={Number.isFinite(tip.baseFee) ? tip.baseFee : ''}
                onChange={e => {
                  const n = Number(e.target.value)
                  setTip({ ...tip, baseFee: Number.isFinite(n) && n >= 0 ? n : 0 })
                }}
                className={`${FIELD} w-[128px]`}
              />
              <span className="text-[14px] text-[#787878]">원</span>
            </div>
            <Hint>{distanceLabel(tip.baseDistanceM)} 안쪽은 이 금액만 받아요</Hint>
          </div>

          {/* 추가거리당 할증 배달팁 — 단위는 100m 고정 */}
          <div>
            <FieldLabel>추가거리당 할증 배달팁</FieldLabel>
            <div className="flex items-center gap-[9px] mt-[16px]">
              <span className="text-[14px] text-[#414141] whitespace-nowrap">100m당</span>
              <input
                type="number" min={TIER_FEE_MIN} max={TIER_FEE_MAX} step={50}
                value={Number.isFinite(tip.tierFee) ? tip.tierFee : ''}
                onChange={e => {
                  const n = Number(e.target.value)
                  setTip({ ...tip, tierFee: Number.isFinite(n) ? n : 0 })
                }}
                className={`${FIELD} w-[104px] ${!feeInRange ? 'border-[#C92A2A]' : ''}`}
              />
              <span className="text-[14px] text-[#787878]">원</span>
            </div>
            <Hint tone={feeInRange ? 'muted' : 'danger'}>
              {won(TIER_FEE_MIN)} ~ {won(TIER_FEE_MAX)}까지 입력이 가능해요.
            </Hint>
          </div>

          <div className="flex justify-start pt-[2px]">
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
          <div className="rounded-[11px] border border-[#E8E4E2] overflow-hidden mt-[16px]">
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
