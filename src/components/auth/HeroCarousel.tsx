import { useEffect, useState } from 'react'
import hero1 from '../../assets/hero-1.png'
import hero3 from '../../assets/hero-3.png'

// sunpos-landing(sunpos-kr.vercel.app) 히어로 섹션과 동일한 전환 방식.
// 휴대폰이 나오는 컷 2장만 사용 (모니터 컷 2장 제외).
const SLIDES = [hero1, hero3]

export default function HeroCarousel() {
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    // 원본(2000ms) 대비 2배 느리게
    const id = setInterval(() => setIdx(i => (i + 1) % SLIDES.length), 4000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="relative w-full h-full overflow-hidden">
      {SLIDES.map((src, i) => (
        <div
          key={i}
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${src})`,
            opacity: i === idx ? 1 : 0,
            transition: 'opacity 2s ease-in-out',
          }}
        />
      ))}

      {/* 하단 그라데이션 — 페이지네이션 닷 가독성용 */}
      <div
        className="absolute inset-x-0 bottom-0 h-24 pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.35), transparent)' }}
      />

      {/* 페이지네이션 닷 */}
      <div className="absolute flex items-center gap-2" style={{ bottom: 20, left: 20 }}>
        {SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            style={{
              width: i === idx ? 22 : 7,
              height: 7,
              borderRadius: 4,
              background: i === idx ? '#fff' : 'rgba(255,255,255,0.5)',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  )
}
