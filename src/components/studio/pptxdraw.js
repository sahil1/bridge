// A PowerPoint slide drawn as PowerPoint draws it, from what pptxdoc.js reads of it: its
// background, its master's and layout's own shapes, then each of its shapes where it is, at its
// size, turned and flipped, in its fill and line; its words in their fonts, sizes, colours,
// bullets and spacing; pictures cropped; tables in their style; charts from their own values.
// Drawn as HTML and SVG at the slide's own size in px (96 to the inch), to be scaled to fit. No
// page needed to make the HTML, so the tests draw slides in Node too.
import { css, fontCss, esc } from './pptxdoc.js'

// What every drawn slide needs besides its own styles (bullets hang in their paragraph's indent).
export const SLIDE_CSS = `.px-slide{position:relative;overflow:hidden;box-sizing:border-box;line-height:normal;text-align:left;color:#000;-webkit-font-smoothing:antialiased;font-kerning:normal}
.px-slide *,.px-editing *{box-sizing:border-box}
.px-slide p,.px-editing p{margin:0;padding:0}
.px-bg{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.px-o{position:absolute}
.px-o>svg{position:absolute;inset:0;overflow:visible}
.px-tx{position:absolute;display:flex;flex-direction:column;overflow:visible}
.px-tx p{white-space:pre-wrap;overflow-wrap:break-word}
.px-tx.nowrap p{white-space:pre}
.px-tx p[data-bu]::before{content:attr(data-bu);display:inline-block;min-width:var(--bu-w,0);margin-left:var(--bu-m,0);color:var(--bu-c,inherit);font-size:var(--bu-s,inherit);font-family:var(--bu-f,inherit);text-indent:0;font-weight:normal;font-style:normal;text-decoration:none;white-space:pre}
.px-pic{position:absolute;overflow:hidden}
.px-pic img{position:absolute;max-width:none;user-select:none;-webkit-user-drag:none}
.px-missing{position:absolute;inset:0;display:grid;place-items:center;background:repeating-linear-gradient(45deg,#f1f1f1 0 10px,#e6e6e6 10px 20px);color:#777;font:500 13px system-ui,sans-serif;text-align:center;padding:6px;border:1px dashed #bbb}
.px-table{position:absolute;border-collapse:collapse;table-layout:fixed}
.px-table td{position:relative;padding:0;vertical-align:top;overflow:hidden}
.px-prompt{opacity:.5}`

let seq = 0
const n2 = (v) => +(+v).toFixed(2)
const PT = 96 / 72

