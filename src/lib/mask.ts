// 개인정보 가리기 — 주문자 이름 / 연락처.
//
// 안심번호 API(050-)를 도입하기 전까지의 차선책이다. 영수증은 주방 벽에 붙고 배달 봉투에
// 끼워 나가고, POS 화면은 카운터 앞에서 손님에게 그대로 보인다. 그래서 기본은 가린 상태로
// 두고, 점주가 전화를 걸어야 할 때만 눈 버튼으로 연다.
//
// ⚠️ 같은 규칙이 electron/printer.ts 에도 복사본으로 있다. 메인 프로세스는 이 번들을
//    가져오지 않아서 어쩔 수 없다 — 한쪽을 고치면 다른 쪽도 같이 고칠 것.

/** 김민준 → 김*준 · 이서 → 이* · 박 → 박 */
export function maskName(name: string | null | undefined): string {
  if (!name) return ''
  if (name.length <= 1) return name
  if (name.length === 2) return `${name[0]}*`
  return `${name[0]}${'*'.repeat(name.length - 2)}${name[name.length - 1]}`
}

/** 010-1234-5678 → 010-****-5678 (구분자가 없어도 처리). 자릿수가 모자라면 원본 그대로 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const d = phone.replace(/\D/g, '')
  if (d.length < 9) return phone
  return `${d.slice(0, 3)}-${'*'.repeat(d.length - 7)}-${d.slice(-4)}`
}
