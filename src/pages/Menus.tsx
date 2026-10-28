import { useState, useEffect, useRef, useMemo } from 'react'
import { getCached, setCached } from '../lib/query-cache'
import { SegmentedControl } from '../components/SegmentedControl'
import { formatPriceDisplay, FloatingCellInput, FloatingCellTextarea, GhostButton, ModalCTAButton, StepperButton } from '../components/ModalFormControls'
import { type MenuDetail, type Category, type OptionGroup, type OptionItem } from '../lib/mock-data'
import { won } from '../lib/ipc'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store-context'
import { mapMenuRow } from '../lib/mappers'
import rotateIcon from '../assets/icons/rotate.svg'
import BottomToast, { TOAST_BOX } from '../components/BottomToast'
import MenuFormModal from '../components/menu/MenuFormModal'
import OptionGroupAddModal from '../components/menu/OptionGroupAddModal'
import { useMenuForm } from '../components/menu/use-menu-form'
import { MenuTagBadges, MenuTagRow } from '../components/menu/tag-badges'

type MenuTab      = 'menu' | 'option' | 'category'
import type { SoldOutState } from '../components/menu/menu-form-types'
import LoadingTimer from '../components/ui/LoadingTimer'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import ModalOverlay from '../components/ui/ModalOverlay'
import CategoryAddModal from '../components/ui/CategoryAddModal'
import {
  initHistory, pushHistory, undoHistory, redoHistory,
  canUndo, canRedo, currentOf, orderChanged, type EditHistory,
} from '../lib/edit-history'

/** 보기 모드 로컬 캐시 키 — 서버값(stores.menu_display_mode)이 올 때까지 쓴다 */
const MENU_MODE_KEY = 'sallaria_pos_menu_view_mode'

/**
 * 되돌리기 / 다시실행 한 쌍 — 카테고리 편집과 개별메뉴 편집이 같이 쓴다.
 *
 * 할 수 없을 때 **숨기지 않고 연하게** 둔다. 자리가 사라지면 버튼이 생겼다 없어졌다 해서
 * 눈이 그 자리를 매번 다시 찾는다. 편집 중 내내 같은 자리에 있어야 손이 기억한다.
 */
