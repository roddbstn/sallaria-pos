import { useState } from 'react'
import { MOCK_MENU_DETAILS, MOCK_CATEGORIES, type MenuDetail, type Category, type OptionGroup, type OptionItem } from '../lib/mock-data'
import { won } from '../lib/ipc'

type MenuTab      = 'menu' | 'option' | 'category'
type StatusFilter = 'all' | 'active' | 'soldOut' | 'hidden'

function uid() { return `_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }

// 옵션 탭용 스토어 단위 목업
const STORE_OPTION_GROUPS = [
  {
    id: 'OG1', name: '베이스', usedBy: 2,
    items: [
      { id: 'OI1', name: '현미밥',       extra: 0, soldOut: false, hidden: false },
      { id: 'OI2', name: '메밀면',       extra: 0, soldOut: false, hidden: false },
      { id: 'OI3', name: '샐러드 베이스', extra: 0, soldOut: true,  hidden: false },
    ],
  },
  {
    id: 'OG3', name: '드레싱 (기본)', usedBy: 2,
    items: [
      { id: 'OI6', name: '오리엔탈', extra: 0,   soldOut: false, hidden: false },
      { id: 'OI7', name: '발사믹',   extra: 0,   soldOut: false, hidden: false },
      { id: 'OI8', name: '시저',     extra: 0,   soldOut: false, hidden: false },
    ],
  },
  {
    id: 'OG4', name: '토핑 추가', usedBy: 2,
    items: [
      { id: 'OI9',  name: '아보카도 추가', extra: 1500, soldOut: false, hidden: false },
      { id: 'OI10', name: '새우 추가',     extra: 2000, soldOut: false, hidden: false },
      { id: 'OI11', name: '연어 추가',     extra: 2500, soldOut: false, hidden: false },
      { id: 'OI12', name: '베이컨',        extra: 1000, soldOut: false, hidden: false },
    ],
  },
]

export default function Menus() {
  const [tab,          setTab]          = useState<MenuTab>('menu')
  const [menus,        setMenus]        = useState<MenuDetail[]>(MOCK_MENU_DETAILS)
  const [categories,   setCategories]   = useState<Category[]>(MOCK_CATEGORIES)
  const [storeGroups,  setStoreGroups]  = useState(STORE_OPTION_GROUPS)
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [checked,      setChecked]      = useState<Set<string>>(new Set())
  const [selected,     setSelected]     = useState<MenuDetail | null>(null)

  // 기본 정보 편집
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', price: '', description: '' })

  // 그룹 추가 폼
  const [addingGroup, setAddingGroup] = useState(false)
  const [newGroup,    setNewGroup]    = useState({ name: '', isRequired: false, isMulti: false, maxSelect: '' })

  // 카테고리 인라인 편집 (카테고리 탭)
  const [editingCatId,   setEditingCatId]   = useState<string | null>(null)
  const [catNameDraft,   setCatNameDraft]   = useState('')
  const [addingCat,      setAddingCat]      = useState(false)
  const [newCatName,     setNewCatName]     = useState('')
  const [deletingCatId,  setDeletingCatId]  = useState<string | null>(null)

  // 카테고리 지정 팝오버 (메뉴 상세패널)
  const [catPickerOpen,  setCatPickerOpen]  = useState(false)
  const [inlineNewCat,   setInlineNewCat]   = useState('')

  // 메뉴 추가 모달
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [addForm, setAddForm] = useState({
    name: '', emoji: '', price: '', description: '', categoryId: '',
  })

  // ── 카테고리 헬퍼 ──────────────────────────────────────────────────────────
  function getCategoryName(id: string | null): string {
    if (!id) return ''
    return categories.find(c => c.id === id)?.name ?? ''
  }

  function sortedCategories() {
    return [...categories].sort((a, b) => a.displayOrder - b.displayOrder)
  }

  function menuCountInCategory(catId: string) {
    return menus.filter(m => m.categoryId === catId).length
  }

  // ── 메뉴 목록 필터링 ────────────────────────────────────────────────────────
  const filteredMenus = menus.filter(m => {
    const matchSearch = m.name.includes(search) || getCategoryName(m.categoryId).includes(search)
    const matchStatus =
      statusFilter === 'all'     ? true
      : statusFilter === 'active'  ? m.active && !m.soldOut
      : statusFilter === 'soldOut' ? m.soldOut
      : !m.active
    return matchSearch && matchStatus
  })

  // ── 메뉴 선택 ──────────────────────────────────────────────────────────────
  function selectMenu(menu: MenuDetail) {
    if (selected?.code === menu.code) { setSelected(null); return }
    setSelected(menu)
    setEditMode(false)
    setAddingGroup(false)
  }

  // ── 선택 메뉴 업데이트 헬퍼 ────────────────────────────────────────────────
  function applyUpdate(updated: MenuDetail) {
    setMenus(prev => prev.map(m => m.code === updated.code ? updated : m))
    setSelected(updated)
  }

  // ── 카테고리 CRUD ──────────────────────────────────────────────────────────
  function addCategory(name: string) {
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.displayOrder), 0)
    setCategories(prev => [...prev, { id: `C${uid()}`, name: name.trim(), displayOrder: maxOrder + 1 }])
  }

  function renameCategory(id: string, name: string) {
    setCategories(prev => prev.map(c => c.id === id ? { ...c, name: name.trim() } : c))
  }

  function deleteCategory(id: string) {
    // 해당 카테고리 소속 메뉴 → 미지정 처리
    setMenus(prev => prev.map(m => m.categoryId === id ? { ...m, categoryId: null } : m))
    setCategories(prev => prev.filter(c => c.id !== id))
    if (selected?.categoryId === id) applyUpdate({ ...selected, categoryId: null })
  }

  function moveCategoryUp(id: string) {
    const sorted = sortedCategories()
    const idx = sorted.findIndex(c => c.id === id)
    if (idx <= 0) return
    const above = sorted[idx - 1]
    setCategories(prev => prev.map(c => {
      if (c.id === id)    return { ...c, displayOrder: above.displayOrder }
      if (c.id === above.id) return { ...c, displayOrder: sorted[idx].displayOrder }
      return c
    }))
  }

  function moveCategoryDown(id: string) {
    const sorted = sortedCategories()
    const idx = sorted.findIndex(c => c.id === id)
    if (idx < 0 || idx >= sorted.length - 1) return
    const below = sorted[idx + 1]
    setCategories(prev => prev.map(c => {
      if (c.id === id)     return { ...c, displayOrder: below.displayOrder }
      if (c.id === below.id) return { ...c, displayOrder: sorted[idx].displayOrder }
      return c
    }))
  }

  function assignCategory(catId: string | null) {
    if (!selected) return
    applyUpdate({ ...selected, categoryId: catId })
    setCatPickerOpen(false)
    setInlineNewCat('')
  }

  function createAndAssignCategory(name: string) {
    if (!name.trim() || !selected) return
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.displayOrder), 0)
    const newCat: Category = { id: `C${uid()}`, name: name.trim(), displayOrder: maxOrder + 1 }
    setCategories(prev => [...prev, newCat])
    applyUpdate({ ...selected, categoryId: newCat.id })
    setCatPickerOpen(false)
    setInlineNewCat('')
  }

  // ── 메뉴 추가 ───────────────────────────────────────────────────────────────
  function openAddMenu() {
    setAddForm({ name: '', emoji: '', price: '', description: '', categoryId: '' })
    setAddMenuOpen(true)
  }

  function confirmAddMenu() {
    const price = parseInt(addForm.price, 10)
    if (!addForm.name.trim() || isNaN(price) || price < 0) return
    const maxOrder = menus.reduce((m, mn) => Math.max(m, mn.order), 0)
    const newMenu: MenuDetail = {
      code:         `M${uid()}`,
      name:         addForm.name.trim(),
      emoji:        addForm.emoji.trim() || '🍽️',
      price,
      description:  addForm.description.trim(),
      categoryId:   addForm.categoryId || null,
      active:       true,
      soldOut:      false,
      order:        maxOrder + 1,
      optionGroups: [],
    }
    setMenus(prev => [...prev, newMenu])
    setSelected(newMenu)
    setAddMenuOpen(false)
  }

  // ── 기본 정보 편집 ──────────────────────────────────────────────────────────
  function startEdit() {
    if (!selected) return
    setEditForm({ name: selected.name, price: String(selected.price), description: selected.description })
    setEditMode(true)
  }
  function saveEdit() {
    if (!selected) return
    const priceNum = parseInt(editForm.price, 10)
    if (!editForm.name.trim() || isNaN(priceNum) || priceNum < 0) return
    applyUpdate({ ...selected, name: editForm.name.trim(), price: priceNum, description: editForm.description })
    setEditMode(false)
  }

  // ── 판매/표시 상태 토글 ────────────────────────────────────────────────────
  function toggleMenuStatus(field: 'soldOut' | 'active') {
    if (!selected) return
    applyUpdate({ ...selected, [field]: !selected[field] })
  }

  // ── 옵션 그룹 CRUD ──────────────────────────────────────────────────────────
  function updateGroup(groupId: string, updates: Partial<OptionGroup>) {
    if (!selected) return
    applyUpdate({
      ...selected,
      optionGroups: selected.optionGroups.map(g =>
        g.id !== groupId ? g : { ...g, ...updates }
      ),
    })
  }

  function deleteGroup(groupId: string) {
    if (!selected) return
    applyUpdate({ ...selected, optionGroups: selected.optionGroups.filter(g => g.id !== groupId) })
  }

  function confirmAddGroup() {
    if (!selected || !newGroup.name.trim()) return
    const group: OptionGroup = {
      id:         `OG${uid()}`,
      name:       newGroup.name.trim(),
      isRequired: newGroup.isRequired,
      isMulti:    newGroup.isMulti,
      maxSelect:  newGroup.isMulti && newGroup.maxSelect ? parseInt(newGroup.maxSelect) : null,
      items:      [],
    }
    applyUpdate({ ...selected, optionGroups: [...selected.optionGroups, group] })
    setAddingGroup(false)
    setNewGroup({ name: '', isRequired: false, isMulti: false, maxSelect: '' })
  }

  // ── 옵션 아이템 CRUD ────────────────────────────────────────────────────────
  function updateItem(groupId: string, itemId: string, updates: Partial<OptionItem>) {
    if (!selected) return
    applyUpdate({
      ...selected,
      optionGroups: selected.optionGroups.map(g =>
        g.id !== groupId ? g : {
          ...g,
          items: g.items.map(it => it.id !== itemId ? it : { ...it, ...updates }),
        }
      ),
    })
  }

  function deleteItem(groupId: string, itemId: string) {
    if (!selected) return
    applyUpdate({
      ...selected,
      optionGroups: selected.optionGroups.map(g =>
        g.id !== groupId ? g : { ...g, items: g.items.filter(it => it.id !== itemId) }
      ),
    })
  }

  function addItem(groupId: string, name: string, extra: number) {
    if (!selected) return
    const item: OptionItem = { id: `OI${uid()}`, name, extra, soldOut: false, hidden: false, isPopular: false }
    applyUpdate({
      ...selected,
      optionGroups: selected.optionGroups.map(g =>
        g.id !== groupId ? g : { ...g, items: [...g.items, item] }
      ),
    })
  }

  // ── 일괄 액션 ──────────────────────────────────────────────────────────────
  function toggleCheck(code: string) {
    setChecked(prev => {
      const n = new Set(prev)
      n.has(code) ? n.delete(code) : n.add(code)
      return n
    })
  }

  function bulkAction(action: 'soldOut' | 'unsoldOut' | 'hide' | 'unhide') {
    setMenus(prev => prev.map(m => {
      if (!checked.has(m.code)) return m
      if (action === 'soldOut')   return { ...m, soldOut: true  }
      if (action === 'unsoldOut') return { ...m, soldOut: false }
      if (action === 'hide')      return { ...m, active: false  }
      if (action === 'unhide')    return { ...m, active: true   }
      return m
    }))
    if (selected && checked.has(selected.code)) {
      setSelected(prev => {
        if (!prev) return null
        if (action === 'soldOut')   return { ...prev, soldOut: true  }
        if (action === 'unsoldOut') return { ...prev, soldOut: false }
        if (action === 'hide')      return { ...prev, active: false  }
        return { ...prev, active: true }
      })
    }
    setChecked(new Set())
  }

  // ── 옵션 탭: 스토어 단위 토글 ──────────────────────────────────────────────
  function toggleStoreOptItem(groupId: string, itemId: string, field: 'soldOut' | 'hidden') {
    setStoreGroups(prev => prev.map(g =>
      g.id !== groupId ? g : {
        ...g,
        items: g.items.map(it => it.id !== itemId ? it : { ...it, [field]: !it[field] }),
      }
    ))
  }

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">

      {/* 헤더 */}
      <div className="px-6 py-4 border-b border-gray-border flex-shrink-0 flex items-center justify-between">
        <div className="text-[20px] font-extrabold">메뉴 관리</div>
        <button onClick={openAddMenu} className="px-4 py-2 bg-[#16a84c] text-white rounded-lg text-[13px] font-bold hover:bg-[#128040] transition-colors">
          + 메뉴 추가
        </button>
      </div>

      {/* 탭 */}
      <div className="px-6 border-b border-gray-border flex-shrink-0 flex gap-0">
        {([
          { v: 'menu',     l: '메뉴'     },
          { v: 'option',   l: '옵션'     },
          { v: 'category', l: '카테고리' },
        ] as { v: MenuTab; l: string }[]).map(({ v, l }) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-6 py-3 text-[13px] font-bold border-b-2 transition-colors
              ${tab === v ? 'border-green text-green' : 'border-transparent text-gray-text hover:text-ink'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* ── 메뉴 탭 ── */}
      {tab === 'menu' && (
        <div className="flex-1 flex overflow-hidden">

          {/* 좌측 목록 */}
          <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-border">
            {/* 검색 + 필터 */}
            <div className="px-6 py-3 border-b border-gray-border flex items-center gap-3 flex-shrink-0">
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="메뉴명, 카테고리 검색"
                className="border border-gray-border rounded-lg px-3 py-2 text-[13px] w-52"
              />
              <div className="flex gap-1">
                {([
                  { v: 'all',     l: '전체'   },
                  { v: 'active',  l: '판매중' },
                  { v: 'soldOut', l: '품절'   },
                  { v: 'hidden',  l: '숨김'   },
                ] as { v: StatusFilter; l: string }[]).map(({ v, l }) => (
                  <button key={v} onClick={() => setStatusFilter(v)}
                    className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors
                      ${statusFilter === v ? 'bg-ink text-white' : 'bg-gray-bg text-gray-text border border-gray-border hover:bg-gray-100'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {/* 테이블 헤더 */}
            <div className="grid grid-cols-[36px_48px_1fr_80px_80px_80px_80px] px-6 py-2 bg-gray-bg text-[11px] font-bold text-gray-text uppercase tracking-wide border-b border-gray-border flex-shrink-0">
              <span></span><span></span><span>메뉴명</span>
              <span>카테고리</span><span>가격</span><span>판매상태</span><span>표시</span>
            </div>
            {/* 목록 */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-border">
              {filteredMenus.map(menu => (
                <div key={menu.code} onClick={() => selectMenu(menu)}
                  className={`grid grid-cols-[36px_48px_1fr_80px_80px_80px_80px] px-6 py-3 items-center text-[13px] cursor-pointer transition-colors
                    ${selected?.code === menu.code ? 'bg-green-soft' : 'hover:bg-gray-bg'}
                    ${!menu.active || menu.soldOut ? 'opacity-60' : ''}`}
                >
                  <input type="checkbox" checked={checked.has(menu.code)}
                    onChange={e => { e.stopPropagation(); toggleCheck(menu.code) }}
                    onClick={e => e.stopPropagation()}
                    className="w-4 h-4 accent-green"
                  />
                  <span className="text-[22px]">{menu.emoji}</span>
                  <span className="font-semibold text-ink">{menu.name}</span>
                  <span className="text-gray-text text-[12px]">
                    {getCategoryName(menu.categoryId) || <span className="text-gray-border italic">미지정</span>}
                  </span>
                  <span className="font-bold">{won(menu.price)}</span>
                  <span>
                    {menu.soldOut
                      ? <span className="text-[11px] font-semibold text-danger bg-red-50 px-2 py-0.5 rounded-full">품절</span>
                      : <span className="text-[11px] font-semibold text-green bg-green-soft px-2 py-0.5 rounded-full">판매중</span>
                    }
                  </span>
                  <span>
                    {!menu.active
                      ? <span className="text-[11px] font-semibold text-gray-text bg-gray-100 px-2 py-0.5 rounded-full">숨김</span>
                      : <span className="text-[11px] font-semibold text-ink bg-gray-bg px-2 py-0.5 rounded-full">노출</span>
                    }
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 우측 상세 패널 */}
          <div className="w-[400px] flex-shrink-0 overflow-y-auto">
            {selected ? (
              <div className="p-5 space-y-4">

                {/* 패널 헤더 */}
                {editMode ? (
                  <div className="flex items-center justify-between">
                    <span className="text-[15px] font-extrabold">기본 정보 편집</span>
                    <div className="flex gap-2">
                      <button onClick={() => setEditMode(false)}
                        className="px-3 py-1.5 text-[12px] font-bold text-gray-text border border-gray-border rounded-lg hover:bg-gray-bg">취소</button>
                      <button onClick={saveEdit}
                        className="px-3 py-1.5 text-[12px] font-bold text-white bg-green rounded-lg hover:bg-[#015c28]">저장</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[28px] flex-shrink-0">{selected.emoji}</span>
                      <div className="min-w-0">
                        <div className="text-[16px] font-extrabold text-ink truncate">{selected.name}</div>
                        <span className="text-[11px] text-gray-text">{selected.category}</span>
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button onClick={startEdit}
                        className="px-3 py-1.5 text-[12px] font-medium text-gray-text border border-gray-border rounded-lg hover:bg-gray-bg">편집</button>
                    </div>
                  </div>
                )}

                {/* 기본 정보 편집 폼 */}
                {editMode && (
                  <div className="space-y-3">
                    <label className="block">
                      <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide">메뉴명</span>
                      <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                        className="mt-1 w-full border border-gray-border rounded-lg px-3 py-2 text-[13px]" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide">기본 가격 (원)</span>
                      <input type="number" value={editForm.price} onChange={e => setEditForm(p => ({ ...p, price: e.target.value }))}
                        className="mt-1 w-full border border-gray-border rounded-lg px-3 py-2 text-[13px]" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide">설명</span>
                      <textarea value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                        rows={3} className="mt-1 w-full border border-gray-border rounded-lg px-3 py-2 text-[13px] resize-none" />
                    </label>
                  </div>
                )}

                {/* 보기 모드: 기본 정보 + 상태 토글 */}
                {!editMode && (
                  <>
                    <div className="bg-gray-bg rounded-xl p-4 space-y-2.5">
                      <div className="flex justify-between text-[13px]">
                        <span className="text-gray-text">기본 가격</span>
                        <span className="font-bold">{won(selected.price)}</span>
                      </div>
                      {selected.description && (
                        <div className="flex justify-between text-[13px] gap-4">
                          <span className="text-gray-text flex-shrink-0">설명</span>
                          <span className="text-ink text-right">{selected.description}</span>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="border border-gray-border rounded-xl p-3">
                        <div className="text-[11px] text-gray-text mb-2">판매 상태</div>
                        <div className="flex gap-1.5">
                          <button onClick={() => { if (selected.soldOut) toggleMenuStatus('soldOut') }}
                            className={`flex-1 py-1.5 rounded-lg text-[12px] font-bold transition-colors
                              ${!selected.soldOut ? 'bg-green text-white' : 'bg-gray-bg text-gray-text border border-gray-border hover:bg-gray-100'}`}>
                            판매중
                          </button>
                          <button onClick={() => { if (!selected.soldOut) toggleMenuStatus('soldOut') }}
                            className={`flex-1 py-1.5 rounded-lg text-[12px] font-bold transition-colors
                              ${selected.soldOut ? 'bg-danger text-white' : 'bg-gray-bg text-gray-text border border-gray-border hover:bg-gray-100'}`}>
                            품절
                          </button>
                        </div>
                      </div>
                      <div className="border border-gray-border rounded-xl p-3">
                        <div className="text-[11px] text-gray-text mb-2">표시 상태</div>
                        <div className="flex gap-1.5">
                          <button onClick={() => { if (!selected.active) toggleMenuStatus('active') }}
                            className={`flex-1 py-1.5 rounded-lg text-[12px] font-bold transition-colors
                              ${selected.active ? 'bg-ink text-white' : 'bg-gray-bg text-gray-text border border-gray-border hover:bg-gray-100'}`}>
                            노출
                          </button>
                          <button onClick={() => { if (selected.active) toggleMenuStatus('active') }}
                            className={`flex-1 py-1.5 rounded-lg text-[12px] font-bold transition-colors
                              ${!selected.active ? 'bg-ink text-white' : 'bg-gray-bg text-gray-text border border-gray-border hover:bg-gray-100'}`}>
                            숨김
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                  {/* 카테고리 지정 */}
                  {!editMode && (
                    <div className="relative">
                      <div className="text-[11px] font-bold text-gray-text uppercase tracking-wide mb-1.5">카테고리</div>
                      {!catPickerOpen ? (
                        <button
                          onClick={() => { setCatPickerOpen(true); setInlineNewCat('') }}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[13px] font-semibold transition-colors
                            ${selected.categoryId
                              ? 'border-green text-green bg-green-soft hover:bg-green-soft/60'
                              : 'border-dashed border-gray-border text-gray-text hover:border-gray-text'}`}>
                          {selected.categoryId ? getCategoryName(selected.categoryId) : '카테고리 없음'}
                          <span className="text-[11px] opacity-60">▾</span>
                        </button>
                      ) : (
                        <div className="border-2 border-green rounded-xl p-3 space-y-2 bg-white shadow-sm">
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              onClick={() => assignCategory(null)}
                              className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors
                                ${!selected.categoryId ? 'bg-ink text-white border-ink' : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}>
                              없음
                            </button>
                            {sortedCategories().map(cat => (
                              <button key={cat.id} onClick={() => assignCategory(cat.id)}
                                className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors
                                  ${selected.categoryId === cat.id ? 'bg-green text-white border-green' : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}>
                                {cat.name}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5 pt-1.5 border-t border-gray-border">
                            <input
                              value={inlineNewCat}
                              onChange={e => setInlineNewCat(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') createAndAssignCategory(inlineNewCat); if (e.key === 'Escape') setCatPickerOpen(false) }}
                              placeholder="새 카테고리 이름..."
                              className="flex-1 text-[12px] border border-gray-border rounded-lg px-2 py-1"
                            />
                            <button onClick={() => createAndAssignCategory(inlineNewCat)}
                              disabled={!inlineNewCat.trim()}
                              className="text-[11px] font-bold text-white bg-green px-2.5 py-1 rounded-lg hover:bg-[#015c28] disabled:opacity-40">
                              추가
                            </button>
                            <button onClick={() => setCatPickerOpen(false)} className="text-gray-text hover:text-ink text-[15px]">✗</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                {/* 옵션 그룹 섹션 */}
                {!editMode && (
                  <div>
                    {/* 섹션 헤더 */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[12px] font-bold text-gray-text uppercase tracking-wide">
                        옵션 그룹 · {selected.optionGroups.length}개
                      </span>
                      {!addingGroup && (
                        <button
                          onClick={() => setAddingGroup(true)}
                          className="text-[12px] font-bold text-green hover:text-[#015c28] transition-colors">
                          + 그룹 추가
                        </button>
                      )}
                    </div>

                    {/* 그룹 추가 폼 */}
                    {addingGroup && (
                      <div className="border-2 border-green rounded-xl p-4 mb-3 space-y-3">
                        <input
                          autoFocus
                          value={newGroup.name}
                          onChange={e => setNewGroup(p => ({ ...p, name: e.target.value }))}
                          placeholder="옵션 그룹명 (예: 드레싱 선택)"
                          className="w-full border border-gray-border rounded-lg px-3 py-2 text-[13px]"
                          onKeyDown={e => e.key === 'Enter' && confirmAddGroup()}
                        />
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* 필수/선택 */}
                          <button
                            onClick={() => setNewGroup(p => ({ ...p, isRequired: !p.isRequired }))}
                            className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors
                              ${newGroup.isRequired ? 'bg-ink text-white border-ink' : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}>
                            {newGroup.isRequired ? '필수' : '선택 (필수로 변경)'}
                          </button>
                          {/* 단일/복수 */}
                          <button
                            onClick={() => setNewGroup(p => ({ ...p, isMulti: !p.isMulti, maxSelect: '' }))}
                            className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors
                              ${newGroup.isMulti ? 'bg-ink text-white border-ink' : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}>
                            {newGroup.isMulti ? '복수 선택' : '단일 선택 (복수로 변경)'}
                          </button>
                          {newGroup.isMulti && (
                            <input
                              type="number" min="1"
                              value={newGroup.maxSelect}
                              onChange={e => setNewGroup(p => ({ ...p, maxSelect: e.target.value }))}
                              placeholder="최대 N개"
                              className="w-20 border border-gray-border rounded-lg px-2 py-1 text-[12px]"
                            />
                          )}
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => { setAddingGroup(false); setNewGroup({ name: '', isRequired: false, isMulti: false, maxSelect: '' }) }}
                            className="px-3 py-1.5 text-[12px] font-bold text-gray-text border border-gray-border rounded-lg hover:bg-gray-bg">
                            취소
                          </button>
                          <button
                            onClick={confirmAddGroup}
                            disabled={!newGroup.name.trim()}
                            className="px-3 py-1.5 text-[12px] font-bold text-white bg-green rounded-lg hover:bg-[#015c28] disabled:opacity-40 disabled:cursor-not-allowed">
                            그룹 추가
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 빈 상태 */}
                    {selected.optionGroups.length === 0 && !addingGroup && (
                      <div className="text-[13px] text-gray-text text-center py-6 border border-dashed border-gray-border rounded-xl">
                        연결된 옵션 그룹 없음
                      </div>
                    )}

                    {/* 그룹 카드 목록 */}
                    <div className="space-y-3">
                      {selected.optionGroups.map(group => (
                        <OptionGroupCard
                          key={group.id}
                          group={group}
                          onUpdateGroup={updates => updateGroup(group.id, updates)}
                          onDeleteGroup={() => deleteGroup(group.id)}
                          onUpdateItem={(itemId, updates) => updateItem(group.id, itemId, updates)}
                          onDeleteItem={itemId => deleteItem(group.id, itemId)}
                          onAddItem={(name, extra) => addItem(group.id, name, extra)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-text text-[13px]">
                메뉴를 선택하면 상세 정보가 표시됩니다
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 옵션 탭 ── */}
      {tab === 'option' && (
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {storeGroups.map(group => (
            <div key={group.id} className="border border-gray-border rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 bg-gray-bg border-b border-gray-border">
                <div>
                  <span className="font-bold text-[14px] text-ink">{group.name}</span>
                  <span className="ml-2 text-[11px] text-gray-text">이 옵션을 사용하는 메뉴 {group.usedBy}개</span>
                </div>
              </div>
              <div className="divide-y divide-gray-border">
                {group.items.map(item => (
                  <div key={item.id}
                    className={`flex items-center justify-between px-5 py-3 text-[13px] ${item.hidden ? 'opacity-50' : ''}`}>
                    <div>
                      <span className="font-semibold text-ink">{item.name}</span>
                      {item.extra > 0 && <span className="ml-2 text-gray-text">+{won(item.extra)}</span>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => toggleStoreOptItem(group.id, item.id, 'soldOut')}
                        className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors
                          ${item.soldOut ? 'bg-danger text-white border-danger' : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}>
                        {item.soldOut ? '품절 해제' : '품절'}
                      </button>
                      <button onClick={() => toggleStoreOptItem(group.id, item.id, 'hidden')}
                        className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors
                          ${item.hidden ? 'bg-ink text-white border-ink' : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}>
                        숨김
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 카테고리 탭 ── */}
      {tab === 'category' && (
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-[15px] font-extrabold">카테고리 관리</div>
              <div className="text-[12px] text-gray-text mt-0.5">
                웹 주문 페이지에서 거래처명 바로 아래에 표시되는 탭 목록입니다. 순서대로 노출됩니다.
              </div>
            </div>
            {!addingCat && (
              <button onClick={() => { setAddingCat(true); setNewCatName('') }}
                className="px-4 py-2 text-[13px] font-bold text-white bg-[#16a84c] rounded-lg hover:bg-[#128040] transition-colors flex-shrink-0">
                + 카테고리 추가
              </button>
            )}
          </div>

          {/* 카테고리 추가 폼 */}
          {addingCat && (
            <div className="flex items-center gap-2 mt-4 mb-2 p-3 border-2 border-green rounded-xl bg-green-soft/20">
              <input
                autoFocus
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newCatName.trim()) { addCategory(newCatName); setNewCatName(''); setAddingCat(false) }
                  if (e.key === 'Escape') setAddingCat(false)
                }}
                placeholder="카테고리 이름 (예: 리뷰이벤트, 이달의메뉴)"
                className="flex-1 border border-gray-border rounded-lg px-3 py-2 text-[13px]"
              />
              <button
                onClick={() => { if (newCatName.trim()) { addCategory(newCatName); setNewCatName(''); setAddingCat(false) } }}
                disabled={!newCatName.trim()}
                className="px-4 py-2 text-[13px] font-bold text-white bg-green rounded-lg hover:bg-[#015c28] disabled:opacity-40">
                추가
              </button>
              <button onClick={() => setAddingCat(false)}
                className="px-3 py-2 text-[13px] font-bold text-gray-text border border-gray-border rounded-lg hover:bg-gray-bg">
                취소
              </button>
            </div>
          )}

          {/* 카테고리 목록 */}
          <div className="mt-4 border border-gray-border rounded-xl overflow-hidden divide-y divide-gray-border">
            {sortedCategories().length === 0 && (
              <div className="py-10 text-center text-[13px] text-gray-text">
                카테고리가 없습니다. 위에서 추가해주세요.
              </div>
            )}
            {sortedCategories().map((cat, idx, arr) => (
              <div key={cat.id} className="flex items-center gap-3 px-5 py-3 bg-white hover:bg-gray-bg/50 group/cat">

                {/* 순서 버튼 */}
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <button
                    onClick={() => moveCategoryUp(cat.id)}
                    disabled={idx === 0}
                    className="w-6 h-5 flex items-center justify-center text-[11px] text-gray-text hover:text-ink disabled:opacity-20 disabled:cursor-not-allowed">
                    ▲
                  </button>
                  <button
                    onClick={() => moveCategoryDown(cat.id)}
                    disabled={idx === arr.length - 1}
                    className="w-6 h-5 flex items-center justify-center text-[11px] text-gray-text hover:text-ink disabled:opacity-20 disabled:cursor-not-allowed">
                    ▼
                  </button>
                </div>

                {/* 순서 번호 */}
                <span className="text-[12px] font-bold text-gray-text w-5 text-center flex-shrink-0">
                  {idx + 1}
                </span>

                {/* 카테고리명 (인라인 편집) */}
                {editingCatId === cat.id ? (
                  <input
                    autoFocus
                    value={catNameDraft}
                    onChange={e => setCatNameDraft(e.target.value)}
                    onBlur={() => {
                      if (catNameDraft.trim()) renameCategory(cat.id, catNameDraft)
                      setEditingCatId(null)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        if (catNameDraft.trim()) renameCategory(cat.id, catNameDraft)
                        setEditingCatId(null)
                      }
                      if (e.key === 'Escape') setEditingCatId(null)
                    }}
                    className="flex-1 border border-green rounded-lg px-3 py-1.5 text-[14px] font-semibold"
                  />
                ) : (
                  <button
                    onClick={() => { setCatNameDraft(cat.name); setEditingCatId(cat.id) }}
                    className="flex-1 text-left text-[14px] font-semibold text-ink hover:text-green transition-colors">
                    {cat.name}
                  </button>
                )}

                {/* 메뉴 수 */}
                <span className="text-[12px] text-gray-text flex-shrink-0">
                  메뉴 {menuCountInCategory(cat.id)}개
                </span>

                {/* 삭제 */}
                {deletingCatId === cat.id ? (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[11px] text-danger font-semibold">삭제?</span>
                    <button onClick={() => { deleteCategory(cat.id); setDeletingCatId(null) }}
                      className="text-[11px] font-bold text-white bg-danger px-2 py-0.5 rounded-lg hover:bg-danger/80">
                      확인
                    </button>
                    <button onClick={() => setDeletingCatId(null)}
                      className="text-[11px] font-bold text-gray-text border border-gray-border px-2 py-0.5 rounded-lg hover:bg-gray-bg">
                      취소
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeletingCatId(cat.id)}
                    className="text-[13px] text-gray-text hover:text-danger transition-colors opacity-0 group-hover/cat:opacity-100 flex-shrink-0">
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* 미지정 메뉴 목록 */}
          {(() => {
            const uncat = menus.filter(m => !m.categoryId)
            if (uncat.length === 0) return null
            return (
              <div className="mt-6">
                <div className="text-[12px] font-bold text-gray-text uppercase tracking-wide mb-2">
                  카테고리 미지정 메뉴 · {uncat.length}개
                </div>
                <div className="flex flex-wrap gap-2">
                  {uncat.map(m => (
                    <span key={m.code} className="text-[12px] font-semibold text-gray-text bg-gray-bg border border-gray-border rounded-full px-3 py-1">
                      {m.emoji} {m.name}
                    </span>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── 메뉴 추가 모달 ── */}
      {addMenuOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAddMenuOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-[420px] overflow-hidden" onClick={e => e.stopPropagation()}>

            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-border">
              <span className="text-[16px] font-extrabold">메뉴 추가</span>
              <button onClick={() => setAddMenuOpen(false)} className="text-gray-text hover:text-ink text-[18px]">✕</button>
            </div>

            {/* 폼 */}
            <div className="px-6 py-5 space-y-4">

              {/* 이모지 + 이름 */}
              <div className="flex gap-3">
                <div>
                  <label className="text-[11px] font-bold text-gray-text block mb-1">이모지</label>
                  <input
                    value={addForm.emoji}
                    onChange={e => setAddForm(p => ({ ...p, emoji: e.target.value }))}
                    placeholder="🍽️"
                    className="w-14 border border-gray-border rounded-lg px-3 py-2 text-[18px] text-center"
                    maxLength={2}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] font-bold text-gray-text block mb-1">메뉴명 *</label>
                  <input
                    autoFocus
                    value={addForm.name}
                    onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && confirmAddMenu()}
                    placeholder="예: 클래식 포케"
                    className="w-full border border-gray-border rounded-lg px-3 py-2 text-[13px]"
                  />
                </div>
              </div>

              {/* 기본 가격 */}
              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">기본 가격 (원) *</label>
                <input
                  type="number" min="0" step="100"
                  value={addForm.price}
                  onChange={e => setAddForm(p => ({ ...p, price: e.target.value }))}
                  placeholder="0"
                  className="w-full border border-gray-border rounded-lg px-3 py-2 text-[13px]"
                />
              </div>

              {/* 카테고리 */}
              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">카테고리</label>
                <select
                  value={addForm.categoryId}
                  onChange={e => setAddForm(p => ({ ...p, categoryId: e.target.value }))}
                  className="w-full border border-gray-border rounded-lg px-3 py-2 text-[13px] bg-white">
                  <option value="">카테고리 없음</option>
                  {sortedCategories().map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* 설명 */}
              <div>
                <label className="text-[11px] font-bold text-gray-text block mb-1">설명</label>
                <textarea
                  value={addForm.description}
                  onChange={e => setAddForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="메뉴 설명 (선택)"
                  rows={2}
                  className="w-full border border-gray-border rounded-lg px-3 py-2 text-[13px] resize-none"
                />
              </div>
            </div>

            {/* 액션 버튼 */}
            <div className="flex gap-3 px-6 pb-5">
              <button onClick={() => setAddMenuOpen(false)}
                className="flex-1 py-3 rounded-xl border border-gray-border text-[13px] font-bold text-gray-text hover:bg-gray-bg transition-colors">
                취소
              </button>
              <button
                onClick={confirmAddMenu}
                disabled={!addForm.name.trim() || !addForm.price}
                className="flex-[2] py-3 rounded-xl bg-[#16a84c] text-white text-[13px] font-bold hover:bg-[#128040] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 플로팅 일괄 액션바 */}
      {tab === 'menu' && checked.size > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-ink text-white rounded-2xl shadow-xl px-6 py-3 flex items-center gap-4 z-30">
          <span className="text-[13px] font-semibold text-white/70">{checked.size}개 선택</span>
          <div className="w-px h-5 bg-white/20" />
          {([
            { label: '품절',      action: 'soldOut'   as const },
            { label: '품절 해제', action: 'unsoldOut' as const },
            { label: '숨김',      action: 'hide'      as const },
            { label: '숨김 해제', action: 'unhide'    as const },
          ]).map(({ label, action }, i) => (
            <>
              {i > 0 && <div key={`sep-${action}`} className="w-px h-5 bg-white/20" />}
              <button key={action} onClick={() => bulkAction(action)}
                className="text-[13px] font-bold hover:text-green transition-colors">
                {label}
              </button>
            </>
          ))}
          <button onClick={() => setChecked(new Set())}
            className="text-white/50 hover:text-white text-[18px] ml-1">✕</button>
        </div>
      )}
    </div>
  )
}

// ── OptionGroupCard ────────────────────────────────────────────────────────────
// 그룹명, 필수/단일 여부, 항목 이름/가격 인라인 편집 + 추가/삭제
function OptionGroupCard({
  group,
  onUpdateGroup,
  onDeleteGroup,
  onUpdateItem,
  onDeleteItem,
  onAddItem,
}: {
  group:          OptionGroup
  onUpdateGroup:  (updates: Partial<OptionGroup>) => void
  onDeleteGroup:  () => void
  onUpdateItem:   (itemId: string, updates: Partial<OptionItem>) => void
  onDeleteItem:   (itemId: string) => void
  onAddItem:      (name: string, extra: number) => void
}) {
  // 그룹명 인라인 편집
  const [editingName, setEditingName] = useState(false)
  const [nameDraft,   setNameDraft]   = useState(group.name)

  // 항목 인라인 편집
  const [editingItemId,   setEditingItemId]   = useState<string | null>(null)
  const [editItemName,    setEditItemName]    = useState('')
  const [editItemPrice,   setEditItemPrice]   = useState('')

  // 항목 추가 폼
  const [showAddItem,  setShowAddItem]  = useState(false)
  const [newItemName,  setNewItemName]  = useState('')
  const [newItemPrice, setNewItemPrice] = useState('0')

  // 선택 방식 드롭다운
  const [selectModeOpen, setSelectModeOpen] = useState(false)

  // 설정 모달
  const [settingsOpen,  setSettingsOpen]  = useState(false)
  const [settingsName,  setSettingsName]  = useState(group.name)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const SELECT_OPTIONS = [
    { label: '단일 선택',    isMulti: false, max: null },
    { label: '복수 (무제한)', isMulti: true,  max: null },
    { label: '최대 2개',     isMulti: true,  max: 2    },
    { label: '최대 3개',     isMulti: true,  max: 3    },
    { label: '최대 4개',     isMulti: true,  max: 4    },
    { label: '최대 5개',     isMulti: true,  max: 5    },
  ]

  const currentLabel = !group.isMulti
    ? '단일'
    : group.maxSelect
      ? `최대 ${group.maxSelect}개`
      : '복수'

  function commitGroupName() {
    if (nameDraft.trim()) onUpdateGroup({ name: nameDraft.trim() })
    else setNameDraft(group.name)
    setEditingName(false)
  }

  function startEditItem(item: OptionItem) {
    setEditingItemId(item.id)
    setEditItemName(item.name)
    setEditItemPrice(String(item.extra))
  }

  function commitEditItem() {
    if (!editingItemId || !editItemName.trim()) { setEditingItemId(null); return }
    onUpdateItem(editingItemId, {
      name:  editItemName.trim(),
      extra: Math.max(0, parseInt(editItemPrice, 10) || 0),
    })
    setEditingItemId(null)
  }

  function confirmAddItem() {
    if (!newItemName.trim()) return
    onAddItem(newItemName.trim(), Math.max(0, parseInt(newItemPrice, 10) || 0))
    setNewItemName('')
    setNewItemPrice('0')
    setShowAddItem(false)
  }

  return (
    <div className="border border-gray-border rounded-xl overflow-hidden">

      {/* 그룹 헤더 */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-bg border-b border-gray-border">
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={commitGroupName}
            onKeyDown={e => { if (e.key === 'Enter') commitGroupName(); if (e.key === 'Escape') { setNameDraft(group.name); setEditingName(false) } }}
            className="flex-1 min-w-0 border border-green rounded-md px-2 py-0.5 text-[13px] font-bold bg-white"
          />
        ) : (
          <button
            onClick={() => { setNameDraft(group.name); setEditingName(true) }}
            className="font-bold text-[13px] text-ink hover:text-green transition-colors truncate text-left"
            title="클릭하여 그룹명 편집">
            {group.name}
          </button>
        )}

        {/* 필수/선택 토글 */}
        <button
          onClick={() => onUpdateGroup({ isRequired: !group.isRequired })}
          className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full transition-colors
            ${group.isRequired ? 'bg-ink text-white hover:bg-gray-text' : 'bg-gray-border text-gray-text hover:bg-gray-text hover:text-white'}`}
          title="클릭하여 필수/선택 전환">
          {group.isRequired ? '필수' : '선택'}
        </button>

        {/* 선택 방식 드롭다운 */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setSelectModeOpen(o => !o)}
            className="text-[10px] font-semibold text-gray-text hover:text-ink transition-colors flex items-center gap-0.5">
            {currentLabel} ▾
          </button>
          {selectModeOpen && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-border rounded-xl shadow-lg z-20 min-w-[120px] overflow-hidden">
              {SELECT_OPTIONS.map(opt => {
                const active = group.isMulti === opt.isMulti && group.maxSelect === opt.max
                return (
                  <button
                    key={opt.label}
                    onClick={() => {
                      onUpdateGroup({ isMulti: opt.isMulti, maxSelect: opt.max })
                      setSelectModeOpen(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-[12px] font-semibold transition-colors
                      ${active ? 'bg-green-soft text-green' : 'hover:bg-gray-bg text-ink'}`}>
                    {opt.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* 설정 버튼 */}
        <button
          onClick={() => { setSettingsName(group.name); setDeleteConfirm(false); setSettingsOpen(true) }}
          className="flex-shrink-0 text-[15px] text-gray-text hover:text-ink transition-colors leading-none"
          title="옵션 그룹 설정">
          ⚙
        </button>
      </div>

      {/* ── 설정 모달 ── */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-[380px]">
            <div className="flex items-center justify-between mb-5">
              <div className="text-[16px] font-extrabold">옵션 그룹 설정</div>
              <button onClick={() => setSettingsOpen(false)} className="text-gray-text hover:text-ink text-[18px]">✕</button>
            </div>

            {/* 그룹명 */}
            <div className="mb-4">
              <label className="text-[11px] font-bold text-gray-text block mb-1">그룹명</label>
              <input
                value={settingsName}
                onChange={e => setSettingsName(e.target.value)}
                className="w-full border-0 border-b border-gray-border bg-transparent px-0 py-2 text-[14px] focus:outline-none focus:border-b-2 focus:border-[#16a84c] transition-colors"
              />
            </div>

            {/* 필수 여부 */}
            <div className="mb-4">
              <label className="text-[11px] font-bold text-gray-text block mb-2">필수 여부</label>
              <div className="flex gap-2">
                {[{ label: '필수', val: true }, { label: '선택', val: false }].map(({ label, val }) => (
                  <button
                    key={label}
                    onClick={() => onUpdateGroup({ isRequired: val })}
                    className={`flex-1 py-2 rounded-xl border-2 text-[13px] font-bold transition-colors focus:outline-none
                      ${group.isRequired === val ? 'border-[#16a84c] text-[#16a84c] bg-green-soft' : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 선택 방식 */}
            <div className="mb-6">
              <label className="text-[11px] font-bold text-gray-text block mb-2">선택 방식</label>
              <div className="grid grid-cols-3 gap-2">
                {SELECT_OPTIONS.map(opt => {
                  const active = group.isMulti === opt.isMulti && group.maxSelect === opt.max
                  return (
                    <button
                      key={opt.label}
                      onClick={() => onUpdateGroup({ isMulti: opt.isMulti, maxSelect: opt.max })}
                      className={`py-2 rounded-xl border-2 text-[12px] font-bold transition-colors focus:outline-none
                        ${active ? 'border-[#16a84c] text-[#16a84c] bg-green-soft' : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}>
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 저장 버튼 */}
            <button
              onClick={() => {
                if (settingsName.trim()) onUpdateGroup({ name: settingsName.trim() })
                setSettingsOpen(false)
              }}
              className="w-full py-3 rounded-xl bg-[#16a84c] text-white font-bold text-[14px] hover:bg-[#128040] transition-colors focus:outline-none mb-3"
            >
              저장
            </button>

            {/* 삭제 */}
            {!deleteConfirm ? (
              <button
                onClick={() => setDeleteConfirm(true)}
                className="w-full py-2.5 rounded-xl border-2 border-danger/40 text-danger font-bold text-[13px] hover:bg-red-50 transition-colors focus:outline-none"
              >
                삭제
              </button>
            ) : (
              <div className="bg-red-50 rounded-xl p-3">
                <div className="text-[12px] text-danger font-semibold text-center mb-2">정말 삭제하시겠어요?</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteConfirm(false)}
                    className="flex-1 py-2 rounded-lg border border-gray-border text-gray-text text-[12px] font-bold hover:bg-gray-bg focus:outline-none"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => { onDeleteGroup(); setSettingsOpen(false) }}
                    className="flex-1 py-2 rounded-lg bg-danger text-white text-[12px] font-bold hover:bg-danger/90 focus:outline-none"
                  >
                    삭제 확정
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 항목 목록 */}
      <div className="divide-y divide-gray-border">
        {group.items.map((item: OptionItem) =>
          editingItemId === item.id ? (
            // ── 편집 모드 행 ──
            <div key={item.id} className="flex items-center gap-3 px-4 py-2">
              <input
                autoFocus
                value={editItemName}
                onChange={e => setEditItemName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitEditItem(); if (e.key === 'Escape') setEditingItemId(null) }}
                placeholder="옵션명"
                className="flex-1 min-w-0 border-0 border-b border-[#16a84c] bg-transparent px-0 py-1 text-[13px] focus:outline-none"
              />
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className="flex items-center gap-0.5 border-b border-[#16a84c]">
                  <span className="text-[13px] text-gray-text">+</span>
                  <input
                    type="text"
                    value={editItemPrice}
                    onChange={e => setEditItemPrice(e.target.value.replace(/[^0-9]/g, ''))}
                    onKeyDown={e => { if (e.key === 'Enter') commitEditItem(); if (e.key === 'Escape') setEditingItemId(null) }}
                    className="w-16 border-0 bg-transparent px-0 py-1 text-[13px] text-right focus:outline-none"
                  />
                  <span className="text-[12px] text-gray-text">원</span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setEditItemPrice(String(Math.max(0, (parseInt(editItemPrice) || 0) - 500)))}
                    className="bg-gray-100 hover:bg-gray-200 rounded-md px-2 py-1 text-[11px] font-semibold text-gray-text transition-colors">
                    -500
                  </button>
                  <button
                    onClick={() => setEditItemPrice(String((parseInt(editItemPrice) || 0) + 500))}
                    className="bg-gray-100 hover:bg-gray-200 rounded-md px-2 py-1 text-[11px] font-semibold text-gray-text transition-colors">
                    +500
                  </button>
                </div>
              </div>
              <button
                onClick={commitEditItem}
                className="flex-shrink-0 px-3 py-1 rounded-lg bg-[#16a84c] text-white text-[11px] font-bold hover:bg-[#128040] transition-colors">
                완료
              </button>
            </div>
          ) : (
            // ── 일반 행 ──
            <div
              key={item.id}
              className={`flex items-center gap-2 px-4 py-2.5 text-[12px] group/row transition-colors
                ${item.soldOut ? 'bg-red-50' : ''}
                ${item.hidden ? 'opacity-50' : ''}`}
            >
              {/* 이름 + 배지 (클릭 시 편집 모드) */}
              <button
                onClick={() => startEditItem(item)}
                className="flex items-center gap-1.5 min-w-0 flex-1 text-left hover:text-green transition-colors"
                title="클릭하여 편집">
                <span className="font-medium text-ink truncate">{item.name}</span>
                {item.isPopular && (
                  <span className="text-[10px] font-bold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full flex-shrink-0">🔥</span>
                )}
                {item.extra > 0 && (
                  <span className="text-gray-text flex-shrink-0">+{won(item.extra)}</span>
                )}
              </button>

              {/* 상태 토글 */}
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => onUpdateItem(item.id, { soldOut: !item.soldOut })}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors
                    ${item.soldOut ? 'bg-danger text-white border-danger' : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}>
                  품절
                </button>
                <button
                  onClick={() => onUpdateItem(item.id, { hidden: !item.hidden })}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors
                    ${item.hidden ? 'bg-ink text-white border-ink' : 'border-gray-border text-gray-text hover:bg-gray-bg'}`}>
                  숨김
                </button>
                <button
                  onClick={() => onDeleteItem(item.id)}
                  className="text-[14px] text-gray-text hover:text-danger transition-colors px-0.5 opacity-0 group-hover/row:opacity-100"
                  title="항목 삭제">
                  ×
                </button>
              </div>
            </div>
          )
        )}
      </div>

      {/* 항목 추가 폼 / 버튼 */}
      {showAddItem ? (
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-gray-border bg-green-soft/40">
          <input
            autoFocus
            value={newItemName}
            onChange={e => setNewItemName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirmAddItem(); if (e.key === 'Escape') setShowAddItem(false) }}
            placeholder="옵션명"
            className="flex-1 min-w-0 border border-green rounded-md px-2 py-1 text-[12px]"
          />
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[11px] text-gray-text">+₩</span>
            <input
              type="number" min="0" step="500"
              value={newItemPrice}
              onChange={e => setNewItemPrice(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmAddItem(); if (e.key === 'Escape') setShowAddItem(false) }}
              placeholder="0"
              className="w-20 border border-green rounded-md px-2 py-1 text-[12px]"
            />
          </div>
          <button onClick={confirmAddItem}
            disabled={!newItemName.trim()}
            className="flex-shrink-0 text-[11px] font-bold text-white bg-green px-2.5 py-1 rounded-lg hover:bg-[#015c28] disabled:opacity-40">
            추가
          </button>
          <button onClick={() => { setShowAddItem(false); setNewItemName(''); setNewItemPrice('0') }}
            className="flex-shrink-0 text-gray-text hover:text-ink text-[14px]">✗</button>
        </div>
      ) : (
        <button
          onClick={() => setShowAddItem(true)}
          className="w-full py-2 text-[12px] font-bold text-gray-text hover:text-green hover:bg-green-soft/30 transition-colors border-t border-gray-border">
          + 항목 추가
        </button>
      )}
    </div>
  )
}
