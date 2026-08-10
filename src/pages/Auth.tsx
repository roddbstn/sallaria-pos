import { useState } from 'react'
import { supabase } from '../lib/supabase'

type AuthTab = 'login' | 'signup'

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

export default function Auth({ onSuccess }: { onSuccess: () => void }) {
  const [tab,        setTab]        = useState<AuthTab>('login')
  const [email,      setEmail]      = useState(
    () => localStorage.getItem('sallaria_pos_saved_email') ?? ''
  )
  const [password,   setPassword]   = useState('')
  const [confirm,    setConfirm]    = useState('')
  const [loading,    setLoading]    = useState(false)
  const [serverError, setServerError] = useState('')
  const [done,       setDone]       = useState(false)
  const [rememberMe, setRememberMe] = useState(
    () => localStorage.getItem('sallaria_pos_remember') !== 'false'
  )
  const [saveId, setSaveId] = useState(
    () => localStorage.getItem('sallaria_pos_save_id') === 'true'
  )

  // 필드별 touched 상태 (blur 이후 검증 표시)
  const [touched, setTouched] = useState({ email: false, password: false, confirm: false })

  const touch = (field: keyof typeof touched) =>
    setTouched(prev => ({ ...prev, [field]: true }))

  // ── 필드별 에러 메시지 ──
  const emailError = (() => {
    if (!email) return '이메일을 입력해 주세요.'
    if (!isValidEmail(email)) return '올바른 이메일 형식이 아닙니다.'
    return ''
  })()

  const passwordError = (() => {
    if (!password) return '비밀번호를 입력해 주세요.'
    if (password.length < 6) return '비밀번호는 6자 이상이어야 합니다.'
    if (tab === 'signup' && !/[a-z]/.test(password)) return '영어 소문자를 포함해야 합니다.'
    if (tab === 'signup' && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) return '특수문자를 포함해야 합니다.'
    return ''
  })()

  const confirmError = (() => {
    if (tab !== 'signup') return ''
    if (!confirm) return '비밀번호를 한 번 더 입력해 주세요.'
    if (confirm !== password) return '비밀번호가 일치하지 않습니다.'
    return ''
  })()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError('')

    // 제출 시 모든 필드 touched 처리
    setTouched({ email: true, password: true, confirm: true })

    if (emailError || passwordError || (tab === 'signup' && confirmError)) return

    setLoading(true)
    try {
      if (tab === 'login') {
        const { error: e } = await supabase.auth.signInWithPassword({ email, password })
        if (e) throw e
        localStorage.setItem('sallaria_pos_remember', rememberMe ? 'true' : 'false')
        localStorage.setItem('sallaria_pos_save_id', saveId ? 'true' : 'false')
        if (saveId) {
          localStorage.setItem('sallaria_pos_saved_email', email)
        } else {
          localStorage.removeItem('sallaria_pos_saved_email')
        }
      } else {
        const { data, error: e } = await supabase.auth.signUp({ email, password })
        if (e) throw e
        // 세션이 없으면 이메일 인증 필요 → 안내 화면 표시
        // 세션이 있으면 auto-confirm 상태 → onAuthStateChange가 onboarding으로 전환하므로 done 화면 불필요
        if (!data.session) {
          setDone(true)
        }
      }
    } catch (e: any) {
      const raw = e?.message ?? ''
      const msg = typeof raw === 'string' && raw !== '{}' ? raw : ''
      if (msg.includes('Invalid login credentials')) setServerError('이메일 또는 비밀번호가 올바르지 않습니다.')
      else if (msg.includes('already registered'))   setServerError('이미 가입된 이메일입니다.')
      else if (msg.includes('Email not confirmed'))  setServerError('이메일 인증이 확인되지 않았어요. 메일함에서 인증 링크를 클릭해 주세요.')
      else if (e?.status === 500 || !msg)            setServerError('이메일 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      else setServerError(msg)
    } finally {
      setLoading(false)
    }
  }

  function switchTab(t: AuthTab) {
    setTab(t)
    setServerError('')
    setTouched({ email: false, password: false, confirm: false })
  }

  // ── 회원가입 완료 화면 ──
  if (done) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-bg">
        <div className="bg-white rounded-2xl p-8 w-[360px] flex flex-col items-center gap-4 shadow-sm">
          <div className="w-16 h-16 rounded-full bg-green-soft flex items-center justify-center text-3xl">✓</div>
          <h2 className="text-[18px] font-bold text-ink">가입 완료!</h2>
          <p className="text-[13px] text-gray-text text-center leading-relaxed">
            이메일로 확인 링크를 보냈습니다.<br />
            확인 후 로그인해 주세요.
          </p>
          <button
            onClick={() => { setDone(false); setTab('login'); setPassword(''); setConfirm('') }}
            className="w-full py-3 bg-ink text-white rounded-xl font-bold text-[14px]"
          >
            로그인으로 이동
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center bg-gray-bg">
      <div className="bg-white rounded-2xl p-8 w-[360px] shadow-sm">

        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="text-[28px] mb-1">🏪</div>
          <h1 className="text-[20px] font-bold text-ink">선포스</h1>
          <p className="text-[12px] text-gray-text mt-1">선결제도 POS로 관리하세요</p>
        </div>

        {/* 탭 */}
        <div className="flex gap-0 border-b border-gray-border mb-6">
          {(['login', 'signup'] as AuthTab[]).map(t => (
            <button
              key={t}
              onClick={() => switchTab(t)}
              className={`flex-1 pb-2.5 text-[14px] font-semibold transition-colors border-b-2 -mb-px
                ${tab === t ? 'border-ink text-ink' : 'border-transparent text-gray-text'}`}
            >
              {t === 'login' ? '로그인' : '회원가입'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">

          {/* 이메일 */}
          <div>
            <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">이메일</label>
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setServerError('') }}
              onBlur={() => touch('email')}
              placeholder="example@email.com"
              className={`w-full border rounded-lg px-3 py-2.5 text-[14px] focus:outline-none transition-colors
                ${touched.email && emailError
                  ? 'border-danger focus:border-danger'
                  : 'border-gray-border focus:border-green'}`}
            />
            {touched.email && emailError && (
              <p className="text-[12px] text-danger mt-1">{emailError}</p>
            )}
          </div>

          {/* 비밀번호 */}
          <div>
            <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setServerError('') }}
              onBlur={() => touch('password')}
              placeholder={tab === 'signup' ? '6자 이상, 영문 소문자·특수문자 포함' : '비밀번호 입력'}
              className={`w-full border rounded-lg px-3 py-2.5 text-[14px] focus:outline-none transition-colors
                ${touched.password && passwordError
                  ? 'border-danger focus:border-danger'
                  : 'border-gray-border focus:border-green'}`}
            />
            {touched.password && passwordError && (
              <p className="text-[12px] text-danger mt-1">{passwordError}</p>
            )}
          </div>

          {/* 비밀번호 확인 (회원가입) */}
          {tab === 'signup' && (
            <div>
              <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">비밀번호 확인</label>
              <input
                type="password"
                value={confirm}
                onChange={e => { setConfirm(e.target.value); setServerError('') }}
                onBlur={() => touch('confirm')}
                placeholder="비밀번호 재입력"
                className={`w-full border rounded-lg px-3 py-2.5 text-[14px] focus:outline-none transition-colors
                  ${touched.confirm && confirmError
                    ? 'border-danger focus:border-danger'
                    : 'border-gray-border focus:border-green'}`}
              />
              {touched.confirm && confirmError && (
                <p className="text-[12px] text-danger mt-1">{confirmError}</p>
              )}
            </div>
          )}

          {/* 자동 로그인 체크박스 (로그인 탭만) */}
          {tab === 'login' && (
            <div className="flex items-center justify-between py-1">
              {/* ID 저장하기 */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div
                  onClick={() => setSaveId(v => !v)}
                  className={[
                    'w-[18px] h-[18px] rounded-[4px] border-2 flex items-center justify-center transition-colors duration-150 flex-shrink-0',
                    saveId
                      ? 'bg-[#16a84c] border-[#16a84c]'
                      : 'bg-white border-gray-border',
                  ].join(' ')}
                >
                  {saveId && (
                    <svg width="10" height="7" viewBox="0 0 10 7" fill="none">
                      <path d="M1 3.5L3.5 6L9 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span onClick={() => setSaveId(v => !v)} className="text-[13px] text-gray-text">
                  ID 저장
                </span>
              </label>

              {/* 자동 로그인 */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div
                  onClick={() => setRememberMe(v => !v)}
                  className={[
                    'w-[18px] h-[18px] rounded-[4px] border-2 flex items-center justify-center transition-colors duration-150 flex-shrink-0',
                    rememberMe
                      ? 'bg-[#16a84c] border-[#16a84c]'
                      : 'bg-white border-gray-border',
                  ].join(' ')}
                >
                  {rememberMe && (
                    <svg width="10" height="7" viewBox="0 0 10 7" fill="none">
                      <path d="M1 3.5L3.5 6L9 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span onClick={() => setRememberMe(v => !v)} className="text-[13px] text-gray-text">
                  자동 로그인
                </span>
              </label>
            </div>
          )}

          {/* 서버 에러 */}
          {serverError && (
            <p className="text-[13px] text-danger bg-red-50 rounded-lg px-3 py-2">{serverError}</p>
          )}

          {/* 제출 */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-ink text-white rounded-xl font-bold text-[14px] hover:opacity-90 disabled:opacity-50 transition-opacity mt-1"
          >
            {loading ? '처리 중...' : tab === 'login' ? '로그인' : '회원가입'}
          </button>
        </form>
      </div>
    </div>
  )
}
