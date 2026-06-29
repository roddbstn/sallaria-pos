import { useState, useEffect } from 'react'
import { type MenuDetail, type Category, type OptionGroup, type OptionItem } from '../lib/mock-data'
import { won } from '../lib/ipc'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store-context'

type MenuTab      = 'menu' | 'option' | 'category'
type StatusFilter = 'all' | 'active' | 'soldOut' | 'hidden'

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
            id:        it.id,
            name:      it.name,
            extra:     it.extra_price,
            soldOut:   it.is_sold_out,
            hidden:    it.is_hidden,
            isPopular: it.is_popular,
          })),
      } as OptionGroup
    })
    .filter(Boolean) as OptionGroup[]

  return {
    code:        row.id,
    name:        row.name,
    emoji:       '🍽️',
    price:       row.base_price,
    description: row.description ?? '',
    imageUrl:    row.image_url ?? undefined,
    categoryId:  row.category_id,
    active:      !row.is_hidden,
    soldOut:     row.is_sold_out,
    order:       row.display_order,
    optionGroups,
  }
}

// ── 스토어 옵션 그룹 (옵션 탭용) ─────────────────────────────────────────────
interface StoreOptionGroup {
  id:         string
  name:       string
  isRequired: boolean
  isMulti:    boolean
  maxSelect:  number | null
  usedBy:     string[]   // 적용된 메뉴명 목록
  items:      { id: string; name: string; extra: number; soldOut: boolean; hidden: boolean }[]
}

