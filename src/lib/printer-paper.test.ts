import { describe, it, expect } from 'vitest'
import { paperChoice, effectiveLineChars, printableMM, configProblem, PAPER_CHOICES } from './printer-paper'

// 이 파일이 지키는 것: 용지 넓이 키가 바뀌어도 **기존 매장의 영수증이 안 깨지는 것.**
//
// 2026-10-22 에 '58'·'80' → '57'·'79' 로 바꿨다. 이 값은 설정에 저장돼 있어서,
// 매핑 없이 바꾸면 조회가 실패하고 목록 첫 항목(79mm)으로 떨어진다. 그러면
// 57mm 쓰던 매장의 한 줄 글자 수가 32 → 42 로 늘어나 구분선이 종이보다 길어지고
// 메뉴 표가 두 줄로 접힌다. 화면에는 아무 경고도 안 뜬다 — 그래서 테스트로 묶는다.

describe('paperChoice — 저장된 옛 키 호환', () => {
  it("옛 '80' 은 79mm 로", () => {
    const c = paperChoice('80')
    expect(c.key).toBe('79')
    expect(c.lineChars).toBe(42)
  })

  it("옛 '58' 은 57mm 로 — **79mm 로 떨어지면 안 된다**", () => {
    const c = paperChoice('58')
    expect(c.key).toBe('57')
    expect(c.lineChars).toBe(32)   // 42 가 나오면 영수증이 깨진다
  })

  it('새 키는 그대로', () => {
    expect(paperChoice('79').key).toBe('79')
    expect(paperChoice('57').key).toBe('57')
  })

  it('비어 있거나 모르는 값은 79mm (가장 흔한 쪽)', () => {
    expect(paperChoice(undefined).key).toBe('79')
    expect(paperChoice('').key).toBe('79')
    expect(paperChoice('72').key).toBe('79')
  })
})

describe('용지 치수', () => {
  it('실제 용지 넓이는 79 / 57', () => {
    expect(paperChoice('79').paperMM).toBe(79)
    expect(paperChoice('57').paperMM).toBe(57)
  })

  it('인쇄 가능 넓이는 용지 치수를 바꿔도 그대로 — 헤드가 정하는 값이다', () => {
    // 3인치 헤드는 용지가 79든 80이든 72mm 를 찍는다. 여길 같이 줄이면
    // 영수증 레이아웃이 전부 틀어진다.
    // printableMM 은 **설정**을 받는다(선택지가 아니다)
    expect(printableMM({ paperWidth: '79' })).toBe(72)
    expect(printableMM({ paperWidth: '57' })).toBe(50)
    // 옛 키로 저장돼 있어도 맞게 찾는다
    expect(printableMM({ paperWidth: '58' as never })).toBe(50)
  })

  it('선택지는 두 개, 79mm 가 먼저', () => {
    expect(PAPER_CHOICES.map(c => c.key)).toEqual(['79', '57'])
  })
})

describe('effectiveLineChars — 미세조정값', () => {
  it('범위(24~64) 안이면 그 값을 쓴다', () => {
    expect(effectiveLineChars({ paperWidth: '79', lineChars: 46 })).toBe(46)
  })

  it('범위를 벗어나면 프리셋으로 되돌린다', () => {
    // 24자 미만은 메뉴 표가 성립하지 않고, 64자 넘는 영수증 프린터는 없다
    expect(effectiveLineChars({ paperWidth: '57', lineChars: 10 })).toBe(32)
    expect(effectiveLineChars({ paperWidth: '79', lineChars: 999 })).toBe(42)
  })

  it('옛 키로 저장돼 있어도 프리셋을 맞게 찾는다', () => {
    expect(effectiveLineChars({ paperWidth: '58' as never })).toBe(32)
  })
})

describe('configProblem — 출력 대상 검사', () => {
  it('USB(OS 프린터)만 골라도 문제없다', () => {
    // 이 줄이 없을 때 USB 로 연결해 놓고도 "프린터를 아직 고르지 않았어요"가 떴다
    expect(configProblem({ link: 'usb', osPrinter: 'BIXOLON_SRP_B300II' })).toBeNull()
  })

  it('COM 포트만 골라도 문제없다', () => {
    expect(configProblem({ link: 'serial', portName: 'COM3' })).toBeNull()
  })

  it('둘 다 없으면 안내한다', () => {
    expect(configProblem({ link: 'serial' })).toMatch(/고르지 않았어요/)
    expect(configProblem({ link: 'usb', osPrinter: '   ' })).toMatch(/고르지 않았어요/)
  })

  it('랜선인데 IP 가 비었거나 형식이 틀리면 잡아준다', () => {
    expect(configProblem({ link: 'lan' })).toMatch(/IP가 비어/)
    expect(configProblem({ link: 'lan', host: '어딘가' })).toMatch(/IP 형식/)
    expect(configProblem({ link: 'lan', host: '192.168.0.50' })).toBeNull()
  })
})
