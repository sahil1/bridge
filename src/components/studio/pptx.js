// Decks to PowerPoint and back. A Markdown deck's slides become PowerPoint slides on layouts of
// their own (Title, Title and Text, Section, Two Columns, Big Numbers, Text and Picture, Full
// Picture, Quote, Blank), their titles and text in the layouts' placeholders, so PowerPoint and
// Keynote see a title as a title and a list as a list (PptxGenJS, MIT). The deck's look goes in as
// the file's theme too: its colours and fonts. A PowerPoint comes back as a Markdown deck: each
// slide's title, text, lists, pictures, tables and speaker notes, on the layout it was on, in its
// theme's colours and fonts. Nothing here needs a page, so the tests use it as it is.
import { deckRenderer, colorsOf, isBg, W, H, PLAIN, LAYOUTS } from './deck.js'

export { blankDeck } from './deck.js'

// Each layout's placeholders, in the order they're made (and read back).
const PH_KEYS = { title: ['title', 'subtitle'], content: ['title', 'body'], section: ['title', 'subtitle'], cols: ['title', 'body', 'body2'], stats: ['title'], image: ['title', 'body'], picture: ['title', 'subtitle'], quote: ['body', 'subtitle'], blank: [] }
// What PowerPoint calls each layout (and what it's read back as).
export const LAYOUT_NAMES = { title: 'Title', content: 'Title and Text', section: 'Section', cols: 'Two Columns', stats: 'Big Numbers', image: 'Text and Picture', picture: 'Full Picture', quote: 'Quote', blank: 'Blank' }

// ---------- A Markdown deck's slides ----------
// [{ layout, title, subtitle, blocks, pictures: [{ src, side }], notes, number }], each block a
// heading ({ h, runs }), list ({ items: [{ runs, level, ordered }] }), paragraph ({ p, runs }),
// quote ({ quote, runs }), table ({ rows }) or code ({ code }); runs [{ text, bold, italic,
// strike, code, link, br }].
export function slidesOf(md) {
  const r = deckRenderer()
  const out = r.render(md)
  const tokens = r.marp.lastSlideTokens || []
  const paginate = /^paginate:\s*true\s*$/m.test(/^---\s*\n([\s\S]*?)\n---/.exec(md)?.[1] || '')
  return tokens.map((ts, i) => slideFrom(ts, out.notes[i] || [], paginate))
}
function runsOf(inline) {
  const runs = []
  const on = { bold: 0, italic: 0, strike: 0 }
  let link = null
  for (const c of inline?.children || []) {
    if (c.type === 'text' && !c.content) continue
    if (c.type === 'text') runs.push({ text: c.content, bold: !!on.bold, italic: !!on.italic, strike: !!on.strike, ...(link ? { link } : {}) })
    else if (c.type === 'code_inline') runs.push({ text: c.content, code: true, bold: !!on.bold })
    else if (c.type === 'softbreak' || c.type === 'hardbreak') runs.push({ text: '', br: true })
    else if (c.type === 'strong_open') on.bold++
    else if (c.type === 'strong_close') on.bold--
    else if (c.type === 'em_open') on.italic++
    else if (c.type === 'em_close') on.italic--
    else if (c.type === 's_open') on.strike++
    else if (c.type === 's_close') on.strike--
    else if (c.type === 'link_open') link = c.attrGet('href')
    else if (c.type === 'link_close') link = null
  }
  // Leading and trailing breaks are nothing to show.
  while (runs[0]?.br) runs.shift()
  while (runs.at(-1)?.br) runs.pop()
  return runs
}
export const plain = (runs) => (runs || []).map((x) => (x.br ? '\n' : x.text)).join('')
function slideFrom(ts, notes, paginate) {
  const open = ts.find((t) => t.type === 'marpit_slide_open')
  const classes = String(open?.meta?.marpitDirectives?.class || '').split(/\s+/)
  const layout = classes.find((c) => LAYOUTS.includes(c)) || (classes.includes('lead') ? 'title' : 'content')
  const blocks = [], pictures = []
  const lists = []
  let quote = 0
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') lists.push(t.type === 'ordered_list_open')
    else if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') lists.pop()
    else if (t.type === 'blockquote_open') quote++
    else if (t.type === 'blockquote_close') quote--
    else if (t.type === 'heading_open') blocks.push({ h: Number(t.tag.slice(1)), runs: runsOf(ts[i + 1]) })
    else if (t.type === 'fence' || t.type === 'code_block') blocks.push({ code: t.content.replace(/\n$/, '') })
    else if (t.type === 'paragraph_open') {
      const inline = ts[i + 1]
      for (const c of inline?.children || []) if (c.type === 'image') pictures.push({ src: c.attrGet('src'), ...sideOf(c.content) })
      const runs = runsOf({ children: (inline?.children || []).filter((c) => c.type !== 'image') })
      if (!plain(runs).trim()) continue
      if (lists.length) {
        const item = { runs, level: lists.length - 1, ordered: lists.at(-1) }
        const last = blocks.at(-1)
        if (last?.items) last.items.push(item); else blocks.push({ items: [item] })
      } else blocks.push(quote ? { quote: true, runs } : { p: true, runs })
    } else if (t.type === 'list_item_open' && ts[i + 1]?.type !== 'paragraph_open') {
      const last = blocks.at(-1)
      const item = { runs: [], level: lists.length - 1, ordered: lists.at(-1) }
      if (last?.items) last.items.push(item); else blocks.push({ items: [item] })
    } else if (t.type === 'table_open') {
      const rows = []
      for (let j = i + 1; j < ts.length && ts[j].type !== 'table_close'; j++) {
        if (ts[j].type === 'tr_open') rows.push([])
        if (ts[j].type === 'inline' && rows.length) rows.at(-1).push(runsOf(ts[j]))
      }
      blocks.push({ rows })
    }
  }
  // A list that breaks off for something else and starts again is two blocks; one after another
  // with nothing between is one list.
  const headings = blocks.filter((b) => b.h)
  const titleBlock = headings[0] && blocks.indexOf(headings[0]) <= 1 ? headings[0] : null
  const rest = blocks.filter((b) => b !== titleBlock)
  let subtitle = null
  const next = rest[0]
  if (titleBlock && next && ((next.h && next.h === titleBlock.h + 1) || (next.p && ['title', 'section', 'picture'].includes(layout)))) { subtitle = next.runs; rest.shift() }
  return { layout, title: titleBlock?.runs || null, subtitle, blocks: rest, pictures, notes: notes.join('\n\n'), number: paginate, hidden: classes.includes('skip') }
}
const sideOf = (alt) => (isBg(alt) ? { bg: true, side: /\bright\b/.test(alt) ? 'right' : /\bleft\b/.test(alt) ? 'left' : 'full' } : { bg: false, side: 'inline' })

