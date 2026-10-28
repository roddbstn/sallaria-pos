import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { won } from '../lib/ipc'
import { type MenuDetail, type Category } from '../lib/mock-data'
import { mapMenuRow } from '../lib/mappers'
import ModalOverlay from './ui/ModalOverlay'
import DaumPostcodeEmbed from './DaumPostcodeEmbed'
import ConfirmDialog from './ui/ConfirmDialog'

// ── 구두주문 받기 — 전화/현장 구두주문을 POS에서 직접 입력해 create_order RPC로 제출 ──
// 별도 "장바구니 화면" 없이 메뉴를 고르면 우측 주문요약에 바로 반영되는 단일 화면 구성.

interface DbAccountLite {
  account_code:    string
  account_name:    string
  account_type:    string
  current_balance: number
}

interface CartOption { id: string; name: string; extra: number }
interface CartItem {
  key:      string
  menuId:   string
  menuName: string
  unitPrice: number
  qty:      number
  options:  CartOption[]
}

const METHODS: { v: '포장' | '내점' | '배달'; l: string }[] = [
  { v: '포장', l: '포장' },
  { v: '내점', l: '매장 식사' },
  { v: '배달', l: '배달' },
]

// DB row → MenuDetail 변환은 lib/mappers.ts의 mapMenuRow 공용 (Menus.tsx와 공유).
// 구두주문은 고객에게 바로 노출되는 흐름이라 숨김 옵션은 제외.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapMenu(row: any): MenuDetail {
  return mapMenuRow(row, { excludeHiddenOptions: true })
}

/** 거래처 구성원 — account_members 의 최소 필드 */
interface MemberLite {
  id:     string
  name:   string
  phone:  string | null
  orders: number
}

