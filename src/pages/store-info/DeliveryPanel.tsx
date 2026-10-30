import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { won } from '../../lib/ipc'
import StoreRadiusMap from './StoreRadiusMap'

// 매장 정보 > 배달 정보 — 거리에 따른 배달팁 설정.
// 구조는 배민 셀프서비스의 '가게배달 추가 배달팁'을 따른다.
//
// ── 어디에 저장되나 ────────────────────────────────────────────────────────
// stores 의 네 컬럼이다(이미 있었다. 0068 에서 계산 함수까지 만들어 뒀고 화면만 없었다):
//     delivery_tip_base_distance_m   기본 배달거리 (m)
//     delivery_tip_base_fee          기본 배달팁 (원)
//     delivery_tip_tier_distance_m   할증 단위 거리 (m) — 100 또는 500
//     delivery_tip_tier_fee          단위당 할증 (원)
//
// ── 왜 자유 입력이 아니라 선택지인가 ───────────────────────────────────────
// 기본 배달거리는 1~3km 를 0.5km 단위로 고른다. 전엔 m 단위 숫자칸이었는데,
// 1,437m 같은 값을 넣을 이유가 없고 넣으면 손님에게 설명하기만 어려워진다.
// 할증 단위도 100m·500m 중에서 고른다 — 자유 입력이면 237m 같은 값이 들어온다.
//
// 계산은 DB 가 한다 — calculate_delivery_fee(). 손님 앱이 주문할 때 부르는 그 함수다.
// 아래 estimate 는 **그 함수와 같은 규칙**이어야 한다(미리보기가 거짓말하면 안 된다).

interface Tip {
  baseDistanceM: number
  baseFee:       number
  tierDistanceM: number
  tierFee:       number
}

/** 할증 단위 선택지 — 100m 또는 500m */
const TIER_DISTANCES = [100, 500]

/** 기본 배달거리 선택지 — 1km ~ 3km, 0.5km 단위 */
const BASE_DISTANCES = [1000, 1500, 2000, 2500, 3000]

/** 할증 배달팁 허용 범위 */
const TIER_FEE_MIN = 100
const TIER_FEE_MAX = 300

const DEFAULTS: Tip = {
  baseDistanceM: 1500, baseFee: 4000,
  tierDistanceM: 100, tierFee: 100,
}

/**
 * 거리 → 배달팁. **DB 의 calculate_delivery_fee 와 같은 규칙이어야 한다.**
 *
 * 거리별 표를 걷어내면서 화면에서는 안 쓰게 됐지만 남겨둔다 —
 * 이 규칙이 DB 와 같은지 검증하는 테스트(delivery-fee.test.ts)가 여기를 본다.
 * 규칙이 갈라지면 그 테스트가 먼저 운다.
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
  /** 매장 좌표 — 반경 지도를 그리는 데 쓴다. 없으면 지도를 띄우지 않는다 */
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (!storeId) return
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('stores')
        .select('delivery_tip_base_distance_m, delivery_tip_base_fee, delivery_tip_tier_distance_m, delivery_tip_tier_fee, lat, lng')
        .eq('id', storeId)
        .maybeSingle()
      if (cancelled) return
      const next: Tip = {
        baseDistanceM: data?.delivery_tip_base_distance_m ?? DEFAULTS.baseDistanceM,
        baseFee:       data?.delivery_tip_base_fee        ?? DEFAULTS.baseFee,
        // 선택지(100·500) 밖의 값이 들어 있으면 가장 가까운 쪽으로 맞춘다 —
        // 화면이 "100m당"이라고 적어놓고 뒤에서 다른 값으로 계산하면 안 된다.
        tierDistanceM: TIER_DISTANCES.includes(data?.delivery_tip_tier_distance_m ?? 0)
          ? (data!.delivery_tip_tier_distance_m as number)
          : DEFAULTS.tierDistanceM,
        tierFee:       data?.delivery_tip_tier_fee        ?? DEFAULTS.tierFee,
      }
      setTip(next)
      setSaved(next)
      if (data?.lat != null && data?.lng != null) {
        setLoc({ lat: data.lat as number, lng: data.lng as number })
      }
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
        매장에서 배달지까지의 거리로 배달팁이 자동 계산돼요.
      </div>

      <div className="flex gap-[48px] items-start">
        {/* ── 왼쪽: 설정값 ── */}
        <div className="flex flex-col gap-[40px] flex-shrink-0">
          {/* 기본 배달거리 — 자유 입력이 아니라 선택 */}
          <div>
            <FieldLabel>기본 배달거리</FieldLabel>
            <div className="flex gap-[8px] mt-[16px]">
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
          </div>

          {/* 추가거리당 할증 배달팁 — 단위는 버튼으로 고른다 */}
          <div>
            <FieldLabel>추가거리당 할증 배달팁</FieldLabel>
            <div className="flex gap-[8px] mt-[16px]">
              {TIER_DISTANCES.map(m => {
                const on = tip.tierDistanceM === m
                return (
                  <button
                    key={m}
                    onClick={() => setTip({ ...tip, tierDistanceM: m })}
                    className={`h-[38px] px-[16px] rounded-[9px] text-[14px] whitespace-nowrap transition-colors ${
                      on
                        ? 'bg-[#6A635E] text-[#FCFCFC] font-medium'
                        : 'bg-[#F2F2F2] text-[#787878] font-normal hover:bg-[#E8E4E2]'
                    }`}
                  >
                    {m}m당
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-[9px] mt-[12px]">
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

        </div>

        {/* ── 오른쪽: 배달 반경 지도 ──
            거리별 배달팁 표를 걷어내고 지도를 키웠다. 표는 숫자 다섯 줄이라
            한 번 보면 규칙이 다 읽히는데, 지도는 거리를 바꿀 때마다 새로 읽을 게
            생긴다 — 같은 자리를 차지한다면 지도 쪽이 훨씬 많이 말한다.
            좌표가 없는 매장(주소 미등록)은 지도를 띄우지 않는다. */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-[16px]">
            <FieldLabel>배달 반경</FieldLabel>
            <button
              onClick={save}
              disabled={!dirty || !valid || saving}
              className="h-[42px] px-[28px] rounded-[9px] bg-[#2C261F] text-[#F9F9F9] text-[14px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-default"
            >
              {saving ? '저장 중…' : dirty ? '저장' : '저장됨'}
            </button>
          </div>
          {loc ? (
            <StoreRadiusMap lat={loc.lat} lng={loc.lng} radiusM={tip.baseDistanceM} />
          ) : (
            <div className="h-[460px] rounded-[11px] border border-[#E8E4E2] bg-[#FCFCFC] flex items-center justify-center text-[13px] text-[#ADADAD] text-center leading-relaxed">
              매장 주소를 먼저 등록하면<br />배달 반경을 지도로 볼 수 있어요
            </div>
          )}
          <div className="text-[12px] text-[#ADADAD] mt-[12px] leading-relaxed">
            직선 거리 기준이에요. 실제 도로 거리와는 차이가 있을 수 있어요.
          </div>
        </div>
      </div>
    </div>
  )
}