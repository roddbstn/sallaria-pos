import React, { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { StoreSession } from '../lib/store-context'

interface Props {
  open: boolean
  onClose: () => void
  session: StoreSession
  setSession: React.Dispatch<React.SetStateAction<StoreSession | null>>
  authObj: Session | null
  onDeleteRequest: () => void
  /** 로그인 화면과 동일한 QR(전화번호+OTP 인증 후 비밀번호 설정) 모달을 여는 콜백 */
  onOpenPasswordSetup: () => void
  /** 로그아웃. **반드시 App 의 handleSignOut 을 받는다** — 여기서 supabase.auth.signOut()
   *  을 직접 부르면 intentionalSignOutRef 가 안 서고, App 의 세션 유실 판정이
   *  "네트워크가 끊겼다"로 오해해서 로그인 화면 대신 '연결 확인 중' 배지를 띄운다
   *  (lib/auth-retry.ts 의 decideOnLostSession). 실제로 그랬다. */
  onSignOut: () => void
}

export default function ProfileModal({ open, onClose, session, setSession, authObj, onDeleteRequest, onOpenPasswordSetup, onSignOut }: Props) {
  const [storeRepName,  setStoreRepName]  = useState<string | null>(null)
  const [storeAddress,  setStoreAddress]  = useState<string | null>(null)
  const [customerCount, setCustomerCount] = useState<number | null>(null)
  const [menuCount,     setMenuCount]     = useState<number | null>(null)
  const [profileMsg,    setProfileMsg]    = useState<{ text: string; ok: boolean } | null>(null)
  const [profileSaving, setProfileSaving] = useState(false)

  // 가게 이름 편집 모달
  const [editNameOpen, setEditNameOpen] = useState(false)
  const [nameInput,    setNameInput]    = useState('')

  // 모달이 열릴 때 데이터 초기화 + 로드
  useEffect(() => {
    if (!open) return
    setProfileMsg(null)
    setStoreRepName(null)
    setStoreAddress(null)
    setCustomerCount(null)
    setMenuCount(null)

    async function load() {
      // 대표자명은 clients.owner_name 이 원본 — 매장이 여러 개여도 대표자는 한 명이다.
      // (stores.representative_name 은 매장별로 갈라져 어긋나던 옛 컬럼)
      const [{ data: storeData }, { data: clientData }] = await Promise.all([
        supabase.from('stores').select('address').eq('id', session.storeId).maybeSingle(),
        supabase.from('clients').select('owner_name').eq('id', session.clientId).maybeSingle(),
      ])
      setStoreRepName(clientData?.owner_name ?? null)
      setStoreAddress(storeData?.address ?? null)

      // 메뉴 수를 store_id 로 바로 세면서 카테고리 선조회(왕복 1회)가 통째로 없어졌다
      const [{ count: cc }, { count: mc }] = await Promise.all([
        supabase.from('accounts').select('*', { count: 'exact', head: true })
          .eq('is_active', true).eq('store_id', session.storeId),
        // 미분류 메뉴도 이 매장 메뉴다 — store_id 로 세야 빠지지 않는다
        supabase.from('menus').select('*', { count: 'exact', head: true })
          .eq('is_hidden', false).eq('store_id', session.storeId),
      ])
      setCustomerCount(cc ?? 0)
      setMenuCount(mc ?? 0)
    }
    load()
  }, [open, session.storeId])

  async function handleSaveStoreName() {
    if (!nameInput.trim()) return
    setProfileSaving(true)
    const { error } = await supabase
      .from('stores')
      .update({ name: nameInput.trim() })
      .eq('id', session.storeId)
    if (error) {
      setProfileMsg({ text: '저장 실패: ' + error.message, ok: false })
    } else {
      setSession(s => s ? { ...s, storeName: nameInput.trim() } : s)
      setEditNameOpen(false)
      setProfileMsg({ text: '가게 이름이 변경됐습니다.', ok: true })
    }
    setProfileSaving(false)
  }

  if (!open) return null

  return (
    <>
      {/* ── 프로필 모달 ── */}
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50" onClick={onClose}>
        <div className="modal-in bg-white rounded-2xl shadow-xl w-[460px] overflow-hidden" onClick={e => e.stopPropagation()}>

          {/* 헤더 */}
          <div className="px-8 pt-7 pb-5 border-b border-gray-border">
            <div className="flex items-center gap-1.5">
              <div className="text-[19px] font-semibold text-ink leading-tight">{session.storeName || 'POS'}</div>
              <button
                onClick={() => { setNameInput(session.storeName ?? ''); setEditNameOpen(true) }}
                className="text-gray-300 hover:text-ink transition-colors"
                title="가게 이름 수정"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            </div>
            {storeRepName && (
              <div className="text-[12px] text-gray-text mt-1">{storeRepName}</div>
            )}
            <div className="text-[12px] text-gray-text mt-0.5">{authObj?.user.email ?? ''}</div>
            {storeAddress && (
              <div className="text-[12px] text-gray-text mt-0.5 truncate">{storeAddress}</div>
            )}
          </div>

          {/* 가게 현황 */}
          <div className="px-8 py-5 border-b border-gray-border flex gap-3">
            {[
              { label: '등록 고객', value: customerCount !== null ? `${customerCount}명` : '—' },
              { label: '등록 메뉴', value: menuCount     !== null ? `${menuCount}개`     : '—' },
            ].map(({ label, value }) => (
              <div key={label} className="flex-1 bg-gray-bg rounded-xl py-3 text-center">
                <div className="text-[11px] text-gray-text font-semibold">{label}</div>
                <div className="text-[18px] font-extrabold text-ink mt-0.5">{value}</div>
              </div>
            ))}
          </div>

          {/* 비밀번호 — 전화번호+OTP 인증 후 설정하는 QR 흐름(로그인 화면과 동일)을 그대로 재사용.
              비밀번호를 아직 설정 안 한 사용자도 이 버튼 하나로 처리 가능 */}
          <div className="px-8 py-5">
            <div className="text-[13px] font-semibold text-gray-text mb-1.5">비밀번호</div>
            <button
              onClick={onOpenPasswordSetup}
              className="w-full py-2 bg-gray-100 text-ink text-[13px] font-normal rounded-lg hover:bg-gray-200 transition-colors"
            >비밀번호 설정하기</button>
          </div>

          {/* 피드백 메시지 */}
          {profileMsg && (
            <div className={`mx-6 mt-3 px-3 py-2 rounded-lg text-[12px] font-semibold ${profileMsg.ok ? 'bg-green-soft text-green' : 'bg-red-50 text-danger'}`}>
              {profileMsg.text}
            </div>
          )}

          {/* 로그아웃 → 그 아래 회원탈퇴.
              전엔 둘이 justify-between 으로 좌우 끝에 떨어져 있었고 회원탈퇴는
              text-gray-300(흰 바탕에서 거의 안 보임)이었다. 그래서 "회원탈퇴를
              안 넣었네" 라는 말이 나왔다 — 기능은 처음부터 다 있었다.
              되돌릴 수 없는 동작이라 눈에 덜 띄게 두는 건 맞지만, 안 보이는 건
              다른 문제다. 로그아웃 아래에 세로로 놓고 읽히는 회색으로 올린다. */}
          <div className="px-6 pb-5 pt-1 flex flex-col items-center gap-[10px]">
            <button
              onClick={onSignOut}
              className="pressable-soft w-full py-2 bg-gray-100 text-ink text-[13px] font-semibold rounded-lg hover:bg-gray-200 transition-colors"
            >
              로그아웃
            </button>
            <button
              onClick={onDeleteRequest}
              className="text-[12px] font-normal text-[#ADADAD] underline underline-offset-[3px] decoration-[#D7D7D7] hover:text-danger hover:decoration-danger transition-colors"
            >
              회원탈퇴
            </button>
          </div>
        </div>
      </div>

      {/* ── 가게 이름 편집 모달 (화면 정가운데) ── */}
      {editNameOpen && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50"
          onClick={() => setEditNameOpen(false)}
        >
          <div
            className="modal-in bg-white rounded-2xl shadow-xl w-[340px] px-8 py-7 flex flex-col gap-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-[16px] font-semibold text-ink">가게 이름 수정</div>
            <input
              autoFocus
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveStoreName()
                if (e.key === 'Escape') setEditNameOpen(false)
              }}
              className="w-full border border-gray-border rounded-lg px-3 py-2.5 text-[14px] text-ink outline-none focus:border-[#00DD67]"
              placeholder="가게 이름"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setEditNameOpen(false)}
                className="flex-1 py-2.5 rounded-lg bg-gray-100 text-ink text-[13px] font-semibold hover:bg-gray-200 transition-colors"
              >취소</button>
              <button
                onClick={handleSaveStoreName}
                disabled={profileSaving || !nameInput.trim()}
                className="flex-1 py-2.5 rounded-lg bg-[#00DD67] text-[#1A1A1A] text-[13px] font-bold hover:opacity-85 disabled:opacity-50 transition-opacity"
              >{profileSaving ? '저장 중...' : '저장'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
