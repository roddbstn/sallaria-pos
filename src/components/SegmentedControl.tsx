import React from 'react'

interface Option<T> {
  label: string
  value: T
}

interface SegmentedControlProps<T> {
  options: Option<T>[]
  value: T
  onChange: (v: T) => void
  className?: string
  size?: 'xs' | 'sm' | 'md'
  rounded?: 'md' | 'lg' | 'xl'
}

// 컨테이너 안쪽 여백 (px) — 흰 박스가 회색 테두리에서 떨어지는 간격
const GAP = 2

export function SegmentedControl<T>({
  options,
  value,
  onChange,
  className = '',
  size = 'sm',
  rounded = 'lg',
}: SegmentedControlProps<T>) {
  const activeIdx = options.findIndex(o => o.value === value)
  const n = options.length

  const textSize = size === 'xs' ? 'text-[11px]' : size === 'sm' ? 'text-[13px]' : 'text-[14px]'
  const py       = size === 'xs' ? 'py-1'        : size === 'sm' ? 'py-2.5'      : 'py-3'
  const px       = size === 'xs' ? 'px-3'        : size === 'sm' ? 'px-3'        : 'px-4'
  const thumbR   = rounded === 'xl' ? 'rounded-[10px]' : 'rounded-md'
  const wrapR    = rounded === 'xl' ? 'rounded-xl'     : 'rounded-lg'

  return (
    <div
      className={`relative ${wrapR} bg-gray-100 ${className}`}
      style={{ padding: GAP, display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)` }}
    >
      {/* 슬라이딩 흰색 thumb */}
      {activeIdx >= 0 && (
        <div
          className={`absolute ${thumbR} bg-white pointer-events-none`}
          style={{
            top:        GAP,
            bottom:     GAP,
            width:      `calc((100% - ${GAP * 2}px) / ${n})`,
            left:       `calc(${GAP}px + ${activeIdx} * (100% - ${GAP * 2}px) / ${n})`,
            transition: 'left 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow:  '0 1px 5px rgba(0,0,0,0.13), 0 0 0 0.5px rgba(0,0,0,0.06)',
          }}
        />
      )}
      {/* 버튼들 */}
      {options.map((opt, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`relative z-10 ${py} ${px} ${thumbR} ${textSize} font-medium whitespace-nowrap transition-colors duration-150 flex items-center justify-center focus:outline-none ${
            opt.value === value ? 'text-ink' : 'text-[#ABABAB]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
