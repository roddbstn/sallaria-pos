// KST(한국 표준시) 기준 날짜/시간 포맷 — 상단 네비게이션, 대시보드 등에서 공용으로 사용

const DAYS = ['일', '월', '화', '수', '목', '금', '토']

export function formatKstDate(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const mm  = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const dd  = String(kst.getUTCDate()).padStart(2, '0')
  const day = DAYS[kst.getUTCDay()]
  return `${mm}.${dd}. (${day})`
}

export function formatKstTime(d: Date): string {
  const kst  = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const h24  = kst.getUTCHours()
  const ampm = h24 < 12 ? '오전' : '오후'
  const h12  = h24 % 12 === 0 ? 12 : h24 % 12
  const min  = String(kst.getUTCMinutes()).padStart(2, '0')
  return `${ampm} ${h12}:${min}`
}
