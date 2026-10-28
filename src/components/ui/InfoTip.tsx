import { useState } from 'react'
import { rootZoom } from '../../lib/figma-scale'

// 지표 이름 옆의 작은 'i' — 마우스를 올리면 말풍선이 뜬다.
//
// 디자인·동작은 고객 화면 표의 '추이' i 와 **똑같이** 맞췄다(Customers.tsx).
// 흰 카드 + 그림자, 요소 위쪽에 가운데 정렬, 호버로 열고 떠날 때 닫힌다.
// 같은 뜻의 장치가 화면마다 다르게 생기면 점주가 매번 다시 배워야 한다.
//
// fixed 로 띄우는 이유: 지표 칸이 overflow 가 걸린 그리드 안에 있어서
// absolute 로 두면 잘린다. 표 밖에서 그리고 좌표만 받아온다.
// rootZoom() 으로 나누는 것도 같은 이유 — 앱 전체에 zoom 이 걸려 있어
// getBoundingClientRect() 값과 fixed 좌표계의 단위가 다르다.

export default function InfoTip({ text, label = '설명 보기' }: {
  /** 말풍선에 넣을 문장. \n 으로 줄을 나눈다 */
  text:   string
  label?: string
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)

  return (
    <>
      <span
        role="img"
        aria-label={label}
        className="w-[13px] h-[13px] rounded-full bg-[#E8E4E2] text-[#787878] text-[9px] flex items-center justify-center cursor-default flex-shrink-0"
        onMouseEnter={e => {
          const r = e.currentTarget.getBoundingClientRect()
          setAt({ x: r.left + r.width / 2, y: r.top })
        }}
        onMouseLeave={() => setAt(null)}
      >
        i
      </span>

      {at && (
        <div
          className="fixed z-[75] pointer-events-none bg-[#FCFCFC] rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] px-[8px] py-[8px] -translate-x-1/2"
          style={{
            left:   at.x / rootZoom(),
            bottom: (window.innerHeight - at.y) / rootZoom() + 6,
          }}
        >
          {/* max-w 가 없으면 한 줄짜리 긴 문장이 들어왔을 때 말풍선이 그만큼
              옆으로 늘어나 화면 밖으로 나간다. \n 이 없어도 알아서 접히게 둔다. */}
          <span className="block max-w-[240px] text-[12px] font-semibold text-ink text-center leading-[1.35] whitespace-pre-line break-keep">
            {text}
          </span>
        </div>
      )}
    </>
  )
}
