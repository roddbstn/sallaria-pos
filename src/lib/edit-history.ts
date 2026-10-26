// 화면 편집의 되돌리기 / 다시실행.
//
// 메뉴 화면의 편집 모드는 '완료' 를 누르기 전까지 서버에 아무것도 보내지 않는다.
// 그래서 되돌리기는 **배열 스냅샷을 오가는 것**으로 충분하다 — 서버 왕복이 없다.
//
// 카테고리 순서와 개별메뉴 순서가 같은 규칙을 쓰므로 여기 한 곳에 둔다.
// (화면 쪽에 각각 두면 한쪽만 고치게 된다)

export interface EditHistory<T> {
  /** 0번은 늘 '편집 전'. 여기보다 더 되돌릴 수는 없다 */
  stack: T[][]
  idx:   number
}

export function initHistory<T>(first: T[]): EditHistory<T> {
  return { stack: [first], idx: 0 }
}

/**
 * 한 번의 편집을 쌓는다.
 *
 * 되돌린 뒤 새로 편집하면 앞쪽(다시실행) 가지는 버린다 — 편집기의 관례다.
 * 남겨두면 "되돌렸다가 다른 걸 했는데 다시실행이 살아 있는" 상태가 되어
 * 무엇으로 돌아갈지 예측할 수 없다.
 */
export function pushHistory<T>(h: EditHistory<T>, next: T[]): EditHistory<T> {
  return { stack: [...h.stack.slice(0, h.idx + 1), next], idx: h.idx + 1 }
}

export const canUndo = <T,>(h: EditHistory<T>) => h.idx > 0
export const canRedo = <T,>(h: EditHistory<T>) => h.idx < h.stack.length - 1

export function undoHistory<T>(h: EditHistory<T>): EditHistory<T> {
  return canUndo(h) ? { ...h, idx: h.idx - 1 } : h
}
export function redoHistory<T>(h: EditHistory<T>): EditHistory<T> {
  return canRedo(h) ? { ...h, idx: h.idx + 1 } : h
}

/** 지금 보고 있는 스냅샷 */
export const currentOf = <T,>(h: EditHistory<T>): T[] => h.stack[h.idx]

/**
 * 순서가 실제로 바뀌었나. 드래그를 제자리에 놓았을 때 히스토리를 쌓지 않으려고 쓴다.
 * 길이가 다르면(삭제) 당연히 바뀐 것이다.
 */
export function orderChanged<T>(a: T[], b: T[], keyOf: (x: T) => string): boolean {
  if (a.length !== b.length) return true
  return a.some((x, i) => keyOf(x) !== keyOf(b[i]))
}
