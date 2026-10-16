import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'

// 상단 헤더의 알림 종.
//
// 자리를 프린터 표시에서 물려받았다. 프린터 연결 여부는 "평소엔 아무 일도 없고, 문제가
// 생기면 영수증이 안 나와서 바로 안다" — 늘 떠 있을 만큼 급한 정보가 아니었다.
// 반대로 관리자 등록은 **일어난 순간 점주가 알아야** 하는데 알릴 자리가 없었다.
//
// 지금 알리는 것: 거래처 관리자/이용자가 등록 링크 + 카카오 로그인으로 **등록을 끝낸 순간**.
// 출처는 user_account_links — 등록이 끝나면 그 행이 생긴다(role='관리자' | '이용자').
//
// 읽음 처리는 localStorage 에 "마지막으로 종을 연 시각" 하나만 둔다. 그보다 나중에
// 생긴 알림이 안 읽은 것이다. 알림마다 읽음 플래그를 두면 DB 테이블이 하나 더 필요한데,
// 지금 알림은 종류가 하나뿐이라 그만한 값을 하지 못한다.

interface Notif {
  id:         string
  at:         string
  who:        string
  accountName: string
  role:       string
}

const READ_KEY = 'pos_notifs_read_at'

/** '방금' · '12분 전' · '3시간 전' · '10/14' */
function agoLabel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min  = Math.floor(diff / 60_000)
  if (min < 1)   return '방금'
  if (min < 60)  return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24)   return `${hr}시간 전`
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function NotificationBell({ storeId }: { storeId: string | null }) {
  const [open,   setOpen]   = useState(false)
  const [items,  setItems]  = useState<Notif[]>([])
  const [readAt, setReadAt] = useState<string>(() => {
    try { return localStorage.getItem(READ_KEY) ?? '' } catch { return '' }
  })
  const wrapRef = useRef<HTMLDivElement | null>(null)

  async function load() {
    if (!storeId) return
    // 테이블을 직접 조인하지 않고 RPC 로 받는다 — 닉네임이 있는 sunpos_users 는
    // RLS 가 (auth.uid() = id) 라 점주가 조인해도 전부 null 이 된다.
    // store_notifications 가 my_store_ids() 로 범위를 가두고 필요한 네 칸만 돌려준다.
    const { data, error } = await supabase.rpc('store_notifications', {
      p_store_id: storeId,
      p_limit: 20,
    })
    if (error) { console.error('[알림]', error); return }

    type Row = { id: string; at: string; who: string; account_name: string; role: string }
    setItems(((data ?? []) as Row[]).map(r => ({
      id:          r.id,
      at:          r.at,
      who:         r.who,
      accountName: r.account_name,
      role:        r.role,
    })))
  }

  useEffect(() => {
    load()
    if (!storeId) return
    // 등록은 드문 일이라 폴링 간격을 짧게 둘 이유가 없다. 2분이면 "바로 왔다"로 느껴진다.
    const t = setInterval(load, 120_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId])

  // 바깥을 누르면 닫기
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const unread = items.filter(n => !readAt || n.at > readAt).length

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) {
      // 여는 순간 읽음 — 목록을 띄웠다는 건 봤다는 뜻이다
      const now = new Date().toISOString()
      setReadAt(now)
      try { localStorage.setItem(READ_KEY, now) } catch { /* 저장 못 해도 동작엔 지장 없다 */ }
      load()
    }
  }

  return (
    // z-[60] — 햄버거 드로어 앵커와 같은 층. 헤더(z-10) 밖으로 나왔기 때문에
    // 여기서 직접 층을 잡아주지 않으면 드롭다운이 본문 아래로 깔린다.
    // top 10 = (헤더 58 − 버튼 38) ÷ 2. 날짜·시간 블록(right 140 기준 중앙정렬) 왼쪽에
    // 18px 정도 띄워 붙는 자리.
    <div ref={wrapRef} className="absolute z-[60]" style={{ right: 194, top: 10 }}>
      <button
        onClick={toggle}
        title={unread > 0 ? `새 알림 ${unread}건` : '알림'}
        className="pressable-tab relative w-[38px] h-[38px] rounded-[11px] flex items-center justify-center hover:bg-[#F2F2F2]"
      >
        {/* 둥근 종 — 꼭지와 아랫단을 둥글게 이어 각을 없앴다.
            헤더에서 유일한 아이콘이라 뾰족하면 경고처럼 보인다(경고는 주문 카드의 빨간 삼각형 몫). */}
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" className="text-[#6A635E]">
          <path
            d="M12 3.2a5.8 5.8 0 0 0-5.8 5.8v2.7c0 .66-.22 1.3-.63 1.82l-.86 1.1c-.93 1.19-.08 2.93 1.43 2.93h11.72c1.51 0 2.36-1.74 1.43-2.93l-.86-1.1a2.95 2.95 0 0 1-.63-1.82V9A5.8 5.8 0 0 0 12 3.2Z"
            stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round"
          />
          <path d="M9.7 19.6a2.6 2.6 0 0 0 4.6 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute top-[5px] right-[5px] w-[8px] h-[8px] rounded-full bg-[#C92A2A]" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-[6px] w-[300px] bg-[#FCFCFC] rounded-[11px] shadow-[0_2px_10px_rgba(44,38,31,0.08)] border border-[#E5E5E5] z-50 overflow-hidden">
          {/* '알림' 머리말은 뺐다 — 알림 종을 눌러서 연 창이라 무엇을 보는 중인지는
              이미 분명하다. 한 줄이 통째로 자리만 먹었다. */}
          {items.length === 0 ? (
            <div className="px-[14px] py-[26px] text-center text-[12px] text-[#ADADAD]">
              아직 알림이 없어요
            </div>
          ) : (
            <div className="max-h-[280px] overflow-y-auto">
              {items.map(n => (
                <div key={n.id} className="px-[14px] py-[11px] border-b border-[#F2F2F2] last:border-b-0">
                  <div className="text-[13px] text-[#1E1E1E] leading-snug">
                    <span className="font-medium">{n.who}</span>
                    <span className="text-[#787878]">님이 </span>
                    <span className="font-medium">{n.accountName}</span>
                    <span className="text-[#787878]"> {n.role} 등록을 마쳤어요</span>
                  </div>
                  <div className="text-[11px] text-[#ADADAD] mt-[3px] tabular-nums">{agoLabel(n.at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
