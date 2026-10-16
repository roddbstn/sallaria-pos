import type { ReactNode } from 'react'

// 전체메뉴(햄버거 드로어) 화면 공용 셸 — Figma node 664:541(매장 정보) · 532:3003(고객) 등
// 매출·주문 / 상품 / 고객 / 설정 4개 그룹의 13개 화면이 전부 이 구조를 쓴다.
// 좌측 네비(227px, #6A635E) + 본문 패널. 셸은 상태를 갖지 않고 호출부가 활성 탭을 관리한다.

export interface HubNavItem<K extends string> {
  key:   K
  label: string
}

interface HubLayoutProps<K extends string> {
  /** 네비 상단 그룹명 — "매장 정보" | "고객" | "설정" … */
  title:     string
  items:     HubNavItem<K>[]
  activeKey: K
  onChange:  (key: K) => void
  onBack:    () => void
  children:  ReactNode
  /**
   * 본문 여백·스크롤을 셸이 책임지지 않는 모드.
   * 매출·주문처럼 이미 완성된 전체 화면(h-full·자체 스크롤)을 그대로 끼울 때 쓴다 —
   * 기본 모드의 px-64/pt-64 + overflow-y-auto 를 그대로 두면 안쪽 페이지가 높이를
   * 못 잡아 스크롤이 두 겹으로 생긴다.
   */
  bare?: boolean
}

export default function HubLayout<K extends string>({
  title, items, activeKey, onChange, onBack, children, bare = false,
}: HubLayoutProps<K>) {
  return (
    <div className="h-full flex bg-[#F9F9F9] overflow-hidden">
      {/* ── 좌측 네비 (Figma: w 353 · px 40 · py 57 · 제목 40/600 · 항목 32/600, pitch 98) ── */}
      <div className="w-[227px] flex-shrink-0 bg-[#6A635E] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] px-[26px] py-[37px] flex flex-col overflow-y-auto">
        <div className="text-[24px] font-medium leading-[29px] text-[#FCFCFC] mb-[72px]">{title}</div>
        <div className="flex flex-col gap-[27px]">
          {items.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onChange(key)}
              // py로 세로 터치 영역 확보 — POS는 터치 기기에서도 쓰인다
              // 소제목 = 대제목(24px) − 8px. 굵기는 semibold에서 2단계 내려 normal
              className={`text-left text-[17px] font-normal leading-[20px] py-[6px] transition-colors ${
                activeKey === key ? 'text-[#FFEFEF]' : 'text-[#C1B7AA] hover:text-[#FFEFEF]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Figma에는 없는 버튼. 상단 전역 헤더(주문/메뉴/고객 탭)로도 나갈 수 있지만, 허브에
            들어온 경로가 햄버거 드로어라 돌아갈 길을 하나는 남겨둔다. 본문 상단 좌표를
            Figma와 맞추려고 네비 맨 아래로 내렸다. */}
        <button onClick={onBack} className="mt-auto pt-[30px] text-[13px] text-[#C1B7AA] hover:text-[#FFEFEF] flex items-center gap-1 self-start transition-colors">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M10 3.5L5.5 8L10 12.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          뒤로
        </button>
      </div>

      {/* ── 본문 (Figma: left 453 → 좌측 네비 353 + 100 = px 64, top 150 → pt 96) ── */}
      <div className={bare
        ? 'flex-1 min-w-0 overflow-hidden'
        : 'flex-1 min-w-0 overflow-y-auto px-[64px] pt-[64px] pb-[62px]'}>
        {children}
      </div>
    </div>
  )
}

/** 본문 섹션 제목 — 우측에 액션(버튼 등)을 둘 수 있다 */
export function HubSection({ title, action, children }: { title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-[26px]">
        <div className="text-[18px] font-semibold text-[#1E1E1E]">{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

/** 화면기획 확정 전 빈 영역 — 어떤 내용이 들어올 자리인지만 알려준다 */
export function HubPlaceholder({ note }: { note: string }) {
  return (
    <div className="border border-dashed border-[#D9D2C8] rounded-[13px] py-[46px] text-center text-[13px] font-normal text-[#ADADAD]">
      {note}
    </div>
  )
}
