import { useState } from 'react'
import FloatingLabelInput from '../../../../components/auth/FloatingLabelInput'
import PrimaryButton from '../../../../components/auth/PrimaryButton'
import { supabase } from '../../../../lib/supabase'
import { PASSWORD_MIN_LEN } from '../../../../lib/auth-helpers'
import { useShake } from '../../../../hooks/useShake'
import type { StepProps } from '../types'

/** 전화인증 직후 — 로그인용 비밀번호를 설정한다. 세션은 verifyOtp에서 이미 생겼으므로 updateUser만 호출. */
export default function PasswordStep({ onNext }: StepProps) {
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [shake, triggerShake] = useShake()

  async function handleSubmit() {
    if (password.length < PASSWORD_MIN_LEN) {
      setError(`비밀번호는 ${PASSWORD_MIN_LEN}자 이상이어야 해요`)
      triggerShake()
      return
    }
    if (password !== passwordConfirm) {
      setError('비밀번호가 일치하지 않아요')
      triggerShake()
      return
    }

    setSaving(true)
    setError('')
    const { error: updateErr } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (updateErr) {
      setError('비밀번호 설정에 실패했어요. 다시 시도해주세요')
      triggerShake()
      return
    }
    onNext()
  }

  const valid = password.length >= PASSWORD_MIN_LEN && passwordConfirm.length >= PASSWORD_MIN_LEN

  return (
    <div className="step-in">
      <FloatingLabelInput
        value={password}
        onChange={v => { setPassword(v); setError('') }}
        placeholder={`비밀번호 (${PASSWORD_MIN_LEN}자 이상)`}
        type="password"
        autoFocus
        shake={shake}
      />

      <div className="mt-4">
        <FloatingLabelInput
          value={passwordConfirm}
          onChange={v => { setPasswordConfirm(v); setError('') }}
          placeholder="비밀번호 확인"
          type="password"
          onEnter={handleSubmit}
        />
      </div>

      {error && (
        <p className="text-[12px] mt-3" style={{ color: 'var(--danger)' }}>{error}</p>
      )}

      <PrimaryButton onClick={handleSubmit} disabled={saving} hidden={!valid} className="w-full mt-[220px]">
        {saving ? '설정 중...' : '확인'}
      </PrimaryButton>
    </div>
  )
}
