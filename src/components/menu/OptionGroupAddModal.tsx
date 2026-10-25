import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { SegmentedControl } from '../SegmentedControl'
import { formatPriceDisplay } from '../ModalFormControls'
import CountStepper, { PlusMinusStepper } from '../ui/CountStepper'
import type { OptionItem } from '../../lib/mock-data'

/**
 * 옵션 추가 마법사 (2단계 — Figma node 491:3318 설정 / 491:3401 적용할 메뉴 선택)
 *
 * 원래 Menus.tsx 안에 340줄 인라인으로 박혀 있었다. 상품 허브의 '옵션 정보' 화면에서도
 * 같은 버튼을 눌러야 해서 꺼냈다 — 전엔 그 화면에서 "메뉴 화면에서 할 수 있어요" 토스트만 띄웠다.
 *
 * 마법사 상태(단계·입력값·선택한 메뉴)는 전부 이 컴포넌트가 들고, DB insert 까지 여기서 한다.
 * 호출부는 onCreated 로 만들어진 그룹을 받아 자기 화면 상태만 갱신한다 — Menus.tsx 는
 * 로컬 목록에 끼워넣고, ProductHub 는 그냥 reload() 한다.
 */

export interface OptAddMenuRow {
  code:       string
  name:       string
  categoryId: string | null
  soldOut?:   boolean
}

export interface OptAddCategoryRow {
  id:   string
  name: string
}

export interface CreatedOptionGroup {
  id:         string
  name:       string
  isRequired: boolean
  isMulti:    boolean
  maxSelect:  number | null
  items:      OptionItem[]
}

interface Props {
  storeId: string
  /** 2단계에서 고를 수 있는 메뉴 */
  menus: OptAddMenuRow[]
  /** **표시 순서대로 정렬된** 카테고리 — 정렬은 호출부 책임 */
  categories: OptAddCategoryRow[]
  /** 새 그룹의 display_order */
  displayOrder: number
  /**
   * 2단계에서 미리 체크해 둘 메뉴 code.
   *
   * 특정 메뉴의 상세 화면에서 '옵션 추가'를 눌렀다면, 그 사람이 붙이려는 메뉴는
   * 이미 정해져 있다 — 2단계에서 그 메뉴를 수십 개 목록에서 다시 찾게 할 이유가 없다.
   * 해당 메뉴가 속한 카테고리도 같이 펼쳐 둬서 체크된 게 눈에 보이게 한다.
   * 옵션 상세 화면처럼 메뉴 맥락 없이 들어오면 비워 둔다(전체 선택 해제 상태).
   */
  preselectMenuCodes?: string[]
  onClose: () => void
  onCreated: (group: CreatedOptionGroup, menuIds: string[]) => void
}

type DraftItem = { id: string; name: string; price: string; maxQty: number | null }

function blankItem(): DraftItem {
  return { id: crypto.randomUUID(), name: '', price: '', maxQty: null }
}

/**
 * 끌 때 따라다니는 반투명 고스트를 만든다.
 *
 * HTML5 드래그는 기본적으로 **draggable 을 건 요소만** 스냅샷으로 뜬다. 핸들에
 * draggable 을 걸어뒀으니 점 6개 조각만 끌려가서, 뭘 옮기는 중인지 안 보였다.
 *
 * 그래서 행 전체(이름 줄 + 가격/삭제 줄)를 복제해 화면 밖에 잠깐 붙이고
 * setDragImage 로 지정한다. 스냅샷은 호출 시점에 한 번 떠지므로 바로 지워도 된다
 * (다음 틱에 지운다 — 같은 틱에 지우면 브라우저가 스냅샷을 못 뜨는 경우가 있다).
 */
function makeOptDragGhost(e: React.DragEvent, row: HTMLElement) {
  const r = row.getBoundingClientRect()
  const ghost = row.cloneNode(true) as HTMLElement
  ghost.style.width = `${r.width}px`
  ghost.style.position = 'fixed'
  ghost.style.top = '-10000px'
  ghost.style.left = '0'
  ghost.style.opacity = '0.75'
  ghost.style.pointerEvents = 'none'
  ghost.style.borderRadius = '12px'
  ghost.style.background = '#FCFCFC'
  ghost.style.boxShadow = '0 12px 28px rgba(44,38,31,0.18)'
  document.body.appendChild(ghost)
  e.dataTransfer.setDragImage(ghost, e.clientX - r.left, e.clientY - r.top)
  setTimeout(() => { ghost.remove() }, 0)
}

