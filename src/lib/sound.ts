// 주문 알림음.
//
// ── 왜 data URL 인가 ────────────────────────────────────────────────────────
// 프로덕션 Electron 은 file:// 로 화면을 띄우고 코드는 ASAR 안에 있다. 그래서
// '/sounds/order-alert.mp3' 같은 절대경로가 풀리지 않는다. 전에는 그걸 피하려고
// base64 문자열 65,000자를 이 파일에 **직접 붙여놨다.**
//
// 같은 결과를 Vite 가 만들어 준다 — assetsInlineLimit 로 mp3 를 인라인 대상으로
// 지정해 두면 빌드할 때 data URL 로 바뀐다. 런타임 동작은 전과 똑같고(지우기 전에 바이트 비교로 확인했다), 소스에서
// 65KB 가 빠지고, 무엇보다 **mp3 를 폴더에 넣는 것만으로 알림음이 바뀐다.**
//
// ── 주문 종류별 알림음 ─────────────────────────────────────────────────────
// 소리만 듣고 "배달인지 포장인지"를 알아야 주방이 먼저 움직인다. 전에는 세 경우가
// 같은 소리였고, 점주는 매번 화면을 봐야 종류를 알았다.
//
// src/assets/sounds/ 에 아래 이름으로 넣으면 그 종류에 쓴다. 없으면 기본음으로
// 떨어진다 — 세 개를 다 준비하지 못한 상태에서도 알림이 멈추면 안 된다.
//
//     alert-delivery.mp3   배달       벨 + "선결제 배달주문이에요"
//     alert-takeout.mp3    포장       벨 + "선결제 픽업주문이에요"
//     alert-dinein.mp3     매장 식사   벨 + "선결제 내점주문이에요"
//     order-alert.mp3      기본 (위 파일이 없을 때 · 미리 듣기 기본값)
//
// 세 파일은 손으로 만들지 않는다 — scripts/gen-alert-sounds.py 가 벨(bell.mp3)과
// 녹음 원본(scripts/voice-src/)을 합쳐서 만든다. 자세한 건 그 폴더의 README.
//
// glob 으로 읽는 이유: 정적 import 는 파일이 없으면 **빌드가 깨진다.** 아직 녹음이
// 안 된 종류가 있어도 앱은 나가야 하므로, 있는 것만 집어서 쓴다.

import type { Order } from './mock-data'

// 인라인은 electron.vite.config.ts 의 assetsInlineLimit 가 보장한다.
// glob 의 query:'?inline' 은 인라인시키지 못하고 URL 뒤에 '?inline' 을 붙일 뿐이다.
const SOUNDS = import.meta.glob<string>('../assets/sounds/*.mp3', {
  import: 'default',
  eager:  true,
})

/** 알림음을 가르는 기준 — 주문의 이용방법 세 가지 */
export type AlertKind = 'delivery' | 'takeout' | 'dinein'

const FILE_OF: Record<AlertKind, string> = {
  delivery: 'alert-delivery.mp3',
  takeout:  'alert-takeout.mp3',
  dinein:   'alert-dinein.mp3',
}

const FALLBACK_FILE = 'order-alert.mp3'

function urlOf(file: string): string | undefined {
  // glob 키는 '../assets/sounds/alert-delivery.mp3' 형태다
  return SOUNDS[`../assets/sounds/${file}`]
}

/** 이 종류의 전용 알림음이 실제로 들어와 있나. 설정 화면이 상태를 보여주는 데 쓴다 */
export function hasKindSound(kind: AlertKind): boolean {
  return urlOf(FILE_OF[kind]) !== undefined
}

/**
 * UI 의 이용방법(Order['method']) → 알림음 종류.
 *
 * DB 의 '내점' 은 mappers.ts 의 DB_METHOD_MAP 이 '매장 식사' 로 바꿔서 올려보낸다.
 * 여기서 받는 건 UI 값이므로 '매장 식사' 를 본다.
 */
export function alertKindOf(method: Order['method']): AlertKind {
  if (method === '배달') return 'delivery'
  if (method === '포장') return 'takeout'
  return 'dinein'
}

/** 주문 종류 라벨 — 설정 화면의 미리 듣기 버튼이 쓴다 */
export const KIND_LABEL: Record<AlertKind, string> = {
  delivery: '배달',
  takeout:  '포장',
  dinein:   '내점',
}

export const VOLUME_KEY = 'order-alert-volume'
export const DEFAULT_VOLUME = 70

