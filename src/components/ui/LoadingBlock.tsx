import LoadingTimer from './LoadingTimer'

// 화면·패널이 비어 있는 동안 자리를 지키는 블록.
//
// 전에는 '불러오는 중…' 글자 한 줄이었다. 글자는 멈춰 있어서 **멈춘 건지 도는 건지**
// 알 수 없고, 그 상태로 2~3초가 지나면 점주는 고장으로 읽는다
// (실제로 왕복이 10번 중 2번은 1초를 넘는다 — docs 의 속도 측정 참고).
//
// 그래서 QR웹과 같은 타이머를 쓴다. 손님이 주문하며 보던 그 모양을 점주도 본다.
// 글자는 뺐다 — 움직이는 그림이 이미 "기다리는 중"을 말하고, 글자를 같이 두면
// 읽을거리가 하나 더 생긴다.

export default function LoadingBlock({ py = 56, size = 38 }: {
  /** 위아래 여백(px). 좁은 패널에서는 줄여 쓴다 */
  py?:   number
  size?: number
}) {
  return (
    <div className="flex items-center justify-center" style={{ paddingTop: py, paddingBottom: py }}>
      <LoadingTimer size={size} />
    </div>
  )
}
