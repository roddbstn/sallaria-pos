import { describe, it, expect } from 'vitest'
import { formatPhone, phoneDigits, isValidPhone } from './phone-format'

// 이 파일이 지키는 것: 매장 연락처에 **안심번호**를 넣을 수 있는 것.
//
// 안심번호(0507 등)는 4-4-4 라서, 휴대폰 3-4-4 만 가정한 포매터에 넣으면
// 0507-1484-4222 가 050-7148-4422 로 망가진다. 침산점 연락처가 실제로 0507 번호라
// 이게 깨지면 영수증에 틀린 번호가 찍힌다.

describe('formatPhone — 번호 체계별 끊기', () => {
  it('휴대폰 3-4-4', () => {
    expect(formatPhone('01048713893')).toBe('010-4871-3893')
    expect(formatPhone('01112345678')).toBe('011-1234-5678')
  })

  it('안심번호 4-4-4 — 0507 은 국번이 네 자리다', () => {
    expect(formatPhone('050714844222')).toBe('0507-1484-4222')
    expect(formatPhone('050312345678')).toBe('0503-1234-5678')
    expect(formatPhone('050512345678')).toBe('0505-1234-5678')
  })

  it('서울 02 는 국번이 두 자리', () => {
    expect(formatPhone('0212345678')).toBe('02-1234-5678')
    expect(formatPhone('021234567')).toBe('02-123-4567')
  })

  it('지역번호 3자리 — 가운데가 3이든 4든 맞는다', () => {
    expect(formatPhone('0311234567')).toBe('031-123-4567')
    expect(formatPhone('03112345678')).toBe('031-1234-5678')
    expect(formatPhone('0531234567')).toBe('053-123-4567')   // 대구
  })

  it('대표번호 15xx·16xx·18xx 는 두 덩이', () => {
    expect(formatPhone('15881234')).toBe('1588-1234')
    expect(formatPhone('16881234')).toBe('1688-1234')
    expect(formatPhone('18001234')).toBe('1800-1234')
  })

  it('인터넷전화 070', () => {
    expect(formatPhone('07012345678')).toBe('070-1234-5678')
  })
})

describe('formatPhone — 자릿수로 떨어지는 규칙', () => {
  it('11자리는 3-4-4', () => {
    expect(formatPhone('01048713893')).toBe('010-4871-3893')
    expect(formatPhone('07012345678')).toBe('070-1234-5678')
    expect(formatPhone('03112345678')).toBe('031-1234-5678')
  })

  it('12자리는 4-4-4', () => {
    expect(formatPhone('050714844222')).toBe('0507-1484-4222')
    // 접두사 목록에 없는 12자리도 4-4-4 — 전엔 070-12345-6789 처럼 가운데가 5였다
    expect(formatPhone('070123456789')).toBe('0701-2345-6789')
    expect(formatPhone('099912345678')).toBe('0999-1234-5678')
  })

  it('02 는 길이 규칙에 휘둘리지 않는다 — 국번이 2자리', () => {
    expect(formatPhone('0212345678')).toBe('02-1234-5678')
    expect(formatPhone('021234567')).toBe('02-123-4567')
  })
})

describe('formatPhone — 입력 중', () => {
  it('국번만 쳤을 땐 하이픈을 안 붙인다', () => {
    expect(formatPhone('0')).toBe('0')
    expect(formatPhone('010')).toBe('010')
    expect(formatPhone('0507')).toBe('0507')
  })

  it('치는 동안 하이픈이 따라 들어온다', () => {
    expect(formatPhone('0104')).toBe('010-4')
    expect(formatPhone('010487')).toBe('010-487')
    expect(formatPhone('0104871389')).toBe('010-4871-389')
  })

  it('이미 하이픈이 있어도 다시 포맷한다 (붙여넣기)', () => {
    expect(formatPhone('010-4871-3893')).toBe('010-4871-3893')
    expect(formatPhone('0507 1484 4222')).toBe('0507-1484-4222')
    expect(formatPhone('(02) 1234-5678')).toBe('02-1234-5678')
  })

  it('빈 값·숫자 없음은 빈 문자열', () => {
    expect(formatPhone('')).toBe('')
    expect(formatPhone('없음')).toBe('')
  })

  it('12자리를 넘겨 붙여넣어도 잘라낸다', () => {
    expect(phoneDigits(formatPhone('0104871389312345'))).toHaveLength(12)
  })
})

describe('isValidPhone — 길이만 본다', () => {
  it('8~12자리는 통과', () => {
    expect(isValidPhone('15881234')).toBe(true)        // 8
    expect(isValidPhone('010-4871-3893')).toBe(true)   // 11
    expect(isValidPhone('0507-1484-4222')).toBe(true)  // 12
  })

  it('너무 짧거나 길면 거절', () => {
    expect(isValidPhone('1234567')).toBe(false)
    expect(isValidPhone('0104871389312')).toBe(false)
  })

  it('번호 체계를 엄격히 따지지 않는다 — 새 번호대가 생겨도 막히면 안 된다', () => {
    expect(isValidPhone('0999-1234-5678')).toBe(true)
  })
})
