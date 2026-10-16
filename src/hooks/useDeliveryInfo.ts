import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

declare global {
  interface Window {
    daum: {
      Postcode: new (opts: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        oncomplete: (d: any) => void
        width?: string
        height?: string
      }) => {
        open: () => void
        embed: (el: HTMLElement) => void
      }
    }
  }
}

// 다음 우편번호 스크립트 — 여러 훅/화면에서 중복 로드되지 않게 scriptId로 가드
export function loadDaumPostcodeScript(): Promise<void> {
  return new Promise((resolve) => {
    const scriptId = 'daum-postcode'
    if (document.getElementById(scriptId)) { resolve(); return }
    const script = document.createElement('script')
    script.id = scriptId
    script.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
    script.async = true
    script.onload = () => resolve()
    document.body.appendChild(script)
  })
}

export const BASE_DISTANCE_OPTIONS = [1000, 1500, 2000, 2500, 3000] as const
export const TIER_DISTANCE_OPTIONS = [100, 500] as const

// 거리 단위(100m/500m)별 할증액 허용 범위 — DB CHECK 제약과 동일
export function tierFeeRange(tierDistanceM: number): { min: number; max: number } {
  return tierDistanceM === 500 ? { min: 100, max: 1500 } : { min: 100, max: 300 }
}

export function useDeliveryInfo(
  storeId: string | undefined,
  showToast: (msg: string) => void,
) {
  // ── 매장 위치 ──────────────────────────────────────────────────────────────
  const [roadAddress,   setRoadAddress]   = useState('')
  const [addressDetail, setAddressDetail] = useState('')
  const [lat,            setLat]           = useState<number | null>(null)
  const [lng,            setLng]           = useState<number | null>(null)
  const [draftAddress,   setDraftAddress]  = useState('')  // 새로 검색한 주소 (저장 전)
  const [draftDetail,    setDraftDetail]   = useState('')
  const [savingLocation, setSavingLocation] = useState(false)
  const [addressModalOpen, setAddressModalOpen] = useState(false)

  // ── 배달팁 기준 ────────────────────────────────────────────────────────────
  const [baseDistanceM, setBaseDistanceM] = useState(1500)
  const [baseFee,       setBaseFee]       = useState(4000)
  const [tierDistanceM, setTierDistanceM] = useState<100 | 500>(100)
  const [tierFee,       setTierFee]       = useState(100)
  const [savingTip,     setSavingTip]     = useState(false)

  useEffect(() => {
    if (!storeId) return
    supabase
      .from('stores')
      .select('road_address, address_detail, lat, lng, delivery_tip_base_distance_m, delivery_tip_base_fee, delivery_tip_tier_distance_m, delivery_tip_tier_fee')
      .eq('id', storeId)
      .single()
      .then(({ data }) => {
        if (!data) return
        setRoadAddress(data.road_address ?? '')
        setAddressDetail(data.address_detail ?? '')
        setLat(data.lat ?? null)
        setLng(data.lng ?? null)
        setDraftAddress(data.road_address ?? '')
        setDraftDetail(data.address_detail ?? '')

        if (data.delivery_tip_base_distance_m) setBaseDistanceM(data.delivery_tip_base_distance_m)
        if (data.delivery_tip_base_fee != null) setBaseFee(data.delivery_tip_base_fee)
        if (data.delivery_tip_tier_distance_m) setTierDistanceM(data.delivery_tip_tier_distance_m as 100 | 500)
        if (data.delivery_tip_tier_fee != null) setTierFee(data.delivery_tip_tier_fee)
      })
  }, [storeId])

  // Electron은 보안상 window.open() 팝업을 막고 외부 브라우저로 돌리기 때문에
  // Daum 주소검색의 기본 .open() 방식이 동작하지 않는다 — 모달 안에 .embed()로 띄운다.
  async function openAddressSearch() {
    await loadDaumPostcodeScript()
    setAddressModalOpen(true)
  }

  function completeAddressSearch(road: string) {
    setDraftAddress(road)
    setAddressModalOpen(false)
  }

  async function saveLocation() {
    if (!storeId) return false
    if (!draftAddress.trim()) { showToast('도로명 주소를 먼저 검색해 주세요.'); return false }

    setSavingLocation(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('geocode-address', {
        body: { road_address: draftAddress },
      })
      if (fnError || !data?.lat || !data?.lng) {
        showToast('주소로 좌표를 찾지 못했습니다. 주소를 다시 확인해 주세요.')
        return false
      }

      const { error } = await supabase.from('stores').update({
        road_address:   draftAddress,
        address_detail: draftDetail.trim() || null,
        lat:            data.lat,
        lng:            data.lng,
      }).eq('id', storeId)

      if (error) { showToast(`매장 위치 저장 실패: ${error.message}`); return false }

      setRoadAddress(draftAddress)
      setAddressDetail(draftDetail.trim())
      setLat(data.lat)
      setLng(data.lng)
      showToast('매장 위치가 저장되었습니다.')
      return true
    } finally {
      setSavingLocation(false)
    }
  }

  function changeTierDistanceM(next: 100 | 500) {
    setTierDistanceM(next)
    // 단위 바꾸면 허용 범위도 바뀌므로 범위 밖이면 최소값으로 보정
    const { min, max } = tierFeeRange(next)
    setTierFee(prev => (prev < min || prev > max ? min : prev))
  }

  async function saveTipConfig() {
    if (!storeId) return false
    const { min, max } = tierFeeRange(tierDistanceM)
    if (tierFee < min || tierFee > max) {
      showToast(`${tierDistanceM}m당 할증액은 ${min}원~${max}원 사이로 입력해 주세요.`)
      return false
    }
    if (baseFee < 0) { showToast('기본 배달팁은 0원 이상이어야 해요.'); return false }

    setSavingTip(true)
    try {
      const { error } = await supabase.from('stores').update({
        delivery_tip_base_distance_m: baseDistanceM,
        delivery_tip_base_fee:        baseFee,
        delivery_tip_tier_distance_m: tierDistanceM,
        delivery_tip_tier_fee:        tierFee,
      }).eq('id', storeId)

      if (error) { showToast(`배달팁 설정 저장 실패: ${error.message}`); return false }
      showToast('배달팁 설정이 저장되었습니다.')
      return true
    } finally {
      setSavingTip(false)
    }
  }

  return {
    roadAddress, addressDetail, lat, lng,
    draftAddress, draftDetail, setDraftDetail,
    savingLocation,
    addressModalOpen, setAddressModalOpen,
    openAddressSearch,
    completeAddressSearch,
    saveLocation,

    baseDistanceM, setBaseDistanceM,
    baseFee,       setBaseFee,
    tierDistanceM, changeTierDistanceM,
    tierFee,       setTierFee,
    savingTip,
    saveTipConfig,
  }
}
