// 진행 중 문구 — '저장 중' 뒤에 점 세 개가 차례로 튄다.
//
// 왜 컴포넌트인가: 같은 표현이 앱 전체 서른 곳 넘게 있었는데 전부
// '저장 중...' 처럼 **글자로 박힌 마침표**였다. 글자는 멈춰 있어서
// 누른 사람 입장에선 "눌린 건가, 멈춘 건가"가 구분되지 않는다.
// 특히 프린터·네트워크를 기다리는 자리는 몇 초씩 걸려서 더 그렇다.
//
// 버튼 안에는 스피너를 넣을 자리가 없다(세로가 글자 높이뿐이다).
// 점이 튀면 같은 말을 자리를 더 쓰지 않고 할 수 있다.
//
// 움직임을 줄여달라고 한 사용자에게는 index.css 의 prefers-reduced-motion
// 규칙이 애니메이션을 끈다 — 그때는 점 세 개가 그냥 떠 있다.

export default function Working({ label, rev = false }: {
  /** '저장 중' 처럼 **마침표 없이** 넘긴다 — 점은 이 컴포넌트가 붙인다 */
  label: string
  /** 점이 뒤에서 앞으로 튄다. 짧게 기다리는 자리(저장 등)에 쓴다 */
  rev?: boolean
}) {
  return (
    <>
      {label}
      <span className={`${rev ? 'dot-bounce-rev' : 'dot-bounce'} ml-[1px]`}>
        <span>.</span><span>.</span><span>.</span>
      </span>
    </>
  )
}
