import { useState, useEffect, useMemo } from 'react'
import HubLayout, { HubSection, type HubNavItem } from '../components/hub/HubLayout'
import { supabase, type DbMenu, type DbCategory, type DbOptionGroup, type DbOptionItem } from '../lib/supabase'
import { useStore } from '../lib/store-context'
import { won } from '../lib/ipc'
import OptionGroupEditModal from '../components/ui/OptionGroupEditModal'
import MenuFormModal from '../components/menu/MenuFormModal'
import { useMenuForm, type MenuFormStoreGroup } from '../components/menu/use-menu-form'
import { mapMenuRow } from '../lib/mappers'
import type { MenuDetail } from '../lib/mock-data'
import LoadingBlock from '../components/ui/LoadingBlock'
import InfoTip from '../components/ui/InfoTip'
import CategoryEditModal, { type CategoryTarget } from '../components/ui/CategoryEditModal'

// 햄버거 드로어 "상품" 그룹 — Figma node 672:1120(메뉴 상세) · 682:204(옵션 상세) · 672:1358(카테고리 상세).
// 세 프레임 모두 아직 비어 있어서, `선포스-전체메뉴-화면기획.md` §1~3의 기획을 와이어프레임으로
// 먼저 구현했다. 디자인이 나오면 레이아웃만 갈아끼우면 되도록 데이터 계층과 분리해 뒀다.
//
// 역할: 기존 메뉴 탭(Menus.tsx)이 "운영"(피크타임 품절·가격 수정)이라면 여기는 "관리" —
// 전체를 표로 보고, 지표를 보고, 일괄 작업한다. 읽기·추가·수정·삭제 전부 가능해야 하지만
// 개별 편집 모달은 Menus.tsx의 것을 재사용할 예정이다(아직 export 전이라 지금은 안내만).

export type ProductHubTab = 'menus' | 'options' | 'categories'

const NAV: HubNavItem<ProductHubTab>[] = [
  { key: 'menus',      label: '메뉴 정보' },
  { key: 'options',    label: '옵션 정보' },
  { key: 'categories', label: '카테고리 정보' },
]

/** 30일 전 ISO */
function daysAgoISO(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString()
}

// ── 공용 조각 ──────────────────────────────────────────────────────────────

function SummaryCard({ items }: { items: { label: string; value: string; warn?: boolean }[] }) {
  return (
    <div className="bg-[#F2F2F2] rounded-[16px] px-[30px] py-[22px] flex items-center gap-[46px] mb-[26px]">
      {items.map(it => (
        <div key={it.label}>
          <div className="text-[13px] font-normal text-[#6A635E] mb-[7px]">{it.label}</div>
          <div className={`text-[20px] font-medium ${it.warn && it.value !== '0' ? 'text-[#C92A2A]' : 'text-[#1E1E1E]'}`}>
            {it.value}
          </div>
        </div>
      ))}
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`h-[32px] px-[13px] rounded-[9px] text-[13px] whitespace-nowrap transition-colors ${
        active ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
      }`}
    >
      {children}
    </button>
  )
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="absolute left-[11px] top-1/2 -translate-y-1/2 pointer-events-none">
        <circle cx="7" cy="7" r="4.6" stroke="#ADADAD" strokeWidth="1.5"/>
        <path d="M10.5 10.5L14 14" stroke="#ADADAD" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-[32px] w-[200px] pl-[30px] pr-[11px] rounded-[9px] border border-[#ADADAD] text-[13px] text-[#1E1E1E] outline-none focus:border-[#6A635E]"
      />
    </div>
  )
}

function PrimaryAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="h-[32px] px-[14px] rounded-[9px] bg-[#2C261F] text-[#F9F9F9] text-[13px] font-medium hover:opacity-90 transition-opacity"
    >
      {children}
    </button>
  )
}

function Loading() {
  return <LoadingBlock py={56} />
}

function Empty({ note }: { note: string }) {
  return <div className="py-[56px] text-center text-[13px] font-normal text-[#ADADAD]">{note}</div>
}

// ── 공유 데이터 훅 ─────────────────────────────────────────────────────────
// 세 화면이 같은 재료(메뉴·카테고리·옵션·30일 판매량)를 쓴다. 탭을 옮길 때마다
// 다시 긁지 않도록 허브 레벨에서 한 번만 불러 세 패널에 내려준다.

interface ProductData {
  menus:        DbMenu[]
  categories:   DbCategory[]
  groups:       DbOptionGroup[]
  /** menu_id → 연결된 옵션 그룹 id[] */
  groupsByMenu: Record<string, string[]>
  /** menu_id → 30일 판매 수량 */
  soldByMenu:   Record<string, number>
  /** option_item_id → 30일 선택 횟수 */
  soldByOption: Record<string, number>
}

