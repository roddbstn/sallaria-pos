import type { ReactNode } from 'react'

// 목록 표의 공통 뼈대.
//
// 왜 만들었나: 같은 "거래처 목록"을 두 화면이 각자 다른 토큰으로 그리고 있었다.
//   고객 화면(Customers.tsx) 헤더 #D7D2CE / 행 46px·17px / 구분선 #E5E5E5 / 호버 white/40
//   계정 관리(CustomerHub.tsx) 헤더 #E8E4E2 / 행 44px·13px / 구분선 #F2F2F2 / 호버 #F9F9F9
// 숫자만 조금씩 다른 게 아니라 색 계열 자체가 달라서, 두 화면을 오가면 다른 제품처럼 보였다.
//
// 다만 "하나로 합친다"가 답은 아니다. 두 표는 하는 일이 다르다:
//   - 고객 화면: 피크타임에 손가락으로 누르는 작업 표면 → 행이 크고 글자가 커야 한다
//   - 계정 관리: 27곳을 훑고 비교하는 관리 표 → 칼럼이 많고 촘촘해야 한다
// 그래서 색·테두리·호버 같은 "언어"는 통일하고, 밀도만 density 로 갈라 둔다.

export type TableDensity = 'comfortable' | 'compact'

const DENSITY = {
  comfortable: { head: 43, row: 46, headText: 15, rowText: 17, padX: 15 },
  compact:     { head: 40, row: 44, headText: 13, rowText: 13, padX: 15 },
} as const

/**
 * 표 전체를 감싸는 모서리.
 *
 * ⚠️ overflow-hidden 을 걸면 안 된다 — 머리글의 position: sticky 가 죽는다.
 *    (sticky 는 가장 가까운 스크롤 조상 안에서 동작하는데, overflow:hidden 인 조상이
 *     그 역할을 가로채면서 "스크롤이 없는 컨테이너"가 돼 붙을 데가 사라진다.)
 *    모서리를 자르는 일은 바깥 스크롤 컨테이너가 rounded 로 맡는다.
 */
