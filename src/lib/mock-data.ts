// ── 목업 데이터 (Supabase 연동 전 와이어프레임용) ─────────────────────────────

export type OrderStatus = '주문완료' | '조리중' | '완료' | '취소'
export type Method      = '포장' | '매장 식사' | '배달'
export type AccountType = '과' | '기업' | '개인' | '기타'

export interface OrderItemOptionDetail {
  name:       string
  extraPrice: number
  groupName?: string   // option_groups.name (가격(필수) 처리용)
}

export interface OrderItem {
  name:          string
  qty:           number
  price:         number
  options:       string[]
  optionDetails?: OrderItemOptionDetail[]
  imageUrl?:     string
}

export interface Order {
  code:          string
  orderNumber?:  string   // 주문번호 (예: "1101", "1201")
  accountName:   string
  orderer:       string
  phone?:        string   // 주문자 연락처
  method:        Method
  status:        OrderStatus
  items:         OrderItem[]
  total:         number
  prepMins:      number   // 승인 시 설정한 소요시간
  createdAt:     string
  remarks:       string
  balanceBefore?: number  // 주문 전 잔액
  balanceAfter?:  number  // 주문 후 잔액
  isDeleted?:     boolean // 소프트 삭제
}

export interface Account {
  code:     string
  name:     string
  type:     AccountType
  org:      string
  manager:  string
  phone:    string
  pin:      string   // 마스킹 표시용
  balance:  number
  monthlyUsage: number
  warnThreshold: number
}

export interface Category {
  id:           string
  name:         string
  displayOrder: number
}

export interface Menu {
  code:       string
  name:       string
  categoryId: string | null   // null = 카테고리 미지정
  price:      number
  emoji:      string
  active:     boolean
  soldOut:    boolean
  order:      number
}

export interface MenuOption {
  id:       string
  menuCode: string
  group:    string
  name:     string
  extra:    number
  soldOut:  boolean
  hidden:   boolean
}

export interface OptionItem {
  id:        string
  name:      string
  extra:     number
  soldOut:   boolean
  hidden:    boolean
  isPopular: boolean
}

export interface OptionGroup {
  id:         string
  name:       string
  isRequired: boolean
  isMulti:    boolean
  maxSelect:  number | null
  items:      OptionItem[]
}

export interface MenuDetail extends Menu {
  description:  string
  imageUrl?:    string
  optionGroups: OptionGroup[]
}

