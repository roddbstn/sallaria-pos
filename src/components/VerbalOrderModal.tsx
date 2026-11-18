import { useState, useEffect, useRef } from 'react'
import Working from './ui/Working'
import { supabase } from '../lib/supabase'
import { won } from '../lib/ipc'
import { type MenuDetail, type Category } from '../lib/mock-data'
import { mapMenuRow } from '../lib/mappers'
import ModalOverlay from './ui/ModalOverlay'
import DaumPostcodeEmbed from './DaumPostcodeEmbed'
import { maskName, maskPhone } from '../lib/mask'
import { qrUrlFor, SUNPOS_KAKAO_URL } from '../lib/qr-order'
import {
  type VerbalStep, type VerbalMethod,
  formatPhoneInput, phoneDigits, isMobilePhone, isDuplicateName,
  canAdvance, inviteSmsText, inviteSmsFits, canInviteBySms,
} from '../lib/verbal-order'

// ── 구두주문 받기 — 전화·현장 주문을 POS 에서 직접 넣는다 ───────────────────
//
// 세 단계다: ① 거래처·주문자  ② 메뉴  ③ 최종 확인
//
// 전엔 한 화면에 3열(거래처 | 이용자 | 메뉴)로 다 들어 있었다. 전화를 받으면서
// 쓰는 화면이라 빠른 건 좋았는데, 배달 주소와 요청사항이 메뉴 위 좁은 띠에 끼어
// 있어서 실제로는 거기까지 눈이 안 갔다 — 배달인데 주소가 빈 주문이 들어왔다.
// 단계를 나누면 각 단계에서 물어볼 것만 묻고, 마지막에 한 번 다 보여준다.
//
// 단계 전환 조건은 lib/verbal-order.ts 에 있다(단위 테스트 붙어 있음).

interface DbAccountLite {
  account_code:    string
  account_name:    string
  account_type:    string
  current_balance: number
  /** 'kakao' 만 초대 문자를 보낼 수 있다 — verbal-order.ts 의 canInviteBySms 참고 */
  qr_system:       'legacy' | 'kakao' | null
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

const METHODS: { v: VerbalMethod; l: string }[] = [
  { v: '포장', l: '포장' },
  { v: '내점', l: '내점' },
  { v: '배달', l: '배달' },
]

/** 거래처 유형 칩. DB 실제 값은 부서·기업·개인 세 가지다(2026-11-18 확인) */
const TYPE_FILTERS = ['전체', '부서', '기업', '개인'] as const
type TypeFilter = typeof TYPE_FILTERS[number]

// DB row → MenuDetail 변환은 lib/mappers.ts 의 mapMenuRow 공용 (Menus.tsx 와 공유).
// 구두주문은 고객에게 바로 나가는 흐름이라 숨김 옵션은 제외.
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
  lastOrderedAt: string | null
}

