// A Word file with most of what Word puts in one, made with the docx library, for Studio's tests:
// a title, headings, paragraphs in their own fonts and colours, bulleted and numbered lists, a table
// with a shaded header and a merged cell, a picture, a header and a footer with page numbers, a
// comment, tracked changes, a footnote, a bookmark and a link; pages long enough to break.
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { ROOT } from './harness.mjs'

const require = createRequire(path.join(ROOT, 'package.json'))
// A picture: a small bar chart (four bars on white), as a PNG made here.
export function chartPng(w = 240, h = 140) {
  const bars = [0.45, 0.6, 0.72, 0.9]
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3
      const b = Math.floor((x - 20) / 52), inBar = x >= 20 && b < 4 && (x - 20) % 52 < 36 && y > h - 12 - bars[b] * (h - 30) && y < h - 12
      const rgb = inBar ? [43, 108, 222] : y === h - 12 ? [180, 186, 196] : [255, 255, 255]
      raw[i] = rgb[0]; raw[i + 1] = rgb[1]; raw[i + 2] = rgb[2]
    }
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const LINES = [
  'The team spent the quarter on the parts of the product people use every day: the editor, the search, and the way files are shared between computers.',
  'Most of the work went into making each of those faster and calmer to use, with fewer settings and clearer words on the screen.',
  'We measured each change against the week before it, and kept the ones that helped. Two changes made things worse and were taken back.',
  'Next quarter is about the first hour: what a new person sees, what they understand without help, and what they come back for the next day.',
]

export async function richDocx({ pages = 3 } = {}) {
  const d = require('docx')
  const body = []
  const para = (text, o = {}) => new d.Paragraph({ children: [new d.TextRun(text)], ...o })
  body.push(new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [new d.TextRun('Quarterly plan')] }))
  body.push(new d.Paragraph({ children: [new d.TextRun({ text: 'Prepared for the product team · draft 2', italics: true, color: '595959' })] }))
  body.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun('Summary')] }))
  body.push(new d.Paragraph({ children: [new d.CommentRangeStart(0), new d.TextRun('Revenue grew 20% over the quarter, and the share of people who came back in their second week rose from 31% to 38%.'), new d.CommentRangeEnd(0), new d.TextRun({ children: [new d.CommentReference(0)] })] }))
  body.push(new d.Paragraph({ children: [new d.TextRun('We ship the pricing page'), new d.FootnoteReferenceRun(1), new d.InsertedTextRun({ text: ' in November', id: 1, author: 'Avery Stone', date: '2026-10-02T09:00:00Z' }), new d.DeletedTextRun({ text: ' in December', id: 2, author: 'Avery Stone', date: '2026-10-02T09:00:00Z' }), new d.TextRun('.')] }))
  body.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_2, children: [new d.TextRun('What we did')] }))
  for (const l of ['A faster editor that opens large files at once', 'Search that finds a word in every file you have', 'Sharing between computers without a cloud account']) body.push(new d.Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new d.TextRun(l)] }))
  body.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_2, children: [new d.TextRun('Numbers')] }))
  const cell = (text, o = {}) => new d.TableCell({ children: [new d.Paragraph({ children: [new d.TextRun({ text, bold: !!o.bold })] })], ...(o.shade ? { shading: { fill: o.shade, type: d.ShadingType.CLEAR, color: 'auto' } } : {}), ...(o.rowSpan ? { rowSpan: o.rowSpan } : {}) })
  body.push(new d.Table({
    width: { size: 100, type: d.WidthType.PERCENTAGE },
    rows: [
      new d.TableRow({ tableHeader: true, children: [cell('Measure', { bold: true, shade: 'DCE6F2' }), cell('Q3', { bold: true, shade: 'DCE6F2' }), cell('Q4', { bold: true, shade: 'DCE6F2' })] }),
      new d.TableRow({ children: [cell('Revenue', { rowSpan: 2 }), cell('$1.2M'), cell('$1.44M')] }),
      new d.TableRow({ children: [cell('+8%'), cell('+20%')] }),
      new d.TableRow({ children: [cell('Second-week return'), cell('31%'), cell('38%')] }),
    ],
  }))
  body.push(new d.Paragraph({ children: [new d.ImageRun({ type: 'png', data: chartPng(), transformation: { width: 240, height: 140 } })] }))
  body.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_2, children: [new d.TextRun('Next steps')] }))
  for (const l of ['Write the first-hour guide', 'Test it with five new people', 'Ship what they understood']) body.push(new d.Paragraph({ numbering: { reference: 'steps', level: 0 }, children: [new d.TextRun(l)] }))
  body.push(new d.Paragraph({ children: [new d.Bookmark({ id: 'notes', children: [new d.TextRun('Notes')] }), new d.TextRun({ text: ' in Georgia, 14 point, dark red', font: 'Georgia', size: 28, color: 'C00000', highlight: 'yellow' }), new d.TextRun(', and '), new d.ExternalHyperlink({ link: 'https://example.com/plan', children: [new d.TextRun({ text: 'a link to the plan', style: 'Hyperlink' })] }), new d.TextRun('.')] }))
  for (let p = 1; p < pages; p++) {
    body.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, children: [new d.TextRun(`Part ${p + 1}`)] }))
    for (let i = 0; i < 9; i++) body.push(para(`${LINES[i % LINES.length]} ${LINES[(i + 1) % LINES.length]}`))
  }
  const doc = new d.Document({
    creator: 'Studio test', title: 'Quarterly plan',
    comments: { children: [{ id: 0, author: 'Avery Stone', initials: 'AS', date: new Date('2026-10-01T10:00:00Z'), children: [new d.Paragraph({ children: [new d.TextRun('Is this the quarter or the year?')] })] }] },
    footnotes: { 1: { children: [new d.Paragraph('Pending the legal review.')] } },
    numbering: { config: [
      { reference: 'bullets', levels: [{ level: 0, format: d.LevelFormat.BULLET, text: '•', alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: 'steps', levels: [{ level: 0, format: d.LevelFormat.DECIMAL, text: '%1.', alignment: d.AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ] },
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } }, heading1: { run: { font: 'Calibri Light', size: 32, color: '2F5496' }, paragraph: { spacing: { before: 240, after: 80 } } }, heading2: { run: { font: 'Calibri Light', size: 26, color: '2F5496' }, paragraph: { spacing: { before: 160, after: 60 } } }, title: { run: { font: 'Calibri Light', size: 56 } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440, header: 720, footer: 720 } } },
      headers: { default: new d.Header({ children: [new d.Paragraph({ alignment: d.AlignmentType.RIGHT, children: [new d.TextRun({ text: 'Quarterly plan · internal', color: '7F7F7F', size: 18 })] })] }) },
      footers: { default: new d.Footer({ children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ children: ['Page ', d.PageNumber.CURRENT, ' of ', d.PageNumber.TOTAL_PAGES], size: 18, color: '7F7F7F' })] })] }) },
      children: body,
    }],
  })
  return d.Packer.toBuffer(doc)
}