export default function VerbalOrderModal({
  storeId, onClose, onCreated,
}: {
  storeId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [accountQuery,   setAccountQuery]   = useState('')
  const [accountResults, setAccountResults] = useState<DbAccountLite[]>([])
  const [searchingAcct,  setSearchingAcct]  = useState(false)
  const [selectedAccount, setSelectedAccount] = useState<DbAccountLite | null>(null)

  // 주문자는 **타이핑이 아니라 고르는 것**이다.
  // 손으로 치면 "김민준 / 김민쥰 / 민준"처럼 같은 사람이 여러 이름으로 쌓이고,
  // 그러면 고객 화면의 '이용자별 주문'과 재주문율이 전부 어긋난다.
  // account_members 에 이미 명단이 있으므로 거기서 고르게 한다.
  const [members,        setMembers]        = useState<MemberLite[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [memberName,     setMemberName]     = useState('')   // 선택된 이용자 이름
  const [memberPhone,    setMemberPhone]    = useState('')
  const [newMember,      setNewMember]      = useState('')   // 명단에 없을 때 직접 추가
  const [method,        setMethod]      = useState<'포장' | '내점' | '배달'>('포장')
  /**
   * 배달 주소 · 요청사항.
   *
   * 전엔 구두주문에 이 둘이 아예 없었다. 그래서 전화로 받은 배달 주문이 주문기록에
   * "구두주문 — POS 직접 입력" 한 줄로만 남았고, 나중에 어디로 보냈는지 알 수 없었다.
   * 손님이 QR웹으로 넣은 주문과 같은 모양으로 남겨야 한 표에서 같이 읽힌다.
   */
  const [roadAddress,   setRoadAddress]   = useState('')
  const [detailAddress, setDetailAddress] = useState('')
  const [customerNote,  setCustomerNote]  = useState('')
  const [postcodeOpen,  setPostcodeOpen]  = useState(false)
  const [deliveryFee,   setDeliveryFee] = useState('0')

  const [categories, setCategories] = useState<Category[]>([])
  const [menus,      setMenus]      = useState<MenuDetail[]>([])
  const [catId,      setCatId]      = useState<string>('all')
  /** 카테고리 전체 목록 모달 — 가로 탭에서 안 보이는 뒤쪽까지 한 번에 고른다 */
  const [catPicker,  setCatPicker]  = useState(false)
  /** 모달에서 고른 카테고리가 가로 탭의 화면 밖에 있으면 거기로 스크롤한다 */
  const catTabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [menuLoading, setMenuLoading] = useState(true)

  const [cart, setCart] = useState<CartItem[]>([])
  /** 바깥 클릭으로 닫으려는데 입력한 게 있을 때 띄우는 확인창 */
  const [discardConfirm, setDiscardConfirm] = useState(false)
  const [optionPicker, setOptionPicker] = useState<MenuDetail | null>(null)
  const [optionSel,    setOptionSel]    = useState<Record<string, string[]>>({})
  const [optionQty,    setOptionQty]    = useState(1)

  const [submitting, setSubmitting] = useState(false)
  const [errorMsg,   setErrorMsg]   = useState('')

  // 거래처를 고르면 그 거래처의 이용자 명단을 연다. 많이 시킨 순 — 대부분 그 윗줄에서 끝난다
  useEffect(() => {
    if (!selectedAccount) { setMembers([]); setMemberName(''); setMemberPhone(''); return }
    let cancelled = false
    setMembersLoading(true)
    supabase.from('account_members')
      .select('id, name, phone, order_count')
      .eq('account_code', selectedAccount.account_code)
      .order('order_count', { ascending: false })
      .then(({ data }) => {
        if (cancelled) return
        setMembers(((data ?? []) as { id: string; name: string; phone: string | null; order_count: number | null }[])
          .map(m => ({ id: m.id, name: m.name, phone: m.phone, orders: m.order_count ?? 0 })))
        setMembersLoading(false)
      })
    return () => { cancelled = true }
  }, [selectedAccount])

  // ── 거래처 목록 — 검색어 없이도 바로 전체 목록을 보여주고(클릭해서 바로 선택),
  // 입력하면 그 안에서 실시간으로 좁혀지는 방식(디바운스) ──────────────────────
  useEffect(() => {
    setSearchingAcct(true)
    const id = setTimeout(async () => {
      let q = supabase
        .from('accounts')
        .select('account_code, account_name, account_type, current_balance')
        .eq('is_active', true)
        .eq('store_id', storeId)
        .order('account_name')
        .limit(50)
      if (accountQuery.trim()) q = q.ilike('account_name', `%${accountQuery.trim()}%`)
      const { data } = await q
      setAccountResults((data ?? []) as DbAccountLite[])
      setSearchingAcct(false)
    }, 200)
    return () => clearTimeout(id)
  }, [accountQuery, storeId])

  // 고른 카테고리 칩을 가로 탭 안으로 끌어온다.
  // 모달에서 뒤쪽 카테고리를 고르면 탭 줄은 앞쪽을 보고 있어서 선택된 칩이 안 보인다.
  useEffect(() => {
    catTabRefs.current[catId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [catId])

  // ── 메뉴/카테고리 조회 (거래처 선택 후) ──────────────────────────────────
  useEffect(() => {
    if (!selectedAccount) return
    async function load() {
      setMenuLoading(true)
      const { data: cats } = await supabase
        .from('categories').select('id, name, display_order')
        .eq('store_id', storeId).eq('is_active', true).order('display_order')
      const catList: Category[] = (cats ?? []).map(c => ({ id: c.id, name: c.name, displayOrder: c.display_order }))
      setCategories(catList)

      if (catList.length > 0) {
        const { data: menuRows } = await supabase
          .from('menus')
          .select(`
            id, category_id, name, description, base_price, image_url,
            is_sold_out, sold_out_until, is_hidden, display_order, is_popular, is_recommended, is_new,
            menu_option_groups (
              display_order,
              option_groups ( id, name, is_required, is_multi, max_select,
                option_items ( id, name, extra_price, is_popular, is_sold_out, sold_out_until, is_hidden, display_order, max_quantity )
              )
            )
          `)
          .eq('store_id', storeId)
          .eq('is_hidden', false)
          .order('display_order')
        setMenus((menuRows ?? []).map(mapMenu))
      }
      setMenuLoading(false)
    }
    load()
  }, [selectedAccount, storeId])

  function visibleMenus() {
    return menus.filter(m => !m.soldOut && (catId === 'all' || m.categoryId === catId))
  }

  function addPlainItem(menu: MenuDetail) {
    setCart(prev => {
      const existing = prev.find(c => c.menuId === menu.code && c.options.length === 0)
      if (existing) return prev.map(c => c === existing ? { ...c, qty: c.qty + 1 } : c)
      return [...prev, { key: crypto.randomUUID(), menuId: menu.code, menuName: menu.name, unitPrice: menu.price, qty: 1, options: [] }]
    })
  }

  /**
   * 고를 게 없는 그룹은 **미리 선택해서 띄운다.**
   *
   * '가격(필수) - 파스타 샐러드' 처럼 선택지가 "10,400원" 하나뿐인 필수 그룹이 메뉴마다 붙어 있다.
   * 그건 메뉴값일 뿐 손님이 고르는 게 아닌데, 안 눌러주면 담기에서 "필수 옵션을 선택해주세요"로
   * 막힌다 — 피크타임에 점주가 매번 한 번씩 더 눌러야 했다.
   *
   * 조건을 "이름이 가격처럼 생겼으면"으로 잡지 않고 **선택지가 1개인 필수 단일선택 그룹**으로 잡았다.
   * 침산점 가격(필수) 그룹은 전부 이 모양이고, 앞으로 생길 다른 1개짜리 필수 그룹에도 맞다.
   * 선택지가 2개 이상인 필수 그룹(베이스·소스 등)은 **건드리지 않는다** — 임의로 하나 찍어두면
   * 점주가 못 보고 넘겨서 엉뚱한 옵션으로 주문이 들어간다.
   */
  function autoSelect(menu: MenuDetail): Record<string, string[]> {
    const sel: Record<string, string[]> = {}
    for (const g of menu.optionGroups) {
      const pickable = g.items.filter(it => !it.soldOut)
      if (g.isRequired && !g.isMulti && pickable.length === 1) sel[g.id] = [pickable[0].id]
    }
    return sel
  }

  /** 선택지가 1개인 필수 그룹은 끌 수 없다 — 끄면 담기에서 막히는 길밖에 없다 */
  function isLocked(g: MenuDetail['optionGroups'][number]): boolean {
    return g.isRequired && !g.isMulti && g.items.filter(it => !it.soldOut).length === 1
  }

  function handleMenuTap(menu: MenuDetail) {
    if (menu.optionGroups.length > 0) {
      setOptionPicker(menu)
      setOptionSel(autoSelect(menu))
      setOptionQty(1)
    } else {
      addPlainItem(menu)
    }
  }

  function toggleOption(groupId: string, itemId: string, isMulti: boolean, maxSelect: number | null, locked = false) {
    if (locked) return
    setOptionSel(prev => {
      const cur = prev[groupId] ?? []
      if (!isMulti) return { ...prev, [groupId]: cur.includes(itemId) ? [] : [itemId] }
      if (cur.includes(itemId)) return { ...prev, [groupId]: cur.filter(id => id !== itemId) }
      if (maxSelect != null && cur.length >= maxSelect) return prev
      return { ...prev, [groupId]: [...cur, itemId] }
    })
  }

  function confirmOptionPicker() {
    if (!optionPicker) return
    const missingRequired = optionPicker.optionGroups.some(g => g.isRequired && (optionSel[g.id]?.length ?? 0) === 0)
    if (missingRequired) { setErrorMsg('필수 옵션을 선택해주세요.'); return }
    const options: CartOption[] = optionPicker.optionGroups.flatMap(g =>
      (optionSel[g.id] ?? []).map(itemId => {
        const it = g.items.find(i => i.id === itemId)!
        return { id: it.id, name: it.name, extra: it.extra }
      })
    )
    setCart(prev => [...prev, {
      key: crypto.randomUUID(), menuId: optionPicker.code, menuName: optionPicker.name,
      unitPrice: optionPicker.price, qty: optionQty, options,
    }])
    setOptionPicker(null)
    setOptionSel({})
    setOptionQty(1)
    setErrorMsg('')
  }

  function updateQty(key: string, delta: number) {
    setCart(prev => prev
      .map(c => c.key === key ? { ...c, qty: c.qty + delta } : c)
      .filter(c => c.qty > 0))
  }

  function itemTotal(c: CartItem) { return (c.unitPrice + c.options.reduce((s, o) => s + o.extra, 0)) * c.qty }
  const subtotal = cart.reduce((s, c) => s + itemTotal(c), 0)
  const deliveryFeeNum = method === '배달' ? (parseInt(deliveryFee, 10) || 0) : 0
  const total = subtotal + deliveryFeeNum

  const canSubmit = !!selectedAccount && cart.length > 0 && memberName.trim().length > 0 && !submitting

  async function handleSubmit() {
    if (!canSubmit || !selectedAccount) return
    setSubmitting(true)
    setErrorMsg('')

    const items = cart.map(c => ({
      menu_id: c.menuId,
      menu_name: c.menuName,
      quantity: c.qty,
      option_item_ids: c.options.map(o => o.id),
      option_names: c.options.map(o => o.name),
      option_prices: c.options.map(o => o.extra),
    }))

    // note 는 **파싱되는 형식**이다 — lib/ipc.ts 의 parseNote 가 ' / ' 로 끊고
    // [배달주소]/[배달상세] 접두사를 읽는다. 홈 상세·영수증이 그 결과를 쓰므로
    // 손님 주문과 같은 모양으로 적어야 한 화면에서 같이 읽힌다.
    const isDelivery = method === '배달'
    const noteParts: string[] = []
    if (isDelivery && roadAddress.trim())   noteParts.push(`[배달주소] ${roadAddress.trim()}`)
    if (isDelivery && detailAddress.trim()) noteParts.push(`[배달상세] ${detailAddress.trim()}`)
    if (customerNote.trim())                noteParts.push(customerNote.trim())
    noteParts.push('구두주문 — POS 직접 입력')

    const { error } = await supabase.rpc('create_order', {
      p_account_code:  selectedAccount.account_code,
      p_orderer_name:  memberName.trim(),
      p_method:        method,
      p_items:         items,
      p_delivery_fee:  deliveryFeeNum,
      p_orderer_phone: memberPhone.trim() || null,
      p_note:          noteParts.join(' / '),
      // 전용 컬럼에도 같이 넣는다 — 나중에 주소로 집계하려면 note 파싱 말고 이게 필요하다
      p_delivery_road_address:   isDelivery ? (roadAddress.trim()   || null) : null,
      p_delivery_detail_address: isDelivery ? (detailAddress.trim() || null) : null,
    })

    if (error) {
      console.error('구두주문 생성 실패:', error)
      setErrorMsg(`주문 생성에 실패했습니다: ${error.message ?? '다시 시도해주세요.'}`)
      setSubmitting(false)
      return
    }

    setSubmitting(false)
    onCreated()
    onClose()
  }

  // 바깥을 눌러 닫을 때 **입력한 걸 말없이 버리지 않는다.**
  // 이 모달은 거래처·주문자·장바구니를 다 들고 있고, 피크타임에 전화를 받으면서 채운다.
  // 빈 상태면 그냥 닫고, 뭔가 담겨 있으면 한 번 묻는다.
  const hasWork = cart.length > 0 || !!selectedAccount || !!memberName.trim()
  function closeFromBackdrop() {
    if (!hasWork) { onClose(); return }
    setDiscardConfirm(true)
  }

  return (
    <ModalOverlay onClose={closeFromBackdrop} z={50}>
      <div className="modal-in bg-white rounded-2xl shadow-xl w-[90vw] max-w-[1100px] h-[85vh] flex flex-col overflow-hidden">

        {/* 헤더 */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-gray-border flex items-center justify-between">
          <div className="text-[17px] font-extrabold text-ink">구두주문 받기</div>
          <button onClick={onClose} className="text-gray-text hover:text-ink text-[20px] leading-none">✕</button>
        </div>

        <div className="flex-1 flex overflow-hidden">

          {/* 좌측: 거래처 — 검색어 없이도 바로 전체 목록이 보이고, 클릭 한 번으로 선택 ── */}
          <div className="w-[260px] flex-shrink-0 border-r border-gray-border flex flex-col overflow-hidden">
            <div className="flex-shrink-0 px-4 py-3 border-b border-gray-border">
              <input
                autoFocus
                value={accountQuery}
                onChange={e => setAccountQuery(e.target.value)}
                placeholder="거래처 검색 (선택)"
                className="w-full border border-gray-border rounded-lg px-3 py-2 text-[12px] outline-none focus:border-[#00DD67]"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {searchingAcct && accountResults.length === 0 ? (
                <div className="text-[12px] text-gray-text text-center py-6">불러오는 중...</div>
              ) : accountResults.length === 0 ? (
                <div className="text-[12px] text-gray-text text-center py-6">거래처가 없습니다.</div>
              ) : accountResults.map(acc => (
                <button
                  key={acc.account_code}
                  onClick={() => { if (selectedAccount?.account_code !== acc.account_code) { setSelectedAccount(acc); setCart([]) } }}
                  className={`pressable-row w-full flex items-center justify-between gap-2 px-4 py-3 text-left border-b border-gray-border/60 ${
                    selectedAccount?.account_code === acc.account_code ? 'bg-gray-bg' : 'hover:bg-gray-bg/60'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-ink truncate">{acc.account_name}</div>
                    <div className="text-[11px] text-gray-text">{acc.account_type}</div>
                  </div>
                  <div className={`text-[12px] font-semibold flex-shrink-0 ${acc.current_balance < 0 ? 'text-[#3374FF]' : 'text-gray-text'}`}>
                    {won(acc.current_balance)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 가운데: 이용자 선택 — 거래처를 고르면 열린다 */}
          {selectedAccount && (
            <div className="w-[200px] flex-shrink-0 border-r border-gray-border flex flex-col overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-border flex-shrink-0">
                <div className="text-[12px] font-medium text-[#2C261F]">이용자</div>
                <div className="text-[11px] font-normal text-[#ADADAD] mt-[2px]">누가 주문했는지 고르세요</div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {membersLoading ? (
                  <div className="text-[12px] text-gray-text text-center py-6">불러오는 중…</div>
                ) : members.length === 0 ? (
                  <div className="text-[12px] text-[#ADADAD] text-center py-6 px-3 leading-relaxed">
                    아직 등록된 이용자가 없어요.<br />아래에 이름을 적어 주세요
                  </div>
                ) : members.map(m => {
                  const on = memberName === m.name
                  return (
                    <button
                      key={m.id}
                      onClick={() => { setMemberName(m.name); setMemberPhone(m.phone ?? ''); setNewMember('') }}
                      className={`w-full px-4 py-[10px] text-left border-b border-gray-border/60 transition-colors ${
                        on ? 'bg-[#E8E4E2]' : 'hover:bg-gray-bg/60'
                      }`}
                    >
                      <div className={`text-[13px] truncate ${on ? 'font-medium text-[#1E1E1E]' : 'text-[#414141]'}`}>
                        {m.name}
                      </div>
                      <div className="text-[11px] text-[#ADADAD]">
                        {m.orders > 0 ? `${m.orders}건` : '첫 주문'}
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* 명단에 없는 사람 — 처음 오는 손님은 늘 있다 */}
              <div className="flex-shrink-0 border-t border-gray-border p-3">
                <input
                  value={newMember}
                  onChange={e => {
                    setNewMember(e.target.value)
                    setMemberName(e.target.value)   // 입력하는 순간 그 이름으로 주문된다
                    setMemberPhone('')
                  }}
                  placeholder="명단에 없으면 입력"
                  className="w-full border border-[#D9D9D9] rounded-[9px] px-[10px] py-[7px] text-[12px] outline-none focus:border-[#6A635E] transition-colors"
                />
              </div>
            </div>
          )}

          {/* 우측: 카테고리별 메뉴 선택 + 우하단 고정 총액/주문하기 ── */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {!selectedAccount ? (
              <div className="flex-1 flex items-center justify-center text-gray-text text-[13px]">
                왼쪽에서 거래처를 선택해주세요
              </div>
            ) : (
              <>
                {/* 거래처/주문자/방법 */}
                <div className="flex-shrink-0 px-5 py-3 border-b border-gray-border space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-bold text-ink">{selectedAccount.account_name}</span>
                    <span className={`text-[12px] font-semibold ${selectedAccount.current_balance < 0 ? 'text-[#3374FF]' : 'text-gray-text'}`}>
                      잔액 {won(selectedAccount.current_balance)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* 주문자는 가운데 이용자 열에서 고른다 — 여기선 고른 결과만 보여준다 */}
                    <span className="text-[12px] font-normal text-[#787878]">
                      주문자{' '}
                      {/* 미선택은 빈칸으로 둔다 — 아직 안 고른 걸 빨간 글씨로 경고할 단계가 아니다 */}
                      {memberName && <span className="font-medium text-[#1E1E1E]">{memberName}</span>}
                    </span>
                    <div className="flex gap-1 ml-auto">
                      {METHODS.map(m => (
                        <button
                          key={m.v}
                          onClick={() => setMethod(m.v)}
                          className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                            method === m.v ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'
                          }`}
                        >
                          {m.l}
                        </button>
                      ))}
                    </div>
                    {method === '배달' && (
                      <input
                        type="number"
                        value={deliveryFee}
                        onChange={e => setDeliveryFee(e.target.value)}
                        placeholder="배달료"
                        className="w-24 border border-gray-border rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-[#00DD67]"
                      />
                    )}
                  </div>

                  {/* 배달 주소 — 배달일 때만. 주소는 직접 치지 않고 검색해서 고른다
                      (오타가 나면 배달을 못 간다). 세부주소는 검색으로 안 나오므로 직접 받는다. */}
                  {method === '배달' && (
                    <div className="mt-2 flex gap-1.5">
                      <button
                        onClick={() => setPostcodeOpen(true)}
                        className={`pressable-soft flex-1 min-w-0 text-left border rounded-lg px-2.5 py-1.5 text-[12px] truncate ${
                          roadAddress ? 'border-gray-border text-ink' : 'border-dashed border-[#ADADAD] text-gray-text'
                        }`}
                      >
                        {roadAddress || '배달 주소 찾기'}
                      </button>
                      <input
                        value={detailAddress}
                        onChange={e => setDetailAddress(e.target.value)}
                        placeholder="세부주소 (동·호수)"
                        className="w-40 flex-shrink-0 border border-gray-border rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-[#00DD67]"
                      />
                    </div>
                  )}

                  {/* 요청사항 — 세 가지 이용방법 모두. '덜 맵게' 같은 말은 포장·내점에도 온다 */}
                  <input
                    value={customerNote}
                    onChange={e => setCustomerNote(e.target.value)}
                    placeholder="요청사항 (예: 덜 맵게, 수저 빼주세요)"
                    className="mt-2 w-full border border-gray-border rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-[#00DD67]"
                  />
                </div>

                {/* 카테고리 탭 — 오른쪽 끝에 전체 목록 버튼.
                    QR오더 손님 화면(salaria-prepaid menu/page.tsx)과 같은 모양이다.
                    카테고리가 늘면 가로 스크롤 뒤쪽이 안 보이는데, 피크타임에 전화를
                    받으면서 탭을 긁어 찾는 건 현실적이지 않다. 한 번 눌러 전부 펼친다. */}
                <div className="flex-shrink-0 border-b border-gray-border flex items-center">
                  <div className="no-scrollbar flex-1 min-w-0 flex gap-1.5 overflow-x-auto px-5 py-2">
                    {[{ id: 'all', name: '전체' }, ...categories].map(cat => (
                      <button
                        key={cat.id}
                        ref={el => { catTabRefs.current[cat.id] = el }}
                        onClick={() => setCatId(cat.id)}
                        className={`px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap flex-shrink-0 transition-colors ${
                          catId === cat.id ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'
                        }`}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setCatPicker(v => !v)}
                    className="pressable-soft flex-shrink-0 w-7 h-7 ml-1 mr-4 bg-white border border-[#E0E0E0] rounded-full flex items-center justify-center text-gray-text"
                    style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
                    aria-label="카테고리 전체 보기"
                  >
                    <svg
                      className="transition-transform duration-200"
                      style={{ transform: catPicker ? 'rotate(-90deg)' : 'rotate(90deg)', width: 15, height: 15 }}
                      viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    >
                      <polyline points="9 6 15 12 9 18" />
                    </svg>
                  </button>
                </div>

                {/* 메뉴 그리드 — 옵션 없으면 바로 담김(연속 탭 = 수량+1), 있으면 옵션+수량 선택 모달 */}
                <div className="flex-1 overflow-y-auto p-4">
                  {menuLoading ? (
                    <div className="h-full flex items-center justify-center text-gray-text text-[12px]">메뉴 불러오는 중...</div>
                  ) : visibleMenus().length === 0 ? (
                    <div className="h-full flex items-center justify-center text-gray-text text-[12px]">표시할 메뉴가 없습니다.</div>
                  ) : (
                    <div className="grid grid-cols-3 xl:grid-cols-4 gap-2.5">
                      {visibleMenus().map(menu => (
                        <button
                          key={menu.code}
                          onClick={() => handleMenuTap(menu)}
                          className="text-left bg-gray-bg hover:bg-gray-100 rounded-xl p-3 transition-colors"
                        >
                          <div className="text-[13px] font-bold text-ink leading-snug mb-1">{menu.name}</div>
                          <div className="text-[12px] text-gray-text">{won(menu.price)}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 우하단 고정: 담긴 메뉴 요약 칩(제거 가능) + 총액 + 주문하기 CTA — 한 화면에서 바로 클릭 */}
                <div className="flex-shrink-0 bg-white">
                  {cart.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto px-4 py-2.5">
                      {cart.map(c => (
                        <div key={c.key} className="flex-shrink-0 flex items-center gap-1.5 bg-white rounded-full pl-3 pr-1.5 py-1.5 border border-gray-border">
                          <span className="text-[11px] font-semibold text-ink whitespace-nowrap">{c.menuName} ×{c.qty}</span>
                          <button
                            onClick={() => updateQty(c.key, -c.qty)}
                            className="w-5 h-5 rounded-full bg-gray-100 text-gray-text text-[11px] flex items-center justify-center hover:bg-gray-200 transition-colors"
                            title="빼기"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="px-4 pb-4 pt-1">
                    {method === '배달' && deliveryFeeNum > 0 && (
                      <div className="flex items-center justify-between text-[11px] text-gray-text mb-1">
                        <span>배달료 포함</span><span>+{won(deliveryFeeNum)}</span>
                      </div>
                    )}
                    {errorMsg && <div className="text-[11px] text-danger font-semibold mb-2">{errorMsg}</div>}
                    <div className="flex items-center gap-3">
                      <div className="text-[17px] font-extrabold text-ink whitespace-nowrap">{won(total)}</div>
                      <button
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="flex-1 py-3 rounded-xl bg-ink text-white font-bold text-[14px] disabled:opacity-40 hover:bg-ink/80 transition-colors"
                      >
                        {submitting ? '주문 처리 중...' : '주문하기'}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 카테고리 선택 모달 — 옵션 모달과 같은 레이어(z-10).
            구두주문 모달 안쪽만 덮는다. 바깥 배경까지 덮으면 "주문을 닫은 건가"
            하고 헷갈린다. */}
        {catPicker && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/30"
            onClick={() => setCatPicker(false)}
          >
            <div
              className="modal-in bg-white rounded-2xl shadow-xl w-[380px] max-h-[80%] overflow-y-auto p-5"
              onClick={e => e.stopPropagation()}
            >
              <div className="text-[15px] font-extrabold text-ink mb-3">카테고리</div>
              <div className="flex flex-wrap gap-1.5">
                {[{ id: 'all', name: '전체' }, ...categories].map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => { setCatId(cat.id); setCatPicker(false) }}
                    className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${
                      catId === cat.id ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 옵션 선택 모달 */}
        {optionPicker && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30" onClick={() => setOptionPicker(null)}>
            <div className="modal-in bg-white rounded-2xl shadow-xl w-[380px] max-h-[80%] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
              <div className="text-[15px] font-extrabold text-ink mb-3">{optionPicker.name}</div>
              {optionPicker.optionGroups.map(g => (
                <div key={g.id} className="mb-4">
                  <div className="text-[12px] font-bold text-ink mb-1.5">
                    {g.name} {g.isRequired && <span className="text-danger">*필수</span>}
                  </div>
                  <div className="space-y-1.5">
                    {g.items.filter(it => !it.soldOut).map(it => {
                      const checked = (optionSel[g.id] ?? []).includes(it.id)
                      const locked  = isLocked(g)
                      return (
                        <button
                          key={it.id}
                          onClick={() => toggleOption(g.id, it.id, g.isMulti, g.maxSelect, locked)}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-[12px] transition-colors ${
                            checked ? 'border-ink bg-gray-bg font-semibold text-ink' : 'border-gray-border text-gray-text hover:bg-gray-bg'
                          } ${locked ? 'cursor-default' : ''}`}
                        >
                          <span className="flex-1 text-left">{it.name}</span>
                          {it.extra > 0 && <span className="tabular-nums">+{won(it.extra)}</span>}
                          {/* 선택 표시는 **줄 맨 오른쪽**. 테두리 색만으로는 여러 줄이 섞였을 때
                              뭐가 켜진 건지 한눈에 안 들어온다.
                              단일선택은 원(라디오), 복수선택은 둥근 사각(체크박스) — 모양이 곧
                              "하나만 고르는 건지 여러 개 고르는 건지"를 말해준다. */}
                          <span
                            className={`flex-shrink-0 w-[15px] h-[15px] flex items-center justify-center border-[1.5px] transition-colors ${
                              g.isMulti ? 'rounded-[4px]' : 'rounded-full'
                            } ${checked ? 'border-ink bg-ink' : 'border-gray-border bg-white'}`}
                          >
                            {checked && (g.isMulti
                              ? <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.8 3.4 6.6 7.5 2.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              : <span className="w-[5px] h-[5px] rounded-full bg-white" />
                            )}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}

              {/* 수량 */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-bold text-ink">수량</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setOptionQty(q => Math.max(1, q - 1))}
                    className="w-7 h-7 rounded-lg bg-gray-100 text-ink font-bold text-[14px] hover:bg-gray-200 transition-colors"
                  >
                    −
                  </button>
                  <span className="text-[14px] font-bold text-ink w-5 text-center">{optionQty}</span>
                  <button
                    onClick={() => setOptionQty(q => q + 1)}
                    className="w-7 h-7 rounded-lg bg-gray-100 text-ink font-bold text-[14px] hover:bg-gray-200 transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              {errorMsg && <div className="text-[11px] text-danger font-semibold mb-2">{errorMsg}</div>}
              <div className="flex gap-2 mt-2">
                <button onClick={() => { setOptionPicker(null); setErrorMsg('') }} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-text font-bold text-[13px]">
                  취소
                </button>
                <button onClick={confirmOptionPicker} className="flex-1 py-2.5 rounded-xl bg-ink text-white font-bold text-[13px]">
                  담기
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 입력한 주문을 버릴지 확인 — 바깥 클릭으로 닫으려 할 때만 뜬다.
          헤더의 ✕ 는 "닫겠다"는 분명한 의사표시라 그대로 닫는다. */}
      {discardConfirm && (
        <ConfirmDialog
          title="입력한 구두주문을 버릴까요?"
          description="담은 메뉴와 고른 거래처가 사라져요. 주문은 아직 접수되지 않았어요."
          confirmLabel="버리기"
          cancelLabel="계속 입력"
          tone="danger"
          onConfirm={() => { setDiscardConfirm(false); onClose() }}
          onCancel={() => setDiscardConfirm(false)}
        />
      )}

      {/* 다음 주소검색 — 매장 정보 화면과 같은 컴포넌트.
          z-[95]: 이 구두주문 모달 위에 떠야 하고, 삭제 확인(z-90)보다도 위다. */}
      {postcodeOpen && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40"
          onClick={() => setPostcodeOpen(false)}
        >
          <div
            className="modal-in bg-[#FCFCFC] rounded-[16px] shadow-xl w-[460px] max-w-[92vw] overflow-hidden flex flex-col"
            style={{ height: 520 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex-shrink-0 flex items-center justify-between px-[20px] py-[14px]">
              <span className="text-[15px] font-semibold text-ink">배달 주소 찾기</span>
              <button onClick={() => setPostcodeOpen(false)} className="pressable text-[18px] text-gray-text hover:text-ink">✕</button>
            </div>
            <div className="flex-1 min-h-0">
              <DaumPostcodeEmbed onComplete={road => { setRoadAddress(road); setPostcodeOpen(false) }} />
            </div>
          </div>
        </div>
      )}
    </ModalOverlay>
  )
}
