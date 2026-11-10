/**
 * 영수증 **미리보기와 실제 인쇄를 한 줄씩 맞춰 보는** 검사.
 *
 *   pnpm receipt:diff
 *
 * 왜 테스트가 아니라 스크립트인가: 인쇄는 electron/ (tsconfig.node, Buffer·iconv),
 * 미리보기는 src/ (tsconfig.web, React) 라 **한 tsconfig 안에 둘 수가 없다.**
 * vitest 는 둘 다 실행할 수 있으니 스크립트로 둔다.
 *
 * 이 둘은 같은 패딩 함수를 복제해 쓴다(src/lib/receipt-layout.ts ↔ electron/escpos.ts).
 * 복제는 언젠가 갈라지고, 갈라지면 "미리보기와 종이가 다르다" 가 된다.
 * 영수증 쪽을 고쳤으면 이걸 돌려서 ✅ 인지 보고 커밋한다.
 */
import iconv from 'iconv-lite'
import { buildKitchenReceiptEscPos, buildCustomerReceiptEscPos } from '../electron/escpos'
import { sampleOrderPayload, sampleReceiptDisplay } from '../src/lib/receipt-sample'
import { buildLines, DEFAULT_RECEIPT_CONFIG } from '../src/components/ui/ReceiptPreview'
import type { ReceiptPreviewConfig, ReceiptKind } from '../src/components/ui/ReceiptPreview'

/** ESC/POS 제어 바이트를 걷어내고 글자만 남긴다 — 격자를 비교하는 게 목적이다 */
function paperLines(buf: Buffer): string[] {
  return iconv.decode(buf, 'cp949')
    .replace(/\x1d!./g, '').replace(/\x1b@/g, '')
    .replace(/\x1bE[\x00\x01]/g, '').replace(/\x1ba[\x00-\x02]/g, '')
    .replace(/\x1bd[\s\S]|\x1dV[\s\S]*/g, '')
    .split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l !== '')
}

function previewLines(kind: ReceiptKind, cfg: ReceiptPreviewConfig, method: '포장'|'내점'|'배달'): string[] {
  return buildLines(kind, cfg, sampleReceiptDisplay(undefined, new Date(), method))
    .map(l => l.segs.map(s => s.t).join('').replace(/\s+$/, ''))
    .filter(l => l !== '')
}

// 설정 조합마다 본다 — 크기 배수가 섞일 때 어긋나는 일이 많았다.
//
// ⚠️ showItemPrice('메뉴 이름 우측 가격 표시')는 **미리보기 전용**이라 여기서 안 다룬다.
//    ReceiptSettings 에 컬럼이 없어서 인쇄 쪽은 늘 가격을 찍는다. 인쇄에도 넣기로
//    하면 이 목록에 { showItemPrice: false } 경우를 넣을 것.
const CASES: { name: string; cfg: ReceiptPreviewConfig }[] = [
  { name: '기본',        cfg: DEFAULT_RECEIPT_CONFIG },
  { name: '머리말 크게', cfg: { ...DEFAULT_RECEIPT_CONFIG, headerSize: 'large' } },
  { name: '메뉴 크게',   cfg: { ...DEFAULT_RECEIPT_CONFIG, menuSize: 'large' } },
  { name: '옵션 크게',   cfg: { ...DEFAULT_RECEIPT_CONFIG, optionSize: 'large' } },
  { name: '금액 크게',   cfg: { ...DEFAULT_RECEIPT_CONFIG, amountSize: 'large' } },
  { name: '전부 크게',   cfg: { ...DEFAULT_RECEIPT_CONFIG, headerSize: 'large', menuSize: 'large', optionSize: 'large', amountSize: 'large' } },
  { name: '잔액 끔',     cfg: { ...DEFAULT_RECEIPT_CONFIG, showBalance: false } },
  { name: '하단문구 없음', cfg: { ...DEFAULT_RECEIPT_CONFIG, footerText: '' } },
]

let bad = 0
for (const { name, cfg } of CASES) {
  // 인쇄 쪽은 ReceiptSettings 모양이다. 주방/고객이 같은 설정을 쓰도록 SettingsHub 가
  // 보내는 방식(customerMenuSize = menuSize)을 그대로 흉내 낸다.
  const settings = {
    headerSize: cfg.headerSize,
    menuSize: cfg.menuSize, optionSize: cfg.optionSize,
    customerMenuSize: cfg.menuSize, customerOptionSize: cfg.optionSize,
    amountSize: cfg.amountSize, footerText: cfg.footerText, showBalance: cfg.showBalance,
  }
  for (const kind of ['kitchen', 'customer'] as const) {
   for (const method of ['포장', '내점', '배달'] as const) {
    const order = sampleOrderPayload(undefined, new Date(), method) as never
    const paper = paperLines(kind === 'kitchen'
      ? buildKitchenReceiptEscPos(order, settings, 42)
      : buildCustomerReceiptEscPos(order, settings, 42))
    const prev = previewLines(kind, cfg, method)

    const n = Math.max(paper.length, prev.length)
    const diffs: string[] = []
    for (let i = 0; i < n; i++) {
      if ((paper[i] ?? '(없음)') !== (prev[i] ?? '(없음)')) {
        diffs.push(`    ${i}\n      종이  |${paper[i] ?? '(없음)'}|\n      미리  |${prev[i] ?? '(없음)'}|`)
      }
    }
    const tag = `${name} / ${kind === 'kitchen' ? '주방' : '고객'} / ${method}`
    if (diffs.length) {
      bad++
      console.log(`  ⚠️ ${tag} — ${diffs.length}줄 다름`)
      console.log(diffs.slice(0, 6).join('\n'))
    } else {
      console.log(`  ✅ ${tag} — ${paper.length}줄 일치`)
    }
   }
  }
}

if (bad) {
  console.error(`\n미리보기와 종이가 ${bad}가지 경우에서 다르다. 양쪽 패딩 함수가 갈라졌는지 보라.`)
  process.exit(1)
}
console.log('\n모든 경우에서 미리보기 = 종이')
