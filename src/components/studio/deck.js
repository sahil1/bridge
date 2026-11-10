// A Markdown deck (Marp's format, MIT): its slides drawn, its text edited on the slide, and slides
// added, moved, laid out and noted, all by changing the Markdown itself, so the file stays a deck
// any Marp tool reads and an agent can change. Kept apart from the page (no React, no words to
// translate), so the tests can use it as it is.
//
// Drawing: Marp, with Studio's own theme (studio, below) in the deck's look: a design pack's
// colours, fonts and logo. Each block it draws carries the lines it came from (data-ln="a:b"), so
// what's typed on a slide goes back to those lines. A slide's layout is a class directive on it
// (<!-- _class: title -->), which the theme draws.
import { Marp } from '@marp-team/marp-core'

export const W = 1280
export const H = 720
// Layouts: the class each one sets (content sets none: a title and its points).
export const LAYOUTS = ['title', 'content', 'section', 'cols', 'stats', 'image', 'picture', 'quote', 'blank']
const LAYOUT_CLASS = new Set(LAYOUTS.filter((x) => x !== 'content'))

// ---------- The look ----------
// Studio's own looks, there before you make a design pack, picked the same way (pack: Ember).
export const LOOKS = [
  { id: 'paper', name: 'Paper', colors: { background: '#ffffff', text: '#1b2230', accent: '#2f6fde' }, fonts: { heading: 'Helvetica Neue', body: 'Helvetica Neue' } },
  { id: 'ember', name: 'Ember', colors: { background: '#fffaf6', text: '#2a1d17', accent: '#d9502b' }, fonts: { heading: 'Georgia', body: 'Helvetica Neue' } },
  { id: 'forest', name: 'Forest', colors: { background: '#f5f8f3', text: '#1c2a21', accent: '#2c7a4b' }, fonts: { heading: 'Avenir Next', body: 'Avenir Next' } },
  { id: 'cream', name: 'Cream', colors: { background: '#f6f0e4', text: '#2b2620', accent: '#a8642a' }, fonts: { heading: 'Georgia', body: 'Georgia' } },
  { id: 'graphite', name: 'Graphite', colors: { background: '#20242b', text: '#eef1f5', accent: '#f2b84b' }, fonts: { heading: 'Helvetica Neue', body: 'Helvetica Neue' } },
  { id: 'midnight', name: 'Midnight', colors: { background: '#0e1330', text: '#eceefe', accent: '#8f86ff' }, fonts: { heading: 'Avenir Next', body: 'Avenir Next' } },
].map((x) => ({ ...x, builtIn: true }))
export const PLAIN = LOOKS[0]

const hex6 = (c, d) => (/^#?[0-9a-f]{6}$/i.test(String(c || '')) ? `#${String(c).replace('#', '').toLowerCase()}` : d)
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const toHex = (a) => `#${a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`
export const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t))
const lum = (h) => { const [r, g, b] = rgb(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
// Every colour the theme draws with, from the look's three: the muted text, the cards and lines,
// and what reads on the accent.
export function colorsOf(look) {
  const bg = hex6(look?.colors?.background, PLAIN.colors.background)
  const fg = hex6(look?.colors?.text, PLAIN.colors.text)
  const accent = hex6(look?.colors?.accent, PLAIN.colors.accent)
  const dark = lum(bg) < 0.4
  return { bg, fg, accent, muted: mix(fg, bg, 0.42), surface: mix(bg, fg, dark ? 0.09 : 0.045), line: mix(bg, fg, 0.14), tint: mix(bg, accent, dark ? 0.22 : 0.12), onAccent: lum(accent) > 0.45 ? '#111111' : '#ffffff', dark }
}
// A font with ones every computer has after it.
export const fontStack = (name, serif = /georgia|merriweather|times|garamond/i.test(String(name))) => `${name ? `'${String(name).replace(/['"\\;{}]/g, '')}', ` : ''}${serif ? "Georgia, 'Times New Roman', serif" : "'Helvetica Neue', Helvetica, Arial, sans-serif"}`
const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, '')}")`

