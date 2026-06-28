// 주문 알림음 — 딩동 차임 + "선결제 주문!" 음성
// 볼륨은 localStorage('order-alert-volume') 에 0~100 정수로 저장

export const VOLUME_KEY = 'order-alert-volume'
export const DEFAULT_VOLUME = 70

export function getSavedVolume(): number {
  const v = parseInt(localStorage.getItem(VOLUME_KEY) ?? '', 10)
  return isNaN(v) ? DEFAULT_VOLUME : Math.max(0, Math.min(100, v))
}

export function saveVolume(v: number) {
  localStorage.setItem(VOLUME_KEY, String(v))
}

/** 주문 알림음 재생 (public/sounds/order-alert.mp3) */
export function playOrderSound(volumeOverride?: number) {
  try {
    const volume = (volumeOverride ?? getSavedVolume()) / 100  // 0~1
    if (volume === 0) return

    const audio = new Audio('./sounds/order-alert.mp3')
    audio.volume = volume
    audio.play()
  } catch (_) {}
}
