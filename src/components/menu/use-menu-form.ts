import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { mapMenuRow } from '../../lib/mappers'
import type { MenuDetail, OptionGroup } from '../../lib/mock-data'
import type { MenuFormValues } from './menu-form-types'

// 메뉴 추가/수정 모달의 "동작" 전부 — 폼 상태, 이미지 업로드, 저장, 옵션 그룹 연결.
//
// 왜 훅으로 뺐나: 같은 모달을 메뉴 화면(Menus.tsx)과 전체메뉴 > 상품 > 메뉴 상세
// (ProductHub.tsx) 두 군데서 쓴다. 저장 로직이 두 벌이 되면 한쪽만 고치는 날이 반드시 온다.
// 화면(JSX)은 MenuFormModal, 동작은 이 훅, 데이터 보관은 각 화면 — 세 조각으로 나눠 둔다.
//
// 이 훅이 모르는 것: 메뉴 목록을 어떻게 들고 있는지. 저장 결과는 onCreated/onUpdated 로
// 넘겨주고, 각 화면이 자기 방식대로(로컬 패치든 전체 재조회든) 반영한다.

/** 오늘 품절 — KST 자정까지 */
function getKSTEndOfDay(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 3600_000)
  kst.setUTCHours(23, 59, 59, 999)
  return new Date(kst.getTime() - 9 * 3600_000).toISOString()
}

/** 저장 후 optionGroups 를 다시 만들려면 items 까지 필요하다 */
export interface MenuFormStoreGroup {
  id:    string
  name:  string
  items: { id: string; name: string; extra: number; soldOut: boolean; soldOutUntil: string | null; hidden: boolean }[]
}

const EMPTY_FORM: MenuFormValues = {
  name: '', price: '', description: '', soldOutState: 'active', active: true,
  categoryId: '', isPopular: false, isRecommended: false, isNew: false,
}

export interface UseMenuFormOptions {
  /** 저장 결과를 화면에 반영할 방법 — 화면마다 다르다 */
  onCreated: (menu: MenuDetail) => void
  onUpdated: (menu: MenuDetail) => void
  showToast?: (msg: string) => void
}