/** 눈 버튼 — 기본은 가린 상태, 누르면 연다 (lib/mask.ts 의 설계 참고) */
function RevealRow({
  label, value, masked, open, onToggle,
}: {
  label: string; value: string; masked: string; open: boolean; onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <span className="text-[12px] text-[#787878] flex-shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[12px] font-semibold text-ink truncate tabular-nums">
          {value ? (open ? value : masked) : '—'}
        </span>
        {value && (
          <button
            onClick={onToggle}
            className="pressable-soft flex-shrink-0 text-[#ADADAD] hover:text-ink transition-colors"
            aria-label={open ? `${label} 가리기` : `${label} 보기`}
            title={open ? '가리기' : '보기'}
          >
            {open ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

export default function VerbalOrderModal({
  storeId, storeName, onClose, onCreated,
}: {
  storeId: string
  /** 초대 문자 문구에 들어간다 — '[샐러리아 침산점] 선결제 주문 등록 …' */
  storeName: string
  onClose: () => void
  onCreated: () => void
}) {
  const [step, setStep] = useState<VerbalStep>(1)

  const [accountQuery,   setAccountQuery]   = useState('')
  const [typeFilter,     setTypeFilter]     = useState<TypeFilter>('전체')
  const [accountResults, setAccountResults] = useState<DbAccountLite[]>([])
  /**
   * 검색어가 **주문자 이름**으로 걸린 거래처 → 그 거래처에서 걸린 사람들.
   *
   * 같은 이름이 여러 과에 있는 건 흔하다('김민수'). 그래서 하나로 추리지 않고
   * 걸린 거래처를 **전부** 보여주고, 각 줄에 그 과에서 걸린 사람 이름을 적는다.
   * 어느 과인지는 전화를 받고 있는 점주가 안다 — 우리가 찍으면 틀린다.
   * 거래처를 고를 때 그 과에서 걸린 사람이 **한 명뿐이면** 주문자까지 자동으로 잡는다.
   */
  const [memberHits, setMemberHits] = useState<Record<string, string[]>>({})
  const [searchingAcct,  setSearchingAcct]  = useState(false)
  const [selectedAccount, setSelectedAccount] = useState<DbAccountLite | null>(null)

  // 주문자는 **타이핑이 아니라 고르는 것**이다.
  // 손으로 치면 "김민준 / 김민쥰 / 민준"처럼 같은 사람이 여러 이름으로 쌓이고,
  // 그러면 고객 화면의 '이용자별 주문'과 재주문율이 전부 어긋난다.
  const [members,        setMembers]        = useState<MemberLite[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [picked,         setPicked]         = useState<MemberLite | null>(null)
  const [revealName,     setRevealName]     = useState(false)
  const [revealPhone,    setRevealPhone]    = useState(false)

  // 명단에 없는 손님 — 처음 오는 사람은 늘 있다
  const [newName,   setNewName]   = useState('')
  const [newPhone,  setNewPhone]  = useState('')
  const [adding,    setAdding]    = useState(false)
  /** 추가 직후 '이 번호로 등록 문자를 보낼까요?' 확인창 — 자동 발송하지 않는다 */
  const [inviteTarget,  setInviteTarget]  = useState<{ name: string; phone: string } | null>(null)
  const [inviteSending, setInviteSending] = useState(false)

  const [method, setMethod] = useState<VerbalMethod>('포장')

  /**
   * 배달 주소 · 요청사항.
   *
   * 가게 요청사항과 배달 요청사항은 **다른 칸**이다. lib/ipc.ts 의 parseNote 가
   * 이미 `[배달요청]` 을 읽을 줄 아는데 구두주문만 그걸 안 쓰고 둘을 한 칸에
   * 뭉쳐 보내고 있었다 — 주방에 붙는 영수증에서 "문 앞에 놔주세요"가 조리
   * 요청처럼 보였다.
   */
  const [roadAddress,   setRoadAddress]   = useState('')
  const [detailAddress, setDetailAddress] = useState('')
  const [storeNote,     setStoreNote]     = useState('')
  const [deliveryNote,  setDeliveryNote]  = useState('')
  const [postcodeOpen,  setPostcodeOpen]  = useState(false)
  const [deliveryFee,   setDeliveryFee]   = useState('0')

  const [categories, setCategories] = useState<Category[]>([])
  const [menus,      setMenus]      = useState<MenuDetail[]>([])
  const [catId,      setCatId]      = useState<string>('all')
  /** 카테고리 전체 목록 모달 — 가로 탭에서 안 보이는 뒤쪽까지 한 번에 고른다 */
  const [catPicker,  setCatPicker]  = useState(false)
  const catTabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [menuLoading, setMenuLoading] = useState(true)
  const [menuQuery,   setMenuQuery]   = useState('')

  const [cart, setCart] = useState<CartItem[]>([])
  const [optionPicker, setOptionPicker] = useState<MenuDetail | null>(null)
  const [optionSel,    setOptionSel]    = useState<Record<string, string[]>>({})
  const [optionQty,    setOptionQty]    = useState(1)

  /**
   * 바깥 클릭·Esc 로 닫으려 할 때 띄우는 확인창 — **2·3단계에서만**.
   *
   * 1단계는 거래처와 주문자만 고른 상태라 다시 고르는 비용이 거의 없다.
   * 메뉴까지 담은 뒤에 손이 미끄러져 닫히면 전화를 받으면서 쌓은 걸 통째로
   * 다시 해야 한다 — 거기서만 한 번 묻는다.
   */
  const [confirmQuit, setConfirmQuit] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [errorMsg,   setErrorMsg]   = useState('')
  const [toast,      setToast]      = useState('')

  function flash(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2600)
  }

  const ordererName = picked?.name ?? ''

  // 거래처를 고르면 그 거래처의 이용자 명단을 연다. 많이 시킨 순 — 대부분 윗줄에서 끝난다
  useEffect(() => {
    if (!selectedAccount) { setMembers([]); setPicked(null); return }
    let cancelled = false
    setMembersLoading(true)
    supabase.from('account_members')
      .select('id, name, phone, order_count, last_ordered_at')
      .eq('account_code', selectedAccount.account_code)
      .order('order_count', { ascending: false })
      .then(({ data }) => {
        if (cancelled) return
        const list = ((data ?? []) as {
          id: string; name: string; phone: string | null
          order_count: number | null; last_ordered_at: string | null
        }[]).map(m => ({
          id: m.id, name: m.name, phone: m.phone,
          orders: m.order_count ?? 0, lastOrderedAt: m.last_ordered_at,
        }))
        setMembers(list)
        // 주문자 이름으로 검색해서 이 과에서 **한 명만** 걸렸으면 그 사람으로 잡아준다.
        // 둘 이상이면 고르게 둔다 — 동명이인을 우리가 찍으면 틀린 사람 이름으로 주문이 나간다.
        const hit = memberHits[selectedAccount.account_code] ?? []
        if (hit.length === 1) {
          const auto = list.find(m => m.name === hit[0])
          if (auto) setPicked(auto)
        }
        setMembersLoading(false)
      })
    return () => { cancelled = true }
    // memberHits 는 일부러 deps 에 안 넣는다 — 넣으면 검색을 칠 때마다 명단을 다시
    // 불러 깜빡인다. 거래처를 누르는 시점의 렌더엔 이미 최신 memberHits 가 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount])

  // ── 거래처 목록 — 검색어 없이도 바로 전체가 보이고, 치면 좁혀진다(디바운스) ──
  useEffect(() => {
    setSearchingAcct(true)
    const id = setTimeout(async () => {
      const term = accountQuery.trim()

      const base = () => supabase
        .from('accounts')
        .select('account_code, account_name, account_type, current_balance, qr_system')
        .eq('is_active', true)
        .eq('store_id', storeId)
        .limit(100)

      // ① 거래처명으로
      let q = base().order('account_name')
      if (term) q = q.ilike('account_name', `%${term}%`)
      if (typeFilter !== '전체') q = q.eq('account_type', typeFilter)
      const { data: byName } = await q

      // ② 주문자 이름으로 — 점주는 "김민수요" 를 먼저 듣지 과 이름을 먼저 듣지 않는다
      let hits: Record<string, string[]> = {}
      let byMember: DbAccountLite[] = []
      if (term) {
        const { data: ms } = await supabase
          .from('account_members')
          .select('name, account_code')
          .ilike('name', `%${term}%`)
          .limit(200)
        for (const m of (ms ?? []) as { name: string; account_code: string }[]) {
          (hits[m.account_code] ??= []).push(m.name)
        }
        const codes = Object.keys(hits)
        if (codes.length > 0) {
          let mq = base().in('account_code', codes)
          if (typeFilter !== '전체') mq = mq.eq('account_type', typeFilter)
          const { data } = await mq
          byMember = (data ?? []) as DbAccountLite[]
          // 다른 매장 거래처는 위 쿼리에서 이미 걸러졌다 — hits 도 같이 맞춘다
          const allowed = new Set(byMember.map(a => a.account_code))
          hits = Object.fromEntries(Object.entries(hits).filter(([c]) => allowed.has(c)))
        }
      }

      // 이름으로 걸린 거래처를 **위에** 올린다 — 사람 이름을 쳤으면 그걸 찾는 중이다
      const seen = new Set<string>()
      const merged = [...byMember, ...((byName ?? []) as DbAccountLite[])]
        .filter(a => (seen.has(a.account_code) ? false : (seen.add(a.account_code), true)))

      setMemberHits(hits)
      setAccountResults(merged)
      setSearchingAcct(false)
    }, 200)
    return () => clearTimeout(id)
  }, [accountQuery, typeFilter, storeId])

  // 고른 카테고리 칩을 가로 탭 안으로 끌어온다
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
    const q = menuQuery.trim().replace(/\s+/g, '').toLowerCase()
    return menus.filter(m => {
      if (m.soldOut) return false
      if (catId !== 'all' && m.categoryId !== catId) return false
      if (q && !m.name.replace(/\s+/g, '').toLowerCase().includes(q)) return false
      return true
    })
  }

  // ── 명단에 없는 손님 추가 ────────────────────────────────────────────────
  async function addMember() {
    if (!selectedAccount || adding) return
    const name   = newName.trim()
    const digits = phoneDigits(newPhone)
    if (!name) { setErrorMsg('이름을 입력해주세요.'); return }
    if (isDuplicateName(name, members)) { setErrorMsg('이미 명단에 있는 이름이에요.'); return }
    if (newPhone.trim() && !isMobilePhone(newPhone)) { setErrorMsg('휴대폰 번호를 확인해주세요.'); return }

    setAdding(true)
    setErrorMsg('')
    // 점주는 account_members 에 직접 넣을 수 있다 — RLS 의 owner_account_members_insert
    // 정책이 my_store_ids() 로 자기 매장 거래처인지 확인한다.
    const { data, error } = await supabase.from('account_members')
      .insert({ account_code: selectedAccount.account_code, name, phone: digits || null })
      .select('id, name, phone, order_count, last_ordered_at')
      .single()
    setAdding(false)

    if (error || !data) {
      console.error('이용자 추가 실패:', error)
      setErrorMsg(`추가에 실패했어요: ${error?.message ?? '다시 시도해주세요.'}`)
      return
    }

    const added: MemberLite = {
      id: data.id, name: data.name, phone: data.phone,
      orders: data.order_count ?? 0, lastOrderedAt: data.last_ordered_at,
    }
    setMembers(prev => [...prev, added])
    setPicked(added)              // 추가한 사람을 바로 주문자로
    setNewName(''); setNewPhone('')

    // 문자는 **자동으로 안 보낸다.** 되돌릴 수 없고 건당 비용이라, 번호를 눈으로
    // 한 번 확인하고 누르게 한다 (sms-templates.ts 의 설계 원칙과 같다).
    if (canInviteBySms(selectedAccount.qr_system, digits)) {
      setInviteTarget({ name, phone: digits })
    } else {
      flash(`${name}님을 명단에 추가했어요`)
    }
  }

  // ── 이용자 등록 문자 ─────────────────────────────────────────────────────
  async function sendInvite() {
    if (!inviteTarget || !selectedAccount || inviteSending) return
    setInviteSending(true)
    let ok = 0, failed = 0, lastError = ''
    let text = ''
    try {
      // 단축링크를 꼭 거친다 — 원본 주소를 그냥 넣으면 단문(90바이트)을 넘겨 LMS 요금이 된다
      const target = qrUrlFor(
        { account_code: selectedAccount.account_code, qr_system: 'kakao' },
        storeId,
      )
      const { data: code, error: linkErr } = await supabase.rpc('create_short_link', {
        p_target_url: target,
        p_expires_at: null,
      })
      if (linkErr || !code) throw linkErr ?? new Error('단축링크를 만들지 못했어요')

      const shortUrl = `${SUNPOS_KAKAO_URL}/s/${code}`
      text = inviteSmsText(storeName, shortUrl)
      if (!inviteSmsFits(storeName, shortUrl)) {
        console.warn('[구두주문] 초대 문자가 단문을 넘는다 — LMS 요금으로 나간다:', text)
      }

      const { error } = await supabase.functions.invoke('send-notification', {
        body: { purpose: 'custom', phone: inviteTarget.phone, params: { text } },
      })
      if (error) throw error
      ok = 1
    } catch (e) {
      failed = 1
      lastError = (e as Error).message ?? '발송 실패'
      console.error('초대 문자 발송 실패:', e)
    }

    // 성공이든 실패든 남긴다 — "보냈나 안 보냈나"를 기억에 맡기면 두 번 보내게 된다
    // (SmsPanel 과 같은 이유. kind='user_invite' 는 2026-11-18 에 체크 제약을 넓혔다)
    try {
      await supabase.from('sms_logs').insert({
        store_id:     storeId,
        kind:         'user_invite',
        body:         text || '(문구 생성 실패)',
        recipients:   [{
          account_code: selectedAccount.account_code,
          account_name: selectedAccount.account_name,
          name:         inviteTarget.name,
          phone:        inviteTarget.phone,
        }],
        sent_count:   ok,
        failed_count: failed,
        error:        failed > 0 ? lastError : null,
      })
    } catch (e) {
      console.error('sms_logs 기록 실패:', e)
    }

    setInviteSending(false)
    setInviteTarget(null)
    flash(ok ? `${inviteTarget.name}님께 등록 문자를 보냈어요` : `문자 발송에 실패했어요 — ${lastError}`)
  }

  // ── 옵션 ─────────────────────────────────────────────────────────────────
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
   * '가격(필수) - 파스타 샐러드' 처럼 선택지가 "10,400원" 하나뿐인 필수 그룹이 메뉴마다
   * 붙어 있다. 그건 메뉴값일 뿐 손님이 고르는 게 아닌데, 안 눌러주면 담기에서 막힌다.
   * 선택지가 2개 이상인 필수 그룹(베이스·소스 등)은 **건드리지 않는다**.
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
  const cartCount = cart.reduce((s, c) => s + c.qty, 0)
  const deliveryFeeNum = method === '배달' ? (parseInt(deliveryFee, 10) || 0) : 0
  const total = subtotal + deliveryFeeNum
  const balanceAfter = selectedAccount ? selectedAccount.current_balance - total : 0

  const s1 = { accountCode: selectedAccount?.account_code ?? null, ordererName }
  const s2 = { cartCount: cart.length }
  const s3 = { method, roadAddress }
  const advanceOk = canAdvance(step, s1, s2, s3)

  function goNext() {
    if (!advanceOk) return
    setErrorMsg('')
    if (step === 1) setStep(2)
    else if (step === 2) setStep(3)
    else handleSubmit()
  }

  async function handleSubmit() {
    if (!selectedAccount || submitting) return
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
    // [배달주소]/[배달상세]/[배달요청] 접두사를 읽는다. 손님이 QR웹으로 넣은
    // 주문과 같은 모양으로 적어야 한 화면에서 같이 읽힌다.
    const isDelivery = method === '배달'
    const noteParts: string[] = []
    if (isDelivery && roadAddress.trim())   noteParts.push(`[배달주소] ${roadAddress.trim()}`)
    if (isDelivery && detailAddress.trim()) noteParts.push(`[배달상세] ${detailAddress.trim()}`)
    if (isDelivery && deliveryNote.trim())  noteParts.push(`[배달요청] ${deliveryNote.trim()}`)
    if (storeNote.trim())                   noteParts.push(storeNote.trim())
    noteParts.push('구두주문 — POS 직접 입력')

    const { error } = await supabase.rpc('create_order', {
      p_account_code:  selectedAccount.account_code,
      p_orderer_name:  ordererName.trim(),
      p_method:        method,
      p_items:         items,
      p_delivery_fee:  deliveryFeeNum,
      p_orderer_phone: picked?.phone ?? null,
      p_note:          noteParts.join(' / '),
      // 전용 컬럼에도 같이 넣는다 — 주소로 집계하려면 note 파싱 말고 이게 필요하다
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

  // 하단 왼쪽에 늘 떠 있는 "누구의 주문인가" — 단계가 바뀌어도 사라지지 않는다
  const summary = selectedAccount && ordererName ? (
    <div className="min-w-0">
      <div className="text-[17px] font-extrabold text-ink truncate">
        {selectedAccount.account_name} · {ordererName}님
      </div>
      <div className="text-[12px] text-gray-text mt-[2px]">
        {METHODS.find(m => m.v === method)?.l}
        {cartCount > 0 && ` | ${cartCount}개`}
      </div>
    </div>
  ) : (
    <div className="text-[13px] text-gray-text">거래처와 주문자를 골라주세요</div>
  )

  /**
   * 바깥 클릭·Esc.
   *
   * 1단계는 **그냥 닫는다** — 거래처·주문자만 고른 상태라 다시 고르는 비용이 작고,
   * 피크타임에 확인 모달이 한 겹 더 뜨는 쪽이 더 거슬린다.
   * 2·3단계는 메뉴까지 쌓인 뒤라 한 번 묻는다.
   */
  function handleBackdropClose() {
    if (step === 1) onClose()
    else setConfirmQuit(true)
  }

  return (
    <ModalOverlay onClose={handleBackdropClose} z={50}>
      <div className="modal-in bg-white rounded-2xl shadow-xl w-[90vw] max-w-[1100px] h-[85vh] flex flex-col overflow-hidden relative">

        {/* ── 헤더 ── */}
        <div className="flex-shrink-0 px-6 py-4 border-b border-gray-border flex items-center gap-3">
          {/* 뒤로가기 — 1단계엔 돌아갈 곳이 없다. ✕ 는 없앴다(바깥을 누르면 닫힌다) */}
          {step > 1 && (
            <button
              onClick={() => { setStep(s => (s - 1) as VerbalStep); setErrorMsg('') }}
              className="pressable-soft flex-shrink-0 w-8 h-8 -ml-1 rounded-lg flex items-center justify-center text-[#6A635E] hover:bg-gray-bg transition-colors"
              aria-label="이전 단계로"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <div className="text-[17px] font-extrabold text-ink whitespace-nowrap">
            구두주문
          </div>

          {step === 1 ? (
            <input
              autoFocus
              value={accountQuery}
              onChange={e => setAccountQuery(e.target.value)}
              placeholder="거래처 또는 주문자를 입력하세요."
              className="flex-1 min-w-0 border border-gray-border rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#6A635E] transition-colors"
            />
          ) : step === 2 ? (
            <input
              value={menuQuery}
              onChange={e => setMenuQuery(e.target.value)}
              placeholder="메뉴를 입력하세요."
              className="flex-1 min-w-0 border border-gray-border rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#6A635E] transition-colors"
            />
          ) : <div className="flex-1" />}

          {/* 이용방법 — 1단계에선 오른쪽 '고객 확인' 위에서 고르고,
              그 뒤로는 여기 우상단에서 바꾼다 */}
          {step > 1 && (
            <div className="flex-shrink-0 flex gap-1">
              {METHODS.map(m => (
                <button
                  key={m.v}
                  onClick={() => setMethod(m.v)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors ${
                    method === m.v ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'
                  }`}
                >
                  {m.l}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ══════════ 1단계 — 거래처 · 주문자 ══════════ */}
        {step === 1 && (
          <div className="flex-1 flex overflow-hidden">
            {/* 좌: 유형 칩 + 거래처 목록 */}
            <div className="flex-1 min-w-0 border-r border-gray-border flex flex-col overflow-hidden">
              <div className="flex-shrink-0 flex gap-2 px-5 py-3">
                {TYPE_FILTERS.map(t => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    className={`pressable-soft flex-1 py-2 rounded-full text-[13px] font-bold transition-colors ${
                      typeFilter === t ? 'bg-[#6A635E] text-white' : 'bg-[#F2F2F2] text-[#6A635E] hover:bg-[#E8E4E2]'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto">
                {searchingAcct && accountResults.length === 0 ? (
                  <div className="text-[12px] text-gray-text text-center py-6">불러오는 중…</div>
                ) : accountResults.length === 0 ? (
                  <div className="text-[12px] text-gray-text text-center py-6">거래처가 없습니다.</div>
                ) : accountResults.map(acc => (
                  <button
                    key={acc.account_code}
                    onClick={() => {
                      if (selectedAccount?.account_code === acc.account_code) return
                      setSelectedAccount(acc)
                      setCart([])
                      setRevealName(false); setRevealPhone(false)
                      setErrorMsg('')
                    }}
                    className={`pressable-row w-full flex items-center justify-between gap-3 px-5 py-3 text-left border-b border-gray-border/60 ${
                      selectedAccount?.account_code === acc.account_code ? 'bg-[#E8E4E2]' : 'hover:bg-gray-bg/60'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold text-ink truncate">{acc.account_name}</div>
                      {/* 사람 이름으로 걸렸으면 누가 걸렸는지 적는다 — 동명이인일 때
                          어느 과인지 고르는 단서가 된다 */}
                      {(memberHits[acc.account_code]?.length ?? 0) > 0 && (
                        <div className="text-[11px] text-[#6A635E] truncate mt-[1px]">
                          {memberHits[acc.account_code].join(', ')}
                        </div>
                      )}
                    </div>
                    <span className={`text-[14px] font-semibold flex-shrink-0 tabular-nums ${
                      acc.current_balance < 0 ? 'text-[#3374FF]' : 'text-[#414141]'
                    }`}>
                      {won(acc.current_balance)}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* 우: 이용자 명단 + 추가 + 확인 카드 */}
            <div className="w-[400px] flex-shrink-0 flex flex-col overflow-hidden">
              {!selectedAccount ? (
                <div className="flex-1 flex items-center justify-center text-gray-text text-[13px] px-6 text-center">
                  왼쪽에서 거래처를 먼저 골라주세요
                </div>
              ) : (
                <>
                  {/* 주문자 — 버튼을 쫙 깔아 한 번에 하나만 고른다.
                      세로 한 줄씩 쌓으면 10명만 돼도 스크롤이 생겨서, 전화를 받으며
                      이름을 찾는 동안 눈이 목록을 훑어야 했다. 칩으로 깔면 한눈에 든다. */}
                  <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
                    {membersLoading ? (
                      <div className="text-[12px] text-gray-text text-center py-6">불러오는 중…</div>
                    ) : members.length === 0 ? (
                      <div className="text-[12px] text-[#ADADAD] text-center py-8 leading-relaxed">
                        아직 등록된 이용자가 없어요.<br />아래에서 추가해주세요
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {members.map(m => {
                          const on = picked?.id === m.id
                          return (
                            <button
                              key={m.id}
                              onClick={() => { setPicked(m); setRevealName(false); setRevealPhone(false) }}
                              className={`pressable-soft px-3.5 py-2 rounded-full text-[13px] transition-colors ${
                                on ? 'bg-ink text-white font-bold' : 'bg-[#F2F2F2] text-[#414141] hover:bg-[#E8E4E2]'
                              }`}
                            >
                              {m.name}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* 명단에 없는 손님 */}
                  <div className="flex-shrink-0 border-t border-gray-border px-5 py-3">
                    <div className="text-[12px] font-semibold text-[#414141] mb-2">
                      위 명단에 없나요? 고객을 추가해주세요.
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        value={newName}
                        onChange={e => { setNewName(e.target.value.slice(0, 20)); setErrorMsg('') }}
                        placeholder="이름"
                        className="w-[90px] flex-shrink-0 border border-gray-border rounded-lg px-2.5 py-2 text-[12px] outline-none focus:border-[#6A635E] transition-colors"
                      />
                      <input
                        value={newPhone}
                        onChange={e => { setNewPhone(formatPhoneInput(e.target.value)); setErrorMsg('') }}
                        inputMode="numeric"
                        placeholder="고객 전화번호"
                        className="flex-1 min-w-0 border border-gray-border rounded-lg px-2.5 py-2 text-[12px] outline-none focus:border-[#6A635E] transition-colors tabular-nums"
                      />
                      <button
                        onClick={addMember}
                        disabled={adding}
                        className="pressable-soft flex-shrink-0 px-3 py-2 rounded-lg bg-ink text-white text-[12px] font-bold disabled:opacity-40"
                      >
                        {adding ? '추가 중…' : '고객 추가하기'}
                      </button>
                    </div>
                  </div>

                  {/* 이용방법 — 2·3단계에선 우상단으로 올라간다 */}
                  <div className="flex-shrink-0 border-t border-gray-border px-5 pt-3">
                    <div className="flex gap-1.5">
                      {METHODS.map(m => (
                        <button
                          key={m.v}
                          onClick={() => setMethod(m.v)}
                          className={`pressable-soft flex-1 py-2.5 rounded-xl text-[13px] font-bold transition-colors ${
                            method === m.v ? 'bg-ink text-white' : 'bg-[#F2F2F2] text-[#6A635E] hover:bg-[#E8E4E2]'
                          }`}
                        >
                          {m.l}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 고른 사람 확인 */}
                  <div className="flex-shrink-0 px-5 py-3">
                    <div className="text-[12px] font-semibold text-[#414141] mb-2">
                      선택한 고객님을 확인해주세요.
                    </div>
                    <div className="bg-[#F2F2F2] rounded-[10px] divide-y divide-white/70">
                      <RevealRow
                        label="이름" value={picked?.name ?? ''} masked={maskName(picked?.name)}
                        open={revealName} onToggle={() => setRevealName(v => !v)}
                      />
                      <RevealRow
                        label="전화번호" value={picked?.phone ?? ''} masked={maskPhone(picked?.phone)}
                        open={revealPhone} onToggle={() => setRevealPhone(v => !v)}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ══════════ 2단계 — 메뉴 ══════════ */}
        {step === 2 && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-shrink-0 border-b border-gray-border flex items-center">
              <div className="no-scrollbar flex-1 min-w-0 flex gap-1.5 overflow-x-auto px-5 py-2.5">
                {[{ id: 'all', name: '전체' }, ...categories].map(cat => (
                  <button
                    key={cat.id}
                    ref={el => { catTabRefs.current[cat.id] = el }}
                    onClick={() => setCatId(cat.id)}
                    className={`px-3.5 py-2 rounded-full text-[12px] font-bold whitespace-nowrap flex-shrink-0 max-w-[140px] truncate transition-colors ${
                      catId === cat.id ? 'bg-[#6A635E] text-white' : 'bg-[#F2F2F2] text-[#6A635E] hover:bg-[#E8E4E2]'
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

            <div className="flex-1 overflow-y-auto p-4">
              {menuLoading ? (
                <div className="h-full flex items-center justify-center text-gray-text text-[12px]">메뉴 불러오는 중…</div>
              ) : visibleMenus().length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-text text-[12px]">
                  {menuQuery.trim() ? `'${menuQuery.trim()}' 에 맞는 메뉴가 없어요` : '표시할 메뉴가 없습니다.'}
                </div>
              ) : (
                <div className="grid grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {visibleMenus().map(menu => {
                    const inCart = cart.filter(c => c.menuId === menu.code).reduce((s, c) => s + c.qty, 0)
                    return (
                      <button
                        key={menu.code}
                        onClick={() => handleMenuTap(menu)}
                        className="pressable-soft relative text-left bg-gray-bg hover:bg-gray-100 rounded-xl p-3 transition-colors"
                      >
                        {inCart > 0 && (
                          <span className="absolute top-2 right-2 min-w-[20px] h-5 px-1.5 rounded-full bg-ink text-white text-[11px] font-bold flex items-center justify-center">
                            {inCart}
                          </span>
                        )}
                        <div className="text-[13px] font-bold text-ink leading-snug mb-1 pr-6">{menu.name}</div>
                        <div className="text-[12px] text-gray-text">{won(menu.price)}</div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════ 3단계 — 최종 확인 ══════════ */}
        {step === 3 && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* 담은 메뉴 */}
            <div>
              <div className="text-[13px] font-bold text-ink mb-2">주문 내역</div>
              <div className="border border-gray-border rounded-xl divide-y divide-gray-border/60 overflow-hidden">
                {cart.map(c => (
                  <div key={c.key} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-ink truncate">{c.menuName}</div>
                      {c.options.length > 0 && (
                        <div className="text-[11px] text-gray-text truncate mt-[2px]">
                          {c.options.map(o => o.name).join(', ')}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => updateQty(c.key, -1)}
                        className="w-7 h-7 rounded-lg bg-gray-100 text-ink font-bold text-[14px] hover:bg-gray-200 transition-colors"
                      >−</button>
                      <span className="text-[13px] font-bold text-ink w-5 text-center tabular-nums">{c.qty}</span>
                      <button
                        onClick={() => updateQty(c.key, 1)}
                        className="w-7 h-7 rounded-lg bg-gray-100 text-ink font-bold text-[14px] hover:bg-gray-200 transition-colors"
                      >+</button>
                    </div>
                    <div className="text-[13px] font-bold text-ink w-[90px] text-right tabular-nums flex-shrink-0">
                      {won(itemTotal(c))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 가게 요청사항 — 세 가지 이용방법 모두. '덜 맵게'는 포장·내점에도 온다 */}
            <div>
              <label className="text-[13px] font-bold text-ink mb-2 block">가게 요청사항</label>
              <input
                value={storeNote}
                onChange={e => setStoreNote(e.target.value)}
                placeholder="예: 덜 맵게, 수저 빼주세요"
                className="w-full border border-gray-border rounded-xl px-3.5 py-2.5 text-[13px] outline-none focus:border-[#6A635E] transition-colors"
              />
            </div>

            {/* 배달일 때만 — 주소와 배달 요청사항 */}
            {method === '배달' && (
              <>
                <div>
                  <label className="text-[13px] font-bold text-ink mb-2 block">
                    배달 주소 <span className="text-danger">*</span>
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPostcodeOpen(true)}
                      className={`pressable-soft flex-1 min-w-0 text-left border rounded-xl px-3.5 py-2.5 text-[13px] truncate ${
                        roadAddress ? 'border-gray-border text-ink' : 'border-dashed border-[#ADADAD] text-gray-text'
                      }`}
                    >
                      {roadAddress || '배달 주소 찾기'}
                    </button>
                    <input
                      value={detailAddress}
                      onChange={e => setDetailAddress(e.target.value)}
                      placeholder="세부주소 (동·호수)"
                      className="w-[200px] flex-shrink-0 border border-gray-border rounded-xl px-3.5 py-2.5 text-[13px] outline-none focus:border-[#6A635E] transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[13px] font-bold text-ink mb-2 block">배달 요청사항</label>
                  <input
                    value={deliveryNote}
                    onChange={e => setDeliveryNote(e.target.value)}
                    placeholder="예: 문 앞에 놔주세요, 벨 누르지 말아주세요"
                    className="w-full border border-gray-border rounded-xl px-3.5 py-2.5 text-[13px] outline-none focus:border-[#6A635E] transition-colors"
                  />
                </div>

                <div>
                  <label className="text-[13px] font-bold text-ink mb-2 block">배달료</label>
                  <input
                    type="number"
                    value={deliveryFee}
                    onChange={e => setDeliveryFee(e.target.value)}
                    placeholder="0"
                    className="w-[160px] border border-gray-border rounded-xl px-3.5 py-2.5 text-[13px] outline-none focus:border-[#6A635E] transition-colors tabular-nums"
                  />
                </div>
              </>
            )}

            {/* 금액 */}
            <div className="bg-gray-bg rounded-xl px-4 py-3 space-y-1.5">
              <div className="flex justify-between text-[12px] text-gray-text">
                <span>메뉴 소계</span><span className="tabular-nums">{won(subtotal)}</span>
              </div>
              {method === '배달' && (
                <div className="flex justify-between text-[12px] text-gray-text">
                  <span>배달료</span><span className="tabular-nums">{won(deliveryFeeNum)}</span>
                </div>
              )}
              <div className="flex justify-between text-[14px] font-extrabold text-ink pt-1.5 border-t border-gray-border">
                <span>합계</span><span className="tabular-nums">{won(total)}</span>
              </div>
              <div className="flex justify-between text-[12px] pt-0.5">
                <span className="text-gray-text">주문 후 잔액</span>
                <span className={`tabular-nums font-semibold ${balanceAfter < 0 ? 'text-danger' : 'text-gray-text'}`}>
                  {won(balanceAfter)}
                  {balanceAfter < 0 && <span className="ml-1 font-normal">· 다음 충전 시 정산</span>}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── 하단 바 ── */}
        <div className="flex-shrink-0 border-t border-gray-border px-6 py-4 flex items-center gap-4">
          {summary}
          <div className="ml-auto flex items-center gap-3 flex-shrink-0">
            {errorMsg && <span className="text-[12px] text-danger font-semibold">{errorMsg}</span>}
            {step > 1 && (
              <div className="text-right">
                <div className="text-[17px] font-extrabold text-ink tabular-nums">{won(total)}</div>
                {selectedAccount && (
                  <div className="text-[11px] text-gray-text tabular-nums">잔액: {won(selectedAccount.current_balance)}</div>
                )}
              </div>
            )}
            <button
              onClick={goNext}
              disabled={!advanceOk || submitting}
              className="pressable-soft px-8 py-3 rounded-xl bg-ink text-white font-bold text-[14px] disabled:opacity-40 hover:bg-ink/80 transition-colors flex items-center gap-2"
            >
              {submitting ? <Working label="주문 처리 중" /> : (
                <>
                  {/* 담긴 수 — QR오더 '장바구니 보기' 버튼의 그 배지와 같은 모양 */}
                  {cartCount > 0 && (
                    <span className="bg-black/20 rounded-lg px-2 py-0.5 text-[13px]">{cartCount}개</span>
                  )}
                  <span>{step === 3 ? '주문하기' : '다음'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── 그만두기 확인 — 2·3단계에서 바깥을 눌렀을 때 ── */}
        {confirmQuit && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30">
            <div className="modal-in bg-white rounded-2xl shadow-xl w-[320px] p-5">
              <div className="text-[15px] font-extrabold text-ink mb-2">구두주문을 그만하시겠습니까?</div>
              <p className="text-[12px] text-gray-text leading-relaxed mb-4">
                지금까지 고른 메뉴와 입력한 내용은 저장되지 않아요.
              </p>
              {/* 두 버튼은 붙여 둔다 — 사이를 띄우면 둘이 서로 다른 무게로 읽힌다 */}
              <div className="flex rounded-xl overflow-hidden">
                <button
                  onClick={() => setConfirmQuit(false)}
                  className="pressable-soft flex-1 py-2.5 bg-gray-100 text-gray-text font-bold text-[13px]"
                >
                  계속 하기
                </button>
                <button
                  onClick={onClose}
                  className="pressable-soft flex-1 py-2.5 bg-ink text-white font-bold text-[13px]"
                >
                  그만하기
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 토스트 ── */}
        {toast && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-[86px] z-20 bg-ink text-white text-[12px] font-semibold px-4 py-2.5 rounded-full shadow-lg whitespace-nowrap">
            {toast}
          </div>
        )}

        {/* ── 등록 문자 확인 — 자동으로 보내지 않는다 ── */}
        {inviteTarget && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30">
            <div className="modal-in bg-white rounded-2xl shadow-xl w-[360px] p-5">
              <div className="text-[15px] font-extrabold text-ink mb-2">등록 문자를 보낼까요?</div>
              <p className="text-[12px] text-gray-text leading-relaxed mb-3">
                {inviteTarget.name}님을 명단에 추가했어요.<br />
                아래 번호로 선결제 주문 등록 링크를 보냅니다.
              </p>
              <div className="bg-gray-bg rounded-lg px-3 py-2.5 mb-2 text-center">
                <span className="text-[15px] font-extrabold text-ink tabular-nums">
                  {formatPhoneInput(inviteTarget.phone)}
                </span>
              </div>
              <p className="text-[11px] text-[#ADADAD] leading-relaxed mb-4">
                번호가 맞는지 확인해주세요. 보낸 문자는 되돌릴 수 없어요.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setInviteTarget(null); flash(`${inviteTarget.name}님을 명단에 추가했어요`) }}
                  disabled={inviteSending}
                  className="pressable-soft flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-text font-bold text-[13px] disabled:opacity-40"
                >
                  안 보냄
                </button>
                <button
                  onClick={sendInvite}
                  disabled={inviteSending}
                  className="pressable-soft flex-1 py-2.5 rounded-xl bg-ink text-white font-bold text-[13px] disabled:opacity-40"
                >
                  {inviteSending ? <Working label="보내는 중" /> : '문자 보내기'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── 카테고리 전체 목록 ── */}
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

        {/* ── 옵션 선택 ── */}
        {optionPicker && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30" onClick={() => setOptionPicker(null)}>
            <div className="modal-in bg-white rounded-2xl shadow-xl w-[380px] max-h-[80%] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* 머리 — 메뉴명과 수량. 수량은 옵션 목록이 길어도 늘 보여야 한다
                  (전엔 목록 맨 아래에 있어서 스크롤을 끝까지 내려야 보였다) */}
              <div className="flex-shrink-0 px-5 pt-5 pb-3 border-b border-gray-border">
                <div className="text-[15px] font-extrabold text-ink mb-3">{optionPicker.name}</div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-bold text-ink">수량</span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setOptionQty(q => Math.max(1, q - 1))}
                      className="w-7 h-7 rounded-lg bg-gray-100 text-ink font-bold text-[14px] hover:bg-gray-200 transition-colors"
                    >−</button>
                    <span className="text-[14px] font-bold text-ink w-5 text-center tabular-nums">{optionQty}</span>
                    <button
                      onClick={() => setOptionQty(q => q + 1)}
                      className="w-7 h-7 rounded-lg bg-gray-100 text-ink font-bold text-[14px] hover:bg-gray-200 transition-colors"
                    >+</button>
                  </div>
                </div>
              </div>

              {/* 가운데 — 옵션 목록만 스크롤 */}
              <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-4">
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
                          /* pressable-soft — 전역 button:active 는 0.95 로 줄인다.
                             폭 340px 짜리 가로로 긴 줄에서는 좌우로 17px 씩 빨려들어가
                             "덜컹"거린다(index.css 의 .pressable-row 주석과 같은 문제). */
                          /* 선택돼도 **테두리는 그대로 둔다.** 테두리가 같이 진해지면
                             줄마다 굵기가 달라 보여서 목록이 들썩인다. 배경만 아주 살짝
                             브라운으로 내려앉히고, 켜졌다는 건 오른쪽 라디오·체크가 말한다. */
                          className={`pressable-soft w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-border text-[12px] transition-colors ${
                            checked ? 'bg-[#F4F0EC] font-semibold text-ink' : 'text-gray-text hover:bg-gray-bg'
                          } ${locked ? 'cursor-default' : ''}`}
                        >
                          <span className="flex-1 text-left">{it.name}</span>
                          {it.extra > 0 && <span className="tabular-nums">+{won(it.extra)}</span>}
                          {/* 단일선택은 원(라디오), 복수선택은 둥근 사각(체크박스) —
                              모양이 곧 "하나만 고르는 건지 여러 개 고르는 건지"를 말해준다. */}
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

              </div>

              {/* 발 — 늘 같은 자리에 고정. 옵션이 많아도 담기 버튼을 찾아 내려갈 일이 없다 */}
              <div className="flex-shrink-0 px-5 pt-3 pb-5 border-t border-gray-border">
                {errorMsg && <div className="text-[11px] text-danger font-semibold mb-2">{errorMsg}</div>}
                <div className="flex gap-2">
                  <button onClick={() => { setOptionPicker(null); setErrorMsg('') }} className="pressable-soft flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-text font-bold text-[13px]">
                    취소
                  </button>
                  <button onClick={confirmOptionPicker} className="pressable-soft flex-1 py-2.5 rounded-xl bg-ink text-white font-bold text-[13px]">
                    담기
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

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
