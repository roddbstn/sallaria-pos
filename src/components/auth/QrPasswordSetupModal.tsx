import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface QrPasswordSetupModalProps {
  open: boolean
  onClose: () => void
}

/**
 * 로그인 화면의 "비밀번호 설정하기" 클릭 시 뜨는 QR 모달.
 * 휴대폰으로 QR을 찍으면 sunpos-auth(모바일 웹)로 넘어가 OTP+비밀번호 설정을 진행한다.
 * TODO: API 연동 — pairing_sessions 행 생성 후 그 token으로 QR URL 구성,
 *       Realtime 구독으로 status='completed' 감지 시 onClose() + 자동로그인 처리.
 */
export default function QrPasswordSetupModal({ open, onClose }: QrPasswordSetupModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState('')

  useEffect(() => {
    if (!open) return
    // TODO: 실제 pairing token 발급 URL로 교체 (예: https://auth.<도메인>/verify/<token>)
    const placeholderUrl = 'https://example.com/verify/PLACEHOLDER_TOKEN'
    QRCode.toDataURL(placeholderUrl, { width: 240, margin: 0, color: { dark: '#1E1E1E', light: '#FFFFFF' } })
      .then(setQrDataUrl)
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50">
      <div className="modal-in bg-white rounded-2xl shadow-xl w-[360px] px-8 py-9 flex flex-col items-center relative">
        <h2 className="text-[17px] font-bold text-ink mb-1.5 text-center">휴대폰으로 QR을 찍어주세요</h2>
        <p className="text-[13px] text-center mb-6" style={{ color: 'var(--gray-text)' }}>
          본인 명의 휴대폰에서 본인확인 후<br />새 비밀번호를 설정할 수 있어요
        </p>

        <div
          className="w-[240px] h-[240px] rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--gray-bg)' }}
        >
          {qrDataUrl
            ? <img src={qrDataUrl} alt="QR 코드" className="w-full h-full" />
            : <div className="w-8 h-8 rounded-full border-4 border-gray-200 animate-spin" style={{ borderTopColor: '#6A635E' }} />}
        </div>

        <button
          onClick={onClose}
          className="absolute bottom-5 right-5 text-[13px] font-semibold"
          style={{ color: 'var(--gray-text)' }}
        >
          닫기
        </button>
      </div>
    </div>
  )
}
