import { useEffect, useState } from 'react'

// 프린터 연결 상태를 **화면 밖에서** 들고 있는 곳.
//
// 왜 필요했나: 프린터 연결 화면이 `useState(false)` 로 시작하고 메인 프로세스가
// printer:status 를 푸시해 줄 때까지 기다렸다. 푸시는 주기적으로 오므로, 연결해 둔
// 뒤 다른 탭에 갔다 돌아오면 그 사이 몇 초 동안
//   "{프린터 이름} 를 찾았지만 아직 연결 전이에요"
// 가 떴다가 다음 푸시에서 "연결됨" 으로 바뀌었다. 실제로 끊긴 적이 없는데도.
//
// 두 가지를 고친다:
//   1. 마지막으로 받은 값을 모듈에 캐시한다 — 다시 열어도 아는 값부터 보여준다.
//   2. 한 번도 못 받았으면 false 가 아니라 **null**(모름)이다.
//      '모름'과 '끊김'은 다른 상태인데 둘 다 빨간 글씨로 보여주면 거짓말이 된다.
//
// 구독도 한 곳에서만 건다. preload 의 offPrinterStatus 가 removeAllListeners 라
// 화면마다 따로 구독하면 하나가 내려갈 때 나머지도 같이 끊긴다.

export interface PrinterStatus { connected: boolean; queueLength: number }

type Listener = (s: PrinterStatus | null) => void

let cache: PrinterStatus | null = null
let subscribed = false
const listeners = new Set<Listener>()

function bridge() {
  return (window as unknown as {
    api?: {
      onPrinterStatus?:  (cb: (s: PrinterStatus) => void) => void
      offPrinterStatus?: () => void
    }
  }).api
}

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  bridge()?.onPrinterStatus?.(s => {
    cache = s
    for (const fn of listeners) fn(cache)
  })
  // 일부러 해제하지 않는다 — 앱이 살아 있는 동안 계속 듣는 게 맞다.
  // 화면이 내려갈 때 해제하면 바로 이 버그(다시 열면 모름)로 되돌아간다.
}

/** 마지막으로 알려진 연결 상태. null 이면 **아직 모름**(끊김이 아니다) */
export function usePrinterStatus(): PrinterStatus | null {
  const [status, setStatus] = useState<PrinterStatus | null>(cache)

  useEffect(() => {
    ensureSubscribed()
    listeners.add(setStatus)
    setStatus(cache)
    return () => { listeners.delete(setStatus) }
  }, [])

  return status
}

/** 테스트/수동 연결처럼 화면에서 바로 아는 결과를 캐시에 반영한다 */
export function setPrinterStatus(s: PrinterStatus): void {
  cache = s
  for (const fn of listeners) fn(cache)
}
