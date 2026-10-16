// 메뉴 상세 모달의 큰 토글 (고객용 표시 / 품절 처리). Menus.tsx 에서 그대로 옮겼다.
export default function BigToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-[54px] h-[31px] rounded-full transition-colors duration-200 flex-shrink-0 ${checked ? 'bg-[#6A635E]' : 'bg-[#ADADAD]'}`}
    >
      <span className={`absolute top-[4px] left-[4px] w-[23px] h-[23px] rounded-full bg-[#FCFCFC] shadow-sm transition-transform duration-200 ${checked ? 'translate-x-[23px]' : 'translate-x-0'}`} />
    </button>
  )
}
