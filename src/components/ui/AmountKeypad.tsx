// 금액 입력 키패드 — 선결제 충전처럼 '금액이 주인공'인 화면용.
//
// 왜 키패드인가: 선결제 충전은 보통 20~50만 원이라 0 을 다섯 개씩 친다.
// 숫자 키보드로 치면 자릿수를 세게 되고, 0 을 하나 더/덜 치는 실수가 바로 돈 사고다.
// 금융앱들이 00 키를 두는 이유도 같다.
//
// 빠른 금액(+1만/+5만/+10만)을 위에 둔 건 **누적**이기 때문이다. 교체가 아니라
// 더하기라 "+10만 세 번 = 30만" 처럼 실제 충전 단위를 그대로 따라갈 수 있다.
//
// 지우기는 ⌫ 하나뿐이다. '전체 지우기'를 따로 뒀더니 지우는 버튼이 둘이 되어
// 어느 쪽이 한 자리이고 어느 쪽이 전부인지 눌러보기 전엔 알 수 없었다.

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', 'back'] as const
const QUICK = [10_000, 50_000, 100_000] as const

/** 금액 상한 — 1,000만 원. 넘는 입력은 받지 않는다(0 하나 더 누른 사고 방지) */
const MAX_AMOUNT = 10_000_000

export default function AmountKeypad({ value, onChange }: {
  /** 숫자만 담긴 문자열. 빈 문자열이면 미입력 */
  value: string
  onChange: (next: string) => void
}) {
  const num = parseInt(value || '0', 10)

  function press(k: (typeof KEYS)[number]) {
    if (k === 'back') { onChange(value.slice(0, -1)); return }
    // 앞자리 0 이 쌓이지 않게 — '0' 상태에서 숫자를 누르면 그 숫자로 바뀐다
    const next = (value === '0' || value === '') && k !== '00' ? k : value + k
    const cleaned = next.replace(/^0+(?=\d)/, '')
    if (parseInt(cleaned || '0', 10) > MAX_AMOUNT) return
    onChange(cleaned)
  }

  function addQuick(amount: number) {
    const next = Math.min(num + amount, MAX_AMOUNT)
    onChange(String(next))
  }

  return (
    <div>
      <div className="flex gap-[6px] mb-[10px]">
        {QUICK.map(q => (
          <button
            key={q} type="button" onClick={() => addQuick(q)}
            className="pressable flex-1 h-[36px] rounded-[9px] bg-[#F2F2F2] text-[#6A635E] text-[13px] font-semibold hover:bg-[#E8E4E2] transition-colors"
          >
            +{(q / 10_000).toLocaleString('ko-KR')}만
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-[6px]">
        {KEYS.map(k => (
          <button
            key={k} type="button" onClick={() => press(k)}
            aria-label={k === 'back' ? '한 자리 지우기' : k}
            className="pressable h-[52px] rounded-[11px] bg-[#F2F2F2] text-[#1E1E1E] text-[19px] font-semibold hover:bg-[#E8E4E2] transition-colors flex items-center justify-center"
          >
            {k === 'back' ? (
              <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
                <path d="M7 1.5H19a1.5 1.5 0 011.5 1.5v10A1.5 1.5 0 0119 14.5H7L1.5 8 7 1.5z"
                      stroke="#6A635E" strokeWidth="1.6" strokeLinejoin="round"/>
                <path d="M10.5 5.5l5 5M15.5 5.5l-5 5" stroke="#6A635E" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            ) : k}
          </button>
        ))}
      </div>
    </div>
  )
}
