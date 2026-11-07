import { describe, it, expect } from 'vitest'
import { buildLines, DEFAULT_RECEIPT_CONFIG, type ReceiptKind } from './ReceiptPreview'
import { pw, LINE_CHARS } from '../../lib/receipt-layout'

// 미리보기는 **문자 격자**다. 격자가 깨지는 건 눈으로 봐야 알았는데,
// 깨지는 방식은 늘 같다 — 어떤 줄이 42칸을 넘거나, 콜론 칼럼이 흐트러진다.
// 그 둘만 지키면 "미리보기가 종이와 다르다" 는 사고의 대부분이 막힌다.

const KINDS: ReceiptKind[] = ['kitchen', 'customer']
const SIZES = ['normal', 'large'] as const

function all(kind: ReceiptKind, over: Partial<typeof DEFAULT_RECEIPT_CONFIG> = {}) {
  return buildLines(kind, { ...DEFAULT_RECEIPT_CONFIG, ...over })
}
const text = (l: ReturnType<typeof all>[number]) => l.segs.map(s => s.t).join('')

describe('영수증 미리보기 격자', () => {
  for (const kind of KINDS) {
    for (const menuSize of SIZES) {
      for (const showItemPrice of [true, false]) {
        it(`${kind} / 메뉴 ${menuSize} / 가격 ${showItemPrice} — 한 줄이 ${LINE_CHARS}칸을 안 넘는다`, () => {
          for (const l of all(kind, { menuSize, showItemPrice, optionSize: menuSize, amountSize: menuSize })) {
            // 2배 줄은 한 칸이 두 칸을 먹는다
            expect(pw(text(l)) * (l.x2 ? 2 : 1)).toBeLessThanOrEqual(LINE_CHARS)
          }
        })
      }
    }
  }

  it('구분선은 한 줄을 꽉 채운다', () => {
    const hrs = all('kitchen').filter(l => /^-+$/.test(text(l)))
    expect(hrs.length).toBeGreaterThan(5)
    for (const l of hrs) expect(text(l)).toHaveLength(LINE_CHARS)
  })

  it("'라벨 : 값' 줄은 콜론이 모두 같은 칼럼에 선다", () => {
    const cols = all('kitchen')
      .filter(l => !l.x2 && / : /.test(text(l)))
      .map(l => pw(text(l).slice(0, text(l).indexOf(' : '))))
    expect(cols.length).toBeGreaterThan(10)
    expect(new Set(cols).size).toBe(1)
  })

  it('예상도착시간은 주방 주문서에만 있다', () => {
    expect(all('kitchen').some(l => text(l).includes('예상도착시간'))).toBe(true)
    expect(all('customer').some(l => text(l).includes('예상도착시간'))).toBe(false)
  })

  it("잔액을 끄면 잔액 두 줄이 사라진다", () => {
    const off = all('kitchen', { showBalance: false }).map(text).join('\n')
    expect(off).not.toContain('주문후 잔액')
    expect(all('kitchen').map(text).join('\n')).toContain('주문후 잔액')
  })
})
