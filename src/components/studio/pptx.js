// Decks to PowerPoint and back. A Markdown deck's slides (between lines of ---, after its front
// matter) become PowerPoint slides whose title, subtitle, bullets, paragraphs and speaker notes are
// text you can edit there (PptxGenJS, MIT), in the deck's design pack when it has one. A PowerPoint
// read into its text (server/office.js's outline) becomes a Markdown deck to edit here.
const clean = (s) => String(s).replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').trim()

// The slides of a Markdown deck: { title, subtitle, items: [{ text, level, bullet }], notes }.
// comments: Marp's speaker notes, slide by slide.
export function slidesOf(md, comments = []) {
  const body = String(md).replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '')
  return body.split(/^---\s*$/m).map((part, i) => {
    let title = null, subtitle = null
    const items = []
    for (const line of part.split('\n')) {
      if (!line.trim() || /^<!--.*-->$/.test(line.trim())) continue
      const h = /^(#{1,6})\s+(.*)$/.exec(line)
      if (h && !title) { title = clean(h[2]); continue }
      if (h && !subtitle) { subtitle = clean(h[2]); continue }
      const b = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)
      if (b) { items.push({ text: clean(b[2]), level: Math.min(4, Math.floor(b[1].length / 2)), bullet: true }); continue }
      if (h) { items.push({ text: clean(h[2]), level: 0, bullet: false, bold: true }); continue }
      items.push({ text: clean(line), level: 0, bullet: false })
    }
    return { title, subtitle, items: items.filter((x) => x.text), notes: (comments[i] || []).join('\n') }
  }).filter((s) => s.title || s.items.length)
}

const hex = (c, d) => String(c || d).replace('#', '').slice(0, 6).toUpperCase()
export async function pptxOf(slides, pack = null) {
  const PptxGenJS = (await import('pptxgenjs')).default
  const p = new PptxGenJS()
  p.layout = 'LAYOUT_16x9'
  const bg = hex(pack?.colors?.background, 'FFFFFF'), fg = hex(pack?.colors?.text, '1F2328'), accent = hex(pack?.colors?.accent, fg)
  const head = pack?.fonts?.heading || 'Helvetica Neue', body = pack?.fonts?.body || 'Helvetica Neue'
  for (const [i, s] of slides.entries()) {
    const slide = p.addSlide()
    slide.background = { color: bg }
    const first = i === 0 && !s.items.length
    if (s.title) slide.addText(s.title, { x: 0.6, y: first ? 2.0 : 0.4, w: 8.8, h: first ? 1.2 : 0.9, fontFace: head, fontSize: first ? 40 : 30, bold: true, color: accent, align: first ? 'center' : 'left' })
    if (s.subtitle) slide.addText(s.subtitle, { x: 0.6, y: first ? 3.2 : 1.25, w: 8.8, h: 0.6, fontFace: body, fontSize: first ? 22 : 18, color: fg, align: first ? 'center' : 'left' })
    if (s.items.length) {
      slide.addText(s.items.map((x) => ({ text: x.text, options: { bullet: x.bullet ? { indent: 18 } : false, indentLevel: x.level, bold: !!x.bold, breakLine: true } })),
        { x: 0.7, y: s.subtitle ? 1.9 : 1.4, w: 8.6, h: s.subtitle ? 3.4 : 3.9, fontFace: body, fontSize: 18, color: fg, valign: 'top', paraSpaceAfter: 6 })
    }
    if (s.notes) slide.addNotes(s.notes)
    if (pack?.logo) slide.addImage({ data: pack.logo, x: 8.9, y: 4.95, w: 0.8, h: 0.45, sizing: { type: 'contain', w: 0.8, h: 0.45 } })
  }
  return new Uint8Array(await p.write({ outputType: 'arraybuffer' }))
}

// A PowerPoint's text as a Markdown deck: a slide each, its first line the title, the rest
// bullets, its notes as notes.
export function deckFromOutline(outline, name = 'Deck') {
  const slides = (outline?.sections || []).map((s) => {
    const [first, ...rest] = s.blocks.map((b) => b.text.trim()).filter(Boolean)
    return [`# ${first || s.title || ''}`, '', ...rest.map((x) => `- ${x}`), ...(s.notes?.length ? ['', `<!-- ${s.notes.join(' ').replace(/-->/g, '')} -->`] : [])].join('\n')
  })
  return `---\nmarp: true\ntitle: ${String(name).replace(/\.pptx$/i, '')}\npaginate: true\n---\n\n${slides.join('\n\n---\n\n')}\n`
}

export const blankDeck = (title = 'New deck') => `---\nmarp: true\ntitle: ${title}\npaginate: true\n---\n\n# ${title}\n\n## A subtitle\n\n---\n\n# The first point\n\n- What it is\n- Why it matters\n- What's next\n\n<!-- What to say on this slide -->\n`