export default function Menus() {
  const { storeId } = useStore()

  const [tab,          setTab]          = useState<MenuTab>('menu')
  const [menus,        setMenus]        = useState<MenuDetail[]>([])
  const [categories,   setCategories]   = useState<Category[]>([])
  const [storeGroups,  setStoreGroups]  = useState<StoreOptionGroup[]>([])
  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [catFilter,    setCatFilter]    = useState<string>('all')
  const [checked,      setChecked]      = useState<Set<string>>(new Set())
  const [selected,     setSelected]     = useState<MenuDetail | null>(null)
  const [loading,      setLoading]      = useState(true)

  const [deleteConfirm, setDeleteConfirm] = useState<'bulk' | 'single' | null>(null)

  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', price: '', description: '', soldOut: false, active: true })
  const [editImageFile,    setEditImageFile]    = useState<File | null>(null)
  const [editImagePreview, setEditImagePreview] = useState('')
  const [editImageError,   setEditImageError]   = useState('')
  const [editSaving,       setEditSaving]       = useState(false)
  const [addingGroup,      setAddingGroup]      = useState(false)
  const [connectingGroup,  setConnectingGroup]  = useState(false)
  const [connectGroupId,   setConnectGroupId]   = useState('')

  const [addingStoreGroup, setAddingStoreGroup] = useState(false)
  const [newStoreGroup,    setNewStoreGroup]    = useState({ name: '', isRequired: false, isMulti: false, maxSelect: '' })

  const [addingCat,          setAddingCat]          = useState(false)
  const [newCatName,         setNewCatName]         = useState('')
  const [expandedCatId,      setExpandedCatId]      = useState<string | null>(null)
  const [catEditModalId,     setCatEditModalId]     = useState<string | null>(null)
  const [catEditNameDraft,   setCatEditNameDraft]   = useState('')
  const [catEditChecked,     setCatEditChecked]     = useState<Set<string>>(new Set())
  const [catEditSaving,      setCatEditSaving]      = useState(false)
  const [dragId,             setDragId]             = useState<string | null>(null)
  const [dragOverId,         setDragOverId]         = useState<string | null>(null)
  const [catDeleteModalId,   setCatDeleteModalId]   = useState<string | null>(null)

  const [addMenuOpen,   setAddMenuOpen]   = useState(false)
  const [addModalTab,   setAddModalTab]   = useState<'bulk' | 'detail'>('bulk')
  const [addCategoryId, setAddCategoryId] = useState('')
  const [addingNewCat,  setAddingNewCat]  = useState(false)
  const [newCatInModal, setNewCatInModal] = useState('')
  // 일괄 추가
  const [addRows, setAddRows] = useState<{ id: string; name: string; price: string }[]>([
    { id: crypto.randomUUID(), name: '', price: '' },
  ])
  // 상세 추가
  const [detailForm, setDetailForm] = useState({ name: '', price: '', description: '' })
  const [imageFile,  setImageFile]  = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState('')
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [addError,   setAddError]   = useState('')
  const [addLoading, setAddLoading] = useState(false)

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
        is_sold_out, is_hidden, display_order,
        menu_option_groups (
          display_order,
          option_groups (
            id, name, is_required, is_multi, max_select,
            option_items (
              id, name, extra_price, is_popular, is_sold_out, is_hidden, display_order
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
        id, name, display_order, is_required, is_multi, max_select,
        option_items ( id, name, extra_price, is_sold_out, is_hidden, display_order ),
        menu_option_groups ( menu_id, menus ( name ) )
      `)
      .eq('store_id', storeId)
      .order('name')

    setStoreGroups((data ?? []).map((g: any) => ({
      id:         g.id,
      name:       g.name,
      isRequired: g.is_required ?? false,
      isMulti:    g.is_multi    ?? false,
      maxSelect:  g.max_select  ?? null,
      usedBy: (g.menu_option_groups ?? []).map((m: any) => m.menus?.name).filter(Boolean),
      items:  (g.option_items ?? [])
        .sort((a: any, b: any) => a.display_order - b.display_order)
        .map((it: any) => ({
          id:      it.id,
          name:    it.name,
          extra:   it.extra_price,
          soldOut: it.is_sold_out,
          hidden:  it.is_hidden,
        })),
    })))
  }

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
    return matchSearch && matchStatus && matchCat
  })

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

  async function deleteCategory(id: string) {
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) {
      console.error('카테고리 삭제 실패 (메뉴가 남아있는지 확인):', error)
      return
    }
    setMenus(prev => prev.filter(m => m.categoryId !== id))
    setCategories(prev => prev.filter(c => c.id !== id))
    if (selected?.categoryId === id) setSelected(null)
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
    setAddRows([{ id: crypto.randomUUID(), name: '', price: '' }])
    setDetailForm({ name: '', price: '', description: '' })
    setImageFile(null)
    setImagePreview('')
    setSelectedGroupIds([])
    setAddError('')
    setAddLoading(false)
    setAddMenuOpen(true)
  }

  function addRowLine() {
    setAddRows(prev => [...prev, { id: crypto.randomUUID(), name: '', price: '' }])
  }

  function removeRowLine(id: string) {
    setAddRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : prev)
  }

  function updateRow(id: string, field: 'name' | 'price', value: string) {
    setAddRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
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

    if (!categoryId) { setAddError('카테고리를 선택하거나 새로 만들어주세요.'); return }

    setAddLoading(true)
    const maxOrder = menus.reduce((m, mn) => Math.max(m, mn.order), 0)

    const inserts = validRows.map((r, i) => ({
      category_id:   categoryId,
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
    if (!categoryId) { setAddError('카테고리를 선택해주세요.'); return }

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
        category_id:   categoryId,
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
    setEditForm({ name: selected.name, price: String(selected.price), description: selected.description, soldOut: selected.soldOut, active: selected.active })
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

    const { error: updateErr } = await supabase.from('menus').update({
      name:        editForm.name.trim(),
      base_price:  priceNum,
      description: editForm.description || null,
      image_url:   imageUrl ?? null,
      is_sold_out: editForm.soldOut,
      is_hidden:   !editForm.active,
    }).eq('id', selected.code)

    setEditSaving(false)

    if (updateErr) {
      setEditImageError(`저장 실패: ${updateErr.message}`)
      return
    }

    applyLocalUpdate({ ...selected, name: editForm.name.trim(), price: priceNum, description: editForm.description, imageUrl, soldOut: editForm.soldOut, active: editForm.active })
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
      isRequired: data.is_required ?? false,
      isMulti:    data.is_multi    ?? false,
      maxSelect:  data.max_select  ?? null,
      usedBy: [], items: [],
    }])
    setAddingStoreGroup(false)
    setNewStoreGroup({ name: '', isRequired: false, isMulti: false, maxSelect: '' })
  }

  async function updateStoreGroup(groupId: string, updates: Partial<OptionGroup>) {
    const dbUpdates: Record<string, any> = {}
    if (updates.name       !== undefined) dbUpdates.name        = updates.name
    if (updates.isRequired !== undefined) dbUpdates.is_required = updates.isRequired
    if (updates.isMulti    !== undefined) dbUpdates.is_multi    = updates.isMulti
    if (updates.maxSelect  !== undefined) dbUpdates.max_select  = updates.maxSelect
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

  async function addStoreItem(groupId: string, name: string, extra: number) {
    const grp = storeGroups.find(g => g.id === groupId)
    const maxOrder = grp?.items.length ?? 0
    const { data, error } = await supabase
      .from('option_items')
      .insert({ option_group_id: groupId, name, extra_price: extra, display_order: maxOrder })
      .select('id, name, extra_price, is_popular, is_sold_out, is_hidden, display_order')
      .single()
    if (error || !data) { console.error(error); return }
    const item: OptionItem = { id: data.id, name: data.name, extra: data.extra_price,
      soldOut: data.is_sold_out, hidden: data.is_hidden, isPopular: data.is_popular }
    setStoreGroups(prev => prev.map(g => g.id !== groupId ? g : { ...g, items: [...g.items, item] }))
  }

  async function updateStoreItem(groupId: string, itemId: string, updates: Partial<OptionItem>) {
    const dbUpdates: Record<string, any> = {}
    if (updates.name      !== undefined) dbUpdates.name        = updates.name
    if (updates.extra     !== undefined) dbUpdates.extra_price = updates.extra
    if (updates.soldOut   !== undefined) dbUpdates.is_sold_out = updates.soldOut
    if (updates.hidden    !== undefined) dbUpdates.is_hidden   = updates.hidden
    if (updates.isPopular !== undefined) dbUpdates.is_popular  = updates.isPopular
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

  async function bulkAction(action: 'soldOut' | 'unsoldOut' | 'hide' | 'unhide') {
    const codes = [...checked]
    const updates =
      action === 'soldOut'   ? { is_sold_out: true  }
      : action === 'unsoldOut' ? { is_sold_out: false }
      : action === 'hide'      ? { is_hidden:   true  }
      :                          { is_hidden:   false }

    // DB 업데이트 (개별)
    await Promise.all(codes.map(code =>
      supabase.from('menus').update(updates).eq('id', code)
    ))

    setMenus(prev => prev.map(m => {
      if (!checked.has(m.code)) return m
      if (action === 'soldOut')   return { ...m, soldOut: true  }
      if (action === 'unsoldOut') return { ...m, soldOut: false }
      if (action === 'hide')      return { ...m, active: false  }
      return { ...m, active: true }
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

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">

      {/* 헤더 */}
      <div className="px-6 py-4 border-b border-gray-border flex-shrink-0 flex items-center justify-between">
        <div className="text-[20px] font-extrabold">메뉴 관리</div>
        <div className="flex gap-2">
          <button onClick={() => { setAddingStoreGroup(true); setNewStoreGroup({ name: '', isRequired: false, isMulti: false, maxSelect: '' }); setTab('option') }}
            className="px-4 py-2 bg-gray-100 text-ink rounded-lg text-[13px] font-bold hover:bg-gray-200 transition-colors">
            + 옵션 추가
          </button>
          <button onClick={openAddMenu}
            className="px-4 py-2 bg-[#16a84c] text-white rounded-lg text-[13px] font-bold hover:bg-[#128040] transition-colors">
            + 메뉴 추가
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="px-6 border-b border-gray-border flex-shrink-0 flex gap-0">
        {([
          { v: 'menu',     l: '메뉴'     },
          { v: 'option',   l: '옵션그룹'  },
          { v: 'category', l: '카테고리' },
        ] as { v: MenuTab; l: string }[]).map(({ v, l }) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-6 py-3 text-[13px] font-bold border-b-2 transition-colors
              ${tab === v ? 'border-green text-green' : 'border-transparent text-gray-text hover:text-ink'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* 로딩 */}
      {loading && (
        <div className="flex-1 flex items-center justify-center text-gray-text text-[13px]">
          <div className="w-6 h-6 border-2 border-green border-t-transparent rounded-full animate-spin mr-2" />
          불러오는 중...
        </div>
      )}

      {/* ── 메뉴 탭 ── */}
      {!loading && tab === 'menu' && (
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* 검색 + 상태 필터 */}
          <div className="px-6 pt-3 pb-2 flex items-center gap-3 flex-shrink-0">
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
                    ${statusFilter === v ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          {/* 카테고리 필터 태그 */}
          <div className="px-6 pb-2 border-b border-gray-border flex-shrink-0">
            <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
              <button
                onClick={() => setCatFilter('all')}
                className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-colors flex-shrink-0
                  ${catFilter === 'all' ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
              >
                전체
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setCatFilter(cat.id)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-colors flex-shrink-0
                    ${catFilter === cat.id ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
          {/* 테이블 헤더 */}
          <div className="grid grid-cols-[36px_48px_1fr_120px_100px_100px_100px] px-6 py-2 bg-gray-bg text-[11px] font-bold text-gray-text uppercase tracking-wide border-b border-gray-border flex-shrink-0">
            <span></span><span></span><span>메뉴명</span>
            <span>카테고리</span><span>가격</span><span>판매상태</span><span>표시</span>
          </div>
          {/* 목록 */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-border">
            {filteredMenus.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-text text-[13px]">
                {categories.length === 0 ? '카테고리 탭에서 카테고리를 먼저 추가하세요' : '메뉴가 없습니다'}
              </div>
            ) : (
              filteredMenus.map(menu => (
                <div key={menu.code} onClick={() => selectMenu(menu)}
                  className={`grid grid-cols-[36px_48px_1fr_120px_100px_100px_100px] px-6 py-3 items-center text-[13px] cursor-pointer transition-colors hover:bg-gray-bg
                    ${!menu.active || menu.soldOut ? 'opacity-60' : ''}`}
                >
                  <input type="checkbox" checked={checked.has(menu.code)}
                    onChange={e => { e.stopPropagation(); toggleCheck(menu.code) }}
                    onClick={e => e.stopPropagation()}
                    className="w-4 h-4 accent-green"
                  />
                  {menu.imageUrl
                    ? <img src={menu.imageUrl} alt={menu.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                    : <span className="text-[22px]">{menu.emoji}</span>
                  }
                  <span className="font-semibold text-ink">{menu.name}</span>
                  <span>
                    {getCategoryName(menu.categoryId)
                      ? <span className="text-[11px] font-medium text-gray-text bg-gray-bg px-2.5 py-0.5 rounded-full">{getCategoryName(menu.categoryId)}</span>
                      : <span className="text-[11px] font-medium text-gray-border bg-gray-bg px-2.5 py-0.5 rounded-full italic">미지정</span>
                    }
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
              ))
            )}
          </div>
        </div>
      )}

      {/* ── 메뉴 상세 모달 ── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/40" onClick={() => { setSelected(null); setEditMode(false); setAddingGroup(false); setConnectingGroup(false) }}>
          <div className="bg-white rounded-2xl shadow-xl w-[680px] max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

            {/* 모달 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-border flex-shrink-0">
              {editMode ? (
                <>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[15px] font-extrabold">{selected.name}</span>
                    {editImageError && (
                      <span className="text-[11px] text-danger mt-0.5">{editImageError}</span>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button onClick={() => { setEditMode(false); setEditImageError('') }} className="px-3 py-1.5 text-[12px] font-bold text-gray-text bg-gray-100 rounded-lg hover:bg-gray-200">취소</button>
                    <button onClick={saveEdit} disabled={editSaving} className="px-3 py-1.5 text-[12px] font-bold text-white bg-green rounded-lg hover:bg-[#015c28] disabled:opacity-50">
                      {editSaving ? '저장 중...' : '저장'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="text-[17px] font-extrabold text-ink">{selected.name}</div>
                      <span className="text-[12px] text-gray-text">{getCategoryName(selected.categoryId) || '카테고리 없음'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={startEdit} className="px-3 py-1.5 text-[12px] font-medium text-gray-text bg-gray-100 rounded-lg hover:bg-gray-200">수정</button>
                    <button onClick={() => setDeleteConfirm('single')} className="px-3 py-1.5 text-[12px] font-medium text-danger bg-red-50 rounded-lg hover:bg-red-100">삭제</button>
                    <button onClick={() => { setSelected(null); setEditMode(false); setAddingGroup(false); setConnectingGroup(false) }} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-text hover:bg-gray-100 text-[18px]">✕</button>
                  </div>
                </>
              )}
            </div>

            {/* 모달 바디 */}
            <div className="overflow-y-auto flex-1 p-6 space-y-5">

              {/* 기본 정보 편집 폼 */}
              {editMode && (
                <div className="space-y-3">
                  {/* 상단: 사진(소형) + 이름/가격 */}
                  <div className="flex gap-3">
                    {/* 사진 — 작은 정방형 */}
                    <div className="flex-shrink-0 flex flex-col gap-1">
                      <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide">메뉴 사진</span>
                      <div className="flex flex-col items-center gap-1">
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
                          <div className="w-[76px] h-[76px] border-2 border-dashed border-gray-border rounded-xl flex flex-col items-center justify-center gap-1 hover:border-green hover:bg-green-soft/20 transition-colors">
                            <span className="text-[18px]">📷</span>
                            <span className="text-[10px] text-gray-text leading-tight text-center">사진<br/>추가</span>
                          </div>
                        )}
                      </label>
                      {editImagePreview && (
                        <button type="button" onClick={() => { setEditImageFile(null); setEditImagePreview('') }}
                          className="text-[10px] text-danger hover:underline">제거</button>
                      )}
                      </div>
                    </div>
                    {/* 이름 + 가격 */}
                    <div className="flex-1 flex flex-col gap-2">
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
                    </div>
                  </div>
                  {/* 설명 */}
                  <label className="block">
                    <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide">설명</span>
                    <textarea value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                      rows={2} className="mt-1 w-full border border-gray-border rounded-lg px-3 py-2 text-[13px] resize-none" />
                  </label>
                  {/* 판매/표시 상태 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">판매 상태</span>
                      <div className="flex bg-gray-100 rounded-lg p-0.5">
                        {[{ label: '판매중', val: false }, { label: '품절', val: true }].map(({ label, val }) => (
                          <button key={label} type="button" onClick={() => setEditForm(p => ({ ...p, soldOut: val }))}
                            className={`flex-1 py-1.5 rounded-md text-[12px] font-bold transition-all
                              ${editForm.soldOut === val ? 'bg-white shadow-sm text-ink' : 'text-gray-text'}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">표시 상태</span>
                      <div className="flex bg-gray-100 rounded-lg p-0.5">
                        {[{ label: '노출', val: true }, { label: '숨김', val: false }].map(({ label, val }) => (
                          <button key={label} type="button" onClick={() => setEditForm(p => ({ ...p, active: val }))}
                            className={`flex-1 py-1.5 rounded-md text-[12px] font-bold transition-all
                              ${editForm.active === val ? 'bg-white shadow-sm text-ink' : 'text-gray-text'}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 보기 모드 */}
              {!editMode && (
                <div className="flex gap-3">
                  {/* 썸네일 */}
                  {selected.imageUrl && (
                    <div className="w-[88px] h-[88px] flex-shrink-0 rounded-xl overflow-hidden border border-gray-border">
                      <img src={selected.imageUrl} alt={selected.name} className="w-full h-full object-cover" />
                    </div>
                  )}
                  {/* 정보 */}
                  <div className="flex-1 bg-gray-bg rounded-xl px-4 py-3 space-y-2">
                    <div className="flex justify-between text-[13px]">
                      <span className="text-gray-text">기본 가격</span>
                      <span className="font-bold">{won(selected.price)}</span>
                    </div>
                    <div className="flex justify-between text-[13px]">
                      <span className="text-gray-text">카테고리</span>
                      <span className="font-semibold text-ink">{getCategoryName(selected.categoryId) || <span className="text-gray-border italic text-[12px]">미지정</span>}</span>
                    </div>
                    <div className="flex justify-between items-center text-[13px]">
                      <span className="text-gray-text">판매 상태</span>
                      {selected.soldOut
                        ? <span className="text-[11px] font-semibold text-danger bg-red-50 px-2 py-0.5 rounded-full">품절</span>
                        : <span className="text-[11px] font-semibold text-green bg-green-soft px-2 py-0.5 rounded-full">판매중</span>}
                    </div>
                    <div className="flex justify-between items-center text-[13px]">
                      <span className="text-gray-text">표시 상태</span>
                      {selected.active
                        ? <span className="text-[11px] font-semibold text-ink bg-gray-bg px-2 py-0.5 rounded-full">노출</span>
                        : <span className="text-[11px] font-semibold text-gray-text bg-gray-100 px-2 py-0.5 rounded-full">숨김</span>}
                    </div>
                    {selected.description && (
                      <div className="pt-1 border-t border-gray-border text-[12px] text-gray-text">{selected.description}</div>
                    )}
                  </div>
                </div>
              )}

              {/* 옵션 그룹 연결 — 편집 모드에서 체크박스로 연결/해제 */}
              {editMode && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[13px] font-extrabold text-ink">옵션 그룹 연결</span>
                    <span className="text-[11px] text-gray-text">옵션그룹 탭에서 그룹을 먼저 만드세요</span>
                  </div>
                  {storeGroups.length === 0 ? (
                    <div className="text-[13px] text-gray-text text-center py-8 border border-dashed border-gray-border rounded-xl">
                      등록된 옵션 그룹 없음 — 상단 '옵션그룹' 탭에서 추가
                    </div>
                  ) : (
                    <div className="border border-gray-border rounded-xl divide-y divide-gray-border overflow-hidden">
                      {storeGroups.map(g => {
                        const connected = selected.optionGroups.some(og => og.id === g.id)
                        return (
                          <label key={g.id}
                            className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${connected ? 'bg-green-soft/40' : 'hover:bg-gray-bg'}`}>
                            <input type="checkbox" checked={connected}
                              onChange={() => connected ? disconnectGroup(g.id) : connectGroup(g.id)}
                              className="w-4 h-4 accent-green flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <span className="text-[13px] font-semibold text-ink">{g.name}</span>
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                {g.items.map(it => (
                                  <span key={it.id} className="text-[11px] text-gray-text bg-gray-100 px-1.5 py-0.5 rounded-full">
                                    {it.name}{it.extra > 0 ? ` +${it.extra.toLocaleString()}` : ''}
                                  </span>
                                ))}
                              </div>
                            </div>
                            {connected && <span className="text-[11px] font-bold text-green flex-shrink-0">연결됨</span>}
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 옵션 그룹 세부내용 — 보기 모드에서 연결된 그룹의 항목 표시 */}
              {!editMode && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[13px] font-extrabold text-ink">옵션 그룹</span>
                    {selected.optionGroups.length > 0 && (
                      <span className="text-[11px] text-gray-text">{selected.optionGroups.length}개 연결됨</span>
                    )}
                  </div>
                  {selected.optionGroups.length === 0 ? (
                    <div className="text-[13px] text-gray-text text-center py-8 border border-dashed border-gray-border rounded-xl">
                      연결된 옵션 그룹이 없습니다
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selected.optionGroups.map(g => (
                        <div key={g.id} className="border border-gray-border rounded-xl overflow-hidden">
                          {/* 그룹 헤더 */}
                          <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-bg border-b border-gray-border">
                            <span className="text-[13px] font-extrabold text-ink">{g.name}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${g.isRequired ? 'bg-ink text-white' : 'bg-gray-200 text-gray-text'}`}>
                              {g.isRequired ? '필수' : '선택'}
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-200 text-gray-text">
                              {g.isMulti ? `복수${g.maxSelect ? ` (최대 ${g.maxSelect})` : ''}` : '단일'}
                            </span>
                          </div>
                          {/* 항목 목록 */}
                          <div className="divide-y divide-gray-border">
                            {g.items.map(item => (
                              <div key={item.id} className={`flex items-center justify-between px-4 py-2 ${item.soldOut ? 'opacity-50' : ''}`}>
                                <div className="flex items-center gap-2">
                                  <span className="text-[13px] text-ink">{item.name}</span>
                                  {item.isPopular && <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">인기</span>}
                                  {item.soldOut   && <span className="text-[10px] font-bold text-gray-text bg-gray-100 px-1.5 py-0.5 rounded-full">품절</span>}
                                  {item.hidden    && <span className="text-[10px] font-bold text-gray-text bg-gray-100 px-1.5 py-0.5 rounded-full">숨김</span>}
                                </div>
                                <span className="text-[12px] font-semibold text-gray-text flex-shrink-0">
                                  {item.extra > 0 ? `+${won(item.extra)}` : '기본'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 수정 중 안내 배너 */}
          {editMode && (
            <div
              className="w-[680px] flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white/90"
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
      {!loading && tab === 'option' && (
        <div className="flex-1 overflow-y-auto">
          {/* 옵션 탭 헤더 */}
          <div className="px-6 py-4 border-b border-gray-border flex items-center justify-between flex-shrink-0">
            <div>
              <div className="text-[15px] font-extrabold">옵션 그룹 관리</div>
              <div className="text-[12px] text-gray-text mt-0.5">그룹을 만들고 메뉴 탭에서 메뉴에 연결하세요.</div>
            </div>
          </div>

          <div className="px-6 py-4 space-y-4 max-w-[700px]">
            {/* 그룹 생성 폼 */}
            {addingStoreGroup && (
              <div className="border-2 border-green rounded-xl p-4 space-y-3">
                <input autoFocus value={newStoreGroup.name}
                  onChange={e => setNewStoreGroup(p => ({ ...p, name: e.target.value }))}
                  placeholder="옵션 그룹명 (예: 드레싱 선택, 사이즈)"
                  className="w-full border border-gray-border rounded-lg px-3 py-2 text-[13px]"
                  onKeyDown={e => e.key === 'Enter' && createStandaloneGroup()}
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => setNewStoreGroup(p => ({ ...p, isRequired: !p.isRequired }))}
                    className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors
                      ${newStoreGroup.isRequired ? 'bg-ink text-white border-ink' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                    {newStoreGroup.isRequired ? '필수' : '선택 (필수로 변경)'}
                  </button>
                  <button onClick={() => setNewStoreGroup(p => ({ ...p, isMulti: !p.isMulti, maxSelect: '' }))}
                    className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors
                      ${newStoreGroup.isMulti ? 'bg-ink text-white border-ink' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                    {newStoreGroup.isMulti ? '복수 선택' : '단일 선택 (복수로 변경)'}
                  </button>
                  {newStoreGroup.isMulti && (
                    <input type="number" min="1" value={newStoreGroup.maxSelect}
                      onChange={e => setNewStoreGroup(p => ({ ...p, maxSelect: e.target.value }))}
                      placeholder="최대 N개"
                      className="w-20 border border-gray-border rounded-lg px-2 py-1 text-[12px]"
                    />
                  )}
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setAddingStoreGroup(false)}
                    className="px-3 py-1.5 text-[12px] font-bold text-gray-text bg-gray-100 rounded-lg hover:bg-gray-200">취소</button>
                  <button onClick={createStandaloneGroup} disabled={!newStoreGroup.name.trim()}
                    className="px-3 py-1.5 text-[12px] font-bold text-white bg-green rounded-lg hover:bg-[#015c28] disabled:opacity-40">
                    그룹 추가
                  </button>
                </div>
              </div>
            )}

            {storeGroups.length === 0 && !addingStoreGroup && (
              <div className="text-center py-16 text-gray-text text-[13px]">
                등록된 옵션 그룹이 없습니다. 위 버튼으로 추가하세요.
              </div>
            )}

            {storeGroups.map(group => (
              <OptionGroupCard
                key={group.id}
                group={group}
                usedBy={group.usedBy}
                onUpdateGroup={updates => updateStoreGroup(group.id, updates)}
                onDeleteGroup={() => deleteStoreGroup(group.id)}
                onUpdateItem={(itemId, updates) => updateStoreItem(group.id, itemId, updates)}
                onDeleteItem={itemId => deleteStoreItem(group.id, itemId)}
                onAddItem={(name, extra) => addStoreItem(group.id, name, extra)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── 카테고리 탭 ── */}
      {!loading && tab === 'category' && (
        <div className="flex-1 overflow-y-auto px-6 py-5">
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

          {addingCat && (
            <div className="flex items-center gap-2 mt-4 mb-2 p-3 border-2 border-green rounded-xl bg-green-soft/20">
              <input autoFocus value={newCatName} onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newCatName.trim()) { addCategory(newCatName); setNewCatName(''); setAddingCat(false) }
                  if (e.key === 'Escape') setAddingCat(false)
                }}
                placeholder="카테고리 이름 (예: 리뷰이벤트, 이달의메뉴)"
                className="flex-1 border border-gray-border rounded-lg px-3 py-2 text-[13px]"
              />
              <button onClick={() => { if (newCatName.trim()) { addCategory(newCatName); setNewCatName(''); setAddingCat(false) } }}
                disabled={!newCatName.trim()}
                className="px-4 py-2 text-[13px] font-bold text-white bg-green rounded-lg hover:bg-[#015c28] disabled:opacity-40">
                추가
              </button>
              <button onClick={() => setAddingCat(false)}
                className="px-3 py-2 text-[13px] font-bold text-gray-text bg-gray-100 rounded-lg hover:bg-gray-200">
                취소
              </button>
            </div>
          )}

          <div className="mt-4 border border-gray-border rounded-xl overflow-hidden divide-y divide-gray-border">
            {sortedCategories().length === 0 && (
              <div className="py-10 text-center text-[13px] text-gray-text">
                카테고리가 없습니다. 위에서 추가해주세요.
              </div>
            )}
            {sortedCategories().map((cat, idx, arr) => {
              const catMenus = menus.filter(m => m.categoryId === cat.id)
              const isExpanded = expandedCatId === cat.id
              return (
                <div
                  key={cat.id}
                  draggable
                  onDragStart={() => { setDragId(cat.id); setExpandedCatId(null) }}
                  onDragOver={e => { e.preventDefault(); setDragOverId(cat.id) }}
                  onDrop={e => { e.preventDefault(); handleCatDrop(cat.id); setDragOverId(null) }}
                  onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                  className={dragOverId === cat.id && dragId !== cat.id ? 'border-t-2 border-[#16a84c]' : ''}
                >
                  {/* ── 카테고리 행 ── */}
                  <div
                    className={`flex items-center gap-3 px-5 py-3 hover:bg-gray-bg/50 cursor-pointer select-none transition-colors ${dragId === cat.id ? 'opacity-40 bg-gray-bg' : 'bg-white'}`}
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

                    <span className="text-[12px] font-bold text-gray-text w-5 text-center flex-shrink-0">{idx + 1}</span>

                    <span className="text-[14px] font-medium text-ink flex-shrink-0">{cat.name}</span>

                    <div className="flex flex-wrap gap-1 flex-1 min-w-0 overflow-hidden">
                      {catMenus.length === 0
                        ? <span className="text-[12px] text-gray-text">—</span>
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
                        setCatEditModalId(cat.id)
                      }}
                      className="flex-shrink-0 text-[12px] font-semibold text-gray-text bg-gray-100 px-2.5 py-1 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      수정
                    </button>

                    <button
                      onClick={e => { e.stopPropagation(); setCatDeleteModalId(cat.id) }}
                      className="flex-shrink-0 text-[12px] font-semibold text-danger border border-danger/30 px-2.5 py-1 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      삭제
                    </button>

                    {/* 펼침 화살표 */}
                    <span className={`flex-shrink-0 text-gray-text text-[11px] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                  </div>

                  {/* ── 아코디언: 메뉴 목록 ── */}
                  {isExpanded && (
                    <div className="bg-gray-bg border-t border-gray-border px-6 py-4">
                      {catMenus.length === 0 ? (
                        <p className="text-[12px] text-gray-text py-1">이 카테고리에 메뉴가 없습니다.</p>
                      ) : (
                        <div className="grid grid-cols-3 gap-3">
                          {catMenus
                            .slice()
                            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                            .map(m => (
                              <div key={m.code} className="bg-white rounded-xl overflow-hidden border border-gray-border shadow-sm">
                                {/* 썸네일 */}
                                <div className="w-full aspect-[4/3] bg-gray-100 flex items-center justify-center overflow-hidden">
                                  {m.imageUrl
                                    ? <img src={m.imageUrl} alt={m.name} className="w-full h-full object-cover" />
                                    : <span className="text-[32px]">{m.emoji}</span>
                                  }
                                </div>
                                {/* 정보 */}
                                <div className="px-3 py-2.5">
                                  <div className="flex items-start justify-between gap-1 mb-1">
                                    <span className="text-[13px] font-semibold text-ink leading-snug">{m.name}</span>
                                    <div className="flex flex-col gap-0.5 items-end flex-shrink-0">
                                      {m.soldOut  && <span className="text-[10px] font-bold text-white bg-gray-400 rounded px-1.5 py-0.5 leading-none">품절</span>}
                                      {!m.active  && <span className="text-[10px] font-bold text-gray-text bg-gray-200 rounded px-1.5 py-0.5 leading-none">숨김</span>}
                                    </div>
                                  </div>
                                  <span className="text-[12px] font-bold text-gray-text">{won(m.price)}</span>
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
                <div className="text-[12px] font-bold text-gray-text uppercase tracking-wide mb-2">
                  카테고리 미지정 메뉴 · {uncat.length}개
                </div>
                <div className="flex flex-wrap gap-2">
                  {uncat.map(m => (
                    <span key={m.code} className="text-[12px] font-semibold text-gray-text bg-gray-100 rounded-full px-3 py-1">
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
            <div className="bg-white rounded-2xl shadow-xl w-[520px] max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* 헤더 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-border flex-shrink-0">
                <div className="text-[16px] font-extrabold">카테고리 수정</div>
                <button onClick={() => setCatEditModalId(null)} className="text-gray-text hover:text-ink text-[18px]">✕</button>
              </div>

              {/* 이름 */}
              <div className="px-6 pt-5 pb-4 flex-shrink-0">
                <label className="text-[11px] font-bold text-gray-text block mb-1.5">카테고리 이름</label>
                <input
                  value={catEditNameDraft}
                  onChange={e => setCatEditNameDraft(e.target.value)}
                  className="w-full border border-gray-border rounded-xl px-4 py-2.5 text-[14px] font-semibold focus:outline-none focus:border-green"
                />
              </div>

              {/* 메뉴 선택 */}
              <div className="px-6 pb-2 flex-shrink-0">
                <div className="text-[11px] font-bold text-gray-text mb-2">메뉴 선택 <span className="font-normal text-gray-text/70">(체크된 메뉴가 이 카테고리에 속합니다)</span></div>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-4">
                {menus.length === 0 ? (
                  <div className="text-[13px] text-gray-text py-4 text-center">등록된 메뉴가 없습니다</div>
                ) : (
                  <div className="space-y-1.5">
                    {menus.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(m => {
                      const checked = catEditChecked.has(m.code)
                      return (
                        <label key={m.code} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${checked ? 'bg-green-soft' : 'hover:bg-gray-bg'}`}>
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
                            className="w-4 h-4 accent-green flex-shrink-0"
                          />
                          {/* 썸네일 */}
                          <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {m.imageUrl
                              ? <img src={m.imageUrl} alt={m.name} className="w-full h-full object-cover" />
                              : <span className="text-[20px]">{m.emoji}</span>
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold text-ink truncate">{m.name}</div>
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
              <div className="flex gap-3 px-6 py-4 border-t border-gray-border flex-shrink-0">
                <button onClick={() => setCatEditModalId(null)}
                  className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-text font-bold hover:bg-gray-200 transition-colors">
                  취소
                </button>
                <button
                  onClick={() => saveCategoryEdit(catEditModalId, catEditNameDraft, catEditChecked)}
                  disabled={!catEditNameDraft.trim() || catEditSaving}
                  className="flex-[2] py-3 rounded-xl bg-green text-white font-bold hover:opacity-90 transition-opacity disabled:opacity-40"
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
            <div className="bg-white rounded-2xl shadow-xl w-[440px] max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* 헤더 */}
              <div className="px-6 py-5 flex-shrink-0">
                <div className="text-[17px] font-extrabold mb-1">
                  <span className="text-danger">'{cat.name}'</span> 카테고리를 삭제하시겠어요?
                </div>
                <div className="text-[13px] text-gray-text">
                  {catMenus.length > 0
                    ? `아래 ${catMenus.length}개 메뉴의 카테고리가 해제됩니다.`
                    : '이 카테고리에 연결된 메뉴가 없습니다.'}
                </div>
              </div>

              {/* 메뉴 목록 */}
              {catMenus.length > 0 && (
                <div className="flex-1 overflow-y-auto px-6 pb-4">
                  <div className="space-y-2">
                    {catMenus.map(m => (
                      <div key={m.code} className="flex items-center gap-3 bg-gray-bg rounded-xl px-3 py-2.5">
                        <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {m.imageUrl
                            ? <img src={m.imageUrl} alt={m.name} className="w-full h-full object-cover" />
                            : <span className="text-[24px]">{m.emoji}</span>
                          }
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold text-ink">{m.name}</div>
                          <div className="text-[12px] text-gray-text">{won(m.price)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 푸터 */}
              <div className="flex gap-3 px-6 py-4 border-t border-gray-border flex-shrink-0">
                <button onClick={() => setCatDeleteModalId(null)}
                  className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-text font-bold hover:bg-gray-200 transition-colors">
                  취소
                </button>
                <button
                  onClick={() => { deleteCategory(catDeleteModalId); setCatDeleteModalId(null) }}
                  className="flex-1 py-3 rounded-xl bg-danger text-white font-bold hover:bg-danger/90 transition-colors"
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── 메뉴 추가 모달 ── */}
      {addMenuOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAddMenuOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-[500px] max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

            {/* 헤더 */}
            <div className="flex items-center justify-between px-6 pt-4 pb-0 flex-shrink-0">
              <span className="text-[16px] font-extrabold">메뉴 추가</span>
              <button onClick={() => setAddMenuOpen(false)} className="text-gray-text hover:text-ink text-[18px]">✕</button>
            </div>
            {/* 탭 */}
            <div className="flex gap-0 px-6 mt-3 border-b border-gray-border flex-shrink-0">
              {([{ v: 'bulk', l: '일괄 추가' }, { v: 'detail', l: '상세 추가' }] as const).map(({ v, l }) => (
                <button key={v} onClick={() => { setAddModalTab(v); setAddError('') }}
                  className={`px-5 py-2.5 text-[13px] font-bold border-b-2 transition-colors -mb-px
                    ${addModalTab === v ? 'border-ink text-ink' : 'border-transparent text-gray-text hover:text-ink'}`}>
                  {l}
                </button>
              ))}
            </div>

            {/* 카테고리 (공통) */}
            <div className="px-6 pt-4 flex-shrink-0">
              <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">
                카테고리 <span className="text-danger">*</span>
              </label>
              {addingNewCat ? (
                <div className="flex gap-2">
                  <input autoFocus value={newCatInModal} onChange={e => setNewCatInModal(e.target.value)}
                    placeholder="새 카테고리 이름"
                    className="flex-1 border border-green rounded-lg px-3 py-2 text-[13px]"
                    onKeyDown={e => e.key === 'Escape' && setAddingNewCat(false)}
                  />
                  <button type="button" onClick={() => setAddingNewCat(false)}
                    className="px-3 py-2 border border-gray-border rounded-lg text-[12px] font-bold text-gray-text hover:bg-gray-100 flex-shrink-0">
                    취소
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <select value={addCategoryId} onChange={e => setAddCategoryId(e.target.value)}
                    className="flex-1 border border-gray-border rounded-lg px-3 py-2 text-[13px] bg-white">
                    <option value="">카테고리 선택</option>
                    {sortedCategories().map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => { setAddingNewCat(true); setNewCatInModal('') }}
                    className="px-3 py-2 border border-gray-border rounded-lg text-[12px] font-bold text-gray-text hover:border-green hover:text-green transition-colors flex-shrink-0">
                    + 새로 만들기
                  </button>
                </div>
              )}
            </div>

            {/* ── 일괄 추가 탭 ── */}
            {addModalTab === 'bulk' && (
              <div className="px-6 py-4 space-y-3 overflow-y-auto flex-1">
                <div className="grid grid-cols-[1fr_120px_28px] gap-2">
                  <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide">메뉴명</span>
                  <span className="text-[11px] font-bold text-gray-text uppercase tracking-wide">가격 (원)</span>
                  <span />
                </div>
                <div className="space-y-2">
                  {addRows.map((row, idx) => (
                    <div key={row.id} className="grid grid-cols-[1fr_120px_28px] gap-2 items-center">
                      <input autoFocus={idx === 0}
                        value={row.name} onChange={e => updateRow(row.id, 'name', e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRowLine() } }}
                        placeholder={`메뉴명 ${idx + 1}`}
                        className="border border-gray-border rounded-lg px-3 py-2 text-[13px] focus:border-green focus:outline-none"
                      />
                      <input type="number" min="0" step="100"
                        value={row.price} onChange={e => updateRow(row.id, 'price', e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRowLine() } }}
                        placeholder="0"
                        className="border border-gray-border rounded-lg px-3 py-2 text-[13px] focus:border-green focus:outline-none"
                      />
                      <button type="button" onClick={() => removeRowLine(row.id)}
                        disabled={addRows.length === 1}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-text hover:text-danger hover:bg-red-50 transition-colors disabled:opacity-20">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addRowLine}
                  className="w-full py-2 border-2 border-dashed border-gray-border rounded-xl text-[13px] font-bold text-gray-text hover:border-green hover:text-green transition-colors">
                  + 한 줄 추가 (Enter)
                </button>
                {addError && <p className="text-[13px] text-danger bg-red-50 rounded-lg px-3 py-2">{addError}</p>}
              </div>
            )}

            {/* ── 상세 추가 탭 ── */}
            {addModalTab === 'detail' && (
              <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
                {/* 사진 */}
                <div>
                  <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">사진</label>
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
                      <div className="relative w-full aspect-square rounded-xl overflow-hidden border border-gray-border">
                        <img src={imagePreview} className="w-full h-full object-cover" alt="preview" />
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                          <span className="text-white text-[13px] font-bold">사진 변경</span>
                        </div>
                      </div>
                    ) : (
                      <div className="w-full aspect-square border-2 border-dashed border-gray-border rounded-xl flex items-center justify-center gap-2 hover:border-green hover:bg-green-soft/20 transition-colors">
                        <span className="text-[20px]">📷</span>
                        <span className="text-[12px] text-gray-text">클릭하여 사진 추가</span>
                      </div>
                    )}
                  </label>
                  {imagePreview && (
                    <button type="button" onClick={() => { setImageFile(null); setImagePreview('') }}
                      className="mt-1 text-[11px] text-danger hover:underline">사진 제거</button>
                  )}
                </div>
                {/* 메뉴명 */}
                <div>
                  <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1">메뉴명 *</label>
                  <input autoFocus value={detailForm.name}
                    onChange={e => setDetailForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="예: 클래식 포케"
                    className="w-full border border-gray-border rounded-lg px-3 py-2 text-[13px] focus:border-green focus:outline-none"
                  />
                </div>
                {/* 가격 */}
                <div>
                  <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1">기본 가격 (원) *</label>
                  <input type="number" min="0" step="100" value={detailForm.price}
                    onChange={e => setDetailForm(p => ({ ...p, price: e.target.value }))}
                    placeholder="0"
                    className="w-full border border-gray-border rounded-lg px-3 py-2 text-[13px] focus:border-green focus:outline-none"
                  />
                </div>
                {/* 설명 */}
                <div>
                  <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1">설명</label>
                  <textarea value={detailForm.description}
                    onChange={e => setDetailForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="메뉴 설명 (선택)" rows={2}
                    className="w-full border border-gray-border rounded-lg px-3 py-2 text-[13px] resize-none focus:border-green focus:outline-none"
                  />
                </div>
                {/* 옵션 그룹 */}
                {storeGroups.length > 0 && (
                  <div>
                    <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">옵션 그룹 연결</label>
                    <div className="border border-gray-border rounded-xl divide-y divide-gray-border overflow-hidden">
                      {storeGroups.map(g => (
                        <label key={g.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-bg cursor-pointer">
                          <input type="checkbox" checked={selectedGroupIds.includes(g.id)}
                            onChange={e => setSelectedGroupIds(prev =>
                              e.target.checked ? [...prev, g.id] : prev.filter(id => id !== g.id)
                            )}
                            className="w-4 h-4 accent-green flex-shrink-0"
                          />
                          <span className="text-[13px] font-semibold text-ink flex-1">{g.name}</span>
                          <span className="text-[11px] text-gray-text">{g.items.length}개 항목</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {addError && <p className="text-[13px] text-danger bg-red-50 rounded-lg px-3 py-2">{addError}</p>}
              </div>
            )}

            {/* 푸터 */}
            <div className="flex gap-3 px-6 py-4 border-t border-gray-border flex-shrink-0">
              <button onClick={() => setAddMenuOpen(false)}
                className="flex-1 py-3 rounded-xl bg-gray-100 text-[13px] font-bold text-gray-text hover:bg-gray-200 transition-colors">
                취소
              </button>
              {addModalTab === 'bulk' ? (
                <button onClick={confirmAddMenu} disabled={addLoading}
                  className="flex-[2] py-3 rounded-xl bg-[#16a84c] text-white text-[13px] font-bold hover:bg-[#128040] transition-colors disabled:opacity-50">
                  {addLoading ? '저장 중...' : `${addRows.filter(r => r.name.trim() && r.price.trim()).length}개 추가`}
                </button>
              ) : (
                <button onClick={confirmDetailMenu} disabled={addLoading}
                  className="flex-[2] py-3 rounded-xl bg-[#16a84c] text-white text-[13px] font-bold hover:bg-[#128040] transition-colors disabled:opacity-50">
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
        const allSoldOut  = checkedMenus.every(m => m.soldOut)
        const allHidden   = checkedMenus.every(m => !m.active)
        return (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-ink text-white rounded-2xl shadow-xl px-6 py-3 flex items-center gap-4 z-30">
            <span className="text-[13px] font-semibold text-white/70">{checked.size}개 선택</span>
            <div className="w-px h-5 bg-white/20" />
            <button onClick={() => bulkAction(allSoldOut ? 'unsoldOut' : 'soldOut')}
              className="text-[13px] font-bold hover:text-green transition-colors">
              {allSoldOut ? '품절 해제' : '품절'}
            </button>
            <div className="w-px h-5 bg-white/20" />
            <button onClick={() => bulkAction(allHidden ? 'unhide' : 'hide')}
              className="text-[13px] font-bold hover:text-green transition-colors">
              {allHidden ? '숨김 해제' : '숨김'}
            </button>
            <div className="w-px h-5 bg-white/20" />
            <button onClick={() => setDeleteConfirm('bulk')}
              className="text-[13px] font-bold text-red-400 hover:text-red-300 transition-colors">
              삭제
            </button>
            <button onClick={() => setChecked(new Set())} className="text-white/50 hover:text-white text-[18px] ml-1">✕</button>
          </div>
        )
      })()}

      {/* 삭제 확인 다이얼로그 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-[320px] p-6">
            <h3 className="text-[15px] font-bold text-ink mb-2">
              {deleteConfirm === 'bulk'
                ? `${checked.size}개 메뉴를 삭제할까요?`
                : `'${selected?.name}'을(를) 삭제할까요?`}
            </h3>
            <p className="text-[13px] text-gray-text mb-6">삭제하면 되돌릴 수 없습니다.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 border border-gray-border rounded-xl text-[13px] font-semibold text-gray-text hover:bg-gray-bg">
                취소
              </button>
              <button
                onClick={() => {
                  if (deleteConfirm === 'bulk') deleteMenus([...checked])
                  else if (selected) deleteMenus([selected.code])
                }}
                className="flex-1 py-2.5 bg-danger text-white rounded-xl text-[13px] font-bold hover:bg-red-700">
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── OptionGroupCard ────────────────────────────────────────────────────────────
function OptionGroupCard({
  group, usedBy, onUpdateGroup, onDeleteGroup, onUpdateItem, onDeleteItem, onAddItem,
}: {
  group:          OptionGroup
  usedBy?:        string[]
  onUpdateGroup:  (updates: Partial<OptionGroup>) => void
  onDeleteGroup:  () => void
  onUpdateItem:   (itemId: string, updates: Partial<OptionItem>) => void
  onDeleteItem:   (itemId: string) => void
  onAddItem:      (name: string, extra: number) => void
}) {
  const [editingName, setEditingName] = useState(false)
  const [nameDraft,   setNameDraft]   = useState(group.name)
  const [editingItemId,  setEditingItemId]  = useState<string | null>(null)
  const [editItemName,   setEditItemName]   = useState('')
  const [editItemPrice,  setEditItemPrice]  = useState('')
  const [showAddItem,    setShowAddItem]    = useState(false)
  const [newItemName,    setNewItemName]    = useState('')
  const [newItemPrice,   setNewItemPrice]   = useState('0')
  const [settingsOpen,   setSettingsOpen]   = useState(false)
  const [settingsName,   setSettingsName]   = useState(group.name)
  const [deleteConfirm,  setDeleteConfirm]  = useState(false)

  const SELECT_OPTIONS = [
    { label: '단일 선택',    isMulti: false, max: null },
    { label: '복수 (무제한)', isMulti: true,  max: null },
    { label: '최대 2개',     isMulti: true,  max: 2    },
    { label: '최대 3개',     isMulti: true,  max: 3    },
    { label: '최대 4개',     isMulti: true,  max: 4    },
    { label: '최대 5개',     isMulti: true,  max: 5    },
  ]

  const currentLabel = !group.isMulti ? '단일' : group.maxSelect ? `최대 ${group.maxSelect}개` : '복수'

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

  return (
    <div className="border border-gray-border rounded-xl overflow-hidden">
      {/* 그룹 헤더 */}
      <div className="px-4 py-2.5 bg-gray-bg border-b border-gray-border">
        <div className="flex items-center gap-2">
          {editingName ? (
            <input autoFocus value={nameDraft} onChange={e => setNameDraft(e.target.value)}
              onBlur={commitGroupName}
              onKeyDown={e => { if (e.key === 'Enter') commitGroupName(); if (e.key === 'Escape') { setNameDraft(group.name); setEditingName(false) } }}
              className="flex-1 min-w-0 border border-green rounded-md px-2 py-0.5 text-[13px] font-bold bg-white"
            />
          ) : (
            <button onClick={() => { setNameDraft(group.name); setEditingName(true) }}
              className="font-bold text-[13px] text-ink hover:text-green transition-colors truncate text-left">{group.name}</button>
          )}
          <span className="flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">{group.isRequired ? '필수' : '선택'}</span>
          <span className="flex-shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">{currentLabel}</span>
          <div className="flex-1" />
          <button onClick={() => { setSettingsName(group.name); setDeleteConfirm(false); setSettingsOpen(true) }}
            className="flex-shrink-0 text-[15px] text-gray-text hover:text-ink transition-colors leading-none">⚙</button>
        </div>
        {usedBy !== undefined && usedBy.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {usedBy.map(name => (
              <span key={name} className="text-[12px] font-medium text-ink bg-white border border-gray-border px-2 py-0.5 rounded-md">
                {name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 설정 모달 */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-[380px]">
            <div className="flex items-center justify-between mb-5">
              <div className="text-[16px] font-extrabold">옵션 그룹 설정</div>
              <button onClick={() => setSettingsOpen(false)} className="text-gray-text hover:text-ink text-[18px]">✕</button>
            </div>
            <div className="mb-4">
              <label className="text-[11px] font-bold text-gray-text block mb-1">그룹명</label>
              <input value={settingsName} onChange={e => setSettingsName(e.target.value)}
                className="w-full border-0 border-b border-gray-border bg-transparent px-0 py-2 text-[14px] focus:outline-none focus:border-b-2 focus:border-[#16a84c] transition-colors" />
            </div>
            <div className="mb-4">
              <label className="text-[11px] font-bold text-gray-text block mb-2">필수 여부</label>
              <div className="flex bg-gray-100 rounded-xl p-0.5">
                {[{ label: '필수', val: true }, { label: '선택', val: false }].map(({ label, val }) => (
                  <button key={label} onClick={() => onUpdateGroup({ isRequired: val })}
                    className={`flex-1 py-2 rounded-[10px] text-[13px] font-bold transition-all focus:outline-none
                      ${group.isRequired === val ? 'bg-white shadow-sm text-ink' : 'text-gray-text'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-6">
              <label className="text-[11px] font-bold text-gray-text block mb-2">선택 방식</label>
              <div className="grid grid-cols-3 gap-2">
                {SELECT_OPTIONS.map(opt => {
                  const active = group.isMulti === opt.isMulti && group.maxSelect === opt.max
                  return (
                    <button key={opt.label} onClick={() => onUpdateGroup({ isMulti: opt.isMulti, maxSelect: opt.max })}
                      className={`py-2 rounded-xl border-2 text-[12px] font-bold transition-colors focus:outline-none
                        ${active ? 'border-transparent text-[#16a84c] bg-green-soft' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <button onClick={() => { if (settingsName.trim()) onUpdateGroup({ name: settingsName.trim() }); setSettingsOpen(false) }}
              className="w-full py-3 rounded-xl bg-[#16a84c] text-white font-bold text-[14px] hover:bg-[#128040] transition-colors focus:outline-none mb-3">
              저장
            </button>
            {!deleteConfirm ? (
              <button onClick={() => setDeleteConfirm(true)}
                className="w-full py-2.5 rounded-xl border-2 border-danger/40 text-danger font-bold text-[13px] hover:bg-red-50 transition-colors focus:outline-none">
                삭제
              </button>
            ) : (
              <div className="bg-red-50 rounded-xl p-3">
                <div className="text-[12px] text-danger font-semibold text-center mb-2">정말 삭제하시겠어요?</div>
                <div className="flex gap-2">
                  <button onClick={() => setDeleteConfirm(false)}
                    className="flex-1 py-2 rounded-lg bg-gray-100 text-gray-text text-[12px] font-bold hover:bg-gray-200 focus:outline-none">취소</button>
                  <button onClick={() => { onDeleteGroup(); setSettingsOpen(false) }}
                    className="flex-1 py-2 rounded-lg bg-danger text-white text-[12px] font-bold hover:bg-danger/90 focus:outline-none">삭제 확정</button>
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
            <div key={item.id} className="flex items-center gap-3 px-4 py-2">
              <input autoFocus value={editItemName} onChange={e => setEditItemName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitEditItem(); if (e.key === 'Escape') setEditingItemId(null) }}
                className="flex-1 min-w-0 border-0 border-b border-[#16a84c] bg-transparent px-0 py-1 text-[13px] focus:outline-none"
              />
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className="flex items-center gap-0.5 border-b border-[#16a84c]">
                  <span className="text-[13px] text-gray-text">+</span>
                  <input type="text" value={editItemPrice}
                    onChange={e => setEditItemPrice(e.target.value.replace(/[^0-9]/g, ''))}
                    onKeyDown={e => { if (e.key === 'Enter') commitEditItem(); if (e.key === 'Escape') setEditingItemId(null) }}
                    className="w-16 border-0 bg-transparent px-0 py-1 text-[13px] text-right focus:outline-none"
                  />
                  <span className="text-[12px] text-gray-text">원</span>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setEditItemPrice(String(Math.max(0, (parseInt(editItemPrice) || 0) - 500)))}
                    className="bg-gray-100 hover:bg-gray-200 rounded-md px-2 py-1 text-[11px] font-semibold text-gray-text">-500</button>
                  <button onClick={() => setEditItemPrice(String((parseInt(editItemPrice) || 0) + 500))}
                    className="bg-gray-100 hover:bg-gray-200 rounded-md px-2 py-1 text-[11px] font-semibold text-gray-text">+500</button>
                </div>
              </div>
              <button onClick={commitEditItem}
                className="flex-shrink-0 px-3 py-1 rounded-lg bg-[#16a84c] text-white text-[11px] font-bold hover:bg-[#128040]">완료</button>
            </div>
          ) : (
            <div key={item.id}
              className={`flex items-center gap-2 px-4 py-2.5 text-[12px] group/row transition-colors
                ${item.soldOut ? 'bg-red-50' : ''} ${item.hidden ? 'opacity-50' : ''}`}>
              <button onClick={() => startEditItem(item)}
                className="flex items-center gap-1.5 min-w-0 flex-1 text-left hover:text-green transition-colors">
                <span className="font-medium text-ink truncate">{item.name}</span>
                {item.isPopular && <span className="text-[10px] font-bold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full flex-shrink-0">🔥</span>}
                {item.extra > 0 && <span className="text-gray-text flex-shrink-0">+{won(item.extra)}</span>}
              </button>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => onUpdateItem(item.id, { soldOut: !item.soldOut })}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors
                    ${item.soldOut ? 'bg-danger text-white border-danger' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>품절</button>
                <button onClick={() => onUpdateItem(item.id, { hidden: !item.hidden })}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors
                    ${item.hidden ? 'bg-ink text-white border-ink' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>숨김</button>
                <button onClick={() => onDeleteItem(item.id)}
                  className="text-[14px] text-gray-text hover:text-danger transition-colors px-0.5 opacity-0 group-hover/row:opacity-100">×</button>
              </div>
            </div>
          )
        )}
      </div>

      {/* 항목 추가 */}
      {showAddItem ? (
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-gray-border bg-green-soft/40">
          <input autoFocus value={newItemName} onChange={e => setNewItemName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirmAddItem(); if (e.key === 'Escape') setShowAddItem(false) }}
            placeholder="옵션명" className="flex-1 min-w-0 border border-green rounded-md px-2 py-1 text-[12px]"
          />
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[11px] text-gray-text">+₩</span>
            <input type="number" min="0" step="500" value={newItemPrice} onChange={e => setNewItemPrice(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmAddItem(); if (e.key === 'Escape') setShowAddItem(false) }}
              className="w-20 border border-green rounded-md px-2 py-1 text-[12px]"
            />
          </div>
          <button onClick={confirmAddItem} disabled={!newItemName.trim()}
            className="flex-shrink-0 text-[11px] font-bold text-white bg-green px-2.5 py-1 rounded-lg hover:bg-[#015c28] disabled:opacity-40">추가</button>
          <button onClick={() => { setShowAddItem(false); setNewItemName(''); setNewItemPrice('0') }}
            className="flex-shrink-0 text-gray-text hover:text-ink text-[14px]">✗</button>
        </div>
      ) : (
        <button onClick={() => setShowAddItem(true)}
          className="w-full py-2 text-[12px] font-bold text-gray-text hover:text-green hover:bg-green-soft/30 transition-colors border-t border-gray-border">
          + 항목 추가
        </button>
      )}
    </div>
  )
}