// Studio's theme in a look. Sizes in px of a 1280 by 720 slide (pptx.js lays out a PowerPoint the
// same way).
export function themeCss(look) {
  const c = colorsOf(look)
  const head = fontStack(look?.fonts?.heading), body = fontStack(look?.fonts?.body)
  const logo = look?.logo ? `background-image:${cssUrl(look.logo)};background-repeat:no-repeat;background-position:right 88px top 36px;background-size:auto 30px;` : ''
  return `/* @theme studio */
section{width:${W}px;height:${H}px;box-sizing:border-box;padding:84px 88px 72px;display:flex;flex-direction:column;justify-content:flex-start;background-color:${c.bg};${logo}color:${c.fg};font-family:${body};font-size:30px;line-height:1.42;letter-spacing:-.003em;text-align:left;-webkit-font-smoothing:antialiased}
section>:last-child{margin-bottom:0}
section h1{margin:0 0 30px;font:700 54px/1.1 ${head};letter-spacing:-.022em;color:${c.fg}}
section h2{margin:0 0 22px;font:600 32px/1.25 ${head};color:${c.accent}}
section h3{margin:0 0 14px;font:650 28px/1.3 ${head};color:${c.fg}}
section h4,section h5,section h6{margin:0 0 12px;font:700 20px/1.3 ${body};color:${c.muted};text-transform:uppercase;letter-spacing:.08em}
section p{margin:0 0 18px}
section ul,section ol{margin:0 0 18px;padding-left:1.1em}
section li{margin:0 0 12px;padding-left:.2em}
section li>ul,section li>ol{margin:12px 0 0;font-size:.86em}
section li::marker{color:${c.accent}}
section strong{font-weight:700}
section a{color:${c.accent};text-decoration:none}
section blockquote{margin:0 0 18px;padding:2px 0 2px 28px;border-left:6px solid ${c.accent};font-size:1.08em}
section blockquote p{margin:0 0 10px}
section code{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:.84em;padding:.08em .32em;border-radius:6px;background:${c.surface}}
section pre{margin:0 0 18px;padding:22px 26px;border-radius:14px;background:${c.surface};font-size:21px;line-height:1.5;overflow:hidden;white-space:pre-wrap}
section pre code{padding:0;background:none;font-size:inherit}
section table{border-collapse:collapse;margin:0 0 18px;font-size:24px}
section th,section td{padding:10px 18px;border-bottom:2px solid ${c.line};text-align:left}
section th{color:${c.muted};font-size:.82em;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
section img{max-width:100%;max-height:440px;border-radius:12px}
section header,section footer{position:absolute;left:88px;right:220px;font-size:16px;line-height:1.3;color:${c.muted};letter-spacing:.02em}
section header{top:34px}
section footer{bottom:30px}
section::before{content:'';position:absolute;left:88px;top:50px;width:44px;height:6px;border-radius:3px;background:${c.accent}}
section::after{right:88px;bottom:30px;padding:0;font:600 16px/1.3 ${body};color:${c.muted};letter-spacing:.04em;content:attr(data-marpit-pagination) ' / ' attr(data-marpit-pagination-total)}
section.title,section.lead{justify-content:center;padding:96px 120px;background-image:radial-gradient(circle at 100% 0,${c.tint} 0 330px,transparent 331px)${look?.logo ? `,${cssUrl(look.logo)}` : ''}}
section.title::before,section.lead::before{display:none}
section.title h1,section.lead h1{font-size:78px;line-height:1.04;letter-spacing:-.03em;margin-bottom:26px;max-width:1000px}
section.title h1::before,section.lead h1::before{content:'';display:block;width:64px;height:8px;margin-bottom:40px;border-radius:4px;background:${c.accent}}
section.title h2,section.lead h2,section.title p,section.lead p{color:${c.muted};font-weight:400;font-size:32px;font-family:${body}}
section.section{justify-content:center;padding:96px 120px;background-color:${c.accent};color:${c.onAccent}}
section.section h1{font-size:70px;letter-spacing:-.028em;color:${c.onAccent}}
section.section h2,section.section p{color:${c.onAccent};opacity:.78;font-weight:500}
section.section::before{background:${c.onAccent};opacity:.55}
section.section::after{color:${c.onAccent};opacity:.7}
section.cols{display:block;columns:2;column-gap:72px}
section.cols>h1,section.cols>h2,section.cols>header,section.cols>footer{column-span:all}
section.cols h3~h3{break-before:column}
section.cols li,section.cols p,section.cols blockquote{break-inside:avoid}
section.stats>ul,section.stats>ol{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:26px;margin:14px 0 0;padding:0;list-style:none}
section.stats li{margin:0;padding:34px 30px 30px;border-radius:20px;background:${c.surface};color:${c.muted};font-size:23px;line-height:1.4}
section.stats li strong:first-child{display:block;margin-bottom:14px;font:750 64px/1 ${head};letter-spacing:-.03em;color:${c.accent}}
section.image:not([data-marpit-advanced-background-split]){padding-right:calc(42% + 56px)}
section.picture{justify-content:flex-end;padding-bottom:84px;color:#fff}
section.picture::before{display:none}
section.picture h1{font-size:64px;color:#fff;text-shadow:0 2px 30px rgb(0 0 0/.5)}
section.picture h2,section.picture p{color:#fff;text-shadow:0 1px 20px rgb(0 0 0/.55)}
section.picture::after{color:rgb(255 255 255/.8)}
section.picture[data-marpit-advanced-background=background]>div::after{content:'';position:absolute;inset:0;background:linear-gradient(to top,rgb(0 0 0/.62),rgb(0 0 0/0) 62%)}
section.quote{justify-content:center;padding:96px 150px}
section.quote::before{display:none}
section.quote blockquote{margin:0 0 30px;padding:0;border:0;font:600 46px/1.28 ${head};letter-spacing:-.015em}
section.quote blockquote::before{content:'\\201C';display:block;height:72px;font:700 150px/1 Georgia,serif;color:${c.accent}}
section.quote blockquote+p,section.quote p:last-child{color:${c.muted};font-size:26px}
section.blank::before{display:none}
section.invert{background-color:${c.fg};color:${c.bg}}
section.invert h1,section.invert h3{color:${c.bg}}
`
}
// A design pack over another of Marp's themes (gaia, uncover), as before Studio had its own.
export function packOverCss(look) {
  if (!look) return ''
  const S = 'div.marpit>svg>foreignObject>section'
  const c = look.colors || {}, f = look.fonts || {}
  return `${S}{${c.background ? `background-color:${c.background}!important;` : ''}${c.text ? `color:${c.text}!important;` : ''}${f.body ? `font-family:${fontStack(f.body)}!important;` : ''}}${S} h1,${S} h2,${S} h3{${c.accent ? `color:${c.accent}!important;` : ''}${f.heading ? `font-family:${fontStack(f.heading)}!important;` : ''}}`
}

