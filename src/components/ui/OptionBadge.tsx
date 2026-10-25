import type { ReactNode } from 'react'

// 옵션 그룹 배지 — Figma 491:3728(진한) · 491:3726(연한).
//
// Figma 원본은 px-12 py-8 r-25 / 18px semibold 인데, 이 프로젝트는 2240px 캔버스를
// FIGMA_SCALE(0.643)로 줄여 고정 px 로 박는다(src/lib/figma-scale.ts). 곱하면
// px-8 py-5 r-16 / 12px — 지금 쓰던 배지와 같은 값이라 크기가 튀지 않는다.
//
// solid 는 "지켜야 하는 것"(필수·고를 수 있는 개수), soft 는 "안 해도 되는 것"(선택).
export default function OptionBadge({ tone, children }: {
  tone: 'solid' | 'soft'
  children: ReactNode
}) {
  return (
    <span
      className={`flex-shrink-0 inline-flex items-center justify-center whitespace-nowrap px-[8px] py-[5px] rounded-[16px] text-[12px] font-semibold ${
        tone === 'solid' ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878]'
      }`}
    >
      {children}
    </span>
  )
}