export function useMenuForm({ onCreated, onUpdated, showToast }: UseMenuFormOptions) {
  const [mode,    setMode]    = useState<'add' | 'edit' | null>(null)
  const [editing, setEditing] = useState<MenuDetail | null>(null)
  const [form,    setForm]    = useState<MenuFormValues>(EMPTY_FORM)
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set())
  const [imageFile,    setImageFile]    = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState('')
  const [imageError,   setImageError]   = useState('')
  const [saving,       setSaving]       = useState(false)
  // 연 시점의 값. "아무것도 안 바꿨는데 저장이 활성"인 상태를 막으려고 들고 있는다.
  const [baseline, setBaseline] = useState<{ form: MenuFormValues; groups: string }>(
    { form: EMPTY_FORM, groups: '' },
  )

  function openEdit(menu: MenuDetail) {
    setEditing(menu)
    const nextForm: MenuFormValues = {
      name:          menu.name,
      price:         String(menu.price),
      description:   menu.description ?? '',
      soldOutState:  !menu.soldOut ? 'active' : menu.soldOutUntil ? 'today' : 'permanent',
      active:        menu.active,
      categoryId:    menu.categoryId ?? '',
      isPopular:     menu.isPopular,
      isRecommended: menu.isRecommended,
      isNew:         menu.isNew,
    }
    setForm(nextForm)
    setSelectedGroupIds(new Set(menu.optionGroups.map(g => g.id)))
    setImageFile(null)
    setImagePreview(menu.imageUrl ?? '')
    setImageError('')
    setBaseline({ form: nextForm, groups: [...menu.optionGroups.map(g => g.id)].sort().join(',') })
    setMode('edit')
  }

  function openAdd(categoryId = '') {
    setEditing(null)
    setForm({ ...EMPTY_FORM, categoryId })
    setSelectedGroupIds(new Set())
    setImageFile(null)
    setImagePreview('')
    setImageError('')
    setBaseline({ form: { ...EMPTY_FORM, categoryId }, groups: '' })
    setMode('add')
  }

  function close() {
    setMode(null)
    setImageError('')
  }

  function toggleGroup(id: string) {
    setSelectedGroupIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  /**
   * @param storeGroups 저장 후 optionGroups 를 복원하는 데 쓴다
   * @param nextDisplayOrder 추가 모드에서 쓸 display_order (목록을 아는 쪽이 계산)
   */
  async function save(storeGroups: MenuFormStoreGroup[], nextDisplayOrder = 1) {
    const priceNum = parseInt(form.price, 10)
    if (!form.name.trim() || isNaN(priceNum) || priceNum < 0) return

    setSaving(true)
    setImageError('')

    let imageUrl: string | undefined = mode === 'edit' ? editing?.imageUrl : undefined

    if (imageFile) {
      const ext = imageFile.name.split('.').pop() ?? 'jpg'
      const { data: up, error: upErr } = await supabase.storage
        .from('menu-images')
        .upload(`${crypto.randomUUID()}.${ext}`, imageFile, { contentType: imageFile.type })
      if (upErr || !up) {
        setImageError(`사진 업로드 실패: ${upErr?.message ?? '알 수 없는 오류'}`)
        setSaving(false)
        return
      }
      imageUrl = supabase.storage.from('menu-images').getPublicUrl(up.path).data.publicUrl
    }

    const soldOutUpdates = form.soldOutState === 'active'
      ? { is_sold_out: false, sold_out_until: null }
      : form.soldOutState === 'today'
      ? { is_sold_out: true, sold_out_until: getKSTEndOfDay() }
      : { is_sold_out: true, sold_out_until: null }

    const payload = {
      name:           form.name.trim(),
      base_price:     priceNum,
      description:    form.description || null,
      image_url:      imageUrl ?? null,
      category_id:    form.categoryId || null,
      is_hidden:      !form.active,
      is_popular:     form.isPopular,
      is_recommended: form.isRecommended,
      is_new:         form.isNew,
      ...soldOutUpdates,
    }

    // 선택된 그룹 id → OptionGroup. 이미 메뉴에 붙어 있던 그룹은 원본을 그대로 재사용한다
    // (isRequired/isMulti 같은 설정이 storeGroups 에는 없어서, 새로 만들면 기본값으로 덮인다)
    function buildOptionGroups(existing: OptionGroup[] = []): OptionGroup[] {
      return [...selectedGroupIds].map(id => {
        const prev = existing.find(g => g.id === id)
        if (prev) return prev
        const g = storeGroups.find(sg => sg.id === id)
        return g
          ? {
              id: g.id, name: g.name, isRequired: false, isMulti: false, maxSelect: null,
              items: g.items.map(it => ({ ...it, isPopular: false })),
            }
          : null
      }).filter(Boolean) as OptionGroup[]
    }

    if (mode === 'edit' && editing) {
      const { error: updateErr } = await supabase.from('menus').update(payload).eq('id', editing.code)
      if (updateErr) { setImageError(`저장 실패: ${updateErr.message}`); setSaving(false); return }

      const prevGroupIds = new Set(editing.optionGroups.map(g => g.id))
      const toAdd    = [...selectedGroupIds].filter(id => !prevGroupIds.has(id))
      const toRemove = [...prevGroupIds].filter(id => !selectedGroupIds.has(id))
      if (toAdd.length) {
        await supabase.from('menu_option_groups').insert(
          toAdd.map((id, i) => ({ menu_id: editing.code, option_group_id: id, display_order: prevGroupIds.size + i }))
        )
      }
      if (toRemove.length) {
        await supabase.from('menu_option_groups')
          .delete().eq('menu_id', editing.code).in('option_group_id', toRemove)
      }

      setSaving(false)
      onUpdated({
        ...editing,
        name: payload.name, price: priceNum, description: form.description, imageUrl,
        soldOut:       form.soldOutState !== 'active',
        soldOutUntil:  form.soldOutState === 'today' ? getKSTEndOfDay() : null,
        active:        form.active,
        categoryId:    form.categoryId || null,
        isPopular:     form.isPopular,
        isRecommended: form.isRecommended,
        isNew:         form.isNew,
        optionGroups:  buildOptionGroups(editing.optionGroups),
      })
      close()
      return
    }

    const { data, error } = await supabase.from('menus')
      .insert({ ...payload, display_order: nextDisplayOrder })
      .select('id, category_id, name, description, base_price, image_url, is_sold_out, sold_out_until, is_hidden, is_popular, is_recommended, is_new, display_order')
      .single()
    if (error || !data) { setImageError(`저장 실패: ${error?.message ?? '알 수 없는 오류'}`); setSaving(false); return }

    if (selectedGroupIds.size > 0) {
      await supabase.from('menu_option_groups').insert(
        [...selectedGroupIds].map((id, i) => ({ menu_id: data.id, option_group_id: id, display_order: i }))
      )
    }

    setSaving(false)
    const newMenu = mapMenuRow({ ...data, menu_option_groups: [] })
    newMenu.optionGroups = buildOptionGroups()
    onCreated(newMenu)
    close()
    showToast?.('메뉴를 추가했어요')
  }

  // 저장할 거리가 있는가 — 폼 값, 옵션 그룹 선택, 새 이미지 셋 중 하나라도 바뀌면 true.
  // 추가 모드에선 이름·가격이 비어 있으면 애초에 저장이 안 되므로 그것도 함께 본다.
  const groupsKey = [...selectedGroupIds].sort().join(',')
  const changed =
    imageFile != null ||
    groupsKey !== baseline.groups ||
    (Object.keys(form) as (keyof MenuFormValues)[]).some(k => form[k] !== baseline.form[k])
  const canSave = changed && form.name.trim().length > 0 && /^\d+$/.test(form.price)

  return {
    mode, editing, form, setForm, saving, canSave,
    imageError, setImageError, imagePreview, setImagePreview, setImageFile,
    selectedGroupIds, toggleGroup,
    openEdit, openAdd, close, save,
  }
}
