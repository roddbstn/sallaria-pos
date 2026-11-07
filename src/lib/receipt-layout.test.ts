import { describe, it, expect } from 'vitest'
import {
  pw, clamp, padL, padR, center, wrapName, hr, subHr, nameWidth,
  LINE_CHARS, PRINT_MM, LINE_RATIO, LABEL_W, field,
} from './receipt-layout'

// ⚠️ 이 테스트는 electron/escpos.ts 와 **같은 결과**를 내는지 지킨다.
//    미리보기가 종이와 달라지는 건 대부분 여기가 갈라져서 생긴다.

describe('receipt-layout — 실측 치수', () => {
  it('79mm 프리셋 값을 그대로 쓴다', () => {
    expect(PRINT_MM).toBe(72)
    expect(LINE_CHARS).toBe(42)
  })

  it('글자 한 칸은 1.71mm, 한글은 그 두 배', () => {
    expect(PRINT_MM / LINE_CHARS).toBeCloseTo(1.714, 3)
  })

  it('줄높이 비율은 ESC/POS 기본 줄간격 ÷ Font A 높이', () => {
    // 1/6인치 = 4.233mm, 24도트 @203dpi = 3.0mm
    expect(LINE_RATIO).toBeCloseTo(4.233 / 3.0, 1)
  })
})

describe('pw — 인쇄 폭', () => {
  it('한글은 2칸, ASCII 는 1칸', () => {
    expect(pw('가')).toBe(2)
    expect(pw('a')).toBe(1)
    expect(pw('목살 샐러드')).toBe(11)   // 한글5×2 + 공백1
  })
})

describe('정렬', () => {
  it('padL/padR 은 글자 수가 아니라 인쇄 폭으로 센다', () => {
    expect(padL('가', 5)).toBe('가   ')     // 2칸 먹고 3칸 채움
    expect(padR('가', 5)).toBe('   가')
  })

  it('center 는 남는 폭의 절반을 앞에 둔다', () => {
    expect(center('abc', 9)).toBe('   abc')
  })

  it('이미 꽉 찬 문자열은 안 건드린다', () => {
    expect(padL('abcde', 5)).toBe('abcde')
    expect(padR('abcde', 3)).toBe('abcde')
  })
})

describe('clamp / wrapName', () => {
  it('clamp 는 한글이 경계에 걸리면 그 글자를 버린다', () => {
    expect(clamp('가나다', 5)).toBe('가나')   // 6칸이라 5에 못 들어간다
  })

  it('짧으면 한 줄 그대로', () => {
    expect(wrapName('가나', 10)).toEqual(['가나'])
  })
})

describe('구분선', () => {
  it('hr 은 한 줄을 꽉 채운다', () => {
    expect(hr()).toHaveLength(LINE_CHARS)
  })

  it("subHr 은 '- ' 반복이고 길이는 같다", () => {
    expect(subHr()).toHaveLength(LINE_CHARS)
    expect(subHr(6)).toBe('- - - ')
  })
})

describe('nameWidth', () => {
  it('메뉴명 칸 = 전체 − 수량4 − 간격2 − 가격10', () => {
    expect(nameWidth()).toBe(LINE_CHARS - 16)
  })
})

describe('field — 라벨 칼럼', () => {
  it("가장 긴 라벨('주문전 잔액')도 11칸에 들어간다", () => {
    expect(pw('주문전 잔액')).toBe(LABEL_W)
  })

  it('라벨 길이가 달라도 콜론 위치가 같다', () => {
    const lines = [
      field('주문번호', '11610'),
      field('주문자', '김*보'),
      field('선결제계정', '북구청 정보통신과'),
      field('주문전 잔액', '711,800원'),
    ]
    const cols = lines.map(l => pw(l.slice(0, l.indexOf(':'))))
    expect(new Set(cols).size).toBe(1)
  })
})

describe('wrapName — 띄어쓰기에서 끊는다', () => {
  it('낱자 한 글자가 다음 줄로 떨어지지 않는다', () => {
    // 26칸(기본 메뉴명 칼럼)에 27칸짜리 이름
    expect(wrapName('수비드 통삼겹 단백질 도시락', 26))
      .toEqual(['수비드 통삼겹 단백질', '도시락'])
  })

  it("'크게'(2배)라 칸이 절반일 때도 단어 단위로 끊는다", () => {
    expect(wrapName('닭가슴살 단백질 도시락', 21))
      .toEqual(['닭가슴살 단백질', '도시락'])
  })

  it('띄어쓰기가 없으면 칸 수로 끊는다', () => {
    expect(wrapName('가나다라', 4)).toEqual(['가나', '다라'])
  })

  it('끊고 남은 쪽이 한 줄보다 길면 거기서 또 끊는다', () => {
    for (const l of wrapName('가 나다라마바사아자차카타파하', 6)) {
      expect(pw(l)).toBeLessThanOrEqual(6)
    }
  })
})