function useProductData(storeId: string) {
  const [data, setData]       = useState<ProductData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick]       = useState(0)

  useEffect(() => {
    if (!storeId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      const since = daysAgoISO(30)

      const [{ data: cats }, { data: groups }] = await Promise.all([
        supabase.from('categories').select('*').eq('store_id', storeId).order('display_order'),
        supabase.from('option_groups').select('*, option_items(*)').eq('store_id', storeId).order('display_order'),
      ])
      const categories = (cats ?? []) as DbCategory[]

      // 메뉴는 카테고리로 묶여 있고 store_id 컬럼이 없다 — 이 매장 카테고리로 범위를 좁힌다.
      // 카테고리가 없는(미분류) 메뉴는 이 쿼리로 안 잡히므로 아래에서 따로 센다.
      const catIds = categories.map(c => c.id)
      const { data: menuRows } = catIds.length
        ? await supabase.from('menus').select('*').in('category_id', catIds).order('display_order')
        : { data: [] as DbMenu[] }
      const menus = (menuRows ?? []) as DbMenu[]

      const menuIds = menus.map(m => m.id)
      const [{ data: links }, { data: items }] = await Promise.all([
        menuIds.length
          ? supabase.from('menu_option_groups').select('menu_id, option_group_id').in('menu_id', menuIds)
          : Promise.resolve({ data: [] as { menu_id: string; option_group_id: string }[] }),
        menuIds.length
          ? supabase
              .from('order_items')
              .select('menu_id, quantity, orders!inner(ordered_at, status), order_item_options(option_item_id)')
              .in('menu_id', menuIds)
              .gte('orders.ordered_at', since)
          : Promise.resolve({ data: [] as unknown[] }),
      ])

      const groupsByMenu: Record<string, string[]> = {}
      for (const l of (links ?? []) as { menu_id: string; option_group_id: string }[]) {
        (groupsByMenu[l.menu_id] ??= []).push(l.option_group_id)
      }

      const soldByMenu:   Record<string, number> = {}
      const soldByOption: Record<string, number> = {}
      type Row = {
        menu_id: string
        quantity: number
        orders: { status: string } | { status: string }[]
        order_item_options: { option_item_id: string }[] | null
      }
      for (const r of (items ?? []) as Row[]) {
        // !inner 조인은 단일 객체로 오지만 타입상 배열일 수 있어 둘 다 받는다
        const o = Array.isArray(r.orders) ? r.orders[0] : r.orders
        if (o?.status === '취소') continue
        soldByMenu[r.menu_id] = (soldByMenu[r.menu_id] ?? 0) + (r.quantity ?? 0)
        for (const oo of r.order_item_options ?? []) {
          if (!oo.option_item_id) continue
          soldByOption[oo.option_item_id] = (soldByOption[oo.option_item_id] ?? 0) + 1
        }
      }

      if (!cancelled) {
        setData({
          menus, categories,
          groups: (groups ?? []) as DbOptionGroup[],
          groupsByMenu, soldByMenu, soldByOption,
        })
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [storeId, tick])

  return { data, loading, reload: () => setTick(t => t + 1) }
}

// 이 화면은 메뉴를 DB 행(DbMenu) 그대로 들고 있는데, 메뉴 모달/훅은 MenuDetail 을 쓴다.
// 메뉴 화면(Menus.tsx)과 같은 모달·같은 저장 로직을 쓰려면 여기서 한 번 변환해 준다.
function toMenuDetail(m: DbMenu, data: ProductData): MenuDetail {
  const detail = mapMenuRow({ ...m, menu_option_groups: [] })
  const linked = new Set(data.groupsByMenu[m.id] ?? [])
  detail.optionGroups = data.groups.filter(g => linked.has(g.id)).map(g => ({
    id:         g.id,
    name:       g.name,
    isRequired: g.is_required ?? false,
    isMulti:    g.is_multi ?? false,
    maxSelect:  g.max_select ?? null,
    items: (g.option_items ?? []).map(it => ({
      id: it.id, name: it.name, extra: it.extra_price ?? 0,
      soldOut: it.is_sold_out ?? false, soldOutUntil: null,
      hidden: it.is_hidden ?? false, isPopular: it.is_popular ?? false,
    })),
  }))
  return detail
}

// ── 허브 ───────────────────────────────────────────────────────────────────

export default function ProductHub({
  initialTab, onBack, showToast,
}: {
  initialTab: ProductHubTab
  onBack: () => void
  showToast: (msg: string) => void
}) {
  const { storeId } = useStore()
  const [tab, setTab] = useState<ProductHubTab>(initialTab)
  const { data, loading, reload } = useProductData(storeId)

  const shared = { data, loading, reload, showToast }

  return (
    <HubLayout title="상품" items={NAV} activeKey={tab} onChange={setTab} onBack={onBack}>
      {tab === 'menus'      && <MenuDetailPanel {...shared} />}
      {tab === 'options'    && <OptionDetailPanel {...shared} />}
      {tab === 'categories' && <CategoryDetailPanel {...shared} />}
    </HubLayout>
  )
}

interface PanelProps {
  data: ProductData | null
  loading: boolean
  reload: () => void
  showToast: (msg: string) => void
}

// ── 1. 메뉴 상세 — Figma 672:1120 ──────────────────────────────────────────

// 토스 POS의 상품 화면과 같은 의도: 카테고리를 "필터 드롭다운"이 아니라 **탭**으로 깐다.
// 점주 머릿속에 메뉴는 이미 카테고리로 나뉘어 있어서, 탭이 그 구조를 그대로 비춘다.
// 그리고 그 탭 줄에서 바로 순서까지 바꾼다 — 카테고리 순서는 QR오더 노출 순서다.

type MenuFilter = 'all' | 'selling' | 'soldout' | 'noOption'
type SortBy     = 'order' | 'recent' | 'soldDesc' | 'priceDesc' | 'nameAsc'

const SORT_LABEL: Record<SortBy, string> = {
  order:     '표시 순서',
  recent:    '최신 순',
  soldDesc:  '많이 팔린 순',
  priceDesc: '가격 높은 순',
  nameAsc:   '이름 순',
}

function MenuDetailPanel({ data, loading, reload, showToast }: PanelProps) {
  const [catTab,  setCatTab]  = useState<string>('all')   // 'all' | categoryId | 'none'
  const [filter,  setFilter]  = useState<MenuFilter>('all')
  const [sortBy,  setSortBy]  = useState<SortBy>('order')
  const [q,       setQ]       = useState('')
  const [sortOpen, setSortOpen] = useState(false)
  const [reorder, setReorder] = useState(false)
  const [draftCats, setDraftCats] = useState<DbCategory[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  // 메뉴 추가/수정 — 메뉴 화면과 똑같은 모달·똑같은 저장 로직(use-menu-form).
  // 저장되면 이 화면은 전체를 다시 긁는다(reload). 로컬 패치보다 느리지만,
  // 여기서 보여주는 30일 판매량·옵션 연결 수가 같이 바뀔 수 있어 그게 더 정확하다.
  const menuForm = useMenuForm({
    onCreated: () => reload(),
    onUpdated: () => reload(),
    showToast,
  })
  // 모달이 요구하는 { id, name, items } 형태로 — 저장 후 optionGroups 복원에 쓰인다
  //
  // ⚠️ 가격(필수) 그룹은 뺀다. 메뉴마다 DB 트리거가 1:1 로 만들어 붙여서 수백 개가 되는데,
  //    그게 전부 모달의 옵션 목록에 뜨고 있었다. 메인 메뉴 화면은 쿼리에서
  //    `.not('name','ilike','가격(필수)%')` 로 이미 걸러내고 있어서 두 화면이 달랐다.
  //    모달은 이 그룹을 맨 앞 안내 칩으로 따로 보여주므로 목록에 또 있을 이유가 없다.
  const storeGroupsForForm: MenuFormStoreGroup[] = useMemo(
    () => (data?.groups ?? []).filter(g => !isPriceGroup(g)).map(g => ({
      id: g.id, name: g.name,
      items: (g.option_items ?? []).map(it => ({
        id: it.id, name: it.name, extra: it.extra_price ?? 0,
        soldOut: it.is_sold_out ?? false, soldOutUntil: null, hidden: it.is_hidden ?? false,
      })),
    })),
    [data],
  )

  const catName = useMemo(
    () => Object.fromEntries((data?.categories ?? []).map(c => [c.id, c.name])),
    [data],
  )

  // 카테고리별 메뉴 수 — 탭에 바로 찍어준다. 빈 카테고리를 한눈에 알 수 있다.
  const countByCat = useMemo(() => {
    const m: Record<string, number> = {}
    for (const menu of data?.menus ?? []) m[menu.category_id] = (m[menu.category_id] ?? 0) + 1
    return m
  }, [data])

  const rows = useMemo(() => {
    if (!data) return []
    const list = data.menus
      .filter(m => {
        if (catTab !== 'all' && m.category_id !== catTab) return false
        const groupCount = data.groupsByMenu[m.id]?.length ?? 0
        if (filter === 'selling'  && m.is_sold_out) return false
        if (filter === 'soldout'  && !m.is_sold_out) return false
        if (filter === 'noOption' && groupCount > 0) return false
        if (q && !m.name.toLowerCase().includes(q.toLowerCase())) return false
        return true
      })
      .map(m => ({
        menu:       m,
        category:   catName[m.category_id] ?? '미분류',
        groupCount: data.groupsByMenu[m.id]?.length ?? 0,
        sold:       data.soldByMenu[m.id] ?? 0,
      }))

    switch (sortBy) {
      case 'soldDesc':  return list.sort((a, b) => b.sold - a.sold)
      case 'priceDesc': return list.sort((a, b) => b.menu.base_price - a.menu.base_price)
      case 'nameAsc':   return list.sort((a, b) => a.menu.name.localeCompare(b.menu.name, 'ko'))
      case 'recent':    return list.reverse()  // display_order 역순 ≈ 최근 추가
      default:          return list
    }
  }, [data, catTab, filter, q, sortBy, catName])

  const noOptionCount = data ? data.menus.filter(m => (data.groupsByMenu[m.id]?.length ?? 0) === 0).length : 0

  // ── 카테고리 순서 편집 ──────────────────────────────────────────────────
  function startReorder() {
    setDraftCats([...(data?.categories ?? [])])
    setCatTab('all')
    setReorder(true)
  }
  function moveCat(from: number, to: number) {
    if (from === to) return
    setDraftCats(prev => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }
  async function saveOrder() {
    setSaving(true)
    // display_order를 1부터 다시 매긴다. 바뀐 것만 보내도 되지만 개수가 적어 전부 보낸다.
    const results = await Promise.all(
      draftCats.map((c, i) =>
        supabase.from('categories').update({ display_order: i + 1 }).eq('id', c.id),
      ),
    )
    setSaving(false)
    if (results.some(r => r.error)) { showToast('순서 저장에 실패했어요'); return }
    setReorder(false)
    reload()
    showToast('카테고리 순서를 저장했어요. QR오더에도 같은 순서로 보여요')
  }

  const tabs: { key: string; label: string; count: number }[] = [
    { key: 'all', label: '전체', count: data?.menus.length ?? 0 },
    ...(data?.categories ?? []).map(c => ({ key: c.id, label: c.name, count: countByCat[c.id] ?? 0 })),
  ]

  return (
    <div>
      <HubSection
        title="메뉴 정보"
        action={
          <div className="flex items-center gap-[7px]">
            <SearchBox value={q} onChange={setQ} placeholder="메뉴명 검색" />
            {reorder ? (
              <>
                <button
                  onClick={() => setReorder(false)}
                  className="h-[32px] px-[13px] rounded-[9px] bg-[#F2F2F2] text-[#787878] text-[13px] hover:bg-[#E8E4E2] transition-colors"
                >
                  취소
                </button>
                <PrimaryAction onClick={saveOrder}>{saving ? '저장 중…' : '순서 저장'}</PrimaryAction>
              </>
            ) : (
              <>
                <button
                  onClick={startReorder}
                  disabled={(data?.categories.length ?? 0) < 2}
                  className="h-[32px] px-[13px] rounded-[9px] bg-[#F2F2F2] text-[#1E1E1E] text-[13px] hover:bg-[#E8E4E2] disabled:opacity-40 transition-colors"
                >
                  순서 편집
                </button>
                <PrimaryAction onClick={() => menuForm.openAdd(catTab !== 'all' && catTab !== 'none' ? catTab : '')}>+ 메뉴 추가</PrimaryAction>
              </>
            )}
          </div>
        }
      />

      {loading || !data ? <Loading /> : (
        <>
          <SummaryCard items={[
            { label: '총 메뉴',       value: `${data.menus.length}개` },
            { label: '판매중',        value: `${data.menus.filter(m => !m.is_sold_out).length}개` },
            { label: '품절',          value: `${data.menus.filter(m => m.is_sold_out).length}개` },
            { label: '옵션 없는 메뉴', value: String(noOptionCount), warn: true },
          ]} />

          {/* ── 카테고리 탭 ── 순서 편집 중엔 같은 줄이 드래그 가능한 칩 목록으로 바뀐다 */}
          {reorder ? (
            <div className="mb-[16px]">
              <div className="text-[12px] font-normal text-[#6A635E] mb-[8px]">
                칩을 끌어서 순서를 바꿔주세요. QR오더 고객 화면의 카테고리 순서도 같이 바뀝니다
              </div>
              <div className="flex flex-wrap items-center gap-[7px]">
                {draftCats.map((c, i) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragOver={e => { e.preventDefault(); if (dragIdx !== null) moveCat(dragIdx, i), setDragIdx(i) }}
                    onDragEnd={() => setDragIdx(null)}
                    className={`h-[32px] px-[12px] rounded-[9px] border border-dashed flex items-center gap-[7px] cursor-grab active:cursor-grabbing text-[13px] transition-colors ${
                      dragIdx === i ? 'border-[#6A635E] bg-[#E8E4E2] text-[#2C261F]' : 'border-[#ADADAD] bg-[#FCFCFC] text-[#414141]'
                    }`}
                  >
                    <svg width="8" height="12" viewBox="0 0 9 13" fill="none">
                      <circle cx="2" cy="2" r="1.1" fill="#ADADAD"/><circle cx="7" cy="2" r="1.1" fill="#ADADAD"/>
                      <circle cx="2" cy="6.5" r="1.1" fill="#ADADAD"/><circle cx="7" cy="6.5" r="1.1" fill="#ADADAD"/>
                      <circle cx="2" cy="11" r="1.1" fill="#ADADAD"/><circle cx="7" cy="11" r="1.1" fill="#ADADAD"/>
                    </svg>
                    <span className="text-[11px] text-[#ADADAD]">{i + 1}</span>
                    {c.name}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-[7px] mb-[14px]">
              {tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => setCatTab(t.key)}
                  className={`h-[32px] px-[13px] rounded-[9px] text-[13px] whitespace-nowrap transition-colors ${
                    catTab === t.key ? 'bg-[#2C261F] text-[#F9F9F9]' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
                  }`}
                >
                  {t.label}
                  <span className={`ml-[6px] text-[11px] ${catTab === t.key ? 'text-[#ADADAD]' : 'text-[#ADADAD]'}`}>
                    {t.count}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* ── 정렬 + 상태 필터 ── */}
          <div className="flex items-center justify-between mb-[16px]">
            <div className="flex items-center gap-[7px]">
              <FilterChip active={filter === 'all'}      onClick={() => setFilter('all')}>전체</FilterChip>
              <FilterChip active={filter === 'selling'}  onClick={() => setFilter('selling')}>판매중</FilterChip>
              <FilterChip active={filter === 'soldout'}  onClick={() => setFilter('soldout')}>품절</FilterChip>
              <FilterChip active={filter === 'noOption'} onClick={() => setFilter('noOption')}>옵션 없음</FilterChip>
            </div>
            <div className="relative">
              <button
                onClick={() => setSortOpen(v => !v)}
                className="h-[32px] px-[12px] rounded-[9px] bg-[#F2F2F2] text-[#1E1E1E] text-[13px] flex items-center gap-[6px] hover:bg-[#E8E4E2] transition-colors"
              >
                {SORT_LABEL[sortBy]}
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none" className={sortOpen ? 'rotate-180' : ''}>
                  <path d="M3.5 6L8 10.5L12.5 6" stroke="#6A635E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {sortOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setSortOpen(false)} />
                  <div className="absolute right-0 top-[36px] z-30 w-[136px] bg-[#FCFCFC] border border-[#E8E4E2] rounded-[9px] shadow-[0_6px_20px_rgba(0,0,0,0.12)] py-[5px]">
                    {(Object.keys(SORT_LABEL) as SortBy[]).map(k => (
                      <button
                        key={k}
                        onClick={() => { setSortBy(k); setSortOpen(false) }}
                        className={`w-full h-[32px] px-[12px] text-left text-[13px] transition-colors ${
                          k === sortBy ? 'bg-[#F2F2F2] text-[#2C261F] font-medium' : 'text-[#414141] hover:bg-[#F2F2F2]'
                        }`}
                      >
                        {SORT_LABEL[k]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="rounded-[11px] overflow-hidden border border-[#E8E4E2]">
            <div className="flex items-center bg-[#E8E4E2] px-[20px] h-[40px] text-[12px] font-normal text-[#6A635E]">
              <span className="flex-1 min-w-0">메뉴({rows.length}개)</span>
              {catTab === 'all' && <span className="w-[120px]">카테고리</span>}
              <span className="w-[90px] text-right">가격</span>
              <span className="w-[80px] text-right">옵션</span>
              <span className="w-[90px] text-right">30일 판매</span>
              <span className="w-[70px] text-right">상태</span>
            </div>
            {rows.length === 0 ? <Empty note="조건에 맞는 메뉴가 없어요" /> : rows.map((r, i) => (
              <button
                key={r.menu.id}
                onClick={() => data && menuForm.openEdit(toMenuDetail(r.menu, data))}
                className={`pressable-row w-full flex items-center px-[20px] h-[44px] bg-[#FCFCFC] hover:bg-[#F9F9F9] text-left ${
                  i > 0 ? 'border-t border-[#F2F2F2]' : ''
                }`}
              >
                <span className="flex-1 min-w-0 text-[13px] text-[#1E1E1E] truncate">{r.menu.name}</span>
                {catTab === 'all' && <span className="w-[120px] text-[12px] text-[#787878] truncate">{r.category}</span>}
                <span className="w-[90px] text-right text-[13px] text-[#1E1E1E]">{won(r.menu.base_price)}</span>
                <span className={`w-[80px] text-right text-[12px] ${r.groupCount === 0 ? 'text-[#C92A2A]' : 'text-[#787878]'}`}>
                  {r.groupCount === 0 ? '없음' : `${r.groupCount}그룹`}
                </span>
                <span className="w-[90px] text-right text-[13px] text-[#1E1E1E]">{r.sold}개</span>
                <span className="w-[70px] text-right">
                  <span className={`inline-block px-[8px] h-[21px] leading-[21px] rounded-[6px] text-[11px] ${
                    r.menu.is_sold_out ? 'bg-[#FFEFEF] text-[#C92A2A]' : 'bg-[#E6F4EC] text-[#017333]'
                  }`}>
                    {r.menu.is_sold_out ? '품절' : '판매중'}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-[12px] text-[11px] font-normal text-[#ADADAD]">
            30일 판매는 취소 주문을 뺀 수량이에요. 주문 이력이 있는 메뉴는 삭제 대신 숨김 처리됩니다.
          </div>
        </>
      )}

      {/* 메뉴 추가/상세 — 메뉴 화면(Menus.tsx)과 같은 컴포넌트·같은 저장 로직 */}
      {menuForm.mode && (
        <MenuFormModal
          mode={menuForm.mode}
          form={menuForm.form}
          setForm={menuForm.setForm}
          saving={menuForm.saving}
          canSave={menuForm.canSave}
          imageError={menuForm.imageError}
          imagePreview={menuForm.imagePreview}
          setImagePreview={menuForm.setImagePreview}
          setImageFile={menuForm.setImageFile}
          categories={(data?.categories ?? []).map(c => ({
            id: c.id, name: c.name, displayOrder: c.display_order,
          }))}
          storeGroups={storeGroupsForForm}
          selectedGroupIds={menuForm.selectedGroupIds}
          onToggleGroup={menuForm.toggleGroup}
          onAddCategory={() => showToast('카테고리 추가는 카테고리 상세 화면에서 할 수 있어요')}
          onAddOptionGroup={() => showToast('옵션 그룹 추가는 옵션 상세 화면에서 할 수 있어요')}
          onDelete={() => showToast('메뉴 삭제는 메뉴 화면에서 할 수 있어요')}
          onClose={menuForm.close}
          onSave={() => menuForm.save(
            storeGroupsForForm,
            (data?.menus.reduce((m, mn) => Math.max(m, mn.display_order ?? 0), 0) ?? 0) + 1,
          )}
        />
      )}
    </div>
  )
}

// ── 2. 옵션 상세 — Figma 682:204 ───────────────────────────────────────────
// 그룹을 세로로 길게 나열하지 않는다. 메뉴 상세의 카테고리 탭과 같은 리듬:
//   ① 종류(필수 / 선택 / 가격(필수))를 고르고 ② 그 종류의 그룹 버튼 중 하나를 고르면
//   ③ 아래에 그 그룹 하나만 자세히 나온다.
// 가격(필수)는 메뉴 1:1이라 수백 개가 될 수 있어서 이 탭에서만 검색을 띄운다.

type OptionKind = 'required' | 'optional' | 'price'

const PRICE_PREFIX = '가격(필수) - '
const isPriceGroup = (g: DbOptionGroup) => g.name.startsWith(PRICE_PREFIX)

const KIND_LABEL: Record<OptionKind, string> = {
  required: '필수',
  optional: '선택',
  price:    '가격(필수)',
}

function kindOf(g: DbOptionGroup): OptionKind {
  if (isPriceGroup(g)) return 'price'
  return g.is_required ? 'required' : 'optional'
}

const QTY_UNLIMITED = 999
function itemQtyLabel(q: number | null | undefined): string | null {
  if (q === null || q === undefined) return null
  return q >= QTY_UNLIMITED ? '수량 제한없음' : `최대 ${q}개`
}

function OptionDetailPanel({ data, loading, reload, showToast }: PanelProps) {
  const [kind,      setKind]      = useState<OptionKind>('required')
  const [selected,  setSelected]  = useState<string | null>(null)
  const [q,         setQ]         = useState('')
  const [editing,   setEditing]   = useState<DbOptionGroup | null>(null)

  // 옵션 그룹 → 이 그룹을 쓰는 메뉴 (역참조). 코드엔 메뉴→옵션 방향밖에 없다.
  const menusByGroup = useMemo(() => {
    const map: Record<string, { id: string; name: string }[]> = {}
    if (!data) return map
    const byId = Object.fromEntries(data.menus.map(m => [m.id, m]))
    for (const [menuId, groupIds] of Object.entries(data.groupsByMenu)) {
      const m = byId[menuId]
      if (!m) continue
      for (const gid of groupIds) (map[gid] ??= []).push({ id: m.id, name: m.name })
    }
    return map
  }, [data])

  const byKind = useMemo(() => {
    const m: Record<OptionKind, DbOptionGroup[]> = { required: [], optional: [], price: [] }
    for (const g of data?.groups ?? []) m[kindOf(g)].push(g)
    return m
  }, [data])

  // 가격(필수)는 수가 많아 검색으로 좁힌다. 나머지는 전부 버튼으로 보여준다.
  const visible = useMemo(() => {
    const list = byKind[kind]
    if (kind !== 'price') return list
    if (!q.trim()) return list.slice(0, 24)
    return list.filter(g => g.name.toLowerCase().includes(q.toLowerCase()))
  }, [byKind, kind, q])

  // 종류를 바꾸면 그 종류의 첫 그룹을 자동으로 연다
  useEffect(() => { setSelected(visible[0]?.id ?? null) }, [kind, data])  // eslint-disable-line react-hooks/exhaustive-deps

  const group = (data?.groups ?? []).find(g => g.id === selected) ?? null
  const linked = group ? (menusByGroup[group.id] ?? []) : []

  const itemCount   = (data?.groups ?? []).reduce((s, g) => s + (g.option_items?.length ?? 0), 0)
  const orphanCount = (data?.groups ?? [])
    .filter(g => !isPriceGroup(g) && (menusByGroup[g.id]?.length ?? 0) === 0).length

  return (
    <div>
      <HubSection
        title="옵션 정보"
        action={<PrimaryAction onClick={() => showToast('옵션 그룹 추가는 메뉴 화면에서 할 수 있어요')}>+ 옵션 그룹 추가</PrimaryAction>}
      />

      {loading || !data ? <Loading /> : (
        <>
          <SummaryCard items={[
            { label: '옵션 그룹',   value: `${data.groups.length}개` },
            { label: '옵션 항목',   value: `${itemCount}개` },
            { label: '미연결 그룹', value: String(orphanCount), warn: true },
          ]} />

          {/* ① 종류 탭 — 메뉴 화면 우측 패널의 QR오더/개별 메뉴 세그먼트와 같은 디자인
               (회색 트랙 + 흰 thumb + 그림자). 버튼 치수는 기존 그대로 유지. */}
          <div className="flex items-center gap-[7px] mb-[12px]">
            <div className="inline-flex bg-[#F2F2F2] rounded-[10px]" style={{ padding: 3 }}>
              {(Object.keys(KIND_LABEL) as OptionKind[]).map(k => (
                <button
                  key={k}
                  onClick={() => { setKind(k); setQ('') }}
                  className={`h-[32px] px-[13px] rounded-[10px] text-[13px] font-medium transition-colors ${
                    kind === k
                      ? 'bg-[#FCFCFC] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] text-ink'
                      : 'text-[#BDB4A7] hover:text-ink'
                  }`}
                >
                  {KIND_LABEL[k]}
                  <span className="ml-[6px] text-[11px] text-[#ADADAD]">{byKind[k].length}</span>
                </button>
              ))}
            </div>
            {kind === 'price' && (
              <div className="ml-auto">
                <SearchBox value={q} onChange={setQ} placeholder="메뉴명으로 찾기" />
              </div>
            )}
          </div>

          {kind === 'price' && (
            <div className="text-[11px] text-[#ADADAD] mb-[10px] leading-relaxed">
              메뉴를 만들면 <span className="text-[#6A635E]">가격(필수)</span> 그룹이 자동으로 하나 생겨요.
              옵션이 하나뿐이면 QR오더에서 이미 선택된 채로 보입니다. 사이즈·용량 변형은 여기서 더하면 돼요.
              {!q.trim() && byKind.price.length > 24 && ` (${byKind.price.length}개 중 24개만 표시 — 검색해 주세요)`}
            </div>
          )}

          {/* ② 그룹 버튼 */}
          {visible.length === 0 ? (
            <Empty note={kind === 'price' && q ? '검색 결과가 없어요' : `${KIND_LABEL[kind]} 옵션 그룹이 없어요`} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-[7px] mb-[18px]">
                {visible.map(g => {
                  const on = g.id === selected
                  const orphan = !isPriceGroup(g) && (menusByGroup[g.id]?.length ?? 0) === 0
                  return (
                    <button
                      key={g.id}
                      onClick={() => setSelected(g.id)}
                      className={`h-[32px] px-[13px] rounded-[9px] text-[13px] whitespace-nowrap transition-colors ${
                        on ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
                      }`}
                    >
                      {isPriceGroup(g) ? g.name.slice(PRICE_PREFIX.length) : g.name}
                      {orphan && <span className="ml-[5px] text-[#C92A2A]">·</span>}
                    </button>
                  )
                })}
              </div>

              {/* ③ 선택한 그룹 하나만 자세히 */}
              {group && (
                <div className="rounded-[11px] border border-[#E8E4E2] overflow-hidden bg-[#FCFCFC]">
                  <div className="flex items-center px-[20px] h-[52px] border-b border-[#F2F2F2]">
                    <span className="text-[14px] font-medium text-[#1E1E1E] truncate">{group.name}</span>
                    <span className="ml-[12px] text-[11px] text-[#787878] whitespace-nowrap">
                      {group.is_multi ? '여러 개' : '한 개만'} · {group.is_required ? '필수' : '선택'}
                      {group.is_multi && ` · ${group.min_select ?? 0}~${group.max_select ?? '제한없음'}개`}
                    </span>
                    <div className="ml-auto">
                      <button
                        onClick={() => setEditing(group)}
                        className="h-[30px] px-[12px] rounded-[8px] bg-[#F2F2F2] text-[#1E1E1E] text-[12px] hover:bg-[#E8E4E2] transition-colors"
                      >
                        수정
                      </button>
                    </div>
                  </div>

                  {/* 연결된 메뉴 */}
                  <div className="px-[20px] py-[12px] border-b border-[#F2F2F2]">
                    <div className="text-[11px] text-[#6A635E] mb-[7px]">
                      연결된 메뉴 {linked.length}개
                      {isPriceGroup(group) && <span className="text-[#ADADAD]"> · 메뉴 1:1 고정</span>}
                    </div>
                    {linked.length === 0 ? (
                      <div className="text-[11px] text-[#C92A2A]">아직 어느 메뉴에도 붙어 있지 않아요</div>
                    ) : (
                      <div className="flex flex-wrap gap-[6px]">
                        {linked.map(m => (
                          <span key={m.id} className="px-[8px] h-[22px] leading-[22px] rounded-[6px] bg-[#F2F2F2] text-[11px] text-[#414141]">
                            {m.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 항목 — 메뉴 정보 표와 같은 머리글 디자인(#E8E4E2 바탕, 12px, #6A635E).
                      전에는 머리글 없이 값만 늘어서 있어서 마지막 칸의 '30일 N회'가
                      무슨 수인지 알 수 없었다. */}
                  {(group.option_items ?? []).length === 0 ? (
                    <div className="px-[20px] py-[16px] text-[11px] text-[#ADADAD]">항목이 없어요</div>
                  ) : (<>
                    <div className="flex items-center bg-[#E8E4E2] px-[20px] h-[32px] text-[11px] font-normal text-[#6A635E]">
                      <span className="flex-1 min-w-0">항목</span>
                      {(group.option_items ?? []).some(it => itemQtyLabel((it as DbOptionItem & { max_quantity?: number | null }).max_quantity))
                        && <span className="w-[100px]">수량</span>}
                      <span className="w-[90px] text-right">추가 금액</span>
                      <span className="w-[90px] text-right flex items-center justify-end gap-[4px]">
                        선택 횟수
                        <InfoTip text={'최근 30일 동안 손님이\n이 항목을 고른 횟수예요'} label="선택 횟수 설명" />
                      </span>
                    </div>
                  </>)}
                  {(group.option_items ?? []).length > 0 && (group.option_items ?? [])
                    .slice().sort((a, b) => a.display_order - b.display_order)
                    .map((item, idx) => {
                      const sold = data.soldByOption[item.id] ?? 0
                      const qty  = itemQtyLabel((item as DbOptionItem & { max_quantity?: number | null }).max_quantity)
                      const base = isPriceGroup(group) && item.extra_price === 0 && idx === 0
                      return (
                        <div key={item.id} className="flex items-center px-[20px] h-[38px] text-[12px] border-t border-[#F9F9F9]">
                          <span className="flex-1 min-w-0 text-[#414141] truncate">
                            {item.name}
                            {base && <span className="ml-[6px] text-[10px] text-[#ADADAD]">기본</span>}
                          </span>
                          {qty && <span className="w-[100px] text-[11px] text-[#787878]">{qty}</span>}
                          <span className="w-[90px] text-right text-[#1E1E1E]">
                            {item.extra_price > 0 ? `+${won(item.extra_price)}`
                              : item.extra_price < 0 ? `-${won(Math.abs(item.extra_price))}`
                              : '+0원'}
                          </span>
                          <span className={`w-[90px] text-right ${sold === 0 ? 'text-[#ADADAD]' : 'text-[#787878]'}`}>
                            {sold}회
                          </span>
                        </div>
                      )
                    })}
                </div>
              )}
            </>
          )}

          {editing && (
            <OptionGroupEditModal
              group={editing}
              isPriceGroup={isPriceGroup(editing)}
              menus={data.menus}
              linkedMenuIds={(menusByGroup[editing.id] ?? []).map(m => m.id)}
              onClose={() => setEditing(null)}
              onSaved={reload}
              showToast={showToast}
            />
          )}
        </>
      )}
    </div>
  )
}

// ── 3. 카테고리 상세 — Figma 672:1358 ──────────────────────────────────────

function CategoryDetailPanel({ data, loading, reload, showToast }: PanelProps) {
  const [editing, setEditing] = useState<CategoryTarget | null>(null)
  // 카테고리별 메뉴 수와 30일 판매량
  const stats = useMemo(() => {
    const m: Record<string, { menus: number; sold: number }> = {}
    if (!data) return m
    for (const menu of data.menus) {
      const k = menu.category_id ?? '__none__'
      m[k] ??= { menus: 0, sold: 0 }
      m[k].menus += 1
      m[k].sold  += data.soldByMenu[menu.id] ?? 0
    }
    return m
  }, [data])

  return (
    <div>
      <HubSection
        title="카테고리 정보"
        action={<PrimaryAction onClick={() => showToast('카테고리 추가는 메뉴 화면에서 할 수 있어요')}>+ 카테고리 추가</PrimaryAction>}
      />

      {loading || !data ? <Loading /> : (
        <>
          <div className="rounded-[11px] overflow-hidden border border-[#E8E4E2]">
            <div className="flex items-center bg-[#E8E4E2] px-[20px] h-[40px] text-[12px] font-normal text-[#6A635E]">
              <span className="w-[46px]">순서</span>
              <span className="flex-1 min-w-0">카테고리</span>
              <span className="w-[90px] text-right">메뉴</span>
              <span className="w-[100px] text-right">30일 판매</span>
              <span className="w-[80px] text-right">노출</span>
            </div>

            {data.categories.length === 0 ? <Empty note="등록된 카테고리가 없어요" /> : data.categories.map((c, i) => (
              <div
                key={c.id}
                onClick={() => setEditing({
                  id: c.id, name: c.name, isActive: c.is_active,
                  menuCount: stats[c.id]?.menus ?? 0,
                })}
                className={`flex items-center px-[20px] h-[44px] bg-[#FCFCFC] hover:bg-[#F9F9F9] cursor-pointer ${i > 0 ? 'border-t border-[#F2F2F2]' : ''}`}
              >
                <span className="w-[46px] flex items-center gap-[7px] text-[12px] text-[#ADADAD]">
                  {/* 드래그 핸들 — 순서 변경은 QR오더 노출 순서에 그대로 반영된다 */}
                  <svg width="9" height="13" viewBox="0 0 9 13" fill="none" className="cursor-grab">
                    <circle cx="2" cy="2" r="1.1" fill="#ADADAD"/><circle cx="7" cy="2" r="1.1" fill="#ADADAD"/>
                    <circle cx="2" cy="6.5" r="1.1" fill="#ADADAD"/><circle cx="7" cy="6.5" r="1.1" fill="#ADADAD"/>
                    <circle cx="2" cy="11" r="1.1" fill="#ADADAD"/><circle cx="7" cy="11" r="1.1" fill="#ADADAD"/>
                  </svg>
                  {i + 1}
                </span>
                <span className="flex-1 min-w-0 text-[13px] text-[#1E1E1E] truncate">{c.name}</span>
                <span className="w-[90px] text-right text-[13px] text-[#1E1E1E]">{stats[c.id]?.menus ?? 0}개</span>
                <span className="w-[100px] text-right text-[13px] text-[#1E1E1E]">{stats[c.id]?.sold ?? 0}개</span>
                <span className="w-[80px] text-right">
                  <span className={`inline-block px-[8px] h-[21px] leading-[21px] rounded-[6px] text-[11px] ${
                    c.is_active ? 'bg-[#E6F4EC] text-[#017333]' : 'bg-[#F2F2F2] text-[#787878]'
                  }`}>
                    {c.is_active ? '표시' : '숨김'}
                  </span>
                </span>
              </div>
            ))}
          </div>

          {/* 미분류 — 카테고리 없는 메뉴는 QR오더에서 안 보일 수 있는데 지금은 알 길이 없다.
              다만 메뉴 조회를 카테고리 기준으로 하고 있어 여기서는 아직 셀 수 없다. */}
          <div className="mt-[11px] flex items-center px-[20px] h-[44px] rounded-[11px] border border-dashed border-[#D9D2C8] bg-[#FCFCFC]">
            <span className="w-[46px] text-[12px] text-[#ADADAD]">—</span>
            <span className="flex-1 min-w-0 text-[13px] text-[#787878]">미분류</span>
            <button
              onClick={() => showToast('미분류 메뉴 집계는 준비 중이에요')}
              className="text-[12px] text-[#6A635E] hover:underline"
            >
              카테고리 없는 메뉴 확인
            </button>
          </div>

          <div className="mt-[12px] text-[11px] font-normal text-[#ADADAD]">
            순서를 바꾸면 QR오더 고객 화면의 카테고리 노출 순서도 같이 바뀝니다.
            분류를 눌러 이름을 고치거나 지울 수 있어요.
          </div>
        </>
      )}

      {editing && (
        <CategoryEditModal
          target={editing}
          onClose={() => setEditing(null)}
          onSave={async patch => {
            const { error } = await supabase.from('categories')
              .update({ name: patch.name, is_active: patch.isActive })
              .eq('id', editing.id)
            if (error) throw error
            reload()
            showToast('분류를 저장했어요')
          }}
          onDelete={async () => {
            // ⚠️ 순서가 중요하다. 메뉴를 먼저 떼어내고(category_id = null) 그다음 분류를 지운다.
            //    반대로 하면 외래키에 걸리거나, 설정에 따라 메뉴까지 함께 지워진다.
            //    메뉴는 '분류 없음'으로 남아야 한다 — 분류를 정리하다 상품을 잃으면 안 된다.
            const { error: unlinkErr } = await supabase.from('menus')
              .update({ category_id: null }).eq('category_id', editing.id)
            if (unlinkErr) throw unlinkErr
            const { error } = await supabase.from('categories').delete().eq('id', editing.id)
            if (error) throw error
            reload()
            showToast(editing.menuCount > 0
              ? `분류를 지웠어요. 메뉴 ${editing.menuCount}개는 '분류 없음'에 있어요`
              : '분류를 지웠어요')
          }}
        />
      )}
    </div>
  )
}
