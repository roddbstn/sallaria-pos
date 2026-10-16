// 개인정보 가리기 — 메인 프로세스(영수증 인쇄) 전용 사본.
//
// 렌더러에는 src/lib/mask.ts 에 같은 규칙이 있다. 메인 프로세스는 렌더러 번들을
// import 할 수 없어 어쩔 수 없이 두 벌이다 — 한쪽을 고치면 다른 쪽도 같이 고칠 것.
//
// 왜 영수증까지 가리나: 주방용은 벽에 붙고, 고객용은 배달 봉투에 끼워 나간다.
// 안심번호(050-) API 를 도입하기 전까지의 차선책이다.

/** 김민준 → 김*준 · 이서 → 이* · 박 → 박 */
export function maskName(name: string | null | undefined): string {
  if (!name) return ''
  if (name.length <= 1) return name
  if (name.length === 2) return `${name[0]}*`
  return `${name[0]}${'*'.repeat(name.length - 2)}${name[name.length - 1]}`
}

/** 010-1234-5678 → 010-****-5678 (구분자 없어도 처리). 자릿수가 모자라면 원본 그대로 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const d = phone.replace(/\D/g, '')
  if (d.length < 9) return phone
  return `${d.slice(0, 3)}-${'*'.repeat(d.length - 7)}-${d.slice(-4)}`
}
