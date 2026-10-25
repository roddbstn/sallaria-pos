import { useCallback } from 'react'
import logoWithText from '../assets/logo-with-text-transparent.png'

// 거래처 QR 인쇄 — A4 전지(종이 QR)와 영수증(58mm) 두 갈래.
//
// Customers.tsx 안에 있던 handlePrintQr / handlePrintQrReceipt 를 그대로 옮긴 것이다.
// 옮긴 이유: 고객 > QR오더 화면이 같은 두 동작을 쓸 예정이라, 화면 두 곳에
// 같은 200줄을 복붙하는 걸 막으려고. (원래 주석에 "그 화면을 붙일 때 훅으로 빼서
// 공용으로 쓸 것"이라 적혀 있었다 — 그걸 지금 한다.)
//
// QR 종이는 각 사무실 벽에 붙는다. 그래서 거래처명이 56px 로 크고, 매장명이
// 아래에 따라붙는다 — 같은 건물에 여러 과의 QR 이 섞여 붙어 있어도 자기 것을
// 바로 찾아야 한다.
//
// ⚠️ QR URL 에는 account_code 가 그대로 들어 있다. 이 종이를 본 사람은 누구나
//    그 UUID 를 아는 셈이므로, 서버에서 account_code 를 신분 증명으로 써서는 안 된다.

/** 인쇄에 필요한 거래처 정보 — DbAccount 의 부분집합 */
export interface QrPrintAccount {
  account_name:   string
  contact_person: string | null
  contact_phone:  string | null
  pin_code:       string
}

export interface UseQrPrintArgs {
  account:    QrPrintAccount | null
  /** QRCode.toDataURL 결과 — A4 인쇄용 */
  qrDataUrl:  string
  /** QR 이 가리키는 실제 주소 — 영수증 출력은 메인 프로세스에서 다시 그린다 */
  qrUrl:      string
  storeName:  string
  /**
   * 영수증 하단에 같이 찍히는 매장 전화 — stores.phone.
   * 안 넘기면 **그 줄이 통째로 빠진다**(escpos.ts 의 buildQrReceiptEscPos 는
   * 값이 있을 때만 찍는다). QR 출력 화면과 같은 영수증이 나오려면 넘겨야 한다.
   */
  storePhone?: string
  /** QR 아래 한 줄 안내. 없으면 그 줄이 빠진다 — 기본값은 DEFAULT_QR_NOTICE */
  notice?:     string
  /** 영수증 출력 실패를 화면에 알릴 방법 (토스트 등) */
  onError?:   (message: string) => void
}

export function useQrPrint({
  account, qrDataUrl, qrUrl, storeName, storePhone, notice, onError,
}: UseQrPrintArgs) {
  /** A4 한 장에 거래처명 + QR + 로고. 사무실 벽에 붙이는 용도 */
  const printQrSheet = useCallback(() => {
    if (!account || !qrDataUrl) return

    // Electron 에서는 window.open 팝업이 차단되므로 숨겨진 iframe 으로 인쇄한다
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;border:0;visibility:hidden;'
    document.body.appendChild(iframe)

    const doc = iframe.contentDocument ?? iframe.contentWindow?.document
    if (!doc) { document.body.removeChild(iframe); return }

    doc.open()
    doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${account.account_name} QR</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100vh; }
    body {
      font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
      background: #fff;
      display: flex;
      flex-direction: column;
      align-items: center;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .header {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
    }
    h1 {
      font-size: 56px;
      font-weight: 900;
      color: #1E1E1E;
      text-align: center;
      line-height: 1.2;
      letter-spacing: -1px;
    }
    .subtitle {
      font-size: 20px;
      font-weight: 500;
      color: #727272;
      text-align: center;
    }
    img.qr { width: 420px; height: 420px; }
    .footer {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      margin-right: 16px;
    }
    .logo-row {
      display: flex;
      align-items: flex-end;
      gap: 12px;
    }
    img.logo { width: 210px; object-fit: contain; }
    .collab {
      font-size: 22px;
      font-weight: 600;
      color: #1E1E1E;
      white-space: nowrap;
      margin-bottom: 35px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${account.account_name}</h1>
    <p class="subtitle">${storeName} 선결제 주문</p>
  </div>
  <img class="qr" src="${qrDataUrl}" alt="QR"/>
  <div class="footer">
    <div class="logo-row">
      <img class="logo" src="${logoWithText}" alt="logo"/>
      <span class="collab">×&nbsp;&nbsp;&nbsp;${storeName}</span>
    </div>
  </div>
</body>
</html>`)
    doc.close()

    // 이미지(QR·로고)가 로드되기를 기다린 뒤 인쇄한다. 바로 print() 하면 빈 칸이 나온다.
    setTimeout(() => {
      iframe.contentWindow?.print()
      setTimeout(() => { document.body.removeChild(iframe) }, 1000)
    }, 400)
  }, [account, qrDataUrl, storeName])

  /** 영수증 프린터(58mm)로 뽑는 작은 QR — 손님에게 바로 건네는 용도 */
  const printQrReceipt = useCallback(async () => {
    if (!account) return
    try {
      await window.api?.printQrReceipt({
        accountName: account.account_name,
        manager:     account.contact_person ?? '',
        phone:       account.contact_phone  ?? '',
        // PIN 은 **보내지 않는다.** 영수증은 사무실로 건너가고, 빌더도 이 값을 쓰지 않고
        // 'PIN  관리자에게 문의' 를 찍는다(escpos.ts). QR 출력 화면도 '' 를 보낸다.
        pin:         '',
        qrUrl,
        storeName,
        storePhone,
        notice,
      })
    } catch (err) {
      onError?.((err as Error).message ?? '영수증 출력에 실패했어요')
    }
  }, [account, qrUrl, storeName, storePhone, notice, onError])

  return { printQrSheet, printQrReceipt }
}