// ---------- To PowerPoint ----------
const IN = (px) => +(px / 96).toFixed(3) // 1280 px is 13.333 in, PowerPoint's own 16:9
const PT = (px) => Math.round(px * 0.75 * 2) / 2
const hex = (c) => String(c).replace('#', '').toUpperCase()
const MARGIN = 88
// A run as PptxGenJS has it.
const runOpts = (x, base) => ({ ...base, ...(x.bold ? { bold: true } : {}), ...(x.italic ? { italic: true } : {}), ...(x.strike ? { strike: 'sngStrike' } : {}), ...(x.code ? { fontFace: 'Menlo' } : {}), ...(x.link ? { hyperlink: { url: x.link } } : {}) })
function para(runs, base, last) {
  const out = []
  const list = runs.length ? runs : [{ text: '' }]
  let soft = false
  list.forEach((x, i) => {
    if (x.br) { soft = true; return }
    out.push({ text: x.text, options: { ...runOpts(x, base), ...(soft && out.length ? { softBreakBefore: true } : {}) } })
    soft = false
    if (i === list.length - 1) out.at(-1).options.breakLine = !last
  })
  if (!out.length) out.push({ text: '', options: { ...base, breakLine: !last } })
  return out
}
// The text of a slide's blocks, as paragraphs in one box: lists with their bullets and levels,
// headings in bold, quotes in italics.
function bodyRuns(blocks, c, fonts, size) {
  const out = []
  const all = blocks.flatMap((b) => (b.items ? b.items.map((it) => ({ item: it })) : [b]))
  all.forEach((b, i) => {
    const last = i === all.length - 1
    const base = { fontFace: fonts.body, fontSize: PT(size), color: hex(c.fg), paraSpaceAfter: 6 }
    if (b.item) out.push(...para(b.item.runs, { ...base, bullet: b.item.ordered ? { type: 'number' } : { indent: 22 }, indentLevel: b.item.level, ...(b.item.level ? { fontSize: PT(size * 0.86) } : {}) }, last))
    else if (b.h) out.push(...para(b.runs, { ...base, bold: true, fontFace: fonts.heading, fontSize: PT(b.h <= 2 ? size * 1.05 : size * 0.93), color: hex(b.h <= 2 ? c.accent : c.fg) }, last))
    else if (b.quote) out.push(...para(b.runs, { ...base, italic: true }, last))
    else if (b.code) out.push(...para([{ text: b.code, code: true }], { ...base, fontSize: PT(20) }, last))
    else if (b.rows) out.push(...para([{ text: b.rows.map((r) => r.map(plain).join('  ·  ')).join('\n') }], base, last))
    else out.push(...para(b.runs, base, last))
  })
  return out
}

