import { useState } from 'react'
import Wordmark from '../../components/ui/Wordmark'
import BackButton from '../../components/auth/BackButton'
import PrimaryButton from '../../components/auth/PrimaryButton'
import { supabase } from '../../lib/supabase'
import { checkPhoneLoginState } from '../../lib/auth-helpers'

interface LoginScreenProps {
  onBack: () => void
  onLoginSuccess: () => void
  onOpenPasswordSetup: () => void
}

/**
 * 로그인 화면 — AuthShell(좌우분할)을 쓰지 않고 정가운데 배치.
 * 휴대폰번호 + 비밀번호 2필드. 포커스 시 테두리 회색 → 메인그린.
 */
export default function LoginScreen({ onBack, onLoginSuccess, onOpenPasswordSetup }: LoginScreenProps) {
  const [phone,    setPhone]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setNeedsPasswordSetup(false)
    setLoading(true)

    // PhoneStep은 signInWithOtp에 toE164(+82...)로 넘기고, Supabase가 그 값을
    // '+' 뗀 국가코드 포함 형식(예: 821012345678)으로 auth.users.phone에 저장한다.
    // 그래서 여기서도 국가코드를 붙여 정규화해야 DB 값이랑 매칭된다.
    const normalizedPhone = '82' + phone.replace(/\D/g, '').replace(/^0/, '')

    const state = await checkPhoneLoginState(normalizedPhone)

    if (state === null) {
      setError('로그인 확인 중 오류가 발생했어요. 다시 시도해주세요.')
      setLoading(false)
      return
    }

    if (state === 'no_account') {
      setError('가입되지 않은 번호예요.')
      setLoading(false)
      return
    }

    if (state === 'no_password') {
      setNeedsPasswordSetup(true)
      setLoading(false)
      return
    }

    const { error: signInErr } = await supabase.auth.signInWithPassword({ phone: normalizedPhone, password })
    if (signInErr) {
      setError('비밀번호가 올바르지 않아요.')
      setLoading(false)
      return
    }

    setLoading(false)
    onLoginSuccess()
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-white">
      <div className="absolute" style={{ top: 40, left: 40 }}>
        <BackButton onClick={onBack} />
      </div>

      <div className="w-[520px]" style={{ transform: 'translateY(-140px)' }}>
        <div className="flex justify-center mb-8">
          <Wordmark size={76} />
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={e => { setPhone(e.target.value); setNeedsPasswordSetup(false); setError('') }}
            placeholder="대표자 휴대폰 번호"
            className="auth-input w-[350px] mx-auto rounded-[10px] px-3 py-3 text-[15px] outline-none transition-colors"
            style={{ border: '1.5px solid var(--gray-border)' }}
          />

          <div className="w-[350px] mx-auto">
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setNeedsPasswordSetup(false); setError('') }}
              placeholder="비밀번호"
              className="auth-input w-full rounded-[10px] px-3 py-3 text-[15px] outline-none transition-colors"
              style={{ border: '1.5px solid var(--gray-border)' }}
            />

            {needsPasswordSetup && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[12.5px]" style={{ color: 'var(--gray-text)' }}>
                  비밀번호를 설정해주세요
                </span>
                <button
                  type="button"
                  onClick={onOpenPasswordSetup}
                  className="text-[12.5px] font-semibold hover:underline"
                  style={{ color: '#4B4B4B' }}
                >
                  비밀번호 설정하기
                </button>
              </div>
            )}

            {error && (
              <p className="text-[12.5px] mt-2" style={{ color: 'var(--danger)' }}>{error}</p>
            )}
          </div>

          <PrimaryButton
            type="submit"
            disabled={loading || !phone || !password}
            size="lg"
            className="w-[350px] mx-auto mt-1"
            style={{ paddingTop: 10, paddingBottom: 10 }}
          >
            {loading ? '로그인 중...' : '로그인'}
          </PrimaryButton>
        </form>
      </div>
    </div>
  )
}
