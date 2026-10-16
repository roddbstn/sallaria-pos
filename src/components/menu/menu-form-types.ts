import type { Category } from '../../lib/mock-data'

// 메뉴 추가/상세 모달이 쓰는 타입. Menus.tsx 안에만 있던 것들을 모달과 공유하려고 꺼냈다.

export type SoldOutState = 'active' | 'today' | 'permanent'

export interface MenuFormValues {
  name:           string
  price:          string   // 숫자만 담는다. 화면에는 천단위 콤마를 찍어 보여준다
  description:    string
  soldOutState:   SoldOutState
  active:         boolean
  categoryId:     string
  isPopular:      boolean
  isRecommended:  boolean
  isNew:          boolean
}

export type MenuFormCategory = Category

/** 모달이 실제로 쓰는 필드만 — Menus.tsx의 StoreOptionGroup 이 이걸 만족한다 */
export interface MenuFormOptionGroup {
  id:   string
  name: string
}
