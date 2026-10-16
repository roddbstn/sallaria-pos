import logoCropped from '../../assets/logo-cropped.png'
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
 * 회원가입 스텝 공용 셸 — 전체 흰 배경, 왼쪽엔 로고+제목, 오른쪽엔 실제 인터랙션.
 * 토스플레이스 휴대폰인증 화면 참고.
 */
export default function AuthShell({ title, subtitle, onBack, topAlign, children }: AuthShellProps) {
  return (
    <div className="relative h-full w-full bg-white flex overflow-hidden">
      {onBack && (
        <div className="absolute" style={{ top: 40, left: 40 }}>
          <BackButton onClick={onBack} />
        </div>
      )}

      {/* 왼쪽 — 로고 + 제목 */}
      <div className="flex-1 flex flex-col items-start justify-start" style={{ paddingTop: 172, paddingLeft: 96, paddingRight: 56 }}>
        <img src={logoCropped} alt="sunpos" className="h-[44px] object-contain" style={{ marginBottom: 22 }} />
        {title && (
          <h1 className="text-left leading-[1.3] text-[32px] font-normal whitespace-pre-line" style={{ color: 'var(--ink)' }}>
            {title}
          </h1>
        )}
        {subtitle && (
          <p className="text-left text-[14px] mt-3" style={{ color: 'var(--gray-text)' }}>
            {subtitle}
          </p>
        )}
      </div>

      {/* 오른쪽 — 실제 인터랙션. 전체 묶음을 20px 위로 올림(top은 paddingTop, center는 translateY) */}
      <div
        className={`flex-1 flex flex-col px-16 ${topAlign ? 'justify-start' : 'justify-center'}`}
        style={topAlign ? { paddingTop: 152 } : undefined}
      >
        <div className="w-full max-w-[380px]" style={topAlign ? undefined : { transform: 'translateY(-20px)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
