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
    <div
      className="sticky top-0 z-10 bg-[#D7D2CE] border-b border-[#C1B7AA] flex items-center text-[#6A635E] font-medium"
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
