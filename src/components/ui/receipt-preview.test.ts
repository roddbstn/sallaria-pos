import { describe, it, expect } from 'vitest'
import { buildLines, DEFAULT_RECEIPT_CONFIG, type ReceiptKind } from './ReceiptPreview'
import { sampleReceiptDisplay, type SampleMethod } from '../../lib/receipt-sample'
import { pw, LINE_CHARS } from '../../lib/receipt-layout'

// 미리보기는 **문자 격자**다. 격자가 깨지는 건 눈으로 봐야 알았는데,
// 깨지는 방식은 늘 같다 — 어떤 줄이 42칸을 넘거나, 콜론 칼럼이 흐트러진다.
// 그 둘만 지키면 "미리보기가 종이와 다르다" 는 사고의 대부분이 막힌다.

const KINDS: ReceiptKind[] = ['kitchen', 'customer']
const SIZES = ['normal', 'large'] as const

function all(kind: ReceiptKind, over: Partial<typeof DEFAULT_RECEIPT_CONFIG> = {}, method: SampleMethod = '배달') {
  return buildLines(kind, { ...DEFAULT_RECEIPT_CONFIG, ...over },
    sampleReceiptDisplay(undefined, new Date(), method))
}
const text = (l: ReturnType<typeof all>[number]) => l.segs.map(s => s.t).join('')

describe('영수증 미리보기 격자', () => {
  for (const kind of KINDS) {
    for (const menuSize of SIZES) {
      for (const showItemPrice of [true, false]) {
        it(`${kind} / 메뉴 ${menuSize} / 가격 ${showItemPrice} — 한 줄이 ${LINE_CHARS}칸을 안 넘는다`, () => {
          for (const l of all(kind, { menuSize, showItemPrice, optionSize: menuSize, amountSize: menuSize })) {
            // 2배 조각은 한 칸이 두 칸을 먹는다. 메뉴명 줄은 2배·1배가 섞인다
            const cells = l.segs.reduce((n, sg) => n + pw(sg.t) * (sg.x2 ? 2 : 1), 0)
            expect(cells).toBeLessThanOrEqual(LINE_CHARS)
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
      .filter(l => !l.segs.some(sg => sg.x2) && / : /.test(text(l)))
      .map(l => pw(text(l).slice(0, text(l).indexOf(' : '))))
    expect(cols.length).toBeGreaterThan(10)
    expect(new Set(cols).size).toBe(1)
  })

  it('예상도착시간은 주방 주문서 · 포장/내점에만 있다', () => {
    // 배달은 안 찍는다 — 손님에게 수령 시간을 묻는 자리가 없고, 점주가 고른
    // 소요시간은 주방이 다 만드는 시각일 뿐 손님에게 닿는 시각이 아니다.
    for (const m of ['포장', '내점'] as const) {
      expect(all('kitchen', {}, m).some(l => text(l).includes('예상도착시간')), m).toBe(true)
      expect(all('customer', {}, m).some(l => text(l).includes('예상도착시간')), m).toBe(false)
    }
    expect(all('kitchen', {}, '배달').some(l => text(l).includes('예상도착시간'))).toBe(false)
  })

  it('배달 주소·배달료는 배달에만 있다', () => {
    const d = all('kitchen', {}, '배달').map(text).join('\n')
    expect(d).toContain('배달주소')
    expect(d).toContain('배달료')
    for (const m of ['포장', '내점'] as const) {
      const o = all('kitchen', {}, m).map(text).join('\n')
      expect(o, m).not.toContain('배달주소')
      expect(o, m).not.toContain('배달료')
    }
  })

  it("잔액을 끄면 잔액 두 줄이 사라진다", () => {
    const off = all('kitchen', { showBalance: false }).map(text).join('\n')
    expect(off).not.toContain('주문후 잔액')
    expect(all('kitchen').map(text).join('\n')).toContain('주문후 잔액')
  })
})

describe("메뉴명 '크게' — 수량·가격을 침범하지 않는다", () => {
  const big = all('kitchen', { menuSize: 'large' })
  /** 2배 이름과 1배 수량·가격이 **같은 줄**에 있는 줄들 */
  const rows = big.filter(l => l.segs.some(s => s.x2) && l.segs.some(s => !s.x2))

  it('품목마다 그런 줄이 하나씩 있다', () => {
    expect(rows).toHaveLength(2)   // 표본 주문의 품목 수
  })

  it('이름과 수량 사이에 적어도 한 칸이 비어 있다', () => {
    for (const r of rows) {
      const tail = r.segs.find(s => !s.x2)!.t
      expect(tail.startsWith(' ')).toBe(true)
    }
  })

  it('줄이 정확히 한 줄을 채운다 — 넘치지도 모자라지도 않게', () => {
    for (const r of rows) {
      const cells = r.segs.reduce((n, s) => n + pw(s.t) * (s.x2 ? 2 : 1), 0)
      expect(cells).toBe(LINE_CHARS)
    }
  })

  it('수량·가격이 머리글과 같은 칼럼에 선다', () => {
    const header = all('kitchen').find(l => l.segs[0].t.startsWith('메뉴명'))!.segs[0].t
    for (const r of rows) {
      const nameCells = pw(r.segs.find(s => s.x2)!.t) * 2
      const tail = r.segs.find(s => !s.x2)!.t
      // 2배 이름이 먹은 칸 다음부터가 tail 이다 — 둘을 이으면 1배 한 줄과 같은 격자
      const line = ' '.repeat(nameCells) + tail
      expect(pw(line)).toBe(pw(header))
      // 가격은 오른쪽 끝에 붙는다
      expect(line.trimEnd()).toBe(line)
    }
  })
})
