import { useEffect, useState } from 'react'
import { supabase, type DbOptionGroup, type DbOptionItem, type DbMenu } from '../../lib/supabase'

// 옵션 그룹 수정 — 이름·필수여부·선택방식·선택 개수·항목(이름/추가가격/수량버튼)·연결 메뉴·삭제.
//
// 가격(필수) 그룹은 다르게 다룬다:
//   이름과 연결 메뉴는 DB 트리거가 메뉴를 따라가며 관리하므로 여기서 못 바꾼다.
//   바꿀 수 있는 건 "변형 항목"뿐 — 100g +3,000 / ICE 1L +4,500 같은 사이즈·용량 차액.

export type OptionItemDraft = {
  id?: string
  name: string
  extra_price: number
  max_quantity: number | null
  display_order: number
  /** 기본가 항목(extra_price 0, 첫 줄). 가격 그룹에서만 의미 있고 지울 수 없다 */
  isBase?: boolean
}

export interface OptionGroupDraft {
  id: string
  name: string
  is_required: boolean
  is_multi: boolean
  min_select: number
  max_select: number | null
  items: OptionItemDraft[]
  linkedMenuIds: string[]
}

const QTY_UNLIMITED = 999

function qtyLabel(q: number | null): string {
  if (q === null) return '수량버튼 없음'
  if (q >= QTY_UNLIMITED) return '제한없음'
  return `최대 ${q}개`
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-[16px] py-[12px]">
      <div className="min-w-0 pt-[5px]">
        <div className="text-[13px] text-[#1E1E1E]">{label}</div>
        {hint && <div className="text-[11px] text-[#ADADAD] mt-[2px]">{hint}</div>}
      </div>
      <div className="flex-shrink-0 flex items-center gap-[7px]">{children}</div>
    </div>
  )
}

