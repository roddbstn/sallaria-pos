import { describe, it, expect } from 'vitest'
import { smsByteLength, worstCaseBytes, clampToSms, fillTemplate, SMS_TEMPLATES, SMS_BYTE_LIMIT } from './sms-templates'

// 문자는 건당 돈이 나가고 되돌릴 수 없다. 90바이트를 넘으면 LMS 요금으로 넘어가는데,
// 그걸 **보내고 나서** 알면 늦는다.

describe('smsByteLength', () => {
  it('한글 2 · ASCII 1', () => {
    expect(smsByteLength('가나다')).toBe(6)
    expect(smsByteLength('abc123')).toBe(6)
    // [=1 샐러리아=8 ]=1 공백=1 1,000=5 원=2
    expect(smsByteLength('[샐러리아] 1,000원')).toBe(18)
  })

  it('단문 한도는 한글 45자', () => {
    expect(smsByteLength('가'.repeat(45))).toBe(SMS_BYTE_LIMIT)
    expect(smsByteLength('가'.repeat(46))).toBeGreaterThan(SMS_BYTE_LIMIT)
  })
})

describe('worstCaseBytes — 가장 긴 수신자 기준', () => {
  const draft = '[{매장}] {거래처} 잔액 {잔액}'
  const people = [
    { name: '구청 공녹과',       balance: '0원' },
    { name: '북구청 공원녹지과', balance: '-1,234,500원' },
  ]

  it('첫 사람이 아니라 가장 긴 사람으로 잰다', () => {
    const first = smsByteLength(fillTemplate(draft, { store: '행포케', account: people[0].name, balance: people[0].balance }))
    const { bytes, who } = worstCaseBytes(draft, '행포케', people)
    expect(bytes).toBeGreaterThan(first)
    expect(who).toBe('북구청 공원녹지과')
  })

  it('받는 사람이 없으면 기본값으로 잰다', () => {
    expect(worstCaseBytes(draft, '행포케', []).bytes).toBeGreaterThan(0)
  })
})

describe('clampToSms', () => {
  const people = [{ name: '북구청 공원녹지과', balance: '-1,234,500원' }]

  it('한도 안이면 그대로 둔다', () => {
    expect(clampToSms('짧은 문구', '행포케', people)).toBe('짧은 문구')
  })

  it('넘치면 한도 안으로 자른다', () => {
    const long = '가'.repeat(200)
    const out = clampToSms(long, '행포케', people)
    expect(worstCaseBytes(out, '행포케', people).bytes).toBeLessThanOrEqual(SMS_BYTE_LIMIT)
    expect(out.length).toBeLessThan(long.length)
  })

  it('자른 뒤에도 가장 긴 수신자가 한도 안이다', () => {
    const many = [
      { name: '가', balance: '0원' },
      { name: '북구청 공원녹지과', balance: '-1,234,500원' },
    ]
    const out = clampToSms('[{매장}] {거래처} 잔액 {잔액}' + '나'.repeat(100), '샐러리아 침산점', many)
    for (const r of many) {
      expect(smsByteLength(fillTemplate(out, { store: '샐러리아 침산점', account: r.name, balance: r.balance })))
        .toBeLessThanOrEqual(SMS_BYTE_LIMIT)
    }
  })
})

describe('기본 초안은 단문 안에 들어간다', () => {
  // 2026-11-10 에 재 보니 셋 다 넘고 있었다(102·94·100바이트). 지금까지 나간 문자가
  // 전부 LMS 요금이었다는 뜻이다. 치환 때문에 눈으로는 안 보이는 길이라 테스트로 박는다.
  const store = '샐러리아 침산점'
  const worst = [{ name: '북구청 공원녹지과', balance: '-1,234,500원' }]

  for (const t of SMS_TEMPLATES) {
    it(`${t.label}`, () => {
      expect(worstCaseBytes(t.draft, store, worst).bytes).toBeLessThanOrEqual(SMS_BYTE_LIMIT)
    })
  }
})
