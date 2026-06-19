import { useState } from 'react'
import { supabase } from '../lib/supabase'

interface Props {
  clientId:   string
  onComplete: (storeId: string, storeName: string) => void
}

export default function Onboarding({ clientId, onComplete }: Props) {
  const [step,         setStep]         = useState<1 | 2>(1)
  const [businessName, setBusinessName] = useState('')
  const [address,      setAddress]      = useState('')
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')

  // Step 1: 상호명 저장
  async function handleStep1(e: React.FormEvent) {
    e.preventDefault()
    if (!businessName.trim()) return
    setLoading(true)
    setError('')
    try {
      const { error: e } = await supabase
        .from('clients')
        .update({ business_name: businessName.trim() })
        .eq('id', clientId)
      if (e) throw e
      setStep(2)
    } catch (e: any) {
      setError(e.message ?? '오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // Step 2: 스토어 생성
  async function handleStep2(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { data, error: e } = await supabase
        .from('stores')
        .insert({ client_id: clientId, name: businessName.trim(), address: address.trim() || null })
        .select('id, name')
        .single()
      if (e) throw e
      onComplete(data.id, data.name)
    } catch (e: any) {
      setError(e.message ?? '오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-gray-bg">
      <div className="bg-white rounded-2xl p-8 w-[400px] shadow-sm">

        {/* 진행 단계 */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold
                ${step >= s ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text'}`}>
                {s}
              </div>
              {s < 2 && <div className={`w-8 h-0.5 ${step > s ? 'bg-ink' : 'bg-gray-200'}`} />}
            </div>
          ))}
          <span className="ml-2 text-[13px] text-gray-text">
            {step === 1 ? '상호명 입력' : '매장 주소'}
          </span>
        </div>

        {step === 1 ? (
          <>
            <h1 className="text-[22px] font-bold text-ink mb-2">어떤 매장인가요?</h1>
            <p className="text-[13px] text-gray-text mb-6">POS 화면 상단과 QR 주문 화면에 표시됩니다.</p>

            <form onSubmit={handleStep1} className="flex flex-col gap-4">
              <div>
                <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">매장 상호명</label>
                <input
                  type="text"
                  value={businessName}
                  onChange={e => setBusinessName(e.target.value)}
                  placeholder="예: 샐러리아 침산점"
                  autoFocus
                  required
                  className="w-full border border-gray-border rounded-lg px-3 py-2.5 text-[15px] focus:outline-none focus:border-green transition-colors"
                />
              </div>
              {error && <p className="text-[13px] text-danger">{error}</p>}
              <button
                type="submit"
                disabled={!businessName.trim() || loading}
                className="w-full py-3 bg-ink text-white rounded-xl font-bold text-[14px] hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                다음
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-[22px] font-bold text-ink mb-2">매장 주소를 입력해주세요</h1>
            <p className="text-[13px] text-gray-text mb-6">나중에 설정에서 수정할 수 있어요.</p>

            <form onSubmit={handleStep2} className="flex flex-col gap-4">
              <div>
                <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">주소 (선택)</label>
                <input
                  type="text"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="예: 대구 북구 침산동"
                  autoFocus
                  className="w-full border border-gray-border rounded-lg px-3 py-2.5 text-[14px] focus:outline-none focus:border-green transition-colors"
                />
              </div>
              {error && <p className="text-[13px] text-danger">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-ink text-white rounded-xl font-bold text-[14px] hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {loading ? '생성 중...' : '시작하기'}
              </button>
              <button
                type="button"
                onClick={handleStep2}
                className="text-[13px] text-gray-text hover:text-ink transition-colors"
              >
                나중에 입력
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