export default function OptionGroupAddModal({
  storeId, menus, categories, displayOrder, preselectMenuCodes, onClose, onCreated,
}: Props) {
  // 미리 체크할 메뉴 — 넘어온 code 중 **실제 목록에 있는 것만** 남긴다.
  // 숨김·삭제된 메뉴 code 가 섞여 들어오면 체크 수가 보이는 항목 수와 안 맞는다.
  const preset = useMemo(() => {
    const known = new Set(menus.map(m => m.code))
    return (preselectMenuCodes ?? []).filter(c => known.has(c))
  }, [preselectMenuCodes, menus])
  // 그 메뉴들이 속한 카테고리 — 접혀 있으면 체크된 걸 못 보니 같이 펼친다
  const presetCats = useMemo(() => {
    const byCode = new Map(menus.map(m => [m.code, m.categoryId]))
    return preset.map(c => byCode.get(c)).filter((v): v is string => !!v)
  }, [preset, menus])
  const [step,        setStep]        = useState<1 | 2>(1)
  const [draft,       setDraft]       = useState({ name: '', isRequired: false, isMulti: false, maxSelect: '' })
  const [items,       setItems]       = useState<DraftItem[]>([blankItem()])
  const [dragItemId,  setDragItemId]  = useState<string | null>(null)
  const [pressedId,   setPressedId]   = useState<string | null>(null)
  const [pickedMenus, setPickedMenus] = useState<Set<string>>(() => new Set(preset))
  const [search,      setSearch]      = useState('')
  const [expandedCats, setExpandedCats] = useState<Set<string>>(() => new Set(presetCats))
  const [saving,      setSaving]      = useState(false)

  const q = search.trim().toLowerCase()
  const menusByCat = (catId: string) => menus.filter(m =>
    m.categoryId === catId && (!q || m.name.toLowerCase().includes(q))
  )
  const totalVisible = categories.reduce((s, c) => s + menusByCat(c.id).length, 0)
  const allChecked = totalVisible > 0 && categories.every(c => menusByCat(c.id).every(m => pickedMenus.has(m.code)))

  function toggleAllMenus() {
    setPickedMenus(prev => {
      const next = new Set(prev)
      const ids = categories.flatMap(c => menusByCat(c.id).map(m => m.code))
      if (allChecked) { ids.forEach(id => next.delete(id)) } else { ids.forEach(id => next.add(id)) }
      return next
    })
  }
  function toggleCatMenus(catId: string) {
    const ids = menusByCat(catId).map(m => m.code)
    const allIn = ids.length > 0 && ids.every(id => pickedMenus.has(id))
    setPickedMenus(prev => {
      const next = new Set(prev)
      if (allIn) ids.forEach(id => next.delete(id)); else ids.forEach(id => next.add(id))
      return next
    })
  }
  function patchItem(id: string, patch: Partial<DraftItem>) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i))
  }
  // 옵션 항목 드래그 순서 변경 — 드래그 중인 항목을 지나치는 항목 자리로 즉시 이동
  function handleItemDragOver(e: React.DragEvent, overId: string) {
    e.preventDefault()
    if (!dragItemId || dragItemId === overId) return
    setItems(prev => {
      const from = prev.findIndex(i => i.id === dragItemId)
      const to   = prev.findIndex(i => i.id === overId)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  // 그룹 최대 선택 개수 — 1개면 단일 선택(is_multi=false), 2개 이상이면 복수 선택
  const maxSelectValue = draft.isMulti ? Number(draft.maxSelect || 2) : 1
  const canGoNext = !!draft.name.trim() && items.some(i => i.name.trim())

  async function confirmCreate() {
    if (!draft.name.trim() || !storeId) return
    setSaving(true)
    try {
      const { data: gd, error: ge } = await supabase
        .from('option_groups')
        .insert({
          store_id:      storeId,
          name:          draft.name.trim(),
          is_required:   draft.isRequired,
          is_multi:      draft.isMulti,
          max_select:    draft.isMulti && draft.maxSelect ? parseInt(draft.maxSelect) : null,
          display_order: displayOrder,
        })
        .select('id, name, is_required, is_multi, max_select')
        .single()
      if (ge || !gd) { console.error(ge); return }

      const validItems = items.filter(i => i.name.trim())
      const menuIds = Array.from(pickedMenus)

      // 옵션 항목·메뉴 연결은 서로 독립적이고 각각 여러 행이라 벌크 insert 1번씩,
      // 두 요청은 병렬로 실행 — 예전엔 행마다 개별 insert를 날려서(N+1) 항목·메뉴가
      // 많을수록 느려졌음
      const [itemsRes] = await Promise.all([
        validItems.length > 0
          ? supabase.from('option_items')
              .insert(validItems.map((item, idx) => ({
                option_group_id: gd.id, name: item.name.trim(),
                extra_price: parseInt(item.price) || 0, display_order: idx,
                max_quantity: item.maxQty,
              })))
              .select('id, name, extra_price, is_popular, is_sold_out, is_hidden, display_order, max_quantity')
          : Promise.resolve({ data: [], error: null }),
        menuIds.length > 0
          ? supabase.from('menu_option_groups').insert(
              menuIds.map((menuId, i) => ({ menu_id: menuId, option_group_id: gd.id, display_order: i }))
            )
          : Promise.resolve({ data: [], error: null }),
      ])

      if (itemsRes.error) {
        console.error('옵션 항목 저장 실패:', itemsRes.error)
        alert('옵션그룹은 생성됐지만 옵션 항목 저장에 실패했습니다: ' + itemsRes.error.message + '\n항목을 다시 추가해주세요.')
      }
      const createdItems: OptionItem[] = (itemsRes.data ?? []).map(d => ({
        id: d.id, name: d.name, extra: d.extra_price,
        soldOut: false, soldOutUntil: null, hidden: false, isPopular: false,
        maxQty: d.max_quantity ?? null,
      }))

      onCreated({
        id:         gd.id,
        name:       gd.name,
        isRequired: gd.is_required ?? false,
        isMulti:    gd.is_multi    ?? false,
        maxSelect:  gd.max_select  ?? null,
        items:      createdItems,
      }, menuIds)
    } finally {
      setSaving(false)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="modal-in bg-[#FCFCFC] rounded-[20px] shadow-xl w-[640px] max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* 헤더 + 단계 표시 — Figma: 제목 아래 원형 숫자뱃지 + 단계명(현재 단계만 진하게) */}
        <div className="px-[30px] pt-[30px] pb-[20px] flex-shrink-0">
          <div className="flex items-center justify-between mb-[20px]">
            <span className="text-[22px] font-bold text-ink">옵션 추가</span>
            <button onClick={onClose} className="text-gray-text hover:text-ink text-[18px]">✕</button>
          </div>
          <div className="flex items-center gap-[26px]">
            {([{ s: 1, label: '설정' }, { s: 2, label: '적용할 메뉴 선택' }] as const).map(({ s, label }) => (
              <div key={s} className="flex items-center gap-[8px]">
                <span className={`w-[24px] h-[24px] rounded-full flex items-center justify-center text-[12px] font-semibold flex-shrink-0 ${
                  s === step ? 'bg-[#E8E4E2] text-ink' : 'bg-[#F2F2F2] text-[#ADADAD]'
                }`}>
                  {s}
                </span>
                <span className={`text-[15px] font-semibold whitespace-nowrap ${s === step ? 'text-ink' : 'text-[#ADADAD]'}`}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Step 1: 옵션 설정 단계 — Figma node 491:3318 ── */}
        {step === 1 && (
          <div className="px-[30px] pb-[24px] flex flex-col gap-[26px] overflow-y-auto">

            {/* 옵션그룹 */}
            <div>
              <div className="text-[15px] font-medium text-ink mb-[10px]">옵션그룹</div>
              <input
                autoFocus
                value={draft.name}
                onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
                placeholder="ex) 토핑 추가"
                className="field-soft w-full h-[48px] border border-[#D9D9D9] rounded-[10px] px-[16px] text-[15px] text-ink placeholder:text-[#ADADAD] outline-none focus:border-[#6A635E] bg-transparent"
              />
            </div>

            {/* 옵션이름 — 항목마다 (드래그 핸들 + 이름) / (가격 스테퍼 + 가격 + 삭제) 두 줄 */}
            <div>
              <div className="text-[15px] font-medium text-ink mb-[10px]">옵션이름</div>
              <div className="flex flex-col gap-[16px]">
                {items.map(item => (
                  <div
                    key={item.id}
                    data-opt-row
                    onDragOver={e => handleItemDragOver(e, item.id)}
                    /* 누르면 살짝 줄어들며 그림자가 깔려 공중에 뜬 것처럼 보인다.
                       끌기 시작하면 원본은 흐려지고(자리만 남김) 움직이는 건 고스트다. */
                    className={`flex flex-col gap-[8px] rounded-[12px] transition-all duration-150 ${
                      dragItemId === item.id
                        ? 'opacity-40'
                        : pressedId === item.id
                          ? 'scale-[0.97] shadow-[0_10px_24px_rgba(44,38,31,0.16)] bg-[#FCFCFC]'
                          : ''
                    }`}
                  >
                    <div className="field-wrap flex items-center gap-[10px] h-[48px] border border-[#D9D9D9] rounded-[10px] px-[14px]">
                      <span
                        draggable
                        onPointerDown={() => setPressedId(item.id)}
                        onPointerUp={() => setPressedId(null)}
                        onPointerCancel={() => setPressedId(null)}
                        onDragStart={e => {
                          setDragItemId(item.id)
                          // 기본 고스트는 **핸들만** 끌려간다(점 6개 조각). 두 줄 전체를
                          // 복제해 반투명으로 띄워야 "이 덩어리를 옮기는 중"이 읽힌다.
                          const row = (e.currentTarget as HTMLElement).closest('[data-opt-row]') as HTMLElement | null
                          if (row) makeOptDragGhost(e, row)
                        }}
                        onDragEnd={() => { setDragItemId(null); setPressedId(null) }}
                        className="flex-shrink-0 cursor-grab active:cursor-grabbing touch-none"
                        title="끌어서 순서 변경"
                      >
                        <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
                          {[2, 8, 14].map(y => (
                            <g key={y}>
                              <circle cx="2" cy={y} r="1.3" fill="#ADADAD" />
                              <circle cx="8" cy={y} r="1.3" fill="#ADADAD" />
                            </g>
                          ))}
                        </svg>
                      </span>
                      <input
                        value={item.name}
                        onChange={e => patchItem(item.id, { name: e.target.value })}
                        placeholder="ex) 발사믹 소스"
                        className="field-bare flex-1 min-w-0 text-[15px] text-ink placeholder:text-[#ADADAD] outline-none bg-transparent"
                      />
                    </div>

                    <div className="flex items-center gap-[12px]">
                      {/* 추가금액 ± 100원 — Figma node 491:3368 */}
                      <PlusMinusStepper
                        onPlus={() => patchItem(item.id, { price: String((parseInt(item.price) || 0) + 100) })}
                        onMinus={() => patchItem(item.id, { price: String((parseInt(item.price) || 0) - 100) })}
                      />
                      <div className="field-wrap w-[170px] h-[44px] flex items-center gap-[6px] border border-[#D9D9D9] rounded-[10px] px-[14px]">
                        <input
                          inputMode="numeric"
                          value={item.price ? formatPriceDisplay(item.price) : ''}
                          // 맨 앞 '-' 하나만 남기고 나머지 비숫자는 버린다 (깎아주는 옵션 허용)
                          onChange={e => {
                            const raw = e.target.value
                            const neg = raw.trimStart().startsWith('-')
                            const digits = raw.replace(/[^0-9]/g, '')
                            patchItem(item.id, { price: digits ? (neg ? '-' : '') + digits : '' })
                          }}
                          placeholder="0"
                          className="field-bare flex-1 min-w-0 text-[15px] text-ink placeholder:text-[#ADADAD] outline-none bg-transparent"
                        />
                        <span className="text-[15px] text-ink flex-shrink-0">원</span>
                      </div>
                      <button
                        onClick={() => setItems(prev => prev.length > 1 ? prev.filter(i => i.id !== item.id) : prev)}
                        disabled={items.length === 1}
                        className="ml-auto flex-shrink-0 px-[14px] py-[9px] rounded-[10px] bg-[#FFEFEF] text-[#FF676F] text-[14px] font-medium hover:bg-[#ffe3e3] disabled:opacity-40 transition-colors"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setItems(prev => [...prev, blankItem()])}
                className="mt-[16px] px-[16px] py-[11px] rounded-[10px] bg-[#E8E4E2] text-ink text-[14px] font-medium hover:bg-[#dcd7d4] transition-colors"
              >
                + 옵션 추가
              </button>
            </div>

            {/* 필수/선택 여부 + 선택을 허용할 최대 개수 */}
            <div className="grid grid-cols-2 gap-[26px]">
              <div>
                <div className="text-[15px] font-medium text-ink mb-[10px]">필수/선택 여부</div>
                <SegmentedControl
                  options={[{ label: '필수', value: true }, { label: '선택', value: false }]}
                  value={draft.isRequired}
                  onChange={v => setDraft(p => ({ ...p, isRequired: v }))}
                  padding={3}
                  className="rounded-[10px] h-[48px]"
                  thumbClassName="rounded-[8px]"
                  optionClassName={active => `h-full flex items-center justify-center text-[15px] font-medium ${active ? 'text-ink' : 'text-[#ADADAD]'}`}
                />
              </div>
              <div>
                {/* "선택을 허용할 최대 개수"는 필수/선택 여부와 헷갈렸다.
                    이 값은 필수든 선택이든 상관없이 "이 그룹 안에서 옵션을 몇 개까지
                    고를 수 있나"를 정하는 값이라 '옵션'을 앞에 붙여 범위를 분명히 한다. */}
                <div className="text-[15px] font-medium text-ink mb-[10px]">옵션 선택을 허용할 최대개수</div>
                <CountStepper
                  value={maxSelectValue}
                  min={1}
                  max={20}
                  onChange={n => setDraft(p => ({ ...p, isMulti: n > 1, maxSelect: n > 1 ? String(n) : '' }))}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: 적용할 메뉴 선택 — Figma node 491:3401 (검색 + 카테고리 접기/펼치기 + 전체선택) ── */}
        {step === 2 && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="px-[30px] pb-[18px] flex-shrink-0">
              <div className="field-wrap flex items-center gap-[10px] h-[48px] border border-[#D9D9D9] rounded-[10px] px-[16px]">
                <svg width="16" height="16" viewBox="0 0 22 22" fill="none"><circle cx="9" cy="9" r="7" stroke="#8C8379" strokeWidth="2"/><path d="M14 14L19 19" stroke="#8C8379" strokeWidth="2" strokeLinecap="round"/></svg>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="메뉴 이름을 검색할 수 있어요"
                  className="field-bare flex-1 min-w-0 outline-none focus-visible:outline-none text-[15px] text-ink placeholder:text-[#ADADAD] bg-transparent"
                />
              </div>
            </div>

            <div className="px-[30px] pb-[10px] flex-shrink-0 flex items-center justify-between">
              <span className="text-[15px] text-[#8C8379]">카테고리</span>
              <button
                onClick={toggleAllMenus}
                disabled={totalVisible === 0}
                className="text-[15px] text-[#8C8379] hover:text-ink disabled:opacity-40 transition-colors"
              >
                메뉴 전체선택
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-[30px] pb-[10px]">
              {totalVisible === 0 ? (
                <div className="text-center py-10 text-[14px] text-gray-text">
                  {q ? '검색 결과가 없습니다.' : '등록된 메뉴가 없습니다.'}
                </div>
              ) : categories.map(cat => {
                const catMenus = menusByCat(cat.id)
                if (catMenus.length === 0) return null
                // 검색 중엔 결과를 바로 볼 수 있게 자동으로 펼침
                const expanded = q ? true : expandedCats.has(cat.id)
                const allInCat = catMenus.every(m => pickedMenus.has(m.code))
                return (
                  <div key={cat.id}>
                    <div className="flex items-center gap-[14px] py-[12px]">
                      <button
                        onClick={() => setExpandedCats(prev => {
                          const next = new Set(prev)
                          if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id)
                          return next
                        })}
                        className="w-[28px] h-[28px] rounded-full bg-[#F2F2F2] flex items-center justify-center flex-shrink-0 hover:bg-[#E8E4E2] transition-colors"
                        title={expanded ? '접기' : '펼치기'}
                      >
                        <svg width="12" height="7" viewBox="0 0 16 10" fill="none" className={`transition-transform ${expanded ? 'rotate-180' : ''}`}>
                          <path d="M1 1L8 8L15 1" stroke="#6A635E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <span className="flex-1 min-w-0 text-[16px] font-semibold text-ink truncate">{cat.name}</span>
                      <input
                        type="checkbox"
                        checked={allInCat}
                        onChange={() => toggleCatMenus(cat.id)}
                        className="flex-shrink-0 w-[22px] h-[22px]"
                        title="카테고리 전체 선택"
                      />
                    </div>
                    {expanded && catMenus.map(menu => {
                      const checked = pickedMenus.has(menu.code)
                      return (
                        <button
                          key={menu.code}
                          onClick={() => setPickedMenus(prev => {
                            const next = new Set(prev)
                            if (next.has(menu.code)) next.delete(menu.code); else next.add(menu.code)
                            return next
                          })}
                          className="pressable-row w-full flex items-center gap-[10px] pl-[42px] pr-[2px] py-[10px] text-left hover:bg-[#F9F9F9] rounded-[8px]"
                        >
                          <span className={`flex-1 min-w-0 truncate text-[15px] ${checked ? 'text-ink font-medium' : 'text-[#6A635E]'}`}>
                            {menu.name}
                          </span>
                          {menu.soldOut && <span className="text-[11px] text-danger font-bold flex-shrink-0">품절</span>}
                          <svg width="18" height="13" viewBox="0 0 20 14" fill="none" className="flex-shrink-0">
                            <path d="M1.5 7L7 12.5L18.5 1.5" stroke={checked ? '#1E1E1E' : '#DDD7D1'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 푸터 — Figma: 2단계에선 좌측에 적용 메뉴 개수, 우측에 닫기/다음(마지막 단계는 완료) */}
        <div className="flex items-center justify-between gap-[14px] px-[30px] py-[20px] flex-shrink-0 mt-auto modal-footer">
          <span className="text-[14px] text-[#8C8379] truncate">
            {step === 2 ? `'${draft.name}' 옵션 적용할 메뉴 개수 (${pickedMenus.size}/${totalVisible})` : ''}
          </span>
          <div className="flex items-center gap-[10px] flex-shrink-0">
            <button
              onClick={() => step === 2 ? setStep(1) : onClose()}
              className="px-[34px] h-[52px] rounded-[12px] bg-[#F2F0EE] text-ink text-[16px] font-medium hover:bg-[#E8E4E2] transition-colors"
            >
              {step === 2 ? '이전' : '닫기'}
            </button>
            {step === 1 ? (
              <button
                onClick={() => {
                  if (!canGoNext) return
                  // 비우는 게 아니라 **preset 으로** 되돌린다. new Set() 으로 비우면
                  // 메뉴 상세에서 들어와 미리 체크해 둔 것까지 같이 날아간다.
                  setPickedMenus(new Set(preset))
                  setExpandedCats(new Set(presetCats))
                  setSearch('')
                  setStep(2)
                }}
                disabled={!canGoNext}
                className="px-[34px] h-[52px] rounded-[12px] bg-[#2C261F] text-[#F9F9F9] text-[16px] font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                다음
              </button>
            ) : (
              <button
                onClick={confirmCreate}
                disabled={saving}
                className="px-[34px] h-[52px] rounded-[12px] bg-[#2C261F] text-[#F9F9F9] text-[16px] font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {saving ? '...' : '완료'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
