// 거래처 유형 색 — 표의 유형 배지와 우측 도넛이 같은 색을 쓰게 하는 단일 출처.
//
// 이름이 정해진 세 유형은 **색을 고정**한다(2026-11-23 점주 요청):
//   부서 = 파랑 · 기업 = 빨강 · 개인 = 회색
// 전엔 "건수 많은 유형부터" 팔레트를 돌려서, 부서가 제일 많으면 부서가 빨강이
// 됐다. 색이 뜻을 갖지 못하고 구성이 바뀔 때마다 통째로 흔들렸다.
// 점주가 직접 만든 유형만 남은 팔레트를 건수 순으로 받는다.

export const TYPE_COLORS = ['#FF676F', '#3374FF', '#ADADAD', '#F5A623', '#7ED321', '#9B59B6']

/** 이름이 정해진 유형의 고정 색 */
export const FIXED_TYPE_COLORS: Record<string, string> = {
  부서: '#3374FF',
  기업: '#FF676F',
  개인: '#8E8681',
}

export function makeTypeColorOf(customerTypes: string[], counts: Record<string, number>) {
  // 고정 색을 쓰는 유형은 팔레트 배정에서 빼둔다 — 안 그러면 그 유형이 가져간
  // 자리만큼 나머지 색이 밀려서, 유형을 하나 추가할 때마다 남의 색이 바뀐다.
  const rest = customerTypes
    .filter(t => !(t in FIXED_TYPE_COLORS))
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))
  return (type: string) => {
    const fixed = FIXED_TYPE_COLORS[type]
    if (fixed) return fixed
    const i = rest.indexOf(type)
    return TYPE_COLORS[(i < 0 ? 0 : i) % TYPE_COLORS.length]
  }
}

/**
 * 배지용 — 글자는 진하게, 배경은 같은 색을 12% 투명도로.
 *
 * '개인'만 예외다: 회색 배경에 **어두운 차콜 글자**(요청). 회색을 12% 로 깔면
 * 배경이 거의 흰색이라 배지로 안 보인다.
 */
export function typeBadgeStyle(color: string, type?: string) {
  if (type === '개인') return { color: '#2C261F', backgroundColor: '#DEDAD6' }
  return { color, backgroundColor: `${color}1F` }
}
