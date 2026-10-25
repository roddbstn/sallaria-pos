import { describe, it, expect } from 'vitest'
import { parseNote, won } from './ipc'

// parseNote 가 지키는 것: 주문 영수증과 주문 카드의 **배달 주소**.
//
// orders.note 하나에 '[배달주소] …', '[배달상세] …', '[배달요청] …' 과
// 손님이 쓴 가게 요청사항이 ' / ' 로 이어붙어 들어온다. 이걸 잘못 쪼개면
// 배달 기사에게 주소가 안 가거나, 요청사항 자리에 주소가 찍힌다.
// 눈으로는 "그럴듯해 보여서" 못 잡는 종류라 테스트로 고정한다.

describe('parseNote — 배달 정보와 요청사항 분리', () => {
  it('비어 있으면 전부 null', () => {
    for (const v of [null, undefined, '']) {
      const r = parseNote(v)
      expect(r.deliveryAddress).toBeNull()
      expect(r.customerNote).toBeNull()
    }
  })

  it('세 가지 배달 태그를 각각 집어낸다', () => {
    const r = parseNote('[배달주소] 대구 북구 침산로 100 / [배달상세] 3층 301호 / [배달요청] 문 앞에 두세요')
    expect(r.deliveryAddress).toBe('대구 북구 침산로 100')
    expect(r.deliveryDetail).toBe('3층 301호')
    expect(r.deliveryNote).toBe('문 앞에 두세요')
    expect(r.customerNote).toBeNull()      // 배달 태그만 있으면 요청사항은 없다
  })

  it('태그 없는 조각은 전부 가게 요청사항으로 합친다', () => {
    // 요청 칩('수저·포크 O')이든 손님이 직접 쓴 글이든 구분 없이 한 칸으로 간다.
    const r = parseNote('수저·포크 O / 덜 맵게')
    expect(r.customerNote).toBe('수저·포크 O, 덜 맵게')
    expect(r.deliveryAddress).toBeNull()
  })

  it('배달 태그와 요청사항이 섞여 있어도 갈라낸다', () => {
    const r = parseNote('[배달주소] 침산로 100 / 수저 빼주세요 / [배달상세] 301호')
    expect(r.deliveryAddress).toBe('침산로 100')
    expect(r.deliveryDetail).toBe('301호')
    expect(r.customerNote).toBe('수저 빼주세요')
  })

  it('포장·내점 주문(배달 태그 없음)은 주소가 null 이어야 한다', () => {
    // 여기가 null 이 아니면 포장 주문 영수증에 엉뚱한 주소가 찍힌다.
    const r = parseNote('컵 2개 주세요')
    expect(r.deliveryAddress).toBeNull()
    expect(r.deliveryDetail).toBeNull()
    expect(r.deliveryNote).toBeNull()
  })

  it('주소에 " / " 가 들어가는 건 지원하지 않는다 (알려진 한계)', () => {
    // 구분자가 ' / ' 라서 주소 안에 같은 문자열이 있으면 잘린다.
    // 실제 도로명주소에 ' / ' 가 들어가는 경우는 없어서 지금은 괜찮다.
    // 상세주소에 손님이 '3층 / 301호' 라고 쓰면 뒤가 요청사항으로 넘어간다.
    const r = parseNote('[배달상세] 3층 / 301호')
    expect(r.deliveryDetail).toBe('3층')
    expect(r.customerNote).toBe('301호')   // 의도된 결과가 아니라 **현재 동작**의 기록
  })
})

describe('won — 금액 표시', () => {
  it('천 단위 쉼표 + "원"', () => {
    expect(won(0)).toBe('0원')
    expect(won(9900)).toBe('9,900원')
    expect(won(1234567)).toBe('1,234,567원')
  })

  it('음수도 표시된다 — 잔액 음수 허용(비즈니스 룰 4)', () => {
    expect(won(-5000)).toBe('-5,000원')
  })
})
