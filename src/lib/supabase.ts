import { createClient } from '@supabase/supabase-js'

const URL  = import.meta.env.VITE_SUPABASE_URL  as string
const ANON = import.meta.env.VITE_SUPABASE_ANON as string

export const supabase = createClient(URL, ANON)

// ── DB 행 타입 ────────────────────────────────────────────────────────────────

export interface DbAccount {
  account_code:      string
  account_number:    number
  account_name:      string
  /** 매장이 자유롭게 생성/개명하는 고객 유형 — stores.customer_types(최대 6개)의 값 중 하나 */
  account_type:      string
  pin_code:          string
  pin_encrypted:     string | null
  organization_name: string | null
  contact_person:    string | null
  contact_phone:     string | null
  business_number:   string | null
  current_balance:   number
  warning_threshold: number
  memo:              string | null
  is_active:         boolean
  created_at:        string
  qr_system:         'legacy' | 'kakao'
  /** 가장 최근 선결제(충전) 기준 유효기간 — 자동 만료 처리는 없고 점주가 눈으로 확인하는 용도 */
  prepay_validity:   'none' | '6m' | '1y' | '2y'
}

export interface DbOrder {
  order_code:    string
  order_number:  string
  account_code:  string
  orderer_name:  string
  orderer_phone: string | null
  ordered_at:    string
  menu_subtotal: number
  delivery_fee:  number
  total_amount:  number
  balance_before: number
  balance_after:  number
  method:        '포장' | '내점' | '배달'
  status:        '주문완료' | '조리중' | '완료' | '취소'
  note:          string | null
  accounts?:     { account_name: string } | null
  order_items?:  DbOrderItem[]
}

export interface DbOrderItem {
  order_item_id: string
  menu_id:       string
  menu_name:     string
  quantity:      number
  unit_price:    number
  subtotal:      number
  order_item_options?: DbOrderItemOption[]
}

export interface DbOrderItemOption {
  id:            string
  option_item_id: string
  option_name:   string
  extra_price:   number
}

export interface DbMenu {
  id:            string
  category_id:   string
  name:          string
  description:   string | null
  base_price:    number
  image_url:     string | null
  is_popular:    boolean
  is_sold_out:   boolean
  is_hidden:     boolean
  display_order: number
}

export interface DbCategory {
  id:            string
  store_id:      string
  name:          string
  display_order: number
  is_active:     boolean
}

export interface DbOptionGroup {
  id:            string
  store_id:      string
  name:          string
  description:   string | null
  is_required:   boolean
  is_multi:      boolean
  min_select:    number
  max_select:    number | null
  display_order: number
  option_items?: DbOptionItem[]
}

export interface DbOptionItem {
  id:              string
  option_group_id: string
  name:            string
  extra_price:     number
  is_popular:      boolean
  is_sold_out:     boolean
  is_hidden:       boolean
  display_order:   number
}

export interface DbDeposit {
  deposit_id:      string
  account_code:    string
  amount:          number
  note:            string | null
  payment_method:  string
  balance_after:   number
  created_at:      string
}

export interface DbStore {
  id:                  string
  client_id:           string
  name:                string
  address:             string | null
  phone:               string | null
  representative_name: string | null
  customer_types:      string[]
  road_address:        string | null
  address_detail:      string | null
  lat:                 number | null
  lng:                 number | null
}

export interface DbClient {
  id:            string
  auth_user_id:  string
  business_name: string
  owner_name:    string | null
  contact_phone: string | null
  contact_email: string | null
  address:       string | null
  business_type: string | null
  is_active:     boolean
}