export function DataTable({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[11px] ${className}`}>
      {children}
    </div>
  )
}

/**
 * 표 머리글의 공통 '언어' — 색·바탕·줄바꿈 금지.
 *
 * DataTableHead 를 안 쓰고 손으로 그린 머리글이 세 군데 있다(고객 · 주문 분석 ·
 * 매출). 높이·여백·글자 크기가 화면마다 달라서 컴포넌트로는 못 묶었는데,
 * **whitespace-nowrap 만은 빠지면 안 된다.** 그게 빠진 채 칸이 0 이 되면
 * 머리글 글자가 한 자씩 세로로 서면서 표 위아래로 삐져나온다
 * (2026-11-08 고객 화면 '계정 이름'). 그 한 줄을 여기서 나눠 쓴다.
 *
 * 글자 굵기·크기는 **안 넣는다.** 화면마다 다른데, 같은 속성을 두 번 주면
 * 어느 쪽이 이길지가 클래스를 적은 순서가 아니라 Tailwind 가 CSS 를 뽑는 순서로
 * 정해진다 — 눈으로 못 잡는 종류의 사고다.
 */
export const TABLE_HEAD_BASE =
  'flex items-center bg-[#D7D2CE] text-[#6A635E] whitespace-nowrap'

/**
 * 가로로 넘치면 **스크롤하는** 표 껍데기.
 *
 * 왜 필요한가: 칼럼이 많은 표는 좁은 창에서 들어갈 자리가 없다. 그런데 flex 는
 * 자리가 없으면 소리 없이 쥐어짠다 — flex-1 칸은 0 이 되고, 줄바꿈이 허용돼
 * 있으면 글자가 한 자씩 세로로 선다. 2026-11-07~08 에 주문 내역·메뉴·고객·매출
 * 네 화면에서 차례로 터진 게 전부 이 모양이었다.
 *
 * 칼럼을 더 못 줄이겠으면 **스크롤바를 보여주는 게 낫다.** 칸을 뭉개면 값이
 * 사라지지만 스크롤은 적어도 거기 있다고 말해 준다.
 *
 * minW 는 '모든 칼럼이 제 폭을 가질 때의 합'이다. 고정 칼럼 합 + 좌우 여백 +
 * 유동 칼럼 최소폭으로 계산해서 넣는다. 머리글과 행이 **같은 래퍼 안에** 있어야
 * 가로로 같이 움직인다.
 */
export function TableScroll({ minW, className = '', children }: {
  minW: number
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <div style={{ minWidth: minW }}>{children}</div>
    </div>
  )
}

export function DataTableHead({
  density = 'compact', children,
}: {
  density?: TableDensity
  children: ReactNode
}) {
  const d = DENSITY[density]
  return (
    // 엑셀의 '첫 행 고정'과 같은 것 — 스크롤해도 어느 칸이 무슨 값인지 알 수 있어야 한다.
    // 스크롤 컨테이너가 바로 바깥에 있어야 붙는다(DataTable 주석 참고).
    //
    // whitespace-nowrap 은 **안전장치**다. 머리글 칼럼은 보통
    // `flex-1 min-w-0` + 고정폭 형제들로 짜는데, 고정폭 합이 패널 폭을 넘으면
    // flex-1 이 0 이 된다. 그때 줄바꿈이 허용돼 있으면 '거래처 · 주문자' 가
    // 한 글자씩 세로로 쌓이면서 머리글 위아래로 삐져나온다(2026-11-08 주문 내역).
    // 칸이 모자라는 건 폭을 고쳐야 할 일이지만, 적어도 **글자가 세로로 서지는
    // 않아야** 어디가 좁은지 바로 보인다.
    <div
      className={`sticky top-0 z-10 border-b border-[#C1B7AA] font-medium ${TABLE_HEAD_BASE}`}
      style={{ height: d.head, fontSize: d.headText, paddingLeft: d.padX, paddingRight: d.padX }}
    >
      {children}
    </div>
  )
}

// 행 바탕은 --canvas-soft(#F9F9F9).
//
// #FCFCFC(거의 흰색)였다가 → #F2F2F2(중립 회색) → 지금 값으로 두 번 옮겼다.
//   · #FCFCFC: 흰 카드 위에서 표가 카드에 녹아 경계가 사라졌다
//   · #F2F2F2: 경계는 생겼는데 이 앱의 커피 계열 바탕 옆에서 회색이 탁하게 보였다
// --canvas-soft 는 바탕(#F2F2F2)에서 밝기만 올린 값이라, 흰 카드 위에서
// 한 단계 눌리면서도 화면 전체와 같은 계열로 읽힌다.
export function DataTableRow({
  density = 'compact', onClick, last = false, children,
}: {
  density?: TableDensity
  onClick?: () => void
  /** 마지막 행이면 아래 구분선을 그리지 않는다 */
  last?: boolean
  children: ReactNode
}) {
  const d = DENSITY[density]
  return (
    <div
      onClick={onClick}
      className={`flex items-center bg-canvas-soft text-ink transition-colors ${
        onClick ? 'pressable-row cursor-pointer hover:bg-white/40' : ''
      } ${last ? '' : 'border-b border-[#E5E5E5]'}`}
      style={{ height: d.row, fontSize: d.rowText, paddingLeft: d.padX, paddingRight: d.padX }}
    >
      {children}
    </div>
  )
}

/** 빈 상태 / 로딩 — 표 안에서 같은 높이로 */
export function DataTableNotice({ children }: { children: ReactNode }) {
  return (
    <div className="bg-canvas-soft py-[46px] text-center text-[13px] font-normal text-[#ADADAD]">
      {children}
    </div>
  )
}

/**
 * "등록대기" 같은 상태 태그.
 *
 * 전엔 bg-orange-50 / text-orange-600 / rounded-full / font-bold 로, 이 앱 어디에도 없는
 * Tailwind 기본 팔레트를 쓰고 있었다. 다른 배지(유형·주문상태)와 같은 규칙으로 맞춘다:
 * 같은 색을 글자에 진하게 · 배경에 12% 투명도로, radius 5, 11px medium.
 */
export function StatusTag({ label, color = '#FF8418' }: { label: string; color?: string }) {
  return (
    <span
      className="flex-shrink-0 px-[6px] h-[18px] leading-[18px] rounded-[5px] text-[11px] font-medium whitespace-nowrap"
      style={{ color, backgroundColor: `${color}1F` }}
    >
      {label}
    </span>
  )
}