// ── 주문 목업 ─────────────────────────────────────────────────────────────────
export const MOCK_ORDERS: Order[] = [
  // ── 5월 목업 ──
  {
    code: 'ORD-M01', accountName: '북구청 공원녹지과', orderer: '김민준', phone: '010-1234-5678',
    method: '포장', status: '완료', prepMins: 15,
    items: [{ name: '단호박 샐러드', qty: 2, price: 9500, options: ['레몬 드레싱'] }],
    total: 19000, createdAt: '2026-05-28T11:30:00', remarks: '',
  },
  {
    code: 'ORD-M02', accountName: 'KT 침산지점', orderer: '이서연', phone: '010-3456-7890',
    method: '매장 식사', status: '완료', prepMins: 10,
    items: [{ name: '그릭 샐러드', qty: 1, price: 9000, options: [] }, { name: '아사이 볼', qty: 1, price: 11000, options: [] }],
    total: 20000, createdAt: '2026-05-28T12:15:00', remarks: '',
  },
  {
    code: 'ORD-M03', accountName: '북부경찰서 교통과', orderer: '박지호', phone: '010-4567-8901',
    method: '배달', status: '완료', prepMins: 20,
    items: [{ name: '연어 포케', qty: 1, price: 12000, options: ['현미밥', '아보카도 추가'] }],
    total: 15500, createdAt: '2026-05-29T11:55:00', remarks: '',
  },
  {
    code: 'ORD-M04', accountName: '북구청 건설과', orderer: '최수아', phone: '010-2345-6789',
    method: '포장', status: '완료', prepMins: 15,
    items: [{ name: '닭가슴살 샐러드', qty: 2, price: 10500, options: [] }],
    total: 21000, createdAt: '2026-05-29T12:20:00', remarks: '드레싱 따로',
  },
  {
    code: 'ORD-M05', accountName: '김다현', orderer: '김다현', phone: '010-5678-9012',
    method: '포장', status: '취소', prepMins: 0,
    items: [{ name: '단호박 샐러드', qty: 1, price: 9500, options: ['시저 드레싱'] }],
    total: 9500, createdAt: '2026-05-30T11:10:00', remarks: '',
  },
  {
    code: 'ORD-M06', accountName: '북구청 공원녹지과', orderer: '김민준', phone: '010-1234-5678',
    method: '포장', status: '완료', prepMins: 15,
    items: [{ name: '치킨텐더 랩', qty: 2, price: 8500, options: ['멕시칸 스파이시 소스'] }],
    total: 17000, createdAt: '2026-05-30T12:05:00', remarks: '',
  },
  {
    code: 'ORD-M07', accountName: 'KT 침산지점', orderer: '이서연', phone: '010-3456-7890',
    method: '매장 식사', status: '완료', prepMins: 10,
    items: [{ name: '그릭 샐러드', qty: 1, price: 9000, options: [] }],
    total: 9000, createdAt: '2026-05-31T12:30:00', remarks: '',
  },
  {
    code: 'ORD-M08', accountName: '북부경찰서 교통과', orderer: '박지호', phone: '010-4567-8901',
    method: '포장', status: '완료', prepMins: 15,
    items: [{ name: '단호박 샐러드', qty: 1, price: 9500, options: [] }, { name: '닭가슴살 샐러드', qty: 1, price: 10500, options: [] }],
    total: 20000, createdAt: '2026-05-31T11:45:00', remarks: '',
  },
  // ── 6월 초순 목업 ──
  {
    code: 'ORD-J01', accountName: '북구청 건설과', orderer: '최수아', phone: '010-2345-6789',
    method: '포장', status: '완료', prepMins: 15,
    items: [{ name: '단호박 샐러드', qty: 1, price: 9500, options: [] }],
    total: 9500, createdAt: '2026-06-02T11:30:00', remarks: '',
  },
  {
    code: 'ORD-J02', accountName: 'KT 침산지점', orderer: '이서연', phone: '010-3456-7890',
    method: '매장 식사', status: '완료', prepMins: 10,
    items: [{ name: '연어 포케', qty: 1, price: 12000, options: ['현미밥'] }, { name: '그릭 샐러드', qty: 1, price: 9000, options: [] }],
    total: 21000, createdAt: '2026-06-03T12:10:00', remarks: '',
  },
  {
    code: 'ORD-J03', accountName: '북구청 공원녹지과', orderer: '김민준', phone: '010-1234-5678',
    method: '배달', status: '완료', prepMins: 20,
    items: [{ name: '치킨텐더 랩', qty: 3, price: 8500, options: ['멕시칸 스파이시 소스'] }],
    total: 29000, createdAt: '2026-06-05T12:00:00', remarks: '소스 많이',
  },
  {
    code: 'ORD-J04', accountName: '김다현', orderer: '김다현', phone: '010-5678-9012',
    method: '포장', status: '완료', prepMins: 10,
    items: [{ name: '아사이 볼', qty: 1, price: 11000, options: [] }],
    total: 11000, createdAt: '2026-06-10T11:50:00', remarks: '',
  },
  {
    code: 'ORD-J05', accountName: '북부경찰서 교통과', orderer: '박지호', phone: '010-4567-8901',
    method: '포장', status: '완료', prepMins: 15,
    items: [{ name: '닭가슴살 샐러드', qty: 2, price: 10500, options: [] }],
    total: 21000, createdAt: '2026-06-12T12:20:00', remarks: '드레싱 따로',
  },
  {
    code: 'ORD-001', accountName: '북구청 공원녹지과', orderer: '김민준', phone: '010-1234-5678',
    method: '포장', status: '주문완료', prepMins: 15,
    items: [
      { name: '단호박 샐러드', qty: 1, price: 9500, options: ['레몬 드레싱'] },
      { name: '치킨텐더 랩',  qty: 1, price: 8500, options: ['멕시칸 스파이시 소스'] },
    ],
    total: 18000, createdAt: '2026-06-14T12:05:00', remarks: '소스 많이',
  },
  {
    code: 'ORD-002', accountName: 'KT 침산지점', orderer: '이서연', phone: '010-3456-7890',
    method: '매장 식사', status: '주문완료', prepMins: 10,
    items: [
      { name: '그릭 샐러드', qty: 2, price: 9000, options: ['올리브 추가'] },
    ],
    total: 18000, createdAt: '2026-06-14T12:08:00', remarks: '',
  },
  {
    code: 'ORD-003', accountName: '북부경찰서 교통과', orderer: '박지호', phone: '010-4567-8901',
    method: '배달', status: '조리중', prepMins: 20,
    items: [
      { name: '연어 포케', qty: 1, price: 12000, options: ['현미밥', '아보카도 추가'] },
    ],
    total: 15500, createdAt: '2026-06-14T11:55:00', remarks: '',
  },
  {
    code: 'ORD-004', accountName: '북구청 건설과', orderer: '최수아', phone: '010-2345-6789',
    method: '포장', status: '완료', prepMins: 15,
    items: [
      { name: '닭가슴살 샐러드', qty: 1, price: 10500, options: [] },
    ],
    total: 10500, createdAt: '2026-06-14T11:30:00', remarks: '드레싱 따로',
  },
  {
    code: 'ORD-005', accountName: '김다현', orderer: '김다현', phone: '010-5678-9012',
    method: '포장', status: '취소', prepMins: 0,
    items: [
      { name: '단호박 샐러드', qty: 1, price: 9500, options: ['시저 드레싱'] },
    ],
    total: 9500, createdAt: '2026-06-14T11:10:00', remarks: '',
  },
]

