import { qrDataUrl, paperGeometry, PAPER_OPTIONS, CELL_GAP, type QrPaper } from '../../lib/qr-order'

// 여러 거래처 QR을 한 번에 종이로 뽑는다.
//
// Electron 은 window.open 팝업을 막으므로, 숨긴 iframe 에 문서를 써 넣고 그 안에서 print() 한다
// (고객 화면의 단일 QR 인쇄가 쓰던 방식 그대로). 차이는 "여러 장"과 "용지 분할"뿐이다.
//
// 치수는 전부 mm 로 쓴다. px 로 쓰면 브라우저 DPI 에 따라 실제 인쇄 크기가 달라져서,
// 화면에 "3.2cm"라고 적어 놓고 다른 크기가 찍히는 일이 생긴다.

export interface QrSheetItem {
  accountName: string
  manager?: string
  pin?: string
  url: string
}

export async function printQrSheet(
  items: QrSheetItem[],
  opts: { paper: QrPaper; storeName: string; notice: string; showPin: boolean },
): Promise<void> {
  if (items.length === 0) return
  const spec = PAPER_OPTIONS.find(p => p.key === opts.paper)!
  const geo  = paperGeometry(opts.paper)

  // QR 이미지를 먼저 전부 만들어 둔다 — iframe 에 쓴 뒤 비동기로 채우면
  // print() 가 이미지보다 먼저 떠서 빈 칸이 찍힌다
  const withQr = await Promise.all(
    items.map(async it => ({ ...it, img: await qrDataUrl(it.url, 800) })),
  )

  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const cells = withQr.map(it => `
    <div class="cell">
      <div class="store">${esc(opts.storeName)} 선결제</div>
      <div class="name">${esc(it.accountName)}</div>
      <img class="qr" src="${it.img}" alt="QR" />
      <div class="notice">${esc(opts.notice)}</div>
      ${opts.showPin && it.pin ? `<div class="pin">PIN ${esc(it.pin)}</div>` : ''}
    </div>`).join('')

  const isReceipt = opts.paper === 'receipt'
  const pageSize  = isReceipt ? '58mm auto' : 'A4'
  // 칸 높이를 고정해야 "4등분"이 실제로 4등분이 된다. 내용에 따라 늘어나면 칸이 밀린다
  const cellH = isReceipt ? 'auto' : `${geo.cellH}mm`

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>QR 안내증</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size: ${pageSize}; margin: ${isReceipt ? '4mm' : '10mm'}; }
  body {
    font-family: 'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;
    color: #1E1E1E;
    display: grid;
    grid-template-columns: repeat(${spec.cols}, 1fr);
    gap: ${CELL_GAP}mm;
  }
  .cell {
    height: ${cellH};
    break-inside: avoid;
    border: 0.3mm dashed #ADADAD;
    border-radius: 3mm;
    padding: 6mm 4mm;
    text-align: center;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3mm;
  }
  .store  { font-size: 3mm; color: #787878; }
  .name   { font-size: 5mm; font-weight: 600; }
  .qr     { width: ${geo.qrMM}mm; height: ${geo.qrMM}mm; }
  .notice { font-size: 3.5mm; color: #414141; }
  /* PIN 은 기본으로 안 찍는다. 종이가 사무실 벽에 붙으므로 — 켤 때만 보인다 */
  .pin    { font-size: 3.5mm; font-weight: 600; letter-spacing: 1mm; color: #6A635E; }
</style></head><body>${cells}</body></html>`

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;border:0;visibility:hidden;'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document
  if (!doc) { document.body.removeChild(iframe); return }

  doc.open(); doc.write(html); doc.close()

  // 폰트·이미지가 자리를 잡은 뒤에 인쇄 — 바로 부르면 레이아웃이 덜 된 채로 찍힌다
  await new Promise(r => setTimeout(r, 250))
  iframe.contentWindow?.focus()
  iframe.contentWindow?.print()
  setTimeout(() => { if (iframe.parentNode) document.body.removeChild(iframe) }, 1000)
}
