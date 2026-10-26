"""Joan Regular 의 'sunpos' 를 아웃라인 패스로 구워 SVG 조각을 만든다.

폰트를 번들하지 않는 이유: Joan 은 hhea(1000/-292)와 usWin(1117/615) 메트릭이
다르고, Chromium 이 플랫폼마다 다른 쪽을 써서 줄상자 높이가 달라진다.
= 맥에서 맞춘 글자 세로위치가 Windows POS 에서 어긋난다. 로고에선 치명적이다.
패스로 구우면 메트릭도 폰트 로딩도 관여하지 않는다.
"""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform

TTF   = '/Users/yunsoo/.claude/jobs/96fd1b6a/tmp/Joan-Regular.ttf'
TEXT  = 'sunpos'
TRACK = -15          # Figma tracking -9px @ 600px = -0.015em = -15/1000upm

f    = TTFont(TTF)
upm  = f['head'].unitsPerEm
gs   = f.getGlyphSet()
cmap = f.getBestCmap()

# ── 글리프를 가로로 배치하면서 하나의 패스로 합친다 (y 는 아직 y-up, 베이스라인 0) ──
pen   = SVGPathPen(gs, ntos=lambda v: f'{v:.1f}'.rstrip('0').rstrip('.'))
bnds  = BoundsPen(gs)
x = 0
for i, ch in enumerate(TEXT):
    gn = cmap[ord(ch)]
    for p in (pen, bnds):
        gs[gn].draw(TransformPen(p, Transform(1, 0, 0, 1, x, 0)))
    x += gs[gn].width
    if i < len(TEXT) - 1:
        x += TRACK

xmin, ymin, xmax, ymax = bnds.bounds
d = pen.getCommands()

# ── SVG 좌표(y-down)로 뒤집는다. 베이스라인을 y=ASC_INK 에 둔다 ──
# 잉크 윗변(+0.470em)이 0, 아랫변(-0.276em)이 height 가 되도록.
ASC_INK  = ymax          # +470
DESC_INK = -ymin         # +276
H = ASC_INK + DESC_INK   # 746
W = xmax - xmin

print(f'upm={upm}  잉크 x {xmin}..{xmax} (w={W})  y {ymin}..{ymax} (h={H})')
print(f'  em 기준: 너비 {W/upm:.4f}em, 높이 {H/upm:.4f}em')

# 타일 한 변 T 대비 환산 (Figma: fontSize = 600/647 = 0.9274 T)
F = 600 / 647
print(f'  타일 T 기준: 너비 {W/upm*F:.4f}T, 높이 {H/upm*F:.4f}T')
print(f'  종횡비 W/H = {W/H:.5f}')

svg_path = f'<path d="{d}" fill="currentColor" />'
inner = (f'<svg viewBox="{xmin} 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" '
         f'transform="translate(0,{ASC_INK}) scale(1,-1)">')
# 위 transform 대신 패스 자체를 뒤집어 둔다 (중첩 transform 없이 깔끔하게)
flipped = f'<g transform="translate(0 {ASC_INK}) scale(1 -1)">{svg_path}</g>'

out = f'<svg viewBox="{xmin} 0 {W} {H}">{flipped}</svg>'
open('/Users/yunsoo/.claude/jobs/96fd1b6a/tmp/wordmark.svg','w').write(out)
print(f'\n패스 길이 {len(d)} chars, SVG 총 {len(out)} bytes')

# 컴포넌트에 넣을 상수들
print('\n--- Wordmark.tsx 상수 ---')
print(f'const TEXT_VB   = "{xmin} 0 {W} {H}"')
print(f'const TEXT_FLIP = "translate(0 {ASC_INK}) scale(1 -1)"')
print(f'const TEXT_H    = {H/upm*F:.4f}   // 타일 한 변 대비 글자 잉크 높이')
print(f'const TEXT_W    = {W/upm*F:.4f}')
print(f'const TEXT_TOP  = 0.3720          // 타일 윗변에서 글자 잉크 윗변까지')
print(f'const GAP       = {183/647:.4f}')

# ── TS 모듈로 내보낸다 ──────────────────────────────────────────────────────
ts = f'''// 자동 생성 — scripts/gen-wordmark.py (Joan Regular, OFL)
// "sunpos" 워드마크를 아웃라인 패스로 구운 것. 폰트 파일은 번들하지 않는다.
//
// 왜 폰트가 아니라 패스인가:
// Joan 은 hhea(1000/-292)와 usWin(1117/615) 메트릭이 서로 다르고, Chromium 이
// 플랫폼에 따라 다른 쪽으로 줄상자를 잡는다. 그대로 두면 맥에서 맞춘 글자
// 세로위치가 Windows POS 에서 5~6px 어긋난다. 로고에서는 그냥 틀린 것이다.
// 패스로 구우면 폰트 로딩도 메트릭도 관여하지 않고 어디서나 같은 그림이 나온다.
//
// 좌표는 Joan 의 폰트 단위(upm 1000) 그대로다. y-up 이라 FLIP 으로 뒤집어 쓴다.
// 자간은 Figma 의 tracking -9px @ 600px = -0.015em = -15/1000 을 글자 사이에 넣었다.

/** 잉크 박스 viewBox — 좌우 사이드베어링을 뺀 실제 글자 범위 */
export const SUNPOS_VIEWBOX = '{xmin} 0 {W} {H}'

/** 베이스라인을 잉크 윗변 기준으로 옮기고 y 를 뒤집는다 */
export const SUNPOS_FLIP = 'translate(0 {ASC_INK}) scale(1 -1)'

/** 잉크 박스의 가로/세로 비 — 바깥에서 너비를 구할 때 쓴다 */
export const SUNPOS_ASPECT = {W / H:.5f}

export const SUNPOS_PATH =
  '{d}'
'''
open('/Users/yunsoo/Documents/sallaria/sallaria-pos/src/assets/sunpos-wordmark.ts','w').write(ts)
print('\n-> src/assets/sunpos-wordmark.ts 생성')
