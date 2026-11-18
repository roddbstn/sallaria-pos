// 온보딩(전화인증 이후) 브라우저 미리보기 — dev 전용.
//
//   pnpm vite --config vite.preview.config.ts
//   → http://localhost:5178/dev/signup-preview.html
//
// 실제 PhoneAuthFlow(전화번호·인증번호)는 SMS 를 쏘므로 여기엔 없다. 인증이 끝난
// 직후 상태(세션 있음 / 프로필 비어 있음)를 가정하고 SignupFlow 를 그대로 띄운다.
// 아래 바에서 스텝을 바로 고를 수 있고, 입력값은 실시간으로 보인다.

import './mock-bridge'        // ⚠️ 반드시 첫 줄 — lib/ipc 가 window.api 를 한 번만 읽는다
import { fakePrinterConnected } from './mock-bridge'

import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import { createPortal } from 'react-dom'
import SignupFlow, { type Step } from '../pages/auth/signup/SignupFlow'
import type { SignupData } from '../pages/auth/signup/types'
import { watchViewportScale } from '../lib/viewport-scale'
import 'pretendard/dist/web/static/pretendard-subset.css'
import '../index.css'

const STEPS: { key: Step; label: string }[] = [
  { key: 'password',     label: '1 비밀번호' },
  { key: 'storeName',    label: '2 매장명' },
  { key: 'source',       label: '3 유입경로' },
  { key: 'ownerName',    label: '4 사장님 이름' },
  { key: 'address',      label: '5 주소' },
  { key: 'businessType', label: '6 업종' },
  { key: 'customerType', label: '7 고객유형' },
  { key: 'printerSetup', label: '8 프린터' },
  { key: 'plan',         label: '9 요금제' },
]

function Preview() {
  const [step, setStep]   = useState<Step>('password')
  const [nonce, setNonce] = useState(0)          // 같은 스텝 다시 누르면 리마운트
  const [done, setDone]   = useState<SignupData | null>(null)

  function jump(s: Step) {
    setDone(null)
    setStep(s)
    setNonce(n => n + 1)
  }

  const bar = createPortal(
    <div
      className="fixed left-0 right-0 bottom-0 z-[9999] flex flex-wrap items-center gap-1.5 px-3 py-2"
      style={{ background: 'rgba(30,30,30,0.92)', backdropFilter: 'blur(6px)' }}
    >
      <span className="text-[11px] font-bold mr-1" style={{ color: '#00DD67' }}>미리보기</span>
      {STEPS.map(s => (
        <button
          key={s.key}
          onClick={() => jump(s.key)}
          className="px-2 py-1 rounded text-[11px] font-medium transition-colors"
          style={{
            background: step === s.key ? '#00DD67' : 'rgba(255,255,255,0.12)',
            color:      step === s.key ? '#10231A' : '#E8E8E8',
          }}
        >
          {s.label}
        </button>
      ))}
      <span className="mx-1 text-[11px]" style={{ color: '#6B7280' }}>|</span>
      <button
        onClick={fakePrinterConnected}
        className="px-2 py-1 rounded text-[11px]"
        style={{ background: 'rgba(255,255,255,0.12)', color: '#E8E8E8' }}
        title="프린터가 연결됐다는 신호를 흘려 프린터 스텝을 '연결됨' 상태로 넘긴다"
      >
        프린터 연결 신호
      </button>
      {done && (
        <span className="ml-2 text-[11px] font-semibold" style={{ color: '#00DD67' }}>
          가입 완료 — {done.storeName || '(매장명 없음)'} / {done.plan}
        </span>
      )}
    </div>,
    document.getElementById('devbar')!,
  )

  return (
    <>
      {done ? (
        <div className="h-full w-full flex flex-col items-center justify-center gap-3 bg-white">
          <div className="text-[22px]" style={{ color: 'var(--ink)' }}>온보딩 완료 (저장은 안 함)</div>
          <pre
            className="text-[12px] rounded-xl p-4 overflow-auto max-h-[50vh]"
            style={{ background: 'var(--gray-bg)', color: 'var(--gray-text)' }}
          >{JSON.stringify(done, null, 2)}</pre>
          <button
            onClick={() => jump('password')}
            className="px-4 py-2 rounded-lg text-[13px] font-semibold"
            style={{ background: '#2C261F', color: '#FCFCFC' }}
          >
            처음부터 다시
          </button>
        </div>
      ) : (
        <SignupFlow
          key={`${step}-${nonce}`}
          initialStep={step}
          hasPassword={false}
          onCancel={() => {}}
          // 실제로는 clients/stores INSERT 가 일어나는 자리 — 미리보기라 입력값만 보여준다
          onComplete={async data => { setDone(data) }}
        />
      )}
      {bar}
    </>
  )
}

watchViewportScale()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>
)
