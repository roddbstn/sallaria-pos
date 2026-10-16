import type { MenuDetail } from '../../lib/mock-data'

// 메뉴 태그 배지 — 인기 / 추천 / 신규.
// 색은 QR웹(salaria-prepaid)·카카오와 맞춘다. '신규'는 그쪽에서 '신메뉴'로 #1D6FE8 파랑이다.
export const TAG_BADGES: { key: 'isPopular' | 'isRecommended' | 'isNew'; label: string; bg: string }[] = [
  { key: 'isPopular',     label: '인기', bg: '#F5413E' },
  { key: 'isRecommended', label: '추천', bg: '#FF8418' },
  { key: 'isNew',         label: '신규', bg: '#1D6FE8' },
]

export function MenuTagBadges({ menu, textClass = 'text-[13px]' }: { menu: MenuDetail; textClass?: string }) {
  const active = TAG_BADGES.filter(t => menu[t.key])
  if (active.length === 0) return null
  return (
    <div className="flex items-center gap-[4px]">
      {active.map(t => (
        <div key={t.key} className="rounded-[6px] px-[6px] py-[3px] flex items-center justify-center" style={{ backgroundColor: t.bg }}>
          <span className={`${textClass} font-semibold text-[#FCFCFC] leading-none`}>{t.label}</span>
        </div>
      ))}
    </div>
  )
}
