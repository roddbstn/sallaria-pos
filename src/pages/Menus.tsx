import { useState, useEffect, useRef, useMemo } from 'react'
import { SegmentedControl } from '../components/SegmentedControl'
import { type MenuDetail, type Category, type OptionGroup, type OptionItem } from '../lib/mock-data'
import { won } from '../lib/ipc'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store-context'
import { useHeaderSlot } from '../lib/header-slot'

type MenuTab      = 'menu' | 'option' | 'category'
type StatusFilter = 'all' | 'active' | 'soldOut' | 'hidden'
type TagFilter    = 'popular' | 'recommended' | 'new' | null
type SoldOutState = 'active' | 'today' | 'permanent'

// ── 품절 상태 헬퍼 ────────────────────────────────────────────────────────────
function getSoldOutState(soldOut: boolean, soldOutUntil: string | null | undefined): SoldOutState {
  if (!soldOut) return 'active'
  if (soldOutUntil) return 'today'
  return 'permanent'
}

// KST 오늘 자정 (23:59:59) ISO string 반환 (POS 앱은 KST 환경에서 실행)
function getKSTEndOfDay(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

// ── DB row → 내부 타입 변환 ───────────────────────────────────────────────────
function mapDbMenu(row: any): MenuDetail {
  const optionGroups: OptionGroup[] = (row.menu_option_groups ?? [])
    .sort((a: any, b: any) => a.display_order - b.display_order)
    .map((mog: any) => {
      const g = mog.option_groups
      if (!g) return null
      return {
        id:         g.id,
        name:       g.name,
        isRequired: g.is_required,
        isMulti:    g.is_multi,
        maxSelect:  g.max_select ?? null,
        items:      (g.option_items ?? [])
          .sort((a: any, b: any) => a.display_order - b.display_order)
          .map((it: any): OptionItem => ({
            id:           it.id,
            name:         it.name,
            extra:        it.extra_price,
            soldOut:      it.is_sold_out,
            soldOutUntil: it.sold_out_until ?? null,
            hidden:       it.is_hidden,
            isPopular:    it.is_popular,
          })),
      } as OptionGroup
    })
    .filter(Boolean) as OptionGroup[]

  return {
    code:          row.id,
    name:          row.name,
    emoji:         '🍽️',
    price:         row.base_price,
    description:   row.description ?? '',
    imageUrl:      row.image_url ?? undefined,
    categoryId:    row.category_id,
    active:        !row.is_hidden,
    soldOut:       row.is_sold_out,
    soldOutUntil:  row.sold_out_until ?? null,
    order:         row.display_order,
    isPopular:     row.is_popular     ?? false,
    isRecommended: row.is_recommended ?? false,
    isNew:         row.is_new         ?? false,
    optionGroups,
  }
}

// ── 스토어 옵션 그룹 (옵션 탭용) ─────────────────────────────────────────────
interface StoreOptionGroup {
  id:           string
  name:         string
  isRequired:   boolean
  isMulti:      boolean
  maxSelect:    number | null
  isSoldOut:    boolean
  soldOutUntil: string | null
  isHidden:     boolean
  usedBy:       string[]
  usedByMenus:  { name: string; soldOut: boolean; hidden: boolean }[]
  items:        { id: string; name: string; extra: number; soldOut: boolean; soldOutUntil: string | null; hidden: boolean }[]
}

export default function Menus() {
  const { storeId, plan } = useStore()
  const { setHeaderRight } = useHeaderSlot()

  const [tab,          setTab]          = useState<MenuTab>('menu')
  const [menus,        setMenus]        = useState<MenuDetail[]>([])
  const [categories,   setCategories]   = useState<Category[]>([])
  const [storeGroups,  setStoreGroups]  = useState<StoreOptionGroup[]>([])
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [catFilter,    setCatFilter]    = useState<string>('all')
  const [tagFilter,    setTagFilter]    = useState<TagFilter>(null)
  const [checked,      setChecked]      = useState<Set<string>>(new Set())
  const [selected,     setSelected]     = useState<MenuDetail | null>(null)
  const [loading,      setLoading]      = useState(true)

  const [deleteConfirm, setDeleteConfirm] = useState<'bulk' | 'single' | null>(null)

  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', price: '', description: '', soldOutState: 'active' as SoldOutState, active: true, categoryId: '' })
  const [editImageFile,    setEditImageFile]    = useState<File | null>(null)
  const [editImagePreview, setEditImagePreview] = useState('')
  const [editImageError,   setEditImageError]   = useState('')
  const [editSaving,       setEditSaving]       = useState(false)
  const [addingGroup,      setAddingGroup]      = useState(false)
  const [connectingGroup,  setConnectingGroup]  = useState(false)
  const [connectGroupId,   setConnectGroupId]   = useState('')

  const [addingStoreGroup, setAddingStoreGroup] = useState(false)
  const [newStoreGroup,    setNewStoreGroup]    = useState({ name: '', isRequired: false, isMulti: false, maxSelect: '' })
  const [addOptStep,       setAddOptStep]       = useState<1|2|3>(1)
  const [newGroupItems,    setNewGroupItems]    = useState<{ id: string; name: string; price: string }[]>([{ id: crypto.randomUUID(), name: '', price: '' }])
  const [step3CatId,       setStep3CatId]       = useState('')
  const [step3MenuIds,     setStep3MenuIds]     = useState<Set<string>>(new Set())
  const [addOptLoading,    setAddOptLoading]    = useState(false)

  const [addingCat,          setAddingCat]          = useState(false)
  const [newCatName,         setNewCatName]         = useState('')
  const [expandedCatId,      setExpandedCatId]      = useState<string | null>(null)
  const catRowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [catEditModalId,     setCatEditModalId]     = useState<string | null>(null)
  const [catEditNameDraft,   setCatEditNameDraft]   = useState('')
  const [catEditChecked,     setCatEditChecked]     = useState<Set<string>>(new Set())
  const [catEditSaving,      setCatEditSaving]      = useState(false)
  const [catEditSearch,      setCatEditSearch]      = useState('')
  const [dragId,             setDragId]             = useState<string | null>(null)
  const [dragOverId,         setDragOverId]         = useState<string | null>(null)
  const [catDeleteModalId,   setCatDeleteModalId]   = useState<string | null>(null)
  const [catDeleteRemap,     setCatDeleteRemap]     = useState<Record<string, string>>({}) // menuCode → 새 categoryId

  const [addMenuOpen,   setAddMenuOpen]   = useState(false)
  const [addModalTab,   setAddModalTab]   = useState<'bulk' | 'detail'>('bulk')
  const [addCategoryId, setAddCategoryId] = useState('')
  const [addingNewCat,  setAddingNewCat]  = useState(false)
  const [newCatInModal, setNewCatInModal] = useState('')
  // 일괄 추가
  const [addRows, setAddRows] = useState<{ id: string; name: string; price: string; imageFile?: File; imagePreview?: string }[]>([
    { id: crypto.randomUUID(), name: '', price: '', imageFile: undefined, imagePreview: '' },
  ])
  // 상세 추가
  const [detailForm, setDetailForm] = useState({ name: '', price: '', description: '' })
  const [imageFile,  setImageFile]  = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState('')
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [addError,   setAddError]   = useState('')
  const [addLoading, setAddLoading] = useState(false)

  // ── 옵션 탭 선택 상태 ─────────────────────────────────────────────────────
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  const [optionSearch, setOptionSearch] = useState('')
  const [optionFilter, setOptionFilter] = useState<'all' | 'active' | 'soldOut' | 'hidden'>('all')

  const [catJumpOpen, setCatJumpOpen] = useState(false)

  const filteredStoreGroups = useMemo(() => storeGroups.filter(g => {
    if (optionFilter === 'active')  return !g.isSoldOut && !g.isHidden && g.items.every(it => !it.soldOut && !it.hidden)
    if (optionFilter === 'soldOut') return g.isSoldOut || g.items.some(it => it.soldOut)
    if (optionFilter === 'hidden')  return g.isHidden  || g.items.some(it => it.hidden)
    return true
  }).filter(g => {
    if (!optionSearch.trim()) return true
    return g.name.includes(optionSearch) || g.items.some(it => it.name.includes(optionSearch))
  }), [storeGroups, optionFilter, optionSearch])

  // ── 카테고리 조회 ──────────────────────────────────────────────────────────
  async function fetchCategories(): Promise<Category[]> {
    if (!storeId) return []
    const { data } = await supabase
      .from('categories')
      .select('id, name, display_order')
      .eq('store_id', storeId)
      .order('display_order')
    const cats = (data ?? []).map((c: any): Category => ({
      id:           c.id,
      name:         c.name,
      displayOrder: c.display_order,
    }))
    setCategories(cats)
    return cats
  }

  // ── 메뉴 조회 (카테고리 IDs로 필터) ──────────────────────────────────────
  async function fetchMenus(catIds: string[]) {
    if (catIds.length === 0) { setMenus([]); return }
    const { data } = await supabase
      .from('menus')
      .select(`
        id, category_id, name, description, base_price, image_url,
        is_sold_out, sold_out_until, is_hidden, display_order, is_popular, is_recommended, is_new,
        menu_option_groups (
          display_order,
          option_groups (
            id, name, is_required, is_multi, max_select,
            option_items (
              id, name, extra_price, is_popular, is_sold_out, sold_out_until, is_hidden, display_order
            )
          )
        )
      `)
      .in('category_id', catIds)
      .order('display_order')
    setMenus((data ?? []).map(mapDbMenu))
  }

  // ── 스토어 옵션 그룹 조회 (옵션 탭) ─────────────────────────────────────
  async function fetchStoreGroups() {
    if (!storeId) return
    const { data } = await supabase
      .from('option_groups')
      .select(`
        id, name, display_order, is_required, is_multi, max_select, is_sold_out, sold_out_until, is_hidden,
        option_items ( id, name, extra_price, is_sold_out, sold_out_until, is_hidden, display_order ),
        menu_option_groups ( menu_id, menus ( name, is_sold_out, is_hidden ) )
      `)
      .eq('store_id', storeId)
      .not('name', 'ilike', '가격(필수)%')
      .order('name')

    setStoreGroups((data ?? []).map((g: any) => ({
      id:           g.id,
      name:         g.name,
      isRequired:   g.is_required   ?? false,
      isMulti:      g.is_multi      ?? false,
      maxSelect:    g.max_select    ?? null,
      isSoldOut:    g.is_sold_out   ?? false,
      soldOutUntil: g.sold_out_until ?? null,
      isHidden:     g.is_hidden     ?? false,
      usedBy:     (g.menu_option_groups ?? []).map((m: any) => m.menus?.name).filter(Boolean),
      usedByMenus: (g.menu_option_groups ?? [])
        .map((m: any) => m.menus)
        .filter(Boolean)
        .map((m: any) => ({ name: m.name, soldOut: m.is_sold_out ?? false, hidden: m.is_hidden ?? false })),
      items: (g.option_items ?? [])
        .sort((a: any, b: any) => a.display_order - b.display_order)
        .map((it: any) => ({
          id:           it.id,
          name:         it.name,
          extra:        it.extra_price,
          soldOut:      it.is_sold_out,
          soldOutUntil: it.sold_out_until ?? null,
          hidden:       it.is_hidden,
        })),
    })))
  }

  // ── 헤더 슬롯: 옵션추가 / 메뉴추가 버튼 ─────────────────────────────────
  useEffect(() => {
    setHeaderRight(
      <div className="flex gap-2">
        <button
          onClick={() => { setAddingStoreGroup(true); setNewStoreGroup({ name: '', isRequired: false, isMulti: false, maxSelect: '' }) }}
          className="px-3 py-2 bg-gray-100 text-ink rounded-lg text-[11px] font-bold hover:bg-gray-200 transition-colors"
        >
          옵션 추가
        </button>
        <button
          onClick={openAddMenu}
          className="px-3 py-2 bg-[#00DD67] text-[#1A1A1A] rounded-lg text-[11px] font-bold hover:bg-[#00BB55] transition-colors"
        >
          메뉴 추가
        </button>
      </div>
    )
    return () => setHeaderRight(null)
  }, [])

  // ── 마운트 및 storeId 변경 시 로딩 ──────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      const cats = await fetchCategories()
      await Promise.all([
        fetchMenus(cats.map(c => c.id)),
        fetchStoreGroups(),
      ])
      setLoading(false)
    }
    if (storeId) load()
  }, [storeId])

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
    const matchCat = catFilter === 'all' || m.categoryId === catFilter
    const matchTag =
      tagFilter === null          ? true
      : tagFilter === 'popular'     ? m.isPopular
      : tagFilter === 'recommended' ? m.isRecommended
      : m.isNew
    return matchSearch && matchStatus && matchCat && matchTag
  }).sort((a, b) => {
    // QR오더와 동일하게: 카테고리 display_order 순 → 카테고리 내 메뉴 display_order 순
    const catOrderA = categories.find(c => c.id === a.categoryId)?.displayOrder ?? Infinity
    const catOrderB = categories.find(c => c.id === b.categoryId)?.displayOrder ?? Infinity
    if (catOrderA !== catOrderB) return catOrderA - catOrderB
    return (a.order ?? 0) - (b.order ?? 0)
  })

  // ── 메뉴 태그 토글 ─────────────────────────────────────────────────────────
  async function toggleTag(menu: MenuDetail, tag: 'isPopular' | 'isRecommended' | 'isNew', e: React.MouseEvent) {
    e.stopPropagation()
    const dbField = tag === 'isPopular' ? 'is_popular' : tag === 'isRecommended' ? 'is_recommended' : 'is_new'
    const next = !menu[tag]
    setMenus(prev => prev.map(m => m.code === menu.code ? { ...m, [tag]: next } : m))
    await supabase.from('menus').update({ [dbField]: next }).eq('id', menu.code)
  }

  // ── 메뉴 선택 ──────────────────────────────────────────────────────────────
  function selectMenu(menu: MenuDetail) {
    // 체크된 항목이 1개 이상이면 행 클릭도 체크박스 토글로 처리
    if (checked.size > 0) { toggleCheck(menu.code); return }
    if (selected?.code === menu.code) { setSelected(null); return }
    setSelected(menu)
    setEditMode(false)
    setAddingGroup(false)
  }

  // ── 선택 메뉴 로컬 업데이트 헬퍼 ──────────────────────────────────────────
  function applyLocalUpdate(updated: MenuDetail) {
    setMenus(prev => prev.map(m => m.code === updated.code ? updated : m))
    setSelected(updated)
  }

  // ── 카테고리 CRUD ──────────────────────────────────────────────────────────
  async function addCategory(name: string) {
    if (!storeId) return
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.displayOrder), 0)
    const { data, error } = await supabase
      .from('categories')
      .insert({ store_id: storeId, name: name.trim(), display_order: maxOrder + 1 })
      .select('id, name, display_order')
      .single()
    if (!error && data) {
      setCategories(prev => [...prev, { id: data.id, name: data.name, displayOrder: data.display_order }])
    }
  }

  async function renameCategory(id: string, name: string) {
    await supabase.from('categories').update({ name: name.trim() }).eq('id', id)
    setCategories(prev => prev.map(c => c.id === id ? { ...c, name: name.trim() } : c))
  }

  async function saveCategoryEdit(catId: string, newName: string, menuCodes: Set<string>) {
    setCatEditSaving(true)
    // 이름 변경
    const cat = categories.find(c => c.id === catId)
    if (cat && cat.name !== newName.trim()) {
      await renameCategory(catId, newName.trim())
    }
    // 이 카테고리에 속해야 할 메뉴: menuCodes
    // 현재 이 카테고리에 있는 메뉴: menus.filter(m => m.categoryId === catId)
    const currentInCat = new Set(menus.filter(m => m.categoryId === catId).map(m => m.code))
    const toAdd    = [...menuCodes].filter(c => !currentInCat.has(c))
    const toRemove = [...currentInCat].filter(c => !menuCodes.has(c))
    await Promise.all([
      ...toAdd.map(c    => supabase.from('menus').update({ category_id: catId }).eq('id', c)),
      ...toRemove.map(c => supabase.from('menus').update({ category_id: null  }).eq('id', c)),
    ])
    const toAddSet    = new Set(toAdd)
    const toRemoveSet = new Set(toRemove)
    setMenus(prev => prev.map(m => {
      if (toAddSet.has(m.code))    return { ...m, categoryId: catId }
      if (toRemoveSet.has(m.code)) return { ...m, categoryId: undefined }
      return m
    }))
    setCatEditSaving(false)
    setCatEditModalId(null)
  }

  async function deleteCategory(id: string, remap: Record<string, string> = {}) {
    // 메뉴들을 새 카테고리로 이동
    const remapEntries = Object.entries(remap)
    if (remapEntries.length > 0) {
      const results = await Promise.all(
        remapEntries.map(([menuCode, newCatId]) =>
          supabase.from('menus').update({ category_id: newCatId }).eq('id', menuCode)
        )
      )
      const moveErr = results.find(r => r.error)?.error
      if (moveErr) { alert('메뉴 이동 실패: ' + moveErr.message); return }
      setMenus(prev => prev.map(m => remap[m.code] ? { ...m, categoryId: remap[m.code] } : m))
    }
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) { alert('카테고리 삭제 실패: ' + error.message); return }
    setCategories(prev => prev.filter(c => c.id !== id))
  }

  async function moveCategoryUp(id: string) {
    const sorted = sortedCategories()
    const idx = sorted.findIndex(c => c.id === id)
    if (idx <= 0) return
    const above = sorted[idx - 1]
    const thisOrder = sorted[idx].displayOrder
    const aboveOrder = above.displayOrder
    await Promise.all([
      supabase.from('categories').update({ display_order: aboveOrder }).eq('id', id),
      supabase.from('categories').update({ display_order: thisOrder }).eq('id', above.id),
    ])
    setCategories(prev => prev.map(c => {
      if (c.id === id)       return { ...c, displayOrder: aboveOrder }
      if (c.id === above.id) return { ...c, displayOrder: thisOrder }
      return c
    }))
  }

  async function moveCategoryDown(id: string) {
    const sorted = sortedCategories()
    const idx = sorted.findIndex(c => c.id === id)
    if (idx < 0 || idx >= sorted.length - 1) return
    const below = sorted[idx + 1]
    const thisOrder = sorted[idx].displayOrder
    const belowOrder = below.displayOrder
    await Promise.all([
      supabase.from('categories').update({ display_order: belowOrder }).eq('id', id),
      supabase.from('categories').update({ display_order: thisOrder }).eq('id', below.id),
    ])
    setCategories(prev => prev.map(c => {
      if (c.id === id)       return { ...c, displayOrder: belowOrder }
      if (c.id === below.id) return { ...c, displayOrder: thisOrder }
      return c
    }))
  }

  // ── 카테고리 드래그 앤 드롭 ─────────────────────────────────────────────────
  async function handleCatDrop(targetId: string) {
    if (!dragId || dragId === targetId) return
    const sorted = sortedCategories()
    const fromIdx = sorted.findIndex(c => c.id === dragId)
    const toIdx   = sorted.findIndex(c => c.id === targetId)
    if (fromIdx < 0 || toIdx < 0) return

    const reordered = [...sorted]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)

    const updates = reordered.map((c, i) => ({ id: c.id, order: i + 1 }))
    setCategories(prev => prev.map(c => {
      const u = updates.find(u => u.id === c.id)
      return u ? { ...c, displayOrder: u.order } : c
    }))
    await Promise.all(updates.map(u =>
      supabase.from('categories').update({ display_order: u.order }).eq('id', u.id)
    ))
  }

  // ── 메뉴 추가 ───────────────────────────────────────────────────────────────
  function openAddMenu() {
    setAddModalTab('bulk')
    setAddCategoryId(sortedCategories()[0]?.id ?? '')
    setAddingNewCat(false)
    setNewCatInModal('')
    setAddRows([{ id: crypto.randomUUID(), name: '', price: '', imageFile: undefined, imagePreview: '' }])
    setDetailForm({ name: '', price: '', description: '' })
    setImageFile(null)
    setImagePreview('')
    setSelectedGroupIds([])
    setAddError('')
    setAddLoading(false)
    setAddMenuOpen(true)
  }

  function addRowLine() {
    setAddRows(prev => [...prev, { id: crypto.randomUUID(), name: '', price: '', imageFile: undefined, imagePreview: '' }])
  }

  function removeRowLine(id: string) {
    setAddRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : prev)
  }

  function updateRow(id: string, field: 'name' | 'price', value: string) {
    setAddRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  function updateRowImage(id: string, file: File) {
    const preview = URL.createObjectURL(file)
    setAddRows(prev => prev.map(r => r.id === id ? { ...r, imageFile: file, imagePreview: preview } : r))
  }

  async function confirmAddMenu() {
    setAddError('')

    // 유효한 행만 추출 (이름 + 가격 둘 다 있어야 함)
    const validRows = addRows.filter(r => r.name.trim() && r.price.trim())
    if (validRows.length === 0) { setAddError('메뉴명과 가격을 입력해주세요.'); return }

    const invalidPrice = validRows.find(r => isNaN(parseInt(r.price, 10)) || parseInt(r.price, 10) < 0)
    if (invalidPrice) { setAddError('가격은 0 이상의 숫자여야 합니다.'); return }

    // 카테고리 처리
    let categoryId = addCategoryId
    if (addingNewCat) {
      if (!newCatInModal.trim()) { setAddError('카테고리 이름을 입력해주세요.'); return }
      const maxOrder = categories.reduce((m, c) => Math.max(m, c.displayOrder), 0)
      const { data: catData, error: catErr } = await supabase
        .from('categories')
        .insert({ store_id: storeId, name: newCatInModal.trim(), display_order: maxOrder + 1 })
        .select('id, name, display_order')
        .single()
      if (catErr || !catData) { setAddError('카테고리 생성에 실패했습니다: ' + catErr?.message); return }
      setCategories(prev => [...prev, { id: catData.id, name: catData.name, displayOrder: catData.display_order }])
      categoryId = catData.id
    }

    setAddLoading(true)
    const maxOrder = menus.reduce((m, mn) => Math.max(m, mn.order), 0)

    const inserts = validRows.map((r, i) => ({
      category_id:   categoryId || null,
      name:          r.name.trim(),
      base_price:    parseInt(r.price, 10),
      display_order: maxOrder + 1 + i,
    }))

    const { data, error } = await supabase
      .from('menus')
      .insert(inserts)
      .select('id, category_id, name, description, base_price, is_sold_out, is_hidden, display_order')

    setAddLoading(false)

    if (error || !data) {
      setAddError('저장 실패: ' + (error?.message ?? '알 수 없는 오류'))
      return
    }

    const newMenus: MenuDetail[] = data.map(d => ({
      code:         d.id,
      name:         d.name,
      emoji:        '🍽️',
      price:        d.base_price,
      description:  d.description ?? '',
      categoryId:   d.category_id,
      active:       true,
      soldOut:      false,
      order:        d.display_order,
      optionGroups: [],
    }))

    // 이미지 업로드 (각 행에 이미지가 있으면)
    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i]
      if (!row.imageFile) continue
      const ext = row.imageFile.name.split('.').pop() ?? 'jpg'
      const { data: up, error: upErr } = await supabase.storage
        .from('menu-images')
        .upload(`${crypto.randomUUID()}.${ext}`, row.imageFile, { contentType: row.imageFile.type })
      if (!upErr && up) {
        const imageUrl = supabase.storage.from('menu-images').getPublicUrl(up.path).data.publicUrl
        await supabase.from('menus').update({ image_url: imageUrl }).eq('id', data[i].id)
        newMenus[i] = { ...newMenus[i], imageUrl }
      }
    }

    setMenus(prev => [...prev, ...newMenus])
    setSelected(newMenus[0])
    setAddMenuOpen(false)
  }

  // ── 상세 추가 ─────────────────────────────────────────────────────────────
  async function confirmDetailMenu() {
    setAddError('')
    const price = parseInt(detailForm.price, 10)
    if (!detailForm.name.trim()) { setAddError('메뉴명을 입력해주세요.'); return }
    if (isNaN(price) || price < 0)  { setAddError('가격을 올바르게 입력해주세요.'); return }

    let categoryId = addCategoryId
    if (addingNewCat) {
      if (!newCatInModal.trim()) { setAddError('카테고리 이름을 입력해주세요.'); return }
      const maxOrder = categories.reduce((m, c) => Math.max(m, c.displayOrder), 0)
      const { data: catData, error: catErr } = await supabase
        .from('categories')
        .insert({ store_id: storeId, name: newCatInModal.trim(), display_order: maxOrder + 1 })
        .select('id, name, display_order')
        .single()
      if (catErr || !catData) { setAddError('카테고리 생성 실패: ' + catErr?.message); return }
      setCategories(prev => [...prev, { id: catData.id, name: catData.name, displayOrder: catData.display_order }])
      categoryId = catData.id
    }
    setAddLoading(true)

    let imageUrl: string | null = null
    if (imageFile) {
      const ext = imageFile.name.split('.').pop() ?? 'jpg'
      const { data: up, error: upErr } = await supabase.storage
        .from('menu-images')
        .upload(`${crypto.randomUUID()}.${ext}`, imageFile, { contentType: imageFile.type })
      if (!upErr && up) {
        imageUrl = supabase.storage.from('menu-images').getPublicUrl(up.path).data.publicUrl
      }
    }

    const maxOrder = menus.reduce((m, mn) => Math.max(m, mn.order), 0)
    const { data, error } = await supabase
      .from('menus')
      .insert({
        category_id:   categoryId || null,
        name:          detailForm.name.trim(),
        description:   detailForm.description.trim() || null,
        base_price:    price,
        display_order: maxOrder + 1,
        image_url:     imageUrl,
      })
      .select('id, category_id, name, description, base_price, is_sold_out, is_hidden, display_order')
      .single()

    if (error || !data) { setAddLoading(false); setAddError('저장 실패: ' + error?.message); return }

    if (selectedGroupIds.length > 0) {
      await Promise.all(selectedGroupIds.map((gid, i) =>
        supabase.from('menu_option_groups').insert({ menu_id: data.id, option_group_id: gid, display_order: i })
      ))
    }

    const newMenu: MenuDetail = {
      code:         data.id,
      name:         data.name,
      emoji:        '🍽️',
      price:        data.base_price,
      description:  data.description ?? '',
      imageUrl:     imageUrl ?? undefined,
      categoryId:   data.category_id,
      active:       true,
      soldOut:      false,
      order:        data.display_order,
      optionGroups: selectedGroupIds.map(gid => {
        const g = storeGroups.find(sg => sg.id === gid)
        return g ? { id: g.id, name: g.name, isRequired: false, isMulti: false, maxSelect: null,
          items: g.items.map(it => ({ ...it, isPopular: false })) } : null
      }).filter(Boolean) as OptionGroup[],
    }
    setMenus(prev => [...prev, newMenu])
    setSelected(newMenu)
    setAddLoading(false)
    setAddMenuOpen(false)
  }

  // ── 기본 정보 편집 ──────────────────────────────────────────────────────────
  function startEdit() {
    if (!selected) return
    setEditForm({
      name:         selected.name,
      price:        String(selected.price),
      description:  selected.description,
      soldOutState: getSoldOutState(selected.soldOut, selected.soldOutUntil ?? null),
      active:       selected.active,
      categoryId:   selected.categoryId ?? '',
    })
    setEditImageFile(null)
    setEditImagePreview(selected.imageUrl ?? '')
    setEditMode(true)
  }

  async function saveEdit() {
    if (!selected) return
    const priceNum = parseInt(editForm.price, 10)
    if (!editForm.name.trim() || isNaN(priceNum) || priceNum < 0) return

    setEditSaving(true)
    setEditImageError('')

    let imageUrl: string | undefined = selected.imageUrl

    if (editImageFile) {
      const ext = editImageFile.name.split('.').pop() ?? 'jpg'
      const { data: up, error: upErr } = await supabase.storage
        .from('menu-images')
        .upload(`${crypto.randomUUID()}.${ext}`, editImageFile, { contentType: editImageFile.type })
      if (upErr || !up) {
        setEditImageError(`사진 업로드 실패: ${upErr?.message ?? '알 수 없는 오류'}`)
        setEditSaving(false)
        return
      }
      imageUrl = supabase.storage.from('menu-images').getPublicUrl(up.path).data.publicUrl
    }

    const soldOutUpdates = editForm.soldOutState === 'active'
      ? { is_sold_out: false, sold_out_until: null }
      : editForm.soldOutState === 'today'
      ? { is_sold_out: true, sold_out_until: getKSTEndOfDay() }
      : { is_sold_out: true, sold_out_until: null }

    const { error: updateErr } = await supabase.from('menus').update({
      name:        editForm.name.trim(),
      base_price:  priceNum,
      description: editForm.description || null,
      image_url:   imageUrl ?? null,
      category_id: editForm.categoryId || null,
      is_hidden:   !editForm.active,
      ...soldOutUpdates,
    }).eq('id', selected.code)

    setEditSaving(false)

    if (updateErr) {
      setEditImageError(`저장 실패: ${updateErr.message}`)
      return
    }

    // 가격(필수) 옵션 그룹의 extra_price를 0으로 유지
    // (base_price가 실제 가격 소스 — extra_price가 남아있으면 주문 시 이중 계산됨)
    const gaGyeokGroup = selected.optionGroups.find(g => g.name.startsWith('가격(필수)'))
    if (gaGyeokGroup && gaGyeokGroup.items.some(it => it.extra > 0)) {
      await supabase.from('option_items')
        .update({ extra_price: 0 })
        .eq('option_group_id', gaGyeokGroup.id)
    }

    applyLocalUpdate({
      ...selected,
      name:         editForm.name.trim(),
      price:        priceNum,
      description:  editForm.description,
      imageUrl,
      soldOut:      editForm.soldOutState !== 'active',
      soldOutUntil: editForm.soldOutState === 'today' ? getKSTEndOfDay() : null,
      active:       editForm.active,
      categoryId:   editForm.categoryId || undefined,
    })
    setEditMode(false)
  }

  async function connectGroup(groupId: string) {
    if (!selected || !groupId) return
    const maxOrder = selected.optionGroups.length
    const { error } = await supabase.from('menu_option_groups').insert({
      menu_id:         selected.code,
      option_group_id: groupId,
      display_order:   maxOrder,
    })
    if (error) { console.error(error); return }
    const g = storeGroups.find(sg => sg.id === groupId)
    if (!g) return
    const newGrp: OptionGroup = {
      id:         g.id,
      name:       g.name,
      isRequired: false,
      isMulti:    false,
      maxSelect:  null,
      items:      g.items.map(it => ({ ...it, isPopular: false })),
    }
    applyLocalUpdate({ ...selected, optionGroups: [...selected.optionGroups, newGrp] })
    setConnectingGroup(false)
    setConnectGroupId('')
  }

  // ── 판매/표시 상태 토글 ────────────────────────────────────────────────────
  async function toggleMenuStatus(field: 'soldOut' | 'active') {
    if (!selected) return
    const newVal = !selected[field]
    const dbField = field === 'soldOut' ? 'is_sold_out' : 'is_hidden'
    const dbVal   = field === 'soldOut' ? newVal : !newVal  // active=true → is_hidden=false
    await supabase.from('menus').update({ [dbField]: dbVal }).eq('id', selected.code)
    applyLocalUpdate({ ...selected, [field]: newVal })
  }

  // ── 메뉴 품절 3단계 상태 직접 설정 ───────────────────────────────────────────
  async function setMenuSoldOutState(state: SoldOutState) {
    if (!selected) return
    const updates =
      state === 'active'
        ? { is_sold_out: false, sold_out_until: null }
        : state === 'today'
        ? { is_sold_out: true, sold_out_until: getKSTEndOfDay() }
        : { is_sold_out: true, sold_out_until: null }
    await supabase.from('menus').update(updates).eq('id', selected.code)
    applyLocalUpdate({
      ...selected,
      soldOut:      state !== 'active',
      soldOutUntil: state === 'today' ? getKSTEndOfDay() : null,
    })
  }

  // ── 옵션 그룹 CRUD (스토어 단위 — 옵션 탭용) ────────────────────────────────
  async function createStandaloneGroup() {
    if (!newStoreGroup.name.trim() || !storeId) return
    const maxOrder = storeGroups.length
    const { data, error } = await supabase
      .from('option_groups')
      .insert({
        store_id:      storeId,
        name:          newStoreGroup.name.trim(),
        is_required:   newStoreGroup.isRequired,
        is_multi:      newStoreGroup.isMulti,
        max_select:    newStoreGroup.isMulti && newStoreGroup.maxSelect ? parseInt(newStoreGroup.maxSelect) : null,
        display_order: maxOrder,
      })
      .select('id, name, is_required, is_multi, max_select')
      .single()
    if (error || !data) { console.error(error); return }
    setStoreGroups(prev => [...prev, {
      id: data.id, name: data.name,
      isRequired:   data.is_required ?? false,
      isMulti:      data.is_multi    ?? false,
      maxSelect:    data.max_select  ?? null,
      isSoldOut:    false,
      soldOutUntil: null,
      isHidden:     false,
      usedBy:       [],
      usedByMenus:  [],
      items:        [],
    }])
    setAddingStoreGroup(false)
    setNewStoreGroup({ name: '', isRequired: false, isMulti: false, maxSelect: '' })
  }

  function closeOptGroupModal() {
    setAddingStoreGroup(false)
    setAddOptStep(1)
    setNewStoreGroup({ name: '', isRequired: false, isMulti: false, maxSelect: '' })
    setNewGroupItems([{ id: crypto.randomUUID(), name: '', price: '' }])
    setStep3CatId('')
    setStep3MenuIds(new Set())
  }

  async function confirmOptGroupCreate() {
    if (!newStoreGroup.name.trim() || !storeId) return
    setAddOptLoading(true)
    try {
      const { data: gd, error: ge } = await supabase
        .from('option_groups')
        .insert({
          store_id:      storeId,
          name:          newStoreGroup.name.trim(),
          is_required:   newStoreGroup.isRequired,
          is_multi:      newStoreGroup.isMulti,
          max_select:    newStoreGroup.isMulti && newStoreGroup.maxSelect ? parseInt(newStoreGroup.maxSelect) : null,
          display_order: storeGroups.length,
        })
        .select('id, name, is_required, is_multi, max_select')
        .single()
      if (ge || !gd) { console.error(ge); return }

      const validItems = newGroupItems.filter(i => i.name.trim())
      const itemResults = await Promise.all(
        validItems.map((item, idx) =>
          supabase.from('option_items')
            .insert({ option_group_id: gd.id, name: item.name.trim(), extra_price: parseInt(item.price) || 0, display_order: idx })
            .select('id, name, extra_price, is_popular, is_sold_out, is_hidden, display_order')
            .single()
        )
      )
      const createdItems: OptionItem[] = itemResults
        .filter(r => r.data && !r.error)
        .map(r => ({ id: r.data!.id, name: r.data!.name, extra: r.data!.extra_price, soldOut: false, soldOutUntil: null, hidden: false, isPopular: false }))

      const menuIds = Array.from(step3MenuIds)
      if (menuIds.length > 0) {
        await Promise.all(menuIds.map((menuId, i) =>
          supabase.from('menu_option_groups').insert({ menu_id: menuId, option_group_id: gd.id, display_order: i })
        ))
      }

      const newGroup: any = {
        id: gd.id, name: gd.name,
        isRequired: gd.is_required ?? false,
        isMulti:    gd.is_multi    ?? false,
        maxSelect:  gd.max_select  ?? null,
        isSoldOut: false, soldOutUntil: null, isHidden: false,
        usedBy:     menuIds.map(id => menus.find(m => m.code === id)?.name ?? '').filter(Boolean),
        usedByMenus: menuIds.map(id => {
          const m = menus.find(m2 => m2.code === id)
          return m ? { name: m.name, soldOut: false, hidden: false } : null
        }).filter(Boolean),
        items: createdItems,
      }
      setStoreGroups(prev => [...prev, newGroup])
      if (selected && step3MenuIds.has(selected.code)) {
        applyLocalUpdate({ ...selected, optionGroups: [...selected.optionGroups, newGroup] })
      }
    } finally {
      setAddOptLoading(false)
      closeOptGroupModal()
    }
  }

  async function updateStoreGroup(groupId: string, updates: Partial<OptionGroup>) {
    const dbUpdates: Record<string, any> = {}
    if (updates.name       !== undefined) dbUpdates.name        = updates.name
    if (updates.isRequired !== undefined) dbUpdates.is_required = updates.isRequired
    if (updates.isMulti    !== undefined) dbUpdates.is_multi    = updates.isMulti
    if (updates.maxSelect  !== undefined) dbUpdates.max_select  = updates.maxSelect
    if ((updates as any).isSoldOut  !== undefined) dbUpdates.is_sold_out = (updates as any).isSoldOut
    if (Object.keys(dbUpdates).length > 0) {
      await supabase.from('option_groups').update(dbUpdates).eq('id', groupId)
    }
    setStoreGroups(prev => prev.map(g => g.id !== groupId ? g : { ...g, ...updates }))
  }

  async function deleteStoreGroup(groupId: string) {
    await supabase.from('option_groups').delete().eq('id', groupId)
    setStoreGroups(prev => prev.filter(g => g.id !== groupId))
    // 이 그룹이 연결된 selected 메뉴가 있으면 로컬에서도 제거
    if (selected) {
      applyLocalUpdate({ ...selected, optionGroups: selected.optionGroups.filter(g => g.id !== groupId) })
    }
  }

  async function setGroupSoldOutState(groupId: string, state: SoldOutState) {
    const updates =
      state === 'active'  ? { is_sold_out: false, sold_out_until: null            }
      : state === 'today' ? { is_sold_out: true,  sold_out_until: getKSTEndOfDay() }
      :                     { is_sold_out: true,  sold_out_until: null             }
    await supabase.from('option_groups').update(updates).eq('id', groupId)
    const localPatch = { isSoldOut: state !== 'active', soldOutUntil: state === 'today' ? getKSTEndOfDay() : null }
    setStoreGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...localPatch } : g))
    // 메뉴 상세 모달에서도 반영 (가격(필수) 등 storeGroups에 없는 그룹 대응)
    setSelected(prev => {
      if (!prev) return null
      return { ...prev, optionGroups: prev.optionGroups.map(g => g.id === groupId ? { ...g, ...localPatch } : g) }
    })
  }

  async function toggleGroupHidden(groupId: string) {
    // storeGroups에 있는 그룹은 현재값에서 toggle, 없는 그룹(가격(필수) 등)은 selected에서 읽음
    const sgGroup = storeGroups.find(g => g.id === groupId)
    const selGroup = selected?.optionGroups.find(g => g.id === groupId)
    const currentHidden = sgGroup?.isHidden ?? (selGroup as any)?.isHidden ?? false
    const next = !currentHidden
    await supabase.from('option_groups').update({ is_hidden: next }).eq('id', groupId)
    setStoreGroups(prev => prev.map(g => g.id === groupId ? { ...g, isHidden: next } : g))
    setSelected(prev => {
      if (!prev) return null
      return { ...prev, optionGroups: prev.optionGroups.map(g => g.id === groupId ? { ...g, isHidden: next } as any : g) }
    })
  }

  async function reorderStoreItem(groupId: string, fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return
    const group = storeGroups.find(g => g.id === groupId)
    if (!group) return
    const items = [...group.items]
    const [moved] = items.splice(fromIdx, 1)
    items.splice(toIdx, 0, moved)
    setStoreGroups(prev => prev.map(g => g.id !== groupId ? g : { ...g, items }))
    await Promise.all(items.map((it, i) =>
      supabase.from('option_items').update({ display_order: i }).eq('id', it.id)
    ))
  }

  async function addStoreItem(groupId: string, name: string, extra: number): Promise<OptionItem | null> {
    const grp = storeGroups.find(g => g.id === groupId)
    const maxOrder = grp?.items.length ?? 0
    const { data, error } = await supabase
      .from('option_items')
      .insert({ option_group_id: groupId, name, extra_price: extra, display_order: maxOrder })
      .select('id, name, extra_price, is_popular, is_sold_out, is_hidden, display_order')
      .single()
    if (error || !data) { console.error(error); return null }
    const item: OptionItem = { id: data.id, name: data.name, extra: data.extra_price,
      soldOut: data.is_sold_out, soldOutUntil: null, hidden: data.is_hidden, isPopular: data.is_popular }
    setStoreGroups(prev => prev.map(g => g.id !== groupId ? g : { ...g, items: [...g.items, item] }))
    return item
  }

  async function updateStoreItem(groupId: string, itemId: string, updates: Partial<OptionItem>) {
    const dbUpdates: Record<string, any> = {}
    if (updates.name         !== undefined) dbUpdates.name          = updates.name
    if (updates.extra        !== undefined) dbUpdates.extra_price   = updates.extra
    if (updates.soldOut      !== undefined) dbUpdates.is_sold_out   = updates.soldOut
    if (updates.soldOutUntil !== undefined) dbUpdates.sold_out_until = updates.soldOutUntil ?? null
    if (updates.hidden       !== undefined) dbUpdates.is_hidden     = updates.hidden
    if (updates.isPopular    !== undefined) dbUpdates.is_popular    = updates.isPopular
    if (Object.keys(dbUpdates).length > 0) {
      await supabase.from('option_items').update(dbUpdates).eq('id', itemId)
    }
    setStoreGroups(prev => prev.map(g =>
      g.id !== groupId ? g : { ...g, items: g.items.map(it => it.id !== itemId ? it : { ...it, ...updates }) }
    ))
  }

  async function deleteStoreItem(groupId: string, itemId: string) {
    await supabase.from('option_items').delete().eq('id', itemId)
    setStoreGroups(prev => prev.map(g =>
      g.id !== groupId ? g : { ...g, items: g.items.filter(it => it.id !== itemId) }
    ))
  }

  // ── 메뉴 ↔ 옵션 그룹 연결/해제 ───────────────────────────────────────────────
  async function disconnectGroup(groupId: string) {
    if (!selected) return
    await supabase.from('menu_option_groups')
      .delete()
      .eq('menu_id', selected.code)
      .eq('option_group_id', groupId)
    applyLocalUpdate({ ...selected, optionGroups: selected.optionGroups.filter(g => g.id !== groupId) })
  }

  // ── 일괄 액션 ──────────────────────────────────────────────────────────────
  function toggleCheck(code: string) {
    setChecked(prev => {
      const n = new Set(prev)
      n.has(code) ? n.delete(code) : n.add(code)
      return n
    })
  }

  async function bulkAction(action: 'soldOut' | 'unsoldOut' | 'todaySoldOut' | 'hide' | 'unhide') {
    const codes = [...checked]
    const updates =
      action === 'soldOut'        ? { is_sold_out: true,  sold_out_until: null           }
      : action === 'unsoldOut'    ? { is_sold_out: false, sold_out_until: null           }
      : action === 'todaySoldOut' ? { is_sold_out: true,  sold_out_until: getKSTEndOfDay() }
      : action === 'hide'         ? { is_hidden: true  }
      :                             { is_hidden: false }

    // DB 업데이트 (개별)
    await Promise.all(codes.map(code =>
      supabase.from('menus').update(updates).eq('id', code)
    ))

    setMenus(prev => prev.map(m => {
      if (!checked.has(m.code)) return m
      if (action === 'soldOut')        return { ...m, soldOut: true,  soldOutUntil: null             }
      if (action === 'unsoldOut')      return { ...m, soldOut: false, soldOutUntil: null             }
      if (action === 'todaySoldOut')   return { ...m, soldOut: true,  soldOutUntil: getKSTEndOfDay() }
      if (action === 'hide')           return { ...m, active: false  }
      return { ...m, active: true }
    }))
    if (selected && checked.has(selected.code)) {
      setSelected(prev => {
        if (!prev) return null
        if (action === 'soldOut')        return { ...prev, soldOut: true,  soldOutUntil: null             }
        if (action === 'unsoldOut')      return { ...prev, soldOut: false, soldOutUntil: null             }
        if (action === 'todaySoldOut')   return { ...prev, soldOut: true,  soldOutUntil: getKSTEndOfDay() }
        if (action === 'hide')           return { ...prev, active: false  }
        return { ...prev, active: true }
      })
    }
    setChecked(new Set())
  }

  async function deleteMenus(codes: string[]) {
    await Promise.all(codes.map(code => supabase.from('menus').delete().eq('id', code)))
    setMenus(prev => prev.filter(m => !codes.includes(m.code)))
    if (selected && codes.includes(selected.code)) {
      setSelected(null)
      setEditMode(false)
    }
    setChecked(new Set())
    setDeleteConfirm(null)
  }

  // ── 옵션 탭: 스토어 단위 품절/숨김 토글 ──────────────────────────────────
  async function toggleStoreOptItem(groupId: string, itemId: string, field: 'soldOut' | 'hidden') {
    const group = storeGroups.find(g => g.id === groupId)
    const item  = group?.items.find(it => it.id === itemId)
    if (!item) return

    const newVal  = !item[field]
    const dbField = field === 'soldOut' ? 'is_sold_out' : 'is_hidden'
    await supabase.from('option_items').update({ [dbField]: newVal }).eq('id', itemId)

    setStoreGroups(prev => prev.map(g =>
      g.id !== groupId ? g : {
        ...g,
        items: g.items.map(it => it.id !== itemId ? it : { ...it, [field]: newVal }),
      }
    ))
  }

  // ── 메뉴 상세 모달: 옵션 그룹 인라인 편집 핸들러 ──────────────────────────
  async function modalUpdateItem(groupId: string, itemId: string, updates: Partial<OptionItem>) {
    await updateStoreItem(groupId, itemId, updates)
    if (!selected) return
    applyLocalUpdate({
      ...selected,
      optionGroups: selected.optionGroups.map(g =>
        g.id !== groupId ? g : { ...g, items: g.items.map(it => it.id !== itemId ? it : { ...it, ...updates }) }
      ),
    })
  }

  async function modalDeleteItem(groupId: string, itemId: string) {
    await deleteStoreItem(groupId, itemId)
    if (!selected) return
    applyLocalUpdate({
      ...selected,
      optionGroups: selected.optionGroups.map(g =>
        g.id !== groupId ? g : { ...g, items: g.items.filter(it => it.id !== itemId) }
      ),
    })
  }

  async function modalAddItem(groupId: string, name: string, extra: number) {
    const item = await addStoreItem(groupId, name, extra)
    if (!item || !selected) return
    applyLocalUpdate({
      ...selected,
      optionGroups: selected.optionGroups.map(g =>
        g.id !== groupId ? g : { ...g, items: [...g.items, item] }
      ),
    })
  }

  async function modalUpdateGroup(groupId: string, updates: Partial<OptionGroup>) {
    await updateStoreGroup(groupId, updates)
    if (!selected) return
    applyLocalUpdate({
      ...selected,
      optionGroups: selected.optionGroups.map(g =>
        g.id !== groupId ? g : { ...g, ...updates }
      ),
    })
  }

  return (
    <div className="h-full flex flex-col bg-gray-bg overflow-hidden p-3">

      <div className="flex-1 flex flex-col overflow-hidden bg-white rounded-xl shadow-sm relative">

      {/* 탭 */}
      <div className="px-4 pt-2.5 pb-0 flex-shrink-0 border-b border-gray-border">
        <div className="flex gap-1">
          {([
            { v: 'menu',     l: '메뉴'    },
            { v: 'option',   l: '옵션그룹' },
            { v: 'category', l: '카테고리' },
          ] as { v: MenuTab; l: string }[]).map(({ v, l }) => (
            <button key={v} onClick={() => setTab(v)}
              className={`px-3 py-1.5 text-[12px] font-semibold border-b-2 transition-colors -mb-px
                ${tab === v ? 'border-ink text-ink' : 'border-transparent text-gray-text hover:text-ink'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* 로딩 */}
      {loading && (
        <div className="flex-1 flex items-center justify-center text-gray-text text-[11px]">
          <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin mr-2" />
          불러오는 중...
        </div>
      )}

      {/* ── 메뉴 탭 ── */}
      {!loading && tab === 'menu' && (
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* 검색 + 상태 필터 + 태그 필터 */}
          <div className="px-4 pt-3 pb-2 flex items-center gap-2.5 flex-shrink-0">
            <div className="relative w-52 flex-shrink-0">
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="메뉴명, 카테고리 검색"
                className="w-full border border-gray-border rounded-lg pl-3 pr-7 py-2 text-[11px] focus:outline-none focus:border-ink"
              />
              <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 16 16" fill="none">
                <circle cx="6.5" cy="6.5" r="4.5" stroke="#727272" strokeWidth="1.5"/>
                <path d="M10.5 10.5L14 14" stroke="#727272" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="flex gap-1">
              {([
                { v: 'all',     l: '전체'   },
                { v: 'active',  l: '판매중' },
                { v: 'soldOut', l: '품절'   },
                { v: 'hidden',  l: '숨김'   },
              ] as { v: StatusFilter; l: string }[]).map(({ v, l }) => (
                <button key={v} onClick={() => setStatusFilter(v)}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-colors focus:outline-none
                    ${statusFilter === v ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex gap-1 ml-auto">
              {([
                { v: 'popular'     as TagFilter, l: '인기',   on: 'bg-[#F97316] text-white', off: 'bg-gray-100 text-gray-text hover:bg-gray-200' },
                { v: 'recommended' as TagFilter, l: '추천',   on: 'bg-[#00DD67] text-[#1A1A1A]', off: 'bg-gray-100 text-gray-text hover:bg-gray-200' },
                { v: 'new'         as TagFilter, l: '신메뉴', on: 'bg-[#1D6FE8] text-white', off: 'bg-gray-100 text-gray-text hover:bg-gray-200' },
              ]).map(({ v, l, on, off }) => (
                <button key={String(v)} onClick={() => setTagFilter(tagFilter === v ? null : v)}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-colors focus:outline-none
                    ${tagFilter === v ? on : off}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {/* 카테고리 필터 태그 */}
          <div className="px-4 pb-2 border-b border-gray-border flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex-1 flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
                <button
                  onClick={() => setCatFilter('all')}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors flex-shrink-0 focus:outline-none
                    ${catFilter === 'all' ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
                >
                  전체
                </button>
                {categories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => setCatFilter(cat.id)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors flex-shrink-0 focus:outline-none
                      ${catFilter === cat.id ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setCatJumpOpen(true)}
                className="flex-shrink-0 w-8 h-8 bg-white border border-gray-border rounded-full flex items-center justify-center text-gray-text hover:bg-gray-50 transition-colors"
                style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
                aria-label="카테고리 바로가기"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
          </div>
          {/* 메뉴 목록 카드 */}
          <div className="flex-1 overflow-hidden flex flex-col mx-3 mb-3 mt-2 bg-white rounded-xl shadow-sm overflow-hidden">
          {/* 테이블 헤더 */}
          <div className="grid grid-cols-[36px_48px_2fr_2fr_90px_72px_72px_150px] gap-x-3 px-5 py-2 bg-white text-[11px] font-bold text-gray-text uppercase tracking-wide border-b-2 border-gray-border flex-shrink-0">
            <span></span><span></span>
            <span className="whitespace-nowrap overflow-hidden">메뉴명</span>
            <span className="whitespace-nowrap overflow-hidden">카테고리</span>
            <span className="whitespace-nowrap overflow-hidden">가격</span>
            <span className="whitespace-nowrap overflow-hidden">판매상태</span>
            <span className="whitespace-nowrap overflow-hidden">표시</span>
            <span className="whitespace-nowrap overflow-hidden">태그</span>
          </div>
          {/* 목록 */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-border">
            {filteredMenus.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-text text-[11px]">
                {categories.length === 0 ? '카테고리 탭에서 카테고리를 먼저 추가하세요' : '메뉴가 없습니다'}
              </div>
            ) : (
              filteredMenus.map(menu => (
                <div key={menu.code} onClick={() => selectMenu(menu)}
                  className={`grid grid-cols-[36px_48px_2fr_2fr_90px_72px_72px_150px] gap-x-3 px-5 py-2.5 items-center text-[11px] cursor-pointer transition-colors hover:bg-gray-bg
                    ${!menu.active || menu.soldOut ? 'opacity-60' : ''}`}
                >
                  <input type="checkbox" checked={checked.has(menu.code)}
                    onChange={e => { e.stopPropagation(); toggleCheck(menu.code) }}
                    onClick={e => e.stopPropagation()}
                    className="w-4 h-4 accent-[#00DD67]"
                  />
                  {menu.imageUrl
                    ? <img src={menu.imageUrl} alt={menu.name} className="w-10 h-9 rounded-lg object-cover flex-shrink-0" />
                    : <span className="text-[22px]">{menu.emoji}</span>
                  }
                  <span className="font-semibold text-ink truncate min-w-0">{menu.name}</span>
                  <span>
                    {getCategoryName(menu.categoryId)
                      ? <span className="text-[11px] font-medium text-gray-text bg-gray-bg px-2.5 py-0.5 rounded-full">{getCategoryName(menu.categoryId)}</span>
                      : <span className="text-[11px] font-medium text-gray-border bg-gray-bg px-2.5 py-0.5 rounded-full italic">미지정</span>
                    }
                  </span>
                  <span className="font-bold">{won(menu.price)}</span>
                  <span>
                    {(() => {
                      const state = getSoldOutState(menu.soldOut, menu.soldOutUntil ?? null)
                      return state === 'today'
                        ? <span className="text-[11px] font-semibold text-gray-text bg-gray-100 px-2 py-0.5 rounded-full">오늘품절</span>
                        : state === 'permanent'
                        ? <span className="text-[11px] font-semibold text-danger bg-red-50 px-2 py-0.5 rounded-full">품절</span>
                        : <span className="text-[11px] font-semibold text-green bg-green-soft px-2 py-0.5 rounded-full">판매중</span>
                    })()}
                  </span>
                  <span>
                    {!menu.active
                      ? <span className="text-[11px] font-semibold text-gray-text bg-gray-100 px-2 py-0.5 rounded-full">숨김</span>
                      : <span className="text-[11px] font-semibold text-ink bg-gray-bg px-2 py-0.5 rounded-full">노출</span>
                    }
                  </span>
                  <span className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <button onClick={e => toggleTag(menu, 'isPopular', e)}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors
                        ${menu.isPopular ? 'bg-[#F97316] text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                      인기
                    </button>
                    <button onClick={e => toggleTag(menu, 'isRecommended', e)}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors
                        ${menu.isRecommended ? 'bg-[#00DD67] text-[#1A1A1A]' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                      추천
                    </button>
                    <button onClick={e => toggleTag(menu, 'isNew', e)}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-colors
                        ${menu.isNew ? 'bg-[#1D6FE8] text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                      신메뉴
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
          </div>
        </div>
      )}

      {/* ── 메뉴 상세 모달 ── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2.5 bg-black/40" onClick={() => { setSelected(null); setEditMode(false); setAddingGroup(false); setConnectingGroup(false) }}>
          <div className="modal-in bg-white rounded-2xl shadow-xl w-[680px] max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-8 pt-7 pb-0 flex-shrink-0">
              {editMode ? (
                <>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-extrabold">{selected.name}</span>
                    {editImageError && (
                      <span className="text-[11px] text-danger mt-0.5">{editImageError}</span>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => { setEditMode(false); setEditImageError('') }} className="px-3 py-1.5 text-[11px] font-bold text-gray-text bg-gray-100 rounded-lg hover:bg-gray-200">취소</button>
                    <button onClick={saveEdit} disabled={editSaving} className="px-3 py-1.5 text-[11px] font-bold text-[#1A1A1A] bg-[#00DD67] rounded-lg hover:bg-[#00BB55] disabled:opacity-50">
                      {editSaving ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="min-w-0">
                      <div className="text-[17px] font-semibold text-ink">{selected.name}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => setDeleteConfirm('single')} className="px-3 py-2 text-[11px] font-bold text-danger bg-red-50 rounded-lg hover:bg-red-100">삭제</button>
                    <button onClick={startEdit} className="px-3 py-2 text-[11px] font-bold text-ink bg-gray-100 rounded-lg hover:bg-gray-200">상세 수정</button>
                    <button onClick={() => { setSelected(null); setEditMode(false); setAddingGroup(false); setConnectingGroup(false) }} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-text hover:bg-gray-100 text-[18px]">✕</button>
                  </div>
                </>
              )}
            </div>

            {/* 모달 바디 */}
            <div className="overflow-y-auto flex-1 px-8 py-9 space-y-5">

              {/* 기본 정보 편집 폼 */}
              {editMode && (
                <div className="space-y-3">
                  {/* 상단: 사진(소형) + 이름/가격 */}
                  <div className="flex gap-2.5">
                    {/* 사진 — 작은 정방형 */}
                    <div className="flex-shrink-0 flex flex-col gap-1">
                      <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide">메뉴 사진</span>
                      <div className="flex flex-col items-center gap-1">
                      <div
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault()
                          const file = e.dataTransfer.files[0]
                          if (file?.type.startsWith('image/')) { setEditImageFile(file); setEditImagePreview(URL.createObjectURL(file)) }
                        }}
                      >
                      <label className="block cursor-pointer">
                        <input type="file" accept="image/*" className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            setEditImageFile(file)
                            setEditImagePreview(URL.createObjectURL(file))
                          }}
                        />
                        {editImagePreview ? (
                          <div className="relative w-[76px] h-[76px] rounded-xl overflow-hidden border border-gray-border">
                            <img src={editImagePreview} className="w-full h-full object-cover" alt="preview" />
                            <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                              <span className="text-white text-[10px] font-bold">변경</span>
                            </div>
                          </div>
                        ) : (
                          <div className="w-[76px] h-[76px] border border-gray-border rounded-xl flex flex-col items-center justify-center gap-1.5 hover:bg-gray-100 transition-colors group">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="stroke-gray-300 group-hover:stroke-gray-500 transition-colors" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                            </svg>
                            <span className="text-[10px] text-gray-text group-hover:text-gray-500 leading-tight text-center transition-colors">업로드</span>
                          </div>
                        )}
                      </label>
                      {editImagePreview && (
                        <button type="button" onClick={() => { setEditImageFile(null); setEditImagePreview('') }}
                          className="text-[10px] text-danger hover:underline">제거</button>
                      )}
                      </div>
                      </div>
                    </div>
                    {/* 이름 + 가격 */}
                    <div className="flex-1 flex gap-2">
                      <label className="block flex-1">
                        <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide">메뉴명</span>
                        <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                          className="mt-1 w-full border border-gray-border rounded-lg px-3 py-2 text-[11px] focus:border-green focus:outline-none" />
                      </label>
                      <label className="block flex-1">
                        <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide">기본 가격 (원)</span>
                        <div className="mt-1 flex items-center gap-1.5">
                          <input type="text" inputMode="numeric" value={editForm.price} onChange={e => setEditForm(p => ({ ...p, price: e.target.value.replace(/[^0-9]/g,'') }))}
                            className="flex-1 min-w-0 border border-gray-border rounded-lg px-3 py-2 text-[11px] focus:border-[#00DD67] focus:outline-none" />
                          <div className="flex flex-col gap-0.5">
                            <button type="button" onClick={() => setEditForm(p => ({ ...p, price: String(Math.max(0, (parseInt(p.price) || 0) + 100) )}))}
                              className="w-6 h-[18px] bg-gray-100 hover:bg-gray-200 rounded text-[9px] flex items-center justify-center transition-colors">
                              <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4.5L4 1.5L7 4.5"/></svg>
                            </button>
                            <button type="button" onClick={() => setEditForm(p => ({ ...p, price: String(Math.max(0, (parseInt(p.price) || 0) - 100) )}))}
                              className="w-6 h-[18px] bg-gray-100 hover:bg-gray-200 rounded text-[9px] flex items-center justify-center transition-colors">
                              <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1.5L4 4.5L7 1.5"/></svg>
                            </button>
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>
                  {/* 설명 */}
                  <label className="block">
                    <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide">설명</span>
                    <textarea value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                      rows={2} className="mt-1 w-full border border-gray-border rounded-lg px-3 py-2 text-[11px] resize-none" />
                  </label>
                  {/* 카테고리 */}
                  <label className="block">
                    <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide">카테고리</span>
                    <select value={editForm.categoryId} onChange={e => setEditForm(p => ({ ...p, categoryId: e.target.value }))}
                      className="mt-1 w-full border border-gray-border rounded-lg px-3 py-2 text-[11px] bg-white">
                      <option value="">카테고리 없음</option>
                      {sortedCategories().map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  {/* 판매/표시 상태 */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">판매 상태</span>
                      <SegmentedControl
                        options={[
                          { label: '판매중',   value: 'active'    as SoldOutState },
                          { label: '오늘품절', value: 'today'     as SoldOutState },
                          { label: '계속품절', value: 'permanent' as SoldOutState },
                        ]}
                        value={editForm.soldOutState}
                        onChange={(v) => setEditForm(p => ({ ...p, soldOutState: v }))}
                        size="xs"
                      />
                    </div>
                    <div>
                      <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">표시 상태</span>
                      <SegmentedControl
                        options={[
                          { label: '노출', value: true },
                          { label: '숨김', value: false },
                        ]}
                        value={editForm.active}
                        onChange={(v) => setEditForm(p => ({ ...p, active: v }))}
                        size="xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 보기 모드 */}
              {!editMode && (
                <>
                <div className="flex gap-2.5">
                  {/* 썸네일 */}
                  {selected.imageUrl && (
                    <div className="w-[88px] flex-shrink-0 rounded-xl overflow-hidden border border-gray-border self-stretch">
                      <img src={selected.imageUrl} alt={selected.name} className="w-full h-full object-cover" />
                    </div>
                  )}
                  {/* 정보 */}
                  <div className="flex-1 bg-gray-bg rounded-xl px-3 py-2.5 space-y-2">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-text">메뉴명</span>
                      <span className="font-semibold text-ink">{selected.name}</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-text">기본 가격</span>
                      <span className="font-bold">{won(selected.price)}</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-gray-text">카테고리</span>
                      <span className="font-semibold text-ink">{getCategoryName(selected.categoryId) || <span className="text-gray-border italic text-[11px]">미지정</span>}</span>
                    </div>
                  </div>
                </div>
                {/* 판매중/오늘품절/품절 + 노출/숨김 — 우측 정렬 */}
                <div className="flex justify-end gap-2 mt-3">
                  <SegmentedControl
                    options={[
                      { label: '판매중',   value: 'active'    as SoldOutState },
                      { label: '오늘품절', value: 'today'     as SoldOutState },
                      { label: '계속품절', value: 'permanent' as SoldOutState },
                    ]}
                    value={getSoldOutState(selected.soldOut, selected.soldOutUntil ?? null)}
                    onChange={setMenuSoldOutState}
                    size="xs"
                  />
                  <SegmentedControl
                    options={[
                      { label: '노출', value: true },
                      { label: '숨김', value: false },
                    ]}
                    value={selected.active}
                    onChange={(v) => { if (selected.active !== v) toggleMenuStatus('active') }}
                    size="xs"
                  />
                </div>
                </>
              )}

              {/* 옵션 그룹 연결 — 편집 모드에서 태그 버튼으로 연결/해제 */}
              {editMode && (
                <div>
                  <span className="text-[11px] font-extrabold text-ink block mb-2">옵션 그룹 연결</span>
                  {storeGroups.length === 0 ? (
                    <p className="text-[11px] text-gray-text mt-1">옵션그룹 탭에서 옵션그룹을 만들어보세요</p>
                  ) : (
                    <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
                      {storeGroups.map(g => {
                        const connected = selected.optionGroups.some(og => og.id === g.id)
                        return (
                          <button
                            key={g.id}
                            onClick={() => connected ? disconnectGroup(g.id) : connectGroup(g.id)}
                            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors
                              ${connected ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
                          >
                            {g.name}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 옵션 그룹 세부내용 — 항상 표시, 인라인 편집 가능 (가격(필수) 그룹 제외) */}
              {(() => {
                const editableGroups = selected.optionGroups
                return (
                  <div>
                    <div className="flex items-center mb-2">
                      <span className="text-[13px] font-semibold text-gray-text">옵션 그룹</span>
                    </div>
                    {editableGroups.length === 0 ? (
                      <div className="text-[11px] text-gray-text text-center py-8 border border-dashed border-gray-border rounded-xl">
                        연결된 옵션 그룹이 없습니다
                      </div>
                    ) : (
                      <div className="flex gap-3 overflow-x-auto pb-2">
                        {editableGroups.map(g => {
                          const sg = storeGroups.find(s => s.id === g.id)
                          // g(selected.optionGroups)에 값이 있으면 우선 사용 — 가격(필수) 등 storeGroups에 없는 그룹 대응
                          const gAny = g as any
                          return (
                            <div key={g.id} className="min-w-[300px] flex-shrink-0">
                            <OptionGroupPanel
                              group={g}
                              isSoldOut={gAny.isSoldOut ?? sg?.isSoldOut ?? false}
                              soldOutUntil={gAny.soldOutUntil ?? sg?.soldOutUntil ?? null}
                              isHidden={gAny.isHidden ?? sg?.isHidden ?? false}
                              readOnly
                              onSetSoldOutState={state => setGroupSoldOutState(g.id, state)}
                              onToggleHidden={() => toggleGroupHidden(g.id)}
                              onUpdateGroup={updates => modalUpdateGroup(g.id, updates)}
                              onDeleteGroup={() => deleteStoreGroup(g.id)}
                              onUpdateItem={(itemId, updates) => modalUpdateItem(g.id, itemId, updates)}
                              onDeleteItem={itemId => modalDeleteItem(g.id, itemId)}
                              onAddItem={(name, extra) => modalAddItem(g.id, name, extra)}
                              onReorderItem={(fromIdx, toIdx) => reorderStoreItem(g.id, fromIdx, toIdx)}
                            />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          </div>

          {/* 수정 중 안내 배너 */}
          {editMode && (
            <div
              className="w-[680px] flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[11px] font-semibold text-white/90"
              style={{ background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)' }}
              onClick={e => e.stopPropagation()}
            >
              <span className="opacity-60">✏️</span>
              <span>
                {(() => {
                  const code = selected.name.charCodeAt(selected.name.length - 1)
                  const particle = (code >= 0xAC00 && code <= 0xD7A3 && (code - 0xAC00) % 28 !== 0) ? '을' : '를'
                  return <><strong className="text-white">{selected.name}</strong>{particle} 수정중이에요</>
                })()}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── 옵션 탭 ── */}
      {!loading && tab === 'option' && (() => {
        // 현재 선택된 그룹 (selectedGroupId 없으면 첫 번째 그룹 자동 선택)
        const activeGroup = filteredStoreGroups.find(g => g.id === selectedGroupId)
          ?? filteredStoreGroups[0]
          ?? null
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 검색 + 상태 필터 */}
            <div className="px-4 pt-3 pb-3 flex items-center gap-2.5 flex-shrink-0 border-b border-gray-border bg-white">
              <div className="relative flex-shrink-0" style={{ width: 200 }}>
                <input
                  value={optionSearch}
                  onChange={e => setOptionSearch(e.target.value)}
                  placeholder="그룹명 · 옵션명 검색"
                  className="w-full border border-gray-border rounded-lg pl-3 pr-7 py-2 text-[11px] focus:outline-none focus:border-ink"
                />
                <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <circle cx="6.5" cy="6.5" r="4.5" stroke="#727272" strokeWidth="1.5"/>
                  <path d="M10.5 10.5L14 14" stroke="#727272" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="flex gap-1">
                {([
                  { v: 'all',     l: '전체'   },
                  { v: 'active',  l: '판매중' },
                  { v: 'soldOut', l: '품절'   },
                  { v: 'hidden',  l: '숨김'   },
                ] as { v: typeof optionFilter; l: string }[]).map(({ v, l }) => (
                  <button key={v} onClick={() => setOptionFilter(v)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors
                      ${optionFilter === v ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* 2단 레이아웃: 왼쪽 목록 + 오른쪽 상세 */}
            <div className="flex flex-1 overflow-hidden">
              {/* ── 왼쪽: 그룹 목록 ── */}
              <div className="w-[260px] flex-shrink-0 border-r border-gray-border overflow-y-auto bg-white">
                {storeGroups.length === 0 && (
                  <div className="text-center py-16 text-gray-text text-[11px] px-4">
                    등록된 옵션 그룹이 없습니다.<br/>위 버튼으로 추가하세요.
                  </div>
                )}
                {filteredStoreGroups.length === 0 && storeGroups.length > 0 && (
                  <div className="text-center py-16 text-gray-text text-[11px]">
                    검색 결과가 없습니다.
                  </div>
                )}
                {filteredStoreGroups.map(group => (
                  <OptionGroupRow
                    key={group.id}
                    group={group}
                    isSelected={activeGroup?.id === group.id}
                    onClick={() => setSelectedGroupId(group.id)}
                  />
                ))}
              </div>

              {/* ── 오른쪽: 그룹 상세 패널 ── */}
              <div className="flex-1 overflow-y-auto bg-gray-bg">
                {activeGroup ? (
                  <OptionGroupPanel
                    group={activeGroup}
                    isSoldOut={activeGroup.isSoldOut}
                    soldOutUntil={activeGroup.soldOutUntil}
                    isHidden={activeGroup.isHidden}
                    usedByMenus={activeGroup.usedByMenus}
                    searchQuery={optionSearch}
                    onSetSoldOutState={state => setGroupSoldOutState(activeGroup.id, state)}
                    onToggleHidden={() => toggleGroupHidden(activeGroup.id)}
                    onUpdateGroup={updates => updateStoreGroup(activeGroup.id, updates)}
                    onDeleteGroup={() => { deleteStoreGroup(activeGroup.id); setSelectedGroupId(null) }}
                    onUpdateItem={(itemId, updates) => updateStoreItem(activeGroup.id, itemId, updates)}
                    onDeleteItem={itemId => deleteStoreItem(activeGroup.id, itemId)}
                    onAddItem={(name, extra) => addStoreItem(activeGroup.id, name, extra)}
                    onReorderItem={(fromIdx, toIdx) => reorderStoreItem(activeGroup.id, fromIdx, toIdx)}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-text text-[12px]">
                    왼쪽에서 옵션 그룹을 선택하세요.
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── 카테고리 탭 ── */}
      {!loading && tab === 'category' && (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-[16px] font-semibold">카테고리 관리</div>
              <div className="text-[11px] text-gray-text mt-0.5">
                웹 주문 페이지에서 거래처명 바로 아래에 표시되는 탭 목록입니다. 순서대로 노출됩니다.
              </div>
            </div>
            <button onClick={() => { setAddingCat(true); setNewCatName('') }}
              className="px-3 py-2 text-[11px] font-bold text-[#1A1A1A] bg-[#00DD67] rounded-lg hover:bg-[#00BB55] transition-colors flex-shrink-0">
              카테고리 추가
            </button>
          </div>

          {/* 카테고리 pill 버튼 바 — 클릭 시 해당 카테고리 드롭다운 열기 + 스크롤 */}
          {sortedCategories().length > 0 && (
            <div className="mt-4 mb-1 flex gap-1.5 overflow-x-auto scrollbar-none pb-1">
              {sortedCategories().map(cat => {
                const isActive = expandedCatId === cat.id
                return (
                  <button
                    key={cat.id}
                    onClick={() => {
                      setExpandedCatId(isActive ? null : cat.id)
                      if (!isActive) setTimeout(() => {
                        catRowRefs.current[cat.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }, 50)
                    }}
                    className={`flex-shrink-0 whitespace-nowrap pl-3 pr-2 py-1.5 rounded-full text-[11px] font-semibold transition-colors focus:outline-none flex items-center gap-1
                      ${isActive ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
                  >
                    {cat.name}
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-white/20' : 'bg-white border border-gray-border'}`}>
                      <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                        <path d={isActive ? 'M2 7L5 4L8 7' : 'M2 4L5 7L8 4'} stroke={isActive ? 'white' : '#9CA3AF'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="mt-2 border border-gray-border rounded-xl overflow-hidden divide-y divide-gray-border">
            {sortedCategories().length === 0 && (
              <div className="py-10 text-center text-[11px] text-gray-text">
                카테고리가 없습니다. 위에서 추가해주세요.
              </div>
            )}
            {sortedCategories().map((cat, idx, arr) => {
              const catMenus = menus.filter(m => m.categoryId === cat.id)
              const isExpanded = expandedCatId === cat.id
              return (
                <div
                  key={cat.id}
                  ref={el => { catRowRefs.current[cat.id] = el }}
                  draggable
                  onDragStart={() => { setDragId(cat.id); setExpandedCatId(null) }}
                  onDragOver={e => { e.preventDefault(); setDragOverId(cat.id) }}
                  onDrop={e => { e.preventDefault(); handleCatDrop(cat.id); setDragOverId(null) }}
                  onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                  className={dragOverId === cat.id && dragId !== cat.id ? 'border-t-2 border-[#00DD67]' : ''}
                >
                  {/* ── 카테고리 행 ── */}
                  <div
                    className={`flex items-center gap-2.5 px-4 py-2.5 hover:bg-gray-bg/50 cursor-pointer select-none transition-colors ${dragId === cat.id ? 'opacity-40 bg-gray-bg' : 'bg-white'}`}
                    onClick={() => setExpandedCatId(isExpanded ? null : cat.id)}
                  >
                    {/* 드래그 핸들 */}
                    <div
                      className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-border hover:text-gray-text transition-colors"
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => e.stopPropagation()}
                    >
                      <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
                        <circle cx="3.5" cy="2.5" r="1.5"/><circle cx="8.5" cy="2.5" r="1.5"/>
                        <circle cx="3.5" cy="7" r="1.5"/><circle cx="8.5" cy="7" r="1.5"/>
                        <circle cx="3.5" cy="11.5" r="1.5"/><circle cx="8.5" cy="11.5" r="1.5"/>
                      </svg>
                    </div>

                    <span className="text-[11px] font-bold text-gray-text w-5 text-center flex-shrink-0">{idx + 1}</span>

                    <span className="text-[11px] font-medium text-ink flex-shrink-0">{cat.name}</span>

                    <div className="flex flex-wrap gap-1 flex-1 min-w-0 overflow-hidden">
                      {catMenus.length === 0
                        ? <span className="text-[11px] text-gray-text">—</span>
                        : catMenus.map(m => (
                            <span key={m.code} className="text-[11px] font-medium text-gray-text bg-gray-bg px-2 py-0.5 rounded-full flex-shrink-0">
                              {m.name}
                            </span>
                          ))
                      }
                    </div>

                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setCatEditNameDraft(cat.name)
                        setCatEditChecked(new Set(catMenus.map(m => m.code)))
                        setCatEditSearch('')
                        setCatEditModalId(cat.id)
                      }}
                      className="flex-shrink-0 text-[11px] font-semibold text-gray-text bg-gray-100 px-2.5 py-1 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      수정
                    </button>

                    {/* 펼침 화살표 */}
                    <svg className={`flex-shrink-0 w-4 h-4 text-gray-text transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>

                  {/* ── 아코디언: 메뉴 목록 ── */}
                  {isExpanded && (
                    <div className="bg-gray-bg border-t border-gray-border px-5 py-3">
                      {catMenus.length === 0 ? (
                        <p className="text-[11px] text-gray-text py-1">이 카테고리에 메뉴가 없습니다.</p>
                      ) : (
                        <div className="grid grid-cols-10 gap-1.5">
                          {catMenus
                            .slice()
                            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                            .map(m => (
                              <div key={m.code} className="bg-white rounded-lg overflow-hidden border border-gray-border shadow-sm">
                                {/* 썸네일 */}
                                <div className="w-full aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                                  {m.imageUrl
                                    ? <img src={m.imageUrl} alt={m.name} className="w-full h-full object-cover" />
                                    : <span className="text-[20px]">{m.emoji}</span>
                                  }
                                </div>
                                {/* 정보 */}
                                <div className="px-2 py-1.5">
                                  <div className="flex items-start justify-between gap-1 mb-0.5">
                                    <span className="text-[10px] font-semibold text-ink leading-snug">{m.name}</span>
                                    <div className="flex flex-col gap-0.5 items-end flex-shrink-0">
                                      {m.soldOut  && <span className="text-[9px] font-bold text-white bg-gray-400 rounded px-1 py-0.5 leading-none">품절</span>}
                                      {!m.active  && <span className="text-[9px] font-bold text-gray-text bg-gray-200 rounded px-1 py-0.5 leading-none">숨김</span>}
                                    </div>
                                  </div>
                                  <span className="text-[10px] font-bold text-gray-text">{won(m.price)}</span>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {(() => {
            const uncat = menus.filter(m => !m.categoryId)
            if (uncat.length === 0) return null
            return (
              <div className="mt-6">
                <div className="text-[11px] font-bold text-gray-text uppercase tracking-wide mb-2">
                  카테고리 미지정 메뉴 · {uncat.length}개
                </div>
                <div className="flex flex-wrap gap-2">
                  {uncat.map(m => (
                    <span key={m.code} className="text-[11px] font-semibold text-gray-text bg-gray-100 rounded-full px-3 py-1">
                      {m.emoji} {m.name}
                    </span>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── 카테고리 수정 모달 ── */}
      {catEditModalId && (() => {
        const cat = categories.find(c => c.id === catEditModalId)
        if (!cat) return null
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCatEditModalId(null)}>
            <div className="modal-in bg-white rounded-2xl shadow-xl w-[520px] max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* 헤더 */}
              <div className="flex items-center justify-between px-8 pt-7 pb-0 flex-shrink-0">
                <div className="text-[17px] font-semibold">카테고리 수정</div>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => { setCatDeleteRemap({}); setCatDeleteModalId(catEditModalId); setCatEditModalId(null) }}
                    className="px-3 py-1.5 text-[11px] font-medium text-danger bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    삭제
                  </button>
                  <button onClick={() => setCatEditModalId(null)} className="text-gray-text hover:text-ink text-[18px] leading-none">✕</button>
                </div>
              </div>

              {/* 이름 */}
              <div className="px-8 pt-6 pb-5 flex-shrink-0">
                <label className="text-[13px] font-semibold text-gray-text block mb-1.5">카테고리 이름</label>
                <input
                  value={catEditNameDraft}
                  onChange={e => setCatEditNameDraft(e.target.value)}
                  className="w-full border border-gray-border rounded-xl px-3 py-2 text-[11px] font-semibold focus:outline-none focus:border-green"
                />
              </div>

              {/* 메뉴 선택 */}
              <div className="px-8 pb-3 pt-2 flex-shrink-0 space-y-2">
                <div className="text-[13px] font-semibold text-gray-text mb-1.5">메뉴 선택</div>
                <input
                  value={catEditSearch}
                  onChange={e => setCatEditSearch(e.target.value)}
                  placeholder="메뉴명 검색"
                  className="w-full border border-gray-border rounded-xl px-3 py-2 text-[11px] focus:outline-none focus:border-green"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-8 pb-6">
                {menus.length === 0 ? (
                  <div className="text-[11px] text-gray-text py-3 text-center">등록된 메뉴가 없습니다</div>
                ) : (
                  <div className="space-y-1.5">
                    {menus.slice()
                    .filter(m => !catEditSearch.trim() || m.name.includes(catEditSearch.trim()))
                    .sort((a, b) => {
                      const aChecked = catEditChecked.has(a.code) ? 0 : 1
                      const bChecked = catEditChecked.has(b.code) ? 0 : 1
                      if (aChecked !== bChecked) return aChecked - bChecked
                      return (a.order ?? 0) - (b.order ?? 0)
                    })
                    .map(m => {
                      const checked = catEditChecked.has(m.code)
                      return (
                        <label key={m.code} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer transition-colors ${checked ? 'bg-green-soft' : 'hover:bg-gray-bg'}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setCatEditChecked(prev => {
                                const next = new Set(prev)
                                if (next.has(m.code)) next.delete(m.code)
                                else next.add(m.code)
                                return next
                              })
                            }}
                            className="w-4 h-4 accent-[#00DD67] flex-shrink-0"
                          />
                          {/* 썸네일 */}
                          <div className="w-10 h-9 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {m.imageUrl
                              ? <img src={m.imageUrl} alt={m.name} className="w-full h-full object-cover" />
                              : <span className="text-[20px]">{m.emoji}</span>
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-semibold text-ink truncate">{m.name}</div>
                            <div className="text-[11px] text-gray-text">{won(m.price)}</div>
                          </div>
                          {m.categoryId && m.categoryId !== catEditModalId && (
                            <span className="text-[10px] text-gray-text bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">
                              {categories.find(c => c.id === m.categoryId)?.name ?? ''}
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 푸터 */}
              <div className="flex gap-2 px-8 py-4 border-t border-gray-border flex-shrink-0 modal-footer">
                <button onClick={() => setCatEditModalId(null)}
                  className="flex-1 py-3 bg-gray-100 text-ink rounded-lg text-[13px] font-semibold hover:bg-gray-200 transition-colors">
                  취소
                </button>
                <button
                  onClick={() => saveCategoryEdit(catEditModalId, catEditNameDraft, catEditChecked)}
                  disabled={!catEditNameDraft.trim() || catEditSaving}
                  className="flex-1 py-3 bg-[#00DD67] text-[#1A1A1A] rounded-lg text-[13px] font-semibold hover:bg-[#00BB55] transition-colors disabled:opacity-40"
                >
                  {catEditSaving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── 카테고리 삭제 모달 ── */}
      {catDeleteModalId && (() => {
        const cat = categories.find(c => c.id === catDeleteModalId)
        if (!cat) return null
        const catMenus = menus.filter(m => m.categoryId === catDeleteModalId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCatDeleteModalId(null)}>
            <div className="modal-in bg-white rounded-2xl shadow-xl w-[560px] max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* 헤더 */}
              <div className="px-6 py-6 flex-shrink-0">
                <div className="text-[17px] font-semibold mb-1">
                  <span className="text-danger">'{cat.name}'</span> 카테고리 삭제
                </div>
                <div className="text-[11px] text-gray-text">
                  {catMenus.length > 0
                    ? '각 메뉴를 이동할 카테고리를 선택하면 삭제할 수 있습니다.'
                    : '카테고리를 삭제합니다. 이 작업은 되돌릴 수 없습니다.'}
                </div>
              </div>

              {/* 메뉴 목록 + 카테고리 드롭다운 */}
              {catMenus.length > 0 && (() => {
                const otherCats = categories.filter(c => c.id !== catDeleteModalId)
                const allMapped = catMenus.every(m => !!catDeleteRemap[m.code])
                return (
                  <div className="flex-1 overflow-y-auto px-5 pb-2">
                    <div className="text-[11px] font-bold text-danger mb-2">
                      이동 필요 {catMenus.length}개 · {catMenus.filter(m => catDeleteRemap[m.code]).length}개 지정됨
                    </div>
                    <div className="space-y-2">
                      {catMenus.map(m => {
                        const mapped = !!catDeleteRemap[m.code]
                        return (
                          <div key={m.code} className={`flex items-center gap-2.5 rounded-xl px-3 py-2 transition-colors ${mapped ? 'bg-green-soft' : 'bg-red-50'}`}>
                            <div className="w-9 h-8 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                              {m.imageUrl
                                ? <img src={m.imageUrl} alt={m.name} className="w-full h-full object-cover" />
                                : <span className="text-[18px]">{m.emoji}</span>
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] font-semibold text-ink truncate">{m.name}</div>
                            </div>
                            <select
                              value={catDeleteRemap[m.code] ?? ''}
                              onChange={e => {
                                const val = e.target.value
                                setCatDeleteRemap(prev => val ? { ...prev, [m.code]: val } : (() => { const n = { ...prev }; delete n[m.code]; return n })())
                              }}
                              className={`flex-shrink-0 w-28 text-[11px] font-semibold border rounded-lg px-2 py-1.5 focus:outline-none transition-colors ${mapped ? 'border-green text-green bg-white' : 'border-gray-border text-gray-text bg-white'}`}
                            >
                              <option value="">카테고리 선택</option>
                              {otherCats.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                        )
                      })}
                    </div>
                    {catMenus.length > 0 && !allMapped && (
                      <p className="text-[11px] text-gray-text mt-3">모든 메뉴에 카테고리를 지정하면 삭제 버튼이 활성화됩니다.</p>
                    )}
                  </div>
                )
              })()}

              {/* 푸터 */}
              {(() => {
                const allMapped = catMenus.every(m => !!catDeleteRemap[m.code])
                const canDelete = catMenus.length === 0 || allMapped
                return (
                  <div className="flex gap-2.5 px-5 py-3 border-t border-gray-border flex-shrink-0 modal-footer">
                    <button onClick={() => setCatDeleteModalId(null)}
                      className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-text font-bold hover:bg-gray-200 transition-colors">
                      취소
                    </button>
                    <button
                      disabled={!canDelete}
                      onClick={() => { deleteCategory(catDeleteModalId!, catDeleteRemap); setCatDeleteModalId(null) }}
                      className="flex-1 py-2.5 rounded-xl bg-danger text-white font-bold hover:bg-danger/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      삭제
                    </button>
                  </div>
                )
              })()}
            </div>
          </div>
        )
      })()}

      {/* ── 메뉴 추가 모달 ── */}
      {addMenuOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAddMenuOpen(false)}>
          <div className="modal-in bg-white rounded-2xl shadow-xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

            {/* 헤더 */}
            <div className="flex items-center justify-between px-8 pt-7 pb-0 flex-shrink-0">
              <span className="text-[17px] font-semibold">메뉴 추가</span>
              <button onClick={() => setAddMenuOpen(false)} className="text-gray-text hover:text-ink text-[18px]">✕</button>
            </div>
            {/* 탭 */}
            <div className="flex gap-0 px-8 mt-4 border-b border-gray-border flex-shrink-0">
              {([{ v: 'bulk', l: '일괄' }, { v: 'detail', l: '상세' }] as const).map(({ v, l }) => (
                <button key={v} onClick={() => { setAddModalTab(v); setAddError('') }}
                  className={`px-4 py-2 text-[13px] font-bold border-b-2 transition-colors -mb-px
                    ${addModalTab === v ? 'border-ink text-ink' : 'border-transparent text-gray-text hover:text-ink'}`}>
                  {l}
                </button>
              ))}
            </div>

            {/* 카테고리 (공통) */}
            <div className="px-8 pt-6 flex-shrink-0">
              <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1">
                카테고리 <span className="text-danger">*</span>
              </label>
              <p className="text-[10px] text-gray-text mb-1.5">*카테고리를 하나씩 지정한 뒤 메뉴를 일괄로 추가해주세요</p>
              {addingNewCat ? (
                <div className="flex gap-2">
                  <input autoFocus value={newCatInModal} onChange={e => setNewCatInModal(e.target.value)}
                    placeholder="새 카테고리 이름"
                    className="flex-1 border border-gray-border rounded-lg px-3 py-2 text-[11px] focus:border-gray-border focus:outline-none"
                    onKeyDown={e => e.key === 'Escape' && setAddingNewCat(false)}
                  />
                  <button type="button" onClick={() => setAddingNewCat(false)}
                    className="px-3 py-2 border border-gray-border rounded-lg text-[11px] font-bold text-gray-text hover:bg-gray-100 flex-shrink-0">
                    취소
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <select value={addCategoryId} onChange={e => setAddCategoryId(e.target.value)}
                      className="w-full border border-gray-border rounded-lg px-3 py-2 pr-7 text-[11px] bg-white appearance-none focus:outline-none">
                      <option value="">카테고리 선택</option>
                      {sortedCategories().map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 3.5L5 6.5L8 3.5"/>
                    </svg>
                  </div>
                  <button type="button" onClick={() => { setAddingNewCat(true); setNewCatInModal('') }}
                    className="px-3 py-2 border border-gray-border rounded-lg text-[11px] font-medium text-gray-text hover:bg-gray-100 transition-colors flex-shrink-0">
                    + 새로 만들기
                  </button>
                </div>
              )}
            </div>

            {/* ── 일괄 추가 탭 ── */}
            {addModalTab === 'bulk' && (
              <div className="px-6 py-4 space-y-3 overflow-y-auto flex-1">
                <div className="grid grid-cols-[40px_1fr_90px_28px] gap-2">
                  <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide">사진</span>
                  <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide">메뉴명</span>
                  <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide">가격 (원)</span>
                  <span />
                </div>
                <div className="space-y-2">
                  {addRows.map((row, idx) => (
                    <div key={row.id} className="grid grid-cols-[40px_1fr_90px_28px] gap-2 items-center">
                      {/* 이미지 드롭존 */}
                      <div
                        className="w-10 h-9 rounded-lg border border-gray-border cursor-pointer flex items-center justify-center overflow-hidden relative hover:bg-gray-400 transition-colors flex-shrink-0 group"
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault()
                          const file = e.dataTransfer.files[0]
                          if (file?.type.startsWith('image/')) updateRowImage(row.id, file)
                        }}
                        onClick={() => (document.getElementById(`bulk-img-${row.id}`) as HTMLInputElement)?.click()}
                      >
                        <input id={`bulk-img-${row.id}`} type="file" accept="image/*" className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) updateRowImage(row.id, f) }}
                        />
                        {row.imagePreview
                          ? <img src={row.imagePreview} className="w-full h-full object-cover" alt="" />
                          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="stroke-gray-400 group-hover:stroke-white transition-colors" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        }
                      </div>
                      <input autoFocus={idx === 0}
                        value={row.name} onChange={e => updateRow(row.id, 'name', e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRowLine() } }}
                        placeholder={`메뉴명 ${idx + 1}`}
                        className="border border-gray-border rounded-lg px-3 py-2 text-[11px] focus:border-[#00DD67] focus:outline-none"
                      />
                      <input type="text" inputMode="numeric"
                        value={row.price} onChange={e => updateRow(row.id, 'price', e.target.value.replace(/[^0-9]/g,''))}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRowLine() } }}
                        placeholder="0"
                        className="w-full border border-gray-border rounded-lg px-3 py-2 text-[11px] focus:border-[#00DD67] focus:outline-none"
                      />
                      <button type="button" onClick={() => removeRowLine(row.id)}
                        disabled={addRows.length === 1}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-text hover:text-danger hover:bg-red-50 transition-colors disabled:opacity-20">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={addRowLine}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#008F42] bg-[#E6F4EC] hover:bg-[#C9EAD5] transition-colors">
                    + 항목 추가
                  </button>
                </div>
                {addError && <p className="text-[11px] text-danger bg-red-50 rounded-lg px-3 py-2">{addError}</p>}
              </div>
            )}

            {/* ── 상세 추가 탭 ── */}
            {addModalTab === 'detail' && (
              <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
                {/* 사진 */}
                <div>
                  <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">사진</label>
                  <div
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault()
                      const file = e.dataTransfer.files[0]
                      if (file?.type.startsWith('image/')) { setImageFile(file); setImagePreview(URL.createObjectURL(file)) }
                    }}
                  >
                  <label className="block cursor-pointer">
                    <input type="file" accept="image/*" className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        setImageFile(file)
                        setImagePreview(URL.createObjectURL(file))
                      }}
                    />
                    {imagePreview ? (
                      <div className="relative w-[96px] h-[96px] rounded-xl overflow-hidden border border-gray-border">
                        <img src={imagePreview} className="w-full h-full object-cover" alt="preview" />
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                          <span className="text-white text-[11px] font-bold">변경</span>
                        </div>
                      </div>
                    ) : (
                      <div className="w-[96px] h-[96px] border border-gray-border rounded-xl flex flex-col items-center justify-center gap-1.5 hover:bg-gray-400 transition-colors group">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="stroke-gray-400 group-hover:stroke-white transition-colors" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <span className="text-[10px] text-gray-text group-hover:text-white leading-tight text-center transition-colors">업로드</span>
                      </div>
                    )}
                  </label>
                  {imagePreview && (
                    <button type="button" onClick={() => { setImageFile(null); setImagePreview('') }}
                      className="mt-1 text-[11px] text-danger hover:underline">사진 제거</button>
                  )}
                  </div>
                </div>
                {/* 메뉴명 */}
                <div>
                  <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1">메뉴명 *</label>
                  <input autoFocus value={detailForm.name}
                    onChange={e => setDetailForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="예: 클래식 포케"
                    className="w-full border border-gray-border rounded-lg px-3 py-2 text-[11px] focus:border-[#00DD67] focus:outline-none"
                  />
                </div>
                {/* 가격 */}
                <div>
                  <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1">기본 가격 (원) *</label>
                  <div className="flex items-center gap-1.5">
                    <input type="text" inputMode="numeric" value={detailForm.price}
                      onChange={e => setDetailForm(p => ({ ...p, price: e.target.value.replace(/[^0-9]/g,'') }))}
                      placeholder="0"
                      className="flex-1 min-w-0 border border-gray-border rounded-lg px-3 py-2 text-[11px] focus:border-ink focus:outline-none"
                    />
                    <div className="flex flex-col gap-0.5">
                      <button type="button" onClick={() => setDetailForm(p => ({ ...p, price: String(Math.max(0, (parseInt(p.price) || 0) + 100)) }))}
                        className="w-6 h-[18px] bg-gray-100 hover:bg-gray-200 rounded text-[9px] flex items-center justify-center transition-colors">
                        <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4.5L4 1.5L7 4.5"/></svg>
                      </button>
                      <button type="button" onClick={() => setDetailForm(p => ({ ...p, price: String(Math.max(0, (parseInt(p.price) || 0) - 100)) }))}
                        className="w-6 h-[18px] bg-gray-100 hover:bg-gray-200 rounded text-[9px] flex items-center justify-center transition-colors">
                        <svg width="8" height="6" viewBox="0 0 8 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1.5L4 4.5L7 1.5"/></svg>
                      </button>
                    </div>
                  </div>
                </div>
                {/* 설명 */}
                <div>
                  <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1">설명</label>
                  <textarea value={detailForm.description}
                    onChange={e => setDetailForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="메뉴 설명 (선택)" rows={2}
                    className="w-full border border-gray-border rounded-lg px-3 py-2 text-[11px] resize-none focus:border-green focus:outline-none"
                  />
                </div>
                {/* 옵션 그룹 */}
                {storeGroups.length > 0 && (
                  <div>
                    <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">옵션 그룹 연결</label>
                    <div className="border border-gray-border rounded-xl divide-y divide-gray-border overflow-hidden">
                      {storeGroups.map(g => (
                        <label key={g.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-bg cursor-pointer">
                          <input type="checkbox" checked={selectedGroupIds.includes(g.id)}
                            onChange={e => setSelectedGroupIds(prev =>
                              e.target.checked ? [...prev, g.id] : prev.filter(id => id !== g.id)
                            )}
                            className="w-4 h-4 accent-[#00DD67] flex-shrink-0"
                          />
                          <span className="text-[11px] font-semibold text-ink flex-1">{g.name}</span>
                          <span className="text-[11px] text-gray-text">{g.items.length}개 항목</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {addError && <p className="text-[11px] text-danger bg-red-50 rounded-lg px-3 py-2">{addError}</p>}
              </div>
            )}

            {/* 푸터 */}
            <div className="flex gap-2.5 px-5 py-3 border-t border-gray-border flex-shrink-0 modal-footer">
              <button onClick={() => setAddMenuOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-[11px] font-bold text-gray-text hover:bg-gray-200 transition-colors">
                취소
              </button>
              {addModalTab === 'bulk' ? (
                <button onClick={confirmAddMenu} disabled={addLoading}
                  className="flex-[2] py-2.5 rounded-xl bg-[#00DD67] text-[#1A1A1A] text-[11px] font-bold hover:bg-[#00BB55] transition-colors disabled:opacity-50">
                  {addLoading ? '저장 중...' : `${addRows.filter(r => r.name.trim() && r.price.trim()).length}개 추가`}
                </button>
              ) : (
                <button onClick={confirmDetailMenu} disabled={addLoading}
                  className="flex-[2] py-2.5 rounded-xl bg-[#00DD67] text-[#1A1A1A] text-[11px] font-bold hover:bg-[#00BB55] transition-colors disabled:opacity-50">
                  {addLoading ? '저장 중...' : '추가'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 플로팅 일괄 액션바 */}
      {tab === 'menu' && checked.size > 0 && (() => {
        const checkedMenus = menus.filter(m => checked.has(m.code))
        const states       = checkedMenus.map(m => getSoldOutState(m.soldOut, m.soldOutUntil ?? null))
        const allActive    = states.every(s => s === 'active')
        const allToday     = states.every(s => s === 'today')
        const allPermanent = states.every(s => s === 'permanent')
        const allHidden    = checkedMenus.every(m => !m.active)
        return (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-ink text-white rounded-2xl shadow-xl px-5 py-2.5 flex items-center gap-3 z-30">
            <span className="text-[11px] font-semibold text-white/70">{checked.size}개 선택</span>
            <div className="w-px h-5 bg-white/20" />
            {/* 판매 상태 */}
            {!allActive && (
              <button onClick={() => bulkAction('unsoldOut')}
                className="text-[11px] font-bold transition-colors"
                style={{ color: 'white' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#86EFAC')}
                onMouseLeave={e => (e.currentTarget.style.color = 'white')}>
                판매중으로
              </button>
            )}
            {!allActive && !allToday && <div className="w-px h-5 bg-white/20" />}
            {!allToday && (
              <button onClick={() => bulkAction('todaySoldOut')}
                className="text-[11px] font-bold transition-colors"
                style={{ color: 'white' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#FCD34D')}
                onMouseLeave={e => (e.currentTarget.style.color = 'white')}>
                오늘품절
              </button>
            )}
            {!allPermanent && <div className="w-px h-5 bg-white/20" />}
            {!allPermanent && (
              <button onClick={() => bulkAction('soldOut')}
                className="text-[11px] font-bold transition-colors"
                style={{ color: 'white' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#FCA5A5')}
                onMouseLeave={e => (e.currentTarget.style.color = 'white')}>
                품절
              </button>
            )}
            <div className="w-px h-5 bg-white/20" />
            <button onClick={() => bulkAction(allHidden ? 'unhide' : 'hide')}
              className="text-[11px] font-bold transition-colors"
              style={{ color: 'white' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#D1D5DB')}
              onMouseLeave={e => (e.currentTarget.style.color = 'white')}>
              {allHidden ? '숨김 해제' : '숨김'}
            </button>
            <div className="w-px h-5 bg-white/20" />
            <button onClick={() => setDeleteConfirm('bulk')}
              className="text-[11px] font-bold text-red-400 hover:text-red-300 transition-colors">
              삭제
            </button>
            <button onClick={() => setChecked(new Set())} className="text-white/50 hover:text-white text-[18px] ml-1">✕</button>
          </div>
        )
      })()}

      {/* 삭제 확인 다이얼로그 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="modal-in bg-white rounded-2xl shadow-2xl w-[320px] p-6">
            <h3 className="text-[11px] font-bold text-ink mb-2">
              {deleteConfirm === 'bulk'
                ? `${checked.size}개 메뉴를 삭제할까요?`
                : `'${selected?.name}'을(를) 삭제할까요?`}
            </h3>
            <p className="text-[11px] text-gray-text mb-6">삭제하면 되돌릴 수 없습니다.</p>
            <div className="flex gap-2.5">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2 border border-gray-border rounded-xl text-[11px] font-semibold text-gray-text hover:bg-gray-bg">
                취소
              </button>
              <button
                onClick={() => {
                  if (deleteConfirm === 'bulk') deleteMenus([...checked])
                  else if (selected) deleteMenus([selected.code])
                }}
                className="flex-1 py-2 bg-danger text-white rounded-xl text-[11px] font-bold hover:bg-red-700">
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 카테고리 바로가기 모달 (메뉴 탭) */}
      {catJumpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setCatJumpOpen(false)}
        >
          <div
            className="modal-in bg-white rounded-2xl w-[520px] px-4 py-5 max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-[16px] font-extrabold text-ink mb-3 flex-shrink-0">카테고리</p>
            <div className="flex flex-wrap gap-2 overflow-y-auto">
              <button
                onClick={() => { setCatFilter('all'); setCatJumpOpen(false) }}
                className={`whitespace-nowrap py-2 px-3 text-[11px] font-semibold rounded-xl transition-colors
                  ${catFilter === 'all' ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
              >전체</button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => { setCatFilter(cat.id); setCatJumpOpen(false) }}
                  className={`whitespace-nowrap py-2 px-3 text-[11px] font-semibold rounded-xl transition-colors
                    ${catFilter === cat.id ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
                >{cat.name}</button>
              ))}
            </div>
            <button
              onClick={() => setCatJumpOpen(false)}
              className="mt-4 w-full py-2 text-[11px] font-bold text-gray-text bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors flex-shrink-0"
            >닫기</button>
          </div>
        </div>
      )}



      {/* ── 카테고리 추가 모달 ── */}
      {addingCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAddingCat(false)}>
          <div className="modal-in bg-white rounded-2xl shadow-xl w-[460px]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-6 pb-0">
              <span className="text-[17px] font-semibold">카테고리 추가</span>
              <button onClick={() => setAddingCat(false)} className="text-gray-text hover:text-ink text-[18px]">✕</button>
            </div>
            <div className="px-6 py-8">
              <input
                autoFocus
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newCatName.trim()) { addCategory(newCatName); setNewCatName(''); setAddingCat(false) }
                  if (e.key === 'Escape') setAddingCat(false)
                }}
                placeholder="카테고리 이름 (예: 리뷰이벤트, 이달의메뉴)"
                className="w-full border border-gray-border rounded-xl px-3 py-2.5 text-[13px] focus:outline-none focus:border-ink"
              />
            </div>
            <div className="flex gap-2.5 px-5 pb-5">
              <button onClick={() => setAddingCat(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 text-[13px] font-bold text-gray-text hover:bg-gray-200 transition-colors">
                취소
              </button>
              <button
                onClick={() => { if (newCatName.trim()) { addCategory(newCatName); setNewCatName(''); setAddingCat(false) } }}
                disabled={!newCatName.trim()}
                className="flex-[2] py-2.5 rounded-xl bg-[#00DD67] text-[#1A1A1A] text-[13px] font-bold hover:bg-[#00BB55] transition-colors disabled:opacity-40">
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 옵션 그룹 추가 모달 (3단계) ── */}
      {addingStoreGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeOptGroupModal}>
          <div className="modal-in bg-white rounded-2xl shadow-xl w-[560px] max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

            {/* 헤더 + 단계 표시 */}
            <div className="px-6 pt-6 pb-0 flex-shrink-0">
              <div className="flex items-center justify-between mb-5">
                <span className="text-[17px] font-semibold">옵션그룹 추가</span>
                <button onClick={closeOptGroupModal} className="text-gray-text hover:text-ink text-[18px]">✕</button>
              </div>
              <div className="flex gap-1">
                {([1,2,3] as const).map(s => (
                  <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${s <= addOptStep ? 'bg-gray-500' : 'bg-gray-200'}`} />
                ))}
              </div>
            </div>

            {/* ── Step 1: 그룹 기본 설정 ── */}
            {addOptStep === 1 && (
              <div className="px-5 pt-[30px] pb-[30px] flex flex-col gap-4 overflow-y-auto">
                <div>
                  <div className="text-[13px] font-semibold text-gray-text mb-1.5">이름</div>
                  <input
                    autoFocus
                    value={newStoreGroup.name}
                    onChange={e => setNewStoreGroup(p => ({ ...p, name: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && newStoreGroup.name.trim() && setAddOptStep(2)}
                    placeholder="옵션 그룹명 (예: 드레싱 선택, 사이즈)"
                    className="w-full border border-gray-border rounded-xl px-3 py-2.5 text-[13px] focus:outline-none focus:border-gray-500"
                  />
                </div>
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="text-[13px] font-semibold text-gray-text mb-1.5">선택 여부<sup className="text-danger text-[8px]">*</sup></div>
                    <SegmentedControl
                      options={[{ label: '선택', value: false }, { label: '필수', value: true }]}
                      value={newStoreGroup.isRequired}
                      onChange={(v) => setNewStoreGroup(p => ({ ...p, isRequired: v }))}
                    />
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-gray-text mb-1.5">복수 여부<sup className="text-danger text-[8px]">*</sup></div>
                    <SegmentedControl
                      options={[{ label: '단일', value: false }, { label: '복수', value: true }]}
                      value={newStoreGroup.isMulti}
                      onChange={(v) => setNewStoreGroup(p => ({ ...p, isMulti: v, maxSelect: '' }))}
                    />
                  </div>
                </div>
                {newStoreGroup.isMulti && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {[2, 3, 4, 5].map(n => {
                      const cur = Number(newStoreGroup.maxSelect)
                      const active = cur === n
                      return (
                        <button key={n} type="button"
                          onClick={() => setNewStoreGroup(p => ({ ...p, maxSelect: active ? '' : String(n) }))}
                          className={`py-2 rounded-lg text-[11px] font-semibold transition-colors focus:outline-none
                            ${active ? 'bg-green-soft text-green' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                          최대 {n}개
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Step 2: 세부 옵션 항목 ── */}
            {addOptStep === 2 && (
              <div className="px-5 pt-[30px] pb-[30px] flex flex-col gap-2 overflow-y-auto">
                {newGroupItems.map((item, idx) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <input
                      autoFocus={idx === 0}
                      value={item.name}
                      onChange={e => setNewGroupItems(prev => prev.map(i => i.id === item.id ? { ...i, name: e.target.value } : i))}
                      placeholder={`옵션명 (예: 아보카도 추가)`}
                      className="flex-1 border border-gray-border rounded-xl px-3 py-2 text-[12px] focus:outline-none focus:border-[#008F42]"
                    />
                    <div className="flex items-center border border-gray-border rounded-xl overflow-hidden">
                      <input
                        type="number" min="0" value={item.price}
                        onChange={e => setNewGroupItems(prev => prev.map(i => i.id === item.id ? { ...i, price: e.target.value } : i))}
                        placeholder="0"
                        className="w-16 px-2 py-2 text-[12px] focus:outline-none text-right"
                      />
                      <span className="pr-2 text-[12px] text-gray-text">원</span>
                    </div>
                    <button
                      onClick={() => setNewGroupItems(prev => prev.length > 1 ? prev.filter(i => i.id !== item.id) : prev)}
                      className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-text text-[14px]">
                      ✕
                    </button>
                  </div>
                ))}
                <div className="flex justify-end mt-1">
                  <button
                    onClick={() => setNewGroupItems(prev => [...prev, { id: crypto.randomUUID(), name: '', price: '' }])}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#008F42] bg-[#E6F4EC] hover:bg-[#C9EAD5] transition-colors">
                    + 항목 추가
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 3: 메뉴 연결 ── */}
            {addOptStep === 3 && (
              <div className="px-5 pt-[30px] pb-[30px] flex flex-col gap-3 overflow-y-auto">
                <div className="text-[12px] text-gray-text">이 옵션 그룹을 적용할 메뉴를 선택하세요. (선택 사항)</div>
                {/* 카테고리 탭 */}
                <div className="flex flex-wrap gap-1.5">
                  {sortedCategories().map(cat => (
                    <button key={cat.id} onClick={() => setStep3CatId(cat.id)}
                      className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors
                        ${step3CatId === cat.id ? 'bg-ink text-white border-ink' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                      {cat.name}
                    </button>
                  ))}
                </div>
                {/* 메뉴 목록 */}
                {step3CatId ? (
                  <div className="flex flex-col gap-0.5 max-h-[240px] overflow-y-auto border border-gray-border rounded-xl p-2">
                    {menus.filter(m => m.categoryId === step3CatId).length === 0 ? (
                      <div className="text-center py-6 text-[12px] text-gray-text">이 카테고리에 메뉴가 없습니다.</div>
                    ) : menus.filter(m => m.categoryId === step3CatId).map(menu => (
                      <label key={menu.code} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={step3MenuIds.has(menu.code)}
                          onChange={() => setStep3MenuIds(prev => {
                            const next = new Set(prev)
                            if (next.has(menu.code)) next.delete(menu.code); else next.add(menu.code)
                            return next
                          })}
                        />
                        <span className="text-[13px] text-ink">{menu.name}</span>
                        {menu.soldOut && <span className="text-[10px] text-danger font-bold">품절</span>}
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-[12px] text-gray-text border border-gray-border rounded-xl">카테고리를 선택하세요.</div>
                )}
                {step3MenuIds.size > 0 && (
                  <div className="text-[11px] text-green font-bold">{step3MenuIds.size}개 메뉴 선택됨</div>
                )}
              </div>
            )}

            {/* 푸터 버튼 */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-gray-border flex-shrink-0 mt-auto modal-footer">
              {addOptStep === 1 ? (
                <button onClick={closeOptGroupModal}
                  className="px-4 py-3 bg-gray-100 text-ink rounded-lg text-[13px] font-semibold hover:bg-gray-200 transition-colors">
                  취소
                </button>
              ) : (
                <button onClick={() => setAddOptStep(s => (s - 1) as 1|2|3)}
                  className="px-4 py-3 bg-gray-100 text-ink rounded-lg text-[13px] font-semibold hover:bg-gray-200 transition-colors">
                  이전
                </button>
              )}
              {addOptStep < 3 ? (
                <button
                  onClick={() => {
                    if (addOptStep === 1 && !newStoreGroup.name.trim()) return
                    if (addOptStep === 2) {
                      const firstCat = sortedCategories()[0]
                      setStep3CatId(firstCat?.id ?? '')
                      setStep3MenuIds(new Set())
                    }
                    setAddOptStep(s => (s + 1) as 1|2|3)
                  }}
                  disabled={addOptStep === 1 && !newStoreGroup.name.trim()}
                  className="px-6 py-3 bg-[#00DD67] text-[#1A1A1A] rounded-lg text-[13px] font-semibold hover:bg-[#00BB55] transition-colors disabled:opacity-40">
                  {addOptStep === 2 && newGroupItems.every(i => !i.name.trim()) ? '건너뛰기' : '다음'}
                </button>
              ) : (
                <button onClick={confirmOptGroupCreate} disabled={addOptLoading}
                  className="px-6 py-3 bg-[#00DD67] text-[#1A1A1A] rounded-lg text-[13px] font-semibold hover:bg-[#00BB55] transition-colors disabled:opacity-50">
                  {addOptLoading ? '저장 중...' : '완료'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      </div>
    </div>
  )
}

// ── OptionGroupRow (왼쪽 목록 행) ─────────────────────────────────────────────
function OptionGroupRow({
  group, isSelected, onClick,
}: {
  group:      OptionGroup & { isSoldOut: boolean; soldOutUntil: string | null; isHidden: boolean }
  isSelected: boolean
  onClick:    () => void
}) {
  const soldOutState = getSoldOutState(group.isSoldOut, group.soldOutUntil)
  const selectLabel  = !group.isMulti ? '단일' : group.maxSelect ? `최대 ${group.maxSelect}개` : '복수'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-border transition-colors flex flex-col gap-1.5
        ${isSelected
          ? 'bg-gray-50'
          : 'hover:bg-gray-50'}
        ${group.isHidden ? 'opacity-60' : ''}`}
    >
      {/* 그룹명 + 상태 배지 */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`font-semibold text-[13px] flex-1 truncate ${isSelected ? 'text-green' : 'text-ink'}`}>
          {group.name}
        </span>
        {soldOutState === 'today' && (
          <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'rgba(217,119,6,0.12)', color: '#D97706' }}>오늘품절</span>
        )}
        {soldOutState === 'permanent' && (
          <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'rgba(201,42,42,0.1)', color: '#C92A2A' }}>품절</span>
        )}
        {group.isHidden && (
          <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-200 text-gray-text">숨김</span>
        )}
      </div>
      {/* 속성 배지 */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">
          {group.isRequired ? '필수' : '선택'}
        </span>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">
          {selectLabel}
        </span>
        <span className="text-[10px] text-gray-text ml-auto">
          {group.items.length}개 항목
        </span>
      </div>
    </button>
  )
}

// ── Toggle 미니 컴포넌트 (홈화면 스타일) ────────────────────────────────────────
function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 flex-shrink-0 ${on ? 'bg-[#00DD67]' : 'bg-gray-300'}`}
    >
      <span className={`absolute top-[3px] left-[3px] w-3 h-3 bg-white rounded-full shadow-sm transition-transform duration-200 ${on ? 'translate-x-[14px]' : 'translate-x-0'}`} />
    </button>
  )
}

// ── OptionGroupPanel (오른쪽 상세 패널) ────────────────────────────────────────
function OptionGroupPanel({
  group, isSoldOut, soldOutUntil = null, isHidden, usedByMenus, searchQuery, readOnly = false,
  onSetSoldOutState, onToggleHidden,
  onUpdateGroup, onDeleteGroup, onUpdateItem, onDeleteItem, onAddItem, onReorderItem,
}: {
  group:               OptionGroup
  isSoldOut:           boolean
  soldOutUntil?:       string | null
  isHidden:            boolean
  usedByMenus?:        { name: string; soldOut: boolean; hidden: boolean }[]
  searchQuery?:        string
  readOnly?:           boolean
  onSetSoldOutState:   (state: SoldOutState) => void
  onToggleHidden:      () => void
  onUpdateGroup:       (updates: Partial<OptionGroup>) => void
  onDeleteGroup:       () => void
  onUpdateItem:        (itemId: string, updates: Partial<OptionItem>) => void
  onDeleteItem:        (itemId: string) => void
  onAddItem:           (name: string, extra: number) => void
  onReorderItem:       (fromIdx: number, toIdx: number) => void
}) {
  const [editingItemId,    setEditingItemId]    = useState<string | null>(null)
  const [editItemName,     setEditItemName]     = useState('')
  const [editItemPrice,    setEditItemPrice]    = useState('')
  const [showAddItem,      setShowAddItem]      = useState(false)
  const [newItemName,      setNewItemName]      = useState('')
  const [newItemPrice,     setNewItemPrice]     = useState('0')
  const [settingsOpen,     setSettingsOpen]     = useState(false)
  const [settingsName,     setSettingsName]     = useState(group.name)
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState(false)
  const [deleteItemConfirm,  setDeleteItemConfirm]  = useState<{ id: string; name: string } | null>(null)
  const [dragItemIdx,      setDragItemIdx]      = useState<number | null>(null)
  const [dragOverItemIdx,  setDragOverItemIdx]  = useState<number | null>(null)

  // 그룹이 바뀌면 편집 상태 초기화
  useEffect(() => {
    setEditingItemId(null)
    setShowAddItem(false)
    setNewItemName('')
    setNewItemPrice('0')
    setSettingsName(group.name)
    setDeleteGroupConfirm(false)
  }, [group.id])

  function startEditItem(item: OptionItem) {
    setEditingItemId(item.id)
    setEditItemName(item.name)
    setEditItemPrice(String(item.extra))
  }

  function commitEditItem() {
    if (!editingItemId || !editItemName.trim()) { setEditingItemId(null); return }
    onUpdateItem(editingItemId, { name: editItemName.trim(), extra: Math.max(0, parseInt(editItemPrice, 10) || 0) })
    setEditingItemId(null)
  }

  function confirmAddItem() {
    if (!newItemName.trim()) return
    onAddItem(newItemName.trim(), Math.max(0, parseInt(newItemPrice, 10) || 0))
    setNewItemName('')
    setNewItemPrice('0')
    setShowAddItem(false)
  }

  const sq = searchQuery?.trim() ?? ''
  const groupSoldOutState = getSoldOutState(isSoldOut, soldOutUntil)

  // ── readOnly 전용 렌더링 ──────────────────────────────────────────────────────
  if (readOnly) {
    return (
      <div className="border border-gray-border rounded-xl overflow-hidden">
        {/* 그룹 헤더 */}
        <div className="px-3 py-2.5 flex items-center justify-between bg-gray-50 border-b border-gray-border">
          <span className="text-[13px] font-semibold text-ink">{group.name}</span>
          <div className="flex items-center gap-1.5">
            {groupSoldOutState !== 'active' && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={groupSoldOutState === 'today'
                  ? { backgroundColor: '#FEF3C7', color: '#D97706' }
                  : { backgroundColor: '#FEE2E2', color: '#C92A2A' }}>
                {groupSoldOutState === 'today' ? '오늘품절' : '품절'}
              </span>
            )}
            {isHidden && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-200 text-gray-text">숨김</span>}
          </div>
        </div>
        {/* 항목 목록 */}
        <div className="flex flex-col px-3 py-1">
          {group.items.map((item: OptionItem) => {
            const itemState = getSoldOutState(item.soldOut, item.soldOutUntil ?? null)
            return (
              <div key={item.id} className={`flex items-center gap-2 px-3 py-1.5 text-[12px] ${item.hidden ? 'opacity-50' : ''}`}>
                <span className="flex-1 font-medium text-ink truncate">{item.name}</span>
                {item.extra > 0 && <span className="text-[11px] text-gray-text">+{won(item.extra)}</span>}
                {itemState !== 'active' && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={itemState === 'today'
                      ? { backgroundColor: '#FEF3C7', color: '#D97706' }
                      : { backgroundColor: '#FEE2E2', color: '#C92A2A' }}>
                    {itemState === 'today' ? '오늘품절' : '품절'}
                  </span>
                )}
                {item.hidden && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-text flex-shrink-0">숨김</span>}
              </div>
            )
          })}
          {group.items.length === 0 && (
            <div className="text-center py-3 text-[11px] text-gray-text">항목 없음</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 설정 모달 */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="modal-in bg-white rounded-2xl shadow-xl w-[560px]">
            {/* 헤더 */}
            <div className="flex items-center justify-between px-6 pt-6 pb-0">
              <div className="text-[17px] font-semibold">옵션 그룹 설정</div>
              <button onClick={() => setSettingsOpen(false)} className="text-gray-text hover:text-ink text-[18px]">✕</button>
            </div>
            {/* 바디 */}
            <div className="px-5 py-[30px] flex flex-col gap-4">
              <div>
                <label className="text-[13px] font-semibold text-gray-text block mb-1.5">그룹명</label>
                <input value={settingsName} onChange={e => setSettingsName(e.target.value)}
                  className="w-full border border-gray-border rounded-xl px-3 py-2.5 text-[13px] focus:outline-none focus:border-ink transition-colors" />
              </div>
              <div>
                <label className="text-[13px] font-semibold text-gray-text block mb-1.5">필수 여부</label>
                <SegmentedControl
                  options={[{ label: '필수', value: true }, { label: '선택', value: false }]}
                  value={group.isRequired}
                  onChange={(v) => onUpdateGroup({ isRequired: v })}
                  rounded="xl"
                />
              </div>
              <div>
                <label className="text-[13px] font-semibold text-gray-text block mb-1.5">복수 여부</label>
                <SegmentedControl
                  options={[{ label: '단일', value: false }, { label: '복수', value: true }]}
                  value={group.isMulti}
                  onChange={(v) => onUpdateGroup({ isMulti: v, maxSelect: null })}
                  rounded="xl"
                />
                {group.isMulti && (
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {[2, 3, 4, 5].map(n => {
                      const active = group.maxSelect === n
                      return (
                        <button key={n} type="button"
                          onClick={() => onUpdateGroup({ maxSelect: active ? null : n })}
                          className={`py-2 rounded-lg text-[11px] font-semibold transition-colors focus:outline-none
                            ${active ? 'bg-green-soft text-green' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                          최대 {n}개
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
            {/* 푸터 */}
            <div className="modal-footer flex gap-2.5 px-6 pt-5 pb-6">
              {!deleteGroupConfirm ? (
                <button onClick={() => setDeleteGroupConfirm(true)}
                  className="flex-1 py-2.5 rounded-xl bg-red-50 text-danger font-bold text-[13px] hover:bg-red-100 transition-colors focus:outline-none">
                  삭제
                </button>
              ) : (
                <button onClick={() => { onDeleteGroup(); setSettingsOpen(false) }}
                  className="flex-1 py-2.5 rounded-xl bg-danger text-white font-bold text-[13px] hover:bg-danger/90 transition-colors focus:outline-none">
                  삭제 확정
                </button>
              )}
              <button onClick={() => { if (settingsName.trim()) onUpdateGroup({ name: settingsName.trim() }); setSettingsOpen(false) }}
                className="flex-[2] py-2.5 rounded-xl bg-[#00DD67] text-[#1A1A1A] font-bold text-[13px] hover:bg-[#00BB55] transition-colors focus:outline-none">
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 항목 삭제 확인 모달 */}
      {deleteItemConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteItemConfirm(null)}>
          <div className="modal-in bg-white rounded-2xl shadow-xl p-6 w-[300px]" onClick={e => e.stopPropagation()}>
            <div className="text-[13px] font-semibold text-ink mb-1">옵션 삭제</div>
            <div className="text-[12px] text-gray-text mb-5">
              <span className="font-semibold text-ink">'{deleteItemConfirm.name}'</span>을(를) 삭제할까요?
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDeleteItemConfirm(null)}
                className="flex-1 py-2 border border-gray-border rounded-xl text-[11px] font-semibold text-gray-text hover:bg-gray-bg">취소</button>
              <button onClick={() => { onDeleteItem(deleteItemConfirm.id); setDeleteItemConfirm(null) }}
                className="flex-1 py-2 bg-danger text-white rounded-xl text-[11px] font-bold hover:bg-danger/90">삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 패널 헤더: 그룹명 + 상태 토글 + ⚙ ── */}
      <div className="bg-white border-b border-gray-border px-5 py-4 flex-shrink-0"
        style={{ opacity: isHidden ? 0.75 : 1 }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-semibold text-ink break-words">{group.name}</div>
          </div>

          {readOnly && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                groupSoldOutState === 'today'     ? 'bg-amber-100 text-amber-700' :
                groupSoldOutState === 'permanent' ? 'bg-red-100 text-danger' :
                                                    'bg-gray-100 text-gray-text'}`}>
                {groupSoldOutState === 'today' ? '오늘품절' : groupSoldOutState === 'permanent' ? '품절' : '판매중'}
              </span>
              {isHidden && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-200 text-gray-text">숨김</span>}
            </div>
          )}

          {!readOnly && (
            <div className="flex items-start gap-2 flex-shrink-0">
              {/* 판매중 + 오늘품절 (세로 스택) */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-ink w-[46px] text-right inline-block whitespace-nowrap">
                    {groupSoldOutState === 'active' ? '판매중' : '품절'}
                  </span>
                  <Toggle
                    on={groupSoldOutState === 'active'}
                    onChange={() => onSetSoldOutState(groupSoldOutState === 'active' ? 'today' : 'active')}
                  />
                </div>
                {/* 오늘품절 — 판매중 바로 아래, 항상 공간 예약 */}
                <div className={`flex items-center gap-1.5 ${groupSoldOutState === 'active' ? 'invisible' : ''}`}>
                  <span className="text-[11px] font-semibold text-ink w-[46px] text-right inline-block whitespace-nowrap">
                    {groupSoldOutState === 'today' ? '오늘품절' : '계속품절'}
                  </span>
                  <Toggle
                    on={groupSoldOutState === 'today'}
                    onChange={() => onSetSoldOutState(groupSoldOutState === 'today' ? 'permanent' : 'today')}
                  />
                </div>
              </div>
              <div className="w-px bg-gray-border flex-shrink-0 self-stretch" />
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold text-ink">
                  {isHidden ? '숨김중' : '노출중'}
                </span>
                <Toggle on={!isHidden} onChange={onToggleHidden} />
              </div>
              <button
                onClick={() => { setSettingsName(group.name); setDeleteGroupConfirm(false); setSettingsOpen(true) }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-border text-[11px] font-medium text-gray-text hover:bg-gray-50 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
                그룹 설정
              </button>
            </div>
          )}
        </div>
        {/* 연결 메뉴 태그 — 전체 너비 */}
        {usedByMenus !== undefined && usedByMenus.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {usedByMenus.map(m => (
              <span key={m.name} className="inline-flex items-center gap-1">
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${m.hidden ? 'text-gray-text bg-gray-100 opacity-35' : 'text-gray-text bg-gray-100'}`}>
                  {m.name}{m.hidden ? ' (숨김)' : ''}
                </span>
                {m.soldOut && <span className="text-[9px] font-bold text-white bg-danger rounded px-1 leading-none">품절</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── 항목 목록 ── */}
      <div className="flex-1 bg-white overflow-y-auto">
        <div
          className={readOnly ? 'flex flex-wrap gap-1.5 px-3 py-2' : 'flex flex-wrap gap-2 px-3 py-2'}
        >
          {group.items.map((item: OptionItem, itemIdx: number) => {
            const isMatch = sq && (item.name.includes(sq))
            return editingItemId === item.id && !readOnly ? (
              <div key={item.id} className="flex items-center gap-2 px-4 py-2.5 w-full border border-green rounded-lg bg-green-soft/20">
                <input autoFocus value={editItemName} onChange={e => setEditItemName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitEditItem(); if (e.key === 'Escape') setEditingItemId(null) }}
                  className="flex-1 min-w-0 border-0 border-b border-[#00DD67] bg-transparent px-0 py-1 text-[12px] focus:outline-none"
                />
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-[11px] text-gray-text">+</span>
                  <input type="text" value={editItemPrice}
                    onChange={e => setEditItemPrice(e.target.value.replace(/[^0-9]/g, ''))}
                    onKeyDown={e => { if (e.key === 'Enter') commitEditItem(); if (e.key === 'Escape') setEditingItemId(null) }}
                    className="w-14 border-0 border-b border-[#00DD67] bg-transparent px-0 py-1 text-[11px] text-right focus:outline-none"
                  />
                  <span className="text-[11px] text-gray-text">원</span>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => setEditItemPrice(String(Math.max(0, (parseInt(editItemPrice) || 0) - 500)))}
                    className="bg-gray-100 hover:bg-gray-200 rounded px-1.5 py-0.5 text-[10px] font-semibold text-gray-text">-500</button>
                  <button onClick={() => setEditItemPrice(String((parseInt(editItemPrice) || 0) + 500))}
                    className="bg-gray-100 hover:bg-gray-200 rounded px-1.5 py-0.5 text-[10px] font-semibold text-gray-text">+500</button>
                </div>
                <button onClick={commitEditItem}
                  className="flex-shrink-0 px-2.5 py-1 rounded-lg bg-[#00DD67] text-[#1A1A1A] text-[10px] font-bold hover:bg-[#00BB55]">완료</button>
              </div>
            ) : (
              <div
                key={item.id}
                draggable={!readOnly}
                onDragStart={!readOnly ? () => setDragItemIdx(itemIdx) : undefined}
                onDragOver={!readOnly ? (e => { e.preventDefault(); setDragOverItemIdx(itemIdx) }) : undefined}
                onDrop={!readOnly ? (e => {
                  e.preventDefault()
                  if (dragItemIdx !== null && dragItemIdx !== itemIdx) {
                    onReorderItem(dragItemIdx, itemIdx)
                  }
                  setDragItemIdx(null)
                  setDragOverItemIdx(null)
                }) : undefined}
                onDragEnd={!readOnly ? (() => { setDragItemIdx(null); setDragOverItemIdx(null) }) : undefined}
                className={`flex items-center gap-2.5 text-[12px] group/row transition-colors
                  ${readOnly ? 'px-3 py-2 rounded-lg bg-gray-50 flex-auto min-w-[140px]' : 'px-3 py-2 rounded-lg border border-gray-border bg-white flex-auto min-w-[200px]'}
                  ${item.soldOut && !isMatch ? (readOnly ? '!bg-red-50' : '!bg-red-50 !border-red-200') : ''}
                  ${item.hidden ? 'opacity-50' : ''}
                  ${!readOnly && dragOverItemIdx === itemIdx && dragItemIdx !== itemIdx ? '!border-green !border-2' : ''}
                  ${!readOnly && dragItemIdx === itemIdx ? 'opacity-40' : ''}`}
                style={isMatch ? { backgroundColor: 'var(--green-soft)' } : undefined}
              >
                {!readOnly && (
                  <span className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-border hover:text-gray-text transition-colors"
                    onMouseDown={e => e.stopPropagation()}>
                    <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
                      <circle cx="2" cy="2" r="1.5"/><circle cx="6" cy="2" r="1.5"/>
                      <circle cx="2" cy="6" r="1.5"/><circle cx="6" cy="6" r="1.5"/>
                      <circle cx="2" cy="10" r="1.5"/><circle cx="6" cy="10" r="1.5"/>
                    </svg>
                  </span>
                )}
                <div className="flex items-center gap-1.5 min-w-0 flex-1" onClick={!readOnly ? () => startEditItem(item) : undefined}
                  style={!readOnly ? { cursor: 'pointer' } : undefined}>
                  <span className={`font-medium text-ink truncate ${!readOnly ? 'hover:text-green transition-colors' : ''} ${isMatch && sq ? 'text-green font-bold' : ''}`}>{item.name}</span>
                  {item.isPopular && <span className="text-[10px] font-bold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full flex-shrink-0">🔥</span>}
                  {item.extra > 0 && <span className="text-[11px] text-gray-text flex-shrink-0">+{won(item.extra)}</span>}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {(() => {
                    const itemState = getSoldOutState(item.soldOut, item.soldOutUntil ?? null)
                    const nextState: SoldOutState = itemState === 'active' ? 'today' : itemState === 'today' ? 'permanent' : 'active'
                    const nextUpdates =
                      nextState === 'active'  ? { soldOut: false, soldOutUntil: null             }
                      : nextState === 'today' ? { soldOut: true,  soldOutUntil: getKSTEndOfDay() }
                      :                         { soldOut: true,  soldOutUntil: null             }
                    return readOnly ? (
                      itemState !== 'active' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                          style={itemState === 'today' ? { backgroundColor: '#FEF3C7', color: '#D97706' } : { backgroundColor: '#FEE2E2', color: '#C92A2A' }}>
                          {itemState === 'today' ? '오늘품절' : '품절'}
                        </span>
                      )
                    ) : (
                      <button onClick={() => onUpdateItem(item.id, nextUpdates)}
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold border-0 transition-colors"
                        style={
                          itemState === 'today'
                            ? { backgroundColor: '#FEF3C7', color: '#D97706' }
                            : itemState === 'permanent'
                            ? { backgroundColor: '#FEE2E2', color: '#C92A2A' }
                            : { backgroundColor: '#F3F4F6', color: '#727272' }
                        }>
                        {itemState === 'today' ? '오늘품절' : itemState === 'permanent' ? '품절' : '판매중'}
                      </button>
                    )
                  })()}
                  {!readOnly && (
                    <>
                      <div className="w-px h-3 bg-gray-200 flex-shrink-0" />
                      <button onClick={() => onUpdateItem(item.id, { hidden: !item.hidden })}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border-0 transition-colors
                          ${item.hidden ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>숨김</button>
                      <button onClick={() => setDeleteItemConfirm({ id: item.id, name: item.name })}
                        className="w-6 h-6 flex items-center justify-center rounded-full text-[13px] text-gray-text hover:bg-red-100 hover:text-danger transition-colors opacity-0 group-hover/row:opacity-100">×</button>
                    </>
                  )}
                  {readOnly && item.hidden && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-200 text-gray-text">숨김</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* 항목 추가 */}
        {!readOnly && showAddItem ? (
          <div className="flex items-center gap-2 px-4 py-2.5 border-t border-gray-border bg-green-soft/40">
            <input autoFocus value={newItemName} onChange={e => setNewItemName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmAddItem(); if (e.key === 'Escape') setShowAddItem(false) }}
              placeholder="옵션명" className="flex-1 min-w-0 border border-green rounded-md px-2 py-1 text-[12px]"
            />
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-[11px] text-gray-text">+₩</span>
              <input type="number" min="0" step="500" value={newItemPrice} onChange={e => setNewItemPrice(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmAddItem(); if (e.key === 'Escape') setShowAddItem(false) }}
                className="w-16 border border-green rounded-md px-2 py-1 text-[12px]"
              />
            </div>
            <button onClick={confirmAddItem} disabled={!newItemName.trim()}
              className="flex-shrink-0 text-[11px] font-bold text-white bg-green px-2.5 py-1 rounded-lg hover:bg-[#015c28] disabled:opacity-40">추가</button>
            <button onClick={() => { setShowAddItem(false); setNewItemName(''); setNewItemPrice('0') }}
              className="flex-shrink-0 text-gray-text hover:text-ink text-[13px]">✗</button>
          </div>
        ) : !readOnly ? (
          <div className="flex justify-end px-4 py-2.5 border-t border-gray-border">
            <button onClick={() => setShowAddItem(true)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#008F42] bg-[#E6F4EC] hover:bg-[#C9EAD5] transition-colors">
              + 항목 추가
            </button>
          </div>
        ) : null}

        {group.items.length === 0 && !showAddItem && (
          <div className="text-center py-10 text-gray-text text-[12px]">
            아직 항목이 없습니다. 아래에서 추가하세요.
          </div>
        )}
      </div>
    </div>
  )
}