function UndoRedoPair({ canUndo, canRedo, onUndo, onRedo }: {
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void
}) {
  const BTNS = [
    { key: 'undo', on: canUndo, run: onUndo, label: '되돌리기',
      head: 'M9 5L4 10l5 5',  tail: 'M4 10h9a5 5 0 0 1 0 10H8' },
    { key: 'redo', on: canRedo, run: onRedo, label: '다시 실행',
      head: 'M15 5l5 5-5 5',  tail: 'M20 10h-9a5 5 0 0 0 0 10h5' },
  ] as const
  return (
    <>
      {BTNS.map(b => (
        <button
          key={b.key}
          onClick={b.run}
          disabled={!b.on}
          title={b.label}
          aria-label={b.label}
          className="pressable w-[26px] h-[24px] flex items-center justify-center disabled:cursor-default"
          style={{ opacity: b.on ? 1 : 0.3 }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d={b.head} stroke="#414449" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d={b.tail} stroke="#414449" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ))}
    </>
  )
}

// ── 품절 상태 헬퍼 ────────────────────────────────────────────────────────────
function getSoldOutState(soldOut: boolean, soldOutUntil: string | null | undefined): SoldOutState {
  if (!soldOut) return 'active'
  if (soldOutUntil) return 'today'
  return 'permanent'
}

// KST 오늘 자정 (23:59:59) ISO string 반환 (POS 앱은 KST 환경에서 실행)
function getKSTEndOfDay(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

// 옵션 항목별 수량 버튼(option_items.max_quantity) 설정은 걷어냈다.
// 4개월간 항목 493개 중 1개만 설정됐고 수량 2 이상 주문은 0건이었다.
// 컬럼과 QR웹 렌더링은 남겨뒀으니 되살리려면 이 설정 UI만 다시 넣으면 된다.

// 메뉴 태그 뱃지 — 인기/추천/신규 다중 표시 가능 (Figma Frame 126/127/128)


// 옵션 순서편집 — 포인터 기반 드래그 리오더 임계값 (Figma node 491:3881)
// Figma 원본(66/59) × FIGMA_SCALE — src/lib/figma-scale.ts 참고
const OPT_GROUP_ROW_H = 42
const OPT_ITEM_ROW_H = 38

// DB row → MenuDetail 변환은 lib/mappers.ts의 mapMenuRow 공용 (VerbalOrderModal.tsx와 공유)

// ── 스토어 옵션 그룹 (옵션 탭용) ─────────────────────────────────────────────
interface StoreOptionGroup {
  id:           string
  name:         string
  isRequired:   boolean
  isMulti:      boolean
  maxSelect:    number | null
  isSoldOut:    boolean
  soldOutUntil: string | null
  isHidden:     boolean
  usedBy:       string[]
  usedByMenus:  { name: string; soldOut: boolean; hidden: boolean }[]
  items:        OptionItem[]
}

export default function Menus() {
  const { storeId } = useStore()
  const [previewCatId, setPreviewCatId] = useState<string>('all')
  // 카테고리 빠른 선택 줄의 실제 높이 — 카드 그리드가 absolute 라 그만큼 아래로 밀어야 한다.
  // 개수에 따라 줄 수가 달라지므로 추정하지 않고 잰다.
  const pillBandRef = useRef<HTMLDivElement | null>(null)
  const [pillBandH, setPillBandH] = useState(0)
  useEffect(() => {
    const el = pillBandRef.current
    if (!el) { setPillBandH(0); return }
    const ro = new ResizeObserver(() => setPillBandH(el.offsetHeight))
    ro.observe(el)
    setPillBandH(el.offsetHeight)
    return () => ro.disconnect()
  })

  // QR오더 미리보기(iframe)와 좌측 카테고리 선택을 양방향으로 동기화.
  // postMessage는 "이 특정 부모창 ↔ 이 특정 iframe" 사이에서만 오가므로, 손님이 QR코드를 찍어
  // 최상위 탭으로 여는 실제 sallaria.web.app에는 전혀 영향 없음 — iframe 안에서 열렸을 때만 작동.
  const QR_ORIGIN = 'https://sallaria.web.app'
  const qrIframeRef = useRef<HTMLIFrameElement>(null)

  // 왼쪽에서 카테고리를 바꾸면 iframe에도 알림
  useEffect(() => {
    qrIframeRef.current?.contentWindow?.postMessage(
      { type: 'SUNPOS_SELECT_CATEGORY', categoryId: previewCatId === 'all' ? null : previewCatId },
      QR_ORIGIN
    )
  }, [previewCatId])

  // iframe(QR오더) 안에서 카테고리를 바꾸면 왼쪽도 따라감
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== QR_ORIGIN) return
      if (e.data?.type === 'SUNPOS_CATEGORY_CHANGED') {
        setPreviewCatId(e.data.categoryId || 'all')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  const [categoryAddOpen, setCategoryAddOpen] = useState(false)

  // 카테고리/개별메뉴 6열 그리드의 좌측 영역 실측 폭 — 창 크기에 따라 카드 폭을 다시 계산해서
  // 항상 사이드 패널까지 꽉 차게(고정 px로 하드코딩하면 창 크기가 다를 때마다 오른쪽에 빈 여백이 생김)
  const gridAreaRef = useRef<HTMLDivElement>(null)
  const [gridAreaW, setGridAreaW] = useState(1040)

  const [tab] = useState<MenuTab>('menu')   // 탭 전환은 상위(허브)가 맡아 setter 는 안 쓴다
  // 좌측은 항상 카테고리 그리드 — 우측 패널만 QR오더/개별메뉴 탭으로 전환 (Figma node 491:715/491:1346)
  const [rightTab, setRightTab] = useState<'qr' | 'items'>('qr')

  // ── 좌측 패널 표시 모드(카테고리/개별메뉴) + 화면편집 — Figma 491:592·491:2594·491:836 ──
  // 매장(store) 단위 설정 — 다른 PC에서 열어도 동일해야 해서 stores 테이블에 저장
  // 보기 모드는 **세 군데**가 맞물린다:
  //   · stores.menu_display_mode — 진실(다른 기기에서도 같게)
  //   · localStorage            — 서버 응답 전에 바로 그리기 위한 캐시
  //   · 이 state
  // localStorage 를 두는 이유: 서버값만 쓰면 매번 카테고리 모드로 한 번 그렸다가
  // 개별메뉴로 바뀌어서 화면이 깜빡인다.
  const [menuViewMode,     setMenuViewMode]     = useState<'category' | 'individual'>(() => {
    try {
      const v = localStorage.getItem(MENU_MODE_KEY)
      return v === 'individual' || v === 'category' ? v : 'category'
    } catch { return 'category' }
  })
  const [itemCountVisible, setItemCountVisible] = useState(true)
  const [categoryTextSize, setCategoryTextSize] = useState<'default' | 'large'>('default')
  const [menuEditMode,     setMenuEditMode]     = useState(false)
  const [editOrder,        setEditOrder]        = useState<Category[]>([]) // 완료 누르기 전까지는 로컬 임시 순서
  /**
   * 카테고리 편집 되돌리기/다시실행.
   *
   * 편집 모드의 순서는 '완료' 를 누르기 전까지 서버에 안 간다. 그래서 되돌리기는
   * 이 배열 스냅샷을 오가는 것으로 충분하다(서버 왕복 없음).
   *
   * ⚠️ 드래그 **중**에는 쌓지 않는다. onDragOver 는 마우스가 움직일 때마다 오므로
   *    그때마다 쌓으면 한 번 옮긴 걸 수십 번 되돌려야 한다. 놓는 순간 한 칸만 쌓는다.
   */
  const [catHist,  setCatHist]  = useState<EditHistory<Category>>(() => initHistory<Category>([]))
  const [menuHist, setMenuHist] = useState<EditHistory<MenuDetail>>(() => initHistory<MenuDetail>([]))
  /** 드래그 시작 시점의 순서 — 놓을 때 '바뀌었나' 를 판단하는 기준 */
  const dragStartOrderRef = useRef<Category[] | null>(null)
  const dragStartMenusRef = useRef<MenuDetail[] | null>(null)
  const [dragCatId,        setDragCatId]        = useState<string | null>(null)
  const [deleteCatConfirm, setDeleteCatConfirm] = useState<Category | null>(null)
  const [menuToast,        setMenuToast]        = useState<string | null>(null)

  // ── 개별메뉴 모드 화면편집 — Figma node 491:2927 ("개별메뉴 모드-순서편집기능- 메뉴") ──
  const [itemImageVisible, setItemImageVisible] = useState(true)
  const [menuTextSize,     setMenuTextSize]     = useState<'default' | 'large'>('default')
  const [editOrderMenus,   setEditOrderMenus]   = useState<MenuDetail[]>([]) // 완료 누르기 전까지는 로컬 임시 순서
  const [dragMenuCode,     setDragMenuCode]     = useState<string | null>(null)

  function showMenuToast(msg: string, ms = 2500) {
    setMenuToast(msg)
    setTimeout(() => setMenuToast(null), ms)
  }

  async function fetchMenuDisplayPrefs() {
    if (!storeId) return
    const { data } = await supabase
      .from('stores')
      .select('menu_display_mode, menu_item_count_visible, menu_category_text_size, menu_item_image_visible, menu_name_text_size')
      .eq('id', storeId)
      .maybeSingle()
    if (data) {
      const mode = data.menu_display_mode as 'category' | 'individual'
      setMenuViewMode(mode)
      try { localStorage.setItem(MENU_MODE_KEY, mode) } catch { /* 저장 못 해도 동작엔 지장 없다 */ }
      setItemCountVisible(data.menu_item_count_visible)
      setCategoryTextSize(data.menu_category_text_size as 'default' | 'large')
      setItemImageVisible(data.menu_item_image_visible)
      setMenuTextSize(data.menu_name_text_size as 'default' | 'large')
    }
  }

  async function toggleMenuViewMode() {
    const next = menuViewMode === 'category' ? 'individual' : 'category'
    setMenuViewMode(next)
    try { localStorage.setItem(MENU_MODE_KEY, next) } catch { /* 저장 못 해도 동작엔 지장 없다 */ }
    setOptionPanelMenu(null)
    showMenuToast(`보기 설정을 ${next === 'category' ? '카테고리' : '개별메뉴'} 모드로 전환했어요`)
    if (storeId) await supabase.from('stores').update({ menu_display_mode: next }).eq('id', storeId)
  }

  function enterMenuEditMode() {
    if (menuViewMode === 'individual') {
      const flattened = [...categories]
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .flatMap(cat => menus.filter(m => m.categoryId === cat.id))
      setEditOrderMenus(flattened)
      setMenuHist(initHistory(flattened))
      showMenuToast('카테고리 안에서 메뉴 박스를 잡고 옮기면 순서를 바꿀 수 있어요', 3500)
    } else {
      const initial = [...categories].sort((a, b) => a.displayOrder - b.displayOrder)
      setEditOrder(initial)
      setCatHist(initHistory(initial))   // 0번 칸이 '편집 전' — 여기까지만 되돌릴 수 있다
      showMenuToast('카테고리 박스를 잡고 옮기면 순서를 바꿀 수 있어요', 3500)
    }
    setMenuEditMode(true)
  }

  function cancelMenuEdit() {
    setMenuEditMode(false)
    fetchMenuDisplayPrefs() // 토글들도 임시로 바꿨을 수 있으니 서버값으로 되돌림
  }

  // 순서 저장은 id 개수만큼 개별 UPDATE를 날리던 게 느렸던 원인(N+1) — RPC로 한 번에 처리.
  // display_order 외 다른 저장(화면표시 토글)과도 독립적이라 Promise.all로 병렬 실행.
  async function confirmMenuEdit() {
    if (menuViewMode === 'individual') {
      await Promise.all([
        supabase.rpc('reorder_menus', { menu_ids: editOrderMenus.map(m => m.code) }),
        storeId ? supabase.from('stores').update({
          menu_item_image_visible: itemImageVisible,
          menu_name_text_size:     menuTextSize,
        }).eq('id', storeId) : Promise.resolve(),
      ])
      setMenus(editOrderMenus.map((m, i) => ({ ...m, order: i })))
    } else {
      await Promise.all([
        supabase.rpc('reorder_categories', { category_ids: editOrder.map(c => c.id) }),
        storeId ? supabase.from('stores').update({
          menu_item_count_visible: itemCountVisible,
          menu_category_text_size: categoryTextSize,
        }).eq('id', storeId) : Promise.resolve(),
      ])
      setCategories(editOrder.map((c, i) => ({ ...c, displayOrder: i })))
    }
    setMenuEditMode(false)
    showMenuToast('변경사항을 저장했어요', 2000)
  }

  // 되돌리기/다시실행 — 규칙은 lib/edit-history.ts 가 들고 있다(테스트도 거기).
  // 카테고리와 개별메뉴가 같은 규칙을 쓰므로 여기선 '어느 배열이냐' 만 다르다.
  function commitCatOrder(next: Category[]) {
    setEditOrder(next)
    setCatHist(h => pushHistory(h, next))
  }
  const canUndoCat = canUndo(catHist)
  const canRedoCat = canRedo(catHist)
  function undoCatOrder() { const h = undoHistory(catHist); setCatHist(h); setEditOrder(currentOf(h)) }
  function redoCatOrder() { const h = redoHistory(catHist); setCatHist(h); setEditOrder(currentOf(h)) }

  function commitMenuOrder(next: MenuDetail[]) {
    setEditOrderMenus(next)
    setMenuHist(h => pushHistory(h, next))
  }
  const canUndoMenu = canUndo(menuHist)
  const canRedoMenu = canRedo(menuHist)
  function undoMenuOrder() { const h = undoHistory(menuHist); setMenuHist(h); setEditOrderMenus(currentOf(h)) }
  function redoMenuOrder() { const h = redoHistory(menuHist); setMenuHist(h); setEditOrderMenus(currentOf(h)) }

  function handleCatDragOver(e: React.DragEvent, overId: string) {
    e.preventDefault()
    if (!dragCatId || dragCatId === overId) return
    setEditOrder(prev => {
      const from = prev.findIndex(c => c.id === dragCatId)
      const to = prev.findIndex(c => c.id === overId)
      if (from === -1 || to === -1) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  // 개별메뉴 모드 화면편집 — 메뉴 카드의 빨간 X 버튼 (Figma Group 90~96)
  function requestDeleteMenu(menu: MenuDetail) {
    setSelected(menu)
    setDeleteConfirm('single')
  }

  // 같은 카테고리 안에서만 재정렬 허용 (Figma: "카테고리 안에서 메뉴 박스를 잡고 옮기면...")
  function handleMenuDragOver(e: React.DragEvent, overCode: string) {
    e.preventDefault()
    if (!dragMenuCode || dragMenuCode === overCode) return
    setEditOrderMenus(prev => {
      const from = prev.findIndex(m => m.code === dragMenuCode)
      const to = prev.findIndex(m => m.code === overCode)
      if (from === -1 || to === -1 || prev[from].categoryId !== prev[to].categoryId) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  // 카테고리 삭제 — Figma node 491:1065 확인 다이얼로그("메뉴는 삭제되지 않아요") 그대로.
  // menus.category_id는 RESTRICT라 먼저 null로 풀어줘야 삭제 가능.
  async function confirmDeleteCategory(cat: Category) {
    // 이 UPDATE 가 실패하면 아래 DELETE 는 RESTRICT 에 걸려 어차피 실패한다 —
    // 그런데 전엔 결과를 버려서, 실제 원인("메뉴를 못 풀었다")이 아니라
    // 엉뚱한 외래키 메시지가 점주에게 그대로 떴다. 여기서 끊는다.
    const { error: orphanErr } = await supabase.from('menus').update({ category_id: null }).eq('category_id', cat.id)
    if (orphanErr) { alert('카테고리 삭제 실패 — 메뉴 연결을 풀지 못했어요: ' + orphanErr.message); return }
    const { error } = await supabase.from('categories').delete().eq('id', cat.id)
    if (error) { alert('카테고리 삭제 실패: ' + error.message); return }
    setMenus(prev => prev.map(m => m.categoryId === cat.id ? { ...m, categoryId: '' } : m))
    setCategories(prev => prev.filter(c => c.id !== cat.id))
    commitCatOrder(editOrder.filter(c => c.id !== cat.id))
    if (previewCatId === cat.id) setPreviewCatId('all')
    setDeleteCatConfirm(null)
  }

  // ── 우측 패널 "연결된 옵션" 요약 (Figma node 628:371) ────────────────────────
  function openOptionPanel(menu: MenuDetail) {
    setOptionPanelMenu(prev => prev?.code === menu.code ? null : menu)
    setOptionPanelExpandedGroupId(null)
  }

  // ── 옵션 순서편집 (Figma node 491:3881) ──────────────────────────────────────
  function enterOptionReorder() {
    if (!optionPanelMenu) return
    // 연결된 옵션이 하나도 없으면 편집할 게 없으니 안내만 하고 모드 진입 안 함
    if (optionPanelMenu.optionGroups.length === 0) {
      showMenuToast('연결된 옵션이 없어요. 메뉴를 수정해주세요', 3000)
      return
    }
    setReorderGroups(optionPanelMenu.optionGroups.map(g => ({ ...g, items: [...g.items] })))
    setReorderExpandedGroupId(null)
    setOptionReorderMode(true)
    showMenuToast('옵션 또는 옵션그룹을 잡고 순서를 편집하세요', 3000)
  }

  function cancelOptionReorder() {
    setOptionReorderMode(false)
    setReorderGroups([])
  }

  async function confirmOptionReorder() {
    if (!optionPanelMenu) return
    await Promise.all([
      ...reorderGroups.map((g, i) =>
        supabase.from('menu_option_groups').update({ display_order: i }).eq('menu_id', optionPanelMenu.code).eq('option_group_id', g.id)
      ),
      ...reorderGroups.flatMap(g => g.items.map((it, i) =>
        supabase.from('option_items').update({ display_order: i }).eq('id', it.id)
      )),
    ])
    const updated = { ...optionPanelMenu, optionGroups: reorderGroups }
    setOptionPanelMenu(updated)
    setMenus(prev => prev.map(m => m.code === updated.code ? updated : m))
    setOptionReorderMode(false)
    setReorderGroups([])
    showMenuToast('옵션 순서를 저장했어요', 2000)
  }

  // 옵션 순서편집 — 포인터 기반 커스텀 드래그(네이티브 HTML5 DnD 대신).
  // 이유: 네이티브 드래그는 브라우저 기본 고스트 이미지(텍스트만 보이는 문제)와
  // 커서 아이콘(초록 + 뱃지)을 띄워서 "칸 전체를 잡는" 느낌이 안 나고 커스텀 애니메이션도 불가능.
  const [optDrag,        setOptDrag]        = useState<{ kind: 'group'; id: string } | { kind: 'item'; id: string; groupId: string } | null>(null)
  const [optDragDeltaY,  setOptDragDeltaY]  = useState(0)
  const optDragStartYRef = useRef(0)
  // 스왑 임계값을 OPT_GROUP_ROW_H/OPT_ITEM_ROW_H 하드코딩 상수 대신, 드래그 시작 시점에 실제
  // row 엘리먼트의 렌더된 높이를 측정해서 쓴다 — 나중에 패딩/폰트 크기 등으로 row 높이가 바뀌어도
  // (상수를 깜빡하고 안 고쳐도) 드래그 감도가 안 깨지도록.
  const optDragRowHRef = useRef(OPT_GROUP_ROW_H)

  function startOptDrag(e: React.PointerEvent, info: { kind: 'group'; id: string } | { kind: 'item'; id: string; groupId: string }) {
    e.preventDefault()
    optDragStartYRef.current = e.clientY
    optDragRowHRef.current = e.currentTarget.getBoundingClientRect().height || (info.kind === 'group' ? OPT_GROUP_ROW_H : OPT_ITEM_ROW_H)
    setOptDragDeltaY(0)
    setOptDrag(info)
  }

  useEffect(() => {
    if (!optDrag) return
    // 이 영역은 더 이상 ScaledCanvas(transform:scale) 안에 있지 않으므로, 화면 px 이동량을 그대로 쓴다.

    function onMove(e: PointerEvent) {
      const delta = e.clientY - optDragStartYRef.current
      setOptDragDeltaY(delta)
      const threshold = optDragRowHRef.current / 2

      if (optDrag!.kind === 'group') {
        if (Math.abs(delta) < threshold) return
        const dir = delta > 0 ? 1 : -1
        setReorderGroups(prev => {
          const idx = prev.findIndex(g => g.id === optDrag!.id)
          const targetIdx = idx + dir
          if (idx === -1 || targetIdx < 0 || targetIdx >= prev.length) return prev
          const next = [...prev]
          const [moved] = next.splice(idx, 1)
          next.splice(targetIdx, 0, moved)
          return next
        })
        optDragStartYRef.current = e.clientY
        setOptDragDeltaY(0)
      } else {
        if (Math.abs(delta) < threshold) return
        const dir = delta > 0 ? 1 : -1
        const groupId = optDrag!.groupId
        setReorderGroups(prev => prev.map(g => {
          if (g.id !== groupId) return g
          const idx = g.items.findIndex(it => it.id === optDrag!.id)
          const targetIdx = idx + dir
          if (idx === -1 || targetIdx < 0 || targetIdx >= g.items.length) return g
          const items = [...g.items]
          const [moved] = items.splice(idx, 1)
          items.splice(targetIdx, 0, moved)
          return { ...g, items }
        }))
        optDragStartYRef.current = e.clientY
        setOptDragDeltaY(0)
      }
    }
    function onUp() {
      setOptDrag(null)
      setOptDragDeltaY(0)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [optDrag])

  const [menus,        setMenus]        = useState<MenuDetail[]>([])
  const [categories,   setCategories]   = useState<Category[]>([])
  const [storeGroups,  setStoreGroups]  = useState<StoreOptionGroup[]>([])
  const [search,       setSearch]       = useState('')
  const [catFilter,    setCatFilter]    = useState<string>('all')
  const [checked,      setChecked]      = useState<Set<string>>(new Set())
  const [selected,     setSelected]     = useState<MenuDetail | null>(null)
  const [loading,      setLoading]      = useState(true)

  // gridAreaRef가 가리키는 그리드 컨테이너는 loading이 끝나야 비로소 DOM에 마운트되므로, 마운트
  // 직후(deps: []) 한 번만 도는 effect로는 아직 null인 ref를 보고 그냥 종료돼 버린다 — loading이
  // false로 바뀐 뒤 다시 실행되도록 의존성에 포함해야 ResizeObserver가 실제로 등록된다.
  useEffect(() => {
    const el = gridAreaRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w) setGridAreaW(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading])

  // 우측 패널 "연결된 옵션" 요약 + 옵션 순서편집 (Figma node 628:371, 491:3881)
  const [optionPanelMenu,            setOptionPanelMenu]            = useState<MenuDetail | null>(null)
  const [optionPanelExpandedGroupId, setOptionPanelExpandedGroupId] = useState<string | null>(null)
  const [optionReorderMode,          setOptionReorderMode]          = useState(false)
  const [reorderGroups,              setReorderGroups]              = useState<OptionGroup[]>([])
  const [reorderExpandedGroupId,     setReorderExpandedGroupId]     = useState<string | null>(null)

  const [deleteConfirm, setDeleteConfirm] = useState<'bulk' | 'single' | null>(null)

  // 메뉴 추가/수정 모달 (Figma node 491:2237 "메뉴 상세")
  // 메뉴 추가/수정 폼 — 상태와 저장 로직은 use-menu-form 훅에 있다 (ProductHub 와 공용)
  const menuForm = useMenuForm({
    storeId,
    onCreated: menu => { setMenus(prev => [...prev, menu]); },
    onUpdated: menu => {
      applyLocalUpdate(menu)
      setOptionPanelMenu(prev => prev?.code === menu.code ? menu : prev)
    },
    showToast: msg => showMenuToast(msg, 2000),
  })

  const [addingStoreGroup, setAddingStoreGroup] = useState(false)

  const [addingCat,          setAddingCat]          = useState(false)
  const [newCatName,         setNewCatName]         = useState('')
  const [expandedCatId,      setExpandedCatId]      = useState<string | null>(null)
  const catRowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [catEditModalId,     setCatEditModalId]     = useState<string | null>(null)
  const [catEditNameDraft,   setCatEditNameDraft]   = useState('')
  const [catEditChecked,     setCatEditChecked]     = useState<Set<string>>(new Set())
  const [catEditSaving,      setCatEditSaving]      = useState(false)
  const [catEditSearch,      setCatEditSearch]      = useState('')
  const [dragId,             setDragId]             = useState<string | null>(null)
  const [dragOverId,         setDragOverId]         = useState<string | null>(null)
  const [catDeleteModalId,   setCatDeleteModalId]   = useState<string | null>(null)
  const [catDeleteRemap,     setCatDeleteRemap]     = useState<Record<string, string>>({}) // menuCode → 새 categoryId

  const [addMenuOpen,   setAddMenuOpen]   = useState(false)
  const [addModalTab,   setAddModalTab]   = useState<'bulk' | 'detail'>('bulk')
  const [addCategoryId, setAddCategoryId] = useState('')
  const [addingNewCat,  setAddingNewCat]  = useState(false)
  const [catFocused,    setCatFocused]    = useState(false)
  const [newCatInModal, setNewCatInModal] = useState('')
  // 일괄 추가
  const [addRows, setAddRows] = useState<{ id: string; name: string; price: string; imageFile?: File; imagePreview?: string }[]>([
    { id: crypto.randomUUID(), name: '', price: '', imageFile: undefined, imagePreview: '' },
  ])
  // 상세 추가
  const [detailForm, setDetailForm] = useState({ name: '', price: '', description: '' })
  const [imageFile,  setImageFile]  = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState('')
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [addError,   setAddError]   = useState('')
  const [addLoading, setAddLoading] = useState(false)

  // ── 옵션 탭 선택 상태 ─────────────────────────────────────────────────────
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  const [optionSearch, setOptionSearch] = useState('')
  const [optionFilter, setOptionFilter] = useState<'all' | 'active' | 'soldOut' | 'hidden'>('all')

  const [catJumpOpen, setCatJumpOpen] = useState(false)

  const filteredStoreGroups = useMemo(() => storeGroups.filter(g => {
    if (optionFilter === 'active')  return !g.isSoldOut && !g.isHidden && g.items.every(it => !it.soldOut && !it.hidden)
    if (optionFilter === 'soldOut') return g.isSoldOut || g.items.some(it => it.soldOut)
    if (optionFilter === 'hidden')  return g.isHidden  || g.items.some(it => it.hidden)
    return true
  }).filter(g => {
    if (!optionSearch.trim()) return true
    return g.name.includes(optionSearch) || g.items.some(it => it.name.includes(optionSearch))
  }), [storeGroups, optionFilter, optionSearch])

  // ── 카테고리 조회 ──────────────────────────────────────────────────────────
  async function fetchCategories(): Promise<Category[]> {
    if (!storeId) return []
    const { data } = await supabase
      .from('categories')
      .select('id, name, display_order')
      .eq('store_id', storeId)
      .order('display_order')
    const cats = (data ?? []).map((c: any): Category => ({
      id:           c.id,
      name:         c.name,
      displayOrder: c.display_order,
    }))
    setCategories(cats)
    return cats
  }

  // ── 메뉴 조회 ────────────────────────────────────────────────────────────
  //
  // 전에는 fetchCategories() 가 끝나야 그 id 들로 메뉴를 받았다(2단 웨이터폴).
  // 왕복 한 번이 90~120ms, 가끔 1초가 넘으므로 단계를 하나 줄이는 게 그대로 체감이 된다.
  // 2026-10-26: menus.store_id 가 생기면서 categories!inner 조인도 없앴다.
  // 조인이 있을 땐 **카테고리 없는 메뉴가 통째로 빠졌다** — inner join 이라서다.
  // 이제 카테고리를 안 고른 메뉴도 목록에 뜬다(화면에선 '미분류'로 묶인다).
  async function fetchMenus() {
    if (!storeId) { setMenus([]); return }
    const { data } = await supabase
      .from('menus')
      .select(`
        id, category_id, name, description, base_price, image_url,
        is_sold_out, sold_out_until, is_hidden, display_order, is_popular, is_recommended, is_new,
        menu_option_groups (
          display_order,
          option_groups (
            id, name, is_required, is_multi, max_select,
            option_items (
              id, name, extra_price, is_popular, is_sold_out, sold_out_until, is_hidden, display_order, max_quantity
            )
          )
        )
      `)
      .eq('store_id', storeId)
      .order('display_order')
    const mapped = (data ?? []).map(row => mapMenuRow(row))
    setMenus(mapped)
    return mapped
  }

  // ── 스토어 옵션 그룹 조회 (옵션 탭) ─────────────────────────────────────
  async function fetchStoreGroups() {
    if (!storeId) return
    const { data } = await supabase
      .from('option_groups')
      .select(`
        id, name, display_order, is_required, is_multi, max_select, is_sold_out, sold_out_until, is_hidden,
        option_items ( id, name, extra_price, is_sold_out, sold_out_until, is_hidden, display_order, max_quantity ),
        menu_option_groups ( menu_id, menus ( name, is_sold_out, is_hidden ) )
      `)
      .eq('store_id', storeId)
      .not('name', 'ilike', '가격(필수)%')
      .order('name')

    setStoreGroups((data ?? []).map((g: any) => ({
      id:           g.id,
      name:         g.name,
      isRequired:   g.is_required   ?? false,
      isMulti:      g.is_multi      ?? false,
      maxSelect:    g.max_select    ?? null,
      isSoldOut:    g.is_sold_out   ?? false,
      soldOutUntil: g.sold_out_until ?? null,
      isHidden:     g.is_hidden     ?? false,
      usedBy:     (g.menu_option_groups ?? []).map((m: any) => m.menus?.name).filter(Boolean),
      usedByMenus: (g.menu_option_groups ?? [])
        .map((m: any) => m.menus)
        .filter(Boolean)
        .map((m: any) => ({ name: m.name, soldOut: m.is_sold_out ?? false, hidden: m.is_hidden ?? false })),
      items: (g.option_items ?? [])
        .sort((a: any, b: any) => a.display_order - b.display_order)
        .map((it: any) => ({
          id:           it.id,
          name:         it.name,
          extra:        it.extra_price,
          soldOut:      it.is_sold_out,
          soldOutUntil: it.sold_out_until ?? null,
          hidden:       it.is_hidden,
          isPopular:    it.is_popular ?? false,
          maxQty:       it.max_quantity ?? null,
        })),
    })))
  }

  // ── 마운트 및 storeId 변경 시 로딩 ──────────────────────────────────────
  useEffect(() => {
    if (!storeId) return
    const key = `menus:${storeId}`

    async function load() {
      // 보기 설정(모드·토글들)은 **캐시를 타지 않는다.**
      // 캐시에 담긴 건 메뉴/카테고리 목록뿐인데, 캐시가 싱싱하면 아래에서 바로 return 하면서
      // 이 호출까지 건너뛰고 있었다. 그래서 개별메뉴 모드로 바꿔두고 다른 화면에 갔다 오면
      // 카테고리 모드로 되돌아가 있었다(캐시가 상한 뒤에 오면 멀쩡해서 더 헷갈렸다).
      // stores 한 행짜리 조회라 매번 해도 싸다.
      void fetchMenuDisplayPrefs()

      // 캐시가 있으면 **먼저 그려놓고** 뒤에서 갱신한다.
      // 탭을 옮길 때마다 화면이 언마운트돼 매번 처음부터 받던 걸 없앤다.
      const hit = getCached<{ cats: Category[]; menus: MenuDetail[] }>(key)
      if (hit) {
        setCategories(hit.data.cats)
        setMenus(hit.data.menus)
        setLoading(false)
        if (!hit.stale) return   // 충분히 최신이면 왕복 자체를 생략
      } else {
        setLoading(true)
      }

      // 셋 다 서로를 기다리지 않는다 — 한 웨이브로 끝낸다
      const [cats, menus] = await Promise.all([
        fetchCategories(),
        fetchMenus(),
        fetchStoreGroups(),
      ])
      if (cats && menus) setCached(key, { cats, menus })
      setLoading(false)
    }
    load()
  }, [storeId])

  // 캐시를 화면 상태와 자동으로 맞춘다.
  //
  // 메뉴를 고치는 지점이 열 군데가 넘는데(이름 수정·품절·순서·카테고리 이동·삭제…)
  // 그 하나하나에 invalidate() 를 붙이면 언젠가 하나를 빠뜨린다. 그러면 탭을 돌아왔을 때
  // 방금 고친 게 사라진 것처럼 보인다 — 가장 나쁜 종류의 버그다.
  // 상태가 곧 최신이므로 상태를 그대로 캐시에 흘려보낸다.
  useEffect(() => {
    if (!storeId || loading) return
    setCached(`menus:${storeId}`, { cats: categories, menus })
  }, [storeId, loading, categories, menus])

  function sortedCategories() {
    return [...categories].sort((a, b) => a.displayOrder - b.displayOrder)
  }

  // ── 선택 메뉴 로컬 업데이트 헬퍼 ──────────────────────────────────────────
  function applyLocalUpdate(updated: MenuDetail) {
    setMenus(prev => prev.map(m => m.code === updated.code ? updated : m))
    setSelected(updated)
  }

  // ── 카테고리 CRUD ──────────────────────────────────────────────────────────
  async function addCategory(name: string): Promise<Category | undefined> {
    if (!storeId) return
    const maxOrder = categories.reduce((m, c) => Math.max(m, c.displayOrder), 0)
    const { data, error } = await supabase
      .from('categories')
      .insert({ store_id: storeId, name: name.trim(), display_order: maxOrder + 1 })
      .select('id, name, display_order')
      .single()
    if (!error && data) {
      const created = { id: data.id, name: data.name, displayOrder: data.display_order }
      setCategories(prev => [...prev, created])
      return created
    }
    return undefined
  }

  // 새 카테고리 생성 + 선택된 메뉴들을 그 카테고리로 일괄 이동 (카테고리 추가 2단계 모달 전용)
  async function addCategoryWithMenus(name: string, menuCodes: Set<string>) {
    const created = await addCategory(name)
    if (!created || menuCodes.size === 0) return
    await Promise.all([...menuCodes].map(code => supabase.from('menus').update({ category_id: created.id }).eq('id', code)))
    setMenus(prev => prev.map(m => menuCodes.has(m.code) ? { ...m, categoryId: created.id } : m))
  }

  async function renameCategory(id: string, name: string) {
    const { error } = await supabase.from('categories').update({ name: name.trim() }).eq('id', id)
    if (error) { showMenuToast(`카테고리 이름 변경 실패: ${error.message}`, 3500); return }
    setCategories(prev => prev.map(c => c.id === id ? { ...c, name: name.trim() } : c))
  }

  async function saveCategoryEdit(catId: string, newName: string, menuCodes: Set<string>) {
    setCatEditSaving(true)
    // 이름 변경
    const cat = categories.find(c => c.id === catId)
    if (cat && cat.name !== newName.trim()) {
      await renameCategory(catId, newName.trim())
    }
    // 이 카테고리에 속해야 할 메뉴: menuCodes
    // 현재 이 카테고리에 있는 메뉴: menus.filter(m => m.categoryId === catId)
    const currentInCat = new Set(menus.filter(m => m.categoryId === catId).map(m => m.code))
    const toAdd    = [...menuCodes].filter(c => !currentInCat.has(c))
    const toRemove = [...currentInCat].filter(c => !menuCodes.has(c))
    await Promise.all([
      ...toAdd.map(c    => supabase.from('menus').update({ category_id: catId }).eq('id', c)),
      ...toRemove.map(c => supabase.from('menus').update({ category_id: null  }).eq('id', c)),
    ])
    const toAddSet    = new Set(toAdd)
    const toRemoveSet = new Set(toRemove)
    setMenus(prev => prev.map(m => {
      if (toAddSet.has(m.code))    return { ...m, categoryId: catId }
      if (toRemoveSet.has(m.code)) return { ...m, categoryId: null }
      return m
    }))
    setCatEditSaving(false)
    setCatEditModalId(null)
  }

  async function deleteCategory(id: string, remap: Record<string, string> = {}) {
    // 메뉴들을 새 카테고리로 이동
    const remapEntries = Object.entries(remap)
    if (remapEntries.length > 0) {
      const results = await Promise.all(
        remapEntries.map(([menuCode, newCatId]) =>
          supabase.from('menus').update({ category_id: newCatId }).eq('id', menuCode)
        )
      )
      const moveErr = results.find(r => r.error)?.error
      if (moveErr) { alert('메뉴 이동 실패: ' + moveErr.message); return }
      setMenus(prev => prev.map(m => remap[m.code] ? { ...m, categoryId: remap[m.code] } : m))
    }
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) { alert('카테고리 삭제 실패: ' + error.message); return }
    setCategories(prev => prev.filter(c => c.id !== id))
  }

  // ── 카테고리 드래그 앤 드롭 ─────────────────────────────────────────────────
  async function handleCatDrop(targetId: string) {
    if (!dragId || dragId === targetId) return
    const sorted = sortedCategories()
    const fromIdx = sorted.findIndex(c => c.id === dragId)
    const toIdx   = sorted.findIndex(c => c.id === targetId)
    if (fromIdx < 0 || toIdx < 0) return

    const reordered = [...sorted]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)

    const updates = reordered.map((c, i) => ({ id: c.id, order: i + 1 }))
    setCategories(prev => prev.map(c => {
      const u = updates.find(u => u.id === c.id)
      return u ? { ...c, displayOrder: u.order } : c
    }))
    await Promise.all(updates.map(u =>
      supabase.from('categories').update({ display_order: u.order }).eq('id', u.id)
    ))
  }

  // ── 메뉴 추가 ───────────────────────────────────────────────────────────────
  function addRowLine() {
    setAddRows(prev => [...prev, { id: crypto.randomUUID(), name: '', price: '', imageFile: undefined, imagePreview: '' }])
  }

  function removeRowLine(id: string) {
    setAddRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : prev)
  }

  function updateRow(id: string, field: 'name' | 'price', value: string) {
    setAddRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  function updateRowImage(id: string, file: File) {
    const preview = URL.createObjectURL(file)
    setAddRows(prev => prev.map(r => r.id === id ? { ...r, imageFile: file, imagePreview: preview } : r))
  }

  async function confirmAddMenu() {
    setAddError('')

    // 유효한 행만 추출 (이름 + 가격 둘 다 있어야 함)
    const validRows = addRows.filter(r => r.name.trim() && r.price.trim())
    if (validRows.length === 0) { setAddError('메뉴명과 가격을 입력해주세요.'); return }

    const invalidPrice = validRows.find(r => isNaN(parseInt(r.price, 10)) || parseInt(r.price, 10) < 0)
    if (invalidPrice) { setAddError('가격은 0 이상의 숫자여야 합니다.'); return }

    // 카테고리 처리
    let categoryId = addCategoryId
    if (addingNewCat) {
      if (!newCatInModal.trim()) { setAddError('카테고리 이름을 입력해주세요.'); return }
      const maxOrder = categories.reduce((m, c) => Math.max(m, c.displayOrder), 0)
      const { data: catData, error: catErr } = await supabase
        .from('categories')
        .insert({ store_id: storeId, name: newCatInModal.trim(), display_order: maxOrder + 1 })
        .select('id, name, display_order')
        .single()
      if (catErr || !catData) { setAddError('카테고리 생성에 실패했습니다: ' + catErr?.message); return }
      setCategories(prev => [...prev, { id: catData.id, name: catData.name, displayOrder: catData.display_order }])
      categoryId = catData.id
    }

    setAddLoading(true)
    const maxOrder = menus.reduce((m, mn) => Math.max(m, mn.order), 0)

    const inserts = validRows.map((r, i) => ({
      // store_id 가 소유의 기준이다. category_id 는 비어 있어도 된다 — '미분류'로 들어간다.
      store_id:      storeId,
      category_id:   categoryId || null,
      name:          r.name.trim(),
      base_price:    parseInt(r.price, 10),
      display_order: maxOrder + 1 + i,
    }))

    const { data, error } = await supabase
      .from('menus')
      .insert(inserts)
      .select('id, category_id, name, description, base_price, is_sold_out, is_hidden, display_order, is_popular, is_recommended, is_new')

    setAddLoading(false)

    if (error || !data) {
      setAddError('저장 실패: ' + (error?.message ?? '알 수 없는 오류'))
      return
    }

    const newMenus: MenuDetail[] = data.map(d => ({
      code:         d.id,
      name:         d.name,
      emoji:        '🍽️',
      price:        d.base_price,
      description:  d.description ?? '',
      categoryId:   d.category_id,
      active:       true,
      soldOut:      false,
      order:        d.display_order,
      isPopular:     d.is_popular     ?? false,
      isRecommended: d.is_recommended ?? false,
      isNew:         d.is_new         ?? false,
      optionGroups: [],
    }))

    // 이미지 업로드 (각 행에 이미지가 있으면)
    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i]
      if (!row.imageFile) continue
      const ext = row.imageFile.name.split('.').pop() ?? 'jpg'
      const { data: up, error: upErr } = await supabase.storage
        .from('menu-images')
        .upload(`${crypto.randomUUID()}.${ext}`, row.imageFile, { contentType: row.imageFile.type })
      if (!upErr && up) {
        const imageUrl = supabase.storage.from('menu-images').getPublicUrl(up.path).data.publicUrl
        await supabase.from('menus').update({ image_url: imageUrl }).eq('id', data[i].id)
        newMenus[i] = { ...newMenus[i], imageUrl }
      }
    }

    setMenus(prev => [...prev, ...newMenus])
    setSelected(newMenus[0])
    setAddMenuOpen(false)
  }

  // ── 상세 추가 ─────────────────────────────────────────────────────────────
  async function confirmDetailMenu() {
    setAddError('')
    const price = parseInt(detailForm.price, 10)
    if (!detailForm.name.trim()) { setAddError('메뉴명을 입력해주세요.'); return }
    if (isNaN(price) || price < 0)  { setAddError('가격을 올바르게 입력해주세요.'); return }
    let categoryId = addCategoryId
    if (addingNewCat) {
      if (!newCatInModal.trim()) { setAddError('카테고리 이름을 입력해주세요.'); return }
      const maxOrder = categories.reduce((m, c) => Math.max(m, c.displayOrder), 0)
      const { data: catData, error: catErr } = await supabase
        .from('categories')
        .insert({ store_id: storeId, name: newCatInModal.trim(), display_order: maxOrder + 1 })
        .select('id, name, display_order')
        .single()
      if (catErr || !catData) { setAddError('카테고리 생성 실패: ' + catErr?.message); return }
      setCategories(prev => [...prev, { id: catData.id, name: catData.name, displayOrder: catData.display_order }])
      categoryId = catData.id
    }
    setAddLoading(true)

    let imageUrl: string | null = null
    if (imageFile) {
      const ext = imageFile.name.split('.').pop() ?? 'jpg'
      const { data: up, error: upErr } = await supabase.storage
        .from('menu-images')
        .upload(`${crypto.randomUUID()}.${ext}`, imageFile, { contentType: imageFile.type })
      if (!upErr && up) {
        imageUrl = supabase.storage.from('menu-images').getPublicUrl(up.path).data.publicUrl
      }
    }

    const maxOrder = menus.reduce((m, mn) => Math.max(m, mn.order), 0)
    const { data, error } = await supabase
      .from('menus')
      .insert({
        store_id:      storeId,
        category_id:   categoryId || null,
        name:          detailForm.name.trim(),
        description:   detailForm.description.trim() || null,
        base_price:    price,
        display_order: maxOrder + 1,
        image_url:     imageUrl,
      })
      .select('id, category_id, name, description, base_price, is_sold_out, is_hidden, display_order, is_popular, is_recommended, is_new')
      .single()

    if (error || !data) { setAddLoading(false); setAddError('저장 실패: ' + error?.message); return }

    if (selectedGroupIds.length > 0) {
      await Promise.all(selectedGroupIds.map((gid, i) =>
        supabase.from('menu_option_groups').insert({ menu_id: data.id, option_group_id: gid, display_order: i })
      ))
    }

    const newMenu: MenuDetail = {
      code:         data.id,
      name:         data.name,
      emoji:        '🍽️',
      price:        data.base_price,
      description:  data.description ?? '',
      imageUrl:     imageUrl ?? undefined,
      categoryId:   data.category_id,
      active:       true,
      soldOut:      false,
      order:        data.display_order,
      isPopular:     data.is_popular     ?? false,
      isRecommended: data.is_recommended ?? false,
      isNew:         data.is_new         ?? false,
      optionGroups: selectedGroupIds.map(gid => {
        const g = storeGroups.find(sg => sg.id === gid)
        return g ? { id: g.id, name: g.name, isRequired: false, isMulti: false, maxSelect: null,
          items: g.items.map(it => ({ ...it, isPopular: false })) } : null
      }).filter(Boolean) as OptionGroup[],
    }
    setMenus(prev => [...prev, newMenu])
    setSelected(newMenu)
    setAddLoading(false)
    setAddMenuOpen(false)
  }

  // ── 메뉴 추가/수정 모달 열기 (Figma node 491:2237) ──────────────────────────
  // 폼 상태·저장은 menuForm 훅이 들고 있다. 여기서는 "어느 메뉴를 열지"만 정한다.
  function openMenuFormEdit(menu: MenuDetail) {
    setSelected(menu)
    menuForm.openEdit(menu)
  }

  function openMenuFormAdd() {
    setSelected(null)
    menuForm.openAdd(selectedCatForAdd()?.id ?? sortedCategories()[0]?.id ?? '')
  }

  function selectedCatForAdd(): Category | undefined {
    return categories.find(c => c.id === previewCatId)
  }


  async function updateStoreGroup(groupId: string, updates: Partial<OptionGroup>) {
    const dbUpdates: Record<string, any> = {}
    if (updates.name       !== undefined) dbUpdates.name        = updates.name
    if (updates.isRequired !== undefined) dbUpdates.is_required = updates.isRequired
    if (updates.isMulti    !== undefined) dbUpdates.is_multi    = updates.isMulti
    if (updates.maxSelect  !== undefined) dbUpdates.max_select  = updates.maxSelect
    if ((updates as any).isSoldOut  !== undefined) dbUpdates.is_sold_out = (updates as any).isSoldOut
    if (Object.keys(dbUpdates).length > 0) {
      const { error } = await supabase.from('option_groups').update(dbUpdates).eq('id', groupId)
      // ⚠️ 실패했으면 화면도 바꾸지 않는다.
      // 전엔 결과를 버리고 아래 setStoreGroups 를 무조건 실행했다 — 서버가 끊기면
      // 화면만 바뀌고 DB 는 그대로라, 새로고침 전까지 점주는 저장된 줄 안다.
      if (error) { showMenuToast(`옵션 저장 실패: ${error.message}`, 3500); return }
    }
    setStoreGroups(prev => prev.map(g => g.id !== groupId ? g : { ...g, ...updates }))
  }

  async function deleteStoreGroup(groupId: string) {
    const { error } = await supabase.from('option_groups').delete().eq('id', groupId)
    // 삭제가 실패했는데 목록에서 사라지면, 점주는 지운 줄 알고 넘어간다.
    if (error) { showMenuToast(`옵션 삭제 실패: ${error.message}`, 3500); return }
    setStoreGroups(prev => prev.filter(g => g.id !== groupId))
    // 이 그룹이 연결된 selected 메뉴가 있으면 로컬에서도 제거
    if (selected) {
      applyLocalUpdate({ ...selected, optionGroups: selected.optionGroups.filter(g => g.id !== groupId) })
    }
  }

  async function setGroupSoldOutState(groupId: string, state: SoldOutState) {
    const updates =
      state === 'active'  ? { is_sold_out: false, sold_out_until: null            }
      : state === 'today' ? { is_sold_out: true,  sold_out_until: getKSTEndOfDay() }
      :                     { is_sold_out: true,  sold_out_until: null             }
    const { error } = await supabase.from('option_groups').update(updates).eq('id', groupId)
    // ⚠️ 품절은 조용히 실패하면 안 되는 경로다. POS 에는 '품절'로 보이는데 DB 가
    //    안 바뀌면 QR웹은 계속 그 옵션을 팔고, 없는 걸 주문받게 된다.
    if (error) { showMenuToast(`품절 처리 실패: ${error.message}`, 3500); return }
    const localPatch = { isSoldOut: state !== 'active', soldOutUntil: state === 'today' ? getKSTEndOfDay() : null }
    setStoreGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...localPatch } : g))
    // 메뉴 상세 모달에서도 반영 (가격(필수) 등 storeGroups에 없는 그룹 대응)
    setSelected(prev => {
      if (!prev) return null
      return { ...prev, optionGroups: prev.optionGroups.map(g => g.id === groupId ? { ...g, ...localPatch } : g) }
    })
  }

  async function toggleGroupHidden(groupId: string) {
    // storeGroups에 있는 그룹은 현재값에서 toggle, 없는 그룹(가격(필수) 등)은 selected에서 읽음
    const sgGroup = storeGroups.find(g => g.id === groupId)
    const selGroup = selected?.optionGroups.find(g => g.id === groupId)
    const currentHidden = sgGroup?.isHidden ?? (selGroup as any)?.isHidden ?? false
    const next = !currentHidden
    const { error } = await supabase.from('option_groups').update({ is_hidden: next }).eq('id', groupId)
    // 숨김도 손님 화면에 바로 영향을 준다 — 실패를 삼키지 않는다.
    if (error) { showMenuToast(`숨김 처리 실패: ${error.message}`, 3500); return }
    setStoreGroups(prev => prev.map(g => g.id === groupId ? { ...g, isHidden: next } : g))
    setSelected(prev => {
      if (!prev) return null
      return { ...prev, optionGroups: prev.optionGroups.map(g => g.id === groupId ? { ...g, isHidden: next } as any : g) }
    })
  }

  async function reorderStoreItem(groupId: string, fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return
    const group = storeGroups.find(g => g.id === groupId)
    if (!group) return
    const items = [...group.items]
    const [moved] = items.splice(fromIdx, 1)
    items.splice(toIdx, 0, moved)
    setStoreGroups(prev => prev.map(g => g.id !== groupId ? g : { ...g, items }))
    await Promise.all(items.map((it, i) =>
      supabase.from('option_items').update({ display_order: i }).eq('id', it.id)
    ))
  }

  async function addStoreItem(groupId: string, name: string, extra: number): Promise<OptionItem | null> {
    const grp = storeGroups.find(g => g.id === groupId)
    const maxOrder = grp?.items.length ?? 0
    const { data, error } = await supabase
      .from('option_items')
      .insert({ option_group_id: groupId, name, extra_price: extra, display_order: maxOrder })
      .select('id, name, extra_price, is_popular, is_sold_out, is_hidden, display_order, max_quantity')
      .single()
    if (error || !data) { console.error(error); return null }
    const item: OptionItem = { id: data.id, name: data.name, extra: data.extra_price,
      soldOut: data.is_sold_out, soldOutUntil: null, hidden: data.is_hidden, isPopular: data.is_popular,
      maxQty: data.max_quantity ?? null }
    setStoreGroups(prev => prev.map(g => g.id !== groupId ? g : { ...g, items: [...g.items, item] }))
    return item
  }

  async function updateStoreItem(groupId: string, itemId: string, updates: Partial<OptionItem>) {
    const dbUpdates: Record<string, any> = {}
    if (updates.name         !== undefined) dbUpdates.name          = updates.name
    if (updates.extra        !== undefined) dbUpdates.extra_price   = updates.extra
    if (updates.soldOut      !== undefined) dbUpdates.is_sold_out   = updates.soldOut
    if (updates.soldOutUntil !== undefined) dbUpdates.sold_out_until = updates.soldOutUntil ?? null
    if (updates.hidden       !== undefined) dbUpdates.is_hidden     = updates.hidden
    if (updates.isPopular    !== undefined) dbUpdates.is_popular    = updates.isPopular
    if (Object.keys(dbUpdates).length > 0) {
      const { error } = await supabase.from('option_items').update(dbUpdates).eq('id', itemId)
      // 옵션 항목의 가격·품절은 손님이 보는 값이다 — 실패를 삼키면 화면과 DB가 갈린다.
      if (error) { showMenuToast(`옵션 항목 저장 실패: ${error.message}`, 3500); return }
    }
    setStoreGroups(prev => prev.map(g =>
      g.id !== groupId ? g : { ...g, items: g.items.map(it => it.id !== itemId ? it : { ...it, ...updates }) }
    ))
  }

  async function deleteStoreItem(groupId: string, itemId: string) {
    const { error } = await supabase.from('option_items').delete().eq('id', itemId)
    if (error) { showMenuToast(`옵션 항목 삭제 실패: ${error.message}`, 3500); return }
    setStoreGroups(prev => prev.map(g =>
      g.id !== groupId ? g : { ...g, items: g.items.filter(it => it.id !== itemId) }
    ))
  }

  // ── 일괄 액션 ──────────────────────────────────────────────────────────────
  async function bulkAction(action: 'soldOut' | 'unsoldOut' | 'todaySoldOut' | 'hide' | 'unhide') {
    const codes = [...checked]
    const updates =
      action === 'soldOut'        ? { is_sold_out: true,  sold_out_until: null           }
      : action === 'unsoldOut'    ? { is_sold_out: false, sold_out_until: null           }
      : action === 'todaySoldOut' ? { is_sold_out: true,  sold_out_until: getKSTEndOfDay() }
      : action === 'hide'         ? { is_hidden: true  }
      :                             { is_hidden: false }

    // DB 업데이트 (개별)
    await Promise.all(codes.map(code =>
      supabase.from('menus').update(updates).eq('id', code)
    ))

    setMenus(prev => prev.map(m => {
      if (!checked.has(m.code)) return m
      if (action === 'soldOut')        return { ...m, soldOut: true,  soldOutUntil: null             }
      if (action === 'unsoldOut')      return { ...m, soldOut: false, soldOutUntil: null             }
      if (action === 'todaySoldOut')   return { ...m, soldOut: true,  soldOutUntil: getKSTEndOfDay() }
      if (action === 'hide')           return { ...m, active: false  }
      return { ...m, active: true }
    }))
    if (selected && checked.has(selected.code)) {
      setSelected(prev => {
        if (!prev) return null
        if (action === 'soldOut')        return { ...prev, soldOut: true,  soldOutUntil: null             }
        if (action === 'unsoldOut')      return { ...prev, soldOut: false, soldOutUntil: null             }
        if (action === 'todaySoldOut')   return { ...prev, soldOut: true,  soldOutUntil: getKSTEndOfDay() }
        if (action === 'hide')           return { ...prev, active: false  }
        return { ...prev, active: true }
      })
    }
    setChecked(new Set())
  }

  async function deleteMenus(codes: string[]) {
    await Promise.all(codes.map(code => supabase.from('menus').delete().eq('id', code)))
    setMenus(prev => prev.filter(m => !codes.includes(m.code)))
    commitMenuOrder(editOrderMenus.filter(m => !codes.includes(m.code)))
    if (selected && codes.includes(selected.code)) {
      setSelected(null)
      menuForm.close()
    }
    setChecked(new Set())
    setDeleteConfirm(null)
  }

  // ── 옵션 탭: 스토어 단위 품절/숨김 토글 ──────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-gray-100 overflow-hidden relative">

      {/* 로딩 */}
      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <LoadingTimer size={40} />
        </div>
      )}

      {/* ── 메뉴 탭 — 좌측 카테고리 그리드(항상 고정) + 우측 QR오더/개별메뉴 탭 (Figma node 491:592, 491:715, 491:836, 491:1346) ── */}
      {!loading && tab === 'menu' && (() => {
        const COLS = 6
        const GRID_PAD = 26
        const GRID_GAP = 10
        // 좌측 영역 실측 폭(gridAreaW) 기준으로 카드 폭을 매번 다시 계산 — 창 크기가 달라져도
        // 항상 좌우 GRID_PAD만큼의 패딩만 남기고 6열이 꽉 차도록(고정 px면 창이 넓을 때 사이드
        // 패널 앞에 큰 여백이 남았음)
        const CARD_W = Math.max(80, Math.round((gridAreaW - GRID_PAD * 2 - GRID_GAP * (COLS - 1)) / COLS))
        const COL_STEP = CARD_W + GRID_GAP
        const countOf = (catId: string) => menus.filter(m => m.categoryId === catId).length
        const selectedCat = categories.find(c => c.id === previewCatId) ?? null
        const itemsOfSelectedCat = selectedCat ? menus.filter(m => m.categoryId === selectedCat.id) : []
        const catTextSizeClass = categoryTextSize === 'large' ? 'text-[17px]' : 'text-[14px]'
        const listForLeft = menuEditMode ? editOrder : categories

        // 개별메뉴 모드 — 카테고리별 제목 + 6열 카드 묶음, 모든 px는 Figma 원본 × FIGMA_SCALE
        // — src/lib/figma-scale.ts 참고. 행 높이는 이제 CSS Grid가 자동으로 처리하므로
        // (카드 높이가 메뉴이름 줄바꿈에 따라 달라져도 같은 행끼리 stretch로 맞춰짐) 좌표 계산은
        // 그룹 시작 위치(첫 카테고리 상단 여백/제목-카드 간격/그룹 간 간격)만 필요.
        const INDIV_FIRST_TOP   = 73
        /** 개별메뉴 **편집** 모드의 상단 여백 — 되돌리기 줄(66~90) 아래에서 시작한다 */
        const INDIV_EDIT_TOP    = 101
        /**
         * 카테고리 편집 그리드의 첫 줄 top.
         *
         * 70 → 98 로 내렸다. 그리드 바로 위에 되돌리기/다시실행 줄(높이 24)이 들어가는데,
         * 70 이면 그 줄이 y=42 에 놓여 **상단 고정 띠(height 59, z-10)** 밑으로 들어간다.
         * 띠 아래(59)에서 시작해 버튼 24 + 간격 15 = 98.
         */
        const CAT_EDIT_TOP      = 98
        /** 되돌리기 줄의 top — 띠(59) 바로 아래 */
        const CAT_UNDO_TOP      = 66
        const INDIV_HEADING_GAP = 29
        const INDIV_GROUP_GAP   = 24
        const individualGroups = categories
          .slice()
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .reduce<{ cat: Category; items: MenuDetail[] }[]>((acc, cat) => {
            const items = menus.filter(m => m.categoryId === cat.id)
            if (items.length === 0) return acc
            acc.push({ cat, items })
            return acc
          }, [])

        // 카테고리를 안 고른 메뉴 — 맨 뒤에 '미분류'로 묶는다.
        // 2026-10-26 menus.store_id 가 생기기 전엔 이런 메뉴를 만들 수도, 조회할 수도
        // 없었다(RLS 가 category_id 로 소유를 판단했다). 이제 만들 수 있으니 보일 자리도
        // 있어야 한다 — 안 그러면 "저장은 됐다는데 어디에도 없는" 메뉴가 된다.
        // 진짜 카테고리가 아니므로 편집/순서변경 대상인 좌측 카테고리 카드에는 넣지 않는다.
        const uncategorized = menus.filter(m => !m.categoryId)
        if (uncategorized.length > 0) {
          individualGroups.push({
            cat: { id: '__uncategorized__', name: '미분류', displayOrder: Number.MAX_SAFE_INTEGER },
            items: uncategorized,
          })
        }

        return (
          <div className="relative bg-gray-100 flex flex-1 overflow-hidden min-h-0">
            {/* 좌측: 카테고리 카드 그리드 / 개별메뉴 그리드 / 편집모드 그리드 — 검색창+버튼 영역은 고정, 그 아래만 스크롤 */}
            <div ref={gridAreaRef} className="relative flex-1 min-w-0 overflow-hidden">
              {/* 검색창 + 모드/편집 버튼 — 고정 영역 (뒤의 스크롤 콘텐츠를 가리도록 배경 깔고 z-index 위로) */}
              <div className="absolute bg-gray-100" style={{ left: 0, top: 0, right: 0, height: 59, zIndex: 10 }} />
              {/* 검색창 */}
              <div className="field-wrap absolute border border-[#ADADAD] rounded-[15px] bg-white flex items-center px-[13px] gap-[8px]" style={{ left: 26, top: 17, width: 250, height: 31, zIndex: 11 }}>
                <svg width="14" height="14" viewBox="0 0 22 22" fill="none"><circle cx="9" cy="9" r="7" stroke="#8C8379" strokeWidth="2"/><path d="M14 14L19 19" stroke="#8C8379" strokeWidth="2" strokeLinecap="round"/></svg>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="메뉴이름, 카테고리 검색"
                  className="field-bare flex-1 min-w-0 outline-none focus-visible:outline-none text-[13px] text-ink placeholder:text-[#8C8379] bg-transparent"
                />
              </div>

              {/* 카테고리 추가 / 메뉴 추가 — 현재 모드에 맞는 것만 노출 + "모드 변경"/화면편집. flex-gap으로 버튼 간 간격 항상 동일 — 편집모드일 땐 숨김 */}
              {!menuEditMode && (
                <div className="absolute flex items-center gap-[8px]" style={{ right: 17, top: -2, zIndex: 11 }}>
                  <button
                    onClick={toggleMenuViewMode}
                    className="hover-chip flex items-center gap-[4px] text-[13px] text-[#6A635E] whitespace-nowrap hover:text-ink"
                  >
                    모드 변경
                    <img src={rotateIcon} alt="" width={13} height={13} />
                  </button>
                  <button
                    onClick={enterMenuEditMode}
                    className="hover-chip flex items-center gap-[4px] text-[13px] text-[#6A635E] whitespace-nowrap hover:text-ink"
                  >
                    화면 편집 ✎
                  </button>
                  {menuViewMode === 'category' ? (
                    <button
                      onClick={() => setCategoryAddOpen(true)}
                      className="hover-chip flex items-center gap-[4px] text-[13px] text-[#6A635E] whitespace-nowrap hover:text-ink"
                    >
                      카테고리 추가
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" stroke="#6A635E" strokeWidth="2"/><path d="M12 7V17M7 12H17" stroke="#6A635E" strokeWidth="2" strokeLinecap="round"/></svg>
                    </button>
                  ) : (
                    <button
                      onClick={openMenuFormAdd}
                      className="hover-chip flex items-center gap-[4px] text-[13px] text-[#6A635E] whitespace-nowrap hover:text-ink"
                    >
                      메뉴 추가
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" stroke="#6A635E" strokeWidth="2"/><path d="M12 7V17M7 12H17" stroke="#6A635E" strokeWidth="2" strokeLinecap="round"/></svg>
                    </button>
                  )}
                </div>
              )}

              {/* 검색창/버튼 아래 — 이 영역만 스크롤. 맨 아래 메뉴/카테고리 박스가 화면 바닥에
                   바로 붙어 보이지 않도록 padding-bottom 확보 */}
              <div className="absolute overflow-y-auto pb-[26px]" style={{ left: 0, top: 0, right: 0, bottom: 0 }}>

              {/* 카테고리 빠른 선택 — 검색창 바로 아래.
                  카드 그리드만 있으면 아래로 스크롤한 뒤에는 어느 분류를 보고 있는지,
                  다른 분류로 어떻게 가는지가 안 보인다. 카드는 '개수·편집'용으로 두고
                  전환은 이 줄에서 한다. 줄 수가 늘어도 카드가 겹치지 않도록 높이를 재서 민다. */}
              {menuViewMode === 'category' && !menuEditMode && categories.length > 0 && (
                <div ref={pillBandRef} className="absolute flex flex-wrap gap-[6px]" style={{ left: 26, right: 26, top: 62 }}>
                  {[{ id: 'all', name: '전체' }, ...sortedCategories()].map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setPreviewCatId(c.id); setOptionPanelMenu(null) }}
                      className={`pressable-tab h-[30px] px-[13px] rounded-[15px] text-[13px] whitespace-nowrap transition-colors ${
                        previewCatId === c.id
                          ? 'bg-[#6A635E] text-[#FCFCFC] font-medium'
                          : 'bg-[#F2F2F2] text-[#787878] hover:bg-[#E8E4E2]'
                      }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}

              {/* 카테고리 모드 — 일반 보기(고정 그리드) */}
              {menuViewMode === 'category' && !menuEditMode && (
                listForLeft.length === 0 ? (
                  <div className="absolute text-[13px] text-[#ADADAD]" style={{ left: 26, top: 71 + pillBandH }}>
                    아직 등록된 카테고리가 없습니다.
                  </div>
                ) : listForLeft.map((cat, i) => {
                  const col = i % COLS
                  const row = Math.floor(i / COLS)
                  return (
                    <button
                      key={cat.id}
                      onClick={() => { setPreviewCatId(cat.id); setOptionPanelMenu(null) }}
                      className={`absolute rounded-[13px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] text-left transition-colors ${
                        previewCatId === cat.id ? 'bg-[#E5E5E5]' : 'bg-[#FCFCFC]'
                      }`}
                      style={{ left: GRID_PAD + col * COL_STEP, top: 62 + pillBandH + 12 + row * 123, width: CARD_W, height: 117 }}
                    >
                      <div className={`absolute ${catTextSizeClass} font-semibold text-ink leading-snug`} style={{ left: 10, top: 10, right: 10 }}>
                        {cat.name}
                      </div>
                      {itemCountVisible && (
                        <div className="absolute text-[13px] font-light text-ink" style={{ right: 10, bottom: 10 }}>{countOf(cat.id)}개</div>
                      )}
                    </button>
                  )
                })
              )}

              {/* 카테고리 모드 — 편집 보기(드래그 순서변경 + 삭제) */}
              {menuViewMode === 'category' && menuEditMode && (
                <>
                  {/* 되돌리기 / 다시실행 — 맨 오른쪽 카테고리 박스의 오른쪽 끝에 맞춰 그 위에 둔다.
                      편집은 '완료' 전까지 서버에 안 가므로 되돌리기가 안전하다.
                      할 수 없을 때는 연하게(30%) — 숨기지 않는다. 자리가 사라지면
                      버튼이 생겼다 없어졌다 해서 눈이 그 자리를 다시 찾아야 한다. */}
                  <div
                    className="absolute flex items-center gap-[10px]"
                    style={{
                      left: GRID_PAD + (COLS - 1) * COL_STEP,
                      width: CARD_W,
                      top: CAT_UNDO_TOP,
                      justifyContent: 'flex-end',
                    }}
                  >
                    <UndoRedoPair
                      canUndo={canUndoCat} canRedo={canRedoCat}
                      onUndo={undoCatOrder} onRedo={redoCatOrder}
                    />
                  </div>
                  {editOrder.length === 0 ? (
                    <div className="absolute text-[13px] text-[#ADADAD]" style={{ left: 26, top: 71 }}>
                      아직 등록된 카테고리가 없습니다.
                    </div>
                  ) : editOrder.map((cat, i) => {
                    const col = i % COLS
                    const row = Math.floor(i / COLS)
                    return (
                      <div
                        key={cat.id}
                        draggable
                        onDragStart={() => { setDragCatId(cat.id); dragStartOrderRef.current = editOrder }}
                        onDragOver={e => handleCatDragOver(e, cat.id)}
                        onDragEnd={() => {
                          setDragCatId(null)
                          // 드래그 한 번 = 히스토리 한 칸. 제자리에 놓았으면 쌓지 않는다.
                          const before = dragStartOrderRef.current
                          dragStartOrderRef.current = null
                          if (!before) return
                          if (!orderChanged(before, editOrder, c => c.id)) return
                          setCatHist(h => pushHistory(h, editOrder))
                        }}
                        className={`absolute bg-[#FCFCFC] rounded-[13px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] text-left cursor-grab active:cursor-grabbing ${
                          dragCatId === cat.id ? 'opacity-40' : ''
                        }`}
                        style={{ left: GRID_PAD + col * COL_STEP, top: CAT_EDIT_TOP + row * 123, width: CARD_W, height: 117 }}
                      >
                        <div className={`absolute ${catTextSizeClass} font-semibold text-ink leading-snug`} style={{ left: 10, top: 10, right: 10 }}>
                          {cat.name}
                        </div>
                        {itemCountVisible && (
                          <div className="absolute text-[13px] font-light text-ink" style={{ right: 10, bottom: 10 }}>{countOf(cat.id)}개</div>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); setDeleteCatConfirm(cat) }}
                          className="absolute w-[18px] h-[18px] rounded-full bg-[#FF676F] flex items-center justify-center"
                          style={{ right: -5, top: -5 }}
                          title="카테고리 삭제"
                        >
                          <svg width="9" height="9" viewBox="0 0 14 14" fill="none"><path d="M3 3L11 11M11 3L3 11" stroke="#FCFCFC" strokeWidth="2.5" strokeLinecap="round"/></svg>
                        </button>
                      </div>
                    )
                  })}
                  {/* 마지막 카테고리 다음 칸 — "+카테고리 추가" (Figma node 694:380) */}
                  {(() => {
                    const i = editOrder.length
                    const col = i % COLS
                    const row = Math.floor(i / COLS)
                    return (
                      <button
                        onClick={() => setCategoryAddOpen(true)}
                        className="absolute rounded-[20px] border border-[#ADADAD] flex items-center justify-center hover:bg-gray-100 transition-colors"
                        style={{ left: GRID_PAD + col * COL_STEP, top: CAT_EDIT_TOP + row * 123, width: CARD_W, height: 117 }}
                        title="카테고리 추가"
                      >
                        <span className="relative" style={{ width: 41, height: 41 }}>
                          <span className="absolute bg-[#ADADAD] rounded-full" style={{ left: '50%', top: 0, bottom: 0, width: 2, transform: 'translateX(-50%)' }} />
                          <span className="absolute bg-[#ADADAD] rounded-full" style={{ top: '50%', left: 0, right: 0, height: 2, transform: 'translateY(-50%)' }} />
                        </span>
                      </button>
                    )
                  })()}
                </>
              )}

              {/* 개별메뉴 모드 — 카테고리별로 묶어서 제목+6열 카드 나열 (Figma node 491:2824).
                   CSS Grid로 배치 — 메뉴이름이 길어 줄바꿈돼도 그 카드만 높이가 늘어나고(이미지는
                   카드 상단에 absolute 고정이라 안 밀림), 같은 행의 다른 카드들은 Grid의 기본
                   align-items:stretch로 자동으로 같은 높이를 공유해서 이미지 줄이 서로 어긋나지
                   않는다. 다음 행은 그 행의 최대 높이만큼만 간격이 벌어지고 내려감. */}
              {menuViewMode === 'individual' && !menuEditMode && (
                individualGroups.length === 0 ? (
                  <div className="text-[13px] text-[#ADADAD]" style={{ paddingLeft: GRID_PAD, paddingTop: 71 }}>
                    아직 등록된 메뉴가 없습니다.
                  </div>
                ) : (
                  <div style={{ paddingTop: INDIV_FIRST_TOP, paddingLeft: GRID_PAD, paddingRight: GRID_PAD }}>
                    {individualGroups.map(({ cat, items }, gi) => (
                      <div key={cat.id} style={{ marginTop: gi > 0 ? INDIV_GROUP_GAP : 0 }}>
                        <div className="text-[18px] font-semibold text-ink" style={{ marginBottom: INDIV_HEADING_GAP }}>
                          {cat.name}
                        </div>
                        <div className="grid" style={{ gridTemplateColumns: `repeat(${COLS}, ${CARD_W}px)`, columnGap: GRID_GAP, rowGap: 6 }}>
                          {items.map(menu => (
                            <button
                              key={menu.code}
                              onClick={() => { openOptionPanel(menu); setRightTab('items') }}
                              className={`relative flex flex-col rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] text-left transition-colors p-[10px] ${
                                optionPanelMenu?.code === menu.code ? 'bg-[#E5E5E5]' : 'bg-[#FCFCFC]'
                              } ${!menu.active || menu.soldOut ? 'opacity-60' : ''}`}
                              style={{ minHeight: 86 }}
                            >
                              <div className={`font-semibold text-ink leading-snug ${menuTextSize === 'large' ? 'text-[15px]' : 'text-[13px]'}`} style={{ paddingRight: 58 }}>
                                {menu.name}
                              </div>
                              <div className="text-[12px] font-light text-ink mt-auto">{won(menu.price)}</div>
                              {itemImageVisible && (menu.imageUrl ? (
                                <img src={menu.imageUrl} alt="" className="absolute object-cover rounded-[6px]" style={{ right: 10, top: 10, width: 48, height: 48 }} />
                              ) : (
                                <div className="absolute bg-[#F2F2F2] rounded-[6px]" style={{ right: 10, top: 10, width: 48, height: 48 }} />
                              ))}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* 개별메뉴 모드 — 편집 보기(카테고리 안에서만 드래그 순서변경 + 삭제, Figma node 491:2927) — 동일하게 Grid 기반 */}
              {menuViewMode === 'individual' && menuEditMode && (() => {
                const groups = [...categories]
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                  .map(cat => ({ cat, items: editOrderMenus.filter(m => m.categoryId === cat.id) }))
                  .filter(g => g.items.length > 0)
                return groups.length === 0 ? (
                  <div className="text-[13px] text-[#ADADAD]" style={{ paddingLeft: GRID_PAD, paddingTop: 71 }}>
                    아직 등록된 메뉴가 없습니다.
                  </div>
                ) : (
                  <>
                  {/* 되돌리기 / 다시실행 — 카테고리 편집과 **같은 자리**(띠 아래 66, 그리드 오른쪽 끝).
                      모드를 오가도 버튼이 같은 곳에 있어야 손이 기억한다. */}
                  <div
                    className="absolute flex items-center gap-[10px] justify-end"
                    style={{ left: GRID_PAD + (COLS - 1) * COL_STEP, width: CARD_W, top: CAT_UNDO_TOP }}
                  >
                    <UndoRedoPair
                      canUndo={canUndoMenu} canRedo={canRedoMenu}
                      onUndo={undoMenuOrder} onRedo={redoMenuOrder}
                    />
                  </div>
                  <div style={{ paddingTop: INDIV_EDIT_TOP, paddingLeft: GRID_PAD, paddingRight: GRID_PAD }}>
                    {groups.map(({ cat, items }, gi) => (
                      <div key={cat.id} style={{ marginTop: gi > 0 ? INDIV_GROUP_GAP : 0 }}>
                        <div className="text-[18px] font-semibold text-ink" style={{ marginBottom: INDIV_HEADING_GAP }}>
                          {cat.name}
                        </div>
                        <div className="grid" style={{ gridTemplateColumns: `repeat(${COLS}, ${CARD_W}px)`, columnGap: GRID_GAP, rowGap: 6 }}>
                          {items.map(menu => (
                            <div
                              key={menu.code}
                              draggable
                              onDragStart={() => { setDragMenuCode(menu.code); dragStartMenusRef.current = editOrderMenus }}
                              onDragOver={e => handleMenuDragOver(e, menu.code)}
                              onDragEnd={() => {
                                setDragMenuCode(null)
                                // 카테고리 쪽과 같은 규칙 — 놓는 순간 한 칸, 제자리면 안 쌓는다
                                const before = dragStartMenusRef.current
                                dragStartMenusRef.current = null
                                if (!before) return
                                if (!orderChanged(before, editOrderMenus, m => m.code)) return
                                setMenuHist(h => pushHistory(h, editOrderMenus))
                              }}
                              className={`relative flex flex-col bg-[#FCFCFC] rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] cursor-grab active:cursor-grabbing p-[10px] ${
                                dragMenuCode === menu.code ? 'opacity-40' : ''
                              }`}
                              style={{ minHeight: 86 }}
                            >
                              <div className={`font-semibold text-ink leading-snug ${menuTextSize === 'large' ? 'text-[15px]' : 'text-[13px]'}`} style={{ paddingRight: 58 }}>
                                {menu.name}
                              </div>
                              <div className="text-[12px] font-light text-ink mt-auto">{won(menu.price)}</div>
                              {itemImageVisible && (menu.imageUrl ? (
                                <img src={menu.imageUrl} alt="" className="absolute object-cover rounded-[6px] pointer-events-none" style={{ right: 10, top: 10, width: 48, height: 48 }} />
                              ) : (
                                <div className="absolute bg-[#F2F2F2] rounded-[6px]" style={{ right: 10, top: 10, width: 48, height: 48 }} />
                              ))}
                              <button
                                onClick={e => { e.stopPropagation(); requestDeleteMenu(menu) }}
                                className="absolute w-[18px] h-[18px] rounded-full bg-[#FF676F] flex items-center justify-center"
                                style={{ right: -5, top: -5 }}
                                title="메뉴 삭제"
                              >
                                <svg width="9" height="9" viewBox="0 0 14 14" fill="none"><path d="M3 3L11 11M11 3L3 11" stroke="#FCFCFC" strokeWidth="2.5" strokeLinecap="round"/></svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  </>
                )
              })()}

              </div>
            </div>

            {/* 우측: QR오더/개별메뉴 탭(일반) ↔ 화면 설정(편집모드) — Group 78 (Figma node 491:1486, 491:836).
                 400px — 주문/고객 화면 사이드바와 폭 통일 */}
            <div className="relative flex-shrink-0 w-[400px] h-full bg-white shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] overflow-hidden">

              {!menuEditMode ? (() => {
                // Figma 원본(367) × FIGMA_SCALE — src/lib/figma-scale.ts 참고.
                // 행 높이는 OPT_GROUP_ROW_H/OPT_ITEM_ROW_H(옵션 리오더 드래그 임계값과 공유)를 그대로 쓴다.
                const GROUPS_START_TOP = 236
                return (
                <>

                  {!optionReorderMode && (
                    <div className="absolute bg-[#F2F2F2] rounded-[10px]" style={{ left: 117, top: 13, width: 165, height: 42 }}>
                      <div
                        className="absolute bg-[#FCFCFC] rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] transition-[left] duration-150"
                        style={{ top: 3, width: 78, height: 36, left: rightTab === 'qr' ? 3 : 84 }}
                      />
                      <button
                        onClick={() => setRightTab('qr')}
                        className={`absolute flex items-center justify-center rounded-[10px] text-[15px] font-medium transition-colors ${rightTab === 'qr' ? 'text-ink' : 'text-[#BDB4A7]'}`}
                        style={{ left: 3, top: 3, width: 78, height: 36 }}
                      >
                        미리보기
                      </button>
                      <button
                        onClick={() => setRightTab('items')}
                        className={`absolute flex items-center justify-center rounded-[10px] text-[15px] font-medium transition-colors ${rightTab === 'items' ? 'text-ink' : 'text-[#BDB4A7]'}`}
                        style={{ left: 84, top: 3, width: 78, height: 36 }}
                      >
                        {menuViewMode === 'individual' ? '옵션' : '개별 메뉴'}
                      </button>
                    </div>
                  )}

                  {rightTab === 'qr' ? (
                    categories.length === 0 ? (
                      // 카테고리가 하나도 없으면 QR오더가 보여줄 메뉴 구조 자체가 없음 — Figma node 699:514
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[29px] px-[26px] text-center">
                        <div className="text-[15px] text-[#ADADAD]">카테고리에 메뉴를 지정해 주세요</div>
                        <button
                          onClick={() => setCategoryAddOpen(true)}
                          className="flex items-center gap-[8px] bg-[#E8E4E2] rounded-[16px] px-[24px] py-[16px] text-[15px] font-medium text-[#6A635E] hover:bg-[#dcd7d4] transition-colors"
                        >
                          + 카테고리 추가하기
                        </button>
                      </div>
                    ) : !storeId ? (
                      // storeId 없이 /demo를 열면 salaria-prepaid가 "침산" 매장으로 폴백해버려서
                      // 엉뚱한 매장 메뉴가 뜬다 — 세션이 아직 없으면 아예 iframe을 띄우지 않는다
                      <div className="absolute inset-0 flex items-center justify-center text-[15px] text-[#ADADAD]">
                        매장 정보를 불러오는 중…
                      </div>
                    ) : (
                    // 진짜 원인(로컬 테스트 페이지로 재현 후 확인): <iframe>은 "replaced element"라
                    // position:absolute에 top+bottom만 주면(height 생략) 일반 div처럼 그 사이 간격만큼
                    // 자동으로 안 늘어나고 브라우저 기본값인 150px로 떨어진다 — 그래서 임베드된 사이트의
                    // 공지 모달(화면 중앙에 꽉 차야 할 내용)이 150px짜리 좁은 창 안에 끼어서 일부만 보이고
                    // 나머지는 흰 배경만 보였던 것. top + height(calc)로 명시하니 바로 해결됨.
                    // 같은 이유로 width도 left+right만으로는 자동으로 안 늘어나므로(replaced element는
                    // 양 축 다 동일한 함정) 폭도 명시적으로 계산해서 넣는다 — 패널(400px) 전체를 꽉 채움.
                    // 좌우 여백은 iframe 자체가 아니라 그 안에 임베드된 사이트 쪽 레이아웃 패딩에 맡긴다.
                    <iframe
                      // storeId를 key에 포함 — 매장이 바뀌면 src만 갈아끼우는 게 아니라 iframe 자체를
                      // 새로 만들어서, 이전 매장 세션(sessionStorage)이 남아 재사용되는 일이 없게 한다
                      key={`${rightTab}-${storeId}`}
                      ref={qrIframeRef}
                      // storeId를 안 넘기면 salaria-prepaid의 /demo가 예전처럼 "침산" 매장으로
                      // 폴백해버려서, 모든 sunpos 계정에서 침산점 메뉴만 보이는 버그가 있었음 —
                      // 이제 현재 로그인된 매장의 실제 메뉴가 뜨도록 store 쿼리파라미터로 넘김
                      src={`https://sallaria.web.app/demo?store=${storeId}`}
                      title="sallaria.web.app 실제 메뉴 화면 (데모 세션 — 실제 주문 접수 안 됨)"
                      className="absolute border-0"
                      style={{ left: 0, top: 55, height: 'calc(100% - 55px)', width: 400 }}
                      onLoad={() => {
                        // iframe이 막 로드된 직후엔 아직 메뉴 데이터를 못 받았을 수 있어 바로 보내면
                        // 유실될 수 있음 — 약간의 지연을 두고 현재 선택된 카테고리를 한 번 더 동기화
                        setTimeout(() => {
                          qrIframeRef.current?.contentWindow?.postMessage(
                            { type: 'SUNPOS_SELECT_CATEGORY', categoryId: previewCatId === 'all' ? null : previewCatId },
                            QR_ORIGIN
                          )
                        }, 800)
                      }}
                    />
                    )
                  ) : menuViewMode === 'individual' && optionReorderMode && optionPanelMenu ? (
                    <>
                      {/* 옵션 순서편집 (Figma node 491:3881) */}
                      <div className="absolute text-[21px] font-semibold text-ink" style={{ left: 26, top: 26 }}>옵션순서를 편집하세요</div>

                      <div className="absolute bg-[#FCFCFC] rounded-[10px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)]" style={{ left: 26, top: 81, width: 159, height: 86 }}>
                        <div className="absolute text-[13px] font-semibold text-ink leading-snug" style={{ left: 10, top: 10, width: 89 }}>{optionPanelMenu.name}</div>
                        {optionPanelMenu.imageUrl ? (
                          <img src={optionPanelMenu.imageUrl} alt="" className="absolute object-cover rounded-[6px]" style={{ left: 104, top: 10, width: 48, height: 48 }} />
                        ) : (
                          <div className="absolute bg-[#F2F2F2] rounded-[6px]" style={{ left: 104, top: 10, width: 48, height: 48 }} />
                        )}
                        <div className="absolute text-[12px] font-light text-ink" style={{ left: 10, top: 66 }}>{won(optionPanelMenu.price)}</div>
                      </div>

                      {/* 태그 — 메뉴 박스 바로 오른쪽에 1행 3열.
                          박스가 left 26 + width 159 → 오른쪽 끝이 185. 패널은 400 폭에
                          좌우 26 패딩이라 185~374(189px)가 비어 있고, 세 칸(≈126px)이 들어간다.
                          세로는 박스(top 81, height 86) 가운데에 맞춘다. */}
                      <div className="absolute" style={{ left: 197, top: 114 }}>
                        <MenuTagRow menu={optionPanelMenu} />
                      </div>

                      <div className="absolute text-[15px] font-medium text-ink" style={{ left: 26, top: 192 }}>연결된 옵션</div>

                      <div className="absolute overflow-y-auto" style={{ left: 26, top: GROUPS_START_TOP, right: 26, bottom: 84 }}>
                        {(() => {
                          let cursor = 0
                          return reorderGroups.map(g => {
                            const groupTop = cursor
                            cursor += OPT_GROUP_ROW_H
                            const expanded = reorderExpandedGroupId === g.id
                            const itemRows = expanded ? g.items.map(it => {
                              const itemTop = cursor
                              cursor += OPT_ITEM_ROW_H
                              return { it, itemTop }
                            }) : []
                            const isDraggingThisGroup = optDrag?.kind === 'group' && optDrag.id === g.id
                            return (
                              <div key={g.id}>
                                <div
                                  onPointerDown={e => startOptDrag(e, { kind: 'group', id: g.id })}
                                  className="absolute flex items-center justify-between w-full select-none"
                                  style={{
                                    top: groupTop,
                                    height: OPT_GROUP_ROW_H,
                                    cursor: isDraggingThisGroup ? 'grabbing' : 'grab',
                                    transform: isDraggingThisGroup ? `translateY(${optDragDeltaY}px)` : undefined,
                                    transition: isDraggingThisGroup ? 'none' : 'top 150ms ease',
                                    zIndex: isDraggingThisGroup ? 10 : undefined,
                                    opacity: isDraggingThisGroup ? 0.85 : 1,
                                  }}
                                >
                                  <button
                                    onPointerDown={e => e.stopPropagation()}
                                    onClick={() => setReorderExpandedGroupId(expanded ? null : g.id)}
                                    className="flex items-center gap-[8px]"
                                  >
                                    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" className={`transition-transform ${expanded ? 'rotate-180' : ''}`}><path d="M5 7.5L10 12.5L15 7.5" stroke="#ADADAD" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    <span className="text-[18px] font-semibold text-ink">{g.name}</span>
                                  </button>
                                  <div className="flex items-center gap-[10px]">
                                    <div className={`flex items-center justify-center px-[8px] py-[5px] rounded-[16px] ${g.isRequired ? 'bg-[#6A635E]' : 'bg-[#F2F2F2]'}`}>
                                      <span className={`text-[12px] font-semibold ${g.isRequired ? 'text-[#FCFCFC]' : 'text-[#787878]'}`}>{g.isRequired ? '필수' : '선택'}</span>
                                    </div>
                                    <svg width="17" height="17" viewBox="0 0 27 27" fill="none"><circle cx="8" cy="6" r="2" fill="#ADADAD"/><circle cx="19" cy="6" r="2" fill="#ADADAD"/><circle cx="8" cy="13.5" r="2" fill="#ADADAD"/><circle cx="19" cy="13.5" r="2" fill="#ADADAD"/><circle cx="8" cy="21" r="2" fill="#ADADAD"/><circle cx="19" cy="21" r="2" fill="#ADADAD"/></svg>
                                  </div>
                                </div>
                                {itemRows.map(({ it, itemTop }) => {
                                  const isDraggingThisItem = optDrag?.kind === 'item' && optDrag.id === it.id
                                  return (
                                    <div
                                      key={it.id}
                                      onPointerDown={e => startOptDrag(e, { kind: 'item', id: it.id, groupId: g.id })}
                                      className="absolute flex items-center justify-between w-full select-none"
                                      style={{
                                        top: itemTop,
                                        height: OPT_ITEM_ROW_H,
                                        cursor: isDraggingThisItem ? 'grabbing' : 'grab',
                                        transform: isDraggingThisItem ? `translateY(${optDragDeltaY}px)` : undefined,
                                        transition: isDraggingThisItem ? 'none' : 'top 150ms ease',
                                        zIndex: isDraggingThisItem ? 10 : undefined,
                                        opacity: isDraggingThisItem ? 0.85 : 1,
                                      }}
                                    >
                                      <span className="text-[15px] font-medium text-ink">{it.name}</span>
                                      <div className="flex items-center gap-[10px]">
                                        <span className="text-[15px] font-medium text-ink">+{won(it.extra)}</span>
                                        <svg width="13" height="13" viewBox="0 0 27 27" fill="none"><circle cx="8" cy="6" r="2" fill="#ADADAD"/><circle cx="19" cy="6" r="2" fill="#ADADAD"/><circle cx="8" cy="13.5" r="2" fill="#ADADAD"/><circle cx="19" cy="13.5" r="2" fill="#ADADAD"/><circle cx="8" cy="21" r="2" fill="#ADADAD"/><circle cx="19" cy="21" r="2" fill="#ADADAD"/></svg>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )
                          })
                        })()}
                      </div>

                      {/* 고객 화면 사이드패널의 계정 추가/금액 충전 버튼과 디자인 통일 — 통일 전 font-semibold를 1단계 낮춰 font-medium으로 */}
                      <div className="absolute flex gap-[6px]" style={{ left: 26, right: 26, bottom: 20 }}>
                        <button
                          onClick={cancelOptionReorder}
                          className="flex-1 bg-[#E8E4E2] text-[#6A635E] rounded-[13px] flex items-center justify-center text-[21px] font-medium hover:bg-[#dcd7d4] transition-colors"
                          style={{ height: 64 }}
                        >
                          취소
                        </button>
                        <button
                          onClick={confirmOptionReorder}
                          className="flex-1 bg-[#2C261F] text-[#F9F9F9] rounded-[13px] flex items-center justify-center text-[21px] font-medium hover:opacity-90 transition-opacity"
                          style={{ height: 64 }}
                        >
                          완료
                        </button>
                      </div>
                    </>
                  ) : menuViewMode === 'individual' && optionPanelMenu ? (
                    <>
                      {/* 메뉴 요약 + 연결된 옵션 (Figma node 628:371 에서 재배치).
                          전엔 159×86 짜리 카드 안에 이름 13px·사진 48×48·가격을 욱여넣었다.
                          400px 패널에서 48px 사진은 무엇을 고른 건지 알아보기 어렵다.
                          카드를 걷어내고 사진을 패널 폭(348)으로 키운 뒤 이름을 24px 로 올렸다.

                          구조도 absolute 좌표에서 **flex 흐름**으로 바꿨다 — 이름이 2줄이 되면
                          아래가 같이 밀려야 하는데, 좌표를 찍어두면 겹친다.
                          (순서편집 모드는 드래그 스왑 계산에 좌표가 필요해 그대로 둔다.)

                          bottom 104 = 버튼(bottom 20 + height 64) + 간격 20.
                          전엔 목록이 bottom 20 이라 옵션이 많으면 버튼 **뒤로** 흘러들어갔다. */}
                      <div className="absolute flex flex-col" style={{ left: 26, top: 70, right: 26, bottom: 104 }}>
                        {optionPanelMenu.imageUrl ? (
                          <img
                            src={optionPanelMenu.imageUrl}
                            alt=""
                            className="w-full flex-shrink-0 rounded-[10px] object-cover"
                            style={{ height: 180 }}
                          />
                        ) : (
                          <div
                            className="w-full flex-shrink-0 rounded-[10px] bg-[#F2F2F2] flex items-center justify-center"
                            style={{ height: 180 }}
                          >
                            <span className="text-[13px] font-normal text-[#C4C4C4]">사진 없음</span>
                          </div>
                        )}

                        {/* 이름 — 두 줄까지만. 더 길면 말줄임(패널이 400px 뿐이라 3줄은 사진을 밀어낸다) */}
                        <div
                          className="flex-shrink-0 text-[24px] font-semibold text-ink leading-snug mt-[16px]"
                          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                        >
                          {optionPanelMenu.name}
                        </div>

                        {/* 가격 + 태그 한 줄 — 태그는 오른쪽 끝에 붙인다 */}
                        <div className="flex-shrink-0 flex items-center justify-between gap-[10px] mt-[10px]">
                          <span className="text-[17px] font-light text-ink">{won(optionPanelMenu.price)}</span>
                          <MenuTagRow menu={optionPanelMenu} />
                        </div>

                        <div className="flex-shrink-0 text-[15px] font-medium text-ink mt-[26px] mb-[10px]">연결된 옵션</div>

                      {optionPanelMenu.optionGroups.length === 0 ? (
                        <div className="text-[12px] text-[#ADADAD]">연결된 옵션이 없습니다.</div>
                      ) : (
                        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
                          {/* 읽기 전용 목록은 **일반 흐름**이다(순서편집 모드와 다르다).
                              전엔 여기도 cursor 로 top 을 직접 찍었는데, 행마다 42px 를 고정으로
                              더하다 보니 옵션그룹 이름이 2줄이 되면 늘어난 만큼을 아무도 몰라서
                              아래 행이 겹쳤다. 드래그가 없는 화면이라 좌표를 쥐고 있을 이유가 없다.
                              (순서편집 모드는 스왑 임계값 계산에 좌표가 필요해 그대로 둔다.) */}
                          {optionPanelMenu.optionGroups.map(g => {
                            const expanded = optionPanelExpandedGroupId === g.id
                            return (
                              <div key={g.id} className="flex flex-col">
                                {/* text-left 가 필요하다 — button 은 기본이 text-align:center 라
                                    이름이 2줄이 되면 둘째 줄만 가운데로 떠 있었다. */}
                                <button
                                  onClick={() => setOptionPanelExpandedGroupId(expanded ? null : g.id)}
                                  className="pressable-row w-full flex items-center justify-between gap-[10px] text-left py-[9px]"
                                  style={{ minHeight: OPT_GROUP_ROW_H }}
                                >
                                  <span className="flex-1 min-w-0 flex items-center gap-[8px]">
                                    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" className={`flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}><path d="M5 7.5L10 12.5L15 7.5" stroke="#ADADAD" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                    <span className="min-w-0 text-[18px] font-semibold text-ink leading-snug">{g.name}</span>
                                  </span>
                                  {/* 배지는 눌리지도 늘어나지도 않는다. 전엔 제목이 폭을 다 먹어
                                      '필/수' 로 줄바꿈되며 세로로 길어졌다. */}
                                  <div className={`flex-shrink-0 flex items-center justify-center px-[8px] py-[5px] rounded-[16px] whitespace-nowrap ${g.isRequired ? 'bg-[#6A635E]' : 'bg-[#F2F2F2]'}`}>
                                    <span className={`text-[12px] font-semibold ${g.isRequired ? 'text-[#FCFCFC]' : 'text-[#787878]'}`}>{g.isRequired ? '필수' : '선택'}</span>
                                  </div>
                                </button>
                                {expanded && g.items.map(it => (
                                  <div key={it.id} className="flex items-center justify-between gap-[10px] w-full" style={{ minHeight: OPT_ITEM_ROW_H }}>
                                    <span className="flex-1 min-w-0 text-[15px] font-medium text-ink leading-snug">{it.name}</span>
                                    <span className="flex-shrink-0 text-[15px] font-medium text-ink">+{won(it.extra)}</span>
                                  </div>
                                ))}
                              </div>
                            )
                          })}
                        </div>
                      )}
                      </div>

                      {/* 고객 화면 사이드패널의 계정 추가/금액 충전 버튼과 디자인 통일 — 통일 전 font-semibold를 1단계 낮춰 font-medium으로 */}
                      <div className="absolute flex gap-[6px]" style={{ left: 26, right: 26, bottom: 20 }}>
                        <button
                          onClick={enterOptionReorder}
                          className="flex-1 bg-[#E8E4E2] text-[#6A635E] rounded-[13px] flex items-center justify-center text-[21px] font-medium hover:bg-[#dcd7d4] transition-colors"
                          style={{ height: 64 }}
                        >
                          순서 편집
                        </button>
                        <button
                          onClick={() => optionPanelMenu && openMenuFormEdit(optionPanelMenu)}
                          className="flex-1 bg-[#2C261F] text-[#F9F9F9] rounded-[13px] flex items-center justify-center text-[21px] font-medium hover:opacity-90 transition-opacity"
                          style={{ height: 64 }}
                        >
                          수정
                        </button>
                      </div>
                    </>
                  ) : menuViewMode === 'individual' ? (
                    <div className="absolute text-[15px] text-[#ADADAD] -translate-x-1/2" style={{ left: 200, top: 105 }}>
                      메뉴를 선택해 주세요
                    </div>
                  ) : !selectedCat ? (
                    <div className="absolute text-[15px] text-[#ADADAD] -translate-x-1/2" style={{ left: 200, top: 105 }}>
                      카테고리를 선택해 주세요
                    </div>
                  ) : (
                    <div className="absolute overflow-y-auto" style={{ left: 26, top: 105, right: 26, bottom: 26 }}>
                      <div className="text-[21px] font-semibold text-ink mb-[26px]">{selectedCat.name}</div>
                      {itemsOfSelectedCat.length === 0 ? (
                        <div className="text-[12px] text-[#ADADAD] py-[13px]">이 카테고리에 메뉴가 없습니다.</div>
                      ) : (
                        <div className="grid grid-cols-2 gap-x-[14px] gap-y-[26px]">
                          {itemsOfSelectedCat.map(menu => (
                            <button key={menu.code} onClick={() => openMenuFormEdit(menu)} className={`text-left ${!menu.active || menu.soldOut ? 'opacity-60' : ''}`}>
                              {menu.imageUrl ? (
                                <img src={menu.imageUrl} alt="" className="rounded-[13px] object-cover w-full" style={{ aspectRatio: '1/1' }} />
                              ) : (
                                <div className="rounded-[13px] bg-[#F2F2F2] w-full" style={{ aspectRatio: '1/1' }} />
                              )}
                              <div className="text-[15px] font-medium text-ink mt-[8px] leading-snug">{menu.name}</div>
                              <div className="flex items-center justify-between mt-[6px]">
                                <span className="text-[15px] font-medium text-ink">{won(menu.price)}</span>
                                <MenuTagBadges menu={menu} />
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
                )
              })() : menuViewMode === 'individual' ? (
                <>
                  {/* 편집모드 — 개별메뉴 모드 화면 설정 토글 2종 (Figma node 491:2927) */}
                  <div className="absolute text-[21px] font-semibold text-black" style={{ left: 26, top: 82 }}>메뉴 이미지 표시</div>
                  <div className="absolute" style={{ left: 26, right: 26, top: 132 }}>
                    <SegmentedControl
                      options={[{ label: '표시', value: true }, { label: '숨기기', value: false }]}
                      value={itemImageVisible}
                      onChange={setItemImageVisible}
                      padding={3}
                      className="rounded-[10px] h-[50px]"
                      thumbClassName="rounded-[10px]"
                      optionClassName={active => `h-full text-[15px] font-medium flex items-center justify-center ${active ? 'text-ink' : 'text-[#BDB4A7]'}`}
                    />
                  </div>

                  <div className="absolute text-[21px] font-semibold text-black" style={{ left: 26, top: 220 }}>메뉴 글자 크기</div>
                  <div className="absolute" style={{ left: 26, right: 26, top: 270 }}>
                    <SegmentedControl
                      options={[{ label: '기본', value: 'default' }, { label: '큰 글씨', value: 'large' }]}
                      value={menuTextSize}
                      onChange={setMenuTextSize}
                      padding={3}
                      className="rounded-[10px] h-[50px]"
                      thumbClassName="rounded-[10px]"
                      optionClassName={active => `h-full text-[15px] font-medium flex items-center justify-center ${active ? 'text-ink' : 'text-[#BDB4A7]'}`}
                    />
                  </div>

                  {/* 완료 / 취소 — 고객 화면 사이드패널의 계정 추가/금액 충전 버튼과 디자인 통일, font-semibold는 통일 전 1단계 낮춰 font-medium으로 */}
                  <div className="absolute flex gap-[6px]" style={{ left: 26, right: 26, bottom: 20 }}>
                    <button
                      onClick={cancelMenuEdit}
                      className="flex-1 bg-[#E8E4E2] text-[#6A635E] rounded-[13px] flex items-center justify-center text-[21px] font-medium hover:bg-[#dcd7d4] transition-colors"
                      style={{ height: 64 }}
                    >
                      편집 취소
                    </button>
                    <button
                      onClick={confirmMenuEdit}
                      className="flex-1 bg-[#2C261F] text-[#F9F9F9] rounded-[13px] flex items-center justify-center text-[21px] font-medium hover:opacity-90 transition-opacity"
                      style={{ height: 64 }}
                    >
                      완료
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* 편집모드 — 카테고리 모드 화면 설정 토글 2종 (Figma node 491:836) */}
                  {/* 메뉴 개수 표시 */}
                  <div className="absolute text-[21px] font-semibold text-black" style={{ left: 26, top: 82 }}>메뉴 개수 표시</div>
                  <div className="absolute" style={{ left: 26, right: 26, top: 132 }}>
                    <SegmentedControl
                      options={[{ label: '표시', value: true }, { label: '숨기기', value: false }]}
                      value={itemCountVisible}
                      onChange={setItemCountVisible}
                      padding={3}
                      className="rounded-[10px] h-[50px]"
                      thumbClassName="rounded-[10px]"
                      optionClassName={active => `h-full text-[15px] font-medium flex items-center justify-center ${active ? 'text-ink' : 'text-[#BDB4A7]'}`}
                    />
                  </div>

                  {/* 카테고리 글자 크기 */}
                  <div className="absolute text-[21px] font-semibold text-black" style={{ left: 26, top: 220 }}>카테고리 글자 크기</div>
                  <div className="absolute" style={{ left: 26, right: 26, top: 270 }}>
                    <SegmentedControl
                      options={[{ label: '기본', value: 'default' }, { label: '큰 글씨', value: 'large' }]}
                      value={categoryTextSize}
                      onChange={setCategoryTextSize}
                      padding={3}
                      className="rounded-[10px] h-[50px]"
                      thumbClassName="rounded-[10px]"
                      optionClassName={active => `h-full text-[15px] font-medium flex items-center justify-center ${active ? 'text-ink' : 'text-[#BDB4A7]'}`}
                    />
                  </div>

                  {/* 완료 / 취소 — 고객 화면 사이드패널의 계정 추가/금액 충전 버튼과 디자인 통일, font-semibold는 통일 전 1단계 낮춰 font-medium으로 */}
                  <div className="absolute flex gap-[6px]" style={{ left: 26, right: 26, bottom: 20 }}>
                    <button
                      onClick={cancelMenuEdit}
                      className="flex-1 bg-[#E8E4E2] text-[#6A635E] rounded-[13px] flex items-center justify-center text-[21px] font-medium hover:bg-[#dcd7d4] transition-colors"
                      style={{ height: 64 }}
                    >
                      편집 취소
                    </button>
                    <button
                      onClick={confirmMenuEdit}
                      className="flex-1 bg-[#2C261F] text-[#F9F9F9] rounded-[13px] flex items-center justify-center text-[21px] font-medium hover:opacity-90 transition-opacity"
                      style={{ height: 64 }}
                    >
                      완료
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* 기준이 된 토스트 — 모드 전환 안내라 21px(large) 그대로 */}
            <BottomToast message={menuToast} size="large" />
          </div>
        )
      })()}

      {/* ── 카테고리 삭제 확인 (Figma 491:1293) ──
          카테고리 정보 화면의 삭제와 **같은 다이얼로그**를 쓴다. 전엔 이쪽만 따로
          만들어 둬서(가운데 정렬·빨간 '네'·20px 라운드) 같은 일을 하는 확인창이
          화면마다 달랐다. */}
      {deleteCatConfirm && (
        <ConfirmDialog
          title={`${deleteCatConfirm.name} 카테고리를 삭제하시겠어요?`}
          description="메뉴는 삭제되지 않아요"
          onConfirm={() => confirmDeleteCategory(deleteCatConfirm)}
          onCancel={() => setDeleteCatConfirm(null)}
        />
      )}

      {/* ── 카테고리 추가 (1단계: 이름 / 2단계: 적용할 메뉴 선택 — Figma node 656:373의 2단계 패턴 참고) ── */}
      {/* 카테고리 추가 — 카테고리 정보 화면과 **같은 컴포넌트**를 쓴다.
          전엔 이 화면 안에 통째로 박혀 있어서 다른 화면에서 쓸 수가 없었다. */}
      {categoryAddOpen && (
        <CategoryAddModal
          menus={menus.map(m => ({ code: m.code, name: m.name, soldOut: m.soldOut }))}
          onClose={() => setCategoryAddOpen(false)}
          onCreate={async (name, codes) => { await addCategoryWithMenus(name, codes) }}
        />
      )}

      {/* ── 메뉴 추가/수정 모달 (Figma node 491:2237 "메뉴 상세") — 고정 실제 px, scale 없음.
           원인 메모: 예전엔 width:1402,height:1500 네이티브 값에 transform:scale(menuScale*0.72)를 걸었는데,
           max-h-[90vh]는 scale 적용 "전" 레이아웃(실제 뷰포트 기준)으로 평가되는 CSS라, height:1500이
           90vh(기본 창 기준 약 700대)에 걸려 먼저 클램프된 뒤에 또 0.46배로 축소되면서 모달이 심하게
           짧아져 보였음 — jazzy-forging-quiche.md 비율로 환산한 고정 px만 쓰고 scale은 제거함 ── */}
      {menuForm.mode && (
        <MenuFormModal
          mode={menuForm.mode!}
          form={menuForm.form}
          setForm={menuForm.setForm}
          saving={menuForm.saving}
          canSave={menuForm.canSave}
          imageError={menuForm.imageError}
          imagePreview={menuForm.imagePreview}
          setImagePreview={menuForm.setImagePreview}
          setImageFile={menuForm.setImageFile}
          categories={sortedCategories()}
          storeGroups={storeGroups}
          selectedGroupIds={menuForm.selectedGroupIds}
          onToggleGroup={menuForm.toggleGroup}
          onAddCategory={() => setCategoryAddOpen(true)}
          onAddOptionGroup={() => setAddingStoreGroup(true)}
          onDelete={() => setDeleteConfirm('single')}
          onClose={menuForm.close}
          onSave={() => menuForm.save(storeGroups, menus.reduce((m, mn) => Math.max(m, mn.order), 0) + 1)}
        />
      )}

      {/* ── 옵션 탭 ── */}
      {!loading && tab === 'option' && (() => {
        // 현재 선택된 그룹 (selectedGroupId 없으면 첫 번째 그룹 자동 선택)
        const activeGroup = filteredStoreGroups.find(g => g.id === selectedGroupId)
          ?? filteredStoreGroups[0]
          ?? null
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 검색 + 상태 필터 */}
            <div className="px-4 pt-3 pb-3 flex items-center gap-2.5 flex-shrink-0 border-b border-gray-border bg-white">
              <div className="relative flex-shrink-0" style={{ width: 200 }}>
                <input
                  value={optionSearch}
                  onChange={e => setOptionSearch(e.target.value)}
                  placeholder="그룹명 · 옵션명 검색"
                    className="floating-input w-full border border-gray-border rounded-lg pl-3 pr-7 py-2 text-[11px] hover:bg-gray-50 focus:outline-none transition-colors"
                />
                <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <circle cx="6.5" cy="6.5" r="4.5" stroke="#727272" strokeWidth="1.5"/>
                  <path d="M10.5 10.5L14 14" stroke="#727272" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="flex gap-1">
                {([
                  { v: 'all',     l: '전체'   },
                  { v: 'active',  l: '판매중' },
                  { v: 'soldOut', l: '품절'   },
                  { v: 'hidden',  l: '숨김'   },
                ] as { v: typeof optionFilter; l: string }[]).map(({ v, l }) => (
                  <button key={v} onClick={() => setOptionFilter(v)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors
                      ${optionFilter === v ? 'bg-gray-200 text-ink' : 'bg-transparent text-gray-text hover:bg-gray-100'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* 2단 레이아웃: 왼쪽 목록 + 오른쪽 상세 */}
            <div className="flex flex-1 overflow-hidden">
              {/* ── 왼쪽: 그룹 목록 ── */}
              <div className="w-[260px] flex-shrink-0 border-r border-gray-border overflow-y-auto bg-white">
                {storeGroups.length === 0 && (
                  <div className="text-center py-16 text-gray-text text-[11px] px-4">
                    등록된 옵션 그룹이 없습니다.<br/>위 버튼으로 추가하세요.
                  </div>
                )}
                {filteredStoreGroups.length === 0 && storeGroups.length > 0 && (
                  <div className="text-center py-16 text-gray-text text-[11px]">
                    검색 결과가 없습니다.
                  </div>
                )}
                {filteredStoreGroups.map(group => (
                  <OptionGroupRow
                    key={group.id}
                    group={group}
                    isSelected={activeGroup?.id === group.id}
                    onClick={() => setSelectedGroupId(group.id)}
                  />
                ))}
              </div>

              {/* ── 오른쪽: 그룹 상세 패널 ── */}
              <div className="flex-1 overflow-y-auto bg-gray-bg">
                {activeGroup ? (
                  <OptionGroupPanel
                    group={activeGroup}
                    isSoldOut={activeGroup.isSoldOut}
                    soldOutUntil={activeGroup.soldOutUntil}
                    isHidden={activeGroup.isHidden}
                    usedByMenus={activeGroup.usedByMenus}
                    searchQuery={optionSearch}
                    onSetSoldOutState={state => setGroupSoldOutState(activeGroup.id, state)}
                    onToggleHidden={() => toggleGroupHidden(activeGroup.id)}
                    onUpdateGroup={updates => updateStoreGroup(activeGroup.id, updates)}
                    onDeleteGroup={() => { deleteStoreGroup(activeGroup.id); setSelectedGroupId(null) }}
                    onUpdateItem={(itemId, updates) => updateStoreItem(activeGroup.id, itemId, updates)}
                    onDeleteItem={itemId => deleteStoreItem(activeGroup.id, itemId)}
                    onAddItem={(name, extra) => addStoreItem(activeGroup.id, name, extra)}
                    onReorderItem={(fromIdx, toIdx) => reorderStoreItem(activeGroup.id, fromIdx, toIdx)}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-text text-[12px]">
                    왼쪽에서 옵션 그룹을 선택하세요.
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── 카테고리 탭 ── */}
      {!loading && tab === 'category' && (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="flex items-center justify-between mb-1">
            <div>
              <div className="text-[16px] font-semibold">카테고리 관리</div>
              <div className="text-[11px] text-gray-text mt-0.5">
                웹 주문 페이지에서 거래처명 바로 아래에 표시되는 탭 목록입니다. 순서대로 노출됩니다.
              </div>
            </div>
            <button onClick={() => { setAddingCat(true); setNewCatName('') }}
              className="px-3 py-2 text-[11px] font-bold text-[#1A1A1A] bg-[#00DD67] rounded-lg hover:bg-[#00BB55] transition-colors flex-shrink-0">
              카테고리 추가
            </button>
          </div>

          {/* 카테고리 pill 버튼 바 — 클릭 시 해당 카테고리 드롭다운 열기 + 스크롤 */}
          {sortedCategories().length > 0 && (
            <div className="mt-4 mb-1 flex gap-1.5 overflow-x-auto scrollbar-none pb-1">
              {sortedCategories().map(cat => {
                const isActive = expandedCatId === cat.id
                return (
                  <button
                    key={cat.id}
                    onClick={() => {
                      setExpandedCatId(isActive ? null : cat.id)
                      if (!isActive) setTimeout(() => {
                        catRowRefs.current[cat.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }, 50)
                    }}
                    className={`flex-shrink-0 whitespace-nowrap pl-3 pr-2 py-1.5 rounded-full text-[11px] font-semibold transition-colors focus:outline-none flex items-center gap-1
                      ${isActive ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
                  >
                    {cat.name}
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${isActive ? 'bg-white/20' : 'bg-white border border-gray-border'}`}>
                      <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                        <path d={isActive ? 'M2 7L5 4L8 7' : 'M2 4L5 7L8 4'} stroke={isActive ? 'white' : '#9CA3AF'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="mt-2 border border-gray-border rounded-xl overflow-hidden divide-y divide-gray-border">
            {sortedCategories().length === 0 && (
              <div className="py-10 text-center text-[11px] text-gray-text">
                카테고리가 없습니다. 위에서 추가해주세요.
              </div>
            )}
            {sortedCategories().map((cat, idx) => {
              const catMenus = menus.filter(m => m.categoryId === cat.id)
              const isExpanded = expandedCatId === cat.id
              return (
                <div
                  key={cat.id}
                  ref={el => { catRowRefs.current[cat.id] = el }}
                  draggable
                  onDragStart={() => { setDragId(cat.id); setExpandedCatId(null) }}
                  onDragOver={e => { e.preventDefault(); setDragOverId(cat.id) }}
                  onDrop={e => { e.preventDefault(); handleCatDrop(cat.id); setDragOverId(null) }}
                  onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                  className={dragOverId === cat.id && dragId !== cat.id ? 'border-t-2 border-[#00DD67]' : ''}
                >
                  {/* ── 카테고리 행 ── */}
                  <div
                    className={`flex items-center gap-2.5 px-4 py-2.5 hover:bg-gray-bg/50 cursor-pointer select-none transition-colors ${dragId === cat.id ? 'opacity-40 bg-gray-bg' : 'bg-white'}`}
                    onClick={() => setExpandedCatId(isExpanded ? null : cat.id)}
                  >
                    {/* 드래그 핸들 */}
                    <div
                      className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-border hover:text-gray-text transition-colors"
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => e.stopPropagation()}
                    >
                      <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
                        <circle cx="3.5" cy="2.5" r="1.5"/><circle cx="8.5" cy="2.5" r="1.5"/>
                        <circle cx="3.5" cy="7" r="1.5"/><circle cx="8.5" cy="7" r="1.5"/>
                        <circle cx="3.5" cy="11.5" r="1.5"/><circle cx="8.5" cy="11.5" r="1.5"/>
                      </svg>
                    </div>

                    <span className="text-[11px] font-bold text-gray-text w-5 text-center flex-shrink-0">{idx + 1}</span>

                    <span className="text-[11px] font-medium text-ink flex-shrink-0">{cat.name}</span>

                    <div className="flex flex-wrap gap-1 flex-1 min-w-0 overflow-hidden">
                      {catMenus.length === 0
                        ? <span className="text-[11px] text-gray-text">—</span>
                        : catMenus.map(m => (
                            <span key={m.code} className="text-[11px] font-medium text-gray-text bg-gray-bg px-2 py-0.5 rounded-full flex-shrink-0">
                              {m.name}
                            </span>
                          ))
                      }
                    </div>

                    <button
                      onClick={e => {
                        e.stopPropagation()
                        setCatEditNameDraft(cat.name)
                        setCatEditChecked(new Set(catMenus.map(m => m.code)))
                        setCatEditSearch('')
                        setCatEditModalId(cat.id)
                      }}
                      className="flex-shrink-0 text-[11px] font-semibold text-gray-text bg-gray-100 px-2.5 py-1 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      수정
                    </button>

                    {/* 펼침 화살표 */}
                    <svg className={`flex-shrink-0 w-4 h-4 text-gray-text transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>

                  {/* ── 아코디언: 메뉴 목록 ── */}
                  {isExpanded && (
                    <div className="bg-gray-bg border-t border-gray-border px-5 py-3">
                      {catMenus.length === 0 ? (
                        <p className="text-[11px] text-gray-text py-1">이 카테고리에 메뉴가 없습니다.</p>
                      ) : (
                        <div className="grid grid-cols-10 gap-1.5">
                          {catMenus
                            .slice()
                            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                            .map(m => (
                              <div key={m.code} className="bg-white rounded-lg overflow-hidden border border-gray-border shadow-sm">
                                {/* 썸네일 */}
                                <div className="w-full aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
                                  {m.imageUrl
                                    ? <img src={m.imageUrl} alt={m.name} className="w-full h-full object-cover" />
                                    : <span className="text-[20px]">{m.emoji}</span>
                                  }
                                </div>
                                {/* 정보 */}
                                <div className="px-2 py-1.5">
                                  <div className="flex items-start justify-between gap-1 mb-0.5">
                                    <span className="text-[10px] font-semibold text-ink leading-snug">{m.name}</span>
                                    <div className="flex flex-col gap-0.5 items-end flex-shrink-0">
                                      {m.soldOut  && <span className="text-[9px] font-bold text-white bg-gray-400 rounded px-1 py-0.5 leading-none">품절</span>}
                                      {!m.active  && <span className="text-[9px] font-bold text-gray-text bg-gray-200 rounded px-1 py-0.5 leading-none">숨김</span>}
                                    </div>
                                  </div>
                                  <span className="text-[10px] font-bold text-gray-text">{won(m.price)}</span>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {(() => {
            const uncat = menus.filter(m => !m.categoryId)
            if (uncat.length === 0) return null
            return (
              <div className="mt-6">
                <div className="text-[11px] font-bold text-gray-text uppercase tracking-wide mb-2">
                  카테고리 미지정 메뉴 · {uncat.length}개
                </div>
                <div className="flex flex-wrap gap-2">
                  {uncat.map(m => (
                    <span key={m.code} className="text-[11px] font-semibold text-gray-text bg-gray-100 rounded-full px-3 py-1">
                      {m.emoji} {m.name}
                    </span>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── 카테고리 수정 모달 ── */}
      {catEditModalId && (() => {
        const cat = categories.find(c => c.id === catEditModalId)
        if (!cat) return null
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCatEditModalId(null)}>
            <div className="modal-in bg-white rounded-2xl shadow-xl w-[520px] max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* 헤더 */}
              <div className="flex items-center justify-between px-8 pt-7 pb-0 flex-shrink-0">
                <div className="text-[17px] font-semibold">카테고리 수정</div>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => { setCatDeleteRemap({}); setCatDeleteModalId(catEditModalId); setCatEditModalId(null) }}
                    className="px-3 py-1.5 text-[11px] font-medium text-danger bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                  >
                    삭제
                  </button>
                  <button onClick={() => setCatEditModalId(null)} className="text-gray-text hover:text-ink text-[18px] leading-none">✕</button>
                </div>
              </div>

              {/* 이름 */}
              <div className="px-8 pt-6 pb-5 flex-shrink-0">
                <label className="text-[13px] font-semibold text-gray-text block mb-1.5">카테고리 이름</label>
                <input
                  value={catEditNameDraft}
                  onChange={e => setCatEditNameDraft(e.target.value)}
                  className="w-full border border-gray-border rounded-xl px-3 py-2 text-[11px] font-semibold focus:outline-none focus:border-green"
                />
              </div>

              {/* 메뉴 선택 */}
              <div className="px-8 pb-3 pt-2 flex-shrink-0 space-y-2">
                <div className="text-[13px] font-semibold text-gray-text mb-1.5">메뉴 선택</div>
                <input
                  value={catEditSearch}
                  onChange={e => setCatEditSearch(e.target.value)}
                  placeholder="메뉴명 검색"
                  className="w-full border border-gray-border rounded-xl px-3 py-2 text-[11px] focus:outline-none focus:border-green"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-8 pb-6">
                {menus.length === 0 ? (
                  <div className="text-[11px] text-gray-text py-3 text-center">등록된 메뉴가 없습니다</div>
                ) : (
                  <div className="space-y-1.5">
                    {menus.slice()
                    .filter(m => !catEditSearch.trim() || m.name.includes(catEditSearch.trim()))
                    .sort((a, b) => {
                      const aChecked = catEditChecked.has(a.code) ? 0 : 1
                      const bChecked = catEditChecked.has(b.code) ? 0 : 1
                      if (aChecked !== bChecked) return aChecked - bChecked
                      return (a.order ?? 0) - (b.order ?? 0)
                    })
                    .map(m => {
                      const checked = catEditChecked.has(m.code)
                      return (
                        <label key={m.code} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer transition-colors ${checked ? 'bg-green-soft' : 'hover:bg-gray-bg'}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setCatEditChecked(prev => {
                                const next = new Set(prev)
                                if (next.has(m.code)) next.delete(m.code)
                                else next.add(m.code)
                                return next
                              })
                            }}
                            className="w-4 h-4 accent-[#00DD67] flex-shrink-0"
                          />
                          {/* 썸네일 */}
                          <div className="w-10 h-9 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {m.imageUrl
                              ? <img src={m.imageUrl} alt={m.name} className="w-full h-full object-cover" />
                              : <span className="text-[20px]">{m.emoji}</span>
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-semibold text-ink truncate">{m.name}</div>
                            <div className="text-[11px] text-gray-text">{won(m.price)}</div>
                          </div>
                          {m.categoryId && m.categoryId !== catEditModalId && (
                            <span className="text-[10px] text-gray-text bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0">
                              {categories.find(c => c.id === m.categoryId)?.name ?? ''}
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 푸터 */}
              <div className="bg-white flex gap-2 px-8 py-4 flex-shrink-0">
                <button onClick={() => setCatEditModalId(null)}
                  className="flex-1 py-3 bg-gray-100 text-ink rounded-lg text-[13px] font-semibold hover:bg-gray-200 transition-colors">
                  취소
                </button>
                <button
                  onClick={() => saveCategoryEdit(catEditModalId, catEditNameDraft, catEditChecked)}
                  disabled={!catEditNameDraft.trim() || catEditSaving}
                  className="flex-1 py-3 bg-[#00DD67] text-[#1A1A1A] rounded-lg text-[13px] font-semibold hover:bg-[#00BB55] transition-colors disabled:opacity-40"
                >
                  {catEditSaving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── 카테고리 삭제 모달 ── */}
      {catDeleteModalId && (() => {
        const cat = categories.find(c => c.id === catDeleteModalId)
        if (!cat) return null
        const catMenus = menus.filter(m => m.categoryId === catDeleteModalId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCatDeleteModalId(null)}>
            <div className="modal-in bg-white rounded-2xl shadow-xl w-[560px] max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* 헤더 */}
              <div className="px-6 py-6 flex-shrink-0">
                <div className="text-[17px] font-semibold mb-1">
                  <span className="text-danger">'{cat.name}'</span> 카테고리 삭제
                </div>
                <div className="text-[11px] text-gray-text">
                  {catMenus.length > 0
                    ? '각 메뉴를 이동할 카테고리를 선택하면 삭제할 수 있습니다.'
                    : '카테고리를 삭제합니다. 이 작업은 되돌릴 수 없습니다.'}
                </div>
              </div>

              {/* 메뉴 목록 + 카테고리 드롭다운 */}
              {catMenus.length > 0 && (() => {
                const otherCats = categories.filter(c => c.id !== catDeleteModalId)
                const allMapped = catMenus.every(m => !!catDeleteRemap[m.code])
                return (
                  <div className="flex-1 overflow-y-auto px-5 pb-2">
                    <div className="text-[11px] font-bold text-danger mb-2">
                      이동 필요 {catMenus.length}개 · {catMenus.filter(m => catDeleteRemap[m.code]).length}개 지정됨
                    </div>
                    <div className="space-y-2">
                      {catMenus.map(m => {
                        const mapped = !!catDeleteRemap[m.code]
                        return (
                          <div key={m.code} className={`flex items-center gap-2.5 rounded-xl px-3 py-2 transition-colors ${mapped ? 'bg-green-soft' : 'bg-red-50'}`}>
                            <div className="w-9 h-8 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                              {m.imageUrl
                                ? <img src={m.imageUrl} alt={m.name} className="w-full h-full object-cover" />
                                : <span className="text-[18px]">{m.emoji}</span>
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] font-semibold text-ink truncate">{m.name}</div>
                            </div>
                            <select
                              value={catDeleteRemap[m.code] ?? ''}
                              onChange={e => {
                                const val = e.target.value
                                setCatDeleteRemap(prev => val ? { ...prev, [m.code]: val } : (() => { const n = { ...prev }; delete n[m.code]; return n })())
                              }}
                              className={`flex-shrink-0 w-28 text-[11px] font-semibold border rounded-lg px-2 py-1.5 focus:outline-none transition-colors ${mapped ? 'border-green text-green bg-white' : 'border-gray-border text-gray-text bg-white'}`}
                            >
                              <option value="">카테고리 선택</option>
                              {otherCats.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                        )
                      })}
                    </div>
                    {catMenus.length > 0 && !allMapped && (
                      <p className="text-[11px] text-gray-text mt-3">모든 메뉴에 카테고리를 지정하면 삭제 버튼이 활성화됩니다.</p>
                    )}
                  </div>
                )
              })()}

              {/* 푸터 */}
              {(() => {
                const allMapped = catMenus.every(m => !!catDeleteRemap[m.code])
                const canDelete = catMenus.length === 0 || allMapped
                return (
                  <div className="bg-white flex gap-2.5 px-5 py-3 flex-shrink-0">
                    <button onClick={() => setCatDeleteModalId(null)}
                      className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-text font-bold hover:bg-gray-200 transition-colors">
                      취소
                    </button>
                    <button
                      disabled={!canDelete}
                      onClick={() => { deleteCategory(catDeleteModalId!, catDeleteRemap); setCatDeleteModalId(null) }}
                      className="flex-1 py-2.5 rounded-xl bg-danger text-white font-bold hover:bg-danger/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      삭제
                    </button>
                  </div>
                )
              })()}
            </div>
          </div>
        )
      })()}

      {/* ── 메뉴 추가 모달 ── */}
      {addMenuOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAddMenuOpen(false)}>
          <div className="modal-in bg-white rounded-2xl shadow-xl w-[560px] max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

            {/* 헤더 */}
            <div className="flex items-center justify-between px-8 pt-7 pb-0 flex-shrink-0">
              <span className="text-[17px] font-semibold">메뉴 추가</span>
              <button onClick={() => setAddMenuOpen(false)} className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-text hover:bg-gray-100 text-[18px] transition-colors">✕</button>
            </div>
            {/* 탭 */}
            <div className="flex gap-0 px-8 mt-4 flex-shrink-0">
              {([{ v: 'bulk', l: '일괄' }, { v: 'detail', l: '상세' }] as const).map(({ v, l }) => (
                <button key={v} onClick={() => { setAddModalTab(v); setAddError('') }}
                  className={`px-4 py-2 text-[13px] font-bold border-b-2 transition-colors
                    ${addModalTab === v ? 'border-ink text-ink' : 'border-transparent text-gray-text hover:text-ink'}`}>
                  {l}
                </button>
              ))}
            </div>

            {/* 카테고리 (공통) */}
            <div className="px-6 pt-6 flex-shrink-0">
              {addingNewCat ? (
                <div className="flex gap-2">
                  <input autoFocus value={newCatInModal} onChange={e => setNewCatInModal(e.target.value)}
                    placeholder="새 카테고리 이름"
                    className="floating-input flex-1 bg-transparent border-b border-gray-border pb-1.5 text-[11px] focus:outline-none focus:border-[#00DD67] transition-colors"
                    onKeyDown={e => e.key === 'Escape' && setAddingNewCat(false)}
                  />
                  <GhostButton onClick={() => setAddingNewCat(false)}>취소</GhostButton>
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="relative flex-1 pt-2">
                    <select value={addCategoryId} onChange={e => setAddCategoryId(e.target.value)}
                      onFocus={() => setCatFocused(true)} onBlur={() => setCatFocused(false)}
                      className="floating-input w-full bg-transparent border-b border-gray-border pb-1.5 pr-7 text-[13px] font-normal text-ink appearance-none focus:outline-none transition-colors"
                      style={{ borderColor: catFocused ? '#00DD67' : undefined }}>
                      <option value=""></option>
                      {sortedCategories().map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <label
                      className="absolute left-0 leading-none pointer-events-none transition-all duration-150"
                      style={{
                        top:      (catFocused || addCategoryId) ? 0 : 8,
                        fontSize: (catFocused || addCategoryId) ? 9 : 13,
                        fontWeight: (catFocused || addCategoryId) ? 500 : 400,
                        color: 'var(--gray-text)',
                        opacity: 0.85,
                      }}
                    >
                      카테고리
                    </label>
                    <svg className="pointer-events-none absolute right-2.5 bottom-2 text-gray-400" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 3.5L5 6.5L8 3.5"/>
                    </svg>
                  </div>
                  <GhostButton onClick={() => { setAddingNewCat(true); setNewCatInModal('') }}>
                    새로 만들기
                  </GhostButton>
                </div>
              )}
            </div>

            {/* ── 일괄 추가 탭 ── */}
            {addModalTab === 'bulk' && (
              <div className="px-6 py-4 space-y-3 overflow-y-auto flex-1">
                <div className="space-y-2">
                  {addRows.map((row, idx) => (
                    <div key={row.id} className="grid grid-cols-[40px_1fr_118px_28px] gap-2 items-center">
                      {/* 이미지 드롭존 */}
                      <div
                        className="w-10 h-9 mr-2 rounded-lg cursor-pointer flex items-center justify-center overflow-hidden relative hover:bg-gray-100 transition-colors flex-shrink-0"
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault()
                          const file = e.dataTransfer.files[0]
                          if (file?.type.startsWith('image/')) updateRowImage(row.id, file)
                        }}
                        onClick={() => (document.getElementById(`bulk-img-${row.id}`) as HTMLInputElement)?.click()}
                      >
                        <input id={`bulk-img-${row.id}`} type="file" accept="image/*" className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) updateRowImage(row.id, f) }}
                        />
                        {row.imagePreview
                          ? <img src={row.imagePreview} className="w-full h-full object-cover" alt="" />
                          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="stroke-gray-400 transition-colors" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        }
                      </div>
                      <FloatingCellInput
                        autoFocus={idx === 0}
                        value={row.name} onChange={v => updateRow(row.id, 'name', v)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRowLine() } }}
                        label="메뉴 이름"
                      />
                      <div className="flex items-center gap-1">
                        <FloatingCellInput
                          inputMode="numeric"
                          value={row.price} onChange={v => updateRow(row.id, 'price', v.replace(/[^0-9]/g,''))}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRowLine() } }}
                          label="금액" format={formatPriceDisplay}
                        />
                        <div className="flex flex-col gap-0.5">
                          <StepperButton direction="up"   onStep={() => updateRow(row.id, 'price', String(Math.max(0, (parseInt(row.price) || 0) + 100)))} />
                          <StepperButton direction="down" onStep={() => updateRow(row.id, 'price', String(Math.max(0, (parseInt(row.price) || 0) - 100)))} />
                        </div>
                      </div>
                      <button type="button" onClick={() => removeRowLine(row.id)}
                        disabled={addRows.length === 1}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-text hover:bg-gray-100 transition-colors disabled:opacity-20">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex justify-start">
                  <GhostButton onClick={addRowLine}>+ 항목 추가</GhostButton>
                </div>
                {addError && <p className="text-[11px] text-danger bg-red-50 rounded-lg px-3 py-2">{addError}</p>}
              </div>
            )}

            {/* ── 상세 추가 탭 ── */}
            {addModalTab === 'detail' && (
              <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
                {/* 사진 (좌) + 메뉴 이름·금액 (우, 2줄) */}
                <div className="flex gap-3">
                  <div>
                    <div
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault()
                        const file = e.dataTransfer.files[0]
                        if (file?.type.startsWith('image/')) { setImageFile(file); setImagePreview(URL.createObjectURL(file)) }
                      }}
                    >
                    <label className="block cursor-pointer">
                      <input type="file" accept="image/*" className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          setImageFile(file)
                          setImagePreview(URL.createObjectURL(file))
                        }}
                      />
                      {imagePreview ? (
                        <div className="relative w-[96px] h-[96px] rounded-xl overflow-hidden border border-gray-border">
                          <img src={imagePreview} className="w-full h-full object-cover" alt="preview" />
                          <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                            <span className="text-white text-[11px] font-bold">변경</span>
                          </div>
                        </div>
                      ) : (
                        <div className="w-[96px] h-[96px] rounded-xl flex flex-col items-center justify-center gap-1.5 hover:bg-gray-100 transition-colors">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="stroke-gray-400" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                          <span className="text-[10px] text-gray-400 leading-tight text-center transition-colors">메뉴 사진</span>
                        </div>
                      )}
                    </label>
                    {imagePreview && (
                      <button type="button" onClick={() => { setImageFile(null); setImagePreview('') }}
                        className="mt-1 text-[11px] text-danger hover:underline">사진 제거</button>
                    )}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center gap-2.5">
                    <FloatingCellInput
                      autoFocus
                      value={detailForm.name} onChange={v => setDetailForm(p => ({ ...p, name: v }))}
                      label="메뉴 이름"
                    />
                    <div className="flex items-center gap-1.5">
                      <FloatingCellInput
                        inputMode="numeric"
                        value={detailForm.price} onChange={v => setDetailForm(p => ({ ...p, price: v.replace(/[^0-9]/g,'') }))}
                        label="금액" format={formatPriceDisplay}
                      />
                      <div className="flex flex-col gap-0.5">
                        <StepperButton direction="up"   onStep={() => setDetailForm(p => ({ ...p, price: String(Math.max(0, (parseInt(p.price) || 0) + 100)) }))} />
                        <StepperButton direction="down" onStep={() => setDetailForm(p => ({ ...p, price: String(Math.max(0, (parseInt(p.price) || 0) - 100)) }))} />
                      </div>
                    </div>
                  </div>
                </div>
                {/* 설명 — 안 쓰는 점주가 대부분이다(침산점 161개 중 1개).
                    '(선택)'만으로는 "써서 뭐가 되는지"를 몰라 그냥 건너뛰게 된다.
                    어디에 보이는지 한 줄로 말해주고, 쓸지 말지는 점주가 고르게 둔다. */}
                <div>
                  <FloatingCellTextarea
                    value={detailForm.description}
                    onChange={v => setDetailForm(p => ({ ...p, description: v }))}
                    label="메뉴 설명 (선택)"
                  />
                  <p className="mt-[6px] text-[11px] text-[#ADADAD] leading-relaxed">
                    손님 주문 화면에서 메뉴 이름 아래에 작게 보여요. 비워두면 안 보입니다.
                  </p>
                </div>
                {/* 옵션 그룹 */}
                {storeGroups.length > 0 && (
                  <div>
                    <label className="text-[11px] font-bold text-gray-text uppercase tracking-wide block mb-1.5">옵션 그룹 연결</label>
                    <div className="border border-gray-border rounded-xl divide-y divide-gray-border overflow-hidden">
                      {storeGroups.map(g => (
                        <label key={g.id} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-bg cursor-pointer">
                          <input type="checkbox" checked={selectedGroupIds.includes(g.id)}
                            onChange={e => setSelectedGroupIds(prev =>
                              e.target.checked ? [...prev, g.id] : prev.filter(id => id !== g.id)
                            )}
                            className="w-4 h-4 accent-[#00DD67] flex-shrink-0"
                          />
                          <span className="text-[11px] font-semibold text-ink flex-1">{g.name}</span>
                          <span className="text-[11px] text-gray-text">{g.items.length}개 항목</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {addError && <p className="text-[11px] text-danger bg-red-50 rounded-lg px-3 py-2">{addError}</p>}
              </div>
            )}

            {/* 푸터 */}
            <div className="bg-white flex justify-end px-5 py-4 flex-shrink-0">
              {addModalTab === 'bulk' ? (
                <ModalCTAButton onClick={confirmAddMenu} disabled={addLoading}>
                  {addLoading ? '저장 중...' : `${addRows.filter(r => r.name.trim() && r.price.trim()).length}개 추가`}
                </ModalCTAButton>
              ) : (
                <ModalCTAButton onClick={confirmDetailMenu} disabled={addLoading}>
                  {addLoading ? '저장 중...' : '추가'}
                </ModalCTAButton>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 플로팅 일괄 액션바 */}
      {tab === 'menu' && checked.size > 0 && (() => {
        const checkedMenus = menus.filter(m => checked.has(m.code))
        const states       = checkedMenus.map(m => getSoldOutState(m.soldOut, m.soldOutUntil ?? null))
        const allActive    = states.every(s => s === 'active')
        const allToday     = states.every(s => s === 'today')
        const allPermanent = states.every(s => s === 'permanent')
        const allHidden    = checkedMenus.every(m => !m.active)
        return (
          /* 토스트는 아니지만(버튼이 여럿인 작업 바) 하단 중앙에 뜨는 같은 종류의 면이라
             박스 값은 토스트와 공유한다 — TOAST_BOX (components/BottomToast.tsx).
             py 는 버튼이 들어가서 조금 더 눕힌다. */
          <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 ${TOAST_BOX} !py-[9px]`}>
            <span className="text-[11px] font-semibold text-white/70">{checked.size}개 선택</span>
            <div className="w-px h-5 bg-white/20" />
            {/* 판매 상태 */}
            {!allActive && (
              <button onClick={() => bulkAction('unsoldOut')}
                className="text-[11px] font-bold transition-colors"
                style={{ color: 'white' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#86EFAC')}
                onMouseLeave={e => (e.currentTarget.style.color = 'white')}>
                판매중으로
              </button>
            )}
            {!allActive && !allToday && <div className="w-px h-5 bg-white/20" />}
            {!allToday && (
              <button onClick={() => bulkAction('todaySoldOut')}
                className="text-[11px] font-bold transition-colors"
                style={{ color: 'white' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#FCD34D')}
                onMouseLeave={e => (e.currentTarget.style.color = 'white')}>
                오늘품절
              </button>
            )}
            {!allPermanent && <div className="w-px h-5 bg-white/20" />}
            {!allPermanent && (
              <button onClick={() => bulkAction('soldOut')}
                className="text-[11px] font-bold transition-colors"
                style={{ color: 'white' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#FCA5A5')}
                onMouseLeave={e => (e.currentTarget.style.color = 'white')}>
                품절
              </button>
            )}
            <div className="w-px h-5 bg-white/20" />
            <button onClick={() => bulkAction(allHidden ? 'unhide' : 'hide')}
              className="text-[11px] font-bold transition-colors"
              style={{ color: 'white' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#D1D5DB')}
              onMouseLeave={e => (e.currentTarget.style.color = 'white')}>
              {allHidden ? '숨김 해제' : '숨김'}
            </button>
            <div className="w-px h-5 bg-white/20" />
            <button onClick={() => setDeleteConfirm('bulk')}
              className="text-[11px] font-bold text-red-400 hover:text-red-300 transition-colors">
              삭제
            </button>
            <button onClick={() => setChecked(new Set())} className="text-white/50 hover:text-white text-[18px] ml-1">✕</button>
          </div>
        )
      })()}

      {/* 삭제 확인 다이얼로그 */}
      {/* 바깥 클릭으로 닫지 않는다(의도) — 삭제는 되돌릴 수 없다. ModalOverlay 를 쓰지 않는 이유다. */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          {/* 매장 설정의 로그아웃·회원탈퇴 확인창과 같은 시스템 —
              #FCFCFC · rounded-18 · 본문/푸터 분리 · 우측 CTA.
              전엔 흰 카드에 11px 글씨(본문보다도 작아 경고가 작게 읽혔다)와
              bg-danger 정색 빨강 버튼이었다. 지금 시스템의 danger 는 연분홍 바탕에
              빨강 글씨(#FFEFEF/#FF676F)다 — 주문 거부·로그아웃과 같은 결. */}
          <div className="modal-in bg-[#FCFCFC] rounded-[18px] shadow-[0px_1px_8.3px_1px_rgba(0,0,0,0.1)] w-[420px] max-w-[92vw] flex flex-col overflow-hidden">
            <div className="px-[28px] pt-[28px] pb-[22px]">
              <div className="text-[18px] font-semibold text-[#1E1E1E] mb-[6px]">
                {deleteConfirm === 'bulk'
                  ? `메뉴 ${checked.size}개를 삭제할까요?`
                  : `'${selected?.name}'을(를) 삭제할까요?`}
              </div>
              <div className="text-[13px] font-normal text-[#787878] leading-relaxed">
                삭제하면 되돌릴 수 없어요. 지난 주문 기록의 메뉴 이름과 금액은
                주문 시점 그대로 남습니다.
              </div>
            </div>
            <div className="px-[28px] py-[16px] flex justify-end gap-[10px] modal-footer">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="h-[50px] px-[26px] rounded-[13px] bg-[#E8E4E2] text-[#6A635E] text-[16px] font-medium hover:brightness-95 transition-all"
              >
                취소
              </button>
              <button
                onClick={() => {
                  if (deleteConfirm === 'bulk') deleteMenus([...checked])
                  else if (selected) deleteMenus([selected.code])
                }}
                className="h-[50px] px-[26px] rounded-[13px] bg-[#FFEFEF] text-[#FF676F] text-[16px] font-medium hover:brightness-95 transition-all"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 카테고리 바로가기 모달 (메뉴 탭) */}
      {catJumpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setCatJumpOpen(false)}
        >
          <div
            className="modal-in bg-white rounded-2xl w-[520px] px-4 py-5 max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-[16px] font-extrabold text-ink mb-3 flex-shrink-0">카테고리</p>
            <div className="flex flex-wrap gap-2 overflow-y-auto">
              <button
                onClick={() => { setCatFilter('all'); setCatJumpOpen(false) }}
                className={`whitespace-nowrap py-2 px-3 text-[11px] font-semibold rounded-xl transition-colors
                  ${catFilter === 'all' ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
              >전체</button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => { setCatFilter(cat.id); setCatJumpOpen(false) }}
                  className={`whitespace-nowrap py-2 px-3 text-[11px] font-semibold rounded-xl transition-colors
                    ${catFilter === cat.id ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}
                >{cat.name}</button>
              ))}
            </div>
            <button
              onClick={() => setCatJumpOpen(false)}
              className="mt-4 w-full py-2 text-[11px] font-bold text-gray-text bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors flex-shrink-0"
            >닫기</button>
          </div>
        </div>
      )}



      {/* ── 카테고리 추가 모달 ── */}
      {addingCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAddingCat(false)}>
          <div className="modal-in bg-white rounded-2xl shadow-xl w-[460px]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-6 pb-0">
              <span className="text-[17px] font-semibold">카테고리 추가</span>
              <button onClick={() => setAddingCat(false)} className="text-gray-text hover:text-ink text-[18px]">✕</button>
            </div>
            <div className="px-6 py-8">
              <FloatingCellInput
                autoFocus
                value={newCatName}
                onChange={setNewCatName}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newCatName.trim()) { addCategory(newCatName); setNewCatName(''); setAddingCat(false) }
                  if (e.key === 'Escape') setAddingCat(false)
                }}
                label="카테고리 이름 (예: 샐러드)"
              />
            </div>
            <div className="flex justify-end px-5 py-4">
              <ModalCTAButton
                onClick={() => { if (newCatName.trim()) { addCategory(newCatName); setNewCatName(''); setAddingCat(false) } }}
                disabled={!newCatName.trim()}>
                추가
              </ModalCTAButton>
            </div>
          </div>
        </div>
      )}

      {/* ── 옵션 추가 마법사 — components/menu/OptionGroupAddModal.tsx 로 꺼냈다.
             상품 허브의 '옵션 정보' 화면도 같은 모달을 띄운다. ── */}
      {addingStoreGroup && storeId && (
        <OptionGroupAddModal
          storeId={storeId}
          menus={menus.map(m => ({ code: m.code, name: m.name, categoryId: m.categoryId, soldOut: m.soldOut }))}
          categories={sortedCategories().map(c => ({ id: c.id, name: c.name }))}
          displayOrder={storeGroups.length}
          /* 메뉴 상세 모달의 '+ 옵션 추가'로 들어온 경우, 2단계에서 그 메뉴를 미리 체크해 둔다.
             추가(add) 모드는 메뉴가 아직 DB 에 없어 붙일 대상이 없다 — 그건 저장 직후
             onCreated 의 menuForm.toggleGroup 이 대신 처리한다. */
          preselectMenuCodes={menuForm.mode === 'edit' && menuForm.editing ? [menuForm.editing.code] : undefined}
          onClose={() => setAddingStoreGroup(false)}
          onCreated={(g, menuIds) => {
            const newGroup: any = {
              id: g.id, name: g.name,
              isRequired: g.isRequired,
              isMulti:    g.isMulti,
              maxSelect:  g.maxSelect,
              isSoldOut: false, soldOutUntil: null, isHidden: false,
              usedBy: menuIds.map(id => menus.find(m => m.code === id)?.name ?? '').filter(Boolean),
              usedByMenus: menuIds.map(id => {
                const m = menus.find(m2 => m2.code === id)
                return m ? { name: m.name, soldOut: false, hidden: false } : null
              }).filter(Boolean),
              items: g.items,
            }
            setStoreGroups(prev => [...prev, newGroup])
            if (selected && menuIds.includes(selected.code)) {
              applyLocalUpdate({ ...selected, optionGroups: [...selected.optionGroups, newGroup] })
            }
            // 메뉴 상세 모달에서 "+ 옵션 추가"로 들어온 경우, 새 그룹을 지금 편집 중인 메뉴에 바로 선택 처리
            if (menuForm.mode) menuForm.toggleGroup(g.id)
          }}
        />
      )}

    </div>
  )
}

// ── OptionGroupRow (왼쪽 목록 행) ─────────────────────────────────────────────
function OptionGroupRow({
  group, isSelected, onClick,
}: {
  group:      OptionGroup & { isSoldOut: boolean; soldOutUntil: string | null; isHidden: boolean }
  isSelected: boolean
  onClick:    () => void
}) {
  const soldOutState = getSoldOutState(group.isSoldOut, group.soldOutUntil)
  const selectLabel  = !group.isMulti ? '단일' : group.maxSelect ? `최대 ${group.maxSelect}개` : '복수'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-border transition-colors flex flex-col gap-1.5
        ${isSelected
          ? 'bg-gray-50'
          : 'hover:bg-gray-50'}
        ${group.isHidden ? 'opacity-60' : ''}`}
    >
      {/* 그룹명 + 상태 배지 */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`font-semibold text-[13px] flex-1 truncate text-ink ${isSelected ? 'underline' : ''}`}>
          {group.name}
        </span>
        {soldOutState === 'today' && (
          <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'rgba(217,119,6,0.12)', color: '#D97706' }}>오늘품절</span>
        )}
        {soldOutState === 'permanent' && (
          <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: 'rgba(201,42,42,0.1)', color: '#C92A2A' }}>품절</span>
        )}
        {group.isHidden && (
          <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-200 text-gray-text">숨김</span>
        )}
      </div>
      {/* 속성 배지 */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">
          {group.isRequired ? '필수' : '선택'}
        </span>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">
          {selectLabel}
        </span>
        <span className="text-[10px] text-gray-text ml-auto">
          {group.items.length}개 항목
        </span>
      </div>
    </button>
  )
}

// ── Toggle 미니 컴포넌트 (홈화면 스타일) ────────────────────────────────────────
function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 flex-shrink-0 ${on ? 'bg-[#00DD67]' : 'bg-gray-300'}`}
    >
      <span className={`absolute top-[3px] left-[3px] w-3 h-3 bg-white rounded-full shadow-sm transition-transform duration-200 ${on ? 'translate-x-[14px]' : 'translate-x-0'}`} />
    </button>
  )
}



// ── OptionGroupPanel (오른쪽 상세 패널) ────────────────────────────────────────
function OptionGroupPanel({
  group, isSoldOut, soldOutUntil = null, isHidden, usedByMenus, searchQuery, readOnly = false,
  onSetSoldOutState, onToggleHidden,
  onUpdateGroup, onDeleteGroup, onUpdateItem, onDeleteItem, onAddItem, onReorderItem,
}: {
  group:               OptionGroup
  isSoldOut:           boolean
  soldOutUntil?:       string | null
  isHidden:            boolean
  usedByMenus?:        { name: string; soldOut: boolean; hidden: boolean }[]
  searchQuery?:        string
  readOnly?:           boolean
  onSetSoldOutState:   (state: SoldOutState) => void
  onToggleHidden:      () => void
  onUpdateGroup:       (updates: Partial<OptionGroup>) => void
  onDeleteGroup:       () => void
  onUpdateItem:        (itemId: string, updates: Partial<OptionItem>) => void
  onDeleteItem:        (itemId: string) => void
  onAddItem:           (name: string, extra: number) => void
  onReorderItem:       (fromIdx: number, toIdx: number) => void
}) {
  const [editingItemId,    setEditingItemId]    = useState<string | null>(null)
  const [editItemName,     setEditItemName]     = useState('')
  const [editItemPrice,    setEditItemPrice]    = useState('')
  const [showAddItem,      setShowAddItem]      = useState(false)
  const [newItemName,      setNewItemName]      = useState('')
  const [newItemPrice,     setNewItemPrice]     = useState('0')
  const [settingsOpen,     setSettingsOpen]     = useState(false)
  const [settingsName,     setSettingsName]     = useState(group.name)
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState(false)
  const [deleteItemConfirm,  setDeleteItemConfirm]  = useState<{ id: string; name: string } | null>(null)
  const [dragItemIdx,      setDragItemIdx]      = useState<number | null>(null)
  const [dragOverItemIdx,  setDragOverItemIdx]  = useState<number | null>(null)

  // 그룹이 바뀌면 편집 상태 초기화
  useEffect(() => {
    setEditingItemId(null)
    setShowAddItem(false)
    setNewItemName('')
    setNewItemPrice('0')
    setSettingsName(group.name)
    setDeleteGroupConfirm(false)
  }, [group.id])

  function startEditItem(item: OptionItem) {
    setEditingItemId(item.id)
    setEditItemName(item.name)
    setEditItemPrice(String(item.extra))
  }

  function commitEditItem() {
    if (!editingItemId || !editItemName.trim()) { setEditingItemId(null); return }
    onUpdateItem(editingItemId, { name: editItemName.trim(), extra: Math.max(0, parseInt(editItemPrice, 10) || 0) })
    setEditingItemId(null)
  }

  function confirmAddItem() {
    if (!newItemName.trim()) return
    onAddItem(newItemName.trim(), Math.max(0, parseInt(newItemPrice, 10) || 0))
    setNewItemName('')
    setNewItemPrice('0')
    setShowAddItem(false)
  }

  const sq = searchQuery?.trim() ?? ''
  const groupSoldOutState = getSoldOutState(isSoldOut, soldOutUntil)

  // ── readOnly 전용 렌더링 ──────────────────────────────────────────────────────
  if (readOnly) {
    return (
      <div className="border border-gray-border rounded-xl overflow-hidden">
        {/* 그룹 헤더 */}
        <div className="px-3 py-2.5 flex items-center justify-between bg-gray-50 border-b border-gray-border">
          <span className="text-[13px] font-semibold text-ink">{group.name}</span>
          <div className="flex items-center gap-1.5">
            {groupSoldOutState !== 'active' && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={groupSoldOutState === 'today'
                  ? { backgroundColor: '#FEF3C7', color: '#D97706' }
                  : { backgroundColor: '#FEE2E2', color: '#C92A2A' }}>
                {groupSoldOutState === 'today' ? '오늘품절' : '품절'}
              </span>
            )}
            {isHidden && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-200 text-gray-text">숨김</span>}
          </div>
        </div>
        {/* 항목 목록 */}
        <div className="flex flex-col px-3 py-1">
          {group.items.map((item: OptionItem) => {
            const itemState = getSoldOutState(item.soldOut, item.soldOutUntil ?? null)
            return (
              <div key={item.id} className={`flex items-center gap-2 px-3 py-1.5 text-[12px] ${item.hidden ? 'opacity-50' : ''}`}>
                <span className="flex-1 font-medium text-ink truncate">{item.name}</span>
                {item.extra > 0 && <span className="text-[11px] text-gray-text">+{won(item.extra)}</span>}
                {itemState !== 'active' && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={itemState === 'today'
                      ? { backgroundColor: '#FEF3C7', color: '#D97706' }
                      : { backgroundColor: '#FEE2E2', color: '#C92A2A' }}>
                    {itemState === 'today' ? '오늘품절' : '품절'}
                  </span>
                )}
                {item.hidden && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-text flex-shrink-0">숨김</span>}
              </div>
            )
          })}
          {group.items.length === 0 && (
            <div className="text-center py-3 text-[11px] text-gray-text">항목 없음</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 설정 모달 */}
      {settingsOpen && (
        <ModalOverlay onClose={() => setSettingsOpen(false)} z={50}>
          <div className="modal-in bg-white rounded-2xl shadow-xl w-[560px]">
            {/* 헤더 */}
            <div className="flex items-center justify-between px-6 pt-6 pb-0">
              <div className="text-[17px] font-semibold">옵션 그룹 설정</div>
              <button onClick={() => setSettingsOpen(false)} className="text-gray-text hover:text-ink text-[18px]">✕</button>
            </div>
            {/* 바디 */}
            <div className="px-5 py-[30px] flex flex-col gap-4">
              <div>
                <label className="text-[13px] font-semibold text-gray-text block mb-1.5">그룹명</label>
                <input value={settingsName} onChange={e => setSettingsName(e.target.value)}
                  className="w-full border border-gray-border rounded-xl px-3 py-2.5 text-[13px] focus:outline-none focus:border-ink transition-colors" />
              </div>
              <div>
                <label className="text-[13px] font-semibold text-gray-text block mb-1.5">필수 여부</label>
                <SegmentedControl
                  options={[{ label: '필수', value: true }, { label: '선택', value: false }]}
                  value={group.isRequired}
                  onChange={(v) => onUpdateGroup({ isRequired: v })}
                  rounded="xl"
                />
              </div>
              <div>
                <label className="text-[13px] font-semibold text-gray-text block mb-1.5">복수 여부</label>
                <SegmentedControl
                  options={[{ label: '단일', value: false }, { label: '복수', value: true }]}
                  value={group.isMulti}
                  onChange={(v) => onUpdateGroup({ isMulti: v, maxSelect: null })}
                  rounded="xl"
                />
                {group.isMulti && (
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {[2, 3, 4, 5].map(n => {
                      const active = group.maxSelect === n
                      return (
                        <button key={n} type="button"
                          onClick={() => onUpdateGroup({ maxSelect: active ? null : n })}
                          className={`py-2 rounded-lg text-[11px] font-semibold transition-colors focus:outline-none
                            ${active ? 'bg-green-soft text-green' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>
                          최대 {n}개
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
            {/* 푸터 */}
            <div className="bg-white flex gap-2.5 px-6 pt-5 pb-6">
              {!deleteGroupConfirm ? (
                <button onClick={() => setDeleteGroupConfirm(true)}
                  className="flex-1 py-2.5 rounded-xl bg-red-50 text-danger font-bold text-[13px] hover:bg-red-100 transition-colors focus:outline-none">
                  삭제
                </button>
              ) : (
                <button onClick={() => { onDeleteGroup(); setSettingsOpen(false) }}
                  className="flex-1 py-2.5 rounded-xl bg-danger text-white font-bold text-[13px] hover:bg-danger/90 transition-colors focus:outline-none">
                  삭제 확정
                </button>
              )}
              <button onClick={() => { if (settingsName.trim()) onUpdateGroup({ name: settingsName.trim() }); setSettingsOpen(false) }}
                className="flex-[2] py-2.5 rounded-xl bg-[#00DD67] text-[#1A1A1A] font-bold text-[13px] hover:bg-[#00BB55] transition-colors focus:outline-none">
                저장
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* 항목 삭제 확인 모달 */}
      {deleteItemConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteItemConfirm(null)}>
          <div className="modal-in bg-white rounded-2xl shadow-xl p-6 w-[300px]" onClick={e => e.stopPropagation()}>
            <div className="text-[13px] font-semibold text-ink mb-1">옵션 삭제</div>
            <div className="text-[12px] text-gray-text mb-5">
              <span className="font-semibold text-ink">'{deleteItemConfirm.name}'</span>을(를) 삭제할까요?
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDeleteItemConfirm(null)}
                className="flex-1 py-2 border border-gray-border rounded-xl text-[11px] font-semibold text-gray-text hover:bg-gray-bg">취소</button>
              <button onClick={() => { onDeleteItem(deleteItemConfirm.id); setDeleteItemConfirm(null) }}
                className="flex-1 py-2 bg-danger text-white rounded-xl text-[11px] font-bold hover:bg-danger/90">삭제</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 패널 헤더: 그룹명 + 상태 토글 + ⚙ ── */}
      <div className="bg-white border-b border-gray-border px-5 py-4 flex-shrink-0"
        style={{ opacity: isHidden ? 0.75 : 1 }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-semibold text-ink break-words">{group.name}</div>
          </div>

          {readOnly && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                groupSoldOutState === 'today'     ? 'bg-amber-100 text-amber-700' :
                groupSoldOutState === 'permanent' ? 'bg-red-100 text-danger' :
                                                    'bg-gray-100 text-gray-text'}`}>
                {groupSoldOutState === 'today' ? '오늘품절' : groupSoldOutState === 'permanent' ? '품절' : '판매중'}
              </span>
              {isHidden && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-200 text-gray-text">숨김</span>}
            </div>
          )}

          {!readOnly && (
            <div className="flex items-start gap-2 flex-shrink-0">
              {/* 판매중 + 오늘품절 (세로 스택) */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-ink w-[46px] text-right inline-block whitespace-nowrap">
                    {groupSoldOutState === 'active' ? '판매중' : '품절'}
                  </span>
                  <Toggle
                    on={groupSoldOutState === 'active'}
                    onChange={() => onSetSoldOutState(groupSoldOutState === 'active' ? 'today' : 'active')}
                  />
                </div>
                {/* 오늘품절 — 판매중 바로 아래, 항상 공간 예약 */}
                <div className={`flex items-center gap-1.5 ${groupSoldOutState === 'active' ? 'invisible' : ''}`}>
                  <span className="text-[11px] font-semibold text-ink w-[46px] text-right inline-block whitespace-nowrap">
                    {groupSoldOutState === 'today' ? '오늘품절' : '계속품절'}
                  </span>
                  <Toggle
                    on={groupSoldOutState === 'today'}
                    onChange={() => onSetSoldOutState(groupSoldOutState === 'today' ? 'permanent' : 'today')}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5 items-start">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-ink">
                    {isHidden ? '숨김중' : '노출중'}
                  </span>
                  <Toggle on={!isHidden} onChange={onToggleHidden} />
                </div>
                <GhostButton onClick={() => { setSettingsName(group.name); setDeleteGroupConfirm(false); setSettingsOpen(true) }}>
                  <span className="flex items-center gap-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                    그룹 설정
                  </span>
                </GhostButton>
              </div>
            </div>
          )}
        </div>
        {/* 연결 메뉴 태그 — 전체 너비 */}
        {usedByMenus !== undefined && usedByMenus.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {usedByMenus.map(m => (
              <span key={m.name} className="inline-flex items-center gap-1">
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${m.hidden ? 'text-gray-text bg-gray-100 opacity-35' : 'text-gray-text bg-gray-100'}`}>
                  {m.name}{m.hidden ? ' (숨김)' : ''}
                </span>
                {m.soldOut && <span className="text-[9px] font-bold text-white bg-danger rounded px-1 leading-none">품절</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── 항목 목록 ── */}
      <div className="flex-1 bg-white overflow-y-auto">
        <div
          className={readOnly ? 'flex flex-col gap-1.5 px-3 py-2' : 'flex flex-col gap-2 px-3 py-2'}
        >
          {group.items.map((item: OptionItem, itemIdx: number) => {
            const isMatch = sq && (item.name.includes(sq))
            const itemState = getSoldOutState(item.soldOut, item.soldOutUntil ?? null)
            const isUnavailable = itemState !== 'active' || item.hidden
            return editingItemId === item.id && !readOnly ? (
              <div key={item.id} className="flex items-center gap-2 px-4 py-2.5 w-full rounded-lg" style={{ background: 'var(--gray-bg)' }}>
                <input autoFocus value={editItemName} onChange={e => setEditItemName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitEditItem(); if (e.key === 'Escape') setEditingItemId(null) }}
                  className="flex-1 min-w-0 border-0 border-b border-[#00DD67] bg-transparent px-0 py-1 text-[12px] focus:outline-none"
                />
                <div className="flex items-center gap-1 flex-shrink-0">
                  <input type="text" value={editItemPrice}
                    onChange={e => setEditItemPrice(e.target.value.replace(/[^0-9]/g, ''))}
                    onKeyDown={e => { if (e.key === 'Enter') commitEditItem(); if (e.key === 'Escape') setEditingItemId(null) }}
                    className="w-14 border-0 border-b border-[#00DD67] bg-transparent px-0 py-1 text-[11px] text-right focus:outline-none"
                  />
                  <span className="text-[11px] text-gray-text">원</span>
                </div>
                <div className="flex flex-col gap-0.5 flex-shrink-0">
                  <StepperButton direction="up"   onStep={() => setEditItemPrice(String((parseInt(editItemPrice) || 0) + 500))} />
                  <StepperButton direction="down" onStep={() => setEditItemPrice(String(Math.max(0, (parseInt(editItemPrice) || 0) - 500)))} />
                </div>
                <button onClick={commitEditItem}
                  className="flex-shrink-0 px-2.5 py-1 rounded-lg bg-[#00DD67] text-[#1A1A1A] text-[10px] font-bold hover:bg-[#00BB55]">완료</button>
              </div>
            ) : (
              <div
                key={item.id}
                draggable={!readOnly}
                onDragStart={!readOnly ? () => setDragItemIdx(itemIdx) : undefined}
                onDragOver={!readOnly ? (e => { e.preventDefault(); setDragOverItemIdx(itemIdx) }) : undefined}
                onDrop={!readOnly ? (e => {
                  e.preventDefault()
                  if (dragItemIdx !== null && dragItemIdx !== itemIdx) {
                    onReorderItem(dragItemIdx, itemIdx)
                  }
                  setDragItemIdx(null)
                  setDragOverItemIdx(null)
                }) : undefined}
                onDragEnd={!readOnly ? (() => { setDragItemIdx(null); setDragOverItemIdx(null) }) : undefined}
                className={`flex items-center gap-2.5 text-[12px] group/row transition-colors
                  ${readOnly ? 'px-3 py-2 rounded-lg bg-gray-50 w-full' : 'px-3 py-2 rounded-lg border border-gray-border bg-white w-full'}
                  ${!readOnly && dragOverItemIdx === itemIdx && dragItemIdx !== itemIdx ? '!border-green !border-2' : ''}
                  ${!readOnly && dragItemIdx === itemIdx ? 'opacity-40' : ''}`}
                style={isMatch ? { backgroundColor: 'var(--green-soft)' } : undefined}
              >
                {!readOnly && (
                  <span className="flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-border hover:text-gray-text transition-colors"
                    onMouseDown={e => e.stopPropagation()}>
                    <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
                      <circle cx="2" cy="2" r="1.5"/><circle cx="6" cy="2" r="1.5"/>
                      <circle cx="2" cy="6" r="1.5"/><circle cx="6" cy="6" r="1.5"/>
                      <circle cx="2" cy="10" r="1.5"/><circle cx="6" cy="10" r="1.5"/>
                    </svg>
                  </span>
                )}
                <div className="flex items-center gap-1.5 min-w-0 flex-1" onClick={!readOnly ? () => startEditItem(item) : undefined}
                  style={!readOnly ? { cursor: 'pointer' } : undefined}>
                  <span className={`font-medium text-ink truncate ${!readOnly ? 'hover:text-green transition-colors' : ''} ${isMatch && sq ? 'text-green font-bold' : ''} ${isUnavailable ? 'opacity-40 line-through' : ''}`}>{item.name}</span>
                  {item.isPopular && <span className="text-[10px] font-bold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full flex-shrink-0">🔥</span>}
                  {item.extra > 0 && <span className="text-[11px] text-gray-text flex-shrink-0">+{won(item.extra)}</span>}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {(() => {
                    const nextState: SoldOutState = itemState === 'active' ? 'today' : itemState === 'today' ? 'permanent' : 'active'
                    const nextUpdates =
                      nextState === 'active'  ? { soldOut: false, soldOutUntil: null             }
                      : nextState === 'today' ? { soldOut: true,  soldOutUntil: getKSTEndOfDay() }
                      :                         { soldOut: true,  soldOutUntil: null             }
                    return readOnly ? (
                      itemState !== 'active' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium"
                          style={itemState === 'today' ? { backgroundColor: '#FEF3C7', color: '#D97706' } : { backgroundColor: '#FEE2E2', color: '#C92A2A' }}>
                          {itemState === 'today' ? '오늘품절' : '품절'}
                        </span>
                      )
                    ) : (
                      <button onClick={() => onUpdateItem(item.id, nextUpdates)}
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold border-0 transition-colors"
                        style={
                          itemState === 'today'
                            ? { backgroundColor: '#FEF3C7', color: '#D97706' }
                            : itemState === 'permanent'
                            ? { backgroundColor: '#FEE2E2', color: '#C92A2A' }
                            : { backgroundColor: '#F3F4F6', color: '#727272' }
                        }>
                        {itemState === 'today' ? '오늘품절' : itemState === 'permanent' ? '품절' : '판매중'}
                      </button>
                    )
                  })()}
                  {!readOnly && (
                    <>
                      <div className="w-px h-3 bg-gray-200 flex-shrink-0" />
                      <button onClick={() => onUpdateItem(item.id, { hidden: !item.hidden })}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border-0 transition-colors
                          ${item.hidden ? 'bg-ink text-white' : 'bg-gray-100 text-gray-text hover:bg-gray-200'}`}>숨김</button>
                      <button onClick={() => setDeleteItemConfirm({ id: item.id, name: item.name })}
                        className="w-6 h-6 flex items-center justify-center rounded-full text-[13px] text-gray-text hover:bg-red-100 hover:text-danger transition-colors opacity-0 group-hover/row:opacity-100">×</button>
                    </>
                  )}
                  {readOnly && item.hidden && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-200 text-gray-text">숨김</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* 항목 추가 */}
        {!readOnly && showAddItem ? (
          <div className="flex items-center gap-2 px-4 py-2.5 border-t border-gray-border bg-green-soft/40">
            <input autoFocus value={newItemName} onChange={e => setNewItemName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmAddItem(); if (e.key === 'Escape') setShowAddItem(false) }}
              placeholder="옵션명" className="flex-1 min-w-0 border border-green rounded-md px-2 py-1 text-[12px]"
            />
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-[11px] text-gray-text">+₩</span>
              <input type="number" min="0" step="500" value={newItemPrice} onChange={e => setNewItemPrice(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmAddItem(); if (e.key === 'Escape') setShowAddItem(false) }}
                className="w-16 border border-green rounded-md px-2 py-1 text-[12px]"
              />
            </div>
            <button onClick={confirmAddItem} disabled={!newItemName.trim()}
              className="flex-shrink-0 text-[11px] font-bold text-white bg-green px-2.5 py-1 rounded-lg hover:bg-[#015c28] disabled:opacity-40">추가</button>
            <button onClick={() => { setShowAddItem(false); setNewItemName(''); setNewItemPrice('0') }}
              className="flex-shrink-0 text-gray-text hover:text-ink text-[13px]">✗</button>
          </div>
        ) : !readOnly ? (
          <div className="flex justify-end px-4 py-2.5 modal-footer">
            <GhostButton onClick={() => setShowAddItem(true)} size="lg">+ 항목 추가</GhostButton>
          </div>
        ) : null}

        {group.items.length === 0 && !showAddItem && (
          <div className="text-center py-10 text-gray-text text-[12px]">
            아직 항목이 없습니다. 아래에서 추가하세요.
          </div>
        )}
      </div>
    </div>
  )
}
