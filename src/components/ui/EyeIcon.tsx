// 가리기/보기 토글 아이콘 — Figma node 557:4672 (famicons:eye).
// Figma MCP가 주는 asset URL은 7일 뒤 만료돼서 그대로 쓰면 아이콘이 사라진다.
// 같은 모양의 path를 인라인 SVG로 넣어 외부 의존을 없앤다.
// 색은 Figma 지정값 #414141 고정.

export default function EyeIcon({ off = false, size = 16 }: { off?: boolean; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 512 512" fill="none"
      className="flex-shrink-0" aria-hidden="true"
    >
      {off ? (
        <>
          {/* 사선 — "가려진" 상태 */}
          <path d="M72 72L440 440" stroke="#414141" strokeWidth="38" strokeLinecap="round" />
          <path
            d="M255.66 112c-77.94 0-157.89 45.11-220.83 135.33a16 16 0 0 0-.27 17.77C82.92 340.8 161.8 400 255.66 400c92.84 0 173.34-59.38 221.79-135.25a16.14 16.14 0 0 0 0-17.47C429.19 172.28 349.86 112 255.66 112Z"
            stroke="#414141" strokeWidth="32" strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <path
            d="M255.66 112c-77.94 0-157.89 45.11-220.83 135.33a16 16 0 0 0-.27 17.77C82.92 340.8 161.8 400 255.66 400c92.84 0 173.34-59.38 221.79-135.25a16.14 16.14 0 0 0 0-17.47C429.19 172.28 349.86 112 255.66 112Z"
            stroke="#414141" strokeWidth="32" strokeLinejoin="round"
          />
          <circle cx="256" cy="256" r="80" stroke="#414141" strokeWidth="32" />
        </>
      )}
    </svg>
  )
}
