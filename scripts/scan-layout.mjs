/**
 * 좁은 창에서 **칸이 0 이 될 만한 자리**를 찾아 준다.
 *
 *   pnpm scan:layout
 *
 * ── 왜 있나 ───────────────────────────────────────────────────────────────
 * 2026-11-07~08 사이에 같은 버그가 다섯 번 났다. 주문 내역 표 · 메뉴 카드 ·
 * 고객 표 · 매출 리포트 표 · 고객 허브 표. 전부 모양이 같았다:
 *
 *   1440 기준으로 고정폭을 박아 뒀는데 1024 에서 그 합이 쓸 수 있는 폭을 넘는다
 *   → flex-1 칸이 0 이 되고(또는 table 이 min-content 로 쥐어짜고)
 *   → 줄바꿈이 허용돼 있으면 한글이 **한 글자씩 세로로** 쌓인다
 *
 * 눈으로는 창을 줄여 봐야 보이고, 화면마다 줄여 보기 전엔 모른다. 그래서 정적으로
 * 후보만 뽑는다. **확정이 아니라 후보**다 — 사람이 보고 판단한다.
 *
 * 쓸 수 있는 폭(1024 기준):
 *   허브 화면(햄버거)  669  = 1024 − 나비 227 − 좌우 여백 128
 *   사이드패널 화면     542~556 = 1024 − 패널 400 − 표 여백
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 이 폭을 넘는 고정폭 합이면 들여다볼 만하다 */
const FLAG = 380
const WIDTH = /w-\[(\d+)px\]|width:\s*(\d+)|minWidth:\s*(\d+)/g

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : []
  })
}

const hits = []
for (const file of walk('src')) {
  const lines = readFileSync(file, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (!ln.includes('flex') || ln.includes('flex-col')) continue
    const base = ln.length - ln.trimStart().length

    let total = 0, cells = 0, flexible = false, scrolls = false
    // 이 줄 위쪽에 TableScroll 래퍼가 있으면 가로로 스크롤하니 괜찮다
    for (let k = Math.max(0, i - 12); k < i; k++) if (lines[k].includes('<TableScroll')) scrolls = true

    for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
      const cur = lines[j]
      const ind = cur.length - cur.trimStart().length
      if (cur.trim() && ind <= base) break
      if (ind > base + 4) continue
      if (/\bflex-1\b/.test(cur)) flexible = true
      for (const m of cur.matchAll(WIDTH)) {
        const v = Number(m[1] ?? m[2] ?? m[3])
        if (v >= 20 && v <= 400) { total += v; cells++ }
      }
    }
    if (flexible && total >= FLAG && !scrolls) hits.push({ total, cells, file, line: i + 1 })
  }
}

const tables = []
for (const file of walk('src')) {
  readFileSync(file, 'utf8').split('\n').forEach((ln, i) => {
    if (ln.includes('<table') && ln.includes('w-full') && !ln.includes('min-w-max')) {
      tables.push({ file, line: i + 1, text: ln.trim().slice(0, 70) })
    }
  })
}

hits.sort((a, b) => b.total - a.total)
console.log('=== flex 한 줄 + 고정폭 형제 합계 (TableScroll 로 감싼 건 뺌) ===')
if (!hits.length) console.log('  없음')
for (const h of hits) console.log(`  ${String(h.total).padStart(5)}px  (${h.cells}칸)  ${h.file}:${h.line}`)

console.log('\n=== <table className="w-full"> — min-w-max 없이는 칼럼을 쥐어짠다 ===')
if (!tables.length) console.log('  없음')
for (const t of tables) console.log(`  ${t.file}:${t.line}  ${t.text}`)

console.log('\n확정이 아니라 후보다. 고정폭 합 + 여백 + 유동 칸 최소폭이')
console.log('쓸 수 있는 폭(허브 669 / 사이드패널 542)을 넘는지 직접 따져 볼 것.')