// A picture's height over its width, from the start of its data URL (PNG, JPEG, GIF, WebP, SVG),
// so it's cropped to fill its place rather than stretched; null when it can't be told.
export function ratioOf(data) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(String(data || ''))
  if (!m) return null
  let b
  try { b = m[2] ? atob(m[3].slice(0, 87_380).replace(/[^A-Za-z0-9+/=]/g, '').replace(/=+$/, '').slice(0, 87_380 - (87_380 % 4))) : decodeURIComponent(m[3].slice(0, 4000)) } catch { return null }
  const u8 = (i) => b.charCodeAt(i) & 255
  const be16 = (i) => (u8(i) << 8) | u8(i + 1)
  const le16 = (i) => u8(i) | (u8(i + 1) << 8)
  const be32 = (i) => ((u8(i) << 24) >>> 0) + (u8(i + 1) << 16) + (u8(i + 2) << 8) + u8(i + 3)
  let w = 0, h = 0
  if (b.startsWith('\x89PNG')) { w = be32(16); h = be32(20) } else if (b.startsWith('GIF8')) { w = le16(6); h = le16(8) } else if (u8(0) === 0xff && u8(1) === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (u8(i) !== 0xff) { i++; continue }
      const mk = u8(i + 1)
      if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) { h = be16(i + 5); w = be16(i + 7); break }
      i += 2 + be16(i + 2)
    }
  } else if (b.startsWith('RIFF') && b.slice(8, 12) === 'WEBP') {
    const kind = b.slice(12, 16)
    if (kind === 'VP8X') { w = 1 + u8(24) + (u8(25) << 8) + (u8(26) << 16); h = 1 + u8(27) + (u8(28) << 8) + (u8(29) << 16) } else if (kind === 'VP8 ') { w = le16(26) & 0x3fff; h = le16(28) & 0x3fff } else if (kind === 'VP8L') { const x = u8(21) | (u8(22) << 8) | (u8(23) << 16) | (u8(24) << 24); w = 1 + (x & 0x3fff); h = 1 + ((x >> 14) & 0x3fff) }
  } else if (/<svg/i.test(b)) {
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(b)
    if (vb) { w = +vb[1]; h = +vb[2] } else { w = +(/\bwidth\s*=\s*["']([\d.]+)/i.exec(b)?.[1] || 0); h = +(/\bheight\s*=\s*["']([\d.]+)/i.exec(b)?.[1] || 0) }
  }
  return w > 0 && h > 0 ? h / w : null
}
// A picture filling a box (cover), or as big as fits in it (contain), in its own proportions.
const placed = (data, x, y, w, h, type = 'cover') => {
  const r = ratioOf(data)
  return { data, x: IN(x), y: IN(y), w: IN(w), h: IN(r ? w * r : h), sizing: { type, w: IN(w), h: IN(h) } }
}

// The deck as a PowerPoint file's bytes. look: its design pack (colours, fonts, logo). image(src):
// a picture's data URL (pictures it can't get are left out).
export async function pptxOf(slides, look = null, { image = async () => null, title = '' } = {}) {
  const PptxGenJS = (await import('pptxgenjs')).default
  const p = new PptxGenJS()
  p.layout = 'LAYOUT_WIDE'
  p.author = ''
  p.company = ''
  if (title) p.title = title
  const c = colorsOf(look || PLAIN)
  const fonts = { heading: look?.fonts?.heading || PLAIN.fonts.heading, body: look?.fonts?.body || PLAIN.fonts.body }
  const titleBox = (x, y, w, h, o = {}) => ({ name: 'title', type: 'title', x: IN(x), y: IN(y), w: IN(w), h: IN(h), fontFace: fonts.heading, bold: true, color: hex(c.fg), valign: 'top', align: 'left', ...o })
  const bodyBox = (name, x, y, w, h, o = {}) => ({ name, type: 'body', x: IN(x), y: IN(y), w: IN(w), h: IN(h), fontFace: fonts.body, fontSize: PT(30), color: hex(c.fg), valign: 'top', align: 'left', ...o })
  const geo = {
    title: { title: titleBox(120, 270, 1040, 176, { fontSize: PT(78), valign: 'bottom' }), subtitle: bodyBox('subtitle', 120, 462, 1040, 96, { fontSize: PT(32), color: hex(c.muted) }) },
    content: { title: titleBox(MARGIN, 82, W - 2 * MARGIN, 80, { fontSize: PT(54) }), body: bodyBox('body', MARGIN, 186, W - 2 * MARGIN, 460) },
    section: { title: titleBox(120, 232, 1040, 170, { fontSize: PT(70), color: hex(c.onAccent), valign: 'bottom' }), subtitle: bodyBox('subtitle', 120, 414, 1040, 90, { fontSize: PT(32), color: hex(c.onAccent) }) },
    cols: { title: titleBox(MARGIN, 82, W - 2 * MARGIN, 80, { fontSize: PT(54) }), body: bodyBox('body', MARGIN, 186, 516, 460), body2: bodyBox('body2', MARGIN + 516 + 72, 186, 516, 460) },
    stats: { title: titleBox(MARGIN, 82, W - 2 * MARGIN, 80, { fontSize: PT(54) }) },
    image: { title: titleBox(MARGIN, 82, W * 0.58 - MARGIN - 40, 120, { fontSize: PT(48) }), body: bodyBox('body', MARGIN, 210, W * 0.58 - MARGIN - 40, 440) },
    picture: { title: titleBox(MARGIN, 468, W - 2 * MARGIN, 110, { fontSize: PT(64), color: 'FFFFFF', valign: 'bottom' }), subtitle: bodyBox('subtitle', MARGIN, 584, W - 2 * MARGIN, 60, { fontSize: PT(30), color: 'FFFFFF' }) },
    quote: { body: bodyBox('body', 150, 250, 980, 250, { fontFace: fonts.heading, fontSize: PT(46), bold: true }), subtitle: bodyBox('subtitle', 150, 520, 980, 60, { fontSize: PT(26), color: hex(c.muted) }) },
    blank: {},
  }
  const used = new Set(slides.map((s) => s.layout))
  for (const id of LAYOUTS) {
    if (!used.has(id)) continue
    const g = geo[id]
    p.defineSlideMaster({
      title: LAYOUT_NAMES[id],
      background: { color: hex(id === 'section' ? c.accent : c.bg) },
      objects: PH_KEYS[id].map((k) => ({ placeholder: { options: g[k], text: '' } })),
      ...(slides.some((s) => s.number) ? { slideNumber: { x: IN(W - MARGIN - 80), y: IN(H - 48), w: IN(80), h: IN(24), fontFace: fonts.body, fontSize: PT(16), color: hex(id === 'section' ? c.onAccent : id === 'picture' ? 'FFFFFF' : c.muted), align: 'right' } } : {}),
    })
  }
  const pictureData = async (src) => { try { return src ? await image(src) : null } catch { return null } }
  for (const s of slides) {
    const g = geo[s.layout] || geo.content
    const slide = p.addSlide({ masterName: LAYOUT_NAMES[s.layout] || LAYOUT_NAMES.content })
    const pic = s.pictures.find((x) => x.bg) || s.pictures[0]
    const data = pic ? await pictureData(pic.src) : null
    // What's drawn behind: a picture, the title slide's circle, the accent bar over a title.
    if (s.layout === 'picture' || (pic?.bg && pic.side === 'full')) {
      if (data) slide.addImage(placed(data, 0, 0, W, H))
      if (s.layout === 'picture') slide.addShape(p.ShapeType.rect, { x: 0, y: IN(H * 0.45), w: IN(W), h: IN(H * 0.55), fill: { color: '000000', transparency: 45 }, line: { type: 'none' } })
    }
    if (s.layout === 'title') {
      slide.addShape(p.ShapeType.ellipse, { x: IN(W - 330), y: IN(-330), w: IN(660), h: IN(660), fill: { color: hex(c.tint) }, line: { type: 'none' } })
      slide.addShape(p.ShapeType.roundRect, { x: IN(120), y: IN(240), w: IN(64), h: IN(8), rectRadius: 0.04, fill: { color: hex(c.accent) }, line: { type: 'none' } })
    } else if (!['picture', 'quote', 'blank'].includes(s.layout)) {
      slide.addShape(p.ShapeType.roundRect, { x: IN(MARGIN), y: IN(50), w: IN(44), h: IN(6), rectRadius: 0.03, fill: { color: hex(s.layout === 'section' ? c.onAccent : c.accent) }, line: { type: 'none' } })
    }
    const side = s.layout === 'image' || (pic && !pic.bg && s.layout === 'content') || (pic?.bg && pic.side !== 'full')
    if (side && data) {
      const x = pic?.side === 'left' ? 0 : W * 0.58
      slide.addImage(placed(data, x, 0, W * 0.42, H))
    }
    const narrow = side && data && s.layout !== 'image'
    if (s.title) slide.addText(para(s.title, { fontFace: fonts.heading, bold: true }, true), { placeholder: 'title', ...(narrow ? { w: IN(W * 0.58 - MARGIN - 40) } : {}) })
    if (s.subtitle && g.subtitle) slide.addText(para(s.subtitle, { fontFace: fonts.body }, true), { placeholder: 'subtitle' })
    const blocks = s.subtitle && !g.subtitle ? [{ h: 2, runs: s.subtitle }, ...s.blocks] : s.blocks
    if (s.layout === 'quote') {
      const q = blocks.filter((b) => b.quote)
      const who = blocks.filter((b) => !b.quote)
      slide.addText('“', { x: IN(140), y: IN(120), w: IN(200), h: IN(130), fontFace: 'Georgia', fontSize: PT(150), bold: true, color: hex(c.accent), valign: 'top' })
      if (q.length) slide.addText(q.flatMap((b, i) => para(b.runs, { fontFace: fonts.heading, bold: true }, i === q.length - 1)), { placeholder: 'body' })
      if (who.length) slide.addText(who.flatMap((b, i) => para(b.runs || [{ text: plain(b.items?.[0]?.runs) }], {}, i === who.length - 1)), { placeholder: 'subtitle' })
    } else if (s.layout === 'stats') {
      const items = blocks.flatMap((b) => b.items || [])
      const n = Math.max(1, Math.min(4, items.length)), gap = 26, w = (W - 2 * MARGIN - gap * (n - 1)) / n
      items.slice(0, 8).forEach((it, i) => {
        const row = Math.floor(i / 4), col = i % 4
        const big = it.runs[0]?.bold ? it.runs[0].text : ''
        const words = (big ? it.runs.slice(1) : it.runs)
        slide.addText([
          { text: big || ' ', options: { fontFace: fonts.heading, fontSize: PT(64), bold: true, color: hex(c.accent), breakLine: true, paraSpaceAfter: 8 } },
          ...para(words.map((x, j) => (j ? x : { ...x, text: x.text.replace(/^\s+/, '') })), { fontFace: fonts.body, fontSize: PT(23), color: hex(c.muted) }, true),
        ], { shape: p.ShapeType.roundRect, rectRadius: 0.2, fill: { color: hex(c.surface) }, line: { type: 'none' }, x: IN(MARGIN + col * (w + gap)), y: IN(200 + row * 250), w: IN(w), h: IN(items.length > 4 ? 226 : 300), valign: 'top', margin: 20 })
      })
      const other = blocks.filter((b) => !b.items)
      if (other.length) slide.addText(bodyRuns(other, c, fonts, 26), { x: IN(MARGIN), y: IN(items.length > 4 ? 690 : 540), w: IN(W - 2 * MARGIN), h: IN(110), valign: 'top' })
    } else if (s.layout === 'cols' && blocks.length) {
      const [a, b] = split(blocks)
      if (a.length) slide.addText(bodyRuns(a, c, fonts, 28), { placeholder: 'body' })
      if (b.length) slide.addText(bodyRuns(b, c, fonts, 28), { placeholder: 'body2' })
    } else if (blocks.length) {
      const table = blocks.find((b) => b.rows)
      const text = blocks.filter((b) => !b.rows)
      const where = g.body ? { placeholder: 'body', ...(narrow ? { w: IN(W * 0.58 - MARGIN - 40) } : {}) } : { x: IN(MARGIN), y: IN(s.title ? 186 : 84), w: IN(W - 2 * MARGIN), h: IN(s.title ? 460 : 560), valign: 'top' }
      if (text.length) slide.addText(bodyRuns(text, c, fonts, s.layout === 'image' ? 26 : 30), where)
      if (table) {
        const y = text.length ? 420 : 186
        slide.addTable(table.rows.map((r, ri) => r.map((cell) => ({ text: plain(cell), options: { bold: ri === 0, color: hex(ri === 0 ? c.muted : c.fg), fontFace: fonts.body, fontSize: PT(22) } }))), { x: IN(MARGIN), y: IN(y), w: IN(W - 2 * MARGIN), border: { type: 'solid', pt: 1, color: hex(c.line) } })
      }
    }
    if (look?.logo && s.layout !== 'picture') { const r = ratioOf(look.logo) || 0.2, lh = 30, lw = Math.min(200, lh / r); slide.addImage({ data: look.logo, x: IN(W - MARGIN - lw), y: IN(36), w: IN(lw), h: IN(lh) }) }
    if (s.notes) slide.addNotes(s.notes)
  }
  const bytes = new Uint8Array(await p.write({ outputType: 'arraybuffer' }))
  return withTheme(bytes, c, fonts, slides.map((s) => !!s.hidden))
}
// Two columns: at the second ### heading, else a list's items in two halves, else the blocks.
function split(blocks) {
  const hs = blocks.map((b, i) => (b.h ? i : -1)).filter((i) => i > 0)
  if (hs.length) return [blocks.slice(0, hs[0]), blocks.slice(hs[0])]
  if (blocks.length === 1 && blocks[0].items) { const it = blocks[0].items, n = Math.ceil(it.length / 2); return [[{ items: it.slice(0, n) }], [{ items: it.slice(n) }]] }
  const n = Math.ceil(blocks.length / 2)
  return [blocks.slice(0, n), blocks.slice(n)]
}
// The file's theme in the deck's colours and fonts, so what's added in PowerPoint matches, and
// Studio reads its look back.
async function withTheme(bytes, c, fonts, hidden = []) {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(bytes)
  // PptxGenJS gives each run of a paragraph its paragraph's properties again; a paragraph has them
  // once, first, or PowerPoint offers to repair the file.
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/(slides|slideLayouts|notesSlides)\/[^/]+\.xml$/.test(n))) {
    const xml = await zip.file(name).async('string')
    let out = xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (m, body) => { let n = 0; return `<a:p>${body.replace(/<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (x) => (n++ ? '' : x))}</a:p>` })
    // A slide skipped when presenting is hidden in PowerPoint too.
    const n = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name)?.[1]
    if (n && hidden[Number(n) - 1]) out = out.replace(/<p:sld\b/, '<p:sld show="0"')
    zip.file(name, out)
  }
  const f = zip.file('ppt/theme/theme1.xml')
  if (!f) return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  const clr = (tag, v) => (xml) => xml.replace(new RegExp(`<a:${tag}>[\\s\\S]*?</a:${tag}>`), `<a:${tag}><a:srgbClr val="${hex(v)}"/></a:${tag}>`)
  let xml = await f.async('string')
  for (const fix of [clr('dk1', c.fg), clr('lt1', c.bg), clr('dk2', c.fg), clr('lt2', c.surface), clr('accent1', c.accent)]) xml = fix(xml)
  const font = (which, name) => { xml = xml.replace(new RegExp(`(<a:${which}>\\s*<a:latin typeface=")[^"]*`), `$1${String(name).replace(/[<&"]/g, '')}`) }
  font('majorFont', fonts.heading)
  font('minorFont', fonts.body)
  zip.file('ppt/theme/theme1.xml', xml)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// ---------- From PowerPoint ----------
