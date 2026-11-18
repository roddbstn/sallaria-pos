import { smsByteLength, SMS_BYTE_LIMIT } from './sms-templates'

// 구두주문 3단계의 규칙 — 화면에서 떼어 놓는다.
//
// 1 거래처·주문자  →  2 메뉴  →  3 최종 확인
//
// 전엔 한 화면에 3열(거래처 | 이용자 | 메뉴)로 다 있었다. 전화를 받으면서 쓰는
// 화면이라 빠른 건 좋았는데, 배달 주소·요청사항이 메뉴 위 좁은 띠에 끼어 있어
// 실제로는 거기까지 눈이 안 갔다. 단계를 나누면 각 단계에서 물어볼 것만 묻는다.

export type VerbalStep = 1 | 2 | 3
export type VerbalMethod = '포장' | '내점' | '배달'

/** 숫자만 남긴다. 010-1234-5678 · 010 1234 5678 · 01012345678 전부 같은 값 */
export function phoneDigits(input: string): string {
  return input.replace(/\D/g, '').slice(0, 11)
}

/** 010-1234-5678 꼴로 — 치는 동안 바로 보이게 */
export function formatPhoneInput(input: string): string {
  const d = phoneDigits(input)
  if (d.length < 4) return d
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`
}

/**
 * 문자를 보낼 수 있는 번호인가.
 *
 * 휴대폰만 받는다 — 초대 문자는 **문자로 받아야** 의미가 있고, 02/051 같은
 * 사무실 번호로 보내면 비용만 나가고 아무도 못 본다.
 */
export function isMobilePhone(input: string): boolean {
  const d = phoneDigits(input)
  return /^01[016789]\d{7,8}$/.test(d)
}

/** 명단에 이미 같은 이름이 있나 — 공백 차이는 같은 것으로 본다 */
export function isDuplicateName(name: string, existing: { name: string }[]): boolean {
  const k = name.trim().replace(/\s+/g, '')
  if (!k) return false
  return existing.some(m => m.name.trim().replace(/\s+/g, '') === k)
}

// ── 단계 전환 ────────────────────────────────────────────────────────────────

export interface Step1State { accountCode: string | null; ordererName: string }
export interface Step2State { cartCount: number }
export interface Step3State {
  method:      VerbalMethod
  roadAddress: string
}

/** 1단계를 떠날 수 있나 — 거래처와 **주문자가 누구인지**가 정해져야 한다 */
export function canLeaveStep1(s: Step1State): boolean {
  return !!s.accountCode && s.ordererName.trim().length > 0
}

/** 2단계를 떠날 수 있나 — 담긴 게 없으면 확인할 것도 없다 */
export function canLeaveStep2(s: Step2State): boolean {
  return s.cartCount > 0
}

/**
 * 주문을 넣을 수 있나.
 *
 * 배달인데 주소가 비어 있으면 막는다. 전엔 주소 없이도 들어갔고, 그렇게 들어간
 * 주문은 주방에서 "어디로 보내지?" 가 된다. 포장·내점은 주소를 묻지 않는다.
 */
export function canSubmitVerbal(s1: Step1State, s2: Step2State, s3: Step3State): boolean {
  if (!canLeaveStep1(s1) || !canLeaveStep2(s2)) return false
  if (s3.method === '배달' && s3.roadAddress.trim().length === 0) return false
  return true
}

/** 지금 단계에서 다음으로 갈 수 있나 */
export function canAdvance(step: VerbalStep, s1: Step1State, s2: Step2State, s3: Step3State): boolean {
  if (step === 1) return canLeaveStep1(s1)
  if (step === 2) return canLeaveStep2(s2)
  return canSubmitVerbal(s1, s2, s3)
}

// ── 이용자 등록 문자 ─────────────────────────────────────────────────────────

/**
 * 초대 문자 문구.
 *
 * ⚠️ **단문(90바이트) 안에 들어가야 한다.** 넘으면 LMS 요금이다.
 * 링크는 반드시 단축링크(`/s/<6자>`, 40바이트)를 넣을 것 — 원본 QR 주소는
 * legacy 가 95바이트라 그것만으로 이미 단문을 넘는다.
 * (sms-templates.ts 의 같은 경고 참고 — 거기 초안 셋이 전부 넘고 있었다)
 */
export function inviteSmsText(storeName: string, shortUrl: string): string {
  return `[${storeName}] 선결제 주문 등록 ${shortUrl}`
}

/** 단문 한도를 넘는지 — 보내기 전에 화면에서 확인한다 */
export function inviteSmsFits(storeName: string, shortUrl: string): boolean {
  return smsByteLength(inviteSmsText(storeName, shortUrl)) <= SMS_BYTE_LIMIT
}

/**
 * 이 거래처에 초대 문자를 보낼 수 있나.
 *
 * `legacy`(PIN 방식)는 **보내지 않는다.** 초대 흐름(카카오 로그인 → PIN 자동
 * 표시)이 kakao 전용이라, legacy 로 링크를 보내면 손님이 링크를 눌러도 PIN 을
 * 모르는 상태로 막힌다. 그 상태로 문자만 나가면 비용만 쓰고 전화가 한 통 더 온다.
 * legacy 거래처는 명단에만 추가하고, PIN 은 사무실 QR 종이로 간다.
 */
export function canInviteBySms(
  qrSystem: 'legacy' | 'kakao' | null | undefined,
  phone: string,
): boolean {
  return qrSystem === 'kakao' && isMobilePhone(phone)
}