// ---------- Drawing ----------
// One per deck on the page: Marp with Studio's theme as its default (a deck can name another of
// Marp's), each block marked with its lines. ghosts: what an empty part of a slide shows ("Click
// to add title"), drawn as the slide would draw it, then marked so a click makes it real.
export function deckRenderer() {
  const marp = new Marp({ html: false, inlineSVG: true, script: false, math: false, emoji: { shortcode: true, unicode: false } })
  marp.markdown.core.ruler.push('sd_lines', (state) => {
    const ts = state.tokens
    const at = state.env?.sdAt || ((d) => ({ line: d }))
    if (state.env) state.env.sdSlides = ts.filter((t) => t.type === 'marpit_slide_open').map((t) => t.map)
    const mark = (t, key, a, b) => {
      const x = at(a)
      if (x.ghost) { t.attrSet('data-ph', x.ghost.ph); t.attrSet('data-at', String(x.ghost.at)); return }
      t.attrSet(key, `${x.line}:${x.line + (b - a)}`)
    }
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i]
      if (!t.map || t.nesting !== 1 || t.hidden || t.type === 'marpit_slide_open') continue
      mark(t, 'data-ln', t.map[0], t.map[1])
      // A tight list item's own words are the paragraph in it, which isn't drawn.
      if (t.type === 'list_item_open') { const p = ts[i + 1]; if (p?.type === 'paragraph_open' && p.map) mark(t, 'data-tl', p.map[0], p.map[1]); else mark(t, 'data-tl', t.map[0], t.map[0] + 1) }
    }
  })
  let lookKey = null
  return {
    marp,
    // The look Studio's theme is drawn in.
    setLook(look) {
      const key = JSON.stringify(look || null)
      if (key === lookKey) return
      lookKey = key
      marp.themeSet.default = marp.themeSet.add(themeCss(look))
    },
    // { slides: each slide's drawing (an <svg>), css, notes: each slide's speaker notes, maps, theme }.
    render(md, ghosts = []) {
      const list = [...ghosts].sort((a, b) => a.at - b.at)
      const lines = String(md).split('\n')
      let shown = lines
      if (list.length) {
        shown = []
        let from = 0
        for (const g of list) { shown.push(...lines.slice(from, g.at), ...g.lines); from = g.at }
        shown.push(...lines.slice(from))
      }
      const sdAt = (d) => {
        let shift = 0
        for (const g of list) {
          const s = g.at + shift
          if (d < s) break
          if (d < s + g.lines.length) return { ghost: g }
          shift += g.lines.length
        }
        return { line: d - shift }
      }
      const env = { htmlAsArray: true, sdAt }
      let out
      try { out = marp.render(shown.join('\n'), env) } catch (e) { return { slides: [], css: '', notes: [], maps: [], error: e.message } }
      return { slides: out.html, css: out.css, notes: out.comments || [], maps: env.sdSlides || [], theme: marp.lastGlobalDirectives?.theme || null }
    },
  }
}

