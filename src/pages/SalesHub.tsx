import { useState } from 'react'
import HubLayout, { type HubNavItem } from '../components/hub/HubLayout'
import Sales from './Sales'
import Orders from './Orders'
import OrderAnalysis from './OrderAnalysis'

// 햄버거 드로어 "매출 · 주문" 그룹.
//
// 왜 새로 짜지 않았나: 매출 리포트는 Sales.tsx(1,500줄), 주문 리포트·내역은 Orders.tsx(1,000줄)에
// 이미 다 만들어져 있었다. 없던 건 화면이 아니라 "길"이다 — 드로어의 세 항목이 전부
// 같은 화면의 같은 탭으로 떨어져서, 뭘 눌러도 똑같은 게 나왔다.
// 그래서 다른 그룹(상품·설정·고객)과 같은 허브 셸을 씌우고 각 항목이 제 자리로 가게만 했다.
//
// HubLayout 은 bare 모드로 쓴다. 두 페이지 모두 h-full + 자체 스크롤 구조라,
// 셸이 패딩과 스크롤을 또 걸면 스크롤바가 두 겹이 되고 안쪽이 높이를 못 잡는다.

export type SalesHubTab = 'report' | 'analysis' | 'history'

const NAV: HubNavItem<SalesHubTab>[] = [
  { key: 'report',   label: '매출 리포트' },
  { key: 'analysis', label: '주문 리포트' },
  { key: 'history',  label: '주문 내역' },
]

export default function SalesHub({
  initialTab, onBack,
}: {
  initialTab: SalesHubTab
  onBack: () => void
}) {
  const [tab, setTab] = useState<SalesHubTab>(initialTab)

  return (
    <HubLayout title="매출 · 주문" items={NAV} activeKey={tab} onChange={setTab} onBack={onBack} bare>
      {/* 월 단위 정산 — 충전/사용/잔액 */}
      {tab === 'report' && <Sales />}

      {/* 분석은 "언제·누가·무엇을 얼마나" — 다음 주를 준비하는 화면.
          기존 Orders 의 '메뉴별매출' 탭은 품목 집계만 있어서, 요일·시간대와 거래처 주기를
          더한 전용 화면으로 갈아끼웠다. */}
      {tab === 'analysis' && <OrderAnalysis />}

      {/* 내역은 "누가 언제 무엇을" — 건별 목록 */}
      {tab === 'history' && <Orders key="history" initialTab="주문내역" />}
    </HubLayout>
  )
}
