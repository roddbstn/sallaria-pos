// 로딩 표시 — 도는 원 대신 **흔들리는 타이머**.
//
// QR웹(salaria-prepaid/components/ui/loading-timer.tsx)과 같은 모양이다.
// 점주와 손님이 같은 '기다림'을 보도록 일부러 맞췄다.
//
// 원이 빙글빙글 도는 스피너는 어디서나 쓰는 모양이라 "뭔가 돌아간다"까지만 말한다.
// 이 화면들이 실제로 말해야 하는 건 "잠깐 기다리면 된다"이고, 그건 시계가 더 잘 말한다.
//
// 흔들림 하나만 쓰지 않고 둘로 나눴다:
//   · 몸통 — 좌우로 기울었다 돌아오며 점점 잦아든다(알람이 울리는 모양)
//   · 바늘 — 쉬지 않고 한 바퀴씩 돈다
// 몸통만 흔들면 "고장난 것"처럼 보이고, 바늘만 돌면 멈춘 것처럼 보인다. 둘이 같이 있어야
// "지금도 재고 있다"로 읽힌다.
//
// 색은 어두운 회색(#5A5A5A). 초록은 이 서비스에서 "선결제·확정"에 쓰는 색이라,
// 기다리는 동안 띄우면 뭔가 끝난 것처럼 보인다. 로딩은 조용한 색이어야 한다.

export default function LoadingTimer({ size = 44 }: { size?: number }) {
  return (
    <div className="timer-wobble" style={{ width: size, height: size }} role="status" aria-label="불러오는 중">
      <svg viewBox="0 0 48 48" width={size} height={size} fill="none">
        {/* 머리 꼭지 + 좌우 종 — 알람시계로 읽히게 하는 최소한의 단서 */}
        <path d="M20 5.5h8" stroke="#5A5A5A" strokeWidth="3" strokeLinecap="round" />
        <path d="M8.5 11.5 13 7.5M39.5 11.5 35 7.5" stroke="#5A5A5A" strokeWidth="3" strokeLinecap="round" />
        <circle cx="24" cy="28" r="15" stroke="#5A5A5A" strokeWidth="3" />
        {/* 바늘 — 시계 중심(24,28)을 축으로 돈다 */}
        <path
          className="timer-hand"
          d="M24 28V19"
          stroke="#5A5A5A"
          strokeWidth="3"
          strokeLinecap="round"
          style={{ transformOrigin: '24px 28px' }}
        />
        <circle cx="24" cy="28" r="2" fill="#5A5A5A" />
      </svg>
    </div>
  )
}