// A small XML reader (no page needed): { name, attrs, kids, text }.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unxml = (s) => String(s).replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m))
export function xmlTree(xml) {
  const root = { name: '#root', attrs: {}, kids: [] }
  const stack = [root]
  const re = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+)/g
  let m
  while ((m = re.exec(String(xml)))) {
    const top = stack.at(-1)
    if (m[6] != null) { if (m[6].trim() || top.name === 'a:t') top.kids.push({ text: unxml(m[6]) }); continue }
    if (m[5] != null) { top.kids.push({ text: m[5] }); continue }
    if (!m[2]) continue
    if (m[1]) { if (stack.length > 1) stack.pop(); continue }
    const attrs = {}
    for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unxml(a[2] ?? a[3])
    const el = { name: m[2], attrs, kids: [] }
    top.kids.push(el)
    if (!m[4]) stack.push(el)
  }
  return root
}
const kids = (el, name) => (el?.kids || []).filter((k) => k.name === name)
const kid = (el, name) => (el?.kids || []).find((k) => k.name === name)
const deep = (el, name, out = []) => { for (const k of el?.kids || []) { if (k.name === name) out.push(k); if (k.kids) deep(k, name, out) } return out }
const textIn = (el) => (el?.text != null ? el.text : (el?.kids || []).map(textIn).join(''))
const relsOf = (xml, base) => Object.fromEntries(deep(xmlTree(xml || ''), 'Relationship').map((r) => [r.attrs.Id, { type: r.attrs.Type.split('/').pop(), target: r.attrs.TargetMode === 'External' ? null : resolve(base, r.attrs.Target) }]))
const resolve = (base, target) => { const parts = (target.startsWith('/') ? target.slice(1) : `${base}${target}`).split('/'); const out = []; for (const x of parts) { if (x === '..') out.pop(); else if (x !== '.') out.push(x) } return out.join('/') }
const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1)
const relsPath = (p) => `${dirOf(p)}_rels/${p.slice(p.lastIndexOf('/') + 1)}.rels`

