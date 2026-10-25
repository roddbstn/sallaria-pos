// 화면에 찍히는 숫자의 서체·굵기·색을 한곳에서 정한다.
//
// 왜 필요했나: 같은 '금액'인데 화면마다 달랐다 — 고객 표는 17px 보통 굵기 먹색,
// 충전이력은 12px 굵은 초록, 어떤 곳은 세미볼드. 점주 입장에서는 같은 종류의
// 숫자가 화면을 옮길 때마다 다른 것처럼 보인다.
//
// 기준은 **고객 화면의 계정 표**다. 이 앱에서 숫자를 가장 오래 들여다보는 곳이고,
// 거기 맞춰두면 나머지가 따라온다.
//
// 색 규칙 — **한국 회계·증시 관습: 양수 빨강 / 음수 파랑** (sign-color.ts 가 기준):
//   늘어난 것(충전·증가)  → 빨강 SIGN_UP
//   줄어든 것(음수 잔액)  → 파랑 SIGN_DOWN
//   변화 없음·보조        → 회색 #ADADAD
//   그 외 일반 금액       → 먹색(text-ink)
//
// tabular-nums 를 늘 붙인다. 비례 폭 숫자는 자릿수가 바뀔 때마다 열이 흔들려서
// 표에서 금액을 위아래로 훑을 수 없다.

/** 일반 금액·건수 — 표의 기본 */
export const NUM = 'tabular-nums text-ink'

/** 강조할 금액(잔액 등) */
export const NUM_STRONG = 'tabular-nums text-ink font-medium'

// ⚠️ 색 리터럴은 sign-color.ts 의 SIGN_UP/SIGN_DOWN 과 **같은 값을 직접 적는다.**
//    템플릿 리터럴(`text-[${SIGN_UP}]`)로 쓰면 Tailwind 가 소스를 정적으로 훑을 때
//    클래스를 못 찾아 CSS 가 아예 생성되지 않는다(색이 사라진다).

/** 늘어난 것 — 충전, 증가 (SIGN_UP) */
export const NUM_UP = 'tabular-nums text-[#FF676F] font-medium'

/** 줄어든 것 — 음수 잔액, 감소 (SIGN_DOWN) */
export const NUM_DOWN = 'tabular-nums text-[#3374FF] font-medium'

/** 보조·없음 */
export const NUM_MUTED = 'tabular-nums text-[#ADADAD]'

/**
 * 증감 한 줄에 쓰는 색 — '추이' 칸과 같은 규칙.
 * 0 은 회색으로 둔다. 0 을 파랑이나 빨강으로 칠하면 "아무 일도 없었다"가
 * 변화처럼 읽힌다.
 */
export function deltaClass(n: number): string {
  if (n > 0) return NUM_UP
  if (n < 0) return NUM_DOWN
  return NUM_MUTED
}
