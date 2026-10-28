/**
 * 되돌리기 / 다시실행 한 쌍.
 *
 * 할 수 없을 때 **숨기지 않고 연하게** 둔다. 자리가 사라지면 버튼이 생겼다 없어졌다 해서
 * 눈이 그 자리를 매번 다시 찾는다. 편집 중 내내 같은 자리에 있어야 손이 기억한다.
 *
 * 쓰는 곳이 세 군데라 공용으로 뺐다:
 *   · 메뉴 > 화면 편집 — 카테고리 순서 / 개별메뉴 순서 (완료를 누를 때 저장)
 *   · 메뉴 > 카테고리 정보 — 드래그로 놓는 즉시 저장
 * 저장 시점이 달라도 버튼 모양과 '연하게 둔다'는 규칙은 같아야 한다.
 */
export default function UndoRedoPair({ canUndo, canRedo, onUndo, onRedo }: {
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void
}) {
  const BTNS = [
    { key: 'undo', on: canUndo, run: onUndo, label: '되돌리기',
      head: 'M9 5L4 10l5 5',  tail: 'M4 10h9a5 5 0 0 1 0 10H8' },
    { key: 'redo', on: canRedo, run: onRedo, label: '다시 실행',
      head: 'M15 5l5 5-5 5',  tail: 'M20 10h-9a5 5 0 0 0 0 10h5' },
  ] as const
  return (
    <>
      {BTNS.map(b => (
        <button
          key={b.key}
          onClick={b.run}
          disabled={!b.on}
          title={b.label}
          aria-label={b.label}
          className="pressable w-[26px] h-[24px] flex items-center justify-center disabled:cursor-default"
          style={{ opacity: b.on ? 1 : 0.3 }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d={b.head} stroke="#414449" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d={b.tail} stroke="#414449" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ))}
    </>
  )
}
