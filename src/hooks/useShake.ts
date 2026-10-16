import { useRef, useState } from 'react'

/** 입력 오류 피드백 — 흔들림 애니메이션을 durationMs 동안 켰다가 끈다. 온보딩/인증 스텝 공용. */
export function useShake(durationMs = 400) {
  const [shake, setShake] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function triggerShake() {
    setShake(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setShake(false), durationMs)
  }

  return [shake, triggerShake] as const
}
