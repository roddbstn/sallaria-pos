import { useState } from 'react'
import FloatingLabelInput from '../../../../components/auth/FloatingLabelInput'
import PrimaryButton from '../../../../components/auth/PrimaryButton'
import DaumPostcodeEmbed from '../../../../components/DaumPostcodeEmbed'
import { loadDaumPostcodeScript } from '../../../../hooks/useDeliveryInfo'
import { supabase } from '../../../../lib/supabase'
import type { StepProps } from '../types'

const MAX_DETAIL_LEN = 50

/** 온보딩의 매장 주소 입력 — Settings의 "가게 배달정보"와 동일하게 다음 주소검색 +
 *  geocode-address로 위경도까지 받아둠. 그래야 온보딩 때 설정한 위치가 설정화면에도 그대로 보이고,
 *  거리기반 배달료 계산(get_delivery_fee_estimate)에도 바로 쓰일 수 있음. */
export default function AddressStep({ data, onChange, onNext }: StepProps) {
  const [addressModalOpen, setAddressModalOpen] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [error, setError] = useState('')

  async function openAddressSearch() {
    await loadDaumPostcodeScript()
    setAddressModalOpen(true)
  }

  async function completeAddressSearch(road: string) {
    setAddressModalOpen(false)
    setError('')
    setGeocoding(true)
    try {
      const { data: geo, error: fnError } = await supabase.functions.invoke('geocode-address', {
        body: { road_address: road },
      })
      if (fnError || !geo?.lat || !geo?.lng) {
        onChange({ address: road, lat: null, lng: null })
        setError('주소로 좌표를 찾지 못했어요. 주소를 다시 검색해 주세요.')
        return
      }
      onChange({ address: road, lat: geo.lat, lng: geo.lng })
    } finally {
      setGeocoding(false)
    }
  }

  const hasLocation = !!data.address && data.lat != null && data.lng != null

  return (
    <div className="step-in">
      <div className="mx-auto" style={{ maxWidth: 340 }}>
        {!data.address ? (
          <button
            onClick={openAddressSearch}
            className="w-full border border-dashed rounded-xl px-4 py-3.5 text-[15px] text-left transition-colors"
            style={{ borderColor: 'var(--gray-border)', color: 'var(--gray-text)' }}
          >
            매장 주소를 알려주세요
          </button>
        ) : (
          <div className="flex items-end justify-between gap-3" style={{ borderBottom: '2px solid var(--gray-border)' }}>
            <div className="min-w-0 py-2">
              <div className="text-[18px] truncate" style={{ color: 'var(--ink)' }}>{data.address}</div>
              {geocoding && <div className="text-[12px] mt-0.5" style={{ color: 'var(--gray-text)' }}>좌표 확인 중...</div>}
            </div>
            <button
              onClick={openAddressSearch}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold flex-shrink-0 mb-1"
              style={{ background: 'var(--gray-bg)', color: 'var(--ink)' }}
            >
              변경
            </button>
          </div>
        )}

        {data.address && (
          <div className="mt-2.5">
            <FloatingLabelInput
              value={data.addressDetail}
              onChange={v => onChange({ addressDetail: v.slice(0, MAX_DETAIL_LEN) })}
              placeholder="상세주소"
              floatingLabel={false}
            />
          </div>
        )}

        {error && (
          <p className="text-[12px] mt-2" style={{ color: 'var(--danger)' }}>{error}</p>
        )}
      </div>

      <PrimaryButton
        onClick={onNext}
        disabled={geocoding || !hasLocation}
        hidden={!data.address}
        className="w-full mt-[220px]"
      >
        확인
      </PrimaryButton>

      {addressModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setAddressModalOpen(false)}
        >
          <div
            className="modal-in bg-white rounded-2xl w-[420px] h-[520px] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
              <span className="text-[14px] font-bold" style={{ color: 'var(--ink)' }}>주소 검색</span>
              <button
                onClick={() => setAddressModalOpen(false)}
                className="text-[13px]"
                style={{ color: 'var(--gray-text)' }}
              >
                닫기
              </button>
            </div>
            <DaumPostcodeEmbed onComplete={completeAddressSearch} />
          </div>
        </div>
      )}
    </div>
  )
}