// ---------- Shapes' outlines ----------
// A preset shape's outline in a box w by h, its adjustments (PowerPoint's, out of 100000) av:
// { d (SVG path), open (a line, not filled) }.
export function presetPath(prst, w, h, av = {}) {
  const a = (k, d) => (av[k] != null ? av[k] : d) / 100000
  const ss = Math.min(w, h)
  const poly = (pts) => `M${pts.map((p) => `${n2(p[0])},${n2(p[1])}`).join('L')}Z`
  const rr = (r) => `M${r},0H${w - r}A${r},${r} 0 0 1 ${w},${r}V${h - r}A${r},${r} 0 0 1 ${w - r},${h}H${r}A${r},${r} 0 0 1 0,${h - r}V${r}A${r},${r} 0 0 1 ${r},0Z`
  switch (prst) {
    case 'line': case 'straightConnector1': return { d: `M0,0L${w},${h}`, open: true }
    case 'bentConnector2': return { d: `M0,0L${w},0L${w},${h}`, open: true }
    case 'bentConnector3': { const x = w * a('adj1', 50000); return { d: `M0,0L${x},0L${x},${h}L${w},${h}`, open: true } }
    case 'bentConnector4': case 'bentConnector5': return { d: `M0,0L${w / 2},0L${w / 2},${h}L${w},${h}`, open: true }
    case 'curvedConnector2': case 'curvedConnector3': case 'curvedConnector4': case 'curvedConnector5': return { d: `M0,0C${w / 2},0 ${w / 2},${h} ${w},${h}`, open: true }
    case 'roundRect': case 'flowChartAlternateProcess': return { d: rr(n2(ss * Math.min(0.5, a('adj', 16667)))) }
    case 'flowChartTerminator': return { d: rr(n2(Math.min(w, h) / 2)) }
    case 'ellipse': case 'flowChartConnector': case 'cloud': case 'cloudCallout': case 'wedgeEllipseCallout': case 'flowChartOffpageConnector':
      return { d: `M0,${h / 2}A${w / 2},${h / 2} 0 1 1 ${w},${h / 2}A${w / 2},${h / 2} 0 1 1 0,${h / 2}Z` }
    case 'donut': { const t = ss * a('adj', 25000); return { d: `M0,${h / 2}A${w / 2},${h / 2} 0 1 1 ${w},${h / 2}A${w / 2},${h / 2} 0 1 1 0,${h / 2}ZM${t},${h / 2}A${w / 2 - t},${h / 2 - t} 0 1 0 ${w - t},${h / 2}A${w / 2 - t},${h / 2 - t} 0 1 0 ${t},${h / 2}Z`, evenodd: true } }
    case 'triangle': case 'flowChartExtract': return { d: poly([[w * a('adj', 50000), 0], [w, h], [0, h]]) }
    case 'flowChartMerge': return { d: poly([[0, 0], [w, 0], [w / 2, h]]) }
    case 'rtTriangle': return { d: poly([[0, 0], [w, h], [0, h]]) }
    case 'diamond': case 'flowChartDecision': return { d: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) }
    case 'parallelogram': case 'flowChartInputOutput': { const x = ss * a('adj', 25000); return { d: poly([[x, 0], [w, 0], [w - x, h], [0, h]]) } }
    case 'trapezoid': case 'flowChartManualOperation': { const x = ss * a('adj', 25000); return { d: poly([[0, h], [x, 0], [w - x, 0], [w, h]]) } }
    case 'pentagon': return { d: poly([[w / 2, 0], [w, h * 0.382], [w * 0.809, h], [w * 0.191, h], [0, h * 0.382]]) }
    case 'hexagon': case 'flowChartPreparation': { const x = ss * a('adj', 25000); return { d: poly([[x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h], [0, h / 2]]) } }
    case 'octagon': { const x = ss * a('adj', 29289); return { d: poly([[x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x], [0, x]]) } }
    case 'homePlate': { const x = w - ss * a('adj', 50000); return { d: poly([[0, 0], [x, 0], [w, h / 2], [x, h], [0, h]]) } }
    case 'chevron': { const x = ss * a('adj', 50000); return { d: poly([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h], [x, h / 2]]) } }
    case 'rightArrow': case 'leftArrow': case 'upArrow': case 'downArrow': {
      const vert = prst === 'upArrow' || prst === 'downArrow'
      const L = vert ? h : w, T = vert ? w : h
      const shaft = T * a('adj1', 50000), head = Math.min(L, Math.min(w, h) * a('adj2', 50000))
      const y1 = (T - shaft) / 2, y2 = T - y1, x = L - head
      let pts = [[0, y1], [x, y1], [x, 0], [L, T / 2], [x, T], [x, y2], [0, y2]]
      if (prst === 'leftArrow' || prst === 'upArrow') pts = pts.map(([p, q]) => [L - p, q])
      if (vert) pts = pts.map(([p, q]) => [q, p])
      return { d: poly(pts) }
    }
    case 'leftRightArrow': { const shaft = h * a('adj1', 50000), head = Math.min(w / 2, ss * a('adj2', 50000)); const y1 = (h - shaft) / 2, y2 = h - y1; return { d: poly([[0, h / 2], [head, 0], [head, y1], [w - head, y1], [w - head, 0], [w, h / 2], [w - head, h], [w - head, y2], [head, y2], [head, h]]) } }
    case 'upDownArrow': { const shaft = w * a('adj1', 50000), head = Math.min(h / 2, ss * a('adj2', 50000)); const x1 = (w - shaft) / 2, x2 = w - x1; return { d: poly([[w / 2, 0], [w, head], [x2, head], [x2, h - head], [w, h - head], [w / 2, h], [0, h - head], [x1, h - head], [x1, head], [0, head]]) } }
    case 'star4': case 'star5': case 'star6': case 'star8': case 'star10': case 'star12': case 'star16': case 'star24': {
      const n = Number(prst.slice(4)), inner = n === 5 ? 0.38 : n === 4 ? a('adj', 12500) * 2.6 : 0.6
      const pts = []
      for (let i = 0; i < n * 2; i++) { const r = i % 2 ? inner : 1, t = (Math.PI * i) / n - Math.PI / 2; pts.push([w / 2 + (w / 2) * r * Math.cos(t), h / 2 + (h / 2) * r * Math.sin(t)]) }
      return { d: poly(pts) }
    }
    case 'plus': case 'flowChartSummingJunction': { const x = ss * a('adj', 25000); return { d: poly([[x, 0], [w - x, 0], [w - x, x], [w, x], [w, h - x], [w - x, h - x], [w - x, h], [x, h], [x, h - x], [0, h - x], [0, x], [x, x]]) } }
    case 'frame': { const t = ss * a('adj1', 12500); return { d: `M0,0H${w}V${h}H0ZM${t},${t}V${h - t}H${w - t}V${t}Z`, evenodd: true } }
    case 'round1Rect': { const r = ss * a('adj', 16667); return { d: `M0,0H${w - r}A${r},${r} 0 0 1 ${w},${r}V${h}H0Z` } }
    case 'round2SameRect': { const r = ss * a('adj1', 16667); return { d: `M${r},0H${w - r}A${r},${r} 0 0 1 ${w},${r}V${h}H0V${r}A${r},${r} 0 0 1 ${r},0Z` } }
    case 'round2DiagRect': { const r = ss * a('adj1', 16667); return { d: `M${r},0H${w}V${h - r}A${r},${r} 0 0 1 ${w - r},${h}H0V${r}A${r},${r} 0 0 1 ${r},0Z` } }
    case 'snip1Rect': { const x = ss * a('adj', 16667); return { d: poly([[0, 0], [w - x, 0], [w, x], [w, h], [0, h]]) } }
    case 'snip2SameRect': { const x = ss * a('adj1', 16667); return { d: poly([[x, 0], [w - x, 0], [w, x], [w, h], [0, h], [0, x]]) } }
    case 'snipRoundRect': { const r = ss * a('adj1', 16667), x = ss * a('adj2', 16667); return { d: `M${r},0H${w - x}L${w},${x}V${h}H0V${r}A${r},${r} 0 0 1 ${r},0Z` } }
    case 'can': case 'flowChartMagneticDisk': { const ry = Math.min(h / 2, ss * a('adj', 25000) / 2); return { d: `M0,${ry}A${w / 2},${ry} 0 0 1 ${w},${ry}V${h - ry}A${w / 2},${ry} 0 0 1 0,${h - ry}ZM0,${ry}A${w / 2},${ry} 0 0 0 ${w},${ry}` } }
    case 'heart': return { d: `M${w / 2},${h / 4}C${w * 0.7},${-h / 8} ${w * 1.15},${h * 0.3} ${w / 2},${h}C${-w * 0.15},${h * 0.3} ${w * 0.3},${-h / 8} ${w / 2},${h / 4}Z` }
    case 'wedgeRectCallout': case 'wedgeRoundRectCallout': {
      const tx = w / 2 + w * a('adj1', -20833), ty = h / 2 + h * a('adj2', 62500)
      const r = prst === 'wedgeRoundRectCallout' ? ss * 0.16667 : 0
      const base = r ? rr(r) : `M0,0H${w}V${h}H0Z`
      const bx = Math.max(w * 0.1, Math.min(w * 0.9, tx))
      return { d: `${base}M${bx - w * 0.08},${ty > h ? h : 0}L${n2(tx)},${n2(ty)}L${bx + w * 0.08},${ty > h ? h : 0}Z` }
    }
    case 'flowChartDocument': return { d: `M0,0H${w}V${h * 0.83}C${w * 0.7},${h * 0.63} ${w * 0.3},${h * 1.07} 0,${h * 0.87}Z` }
    case 'flowChartPredefinedProcess': return { d: `M0,0H${w}V${h}H0ZM${w * 0.125},0V${h}M${w * 0.875},0V${h}` }
    case 'blockArc': case 'arc': { const d = `M0,${h / 2}A${w / 2},${h / 2} 0 0 1 ${w},${h / 2}`; return prst === 'arc' ? { d, open: true } : { d } }
    case 'leftBracket': return { d: `M${w},0C0,0 0,0 0,${h * 0.1}V${h * 0.9}C0,${h} 0,${h} ${w},${h}`, open: true }
    case 'rightBracket': return { d: `M0,0C${w},0 ${w},0 ${w},${h * 0.1}V${h * 0.9}C${w},${h} ${w},${h} 0,${h}`, open: true }
    default: return { d: `M0,0H${w}V${h}H0Z` }
  }
}
// A custom shape's paths, scaled into its box.
function customPath(paths, w, h) {
  return paths.map((p) => {
    const sx = p.w ? w / p.w : 1, sy = p.h ? h / p.h : 1
    let d = ''
    let cur = [0, 0]
    for (const c of p.cmds) {
      if (c[0] === 'A') {
        const [, wr, hr, st, sw] = c
        const rx = wr * sx, ry = hr * sy
        const a1 = (st * Math.PI) / 180, a2 = ((st + sw) * Math.PI) / 180
        const cx0 = cur[0] - rx * Math.cos(a1), cy0 = cur[1] - ry * Math.sin(a1)
        const end = [cx0 + rx * Math.cos(a2), cy0 + ry * Math.sin(a2)]
        d += `A${n2(rx)},${n2(ry)} 0 ${Math.abs(sw) > 180 ? 1 : 0} ${sw > 0 ? 1 : 0} ${n2(end[0])},${n2(end[1])}`
        cur = end
        continue
      }
      const pts = c.slice(1).map(([x, y]) => [x * sx, y * sy])
      if (c[0] === 'Z') { d += 'Z'; continue }
      d += `${c[0]}${pts.map((q) => `${n2(q[0])},${n2(q[1])}`).join(' ')}`
      if (pts.length) cur = pts[pts.length - 1]
    }
    return { d, fill: p.fill, stroke: p.stroke }
  })
}

