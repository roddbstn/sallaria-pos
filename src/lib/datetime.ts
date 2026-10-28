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

/**
 * KST 기준 'YYYY-MM-DD'.
 *
 * ⚠️ `new Date().toISOString().slice(0, 10)` 을 쓰면 안 된다 — 그건 **UTC 날짜**다.
 *    KST 00:00~09:00 사이에는 UTC 날짜가 아직 '어제'라서 하루가 밀린다.
 *
 * 2026-10-27 사고가 이것이었다. 00:27 KST(= 전날 15:27 UTC)에 가게를 ON 으로 켰는데
 * POS 가 today_override 를 '어제 날짜'로 저장했고, DB 의 auto_close_stores_by_schedule()
 * 은 KST 기준 '오늘'과 비교해서 그 override 를 **남의 날짜 것으로 보고 버렸다.**
 * 그러고는 영업시간(09:00~21:15) 밖이라 1분 안에 다시 닫아버렸다.
 * 매일 00:00~09:00 KST 에 재현되는 버그였다.
 *
 * PC 시계의 표준시 설정과 무관하게 같은 값이 나와야 한다 — 매장 PC 의 표준시가
 * 잘못 잡혀 있어도 서버(KST 기준)와 어긋나면 안 되므로 toLocaleDateString 을 쓰지 않는다.
 */
export function kstDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
