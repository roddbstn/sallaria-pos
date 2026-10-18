import { useState, useEffect } from 'react'

// 이 기기(POS)에 묶이는 설정을 localStorage 에 붙잡아 두는 useState.
//
// 왜 필요했나: 설정 화면들(프린터 연결 / 영수증·증빙 / 기타 설정)의 값이 전부 평범한
// useState 라서, 다른 화면에 갔다 오면 컴포넌트가 언마운트되며 전부 기본값으로 돌아갔다.
// App.tsx 가 <SettingsHub key={settingsHubTab}> 로 렌더해 사이드 탭만 바꿔도 재마운트된다.
//
// 왜 DB가 아니라 localStorage 인가: 프린터 포트·인쇄 매수·알림음 크기·화면 꺼짐 방지는
// "이 컴퓨터"의 속성이지 계정의 속성이 아니다. 매장에 POS가 두 대면 서로 달라야 한다.
// (영수증에 무엇을 넣을지 같은 "매장 정책"은 나중에 stores 로 옮기는 게 맞다 — 아래 주석 참고)

export function usePersistentState<T>(key: string, initial: T) {
  const storageKey = `pos_setting_${key}`

  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw === null) return initial
      const parsed = JSON.parse(raw)
      // 저장해 둔 값이 객체면 기본값 위에 덮는다 — 나중에 필드가 추가돼도
      // 옛 저장값 때문에 undefined 가 생기지 않도록.
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          && initial && typeof initial === 'object' && !Array.isArray(initial)) {
        return { ...(initial as object), ...parsed } as T
      }
      return parsed as T
    } catch {
      return initial   // JSON 깨짐 / 프라이빗 모드 등 — 기본값으로 계속 간다
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      /* 저장 실패해도 화면 동작은 막지 않는다 */
    }
  }, [storageKey, value])

  return [value, setValue] as const
}


/**
 * 훅 밖에서 같은 설정을 한 번 읽는다 (usePersistentState 와 같은 키·같은 형식).
 *
 * App.tsx 의 '새 주문' effect 처럼 **그 순간의 값만** 필요한 곳에서 쓴다.
 * 거기서 usePersistentState 를 쓰면 설정이 바뀔 때마다 effect 가 다시 돌아
 * 알림이 두 번 울리는 식의 사고가 난다.
 */
export function readSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`pos_setting_${key}`)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