// ---------- Fills and lines ----------
const DASH = { dash: [4, 3], dot: [1, 2], dashDot: [4, 3, 1, 3], lgDash: [8, 3], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDash: [3, 1], sysDot: [1, 1], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1] }
// PowerPoint's patterns (pattFill), each a tile of 8 by 8 dots: which dots are the foreground's.
// The percentages spread their dots evenly (an ordered dither); lines, grids, checks and bricks as
// drawn; the rest, which are pictures of their own (plaid, weave, waves…), as dots as dense.
const BAYER = [[0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22], [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25], [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]]
const dn = (x, y) => (x - y + 8) % 8, up = (x, y) => (x + y) % 8
const PATTERN = {
  horz: (x, y) => y === 0, ltHorz: (x, y) => y % 4 === 0, narHorz: (x, y) => y % 2 === 0, dkHorz: (x, y) => y % 4 < 2, dashHorz: (x, y) => y % 4 === 0 && (x + (y % 8 ? 4 : 0)) % 8 < 4,
  vert: (x) => x === 0, ltVert: (x) => x % 4 === 0, narVert: (x) => x % 2 === 0, dkVert: (x) => x % 4 < 2, dashVert: (x, y) => x % 4 === 0 && (y + (x % 8 ? 4 : 0)) % 8 < 4,
  dnDiag: (x, y) => dn(x, y) === 0, ltDnDiag: (x, y) => dn(x, y) % 4 === 0, dkDnDiag: (x, y) => dn(x, y) % 4 < 2, wdDnDiag: (x, y) => dn(x, y) < 3, dashDnDiag: (x, y) => dn(x, y) % 4 === 0 && y % 4 < 2,
  upDiag: (x, y) => up(x, y) === 7, ltUpDiag: (x, y) => up(x, y) % 4 === 3, dkUpDiag: (x, y) => up(x, y) % 4 >= 2, wdUpDiag: (x, y) => up(x, y) >= 5, dashUpDiag: (x, y) => up(x, y) % 4 === 3 && y % 4 < 2,
  cross: (x, y) => x === 0 || y === 0, lgGrid: (x, y) => x === 0 || y === 0, smGrid: (x, y) => x % 4 === 0 || y % 4 === 0, dotGrid: (x, y) => (y === 0 && x % 2 === 0) || (x === 0 && y % 2 === 0),
  diagCross: (x, y) => dn(x, y) === 0 || up(x, y) === 7, openDmnd: (x, y) => dn(x, y) === 0 || up(x, y) === 7, smCheck: (x, y) => ((x >> 1) + (y >> 1)) % 2 === 0, lgCheck: (x, y) => ((x >> 2) + (y >> 2)) % 2 === 0,
  horzBrick: (x, y) => y === 0 || y === 4 || (x === 0 && y < 4) || (x === 4 && y > 4), diagBrick: (x, y) => up(x, y) === 7 || (dn(x, y) === 0 && y >= 4),
  solidDmnd: (x, y) => Math.abs(x - 3.5) + Math.abs(y - 3.5) <= 3.5, dotDmnd: (x, y) => (x % 4 === 0 && y % 4 === 0) || (x % 4 === 2 && y % 4 === 2),
}
const PATTERN_DENSE = { smConfetti: 0.2, lgConfetti: 0.35, plaid: 0.5, sphere: 0.5, weave: 0.5, divot: 0.15, shingle: 0.3, wave: 0.3, trellis: 0.5, zigZag: 0.3 }
// A pattern's tile as a picture of 8 by 8 dots (a BMP): a picture, unlike drawn shapes, keeps its
// dots' mix when it's made small (a thumbnail) in every browser. A see-through colour is mixed with
// white first, as on a slide.
function patternUrl(f) {
  const pct = /^pct(\d+)$/.exec(f.prst)
  const on = PATTERN[f.prst] || ((x, y) => BAYER[y][x] < (pct ? Number(pct[1]) / 100 : PATTERN_DENSE[f.prst] ?? 0.5) * 64)
  const bgr = (c) => [4, 2, 0].map((i) => Math.round(parseInt(c.hex.slice(i, i + 2), 16) * c.alpha + 255 * (1 - c.alpha)))
  const fg = bgr(f.fg), bg = bgr(f.bg)
  const b = new Uint8Array(54 + 8 * 8 * 3)
  const put = (at, v, n) => { for (let i = 0; i < n; i++) b[at + i] = (v >>> (8 * i)) & 255 }
  b[0] = 0x42; b[1] = 0x4d; put(2, b.length, 4); put(10, 54, 4); put(14, 40, 4); put(18, 8, 4); put(22, -8, 4); put(26, 1, 2); put(28, 24, 2); put(34, 192, 4)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) b.set(on(x, y) ? fg : bg, 54 + (y * 8 + x) * 3)
  return `data:image/bmp;base64,${btoa(String.fromCharCode(...b))}`
}
const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, '')}")`
// A gradient as CSS, in a box w by h: a linear one at its angle (0 left to right, 90 top to bottom;
// scaled, as if the box were square and then stretched), a radial one from its focus, its first
// stop there and its last at the far corner (a rectangular one as an ellipse to its sides).
function gradCss(f, w, h) {
  const stops = f.stops.map((s) => `${css(s.color)} ${n2(s.at)}%`).join(', ')
  if (f.radial) {
    const at = `at ${n2((f.focus?.x ?? 0.5) * 100)}% ${n2((f.focus?.y ?? 0.5) * 100)}%`
    const centred = Math.abs((f.focus?.x ?? 0.5) - 0.5) < 0.01 && Math.abs((f.focus?.y ?? 0.5) - 0.5) < 0.01
    return `radial-gradient(${f.path === 'circle' || !f.path ? 'circle farthest-corner' : centred ? 'closest-side' : 'farthest-corner'} ${at}, ${stops})`
  }
  let deg = f.angle
  if (f.scaled && w > 0 && h > 0) { const t = (deg * Math.PI) / 180; deg = (Math.atan2(Math.sin(t) / h, Math.cos(t) / w) * 180) / Math.PI }
  return `linear-gradient(${n2(deg + 90)}deg, ${stops})`
}
// What a picture fill's look does to it, as CSS (grey, brighter, more contrasting).
const filterCss = (p) => { const f = [p.gray ? 'grayscale(1)' : '', p.lum?.bright ? `brightness(${n2(1 + p.lum.bright)})` : '', p.lum?.contrast ? `contrast(${n2(1 + p.lum.contrast)})` : ''].filter(Boolean); return f.length ? `filter:${f.join(' ')};` : '' }
function svgFill(fill, defs, id, box) {
  if (!fill || fill.type === 'none' || fill.type === 'group') return 'none'
  if (fill.type === 'solid') return css(fill.color)
  if (fill.type === 'grad' && fill.stops.length) {
    const stops = fill.stops.map((s) => `<stop offset="${n2(s.at)}%" stop-color="#${s.color.hex}"${s.color.alpha < 1 ? ` stop-opacity="${n2(s.color.alpha)}"` : ''}/>`).join('')
    if (fill.radial) defs.push(`<radialGradient id="${id}" cx="${n2(fill.focus?.x ?? 0.5)}" cy="${n2(fill.focus?.y ?? 0.5)}" r="${fill.path === 'circle' ? 0.71 : 0.5}">${stops}</radialGradient>`)
    else {
      const t = (fill.angle * Math.PI) / 180
      const x = Math.cos(t) / 2, y = Math.sin(t) / 2
      defs.push(`<linearGradient id="${id}" x1="${n2(0.5 - x)}" y1="${n2(0.5 - y)}" x2="${n2(0.5 + x)}" y2="${n2(0.5 + y)}">${stops}</linearGradient>`)
    }
    return `url(#${id})`
  }
  if (fill.type === 'pattern') {
    defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="8" height="8"><image href="${esc(patternUrl(fill))}" width="8" height="8"/></pattern>`)
    return `url(#${id})`
  }
  if (fill.type === 'blip' && fill.url) {
    const look = `${fill.alpha < 1 ? ` opacity="${n2(fill.alpha)}"` : ''}`
    if (fill.tile && fill.size && box) {
      const tw = Math.max(1, fill.size.w * fill.tile.sx), th = Math.max(1, fill.size.h * fill.tile.sy)
      defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" x="${n2(fill.tile.tx)}" y="${n2(fill.tile.ty)}" width="${n2(tw)}" height="${n2(th)}"><image href="${esc(fill.url)}" width="${n2(tw)}" height="${n2(th)}" preserveAspectRatio="none"${look}/></pattern>`)
    } else defs.push(`<pattern id="${id}" patternContentUnits="objectBoundingBox" width="1" height="1"><image href="${esc(fill.url)}" width="1" height="1" preserveAspectRatio="none"${look}/></pattern>`)
    return `url(#${id})`
  }
  return 'none'
}
export function cssFill(fill) {
  if (!fill || fill.type === 'none') return 'transparent'
  if (fill.type === 'solid') return css(fill.color)
  if (fill.type === 'grad' && fill.stops.length) return gradCss(fill, 0, 0)
  if (fill.type === 'pattern') return `${cssUrl(patternUrl(fill))} 0 0 / 8px 8px repeat`
  if (fill.type === 'blip' && fill.url) return `center / 100% 100% no-repeat ${cssUrl(fill.url)}`
  return 'transparent'
}

// ---------- A slide's background ----------
// Drawn as PowerPoint draws it, on white (what's see-through in it shows white): a colour, a
// gradient, a pattern, or a picture stretched over the slide (into its fillRect, cropped by its
// srcRect) or tiled at its own size from its corner, see-through, grey or brighter as it says.
// One layer under everything else on the slide.
export function bgHtml(bg, w, h) {
  if (!bg) return ''
  const layer = (style) => `<div class="px-bg" style="${esc(style)}"></div>`
  if (bg.type === 'solid' && bg.color) return layer(`background:${css(bg.color)}`)
  if (bg.type === 'grad' && bg.stops.length) return layer(`background:${gradCss(bg, w, h)}`)
  if (bg.type === 'pattern') return layer(`background:${cssFill(bg)}`)
  if (bg.type !== 'blip' || !bg.url) return ''
  const look = `${bg.alpha < 1 ? `opacity:${n2(bg.alpha)};` : ''}${filterCss(bg)}`
  if (bg.tile && bg.size) {
    const tw = Math.max(1, bg.size.w * bg.tile.sx), th = Math.max(1, bg.size.h * bg.tile.sy)
    const a = bg.tile.algn
    const x = (/^(tr|r|br)$/.test(a) ? w - tw : /^(t|ctr|b)$/.test(a) ? (w - tw) / 2 : 0) + bg.tile.tx
    const y = (/^(bl|b|br)$/.test(a) ? h - th : /^(l|ctr|r)$/.test(a) ? (h - th) / 2 : 0) + bg.tile.ty
    return layer(`${look}background:${cssUrl(bg.url)} ${n2(x)}px ${n2(y)}px / ${n2(tw)}px ${n2(th)}px repeat`)
  }
  const i = bg.inset || { l: 0, t: 0, r: 0, b: 0 }, c = bg.crop || { l: 0, t: 0, r: 0, b: 0 }
  const bw = w * (1 - i.l - i.r), bh = h * (1 - i.t - i.b)
  const iw = bw / Math.max(0.01, 1 - c.l - c.r), ih = bh / Math.max(0.01, 1 - c.t - c.b)
  return layer(`${look}left:${n2(i.l * w)}px;top:${n2(i.t * h)}px;width:${n2(bw)}px;height:${n2(bh)}px;background:${cssUrl(bg.url)} ${n2(-c.l * iw)}px ${n2(-c.t * ih)}px / ${n2(iw)}px ${n2(ih)}px no-repeat`)
}
const ARROW_SIZE = { sm: 2, med: 3, lg: 5 }
function marker(end, color, id, defs, start) {
  if (!end) return ''
  const w = ARROW_SIZE[end.w] || 3, l = ARROW_SIZE[end.len] || 3
  const shape = { triangle: 'M0,0L10,5L0,10Z', stealth: 'M0,0L10,5L0,10L3,5Z', arrow: 'M0,0L10,5L0,10', oval: 'M5,0A5,5 0 1 1 5,10A5,5 0 1 1 5,0Z', diamond: 'M5,0L10,5L5,10L0,5Z' }[end.type] || 'M0,0L10,5L0,10Z'
  const open = end.type === 'arrow'
  defs.push(`<marker id="${id}" viewBox="0 0 10 10" refX="${end.type === 'oval' || end.type === 'diamond' ? 5 : 8}" refY="5" markerWidth="${l}" markerHeight="${w}" orient="${start ? 'auto-start-reverse' : 'auto'}" markerUnits="strokeWidth"><path d="${shape}" fill="${open ? 'none' : color}" stroke="${open ? color : 'none'}" stroke-width="${open ? 1.5 : 0}"/></marker>`)
  return ` marker-${start ? 'start' : 'end'}="url(#${id})"`
}

// ---------- Text ----------
const ALIGN = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify', justLow: 'justify', thaiDist: 'justify' }
// A run's style, as CSS.
export function runCss(r) {
  const deco = [r.u ? 'underline' : '', r.strike ? 'line-through' : ''].filter(Boolean).join(' ')
  const size = r.sz * PT * (r.baseline ? 0.7 : 1)
  return `font-family:${fontCss(r.font)};font-size:${n2(size)}px;${r.color ? `color:${css(r.color)};` : ''}${r.b ? 'font-weight:700;' : ''}${r.i ? 'font-style:italic;' : ''}${deco ? `text-decoration:${deco};` : ''}${r.cap === 'all' ? 'text-transform:uppercase;' : r.cap === 'small' ? 'font-variant:small-caps;' : ''}${r.baseline ? `vertical-align:${r.baseline > 0 ? 'super' : 'sub'};` : ''}${r.spc ? `letter-spacing:${n2(r.spc * PT)}px;` : ''}${r.highlight ? `background:${css(r.highlight)};` : ''}`
}
// A paragraph's style and its bullet, as CSS and attributes (for drawing and for editing alike).
export function paraAttrs(p, i, body) {
  const size = (p.runs.find((r) => r.text)?.sz || p.end.sz || 18) * PT
  const reduce = body?.lnReduce || 0
  const lh = p.lnSpc?.pts ? `${n2(p.lnSpc.pts * PT)}px` : n2(1.2 * Math.max(0.5, (p.lnSpc?.pct ?? 1) - reduce))
  const sp = (s) => (!s ? 0 : s.pts != null ? s.pts * PT * (body?.fontScale || 1) : s.pct * size * 1.2)
  const bef = i ? sp(p.spcBef) : 0
  const indent = p.indent || 0
  let style = `text-align:${ALIGN[p.algn] || 'left'};padding-left:${n2(Math.max(0, p.marL))}px;line-height:${lh};${bef ? `padding-top:${n2(bef)}px;` : ''}${p.spcAft ? `padding-bottom:${n2(sp(p.spcAft))}px;` : ''}font-size:${n2((p.end.sz || 18) * PT)}px;font-family:${fontCss(p.end.font)};`
  let bu = ''
  if (p.bullet) {
    const b = p.bullet
    const w = indent < 0 ? -indent : 0
    style += `--bu-w:${n2(w)}px;--bu-m:${n2(indent < 0 ? indent : 0)}px;${b.color ? `--bu-c:${css(b.color)};` : ''}--bu-s:${n2(b.size * PT)}px;${b.font ? `--bu-f:${fontCss(b.font)};` : ''}`
    bu = ` data-bu="${esc(indent < 0 ? b.text : `${b.text} `)}"`
  } else if (indent) style += `text-indent:${n2(indent)}px;`
  return { style, bu }
}
// A paragraph's words as HTML: each run a span (data-r: its place in the paragraph, for editing).
export function runsHtml(p, { number = 1 } = {}) {
  if (!p.runs.length || p.runs.every((r) => !r.text && !r.br)) return '<br>'
  return p.runs.map((r, j) => (r.br ? '<br>' : `<span data-r="${j}" style="${runCss(r)}">${esc(r.fld === 'slidenum' ? String(number) : r.text)}</span>`)).join('') + (p.runs.at(-1)?.br ? '<br>' : '')
}
export function textHtml(text, box, { number = 1, prompt = null, hide = false } = {}) {
  const b = text.body || {}
  const vert = b.vert && /vert/i.test(b.vert) ? `writing-mode:vertical-rl;${b.vert === 'vert270' ? 'transform:rotate(180deg);' : ''}` : ''
  const just = b.anchor === 'ctr' ? 'center' : b.anchor === 'b' ? 'flex-end' : 'flex-start'
  const pos = `left:${n2(b.l)}px;top:${n2(b.t)}px;width:${n2(Math.max(0, box.w - b.l - b.r))}px;height:${n2(Math.max(0, box.h - b.t - b.b))}px;justify-content:${just};${vert}${hide ? 'visibility:hidden;' : ''}`
  const paras = prompt != null ? [{ ...text.paras[0], runs: [{ ...(text.paras[0]?.end || {}), text: prompt }] }] : text.paras
  const html = paras.map((p, i) => { const a = paraAttrs(p, i, b); return `<p data-p="${i}" style="${a.style}"${prompt != null ? '' : a.bu}>${runsHtml(p, { number })}</p>` }).join('')
  return `<div class="px-tx${b.wrap === false ? ' nowrap' : ''}${prompt != null ? ' px-prompt' : ''}" style="${pos}"><div class="px-body">${html}</div></div>`
}

// ---------- Tables and charts ----------
function borderCss(l) { if (!l || l.none || !l.color) return 'none'; return `${n2(Math.max(0.5, l.width || 1))}px ${l.dash ? 'dashed' : 'solid'} ${css(l.color)}` }
function tableHtml(o, opts) {
  const t = o.table
  const cols = t.cols.map((w) => `<col style="width:${n2(w)}px">`).join('')
  const rows = t.rows.map((r, ri) => `<tr style="height:${n2(r.h)}px">${r.cells.map((c, ci) => {
    if (c.hMerge || c.vMerge) return ''
    const b = c.text?.body || { l: 7.2, r: 7.2, t: 3.6, b: 3.6, anchor: 't' }
    const inner = c.text ? c.text.paras.map((p, i) => { const a = paraAttrs(p, i, b); return `<p data-p="${i}" style="${a.style}"${a.bu}>${runsHtml(p, opts)}</p>` }).join('') : ''
    return `<td data-cell="${ri}:${ci}"${c.span > 1 ? ` colspan="${c.span}"` : ''}${c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : ''} style="background:${esc(cssFill(c.fill))};border-left:${borderCss(c.border.l)};border-right:${borderCss(c.border.r)};border-top:${borderCss(c.border.t)};border-bottom:${borderCss(c.border.b)};padding:${n2(b.t)}px ${n2(b.r)}px ${n2(b.b)}px ${n2(b.l)}px;vertical-align:${b.anchor === 'ctr' ? 'middle' : b.anchor === 'b' ? 'bottom' : 'top'}"><div class="px-cell"${opts.editCell === `${ri}:${ci}` ? ' style="visibility:hidden"' : ''}>${inner}</div></td>`
  }).join('')}</tr>`).join('')
  return `<table class="px-table" style="left:0;top:0;width:${n2(t.cols.reduce((a, b) => a + b, 0))}px"><colgroup>${cols}</colgroup><tbody>${rows}</tbody></table>`
}
// A nice step for an axis from 0 (or below) to max.
function ticks(lo, hi) {
  if (hi === lo) hi = lo + 1
  const raw = (hi - lo) / 5, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step
  const out = []
  for (let v = a; v <= b + step / 2; v += step) out.push(+v.toFixed(10))
  return out
}
const fmtNum = (v) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : String(+v.toFixed(2)))
export function chartSvg(c, w, h, font) {
  const f = fontCss(font)
  const ink = '#595959', grid = '#D9D9D9'
  const out = []
  const title = c.title ? 28 : 0
  const legendH = c.legend && c.legend !== 'r' ? 26 : 0
  const legendW = c.legend === 'r' ? Math.min(160, w * 0.25) : 0
  if (c.title) out.push(`<text x="${w / 2}" y="22" text-anchor="middle" font-size="18.6" fill="${ink}" font-family="${esc(f)}">${esc(c.title)}</text>`)
  const color = (s, i) => css(s.points?.find((p) => p.i === i)?.color || s.color)
  const series = c.series.filter((s) => s.values.length)
  const names = c.type === 'pie' || c.type === 'doughnut' ? (c.cats.length ? c.cats : series[0]?.values.map((_, i) => String(i + 1)) || []) : series.map((s) => s.name)
  if (c.legend) {
    const items = names.map((n, i) => ({ n, col: c.type === 'pie' || c.type === 'doughnut' ? css(series[0]?.points?.find((p) => p.i === i)?.color || { hex: ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'][i % 6], alpha: 1 }) : css(series[i].color) }))
    if (c.legend === 'r') items.forEach((it, i) => out.push(`<rect x="${w - legendW + 6}" y="${title + 12 + i * 22}" width="10" height="10" fill="${it.col}"/><text x="${w - legendW + 22}" y="${title + 21 + i * 22}" font-size="13.3" fill="${ink}" font-family="${esc(f)}">${esc(it.n)}</text>`))
    else {
      const each = Math.min(160, w / Math.max(1, items.length))
      const x0 = (w - each * items.length) / 2
      items.forEach((it, i) => out.push(`<rect x="${x0 + i * each + 8}" y="${h - 18}" width="10" height="10" fill="${it.col}"/><text x="${x0 + i * each + 24}" y="${h - 9}" font-size="13.3" fill="${ink}" font-family="${esc(f)}">${esc(it.n)}</text>`))
    }
  }
  const area = { x: 8, y: title + 8, w: w - legendW - 16, h: h - title - legendH - 16 }
  if (c.type === 'pie' || c.type === 'doughnut') {
    const vals = (series[0]?.values || []).map((v) => Math.max(0, v || 0))
    const sum = vals.reduce((a, b) => a + b, 0) || 1
    const r = Math.min(area.w, area.h) / 2, cx = area.x + area.w / 2, cy = area.y + area.h / 2
    const hole = c.type === 'doughnut' ? r * (c.holeSize / 100) : 0
    let a0 = -Math.PI / 2
    vals.forEach((v, i) => {
      const a1 = a0 + (v / sum) * Math.PI * 2
      const p = (rr, a) => `${n2(cx + rr * Math.cos(a))},${n2(cy + rr * Math.sin(a))}`
      const big = a1 - a0 > Math.PI ? 1 : 0
      const col = css(series[0]?.points?.find((pt) => pt.i === i)?.color || { hex: ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'][i % 6], alpha: 1 })
      out.push(hole ? `<path d="M${p(r, a0)}A${r},${r} 0 ${big} 1 ${p(r, a1)}L${p(hole, a1)}A${hole},${hole} 0 ${big} 0 ${p(hole, a0)}Z" fill="${col}" stroke="#fff" stroke-width="1.5"/>` : `<path d="M${cx},${cy}L${p(r, a0)}A${r},${r} 0 ${big} 1 ${p(r, a1)}Z" fill="${col}" stroke="#fff" stroke-width="1.5"/>`)
      a0 = a1
    })
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${n2(w)}" height="${n2(h)}" viewBox="0 0 ${n2(w)} ${n2(h)}">${out.join('')}</svg>`
  }
  const cats = c.cats.length ? c.cats : (series[0]?.values || []).map((_, i) => String(i + 1))
  const stacked = c.stacked && (c.type === 'col' || c.type === 'bar' || c.type === 'area')
  const totals = cats.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] || 0), 0))
  const all = stacked ? (c.percent ? [100] : totals) : series.flatMap((s) => s.values.filter((v) => v != null))
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all)
  const tk = ticks(lo, hi)
  const horiz = c.type === 'bar'
  const labelW = horiz ? Math.min(120, area.w * 0.25) : 44
  const plot = { x: area.x + labelW, y: area.y + 6, w: area.w - labelW - 6, h: area.h - 30 }
  const vmin = tk[0], vmax = tk[tk.length - 1]
  const val = (v) => (horiz ? plot.x + ((v - vmin) / (vmax - vmin)) * plot.w : plot.y + plot.h - ((v - vmin) / (vmax - vmin)) * plot.h)
  for (const v of tk) out.push(horiz ? `<line x1="${n2(val(v))}" y1="${plot.y}" x2="${n2(val(v))}" y2="${plot.y + plot.h}" stroke="${grid}"/><text x="${n2(val(v))}" y="${plot.y + plot.h + 18}" text-anchor="middle" font-size="12" fill="${ink}" font-family="${esc(f)}">${fmtNum(v)}</text>` : `<line x1="${plot.x}" y1="${n2(val(v))}" x2="${plot.x + plot.w}" y2="${n2(val(v))}" stroke="${grid}"/><text x="${plot.x - 6}" y="${n2(val(v) + 4)}" text-anchor="end" font-size="12" fill="${ink}" font-family="${esc(f)}">${fmtNum(v)}</text>`)
  const band = (horiz ? plot.h : plot.w) / Math.max(1, cats.length)
  cats.forEach((cat, i) => out.push(horiz ? `<text x="${plot.x - 6}" y="${n2(plot.y + band * (i + 0.5) + 4)}" text-anchor="end" font-size="12" fill="${ink}" font-family="${esc(f)}">${esc(cat)}</text>` : `<text x="${n2(plot.x + band * (i + 0.5))}" y="${plot.y + plot.h + 18}" text-anchor="middle" font-size="12" fill="${ink}" font-family="${esc(f)}">${esc(cat)}</text>`))
  if (c.type === 'col' || c.type === 'bar') {
    const gap = band * 0.35
    const n = stacked ? 1 : series.length
    const bw = (band - gap) / Math.max(1, n)
    const base = cats.map(() => 0)
    series.forEach((s, si) => s.values.forEach((v0, i) => {
      if (v0 == null) return
      const v = c.percent ? ((v0 || 0) / (totals[i] || 1)) * 100 : v0
      const from = stacked ? base[i] : 0, to = from + v
      if (stacked) base[i] = to
      const p0 = val(from), p1 = val(to)
      const o = band * i + gap / 2 + (stacked ? 0 : bw * si)
      out.push(horiz ? `<rect x="${n2(Math.min(p0, p1))}" y="${n2(plot.y + o)}" width="${n2(Math.abs(p1 - p0))}" height="${n2(bw)}" fill="${color(s, i)}"/>` : `<rect x="${n2(plot.x + o)}" y="${n2(Math.min(p0, p1))}" width="${n2(bw)}" height="${n2(Math.abs(p1 - p0))}" fill="${color(s, i)}"/>`)
    }))
  } else {
    const base = cats.map(() => 0)
    series.forEach((s) => {
      const pts = s.values.map((v, i) => { const y = stacked ? (base[i] += v || 0) : v; return v == null ? null : [plot.x + band * (i + 0.5), val(y)] }).filter(Boolean)
      if (!pts.length) return
      const d = `M${pts.map((p) => `${n2(p[0])},${n2(p[1])}`).join('L')}`
      if (c.type === 'area') out.push(`<path d="${d}L${n2(pts.at(-1)[0])},${n2(val(0))}L${n2(pts[0][0])},${n2(val(0))}Z" fill="${css(s.color)}" fill-opacity=".85"/>`)
      else out.push(`<path d="${d}" fill="none" stroke="${css(s.color)}" stroke-width="2.5" stroke-linejoin="round"/>${pts.map((p) => `<circle cx="${n2(p[0])}" cy="${n2(p[1])}" r="3.5" fill="${css(s.color)}"/>`).join('')}`)
    })
  }
  out.push(horiz ? `<line x1="${n2(val(0))}" y1="${plot.y}" x2="${n2(val(0))}" y2="${plot.y + plot.h}" stroke="#BFBFBF"/>` : `<line x1="${plot.x}" y1="${n2(val(0))}" x2="${plot.x + plot.w}" y2="${n2(val(0))}" stroke="#BFBFBF"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n2(w)}" height="${n2(h)}" viewBox="0 0 ${n2(w)} ${n2(h)}">${out.join('')}</svg>`
}

// ---------- A shape ----------
// One thing, at box (its place in what it's drawn in): its outline, picture and words.
function objHtml(o, box, opts, top) {
  const id = `px${opts.uid}-${seq++}`
  const flip = o.flipH || o.flipV ? `scale(${o.flipH ? -1 : 1},${o.flipV ? -1 : 1})` : ''
  const rot = o.rot ? `rotate(${n2(o.rot)}deg)` : ''
  const at = top && o.at != null ? ` data-o="${o.at}"` : ''
  const hideText = opts.editing === o.at && top
  const pos = `left:${n2(box.x)}px;top:${n2(box.y)}px;width:${n2(box.w)}px;height:${n2(box.h)}px;${rot ? `transform:${rot};` : ''}`
  if (o.kind === 'grp' || (o.kind === 'diagram' && o.kids)) {
    const sx = o.ch.w ? box.w / o.ch.w : 1, sy = o.ch.h ? box.h / o.ch.h : 1
    const inner = (o.kids || []).map((k) => objHtml(k, { x: (k.x - o.ch.x) * sx, y: (k.y - o.ch.y) * sy, w: k.w * sx, h: k.h * sy }, opts, false)).join('')
    return `<div class="px-o px-grp"${at} style="${pos}${flip ? `transform:${rot}${flip};` : ''}">${inner}</div>`
  }
  if (o.kind === 'table') return `<div class="px-o"${at} style="${pos}">${tableHtml(o, { ...opts, editCell: top && opts.editing === o.at ? opts.editCell : null })}</div>`
  if (o.kind === 'chart') return `<div class="px-o"${at} style="${pos}">${o.chart ? chartSvg(o.chart, box.w, box.h, opts.font) : `<div class="px-missing">${esc(opts.words?.chart || 'Chart')}</div>`}</div>`
  if (o.kind === 'diagram' || o.kind === 'other') return `<div class="px-o"${at} style="${pos}"><div class="px-missing">${esc(o.kind === 'diagram' ? opts.words?.diagram || 'Diagram' : opts.words?.other || 'Object')}</div></div>`
  const parts = []
  const defs = []
  const g = o.geom || { prst: 'rect', av: {} }
  const paths = g.prst === 'custom' ? customPath(g.paths || [], box.w, box.h) : [{ ...presetPath(g.prst, box.w, box.h, g.av), fill: true, stroke: true }]
  const ln = o.line && !o.line.none && o.line.color ? o.line : null
  const lw = ln ? Math.max(0.75, ln.width ?? 0.75) : 0
  const fill = o.kind === 'pic' || o.kind === 'cxn' ? 'none' : svgFill(o.fill, defs, `${id}f`, box)
  const lc = ln ? css(ln.color) : 'none'
  const dash = ln?.dash && DASH[ln.dash] ? ` stroke-dasharray="${DASH[ln.dash].map((d) => n2(d * lw)).join(' ')}"` : ''
  const ends = ln ? `${marker(ln.head, lc, `${id}h`, defs, true)}${marker(ln.tail, lc, `${id}t`, defs, false)}` : ''
  if (o.kind === 'pic' && o.img) {
    const c = o.img.crop || { l: 0, t: 0, r: 0, b: 0 }
    const iw = box.w / Math.max(0.01, 1 - c.l - c.r), ih = box.h / Math.max(0.01, 1 - c.t - c.b)
    const clip = g.prst === 'ellipse' ? 'border-radius:50%;' : g.prst === 'roundRect' ? `border-radius:${n2(Math.min(box.w, box.h) * 0.16667)}px;` : ''
    const look = `${o.img.alpha < 1 ? `opacity:${n2(o.img.alpha)};` : ''}${filterCss(o.img)}`
    const img = o.img.url ? `<img alt="${esc(o.descr || o.name)}" src="${esc(o.img.url)}" draggable="false" style="left:${n2(-c.l * iw)}px;top:${n2(-c.t * ih)}px;width:${n2(iw)}px;height:${n2(ih)}px;${look}">` : `<div class="px-missing">${esc(opts.words?.picture || 'Picture')}</div>`
    parts.push(`<div class="px-pic" style="inset:0;${clip}${flip ? `transform:${flip};` : ''}">${img}${o.img.video ? '<svg viewBox="0 0 24 24" style="position:absolute;left:50%;top:50%;width:48px;height:48px;margin:-24px 0 0 -24px"><circle cx="12" cy="12" r="11" fill="rgb(0 0 0/.55)"/><path d="M10 8l6 4-6 4z" fill="#fff"/></svg>' : ''}</div>`)
  }
  const drawShape = o.kind !== 'pic' || ln
  if (drawShape) {
    const body = paths.map((p) => `<path d="${p.d}" fill="${p.open || p.fill === false ? 'none' : fill}" stroke="${p.stroke === false ? 'none' : lc}" stroke-width="${n2(lw)}"${p.evenodd ? ' fill-rule="evenodd"' : ''}${dash}${p.open || o.kind === 'cxn' ? ends : ''}${ln?.cap === 'rnd' ? ' stroke-linecap="round"' : ''}/>`).join('')
    parts.unshift(`<svg width="${n2(Math.max(1, box.w))}" height="${n2(Math.max(1, box.h))}" viewBox="0 0 ${n2(Math.max(1, box.w))} ${n2(Math.max(1, box.h))}"${flip ? ` style="transform:${flip}"` : ''} aria-hidden="true">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${body}</svg>`)
  }
  if (o.text) {
    const prompt = opts.prompts && o.empty && o.prompt != null && top ? opts.promptOf?.(o) ?? o.prompt : null
    if (o.text.paras.some((p) => p.runs.some((r) => r.text)) || prompt) parts.push(textHtml(o.text, box, { number: opts.number, prompt, hide: hideText }))
  }
  const outline = opts.prompts && o.ph && top && o.empty ? 'outline:1px dashed rgb(128 128 128/.6);outline-offset:-1px;' : ''
  return `<div class="px-o"${at} style="${pos}${outline}">${parts.join('')}</div>`
}

// ---------- A slide ----------
// view: slideView's. opts: { number (the slide's, for its number), prompts (empty placeholders'
// prompts, while editing), promptOf(o), editing (the shape being typed in: its words hidden, as
// they're shown where they're typed), editCell, font (the theme's body font, for charts), words
// ({ picture, chart, diagram, other }: said where one can't be drawn) }.
export function slideHtml(view, opts = {}) {
  const o2 = { ...opts, uid: (opts.uid ?? Math.random().toString(36).slice(2, 7)) }
  const under = view.under.map((o) => objHtml(o, o, o2, false)).join('')
  const objs = view.objs.map((o) => objHtml(o, o, o2, true)).join('')
  return `<div class="px-slide" style="width:${n2(view.w)}px;height:${n2(view.h)}px;background:#fff">${bgHtml(view.bg, view.w, view.h)}${under}${objs}</div>`
}
// What a slide has that can't be drawn here: { pictures, charts, diagrams, other }.
export function missingIn(view) {
  const out = { pictures: 0, charts: 0, diagrams: 0, other: 0 }
  const walk = (list) => { for (const o of list) { if (o.kind === 'pic' && !o.img?.url) out.pictures++; if (o.kind === 'chart' && !o.chart) out.charts++; if (o.kind === 'diagram' && !o.kids) out.diagrams++; if (o.kind === 'other') out.other++; if (o.kids) walk(o.kids) } }
  walk(view.objs)
  return out
}