// ---------- The deck's parts ----------
const FRONT = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
export const frontOf = (md) => FRONT.exec(md)?.[1] ?? null
// A front matter value (theme, pack, title), unquoted.
export function frontValue(md, key) {
  const v = frontOf(md)?.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, 'm'))?.[1]
  return v ? v.replace(/^(["'])(.*)\1$/, '$2') : null
}
// The deck with key set to value in its front matter, or taken out (null).
export function withFront(md, key, value) {
  const line = value != null && value !== '' ? `${key}: ${/[:#'"]|^\s|\s$/.test(value) ? JSON.stringify(value) : value}` : null
  const m = FRONT.exec(md)
  if (!m) return line ? `---\n${line}\n---\n\n${md}` : md
  const re = new RegExp(`^${key}:`)
  const lines = m[1].split(/\r?\n/).filter((l) => !re.test(l))
  if (line) lines.push(line)
  return `---\n${lines.join('\n')}\n---\n${md.slice(m[0].length)}`
}

// A deck's own colours in its front matter (background, textColor, accent: a PowerPoint saved as
// a Markdown deck keeps its own so), as Studio's look, its fonts Paper's; null when it has none.
// Studio's own keys, not Marp's backgroundColor and color, which would paint over a section
// slide's accent.
export const FRONT_COLORS = { background: 'background', text: 'textColor', accent: 'accent' }
export function frontLook(md) {
  const colors = {}
  for (const [k, key] of Object.entries(FRONT_COLORS)) { const v = frontValue(md, key); if (/^#[0-9a-f]{6}$/i.test(v || '')) colors[k] = v.toLowerCase() }
  return Object.keys(colors).length ? { ...PLAIN, id: 'own', builtIn: false, colors: { ...PLAIN.colors, ...colors } } : null
}

// Where each slide is in the deck's lines, from where Marp starts them (render().maps): { lines,
// front: the line after the front matter, slides: [{ start, end, sep }] }, sep the line of the
// --- before it.
export function structure(md, maps) {
  const lines = String(md).split('\n')
  const fm = FRONT.exec(md)
  const front = fm ? fm[0].replace(/\r?\n$/, '').split('\n').length : 0
  const slides = (maps.length ? maps : [null]).map((m, i) => {
    if (i === 0) return { start: front, sep: null }
    const hr = m && HR.test(lines[m[0]] || '')
    return { start: hr ? m[1] : m ? m[0] : lines.length, sep: hr ? m[0] : null }
  })
  slides.forEach((s, i) => { s.end = i + 1 < slides.length ? (slides[i + 1].sep ?? slides[i + 1].start) : lines.length })
  return { lines, front, slides }
}
const trimBlank = (ls) => { let a = 0, b = ls.length; while (a < b && !ls[a].trim()) a++; while (b > a && !ls[b - 1].trim()) b--; return ls.slice(a, b) }
export const slideText = (st, i) => trimBlank(st.lines.slice(st.slides[i].start, st.slides[i].end)).join('\n')
// The deck put back together from its front matter and its slides' Markdown.
function compose(st, texts) {
  const head = st.lines.slice(0, st.front).join('\n')
  const body = texts.map((x) => x.replace(/^\s*\n|\n\s*$/g, '')).join('\n\n---\n\n')
  return `${head ? `${head}\n\n` : ''}${body}\n`
}
const all = (st) => st.slides.map((_, i) => slideText(st, i))
// Every slide's Markdown, and the deck put back together from them (some taken out, copied in).
export const slideTexts = all
export const withSlideTexts = (st, texts) => compose(st, texts.length ? texts : [''])
export const moveSlide = (st, from, to) => { const t = all(st); const [x] = t.splice(from, 1); t.splice(to, 0, x); return compose(st, t) }
export const insertSlides = (st, after, texts) => { const t = all(st); t.splice(after + 1, 0, ...texts); return compose(st, t) }
export const removeSlide = (st, i) => { const t = all(st); t.splice(i, 1); return compose(st, t.length ? t : ['']) }
export const duplicateSlide = (st, i) => insertSlides(st, i, [slideText(st, i)])
export const replaceSlide = (st, i, texts) => { const t = all(st); t.splice(i, 1, ...[].concat(texts)); return compose(st, t) }

// ---------- One slide ----------
const CLASS_LINE = /^\s*<!--\s*_?class:\s*(.*?)\s*-->\s*$/
const COMMENT = /<!--([\s\S]*?)-->/g
// A comment that's a Marp directive (<!-- _class: x -->, <!-- paginate: false -->), not a note.
const DIRECTIVE = /^\s*_?(class|paginate|header|footer|backgroundColor|backgroundImage|backgroundPosition|backgroundRepeat|backgroundSize|color|theme|style|size|headingDivider|math|marp|lang|title|description|author|image|url|transition|fit)\s*:/
const BG = /^\s*!\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)\s*$/
export const isBg = (alt) => /(^|\s)bg(\s|$)/.test(alt)

// Its layout: the first class Studio knows in its class directive, else content.
export function layoutOf(text) {
  for (const l of String(text).split('\n')) {
    const m = CLASS_LINE.exec(l)
    if (m) return m[1].split(/\s+/).find((c) => LAYOUT_CLASS.has(c)) || (/\blead\b/.test(m[1]) ? 'title' : 'content')
  }
  return 'content'
}
// The slide with its layout set: its class directive changed (other classes it has are kept), and a
// picture moved to where the layout has it.
export function withLayout(text, id) {
  const lines = String(text).split('\n')
  let classes = []
  const i = lines.findIndex((l) => CLASS_LINE.test(l))
  if (i >= 0) { classes = CLASS_LINE.exec(lines[i])[1].split(/\s+/).filter((c) => c && !LAYOUT_CLASS.has(c) && c !== 'lead'); lines.splice(i, 1) }
  if (id !== 'content') classes.unshift(id)
  const out = trimBlank(lines)
  // A picture: on the right for text and picture, the whole slide for full picture.
  for (let j = 0; j < out.length; j++) {
    const m = BG.exec(out[j])
    if (!m) continue
    const bg = isBg(m[1])
    if (id === 'image') out[j] = `![bg right:42%](${m[2]})`
    else if (id === 'picture') out[j] = `![bg](${m[2]})`
    else if (bg && /right|left/.test(m[1]) && !['content', 'cols', 'stats'].includes(id)) out[j] = `![bg](${m[2]})`
    break
  }
  return [...(classes.length ? [`<!-- _class: ${classes.join(' ')} -->`, ''] : []), ...out].join('\n')
}
// Its speaker notes: the comments on it that aren't directives.
export function notesOf(text) {
  return [...String(text).matchAll(COMMENT)].map((m) => m[1].trim()).filter((x) => x && !DIRECTIVE.test(x)).join('\n\n')
}
export function withNotes(text, notes) {
  const kept = String(text).replace(COMMENT, (m, body) => (body.trim() && DIRECTIVE.test(body.trim()) ? m : '')).split('\n')
  const lines = trimBlank(kept.filter((l, i) => l.trim() || (kept[i - 1] || '').trim()))
  const n = String(notes || '').trim().replace(/--+>/g, '—>')
  return [...lines, ...(n ? ['', `<!-- ${n} -->`] : [])].join('\n')
}
// Skipped when presenting, as PowerPoint and Google Slides skip a hidden slide: a class of skip on
// it (<!-- _class: skip -->), which Marp's own tools draw as any other slide and never take for a
// note.
export const isSkipped = (text) => String(text).split('\n').some((l) => { const m = CLASS_LINE.exec(l); return m && m[1].split(/\s+/).includes('skip') })
export function withSkip(text, on) {
  const lines = String(text).split('\n')
  const i = lines.findIndex((l) => CLASS_LINE.test(l))
  const classes = i >= 0 ? CLASS_LINE.exec(lines[i])[1].split(/\s+/).filter((c) => c && c !== 'skip') : []
  if (on) classes.push('skip')
  if (i >= 0) { if (classes.length) lines[i] = `<!-- _class: ${classes.join(' ')} -->`; else lines.splice(i, 1) }
  else if (on) lines.unshift(`<!-- _class: ${classes.join(' ')} -->`, '')
  return trimBlank(lines).join('\n')
}
// The picture on it: { line (within the slide), src, alt, bg }.
export function pictureOf(text) {
  const lines = String(text).split('\n')
  for (let i = 0; i < lines.length; i++) { const m = BG.exec(lines[i]); if (m) return { line: i, alt: m[1], src: m[2], bg: isBg(m[1]) } }
  return null
}
// The slide with a picture (src) where its layout puts one, or its picture changed; one with no
// picture yet becomes text and picture (a title, a section and a quote: full picture).
export function withPicture(text, src) {
  const p = pictureOf(text)
  const lines = String(text).split('\n')
  if (p) { lines[p.line] = lines[p.line].replace(/\]\([^)\s]*/, `](${src}`); return lines.join('\n') }
  const layout = layoutOf(text)
  const id = ['title', 'section', 'quote', 'picture', 'blank'].includes(layout) ? 'picture' : 'image'
  return withLayout(`${trimBlank(lines).join('\n')}\n\n![bg](${src})`, id)
}
export function withoutPicture(text) {
  const p = pictureOf(text)
  if (!p) return text
  const lines = String(text).split('\n')
  lines.splice(p.line, 1)
  const out = trimBlank(lines).join('\n')
  return ['image', 'picture'].includes(layoutOf(out)) ? withLayout(out, layoutOf(out) === 'picture' ? 'title' : 'content') : out
}

// What the slide has, by its lines (absolute, in the deck): its first heading, the line after its
// title, where its words start, whether it has words besides its headings, and a quote.
function partsOf(st, i) {
  const s = st.slides[i]
  let fence = false, comment = false
  const p = { first: null, title: null, afterTitle: null, second: null, body: false, quote: false, last: s.start }
  for (let n = s.start; n < s.end; n++) {
    const l = st.lines[n]
    if (comment) { if (/-->/.test(l)) comment = false; continue }
    if (/^\s*<!--/.test(l)) { if (!/-->/.test(l)) comment = true; continue }
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    if (!l.trim()) continue
    if (!fence && BG.test(l) && isBg(BG.exec(l)[1])) continue
    if (p.first == null) p.first = n
    p.last = n + 1
    const h = !fence && /^ {0,3}#{1,6}(\s|$)/.test(l)
    const setext = !fence && n + 1 < s.end && /^ {0,3}(=+|-+)\s*$/.test(st.lines[n + 1]) && !/^\s*([-*+>]|\d+[.)])\s/.test(l)
    if ((h || setext) && p.title == null) { p.title = n; p.afterTitle = n + (setext ? 2 : 1); if (setext) n++; continue }
    if ((h || setext) && p.second == null) { p.second = n; if (setext) n++; continue }
    if (/^\s*>/.test(l)) p.quote = true
    p.body = true
  }
  return p
}
// What an empty part of the current slide shows, by its layout: [{ at, lines, ph }], at the deck's
// line where it would go. words: { title, subtitle, text, quote }.
export function ghostsOf(st, i, words) {
  const s = st.slides[i]
  if (!s) return []
  const layout = layoutOf(slideText(st, i))
  const p = partsOf(st, i)
  // Where a slide's words start: after its directives and comments at the top.
  let top = s.start
  while (top < s.end && (!st.lines[top].trim() || /^\s*<!--.*-->\s*$/.test(st.lines[top]))) top++
  if (p.first != null) top = Math.min(top, p.first)
  const g = (at, ph, line) => ({ at, ph, lines: ['', line, ''] })
  if (layout === 'blank') return []
  if (layout === 'quote') return p.quote ? [] : [g(top, 'quote', `> ${words.quote}`)]
  const out = []
  if (p.title == null) out.push(g(top, 'title', `# ${words.title}`))
  const after = p.title == null ? top : p.afterTitle
  if (layout === 'title' && p.second == null && !p.body) out.push(g(after, 'subtitle', `## ${words.subtitle}`))
  if (['content', 'cols', 'stats', 'image'].includes(layout) && !p.body) out.push(g(p.title == null ? top : after, 'text', layout === 'stats' ? `- **0** ${words.text}` : `- ${words.text}`))
  // Two at one place: one after the other.
  return out.map((x, j) => ({ ...x, order: j }))
}
// What a click on an empty part puts there to type in.
export const GHOST_START = { title: '# ', subtitle: '## ', text: '- ', quote: '> ' }

// ---------- Text typed on a slide ----------
// The start of a line that isn't its words: indent, quote marks, a list marker, a heading's #s.
const PREFIX = /^(\s*(?:>\s?)*\s*(?:(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)(?:\[[ xX]\][ \t]+)?)?(?:#{1,6}(?:[ \t]+|$))?)/
export const prefixOf = (line) => PREFIX.exec(line)?.[1] || ''
// Words that would read as Markdown of their own, kept as typed.
const escapeText = (s) => s.replace(/\\/g, '\\\\').replace(/([*`])/g, '\\$1').replace(/(^|[^\w])_|_(?=[^\w]|$)/g, (m) => m.replace('_', '\\_'))
const escapeStart = (s) => s.replace(/^(#{1,6}\s|>|[-+*]\s|\d+[.)]\s)/, '\\$1')
// A block on the slide as Markdown: its words, bold, italic, struck, code and links.
export function inlineMd(node) {
  let s = ''
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { s += escapeText(n.nodeValue.replace(/\u00a0/g, ' ')); continue }
    if (n.nodeType !== 1) continue
    const tag = n.localName
    if (tag === 'br') { s += '\n'; continue }
    if (tag === 'svg' || tag === 'img') continue
    const inner = inlineMd(n)
    const wrap = (m) => (inner.trim() ? `${m}${inner}${m}` : inner)
    if (tag === 'strong' || tag === 'b') s += wrap('**')
    else if (tag === 'em' || tag === 'i') s += wrap('*')
    else if (tag === 's' || tag === 'del' || tag === 'strike') s += wrap('~~')
    else if (tag === 'code') s += `\`${n.textContent}\``
    else if (tag === 'a') s += `[${inner}](${n.getAttribute('href') || ''})`
    else if (tag === 'div' || tag === 'p') s += `${s && !s.endsWith('\n') ? '\n' : ''}${inner}`
    else s += inner
  }
  return s
}
// The deck with lines [a, b) (a block's) holding text instead, keeping what starts them (# , - ,
// > ). A heading stays one line; a setext heading keeps its underline.
export function withText(md, a, b, text) {
  const lines = String(md).split('\n')
  const pre = prefixOf(lines[a] ?? '')
  const words = String(text).replace(/\n+$/, '')
  if (b - a >= 2 && /^ {0,3}(=+|-+)\s*$/.test(lines[b - 1])) {
    lines.splice(a, b - a - 1, `${pre}${escapeStart(words.replace(/\n/g, ' '))}`)
    return lines.join('\n')
  }
  const heading = /#{1,6}[ \t]*$/.test(pre)
  // A line after the first: under the first's words (in the quote, the list item).
  const cont = pre.replace(/[^>\s]/g, ' ')
  const parts = heading ? [words.replace(/\n/g, ' ')] : words.split('\n')
  lines.splice(a, b - a, ...parts.map((x, j) => (j ? `${cont}${x}` : `${pre}${escapeStart(x)}`)))
  return lines.join('\n')
}
// The deck with lines inserted before line at, or line n taken out (with a blank line it leaves
// doubled).
export function insertLines(md, at, add) { const lines = String(md).split('\n'); lines.splice(at, 0, ...add); return lines.join('\n') }
// A block of its own (a line with a blank line each side, not two) put in before line at: the deck,
// and the line it's on.
export function insertBlock(md, at, line) {
  const lines = String(md).split('\n')
  const before = at > 0 && lines[at - 1].trim() ? [''] : []
  const after = at < lines.length && lines[at].trim() ? [''] : []
  lines.splice(at, 0, ...before, line, ...after)
  return { md: lines.join('\n'), ln: at + before.length }
}
export function removeLine(md, n) {
  const lines = String(md).split('\n')
  lines.splice(n, 1)
  if (n > 0 && n < lines.length && !lines[n - 1].trim() && !lines[n].trim()) lines.splice(n, 1)
  return lines.join('\n')
}
// A list item's line moved in a level, under the item before it (Tab), or out to its parent's
// (⇧Tab). The same deck when it can't go further.
const ITEM = /^(\s*)((?:[-*+]|\d{1,9}[.)])[ \t]+)/
export function indentLine(md, n, out = false) {
  const lines = String(md).split('\n')
  const me = ITEM.exec(lines[n] ?? '')
  if (!me) return md
  const mine = me[1].length
  for (let j = n - 1; j >= 0; j--) {
    const it = ITEM.exec(lines[j])
    if (!it) { if (!lines[j].trim() || /^\s/.test(lines[j])) continue; break }
    const theirs = it[1].length
    if (!out && theirs === mine) { lines[n] = `${' '.repeat(theirs + it[2].length)}${lines[n].trimStart()}`; return lines.join('\n') }
    if (!out && theirs < mine) return md
    if (out && theirs < mine) { lines[n] = `${' '.repeat(theirs)}${lines[n].trimStart()}`; return lines.join('\n') }
  }
  return md
}

// A line made a bulleted point (bullet), a numbered one (number), or back to a paragraph (null).
export function withListKind(md, n, kind) {
  const lines = String(md).split('\n')
  const l = lines[n]
  if (l == null || /^\s*#{1,6}\s/.test(l) || /^\s*>/.test(l)) return md
  const m = ITEM.exec(l)
  const words = m ? l.slice(m[0].length) : l.replace(/^\s+/, '')
  const indent = m ? m[1] : ''
  lines[n] = kind === 'bullet' ? `${indent}- ${words}` : kind === 'number' ? `${indent}1. ${words}` : words
  return lines.join('\n')
}
export const listKindOf = (line) => { const m = ITEM.exec(line || ''); return !m ? null : /\d/.test(m[2]) ? 'number' : 'bullet' }
// Where q is in a deck's slides (not its front matter): [{ si, line, start, end }].
export function findInDeck(st, q, { matchCase = false } = {}) {
  const out = []
  if (!q) return out
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi')
  st.slides.forEach((s, si) => {
    for (let n = s.start; n < s.end; n++) {
      const l = st.lines[n]
      if (/^\s*<!--.*-->\s*$/.test(l)) continue
      re.lastIndex = 0
      let m
      while ((m = re.exec(l))) { out.push({ si, line: n, start: m.index, end: m.index + m[0].length }); if (!m[0].length) re.lastIndex++ }
    }
  })
  return out
}
// One found stretch replaced (its line's own place), or every one in the slides.
export function replaceInDeck(md, m, to) { const lines = String(md).split('\n'); const l = lines[m.line]; lines[m.line] = l.slice(0, m.start) + to + l.slice(m.end); return lines.join('\n') }

// ---------- A deck to start from ----------
// A title slide with its title; "Click to add subtitle" shows where the subtitle goes.
export const blankDeck = (title = 'New deck') => `---\nmarp: true\ntitle: ${/[:#'"]/.test(title) ? JSON.stringify(title) : title}\npaginate: true\n---\n\n<!-- _class: title -->\n\n# ${title}\n`
