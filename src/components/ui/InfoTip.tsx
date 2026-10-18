import { useEffect, useRef, useState } from 'react'

// 지표 이름 옆의 작은 'i' — 누르면 말풍선으로 정의를 보여준다.
//
// 왜 이렇게 바꿨나: 전에는 단골의 정의가 화면 아래 회색 두 줄로 상시 떠 있었다.
// 그런데 그 설명이 필요한 사람은 처음 한 번뿐이고, 그 뒤로는 숫자를 가리는 잡음이 된다.
// 반대로 title 속성(마우스 올리면 뜨는 회색 툴팁)은 터치 POS 에서 아예 안 뜬다.
// 그래서 '눌러서 여는' 말풍선으로 간다 — 손가락으로도 열리고, 평소엔 숨어 있다.

export default function InfoTip({ text, label = '설명 보기' }: {
  /** 말풍선에 넣을 문장. 줄바꿈은 \n 으로 */
  text:   string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement | null>(null)

  // 바깥을 누르면 닫는다 — 열어둔 채 다른 걸 누르면 말풍선이 따라다니는 것처럼 보인다
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={wrapRef} className="relative inline-flex items-center align-middle">
      <button
        type="button"
        aria-label={label}
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        className={`w-[14px] h-[14px] rounded-full flex items-center justify-center text-[10px] font-semibold leading-none transition-colors ${
          open ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#E2E2E2] text-[#787878] hover:bg-[#D4D4D4]'
        }`}
      >
        i
      </button>

      {open && (
        <span
          role="tooltip"
          // 말풍선은 버튼 아래에 띄운다. 지표 칸이 그리드 맨 윗줄에도 오기 때문에
          // 위로 띄우면 헤더에 잘린다.
          className="absolute left-1/2 -translate-x-1/2 top-[20px] z-[70] w-[228px] rounded-[10px] bg-[#2C261F] text-[#F9F9F9] text-[11.5px] font-normal leading-[1.6] px-[12px] py-[9px] shadow-[0_2px_10px_rgba(0,0,0,0.18)] whitespace-pre-line text-left"
        >
          {/* 꼬리 — 버튼을 가리키게 해서 어느 지표의 설명인지 분명히 한다 */}
          <span className="absolute left-1/2 -translate-x-1/2 -top-[4px] w-[8px] h-[8px] rotate-45 bg-[#2C261F]" />
          {text}
        </span>
      )}
    </span>
  )
}
