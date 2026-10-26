import Wordmark from '../ui/Wordmark'
import BackButton from './BackButton'

interface AuthShellProps {
  /** 없으면 왼쪽에 로고만 보이고 제목/부제는 안 그림 — 플레이스홀더와 내용이 겹치는 화면용 */
  title?: string        // 줄바꿈은 '\n'으로
  subtitle?: string
  /** undefined면 "이전" 버튼 자체를 숨김 — 갈 곳 없는 화면에서 씀 */
  onBack?: () => void
  /** true면 오른쪽 콘텐츠를 세로중앙 대신 왼쪽 로고와 같은 top 위치에 맞춤 */
  topAlign?: boolean
  children: React.ReactNode
}

/**
 * 회원가입 스텝 공용 셸 — 전체 흰 배경, **세로 1열**.
 *
 * 전엔 좌우 2분할이었다(왼쪽 로고+제목 / 오른쪽 입력). 토스플레이스 휴대폰인증 화면을
 * 참고해 만든 구조인데, 그 배치 자체가 토스의 서명이라 나란히 놓으면 바로 티가 났다.
 * 로고 → 제목 → 부제 → 입력 이 위에서 아래로 한 줄기로 흐르도록 바꿨다.
 *
 * 세로가 실용적으로도 낫다: 설치 기사가 태블릿을 세워 쓰는 경우가 있고, 시선이
 * 좌우로 건너뛰지 않아 "다음에 뭘 해야 하는지"가 한 방향으로 읽힌다.
 *
 * topAlign 은 내용이 긴 스텝(요금제·프린터)에서 위로 붙이는 용도로 그대로 남긴다.
 */
export default function AuthShell({ title, subtitle, onBack, topAlign, children }: AuthShellProps) {
  return (
    <div className="relative h-full w-full bg-white overflow-y-auto">
      {onBack && (
        <div className="absolute z-10" style={{ top: 40, left: 40 }}>
          <BackButton onClick={onBack} />
        </div>
      )}

      <div
        className={`min-h-full flex flex-col items-center px-8 ${topAlign ? 'justify-start' : 'justify-center'}`}
        style={topAlign ? { paddingTop: 120, paddingBottom: 64 } : { paddingTop: 64, paddingBottom: 64 }}
      >
        <div className="w-full max-w-[440px] flex flex-col items-center">
          <Wordmark size={34} className="mb-[26px]" />

          {title && (
            <h1 className="text-center leading-[1.35] text-[30px] font-normal whitespace-pre-line" style={{ color: 'var(--ink)' }}>
              {title}
            </h1>
          )}
          {subtitle && (
            <p className="text-center text-[14px] mt-3" style={{ color: 'var(--gray-text)' }}>
              {subtitle}
            </p>
          )}

          {/* 제목이 없는 스텝(플레이스홀더가 곧 제목)은 로고 바로 아래에서 시작한다 */}
          <div className="w-full" style={{ marginTop: title ? 40 : 28 }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
