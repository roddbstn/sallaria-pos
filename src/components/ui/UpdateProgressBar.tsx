// 새 버전을 내려받는 동안 **계속 떠 있는** 표시.
//
// 전엔 '새 버전 다운로드 중…' 토스트가 3초 뜨고 사라졌다. 설치파일이 200MB 가
// 넘어서 매장 인터넷에 따라 몇 분이 걸리는데, 그 3초가 지나면 받고 있는지 멈춘
// 건지 알 길이 없었다. 끝나는 것도 안 보였다.
//
// 자리: 화면 **맨 아래 오른쪽**. 토스트(가운데)와 겹치지 않고, 주문이 들어오는
// 자리(왼쪽 목록)도 가리지 않는다. 주문을 받는 중에 떠 있어도 일을 막지 않아야 한다.
// 진행 중에는 닫을 수 없다 — 닫아 봐야 받는 게 멈추지 않고, 다시 열 방법도 없다.

/** 바이트를 사람 말로. 200MB 짜리라 소수점 한 자리면 변하는 게 보인다 */
function mb(n: number): string {
  return `${(n / 1024 / 1024).toFixed(1)}MB`
}

export default function UpdateProgressBar({ percent, transferred, total, bytesPerSecond }: {
  percent: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
}) {
  // 남은 시간 — 속도가 0 이거나 모르면 적지 않는다. 틀린 수를 적느니 비운다
  const leftSec = bytesPerSecond && total && transferred && bytesPerSecond > 0
    ? Math.round((total - transferred) / bytesPerSecond)
    : null

  return (
    <div className="fixed bottom-[18px] right-[18px] z-[80] w-[268px] rounded-[12px] bg-[#2C261F] shadow-[0_6px_20px_rgba(0,0,0,0.22)] px-[15px] py-[12px]">
      <div className="flex items-baseline justify-between gap-[8px] mb-[8px]">
        <span className="text-[14px] font-medium text-white whitespace-nowrap">새 버전 받는 중</span>
        <span className="text-[14px] font-semibold text-white tabular-nums">{percent}%</span>
      </div>

      {/* 막대 — 받은 만큼만 찬다. transition 으로 칸이 튀지 않게 */}
      <div className="h-[5px] rounded-full bg-white/20 overflow-hidden">
        <div
          className="h-full rounded-full bg-[#02a84e] transition-[width] duration-300 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>

      {/* 아래 줄 — 받은 양과 남은 시간. 둘 다 모르면 줄 자체를 비운다 */}
      {(total || leftSec != null) && (
        <div className="mt-[7px] flex items-center justify-between text-[12px] text-white/55 tabular-nums">
          <span>{total && transferred ? `${mb(transferred)} / ${mb(total)}` : ''}</span>
          <span>
            {leftSec == null ? ''
              : leftSec < 60 ? `${leftSec}초 남음`
              : `${Math.ceil(leftSec / 60)}분 남음`}
          </span>
        </div>
      )}

      {/* 다 받아도 지금 당장 바뀌는 건 없다는 걸 말해 둔다 — 안 적으면
          "100% 인데 왜 그대로지"가 된다 */}
      <div className="mt-[6px] text-[12px] text-white/45 leading-snug">
        다 받으면 앱을 끌 때 설치돼요. 하던 일은 그대로 하셔도 돼요.
      </div>
    </div>
  )
}
