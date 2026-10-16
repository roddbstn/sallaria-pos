import { SUNPOS_KAKAO_URL } from './qr-order'

// 거래처 PIN은 **두 컬럼에 같이** 저장해야 한다.
//
//   accounts.pin_code      — 평문. 레거시 QR 웹(sallaria.web.app)의 PIN 입력과
//                            "PIN 찾기" 조회가 이 컬럼을 읽는다.
//   accounts.pin_encrypted — AES-256-CBC. sunpos-kakao 의 /api/pin verify_account 가 쓴다.
//
// 한쪽만 쓰면 그쪽 체계에서만 로그인이 된다. 실제로 그렇게 갈라져 있었다(2026-10-13 발견):
//   · 거래처 등록은 pin_encrypted 만 써서 → 레거시 웹 로그인 불가
//   · 거래처 수정은 pin_code 만 써서     → 카카오 로그인이 "옛 PIN"으로 남음.
//     새 PIN 을 넣으면 "일치하지 않는다"가 뜨는 게 이 때문이었다.
//   · 그리고 기존 37건은 pin_encrypted 가 아예 비어 있어 카카오 로그인이 전원 실패했다.
//
// AES 키(PIN_AES_KEY)는 sunpos-kakao 서버에만 있다. Electron 번들에 키를 넣으면
// 사용자 PC 에 키가 배포되는 것이라, 암호화는 네트워크로 그쪽에 맡긴다.
//
// ⚠️ 평문 컬럼을 지우는 건 레거시 웹을 걷어낸 뒤에야 가능하다. 지금 지우면
//    legacy qr_system 거래처가 전부 로그인 불가가 된다.

export interface PinColumns {
  pin_code:      string
  pin_encrypted: string
}

/**
 * PIN 4자리 → 두 컬럼에 넣을 값.
 * 암호화가 실패하면 **저장을 포기한다**(throw). 평문만 저장해 두면 카카오 쪽이
 * 조용히 옛 PIN 으로 남는데, 그게 이번 장애의 모양이었다.
 */
export async function buildPinColumns(pin: string): Promise<PinColumns> {
  const trimmed = pin.trim()
  if (!/^\d{4}$/.test(trimmed)) throw new Error('PIN은 숫자 4자리여야 해요')

  const res = await fetch(`${SUNPOS_KAKAO_URL}/api/pin/`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'encrypt', pin: trimmed }),
  })
  if (!res.ok) throw new Error(`PIN 암호화 서버 오류 (${res.status})`)

  const json = await res.json() as { encrypted?: string }
  const encrypted = json.encrypted
  // iv:ciphertext 형태인지 확인 — 형식이 깨진 값을 넣으면 복호화 단계에서 500 이 난다
  if (!encrypted || !/^[0-9a-f]{32}:[0-9a-f]+$/.test(encrypted)) {
    throw new Error('PIN 암호화 응답이 올바르지 않아요')
  }

  return { pin_code: trimmed, pin_encrypted: encrypted }
}