// ── 거래처 목업 ───────────────────────────────────────────────────────────────
export const MOCK_ACCOUNTS: Account[] = [
  { code: 'A001', name: '북구청 공원녹지과', type: '과', org: '북구청',    manager: '김민준', phone: '010-1234-5678', pin: '1234', balance: 223400, monthlyUsage: 87500, warnThreshold: 30000 },
  { code: 'A002', name: '북구청 건설과',     type: '과', org: '북구청',    manager: '최수아', phone: '010-2345-6789', pin: '2345', balance: 415000, monthlyUsage: 35000, warnThreshold: 30000 },
  { code: 'A003', name: 'KT 침산지점',       type: '기업', org: 'KT',      manager: '이서연', phone: '010-3456-7890', pin: '3456', balance: 87000,  monthlyUsage: 63000, warnThreshold: 50000 },
  { code: 'A004', name: '북부경찰서 교통과', type: '과',  org: '북부경찰서', manager: '박지호', phone: '010-4567-8901', pin: '4567', balance: 12500,  monthlyUsage: 42000, warnThreshold: 30000 },
  { code: 'A005', name: '김다현',            type: '개인', org: '',          manager: '김다현', phone: '010-5678-9012', pin: '5678', balance: 45000,  monthlyUsage: 15000, warnThreshold: 20000 },
]

// ── 카테고리 목업 ─────────────────────────────────────────────────────────────
// 웹 주문 페이지에 표시되는 카테고리 탭 목록 (displayOrder 순)
export const MOCK_CATEGORIES: Category[] = [
  { id: 'C1', name: '포케',      displayOrder: 1 },
  { id: 'C2', name: '샐러드',    displayOrder: 2 },
  { id: 'C3', name: '랩·샌드위치', displayOrder: 3 },
  { id: 'C4', name: '도시락',    displayOrder: 4 },
  { id: 'C5', name: '음료',      displayOrder: 5 },
]

// ── 메뉴 목업 (레거시 — Menus 페이지는 MOCK_MENU_DETAILS 사용) ────────────────
export const MOCK_MENUS: Menu[] = [
  { code: 'M001', name: '단호박 샐러드',   categoryId: null, price: 9500,  emoji: '🥗', active: true,  soldOut: false, order: 1 },
  { code: 'M002', name: '치킨텐더 랩',    categoryId: null, price: 8500,  emoji: '🌯', active: true,  soldOut: false, order: 2 },
  { code: 'M003', name: '그릭 샐러드',    categoryId: null, price: 9000,  emoji: '🥗', active: true,  soldOut: false, order: 3 },
  { code: 'M004', name: '연어 포케',      categoryId: null, price: 12000, emoji: '🍱', active: true,  soldOut: true,  order: 4 },
  { code: 'M005', name: '닭가슴살 샐러드', categoryId: null, price: 10500, emoji: '🥗', active: true,  soldOut: false, order: 5 },
  { code: 'M006', name: '아사이 볼',      categoryId: null, price: 11000, emoji: '🍇', active: false, soldOut: false, order: 6 },
]

// ── 신규 주문 팝업용 목업 ─────────────────────────────────────────────────────
export const MOCK_NEW_ORDER: Order = {
  code: 'ORD-NEW', accountName: '북구청 공원녹지과', orderer: '홍길동', phone: '010-9999-1234',
  method: '포장', status: '주문완료', prepMins: 0,
  items: [
    { name: '단호박 샐러드', qty: 1, price: 9500, options: ['레몬 드레싱', '아보카도 추가'] },
    { name: '치킨텐더 랩',  qty: 2, price: 8500, options: ['멕시칸 스파이시 소스'] },
  ],
  total: 26500, createdAt: new Date().toISOString(), remarks: '포크 많이',
  balanceBefore: 223400, balanceAfter: 196900,
}

