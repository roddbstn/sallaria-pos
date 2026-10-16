// 거래처 유형 색 — 표의 유형 배지와 우측 도넛이 같은 색을 쓰게 하는 단일 출처.
//
// 색은 유형 이름에 고정되지 않는다. "건수가 많은 유형부터" 팔레트를 배정해서,
// 도넛의 가장 큰 조각과 표의 가장 흔한 배지가 같은 색이 되게 맞춘다.
// 그래서 순수 함수가 아니라 "집계를 받아 함수를 만들어 주는" 형태다.

export const TYPE_COLORS = ['#FF676F', '#3374FF', '#ADADAD', '#F5A623', '#7ED321', '#9B59B6']

export function makeTypeColorOf(customerTypes: string[], counts: Record<string, number>) {
  const order = [...customerTypes].sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))
  return (type: string) => {
    const i = order.indexOf(type)
    return TYPE_COLORS[(i < 0 ? 0 : i) % TYPE_COLORS.length]
  }
}

/** 배지용 — 글자는 진하게, 배경은 같은 색을 12% 투명도로 */
export function typeBadgeStyle(color: string) {
  return { color, backgroundColor: `${color}1F` }
}
