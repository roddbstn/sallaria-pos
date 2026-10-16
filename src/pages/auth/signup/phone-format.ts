// 01012345678 → +821012345678 (Supabase Auth가 요구하는 E.164 형식)
export function toE164(domesticDigits: string): string {
  return '+82' + domesticDigits.replace(/^0/, '')
}

/**
 * auth.users.phone 은 '+' 없이 저장된다 (예: 821077064224).
 * 821077064224 / +821077064224 → 010-7706-4224
 * 한국 번호가 아니면 받은 값을 그대로 돌려준다.
 */
export function fromE164(e164: string | null | undefined): string {
  if (!e164) return ''
  const d = e164.replace(/\D/g, '')
  if (!d.startsWith('82')) return e164
  const local = '0' + d.slice(2)              // 821077064224 → 01077064224
  if (local.length === 11) return `${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`
  if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`
  return local
}
