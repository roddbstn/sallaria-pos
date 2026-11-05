import { useState } from 'react'

// 복사 버튼 — 아이콘만. 전엔 [복사] 글자 배지라 옆의 전화번호·주소와 글자끼리 경쟁했다.
// 복사 직후 1.5초간 체크로 바뀌어 "눌렸다"를 알린다(토스트 없이).
export default function CopyButton({ text, variant = 'gray' }: { text: string; variant?: 'gray' | 'black' }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  // gray = 어두운 헤더 위, black = 밝은 회색 박스 위
  const color = copied ? '#00C45A' : variant === 'black' ? '#414141' : '#D9D9D9'
  return (
    <button
      onClick={handleCopy}
      aria-label={copied ? '복사됨' : '복사'}
      title={copied ? '복사됨' : '복사'}
      className="ml-[5px] p-[2px] rounded-[4px] hover:opacity-60 transition-opacity flex-shrink-0"
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3.5 8.5L6.5 11.5L12.5 4.5" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="5.4" y="5.4" width="8.1" height="8.1" rx="1.8" stroke={color} strokeWidth="1.4" />
          <path d="M10.6 5.4V4.2A1.8 1.8 0 0 0 8.8 2.4H4.2A1.8 1.8 0 0 0 2.4 4.2v4.6a1.8 1.8 0 0 0 1.8 1.8h1.2"
                stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