export const MOCK_NEW_ORDER_2: Order = {
  code: 'ORD-NEW2', accountName: 'KT 침산지점', orderer: '이서연', phone: '010-3456-7890',
  method: '매장 식사', status: '주문완료', prepMins: 0,
  items: [
    { name: '그릭 샐러드', qty: 2, price: 9000, options: ['올리브 추가'] },
    { name: '아사이 볼',   qty: 1, price: 11000, options: [] },
  ],
  total: 29000, createdAt: new Date().toISOString(), remarks: '',
  balanceBefore: 87000, balanceAfter: 58000,
}

// ── 메뉴 상세 목업 (옵션 그룹 포함) ──────────────────────────────────────────
export const MOCK_MENU_DETAILS: MenuDetail[] = [
  {
    code: 'M001', name: '클래식 포케', categoryId: null,
    price: 11500, emoji: '🥗', active: true, soldOut: false, order: 1,
    description: '연어, 아보카도, 옥수수가 들어간 기본 포케볼',
    optionGroups: [
      {
        id: 'OG1', name: '베이스', isRequired: true, isMulti: false, maxSelect: null,
        items: [
          { id: 'OI1', name: '현미밥',       extra: 0, soldOut: false, hidden: false, isPopular: true  },
          { id: 'OI2', name: '메밀면',       extra: 0, soldOut: false, hidden: false, isPopular: false },
          { id: 'OI3', name: '샐러드 베이스', extra: 0, soldOut: true,  hidden: false, isPopular: false },
        ],
      },
      {
        id: 'OG2', name: '가격 (용량)', isRequired: true, isMulti: false, maxSelect: null,
        items: [
          { id: 'OI4', name: '100g', extra: 0,    soldOut: false, hidden: false, isPopular: false },
          { id: 'OI5', name: '200g', extra: 3000, soldOut: false, hidden: false, isPopular: false },
        ],
      },
      {
        id: 'OG3', name: '드레싱 (기본)', isRequired: true, isMulti: false, maxSelect: null,
        items: [
          { id: 'OI6', name: '오리엔탈', extra: 0, soldOut: false, hidden: false, isPopular: true  },
          { id: 'OI7', name: '발사믹',   extra: 0, soldOut: false, hidden: false, isPopular: false },
          { id: 'OI8', name: '시저',     extra: 0, soldOut: false, hidden: false, isPopular: false },
        ],
      },
      {
        id: 'OG4', name: '토핑 추가', isRequired: false, isMulti: true, maxSelect: 3,
        items: [
          { id: 'OI9',  name: '아보카도 추가', extra: 1500, soldOut: false, hidden: false, isPopular: true  },
          { id: 'OI10', name: '새우 추가',     extra: 2000, soldOut: false, hidden: false, isPopular: false },
          { id: 'OI11', name: '연어 추가',     extra: 2500, soldOut: false, hidden: false, isPopular: false },
          { id: 'OI12', name: '베이컨',        extra: 1000, soldOut: false, hidden: false, isPopular: false },
        ],
      },
    ],
  },
  {
    code: 'M002', name: '매콤 치킨 포케', categoryId: null,
    price: 12000, emoji: '🌶️', active: true, soldOut: false, order: 2,
    description: '매콤한 양념에 버무린 닭다리살 포케',
    optionGroups: [
      {
        id: 'OG1', name: '베이스', isRequired: true, isMulti: false, maxSelect: null,
        items: [
          { id: 'OI1', name: '현미밥', extra: 0, soldOut: false, hidden: false, isPopular: true  },
          { id: 'OI2', name: '메밀면', extra: 0, soldOut: false, hidden: false, isPopular: false },
        ],
      },
      {
        id: 'OG2', name: '가격 (용량)', isRequired: true, isMulti: false, maxSelect: null,
        items: [
          { id: 'OI4', name: '100g', extra: 0,    soldOut: false, hidden: false, isPopular: false },
          { id: 'OI5', name: '200g', extra: 3000, soldOut: false, hidden: false, isPopular: false },
        ],
      },
      {
        id: 'OG4', name: '토핑 추가', isRequired: false, isMulti: true, maxSelect: 3,
        items: [
          { id: 'OI9',  name: '아보카도 추가', extra: 1500, soldOut: false, hidden: false, isPopular: true  },
          { id: 'OI12', name: '베이컨',        extra: 1000, soldOut: false, hidden: false, isPopular: false },
        ],
      },
    ],
  },
  {
    code: 'M003', name: '시저 샐러드', categoryId: null,
    price: 9900, emoji: '🥗', active: true, soldOut: false, order: 3,
    description: '로메인, 파마산, 크루통과 시저 드레싱',
    optionGroups: [
      {
        id: 'OG3', name: '드레싱', isRequired: true, isMulti: false, maxSelect: null,
        items: [
          { id: 'OI8', name: '시저',     extra: 0, soldOut: false, hidden: false, isPopular: true  },
          { id: 'OI6', name: '오리엔탈', extra: 0, soldOut: false, hidden: false, isPopular: false },
          { id: 'OI7', name: '발사믹',   extra: 0, soldOut: false, hidden: false, isPopular: false },
        ],
      },
      {
        id: 'OG5', name: '추가 토핑', isRequired: false, isMulti: true, maxSelect: null,
        items: [
          { id: 'OI13', name: '닭가슴살 추가', extra: 2000, soldOut: false, hidden: false, isPopular: true  },
          { id: 'OI9',  name: '아보카도 추가', extra: 1500, soldOut: false, hidden: false, isPopular: false },
        ],
      },
    ],
  },
  {
    code: 'M004', name: '그릭 샐러드', categoryId: null,
    price: 10500, emoji: '🫙', active: true, soldOut: false, order: 4,
    description: '페타치즈, 올리브, 토마토의 지중해식 샐러드',
    optionGroups: [
      {
        id: 'OG5', name: '추가 토핑', isRequired: false, isMulti: true, maxSelect: null,
        items: [
          { id: 'OI13', name: '닭가슴살 추가', extra: 2000, soldOut: false, hidden: false, isPopular: false },
        ],
      },
    ],
  },
  {
    code: 'M005', name: '베이컨 에그 랩', categoryId: null,
    price: 8400, emoji: '🌯', active: true, soldOut: false, order: 5,
    description: '바삭한 베이컨과 스크램블 에그',
    optionGroups: [
      {
        id: 'OG6', name: '음료 추가', isRequired: false, isMulti: false, maxSelect: null,
        items: [
          { id: 'OI14', name: '아메리카노 추가', extra: 2000, soldOut: false, hidden: false, isPopular: false },
          { id: 'OI15', name: '제로콜라 추가',   extra: 1500, soldOut: false, hidden: false, isPopular: false },
        ],
      },
    ],
  },
  {
    code: 'M006', name: '닭갈비 도시락', categoryId: null,
    price: 11000, emoji: '🍱', active: true, soldOut: false, order: 6,
    description: '매콤한 닭갈비와 잡곡밥',
    optionGroups: [
      {
        id: 'OG7', name: '매운맛', isRequired: true, isMulti: false, maxSelect: null,
        items: [
          { id: 'OI16', name: '순한맛', extra: 0, soldOut: false, hidden: false, isPopular: false },
          { id: 'OI17', name: '보통',   extra: 0, soldOut: false, hidden: false, isPopular: true  },
          { id: 'OI18', name: '매운맛', extra: 0, soldOut: false, hidden: false, isPopular: false },
        ],
      },
    ],
  },
  {
    code: 'M007', name: '제육 도시락', categoryId: null,
    price: 10500, emoji: '🍱', active: true, soldOut: false, order: 7,
    description: '잘 익은 제육볶음과 잡곡밥',
    optionGroups: [],
  },
  {
    code: 'M008', name: '아메리카노', categoryId: null,
    price: 2500, emoji: '☕', active: true, soldOut: false, order: 8,
    description: '깔끔한 에스프레소 베이스',
    optionGroups: [
      {
        id: 'OG8', name: '온도', isRequired: true, isMulti: false, maxSelect: null,
        items: [
          { id: 'OI19', name: '아이스', extra: 0, soldOut: false, hidden: false, isPopular: true  },
          { id: 'OI20', name: '핫',     extra: 0, soldOut: false, hidden: false, isPopular: false },
        ],
      },
    ],
  },
  {
    code: 'M009', name: '제로콜라', categoryId: null,
    price: 2000, emoji: '🥤', active: true, soldOut: false, order: 9,
    description: '시원하게 제공',
    optionGroups: [],
  },
  {
    code: 'M010', name: '햄 치즈 샌드위치', categoryId: null,
    price: 7900, emoji: '🥪', active: false, soldOut: false, order: 10,
    description: '클래식 햄과 체다 치즈',
    optionGroups: [],
  },
]
