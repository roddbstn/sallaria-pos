import { describe, it, expect } from 'vitest'
import {
  phoneDigits, formatPhoneInput, isMobilePhone, isDuplicateName,
  canLeaveStep1, canLeaveStep2, canSubmitVerbal, canAdvance,
  inviteSmsText, inviteSmsFits, canInviteBySms,
} from './verbal-order'
import { smsByteLength } from './sms-templates'

const SHORT = 'https://sunpos-kakao.vercel.app/s/ab12cd'

describe('전화번호', () => {
  it('구분자가 뭐든 같은 숫자가 된다', () => {
    for (const v of ['010-4871-3893', '010 4871 3893', '01048713893', '010.4871.3893']) {
      expect(phoneDigits(v)).toBe('01048713893')
    }
  })

  it('11자리를 넘겨 쳐도 잘린다', () => {
    expect(phoneDigits('010487138939999')).toBe('01048713893')
  })

  it('치는 동안 하이픈이 붙는다', () => {
    expect(formatPhoneInput('010')).toBe('010')
    expect(formatPhoneInput('0104')).toBe('010-4')
    expect(formatPhoneInput('0104871')).toBe('010-4871')
    expect(formatPhoneInput('01048713893')).toBe('010-4871-3893')
  })

  it('휴대폰만 통과시킨다 — 사무실 번호로 문자를 보내면 비용만 나간다', () => {
    expect(isMobilePhone('010-4871-3893')).toBe(true)
    expect(isMobilePhone('011-234-5678')).toBe(true)
    expect(isMobilePhone('02-123-4567')).toBe(false)
    expect(isMobilePhone('053-1234-5678')).toBe(false)
    expect(isMobilePhone('010-123')).toBe(false)
    expect(isMobilePhone('')).toBe(false)
  })
})

describe('중복 이름', () => {
  const list = [{ name: '김정보' }, { name: '강 윤수' }]

  it('같은 이름을 잡는다', () => {
    expect(isDuplicateName('김정보', list)).toBe(true)
  })

  it('공백 차이는 같은 사람으로 본다', () => {
    expect(isDuplicateName('강윤수', list)).toBe(true)
    expect(isDuplicateName(' 김정보 ', list)).toBe(true)
  })

  it('다른 이름은 통과', () => {
    expect(isDuplicateName('박건희', list)).toBe(false)
  })

  it('빈 이름은 중복이 아니다 — 막는 건 이름 검사가 할 일', () => {
    expect(isDuplicateName('   ', list)).toBe(false)
  })
})

describe('단계 전환', () => {
  const acc = { accountCode: 'a-1', ordererName: '김정보' }
  const cart = { cartCount: 2 }
  const pickup = { method: '포장' as const, roadAddress: '' }
  const delivery = { method: '배달' as const, roadAddress: '' }

  it('거래처만 고르고 주문자를 안 고르면 1단계를 못 떠난다', () => {
    expect(canLeaveStep1({ accountCode: 'a-1', ordererName: '' })).toBe(false)
    expect(canLeaveStep1({ accountCode: 'a-1', ordererName: '  ' })).toBe(false)
    expect(canLeaveStep1({ accountCode: null, ordererName: '김정보' })).toBe(false)
    expect(canLeaveStep1(acc)).toBe(true)
  })

  it('담긴 게 없으면 2단계를 못 떠난다', () => {
    expect(canLeaveStep2({ cartCount: 0 })).toBe(false)
    expect(canLeaveStep2(cart)).toBe(true)
  })

  it('배달인데 주소가 비면 주문할 수 없다', () => {
    expect(canSubmitVerbal(acc, cart, delivery)).toBe(false)
    expect(canSubmitVerbal(acc, cart, { ...delivery, roadAddress: '대구 북구 침산로 1' })).toBe(true)
  })

  it('포장·내점은 주소를 묻지 않는다', () => {
    expect(canSubmitVerbal(acc, cart, pickup)).toBe(true)
    expect(canSubmitVerbal(acc, cart, { method: '내점', roadAddress: '' })).toBe(true)
  })

  it('canAdvance 가 단계마다 맞는 조건을 본다', () => {
    const empty = { cartCount: 0 }
    expect(canAdvance(1, acc, empty, pickup)).toBe(true)   // 1단계는 장바구니와 무관
    expect(canAdvance(2, acc, empty, pickup)).toBe(false)  // 2단계는 장바구니를 본다
    expect(canAdvance(3, acc, cart, delivery)).toBe(false) // 3단계는 배달 주소까지 본다
  })
})

describe('초대 문자', () => {
  it('단문(90바이트) 안에 들어간다 — 넘으면 LMS 요금', () => {
    for (const store of ['샐러리아 침산점', '행포케', '행복 포케 북구점']) {
      const text = inviteSmsText(store, SHORT)
      expect(smsByteLength(text)).toBeLessThanOrEqual(90)
      expect(inviteSmsFits(store, SHORT)).toBe(true)
    }
  })

  it('매장명이 아주 길면 한도를 넘는다고 알려준다', () => {
    expect(inviteSmsFits('아주아주길고긴매장이름을가진가게입니다정말로', SHORT)).toBe(false)
  })

  it('원본 QR 주소(단축 안 한 것)를 넣으면 한도를 넘는다', () => {
    const raw = 'https://sallaria.web.app?store=11111111-1111-1111-1111-111111111111&account=22222222-2222-2222-2222-222222222222'
    expect(inviteSmsFits('행포케', raw)).toBe(false)
  })

  it('매장명과 링크가 문구에 들어간다', () => {
    expect(inviteSmsText('행포케', SHORT)).toBe(`[행포케] 선결제 주문 등록 ${SHORT}`)
  })
})

describe('문자 보낼 자격', () => {
  it('kakao 거래처 + 휴대폰이어야 보낸다', () => {
    expect(canInviteBySms('kakao', '010-4871-3893')).toBe(true)
  })

  it('legacy 는 보내지 않는다 — 링크를 눌러도 PIN 을 모른다', () => {
    expect(canInviteBySms('legacy', '010-4871-3893')).toBe(false)
  })

  it('번호가 휴대폰이 아니면 보내지 않는다', () => {
    expect(canInviteBySms('kakao', '053-123-4567')).toBe(false)
    expect(canInviteBySms('kakao', '')).toBe(false)
  })

  it('qr_system 이 비어 있으면 보내지 않는다', () => {
    expect(canInviteBySms(null, '010-4871-3893')).toBe(false)
    expect(canInviteBySms(undefined, '010-4871-3893')).toBe(false)
  })
})
