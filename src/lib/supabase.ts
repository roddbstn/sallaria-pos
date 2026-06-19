import { createClient } from '@supabase/supabase-js'

const URL  = import.meta.env.VITE_SUPABASE_URL  as string
const ANON = import.meta.env.VITE_SUPABASE_ANON as string

export const supabase = createClient(URL, ANON)

// ── DB 행 타입 ────────────────────────────────────────────────────────────────

export interface DbAccount {
  account_code:      string
  account_number:    number
  account_name:      string
  account_type:      '과' | '기업' | '개인' | '기타'
  pin_code:          string
  organization_name: string | null
  contact_person:    string | null
  contact_phone:     string | null
  current_balance:   number
  warning_threshold: number
  memo:              string | null
  is_active:         boolean
  created_at:        string
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
  deposit_id:   string
  account_code: string
  amount:       number
  note:         string | null
  created_at:   string
}

export interface DbStore {
  id:        string
  client_id: string
  name:      string
  address:   string | null
  phone:     string | null
}

export interface DbClient {
  id:            string
  auth_user_id:  string
  business_name: string
  owner_name:    string | null
  contact_phone: string | null
  contact_email: string | null
  address:       string | null
  is_active:     boolean
}