function Seg<T extends string | number>({ value, options, onChange, disabled }: {
  value: T
  options: { v: T; label: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-[5px]">
      {options.map(o => (
        <button
          key={String(o.v)}
          disabled={disabled}
          onClick={() => onChange(o.v)}
          className={`h-[30px] px-[11px] rounded-[8px] text-[12px] transition-colors disabled:opacity-40 ${
            value === o.v ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

interface Props {
  group: DbOptionGroup & { option_items?: DbOptionItem[] }
  /** 이 그룹이 가격(필수) 그룹인가 — 이름·연결이 트리거 관리라 잠긴다 */
  isPriceGroup: boolean
  /** 이 매장의 전체 메뉴 (연결 메뉴 선택용) */
  menus: DbMenu[]
  linkedMenuIds: string[]
  onClose: () => void
  onSaved: () => void
  showToast: (msg: string) => void
}

export default function OptionGroupEditModal({
  group, isPriceGroup, menus, linkedMenuIds, onClose, onSaved, showToast,
}: Props) {
  const [name,       setName]       = useState(group.name)
  const [isRequired, setIsRequired] = useState(group.is_required)
  const [isMulti,    setIsMulti]    = useState(group.is_multi)
  const [minSelect,  setMinSelect]  = useState(group.min_select ?? 1)
  const [maxSelect,  setMaxSelect]  = useState<number | null>(group.max_select ?? null)
  const [items,      setItems]      = useState<OptionItemDraft[]>(
    (group.option_items ?? [])
      .slice()
      .sort((a, b) => a.display_order - b.display_order)
      .map((it, i) => ({
        id: it.id,
        name: it.name,
        extra_price: it.extra_price,
        max_quantity: (it as DbOptionItem & { max_quantity?: number | null }).max_quantity ?? null,
        display_order: it.display_order,
        isBase: isPriceGroup && it.extra_price === 0 && i === 0,
      })),
  )
  const [linked, setLinked] = useState<Set<string>>(new Set(linkedMenuIds))
  const [menuQuery, setMenuQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  function patchItem(i: number, p: Partial<OptionItemDraft>) {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...p } : it))
  }
  function addItem() {
    setItems(prev => [...prev, { name: '', extra_price: 0, max_quantity: null, display_order: prev.length }])
  }
  function removeItem(i: number) {
    setItems(prev => prev.filter((_, idx) => idx !== i).map((it, idx) => ({ ...it, display_order: idx })))
  }

  async function save() {
    if (!name.trim()) { showToast('옵션 그룹 이름을 입력해주세요'); return }
    if (items.some(it => !it.name.trim())) { showToast('이름이 비어 있는 옵션이 있어요'); return }
    if (items.length === 0) { showToast('옵션을 최소 1개는 두어야 해요'); return }
    if (maxSelect !== null && maxSelect < minSelect) { showToast('최대 선택 개수가 최소보다 작아요'); return }

    setSaving(true)
    try {
      // 1) 그룹 자체 — 가격 그룹은 이름을 트리거가 관리하므로 제외
      const groupPatch: Record<string, unknown> = {
        is_required: isRequired,
        is_multi:    isMulti,
        min_select:  minSelect,
        max_select:  maxSelect,
      }
      if (!isPriceGroup) groupPatch.name = name.trim()
      const { error: gErr } = await supabase.from('option_groups').update(groupPatch).eq('id', group.id)
      if (gErr) throw gErr

      // 2) 항목 — 지워진 것 삭제, 기존 것 수정, 새 것 추가
      const keepIds = items.filter(it => it.id).map(it => it.id!)
      const removed = (group.option_items ?? []).filter(it => !keepIds.includes(it.id))
      if (removed.length > 0) {
        const { error } = await supabase.from('option_items').delete().in('id', removed.map(r => r.id))
        if (error) throw error
      }
      for (const [i, it] of items.entries()) {
        const row = {
          name: it.name.trim(),
          extra_price: it.extra_price,
          max_quantity: it.max_quantity,
          display_order: i,
        }
        if (it.id) {
          const { error } = await supabase.from('option_items').update(row).eq('id', it.id)
          if (error) throw error
        } else {
          const { error } = await supabase.from('option_items').insert({ ...row, option_group_id: group.id })
          if (error) throw error
        }
      }

      // 3) 연결 메뉴 — 가격 그룹은 메뉴 1:1 고정이라 건드리지 않는다
      if (!isPriceGroup) {
        const before = new Set(linkedMenuIds)
        const toAdd    = [...linked].filter(id => !before.has(id))
        const toRemove = [...before].filter(id => !linked.has(id))
        if (toRemove.length > 0) {
          const { error } = await supabase.from('menu_option_groups')
            .delete().eq('option_group_id', group.id).in('menu_id', toRemove)
          if (error) throw error
        }
        if (toAdd.length > 0) {
          const { error } = await supabase.from('menu_option_groups')
            .insert(toAdd.map((menu_id, i) => ({ menu_id, option_group_id: group.id, display_order: i + 1 })))
          if (error) throw error
        }
      }

      showToast('저장했어요')
      onSaved()
      onClose()
    } catch (e) {
      showToast(`저장에 실패했어요: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    setSaving(true)
    const { error } = await supabase.from('option_groups').delete().eq('id', group.id)
    setSaving(false)
    if (error) { showToast(`삭제에 실패했어요: ${error.message}`); return }
    showToast('옵션 그룹을 삭제했어요')
    onSaved()
    onClose()
  }

  const filteredMenus = menuQuery
    ? menus.filter(m => m.name.toLowerCase().includes(menuQuery.toLowerCase()))
    : menus

  const inputCls = 'h-[32px] px-[11px] rounded-[9px] border border-[#ADADAD] text-[13px] text-[#1E1E1E] outline-none focus:border-[#6A635E]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !saving && onClose()}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[14px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] w-[620px] max-w-[94vw] max-h-[86vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex-shrink-0 px-[28px] pt-[26px] pb-[14px]">
          <div className="text-[18px] font-semibold text-[#1E1E1E]">옵션 그룹 수정</div>
          {isPriceGroup && (
            <div className="text-[11px] text-[#ADADAD] mt-[4px] leading-relaxed">
              가격(필수) 그룹이에요. 이름과 연결 메뉴는 메뉴를 따라 자동으로 관리돼서 바꿀 수 없고,
              사이즈·용량 같은 <span className="text-[#6A635E]">변형 항목</span>만 더하거나 고칠 수 있어요.
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-[28px] pb-[20px]">
          <div className="divide-y divide-[#F2F2F2]">
            <Field label="옵션 그룹 이름">
              <input
                value={name}
                disabled={isPriceGroup}
                onChange={e => setName(e.target.value)}
                className={`${inputCls} w-[260px] disabled:bg-[#F2F2F2] disabled:text-[#787878]`}
              />
            </Field>

            <Field label="필수 여부" hint={isRequired ? '고객이 반드시 하나는 골라야 해요' : '안 골라도 주문할 수 있어요'}>
              <Seg
                value={isRequired ? 'y' : 'n'}
                options={[{ v: 'y', label: '필수' }, { v: 'n', label: '선택' }]}
                onChange={v => setIsRequired(v === 'y')}
                disabled={isPriceGroup}
              />
            </Field>

            <Field label="선택 방식">
              <Seg
                value={isMulti ? 'multi' : 'single'}
                options={[{ v: 'single', label: '한 개만' }, { v: 'multi', label: '여러 개' }]}
                onChange={v => {
                  const multi = v === 'multi'
                  setIsMulti(multi)
                  if (!multi) { setMinSelect(isRequired ? 1 : 0); setMaxSelect(1) }
                }}
                disabled={isPriceGroup}
              />
            </Field>

            {isMulti && (
              <Field label="고를 수 있는 개수" hint="이 그룹 안에서 몇 개까지 고를 수 있는지">
                <input
                  type="number" min={0} value={minSelect}
                  onChange={e => setMinSelect(Math.max(0, Number(e.target.value)))}
                  className={`${inputCls} w-[64px] text-center`}
                />
                <span className="text-[12px] text-[#787878]">~</span>
                <input
                  type="number" min={1} value={maxSelect ?? ''}
                  placeholder="제한없음"
                  onChange={e => setMaxSelect(e.target.value === '' ? null : Math.max(1, Number(e.target.value)))}
                  className={`${inputCls} w-[84px] text-center`}
                />
              </Field>
            )}
          </div>

          {/* ── 옵션 항목 ── */}
          <div className="mt-[18px]">
            <div className="flex items-center justify-between mb-[8px]">
              <span className="text-[12px] text-[#6A635E]">옵션 ({items.length}개)</span>
              <button
                onClick={addItem}
                className="h-[28px] px-[10px] rounded-[7px] bg-[#F2F2F2] text-[#1E1E1E] text-[12px] hover:bg-[#E8E4E2] transition-colors"
              >
                + 옵션 추가
              </button>
            </div>

            <div className="rounded-[9px] border border-[#E8E4E2] overflow-hidden">
              <div className="flex items-center bg-[#E8E4E2] px-[12px] h-[32px] text-[11px] text-[#6A635E]">
                <span className="flex-1 min-w-0">이름</span>
                <span className="w-[110px] text-right">추가가격</span>
                <span className="w-[110px] text-center">수량 버튼</span>
                <span className="w-[28px]" />
              </div>
              {items.map((it, i) => (
                <div key={it.id ?? `new-${i}`} className="flex items-center gap-[7px] px-[12px] h-[46px] bg-[#FCFCFC] border-t border-[#F2F2F2]">
                  <input
                    value={it.name}
                    onChange={e => patchItem(i, { name: e.target.value })}
                    placeholder={it.isBase ? '기본 가격' : '옵션 이름'}
                    className={`${inputCls} flex-1 min-w-0`}
                  />
                  <input
                    type="number"
                    value={it.extra_price}
                    disabled={it.isBase}
                    onChange={e => patchItem(i, { extra_price: Number(e.target.value) })}
                    className={`${inputCls} w-[104px] text-right disabled:bg-[#F2F2F2] disabled:text-[#787878]`}
                  />
                  <button
                    onClick={() => patchItem(i, {
                      max_quantity: it.max_quantity === null ? 1
                        : it.max_quantity >= QTY_UNLIMITED ? null
                        : it.max_quantity >= 9 ? QTY_UNLIMITED
                        : it.max_quantity + 1,
                    })}
                    title="없음 → 최대 1개 → … → 제한없음 → 없음"
                    className="w-[104px] h-[32px] rounded-[9px] bg-[#F2F2F2] text-[11px] text-[#787878] hover:bg-[#E8E4E2] transition-colors"
                  >
                    {qtyLabel(it.max_quantity)}
                  </button>
                  <button
                    onClick={() => removeItem(i)}
                    disabled={it.isBase}
                    title={it.isBase ? '기본 가격 항목은 지울 수 없어요' : '삭제'}
                    className="w-[24px] h-[24px] rounded-[6px] text-[#ADADAD] hover:bg-[#F2F2F2] hover:text-[#C92A2A] disabled:opacity-30 disabled:hover:bg-transparent transition-colors flex items-center justify-center"
                  >
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-[#ADADAD] mt-[7px]">
              추가가격을 바꿔도 이미 들어온 주문의 금액은 주문 시점 그대로 남아요.
            </div>
          </div>

          {/* ── 연결 메뉴 ── */}
          {!isPriceGroup && (
            <div className="mt-[20px]">
              <div className="flex items-center justify-between mb-[8px]">
                <span className="text-[12px] text-[#6A635E]">연결된 메뉴 ({linked.size}개)</span>
                <input
                  value={menuQuery}
                  onChange={e => setMenuQuery(e.target.value)}
                  placeholder="메뉴 검색"
                  className={`${inputCls} w-[160px]`}
                />
              </div>
              <div className="rounded-[9px] border border-[#E8E4E2] bg-[#FCFCFC] max-h-[168px] overflow-y-auto p-[10px] flex flex-wrap gap-[6px]">
                {filteredMenus.length === 0 ? (
                  <span className="text-[11px] text-[#ADADAD] py-[10px]">검색 결과가 없어요</span>
                ) : filteredMenus.map(m => {
                  const on = linked.has(m.id)
                  return (
                    <button
                      key={m.id}
                      onClick={() => setLinked(prev => {
                        const next = new Set(prev)
                        next.has(m.id) ? next.delete(m.id) : next.add(m.id)
                        return next
                      })}
                      className={`h-[28px] px-[10px] rounded-[7px] text-[12px] transition-colors ${
                        on ? 'bg-[#6A635E] text-[#FCFCFC]' : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
                      }`}
                    >
                      {m.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-[#E8E4E2] px-[28px] py-[14px] flex items-center justify-between">
          {isPriceGroup ? (
            <span className="text-[11px] text-[#ADADAD]">메뉴를 지우면 이 그룹도 같이 사라져요</span>
          ) : confirmDelete ? (
            <div className="flex items-center gap-[7px]">
              <span className="text-[12px] text-[#C92A2A]">정말 지울까요?</span>
              <button onClick={doDelete} disabled={saving} className="h-[30px] px-[11px] rounded-[8px] bg-[#C92A2A] text-white text-[12px] font-medium">삭제</button>
              <button onClick={() => setConfirmDelete(false)} className="h-[30px] px-[11px] rounded-[8px] bg-[#F2F2F2] text-[#787878] text-[12px]">취소</button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="h-[30px] px-[11px] rounded-[8px] text-[#C92A2A] text-[12px] hover:bg-[#FFEFEF] transition-colors"
            >
              그룹 삭제
            </button>
          )}
          <div className="flex items-center gap-[9px]">
            <button onClick={onClose} className="h-[38px] px-[16px] rounded-[9px] bg-[#F2F2F2] text-[#787878] text-[13px] font-medium hover:bg-[#E8E4E2] transition-colors">
              닫기
            </button>
            <button onClick={save} disabled={saving} className="h-[38px] px-[20px] rounded-[9px] bg-[#2C261F] text-[#F9F9F9] text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity">
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
