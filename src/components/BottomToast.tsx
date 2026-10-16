import { useEffect, useState } from 'react'

// 하단 중앙 토스트 — Figma node 491:713(모드 전환) / 491:949(순서편집 안내) 공용 스타일.
// 등장 시 0에서 확 커졌다가(오버슈트) 살짝 줄어들며 정착(.toast-pop, src/index.css) + 사라질 때 fade out.
export default function BottomToast({ message }: { message: string | null }) {
  const [shown,   setShown]   = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const [animKey, setAnimKey] = useState(0)

  useEffect(() => {
    if (message) {
      setShown(message)
      setAnimKey(k => k + 1) // 같은 메시지가 연속으로 떠도 pop 애니메이션이 다시 재생되도록
      const raf = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(raf)
    } else {
      setVisible(false)
      const t = setTimeout(() => setShown(null), 300)
      return () => clearTimeout(t)
    }
  }, [message])

  if (!shown) return null

  return (
    <div
      className="absolute pointer-events-none z-10"
      style={{
        left: '50%',
        bottom: 50,
        transform: 'translateX(-50%)',
        opacity: visible ? 1 : 0,
        transition: visible ? undefined : 'opacity 300ms ease-in',
      }}
    >
      <div
        key={animKey}
        className={`relative bg-[#414141] rounded-[10px] px-[26px] py-[13px] whitespace-nowrap ${visible ? 'toast-pop' : ''}`}
        style={{ transformOrigin: 'center', transform: visible ? undefined : 'scale(1)' }}
      >
        <p className="text-[21px] font-normal text-[#FCFCFC]">{shown}</p>
      </div>
    </div>
  )
}
