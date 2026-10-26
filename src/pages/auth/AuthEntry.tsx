import HeroCarousel from '../../components/auth/HeroCarousel'
import PrimaryButton from '../../components/auth/PrimaryButton'
import Wordmark from '../../components/ui/Wordmark'

interface AuthEntryProps {
  onStart: () => void
  onLogin: () => void
}

/**
 * 최초 진입 화면 — **세로 1열**.
 *
 * 전엔 왼쪽 5(히어로 사진) : 오른쪽 3(로고+카피+CTA) 분할이었다. 토스포스 첫 화면과
 * 비율까지 거의 같아서 나란히 놓으면 구분이 안 됐다. 회원가입 스텝(AuthShell)을
 * 세로로 바꾸면서 이 화면도 같은 언어로 맞춘다 — 들어오는 첫 화면과 그 다음 화면이
 * 다른 문법이면 한 제품처럼 안 읽힌다.
 *
 * 히어로 사진은 버리지 않고 라운드 카드에 담는다. 꽉 찬 분할이 아니라 '얹힌 카드'가
 * 되면서 화면 주인이 사진에서 카피로 넘어온다.
 */
export default function AuthEntry({ onStart, onLogin }: AuthEntryProps) {
  return (
    <div className="h-full w-full overflow-y-auto bg-white">
      <div className="min-h-full flex flex-col items-center justify-center px-8 py-10">
        <div className="w-full max-w-[520px] flex flex-col items-center">
          {/* 히어로 — 16:9 라운드 카드 */}
          <div className="w-full rounded-[18px] overflow-hidden" style={{ aspectRatio: '16 / 9' }}>
            <HeroCarousel />
          </div>

          <Wordmark size={48} className="mt-[28px] mb-[6px]" />

          {/* 자간을 벌려 둔다. 26px Light 한글 세 줄은 기본 자간이면 글자가 서로
              붙어 덩어리로 읽힌다. 첫 화면 카피는 읽히는 속도보다 숨 쉬는 게 낫다. */}
          <h1 className="text-center leading-[1.35] mb-8" style={{ letterSpacing: '0.05em' }}>
            <span className="block text-[26px]" style={{ fontWeight: 300, color: 'var(--ink)' }}>주문할 때도</span>
            <span className="block text-[26px]" style={{ fontWeight: 300, color: 'var(--ink)' }}>주문받을 때도</span>
            <span className="block text-[26px]" style={{ fontWeight: 500, color: 'var(--ink)' }}>훨씬 편한 선결제!</span>
          </h1>

          {/* 히어로 카드(520px) 폭을 꽉 채우면 버튼이 화면의 주인이 된다.
              첫 화면의 주인은 카피이고 버튼은 그 다음이라 폭을 줄여 둔다. */}
          <PrimaryButton onClick={onStart} className="w-[260px]">
            시작하기
          </PrimaryButton>

          <button
            onClick={onLogin}
            className="mt-6 text-[13px] transition-colors"
            style={{ fontWeight: 300, color: 'var(--gray-text)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--ink)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--gray-text)' }}
          >
            전화번호로 로그인 &gt;
          </button>
        </div>
      </div>
    </div>
  )
}
