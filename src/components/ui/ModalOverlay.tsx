import { useEffect, useRef, type ReactNode } from 'react'

/**
 * 모달 바깥 영역(backdrop) — 바깥 클릭·Esc 로 닫는 동작을 **한 군데에서** 책임진다.
 *
 * 왜 만들었나: 이 패턴이 53곳에 손으로 복사돼 있었고, 그중 12곳이 어긋나 있었다.
 *   - backdrop 에 onClick 을 안 건 곳 → 바깥을 눌러도 안 닫힘 (구두주문 받기가 이 경우였다)
 *   - 안쪽 패널에 stopPropagation 은 걸어놨는데 backdrop onClick 은 빠진 곳
 *     (조기마감 모달 — 누군가 바깥 클릭을 의도했다가 반쪽만 구현한 흔적)
 *   - Esc 는 오버레이가 있는 30개 파일 중 18개만 처리
 * 복사가 아니라 호출이 되면 다음 모달은 저절로 맞는다.
 *
 * ## 안 쓰는 경우
 * 되돌릴 수 없는 확인창(삭제·탈퇴·운영시간 외 강제 ON)과 끝까지 가야 하는 흐름
 * (신규 주문 팝업, 온보딩 연습 주문, 비밀번호 재설정)은 **일부러** 바깥 클릭으로
 * 닫지 않는다. 그런 곳은 평소대로 <div className="fixed inset-0 …"> 를 직접 쓴다.
 *
 * ## children
 * 안쪽 패널은 backdrop 의 **직계 자식 그대로** 들어간다(래퍼를 끼우지 않는다) —
 * 래퍼가 하나 끼면 h-[85vh]·max-w 같은 치수가 미묘하게 달라질 수 있어서다.
 * 대신 target===currentTarget 으로 "진짜 backdrop 을 눌렀는지"만 본다.
 * 그래서 패널에 onClick={e => e.stopPropagation()} 은 더 필요하지 않다(있어도 무해).
 */
export default function ModalOverlay({
  onClose,
  z = 50,
  className = 'flex items-center justify-center',
  backdropClassName = 'bg-black/40',
  closeOnBackdrop = true,
  closeOnEscape = true,
  children,
}: {
  onClose: () => void
  /** z-index. 이 앱의 층: 50 화면 내부 < 65 신규 주문 < 70 사용자가 연 모달 < 300+ 전역 */
  z?: number
  /** 정렬 등 backdrop 자체의 레이아웃 클래스 */
  className?: string
  backdropClassName?: string
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  children: ReactNode
}) {
  // onClose 가 매 렌더 새 함수로 와도 effect 를 다시 걸지 않도록 ref 에 담아둔다.
  // (대부분의 호출부가 () => setOpen(false) 를 인라인으로 넘긴다)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!closeOnEscape) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [closeOnEscape])

  return (
    <div
      className={`fixed inset-0 ${className} ${backdropClassName}`}
      style={{ zIndex: z }}
      /* mousedown 이 아니라 click 으로 듣는다. mousedown 으로 닫으면 패널 안에서
         글자를 드래그 선택하다 바깥에서 손을 떼는 순간 닫혀버린다. */
      onClick={closeOnBackdrop ? e => { if (e.target === e.currentTarget) closeRef.current() } : undefined}
    >
      {children}
    </div>
  )
}
