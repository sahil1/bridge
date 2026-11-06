import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ExternalHyperlink, ImageRun, LevelFormat, AlignmentType, BorderStyle } from 'docx'
import { docxStyles } from './look.js'

// A document as Studio edits it (Tiptap's JSON) written as a Word file: headings, paragraphs with
// bold, italic, underline, strikethrough, code and links, bulleted and numbered lists (nested),
// tables, quotes (in Word's Quote style, which Studio reads back as a quote), code blocks, rules and
// pictures. What a Word file has beyond that (headers, footers, comments, tracked changes, page
// setup) isn't in Studio's document, so it isn't written: Studio says so before the first save, and
// the file as it was stays a version. look: the fonts, sizes and colours it had (look.js), kept.
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]

function runs(nodes = [], extra = {}) {
  const out = []
  for (const n of nodes) {
    if (n.type === 'hardBreak') { out.push(new TextRun({ break: 1 })); continue }
    if (n.type === 'image') { const r = image(n); if (r) out.push(r); continue }
    if (n.type !== 'text') continue
    const marks = Object.fromEntries((n.marks || []).map((m) => [m.type, m.attrs || true]))
    const style = { text: n.text, bold: !!marks.bold, italics: !!marks.italic, underline: marks.underline ? {} : undefined, strike: !!marks.strike, ...(marks.code ? { font: 'Menlo' } : {}), ...extra }
    if (marks.link?.href) out.push(new ExternalHyperlink({ link: marks.link.href, children: [new TextRun({ ...style, style: 'Hyperlink' })] }))
    else out.push(new TextRun(style))
  }
  return out
}

// A picture in the document (a data: URL, as Studio holds them), at its own size up to the page's.
function image(n) {
  const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(n.attrs?.src || '')
  if (!m) return null
  const bin = atob(m[2])
  const data = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i)
  const w = Math.min(600, Number(n.attrs?.width) || 480)
  const h = Number(n.attrs?.height) ? Math.round((Number(n.attrs.height) * w) / (Number(n.attrs.width) || w)) : Math.round(w * 0.6)
  return new ImageRun({ type: m[1].toLowerCase().replace('jpeg', 'jpg'), data, transformation: { width: w, height: h } })
}

function blocks(nodes = [], ctx = { list: null, level: 0 }) {
  const out = []
  for (const n of nodes) {
    switch (n.type) {
      case 'heading': out.push(new Paragraph({ heading: HEADINGS[(n.attrs?.level || 1) - 1], children: runs(n.content) })); break
      case 'paragraph': out.push(new Paragraph({ children: runs(n.content) })); break
      // A list item's first paragraph carries its bullet or number; what follows in it is indented
      // under it, and a list inside it is a level down.
      case 'bulletList': case 'orderedList': {
        const ref = n.type === 'bulletList' ? 'bullets' : 'numbers'
        const level = ctx.list ? ctx.level + 1 : 0
        for (const item of n.content || []) {
          for (const [i, c] of (item.content || []).entries()) {
            if (c.type === 'paragraph') out.push(new Paragraph({ children: runs(c.content), ...(i === 0 ? { numbering: { reference: ref, level } } : { indent: { left: 720 * (level + 1) } }) }))
            else out.push(...blocks([c], { list: ref, level }))
          }
        }
        break
      }
      case 'blockquote': for (const p of n.content || []) { if (p.type === 'paragraph') out.push(new Paragraph({ style: 'Quote', children: runs(p.content) })); else out.push(...blocks([p], ctx)) } break
      case 'codeBlock': for (const line of (n.content?.map((t) => t.text).join('') || '').split('\n')) out.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Menlo', size: 20 })] })); break
      case 'horizontalRule': out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 1 } }, children: [] })); break
      case 'image': out.push(new Paragraph({ children: [image(n)].filter(Boolean) })); break
      case 'table': out.push(table(n)); break
      default: if (n.content) out.push(...blocks(n.content, ctx))
    }
  }
  return out
}

function table(n) {
  const rows = (n.content || []).map((r) => new TableRow({
    children: (r.content || []).map((c) => new TableCell({ children: blocks(c.content || [{ type: 'paragraph' }]), columnSpan: c.attrs?.colspan || 1, rowSpan: c.attrs?.rowspan || 1 })),
  }))
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

// Word's own Quote style (indented, italic, grey), which a quote is written in.
const QUOTE = { id: 'Quote', name: 'Quote', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { italics: true, color: '595959' }, paragraph: { indent: { left: 720, right: 720 }, spacing: { before: 120, after: 120 } } }
const levels = (format, text) => Array.from({ length: 6 }, (_, level) => ({ level, format, text: text(level), alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } }))
export async function docxOf(json, look = null) {
  const doc = new Document({
    styles: { ...docxStyles(look), paragraphStyles: [QUOTE] },
    numbering: { config: [
      { reference: 'bullets', levels: levels(LevelFormat.BULLET, (l) => ['•', '◦', '▪', '•', '◦', '▪'][l]) },
      { reference: 'numbers', levels: levels(LevelFormat.DECIMAL, (l) => `%${l + 1}.`) },
    ] },
    sections: [{ children: blocks(json?.content || []) }],
  })
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer())
}