export function getSavedVolume(): number {
  const v = parseInt(localStorage.getItem(VOLUME_KEY) ?? '', 10)
  return isNaN(v) ? DEFAULT_VOLUME : Math.max(0, Math.min(100, v))
}

export function saveVolume(v: number) {
  localStorage.setItem(VOLUME_KEY, String(v))
}

export const ALARM_COUNT_KEY = 'pos_setting_alarm_count'

/** 설정 > 기타 설정의 "알림 횟수". usePersistentState 가 JSON 으로 넣으므로 그대로 파싱한다 */
export function getAlarmCount(): number {
  try {
    const n = JSON.parse(localStorage.getItem(ALARM_COUNT_KEY) ?? '1')
    return typeof n === 'number' && n >= 1 && n <= 10 ? n : 1
  } catch {
    return 1
  }
}

// ── 무한 반복 알림 ──────────────────────────────────────────────────────────
//
// 전에는 설정 화면에 '알림 횟수 N회'와 '주문 확인할 때까지 반복'이 **따로** 있었다.
// 둘 다 켜면 무슨 뜻인지 알 수 없다 — 3회면서 무한인가?
// 이제 둘 중 하나만 고른다(mode: 'count' | 'until-ack').
//
// 그리고 '주문 확인할 때까지 반복'은 그동안 값만 저장되고 아무 일도 하지 않았다.
// 실제로 반복시키려면 멈출 방법이 있어야 한다 — 주문 팝업이 닫히면 멈춘다.

let repeatTimer: ReturnType<typeof setInterval> | null = null

/**
 * 주문을 확인할 때까지 간격마다 다시 울린다. stopOrderAlarm() 으로만 멈춘다.
 *
 * 간격 하한은 0.3초다. 0.5초 설정을 쓸 수 있어야 해서 1초로 막지 않았다
 * (피크타임에 0.5초 간격을 고르는 매장이 있다). 그보다 짧으면 소리가
 * 겹쳐 쌓이기만 하고 알람으로 안 들린다.
 *
 * kind 를 주면 그 종류의 알림음으로 반복한다 — 반복되는 동안에도 배달인지
 * 포장인지 계속 들려야 종류를 나눈 의미가 있다.
 */
export function startOrderAlarm(volume: number, intervalSec: number, kind?: AlertKind) {
  stopOrderAlarm()
  if (volume === 0) return
  playOrderSound(volume, 1, kind)
  repeatTimer = setInterval(() => playOrderSound(volume, 1, kind), Math.max(0.3, intervalSec) * 1000)
}

export function stopOrderAlarm() {
  if (repeatTimer !== null) { clearInterval(repeatTimer); repeatTimer = null }
}

/**
 * 알림음 재생.
 *
 * @param volumeOverride 미리 듣기처럼 저장값 말고 특정 볼륨으로 울릴 때
 * @param count          몇 번 울릴지. 안 주면 설정값(기본 1회)
 * @param kind           주문 종류. 안 주거나 그 종류 파일이 없으면 기본음
 *
 * 왜 한 Audio 를 재사용하지 않나: 소리가 끝나기 전에 다시 play() 하면 처음으로 되감겨
 * 두 번 울린 티가 안 난다. 끝난 뒤에 다음 걸 트는 게 "두 번 울렸다"로 들린다.
 */
export function playOrderSound(volumeOverride?: number, count?: number, kind?: AlertKind) {
  const volume = (volumeOverride ?? getSavedVolume()) / 100  // 0~1
  if (volume === 0) return
  const times = Math.max(1, Math.min(10, count ?? getAlarmCount()))

  const src = (kind && urlOf(FILE_OF[kind])) ?? urlOf(FALLBACK_FILE)
  if (!src) {
    // assets/sounds 가 비어 있는 경우. 조용히 넘기면 "소리가 안 나요" 의 원인을 못 찾는다.
    console.error('[sound] 알림음 파일이 없어요 — src/assets/sounds/ 를 확인해 주세요')
    return
  }

  let played = 0
  const playOnce = () => {
    try {
      const audio = new Audio(src)
      audio.volume = volume
      audio.addEventListener('ended', () => {
        played += 1
        if (played < times) playOnce()
      })
      audio.play().catch(err => console.error('[sound] 알림음 재생 실패:', err))
    } catch (err) {
      console.error('[sound] 알림음 재생 실패:', err)
    }
  }
  playOnce()
}
