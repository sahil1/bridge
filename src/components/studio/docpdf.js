// A document as a PDF: Tiptap JSON, as docx.js takes it for a Word file, written with jsPDF (MIT) on
// A4 (US Letter where that's the paper: the US, Canada, Mexico, the Philippines), its page numbers at
// the foot. Headings, paragraphs with bold, italic, code, links and strikethrough, lists (bulleted,
// numbered and checklists, nested), quotes, code blocks, rules, tables (a row to a line) and pictures,
// each scaled to fit the page and never past it. The words are the PDF's own Helvetica (Courier for
// code), real text to select and search, which covers Western European languages; a paragraph with
// other letters in it (Chinese, Hindi, an emoji…) goes in as a sharp picture of itself, drawn by the
// browser, as those fonts can't be put in the PDF yet (whiteboard/pdf.js does the same with a board).
// A long document gives the page a moment every few dozen paragraphs, so a long transcript doesn't
// freeze it. Returns { data: the PDF's bytes, pages, pictured: paragraphs that went in as pictures }.

const PT = 0.75 // a CSS pixel (a picture's size is given in them) in points
const BODY = 10.5
const HEADS = [20, 15, 12.5, 11, BODY, BODY]
const LINE = 1.45
const INDENT = 18
const INK = [28, 28, 30]
const MUTED = [110, 110, 115]
const LINK = [26, 92, 200]
const RULE = [200, 200, 205]
// What Helvetica has in a PDF (Windows' Western set), and the signs it hasn't, written as it can.
const LATIN = /^[\n -~ -ÿ–—‘’‚“”„†‡•…‰‹›€™ŠšŽžŸŒœƒˆ˜]*$/
const SWAP = [[/[ -   ]/g, ' '], [/[​-‍⁠﻿­]/g, ''], [/[‐‑−]/g, '-'], [/→/g, '->'], [/←/g, '<-'], [/↔/g, '<->'], [/⇒/g, '=>'],
  [/≥/g, '>='], [/≤/g, '<='], [/≠/g, '!='], [/≈/g, '~'], [/\t/g, '    '], [/[\r\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '']]
const plain = (s) => SWAP.reduce((a, [re, to]) => a.replace(re, to), String(s || ''))

// Where a line can break: after a space, and in a script without them (Chinese, Japanese, Thai)
// between its words, a sign staying with the word before it.
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null
function words(text) {
  if (!seg || LATIN.test(text)) return text.match(/\S+\s*|\s+/g) || []
  const out = []
  for (const { segment: s, isWordLike } of seg.segment(text)) {
    if (out.length && (/^\s+$/.test(s) || (!isWordLike && !/\s$/.test(out[out.length - 1])))) out[out.length - 1] += s
    else out.push(s)
  }
  return out
}

// Runs laid out on lines no wider than width: [[{ text, st, x, w }]], runs alike joined. A word that
// doesn't fit goes to the next line, one longer than a line (a long link) is broken where the line
// ends, and a line break in the text is one here. pre: spaces at the start of a line kept (code).
function layout(runs, width, measure, pre = false) {
  const lines = [[]]
  let x = 0
  const put = (text, st, w) => {
    const line = lines[lines.length - 1]
    const last = line[line.length - 1]
    if (last && last.st === st) { last.text += text; last.w += w } else line.push({ text, st, x, w })
    x += w
  }
  const next = () => { lines.push([]); x = 0 }
  for (const r of runs) {
    if (r.br) { next(); continue }
    for (const word of words(r.text)) {
      const bare = word.trimEnd()
      if (!bare) { if (x > 0 || pre) put(word, r.st, measure(word, r.st)); continue }
      const w = measure(bare, r.st)
      if (x > 0 && x + w > width) next()
      if (w <= width) { put(word, r.st, measure(word, r.st)); continue }
      let rest = [...bare]
      while (rest.length) {
        let n = 1
        while (n < rest.length && measure(rest.slice(0, n + 1).join(''), r.st) <= width - x) n++
        const part = rest.slice(0, n).join('')
        put(part, r.st, measure(part, r.st))
        rest = rest.slice(n)
        if (rest.length) next()
      }
      if (word.length > bare.length) put(word.slice(bare.length), r.st, measure(word.slice(bare.length), r.st))
    }
  }
  return lines
}

// Lines drawn by the browser, which has every script's letters: three pixels to a point, sharp in print.
function painter() {
  const S = 3
  const c = document.createElement('canvas')
  const x = c.getContext('2d')
  const font = (st) => `${st.i ? 'italic ' : ''}${st.b ? 'bold ' : ''}${st.size * S}px ${st.mono ? 'ui-monospace, Menlo, Consolas, monospace' : 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif'}`
  return {
    measure: (text, st) => { x.font = font(st); return x.measureText(text).width / S },
    draw(lines, w, lh, size) {
      c.width = Math.ceil(w * S)
      c.height = Math.ceil(lines.length * lh * S)
      x.fillStyle = '#fff'
      x.fillRect(0, 0, c.width, c.height)
      lines.forEach((line, i) => {
        for (const p of line) {
          x.font = font(p.st)
          x.fillStyle = `rgb(${p.st.color.join(',')})`
          x.fillText(p.text, p.x * S, (i * lh + lh / 2 + size * 0.3) * S)
        }
      })
      return c.toDataURL('image/jpeg', 0.92)
    },
  }
}

export async function pdfOf(json, { title = '' } = {}) {
  const { jsPDF } = await import('jspdf')
  const letter = /-(US|CA|MX|PH)\b/i.test(navigator.language || '')
  const doc = new jsPDF({ unit: 'pt', format: letter ? 'letter' : 'a4', compress: true })
  const name = plain(title)
  if (name && LATIN.test(name)) doc.setProperties({ title: name, creator: 'Bridge AI' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 54
  const left = M
  const width = W - 2 * M
  const top = M
  const bottom = H - M
  let y = top
  let pictured = 0
  let count = 0
  let pics = 0
  let paint = null
  const room = (h) => { if (y + h > bottom && y > top) { doc.addPage(); y = top } }
  const gap = (h) => { if (y > top) y += h }
  // A style is one object for each kind of run, so runs alike join on a line.
  const styles = new Map()
  const style = (o) => { const k = JSON.stringify(o); if (!styles.has(k)) styles.set(k, o); return styles.get(k) }
  let cur = null
  const font = (st) => {
    if (cur === st) return
    cur = st
    doc.setFont(st.mono ? 'courier' : 'helvetica', st.b && st.i ? 'bolditalic' : st.b ? 'bold' : st.i ? 'italic' : 'normal')
    doc.setFontSize(st.size)
    doc.setTextColor(...st.color)
  }
  const measure = (text, st) => { font(st); return doc.getTextWidth(text) }
  const runsOf = (nodes, base) => (nodes || []).flatMap((n) => {
    if (n.type === 'hardBreak') return [{ br: true }]
    if (n.type !== 'text' || !n.text) return []
    const m = Object.fromEntries((n.marks || []).map((k) => [k.type, k.attrs || true]))
    const href = /^(https?|mailto|file):/i.test(m.link?.href || '') ? m.link.href : null
    return [{ text: plain(n.text), st: style({ size: m.code ? base.size * 0.92 : base.size, color: href ? LINK : base.color, b: !!(base.b || m.bold), i: !!(base.i || m.italic), mono: !!m.code, s: !!m.strike, href }) }]
  })

  // A paragraph's runs, line by line onto the pages, with what goes beside its first line (mark: a
  // list's bullet, number or box).
  const para = (runs, { ind = 0, size = BODY, mark = null, pre = false }) => {
    if (!runs.length) return
    const w = width - ind
    const lh = size * LINE
    const at = (top0) => top0 + lh / 2 + size * 0.3
    if (runs.every((r) => r.br || LATIN.test(r.text))) {
      layout(runs, w, measure, pre).forEach((line, i) => {
        room(lh)
        const base = at(y)
        if (i === 0 && mark) mark(base, size)
        for (const p of line) {
          font(p.st)
          doc.text(p.text, left + ind + p.x, base)
          if (p.st.href) doc.link(left + ind + p.x, y, p.w, lh, { url: p.st.href })
          if (p.st.s) { doc.setDrawColor(...p.st.color); doc.setLineWidth(0.6); doc.line(left + ind + p.x, base - size * 0.3, left + ind + p.x + p.w, base - size * 0.3) }
        }
        y += lh
      })
      return
    }
    // Letters Helvetica hasn't: a picture of its lines on each page they're on.
    pictured++
    paint ||= painter()
    const lines = layout(runs, w, paint.measure, pre)
    for (let i = 0; i < lines.length;) {
      room(lh)
      const n = Math.max(1, Math.min(lines.length - i, Math.floor((bottom - y) / lh)))
      doc.addImage(paint.draw(lines.slice(i, i + n), w, lh, size), 'JPEG', left + ind, y, w, n * lh, `words${pictured}-${i}`, 'FAST')
      if (i === 0 && mark) mark(at(y), size)
      y += n * lh
      i += n
    }
  }
  const marker = (kind, n, checked, ind, depth) => (base, size) => {
    const x = left + ind
    doc.setDrawColor(...INK)
    doc.setFillColor(...INK)
    doc.setLineWidth(0.7)
    if (kind === 'bulletList') doc.circle(x + 8, base - size * 0.32, size * 0.16, depth % 2 ? 'S' : 'F')
    else if (kind === 'orderedList') { font(style({ size, color: INK, b: false, i: false, mono: false, s: false, href: null })); doc.text(`${n}.`, x + INDENT - 4, base, { align: 'right' }) }
    else {
      const s = size * 0.78
      doc.rect(x + 3, base - s * 0.95, s, s, 'S')
      if (checked) { doc.line(x + 3 + s * 0.2, base - s * 0.5, x + 3 + s * 0.42, base - s * 0.2); doc.line(x + 3 + s * 0.42, base - s * 0.2, x + 3 + s * 0.85, base - s * 0.85) }
    }
  }
  // A picture at its size, smaller when the page is: never wider than it, nor taller.
  const fitted = (n, ind) => {
    const m = /^data:image\/(jpe?g|png);base64,/i.exec(n?.attrs?.src || '')
    if (!m) return null
    const w = (Number(n.attrs.width) || 400) * PT
    const h = (Number(n.attrs.height) || (Number(n.attrs.width) || 400) * 0.6) * PT
    const s = Math.min(1, (width - ind) / w, (bottom - top - 24) / h)
    return { w: w * s, h: h * s, type: /png/i.test(m[1]) ? 'PNG' : 'JPEG' }
  }
  const picture = (n, ind) => {
    const f = fitted(n, ind)
    if (!f) return
    room(f.h + 6)
    doc.addImage(n.attrs.src, f.type, left + ind, y + 3, f.w, f.h, `pic${++pics}`, 'FAST')
    y += f.h + 9
  }

  const blocks = async (nodes, c) => {
    for (const [i, n] of (nodes || []).entries()) {
      if (++count % 40 === 0) await new Promise((r) => setTimeout(r, 0))
      const mark = i === 0 ? c.mark : null
      const base = { size: BODY, color: c.quote ? MUTED : INK, b: false, i: !!c.quote }
      switch (n.type) {
        case 'heading': {
          const size = HEADS[(n.attrs?.level || 1) - 1] || BODY
          gap(size * 0.8)
          // On the page with what follows it: a picture, or a line or two.
          room(size * LINE + (nodes[i + 1]?.type === 'image' ? (fitted(nodes[i + 1], c.ind)?.h || 0) + 12 : BODY * LINE * 2))
          para(runsOf(n.content, { ...base, size, b: true, i: false, color: INK }), { ind: c.ind, size, mark })
          y += 3
          break
        }
        case 'paragraph': para(runsOf(n.content, base), { ind: c.ind, mark }); y += c.list ? 2 : 6; break
        case 'bulletList': case 'orderedList': case 'taskList': {
          let k = Number(n.attrs?.start) || 1
          const depth = c.depth || 0
          for (const item of n.content || []) await blocks(item.content, { ...c, ind: c.ind + INDENT, list: true, depth: depth + 1, mark: marker(n.type, k++, !!item.attrs?.checked, c.ind, depth) })
          if (!c.list) y += 4
          break
        }
        case 'blockquote': await blocks(n.content, { ...c, ind: c.ind + 14, quote: true, mark: null }); break
        case 'codeBlock': {
          const st = style({ size: BODY * 0.9, color: INK, b: false, i: false, mono: true, s: false, href: null })
          for (const line of (n.content || []).map((t) => t.text || '').join('').split('\n')) para([{ text: plain(line) || ' ', st }], { ind: c.ind + 6, size: st.size, pre: true })
          y += 6
          break
        }
        case 'horizontalRule': room(14); doc.setDrawColor(...RULE); doc.setLineWidth(0.8); doc.line(left + c.ind, y + 7, left + width, y + 7); y += 14; break
        case 'image': picture(n, c.ind); break
        case 'table': {
          const sep = style({ size: BODY, color: MUTED, b: false, i: false, mono: false, s: false, href: null })
          for (const row of n.content || []) {
            const runs = []
            for (const [j, cell] of (row.content || []).entries()) {
              if (j) runs.push({ text: '  |  ', st: sep })
              for (const p of cell.content || []) runs.push(...runsOf(p.content, { ...base, b: cell.type === 'tableHeader' }), { text: ' ', st: sep })
            }
            para(runs, { ind: c.ind })
            y += 2
          }
          y += 4
          break
        }
        default: if (n.content) await blocks(n.content, c)
      }
    }
  }
  await blocks(json?.content, { ind: 0 })

  const pages = doc.getNumberOfPages()
  const foot = style({ size: 8, color: MUTED, b: false, i: false, mono: false, s: false, href: null })
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    cur = null
    font(foot)
    if (pages > 1) doc.text(`${p} / ${pages}`, W - M, H - M / 2, { align: 'right' })
    if (name && LATIN.test(name)) doc.text(name.length > 90 ? `${name.slice(0, 89)}…` : name, M, H - M / 2)
  }
  return { data: new Uint8Array(doc.output('arraybuffer')), pages, pictured }
}
