import HeroCarousel from '../../components/auth/HeroCarousel'
import PrimaryButton from '../../components/auth/PrimaryButton'
import textLogo from '../../assets/text-logo.png'

interface AuthEntryProps {
  onStart: () => void
  onLogin: () => void
}

/** 최초 진입 화면 — 왼쪽 5 : 오른쪽 3 비율, 왼쪽은 히어로 사진 페이지네이션 */
export default function AuthEntry({ onStart, onLogin }: AuthEntryProps) {
  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* 왼쪽 5 — 히어로 사진 슬라이드쇼 */}
      <div style={{ flex: 5 }} className="h-full">
        <HeroCarousel />
      </div>

      {/* 오른쪽 3 — 메인 카피 + CTA */}
      <div style={{ flex: 3 }} className="h-full flex flex-col px-12 bg-white">
        {/* 로고+카피+버튼 묶음은 세로 중앙 정렬 — 20px 위로 올림 */}
        <div className="flex-1 flex flex-col items-start justify-center w-[350px] mx-auto" style={{ transform: 'translateY(-20px)' }}>
          <img src={textLogo} alt="sunpos" className="h-[80px] object-contain" style={{ marginBottom: 10 }} />

          <h1 className="text-left leading-[1.35] mb-10">
            <span className="block text-[28px]" style={{ fontWeight: 300, color: 'var(--ink)' }}>주문할 때도</span>
            <span className="block text-[28px]" style={{ fontWeight: 300, color: 'var(--ink)' }}>주문받을 때도</span>
            <span className="block text-[28px]" style={{ fontWeight: 500, color: 'var(--ink)' }}>훨씬 편한 선결제!</span>
          </h1>

          <PrimaryButton onClick={onStart} className="w-[350px]">
            시작하기
          </PrimaryButton>
        </div>

        {/* 로그인 링크는 패널 맨 아래 고정 */}
        <button
          onClick={onLogin}
          className="w-full text-center pb-10 text-[13px] transition-colors"
          style={{ fontWeight: 300, color: 'var(--gray-text)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--ink)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--gray-text)' }}
        >
          전화번호로 로그인 &gt;
        </button>
      </div>
    </div>
  )
}