const unbold = (md) => (/^\*\*[^*]+\*\*$/.test(md) ? md.slice(2, -2) : md)
// A paragraph's words as Markdown, and its level and whether it's a bullet.
function paraOf(p, bulletsByDefault) {
  const pPr = kid(p, 'a:pPr')
  let md = ''
  for (const r of p.kids) {
    if (r.name === 'a:br') { md += '<br>'; continue }
    if (r.name !== 'a:r' && r.name !== 'a:fld') continue
    const t = textIn(kid(r, 'a:t'))
    if (!t) continue
    const rPr = kid(r, 'a:rPr')
    const b = rPr?.attrs.b === '1', i = rPr?.attrs.i === '1'
    const lead = t.match(/^\s*/)[0], tail = t.match(/\s*$/)[0], core = t.trim().replace(/([*`\\])/g, '\\$1')
    md += core ? `${lead}${b ? '**' : ''}${i ? '*' : ''}${core}${i ? '*' : ''}${b ? '**' : ''}${tail}` : t
  }
  const bullet = pPr && (kid(pPr, 'a:buChar') || kid(pPr, 'a:buAutoNum')) ? true : pPr && kid(pPr, 'a:buNone') ? false : bulletsByDefault
  return { md: md.replace(/\*\*\*\*/g, '').replace(/<br>/g, ' ').trim(), level: Number(pPr?.attrs.lvl || 0), bullet, numbered: !!(pPr && kid(pPr, 'a:buAutoNum')) }
}
// The shapes on a slide, in order, groups opened: { kind: title|subtitle|body|text|pic|table|other, ... }.
function shapesOf(tree, rels, keys = null) {
  const out = []
  const walk = (el) => {
    for (const k of el.kids || []) {
      if (k.name === 'p:grpSp') { walk(k); continue }
      if (k.name === 'p:sp') {
        const ph = deep(k, 'p:ph')[0]
        const type = ph ? ph.attrs.type || 'body' : null
        if (['dt', 'ftr', 'sldNum', 'hdr'].includes(type)) continue
        const body = kid(k, 'p:txBody')
        if (!body) continue
        const fill = !!kid(kid(k, 'p:spPr'), 'a:solidFill')
        const paras = kids(body, 'a:p').map((p) => paraOf(p, ph ? !['title', 'ctrTitle', 'subTitle'].includes(type) && type !== null : false)).filter((x) => x.md)
        if (!paras.length) continue
        // On a layout of Studio's own, its placeholders in order (PptxGenJS numbers them from 100).
        const own = ph && keys ? keys[Number(ph.attrs.idx) - 100] : null
        out.push({ kind: type === 'title' || type === 'ctrTitle' || own === 'title' ? 'title' : type === 'subTitle' || own === 'subtitle' ? 'subtitle' : ph ? 'body' : 'text', paras, fill })
      } else if (k.name === 'p:pic') {
        const blip = deep(k, 'a:blip')[0]
        const rel = rels[blip?.attrs['r:embed']]
        const off = deep(k, 'a:off')[0], ext = deep(k, 'a:ext')[0]
        if (rel?.target) out.push({ kind: 'pic', target: rel.target, x: Number(off?.attrs.x || 0), cx: Number(ext?.attrs.cx || 0) })
      } else if (k.name === 'p:graphicFrame') {
        const tbl = deep(k, 'a:tbl')[0]
        if (tbl) out.push({ kind: 'table', rows: kids(tbl, 'a:tr').map((tr) => kids(tr, 'a:tc').map((tc) => deep(tc, 'a:p').map((p) => paraOf(p, false).md).join(' '))) })
        else out.push({ kind: 'other' })
      }
    }
  }
  walk(deep(tree, 'p:spTree')[0] || tree)
  return out
}
const LAYOUT_OF_NAME = Object.fromEntries(Object.entries(LAYOUT_NAMES).map(([k, v]) => [v.toLowerCase(), k]))
// PowerPoint's own layouts, by their type.
const LAYOUT_OF_TYPE = { title: 'title', secHead: 'section', twoObj: 'cols', twoTxTwoObj: 'cols', picTx: 'image', blank: 'blank', obj: 'content', tx: 'content', titleOnly: 'content' }
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/emf', wmf: 'image/wmf' }

// A PowerPoint as a Markdown deck: { md, media: [{ id, type, bytes }], look, skipped: how many
// things on its slides Studio doesn't show (charts, diagrams, video) }. Its pictures are named
// media:<id> in the Markdown.
export async function deckFromPptx(buf, name = 'Deck') {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buf)
  const read = async (p) => (zip.file(p) ? zip.file(p).async('string') : null)
  const pres = xmlTree(await read('ppt/presentation.xml') || '')
  const presRels = relsOf(await read('ppt/_rels/presentation.xml.rels'), 'ppt/')
  const order = deep(pres, 'p:sldId').map((s) => presRels[s.attrs['r:id']]?.target).filter(Boolean)
  // Its look: the theme's colours and fonts.
  const themePath = Object.values(presRels).find((r) => r.type === 'theme')?.target
  let look = null
  if (themePath) {
    const th = xmlTree(await read(themePath) || '')
    const col = (tag) => { const el = deep(th, `a:${tag}`)[0]; const v = deep(el, 'a:srgbClr')[0]?.attrs.val || deep(el, 'a:sysClr')[0]?.attrs.lastClr; return v ? `#${v.toLowerCase()}` : null }
    const font = (which) => deep(deep(th, `a:${which}`)[0], 'a:latin')[0]?.attrs.typeface || null
    const colors = { background: col('lt1'), text: col('dk1'), accent: col('accent1') }
    if (colors.background && colors.text) look = { name: 'theme', colors, fonts: { heading: font('majorFont'), body: font('minorFont') } }
  }
  const media = []
  const mediaId = new Map()
  let skipped = 0
  const slides = []
  for (const sp of order) {
    const rels = relsOf(await read(relsPath(sp)), dirOf(sp))
    const tree = xmlTree(await read(sp) || '')
    const layoutRel = Object.values(rels).find((r) => r.type === 'slideLayout')
    const lay = layoutRel ? xmlTree(await read(layoutRel.target) || '') : null
    const layEl = deep(lay, 'p:sldLayout')[0]
    const layName = String(deep(layEl, 'p:cSld')[0]?.attrs.name || '').toLowerCase()
    const shapes = shapesOf(tree, rels, PH_KEYS[LAYOUT_OF_NAME[layName]] || null)
    skipped += shapes.filter((x) => x.kind === 'other').length
    // Speaker notes: the notes page's body.
    const notesRel = Object.values(rels).find((r) => r.type === 'notesSlide')
    let notes = ''
    if (notesRel) {
      const nt = xmlTree(await read(notesRel.target) || '')
      notes = shapesOf(nt, {}).filter((x) => x.kind === 'body').flatMap((x) => x.paras.map((p) => p.md.replace(/\*\*|\\/g, ''))).join('\n').trim()
    }
    const pics = []
    for (const pic of shapes.filter((x) => x.kind === 'pic')) {
      if (!mediaId.has(pic.target)) {
        const f = zip.file(pic.target)
        if (!f) continue
        const ext = pic.target.split('.').pop().toLowerCase()
        if (!MIME[ext] || ext === 'emf' || ext === 'wmf') { skipped++; continue }
        const id = `${media.length + 1}.${ext}`
        media.push({ id, type: MIME[ext], bytes: await f.async('uint8array') })
        mediaId.set(pic.target, id)
      }
      pics.push({ ...pic, id: mediaId.get(pic.target) })
    }
    const title = shapes.find((x) => x.kind === 'title')
    const subtitle = shapes.find((x) => x.kind === 'subtitle')
    const texts = shapes.filter((x) => x.kind === 'body' || (x.kind === 'text' && x !== title))
    let layout = LAYOUT_OF_NAME[layName] || LAYOUT_OF_TYPE[layEl?.attrs.type] || null
    if (!layout) layout = !texts.length && !pics.length && title && subtitle ? 'title' : pics.length && !texts.length ? 'picture' : pics.length ? 'image' : !texts.length && title ? 'section' : 'content'
    if ((layout === 'content' || layout === 'cols') && pics.length) layout = 'image'
    const lines = []
    const skip = /<p:sld\b[^>]*\sshow="0"/.test(await read(sp) || '')
    if (layout !== 'content' || skip) lines.push(`<!-- _class: ${[layout === 'content' ? '' : layout, skip ? 'skip' : ''].filter(Boolean).join(' ')} -->`, '')
    // Our own Section and Title slides keep their words in their title and subtitle.
    // A title is bold by its layout, not by its words.
    const words = (box) => box.paras.map((p) => unbold(p.md)).join(' ')
    if (title) lines.push(`# ${words(title)}`, '')
    if (subtitle && layout !== 'quote') lines.push(`${layout === 'title' || layout === 'section' || layout === 'picture' ? '## ' : ''}${words(subtitle)}`, '')
    if (layout === 'stats') {
      for (const card of texts) { const [big, ...more] = card.paras; lines.push(`- **${big.md.replace(/\*\*/g, '')}** ${more.map((p) => p.md).join(' ')}`.trimEnd()) }
      if (texts.length) lines.push('')
    } else if (layout === 'quote') {
      // Its big quotation mark is drawn, not said.
      const q = texts.filter((x) => x.paras.some((p) => !/^[\s*“"]*$/.test(p.md)))
      for (const box of q) lines.push(`> ${words(box)}`, '')
      if (subtitle) lines.push(words(subtitle), '')
    } else {
      texts.forEach((box, bi) => {
        const heads = layout === 'cols' && box.paras.length > 1 && /^\*\*[^*]+\*\*$/.test(box.paras[0].md)
        box.paras.forEach((p, pi) => {
          if (heads && pi === 0) { lines.push(`### ${p.md.replace(/^\*\*|\*\*$/g, '')}`, ''); return }
          if (p.bullet) lines.push(`${'  '.repeat(p.level)}${p.numbered ? '1.' : '-'} ${p.md}`)
          else lines.push(p.md, '')
        })
        if (bi < texts.length - 1 || box.paras.at(-1)?.bullet) lines.push('')
      })
    }
    for (const tb of shapes.filter((x) => x.kind === 'table')) {
      if (!tb.rows.length) continue
      const cols = Math.max(...tb.rows.map((r) => r.length))
      const row = (r) => `| ${Array.from({ length: cols }, (_, i) => unbold(r[i] || '').replace(/\|/g, '\\|')).join(' | ')} |`
      lines.push(row(tb.rows[0]), `|${' --- |'.repeat(cols)}`, ...tb.rows.slice(1).map(row), '')
    }
    const pic = pics[0]
    if (pic) lines.push(layout === 'picture' ? `![bg](media:${pic.id})` : `![bg ${pic.x < 914400 * 2 && pic.cx < 914400 * 8 ? 'left' : 'right'}:42%](media:${pic.id})`, '')
    if (notes) lines.push(`<!-- ${notes.replace(/--+>/g, '—>')} -->`)
    slides.push(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim())
  }
  const title = String(name).replace(/\.pptx$/i, '')
  const md = `---\nmarp: true\ntitle: ${/[:#'"]/.test(title) ? JSON.stringify(title) : title}\npaginate: true\n---\n\n${(slides.length ? slides : ['']).join('\n\n---\n\n')}\n`
  return { md, media, look, skipped }
}
