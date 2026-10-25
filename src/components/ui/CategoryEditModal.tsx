import { useEffect, useState } from 'react'
import ConfirmDialog from './ConfirmDialog'
import { won } from '../../lib/ipc'

// 카테고리 하나를 고쳐 쓰거나 지우는 모달.
//
// 전까지 카테고리는 메뉴 화면 한구석에서만 만들 수 있었고, 만든 뒤에는
// 이름을 고칠 방법도 지울 방법도 없었다. 카테고리 정보 화면은 보기만 하는 표였다.
//
// ⚠️ 삭제가 이 모달의 위험한 부분이다. 카테고리를 지울 때 **메뉴가 같이 사라지면 안 된다.**
//    DB 의 menus.category_id 는 그 카테고리를 가리키므로, 지우기 전에 메뉴들을
//    먼저 떼어내야(category_id = null) 한다. 순서를 바꾸면 외래키에 걸리거나,
//    설정에 따라 메뉴까지 함께 지워진다. (실제 동작은 호출하는 쪽 onDelete 에 있다)
//
// '메뉴 N개가 들어 있어요'라고 숫자만 적던 걸 **목록 자체로 바꿨다.** 분류를 지울지
// 말지는 "무엇이 들어 있나"를 보고 정하는 일인데, 숫자만 보여주면 점주가 그걸
// 확인하러 화면을 한 번 나갔다 와야 했다.

export interface CategoryMenu {
  id:         string
  name:       string
  price:      number
  isSoldOut?: boolean
  isHidden?:  boolean
}

export interface CategoryTarget {
  id:       string
  name:     string
  isActive: boolean
  /** 이 카테고리에 들어 있는 메뉴 — 목록으로 보여주고, 삭제 안내에도 쓴다 */
  menus:    CategoryMenu[]
}

export default function CategoryEditModal({
  target, onClose, onSave, onDelete,
}: {
  target:   CategoryTarget
  onClose:  () => void
  onSave:   (patch: { name: string; isActive: boolean }) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [name,    setName]    = useState(target.name)
  const [busy,    setBusy]    = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    // 확인 다이얼로그가 떠 있을 땐 그쪽이 ESC 를 받는다 — 둘 다 닫히면 안 된다
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !confirm) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, confirm])

  const trimmed = name.trim()
  const canSave = trimmed.length > 0 && trimmed !== target.name && !busy

  async function save() {
    if (!canSave) return
    setBusy(true); setError('')
    // 노출 여부는 이 모달에서 건드리지 않는다(표의 '노출' 칸에서 본다) — 들어온 값을 그대로 돌려준다
    try { await onSave({ name: trimmed, isActive: target.isActive }); onClose() }
    catch { setError('저장하지 못했어요. 다시 시도해 주세요'); setBusy(false) }
  }

  async function remove() {
    setBusy(true); setError('')
    try { await onDelete(); onClose() }
    catch { setError('삭제하지 못했어요. 다시 시도해 주세요'); setBusy(false); setConfirm(false) }
  }

  return (
    <>
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={() => !busy && onClose()}>
        <div
          className="modal-in bg-[#FCFCFC] rounded-[18px] shadow-[0_2px_10px_rgba(44,38,31,0.08)] w-[440px] max-w-[92vw] max-h-[84vh] flex flex-col overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex-shrink-0 px-[28px] pt-[24px] pb-[16px]">
            <div className="text-[18px] font-semibold text-[#1E1E1E]">카테고리</div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-[28px] pb-[20px]">
            <div className="text-[12px] font-medium text-[#2C261F] mb-[7px]">이름</div>
            <input
              value={name}
              onChange={e => setName(e.target.value.slice(0, 20))}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') save() }}
              className="w-full h-[40px] px-[13px] rounded-[9px] border border-[#D9D9D9] text-[14px] text-ink outline-none focus:border-[#6A635E] mb-[20px]"
            />

            <div className="flex items-baseline justify-between mb-[7px]">
              <span className="text-[12px] font-medium text-[#2C261F]">들어 있는 메뉴</span>
              <span className="text-[11px] font-normal text-[#ADADAD] tabular-nums">{target.menus.length}개</span>
            </div>

            {target.menus.length === 0 ? (
              <div className="rounded-[11px] border border-[#E8E4E2] py-[28px] text-center text-[12px] font-normal text-[#ADADAD]">
                이 분류에 든 메뉴가 없어요
              </div>
            ) : (
              <div className="rounded-[11px] border border-[#E8E4E2] overflow-hidden">
                {target.menus.map((m, i) => (
                  <div
                    key={m.id}
                    className={`flex items-center gap-[8px] px-[13px] h-[38px] ${i > 0 ? 'border-t border-[#F2F2F2]' : ''}`}
                  >
                    <span className={`flex-1 min-w-0 text-[12px] truncate ${m.isHidden ? 'text-[#ADADAD]' : 'text-[#414141]'}`}>
                      {m.name}
                    </span>
                    {m.isSoldOut && (
                      <span className="flex-shrink-0 px-[6px] h-[18px] leading-[18px] rounded-[5px] bg-[#F2F2F2] text-[10px] text-[#787878]">품절</span>
                    )}
                    {m.isHidden && (
                      <span className="flex-shrink-0 px-[6px] h-[18px] leading-[18px] rounded-[5px] bg-[#F2F2F2] text-[10px] text-[#787878]">숨김</span>
                    )}
                    <span className="flex-shrink-0 text-[12px] tabular-nums text-[#787878]">{won(m.price)}</span>
                  </div>
                ))}
              </div>
            )}

            {error && <div className="text-[12px] text-danger mt-[12px]">{error}</div>}
          </div>

          {/* 푸터 — OptionGroupEditModal 과 같은 치수·색이다(이 앱의 모달 푸터 기준) */}
          <div className="flex-shrink-0 modal-footer px-[28px] py-[14px] flex items-center justify-between">
            <button
              onClick={() => setConfirm(true)}
              disabled={busy}
              className="h-[34px] px-[18px] rounded-[10px] bg-[#FFEFEF] text-[#FF676F] text-[13px] font-semibold hover:bg-[#FFE4E4] transition-colors disabled:opacity-40"
            >
              삭제
            </button>
            <div className="flex items-center gap-[9px]">
              <button
                onClick={onClose} disabled={busy}
                className="h-[38px] px-[16px] rounded-[9px] bg-[#F2F2F2] text-[#787878] text-[13px] font-medium hover:bg-[#E8E4E2] transition-colors disabled:opacity-40"
              >
                닫기
              </button>
              <button
                onClick={save} disabled={!canSave}
                className="h-[38px] px-[20px] rounded-[9px] bg-[#2C261F] text-[#F9F9F9] text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {busy ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          title={`${target.name} 카테고리를 삭제하시겠어요?`}
          description="메뉴는 삭제되지 않아요"
          busy={busy}
          onConfirm={remove}
          onCancel={() => setConfirm(false)}
        />
      )}
    </>
  )
}
