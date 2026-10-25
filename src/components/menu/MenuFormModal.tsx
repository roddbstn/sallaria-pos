import type { Dispatch, SetStateAction } from 'react'
import BigToggle from './BigToggle'
import { TAG_BADGES } from './tag-badges'
import type { MenuFormValues, MenuFormCategory, MenuFormOptionGroup } from './menu-form-types'

// 메뉴 추가 / 메뉴 상세(수정) 모달 — Figma node 491:2237.
//
// Menus.tsx(4,000줄) 안에 인라인으로 있던 JSX를 그대로 떼어낸 "순수 표현 컴포넌트"다.
// 저장·이미지 업로드·옵션 토글 같은 동작은 전부 Menus.tsx에 그대로 두고 콜백으로만 받는다.
// 그래야 전체메뉴 > 상품 > 메뉴 상세에서도 같은 모달을 쓰면서 로직이 두 벌이 되지 않는다.
//
// 주의: 가격(필수) 그룹은 storeGroups 에 들어오지 않는다(메뉴당 1개씩 수백 개라 제외).
//       대신 옵션 목록 맨 앞에 끌 수 없는 안내 칩으로 보여준다.

export interface MenuFormModalProps {
  mode: 'add' | 'edit'
  form: MenuFormValues
  setForm: Dispatch<SetStateAction<MenuFormValues>>
  saving: boolean
  /** 바뀐 게 있어 저장할 거리가 있는가 — false 면 CTA 비활성 */
  canSave: boolean
  imageError: string
  imagePreview: string
  setImagePreview: (v: string) => void
  setImageFile: (f: File | null) => void
  categories: MenuFormCategory[]
  storeGroups: MenuFormOptionGroup[]
  selectedGroupIds: Set<string>
  onToggleGroup: (groupId: string) => void
  /** "+ 카테고리 추가" — 이름 초기화 + 모달 열기를 호출부가 묶어서 넘긴다 */
  onAddCategory: () => void
  /** "+ 옵션 추가" — 옵션 그룹 추가 마법사 열기 */
  onAddOptionGroup: () => void
  /** 수정 모드에서만 보이는 삭제 버튼 */
  onDelete: () => void
  onClose: () => void
  onSave: () => void
}

