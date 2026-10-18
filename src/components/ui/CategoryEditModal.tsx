import { useEffect, useState } from 'react'

// 카테고리 하나를 고쳐 쓰거나 지우는 모달.
//
// 전까지 카테고리는 메뉴 화면 한구석에서만 만들 수 있었고, 만든 뒤에는
// 이름을 고칠 방법도 지울 방법도 없었다. 카테고리 정보 화면은 보기만 하는 표였다.
//
// ⚠️ 삭제가 이 모달의 위험한 부분이다. 카테고리를 지울 때 **메뉴가 같이 사라지면 안 된다.**
//    DB 의 menus.category_id 는 그 카테고리를 가리키므로, 지우기 전에 메뉴들을
//    먼저 떼어내야(category_id = null) 한다. 순서를 바꾸면 외래키에 걸리거나,
//    설정에 따라 메뉴까지 함께 지워진다.
//    그래서 "메뉴 N개는 그대로 남고 분류만 없어져요"를 눌리기 전에 글자로 보여준다.

export interface CategoryTarget {
  id:        string
  name:      string
  isActive:  boolean
  /** 이 카테고리에 들어 있는 메뉴 수 — 삭제 경고에 쓴다 */
  menuCount: number
}

export default function CategoryEditModal({
  target, onClose, onSave, onDelete,
}: {
  target:   CategoryTarget
  onClose:  () => void
  onSave:   (patch: { name: string; isActive: boolean }) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [name,     setName]     = useState(target.name)
  const [active,   setActive]   = useState(target.isActive)
  const [busy,     setBusy]     = useState(false)
  const [confirm,  setConfirm]  = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmed = name.trim()
  const changed = trimmed !== target.name || active !== target.isActive
  const canSave = trimmed.length > 0 && changed && !busy

  async function save() {
    if (!canSave) return
    setBusy(true); setError('')
    try { await onSave({ name: trimmed, isActive: active }); onClose() }
    catch { setError('저장하지 못했어요. 다시 시도해 주세요'); setBusy(false) }
  }

  async function remove() {
    setBusy(true); setError('')
    try { await onDelete(); onClose() }
    catch { setError('삭제하지 못했어요. 다시 시도해 주세요'); setBusy(false); setConfirm(false) }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="modal-in bg-[#FCFCFC] rounded-[14px] shadow-[0_2px_10px_rgba(44,38,31,0.08)] w-[440px] px-[28px] pt-[24px] pb-[22px]"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-[18px] font-semibold text-[#1E1E1E]">카테고리</div>
        <div className="text-[13px] font-normal text-[#787878] mt-[4px] mb-[20px]">
          메뉴 {target.menuCount}개가 들어 있어요
        </div>

        <div className="text-[12px] font-medium text-[#2C261F] mb-[7px]">이름</div>
        <input
          value={name}
          onChange={e => setName(e.target.value.slice(0, 20))}
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter') save() }}
          className="w-full h-[40px] px-[13px] rounded-[9px] border border-[#D9D9D9] text-[14px] text-ink outline-none focus:border-[#6A635E] mb-[16px]"
        />

        <label className="flex items-center justify-between py-[10px] cursor-pointer">
          <span>
            <span className="block text-[14px] font-normal text-[#1E1E1E]">손님 화면에 보이기</span>
            <span className="block text-[11px] font-normal text-[#ADADAD] mt-[2px]">
              끄면 QR 주문 화면에서 이 분류가 사라져요. 메뉴는 그대로 남아요
            </span>
          </span>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-[18px] h-[18px]" />
        </label>

        {error && <div className="text-[12px] text-danger mt-[10px]">{error}</div>}

        {/* 삭제는 한 단계 더 — 되돌릴 수 없고, 무엇이 남는지 먼저 읽혀야 한다 */}
        {confirm ? (
          <div className="mt-[16px] rounded-[11px] bg-[#FFF0F0] px-[16px] py-[13px]">
            <div className="text-[13px] font-medium text-danger mb-[4px]">
              ‘{target.name}’ 분류를 지울까요?
            </div>
            <div className="text-[12px] font-normal text-[#6A635E] leading-relaxed">
              {target.menuCount > 0
                ? <>메뉴 {target.menuCount}개는 <b className="font-semibold">그대로 남고</b> 분류만 없어져요.
                    그 메뉴들은 ‘분류 없음’으로 모이고, 다시 다른 분류에 넣을 수 있어요.</>
                : '들어 있는 메뉴가 없어서 바로 지울 수 있어요.'}
            </div>
            <div className="flex gap-[8px] justify-end mt-[12px]">
              <button
                onClick={() => setConfirm(false)} disabled={busy}
                className="pressable h-[36px] px-[14px] rounded-[9px] bg-[#E8E4E2] text-[#6A635E] text-[13px] font-medium disabled:opacity-40"
              >
                아니요
              </button>
              <button
                onClick={remove} disabled={busy}
                className="pressable h-[36px] px-[16px] rounded-[9px] bg-[#C92A2A] text-[#FCFCFC] text-[13px] font-medium disabled:opacity-40"
              >
                {busy ? '지우는 중…' : '분류 지우기'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center mt-[20px]">
            <button
              onClick={() => setConfirm(true)} disabled={busy}
              className="text-[13px] font-normal text-danger hover:underline disabled:opacity-40"
            >
              분류 지우기
            </button>
            <div className="flex-1" />
            <div className="flex gap-[8px]">
              <button
                onClick={onClose} disabled={busy}
                className="pressable w-[86px] h-[42px] rounded-[10px] bg-[#E8E4E2] text-[#6A635E] text-[14px] font-medium disabled:opacity-40"
              >
                닫기
              </button>
              <button
                onClick={save} disabled={!canSave}
                className="pressable w-[96px] h-[42px] rounded-[10px] bg-[#2C261F] text-[#FCFCFC] text-[14px] font-medium disabled:opacity-40"
              >
                {busy ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
