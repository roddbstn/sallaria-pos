import type { MenuDetail } from '../../lib/mock-data'

// 메뉴 태그 배지 — 인기 / 추천 / 신규.
//
// 굵기는 medium(500). semibold 였는데, 색이 이미 강해서(빨강·주황·파랑) 굵기까지 올리면
// 배지가 메뉴 이름보다 먼저 읽혔다. 색으로 눈에 띄고 글자는 한 단계 눕힌다.
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
        <div key={t.key} className="rounded-[6px] px-[8px] py-[5px] flex items-center justify-center" style={{ backgroundColor: t.bg }}>
          <span className={`${textClass} font-medium text-[#FCFCFC] leading-none`}>{t.label}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * 태그 **세 개를 늘 보여주는** 변형 — 인기 / 추천 / 신규 를 1행 3열로.
 *
 * MenuTagBadges 는 켜진 것만 보여준다(메뉴 카드처럼 공간이 좁고 "이 메뉴는 인기다"만
 * 말하면 되는 자리). 반면 옵션 순서편집 패널처럼 **메뉴 하나를 들여다보는 자리**에서는
 * 꺼진 태그도 자리를 지키는 게 읽기 쉽다 — 세 칸이 늘 같은 위치에 있어서
 * "추천이 빠져 있네"가 눈에 바로 들어온다. 켜진 것만 보여주면 칸이 밀려서
 * 무엇이 없는지 세어봐야 한다.
 */
export function MenuTagRow({ menu, textClass = 'text-[12px]' }: { menu: MenuDetail; textClass?: string }) {
  return (
    <div className="flex items-center gap-[5px]">
      {TAG_BADGES.map(t => {
        const on = !!menu[t.key]
        return (
          <div
            key={t.key}
            className="rounded-[6px] px-[9px] py-[5px] flex items-center justify-center"
            // 꺼진 태그는 모양을 그대로 두고 색만 죽인다. 테두리로 처리하면
            // 켜진 것과 높이가 1px 달라져 세 칸이 미묘하게 어긋난다.
            style={{ backgroundColor: on ? t.bg : '#F2F2F2' }}
          >
            <span className={`${textClass} font-medium leading-none ${on ? 'text-[#FCFCFC]' : 'text-[#C4C4C4]'}`}>
              {t.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