export default function MenuFormModal({
  mode, form, setForm, saving, canSave, imageError, imagePreview, setImagePreview, setImageFile,
  categories, storeGroups, selectedGroupIds, onToggleGroup,
  onAddCategory, onAddOptionGroup, onDelete, onClose, onSave,
}: MenuFormModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-[40px]" onClick={onClose}>
      <div
        className="bg-[#FCFCFC] rounded-[18px] shadow-2xl max-h-[85vh] flex flex-col overflow-hidden"
        style={{ width: 900 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex-shrink-0 px-[62px] pt-[39px] pb-[15px]">
          <h2 className="text-[26px] font-semibold text-ink">{mode === 'edit' ? '메뉴 상세' : '메뉴 추가'}</h2>
        </div>

        <div className="overflow-y-auto flex-1 px-[62px] pb-[26px]">
          {imageError && (
            <div className="mb-[16px] text-[12px] text-danger">{imageError}</div>
          )}

          {/* 이미지 + 고객용표시/품절 토글 */}
          <div className="flex gap-[26px] mb-[31px]">
            <label className="relative w-[117px] h-[117px] rounded-[10px] border border-[#D9D9D9] flex-shrink-0 cursor-pointer overflow-hidden block">
              <input type="file" accept="image/*" className="hidden" onChange={e => {
                const file = e.target.files?.[0]
                if (!file) return
                setImageFile(file)
                setImagePreview(URL.createObjectURL(file))
              }} />
              {imagePreview ? (
                <img src={imagePreview} className="w-full h-full object-cover" alt="메뉴 이미지" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[#ADADAD] text-[13px]">이미지</div>
              )}
            </label>

            <div className="flex-1 flex flex-col justify-center gap-[14px]">
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold text-ink">고객용 주문화면 표시</span>
                <BigToggle checked={form.active} onChange={v => setForm(p => ({ ...p, active: v }))} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold text-ink">품절 처리</span>
                <BigToggle
                  checked={form.soldOutState !== 'active'}
                  onChange={v => setForm(p => ({ ...p, soldOutState: v ? 'permanent' : 'active' }))}
                />
              </div>
              {form.soldOutState !== 'active' && (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-[6px] text-[15px] font-semibold text-ink">
                    오늘만 품절
                    <span className="relative group">
                      <span className="w-[18px] h-[18px] rounded-full bg-[#E8E4E2] text-[#787878] text-[11px] flex items-center justify-center cursor-default">i</span>
                      <span className="absolute left-1/2 -translate-x-1/2 bottom-[calc(100%+8px)] w-[84px] bg-[#FCFCFC] rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] px-[6px] py-[6px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity pointer-events-none z-10">
                        <span className="block text-[10px] font-semibold text-ink text-center leading-[1.2]">마감 시간까지<br />품절 처리돼요</span>
                      </span>
                    </span>
                  </span>
                  <BigToggle
                    checked={form.soldOutState === 'today'}
                    onChange={v => setForm(p => ({ ...p, soldOutState: v ? 'today' : 'permanent' }))}
                  />
                </div>
              )}
            </div>
          </div>

          {/* 메뉴이름 */}
          <div className="mb-[22px]">
            <div className="text-[14px] font-medium text-ink mb-[8px]">메뉴이름</div>
            <input
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="메뉴 이름을 입력하세요"
              className="field-soft w-full border border-[#D9D9D9] rounded-[10px] px-[14px] py-[11px] text-[14px] text-ink outline-none focus:border-ink"
            />
          </div>

          {/* 기본가격 */}
          <div className="mb-[22px]">
            <div className="text-[14px] font-medium text-ink mb-[8px]">기본가격</div>
            <div className="field-wrap flex items-center border border-[#D9D9D9] rounded-[10px] px-[14px] py-[11px]">
              <input
                // 보이는 건 100,000 / 상태에 담기는 건 "100000" — 저장 로직은 그대로 둔다
                value={form.price ? Number(form.price).toLocaleString('ko-KR') : ''}
                onChange={e => setForm(p => ({ ...p, price: e.target.value.replace(/[^0-9]/g, '') }))}
                inputMode="numeric"
                placeholder="0"
                className="field-bare flex-1 outline-none text-[14px] text-ink"
              />
              <span className="text-[14px] text-ink">원</span>
            </div>
          </div>

          {/* 카테고리 선택 — 단일선택 */}
          <div className="mb-[22px]">
            <div className="text-[14px] font-medium text-ink mb-[8px]">카테고리 선택</div>
            <div className="flex flex-wrap gap-[6px]">
              <button
                onClick={() => setForm(p => ({ ...p, categoryId: '' }))}
                className={`px-[10px] py-[7px] rounded-[10px] text-[13px] font-medium whitespace-nowrap transition-colors ${
                  form.categoryId === '' ? 'bg-[#D7D2CE] text-[#2C261F]' : 'bg-[#F2F2F2] text-[#787878]'
                }`}
              >
                미지정
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setForm(p => ({ ...p, categoryId: cat.id }))}
                  className={`px-[10px] py-[7px] rounded-[10px] text-[13px] font-medium whitespace-nowrap transition-colors ${
                    form.categoryId === cat.id ? 'bg-[#D7D2CE] text-[#2C261F]' : 'bg-[#F2F2F2] text-[#787878]'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
              <button
                onClick={onAddCategory}
                className="px-[10px] py-[7px] rounded-[10px] text-[13px] font-medium border border-[#ADADAD] text-[#787878] whitespace-nowrap"
              >
                + 카테고리 추가
              </button>
            </div>
          </div>

          {/* 옵션 선택 — 다중선택 */}
          <div className="mb-[22px]">
            <div className="text-[14px] font-medium text-ink mb-[8px]">옵션 선택</div>
            <div className="flex flex-wrap gap-[6px]">
              {/* 가격(필수) — 메뉴마다 DB 트리거가 자동으로 만들어 붙이는 그룹이라
                  storeGroups(스토어 전체 옵션 목록)에는 일부러 안 들어온다.
                  여기선 "이미 있다"는 걸 첫 자리에 보여주되 끄고 켤 수 없게 막는다. */}
              <button
                disabled
                title="메뉴 가격에 맞춰 자동으로 만들어지는 옵션이라 끄거나 켤 수 없어요"
                className="px-[10px] py-[7px] rounded-[10px] text-[13px] font-medium whitespace-nowrap bg-[#E8E4E2] text-[#6A635E] opacity-70 cursor-not-allowed flex items-center gap-[5px]"
              >
                <svg width="10" height="11" viewBox="0 0 12 13" fill="none">
                  <rect x="2.2" y="5.6" width="7.6" height="6.2" rx="1.3" stroke="#6A635E" strokeWidth="1.3"/>
                  <path d="M4 5.6V3.9a2 2 0 1 1 4 0v1.7" stroke="#6A635E" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                가격(필수) - {form.name.trim() || '메뉴 이름'}
              </button>
              {storeGroups.map(g => (
                <button
                  key={g.id}
                  onClick={() => onToggleGroup(g.id)}
                  className={`px-[10px] py-[7px] rounded-[10px] text-[13px] font-medium whitespace-nowrap transition-colors ${
                    selectedGroupIds.has(g.id) ? 'bg-[#D7D2CE] text-[#2C261F]' : 'bg-[#F2F2F2] text-[#787878]'
                  }`}
                >
                  {g.name}
                </button>
              ))}
              <button
                onClick={onAddOptionGroup}
                className="px-[10px] py-[7px] rounded-[10px] text-[13px] font-medium border border-[#ADADAD] text-[#787878] whitespace-nowrap flex items-center gap-[4px]"
              >
                + 옵션 추가
              </button>
            </div>
          </div>

          {/* 태그 선택 — 다중선택 (Figma Frame 126/127/128) */}
          <div className="mb-[5px]">
            <div className="text-[14px] font-medium text-ink mb-[8px]">태그 선택</div>
            <div className="flex gap-[6px]">
              {TAG_BADGES.map(t => {
                const active = form[t.key]
                return (
                  <button
                    key={t.key}
                    onClick={() => setForm(p => ({ ...p, [t.key]: !p[t.key] }))}
                    className="px-[10px] py-[7px] rounded-[10px] text-[13px] font-medium whitespace-nowrap transition-colors"
                    style={{ backgroundColor: active ? t.bg : '#F2F2F2', color: active ? '#FCFCFC' : '#787878' }}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>

          {mode === 'edit' && (
            <button
              onClick={onDelete}
              className="mt-[22px] px-[20px] py-[11px] rounded-[10px] bg-[#FFEFEF] text-[#FF676F] text-[14px] font-medium"
            >
              삭제
            </button>
          )}
        </div>

        <div className="flex items-center justify-end gap-[10px] px-[62px] py-[20px] flex-shrink-0 modal-footer">
          <button onClick={onClose} className="px-[28px] py-[13px] rounded-[10px] bg-[#E8E4E2] text-[#6A635E] text-[15px] font-medium hover:opacity-90 transition-opacity">
            닫기
          </button>
          <button
            onClick={onSave}
            disabled={saving || !canSave}
            className="px-[28px] py-[13px] rounded-[10px] bg-ink text-white text-[15px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:opacity-40"
          >
            {saving ? '저장 중...' : (mode === 'edit' ? '저장' : '추가')}
          </button>
        </div>
      </div>
    </div>
  )
}
