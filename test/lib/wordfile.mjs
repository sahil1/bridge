// A Word file with most of what Word puts in one, made with the docx library, for Studio's tests:
// a title, headings, paragraphs in their own fonts and colours, bulleted and numbered lists, a table
// with a shaded header and a merged cell, a picture, a header and a footer with page numbers, a
// comment, tracked changes, a footnote, a bookmark and a link; pages long enough to break. And a
// Word file with comments in threads, part by part as Word 365 writes them (threadsDocx).
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

// A Word file with comments in threads, as Word 365 writes it: comments.xml (Word's namespaces,
// each comment's paragraph with its paraId, in the CommentText style, Word's annotation mark
// first), commentsExtended.xml (a reply's parent by paraId, and done for a resolved one),
// commentsIds.xml and commentsExtensible.xml (a lasting id and the time in UTC for each),
// people.xml, and in the document each comment's start, end and reference (a reply's beside its
// parent's). Avery asks which quarter and Sam answers; a resolved comment on the next paragraph;
// and Sam's comment asking @bridge to shorten the one after (it came in the file, so it isn't
// yours to send).
export const WORD_NS = 'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex" xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid" xmlns:w16="http://schemas.microsoft.com/office/word/2018/wordml" xmlns:w16se="http://schemas.microsoft.com/office/word/2015/wordml/symex" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 w15 w16se w16cid w16 w16cex wp14"'
export const THREADS = [
  { id: 0, pid: '3D1E8F21', durable: '2A3B4C5D', author: 'Avery Stone', initials: 'AS', date: '2026-10-01T10:00:00Z', text: 'Which quarter is this?', on: 'p1' },
  { id: 1, pid: '4E2F9032', durable: '2A3B4C5E', author: 'Sam Lee', initials: 'SL', date: '2026-10-01T11:30:00Z', text: 'Q3, I think.', on: 'p1', parent: '3D1E8F21' },
  { id: 2, pid: '5F30A143', durable: '2A3B4C5F', author: 'Avery Stone', initials: 'AS', date: '2026-10-02T09:00:00Z', text: 'Spell out the numbers.', on: 'p2', done: true },
  { id: 3, pid: '6041B254', durable: '2A3B4C60', author: 'Sam Lee', initials: 'SL', date: '2026-10-03T08:00:00Z', text: '@bridge make this shorter', on: 'p3' },
]
export const THREAD_PARAS = {
  p1: 'Revenue grew 20% over the quarter, and the share of people who came back in their second week rose from 31% to 38%.',
  p2: 'We ship the pricing page in November, a month earlier than planned.',
  p3: 'The team spent the quarter on the parts of the product people use every day: the editor, the search, and the way files are shared between computers.',
  p4: 'Next quarter is about the first hour: what a new person sees, and what they come back for.',
}
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
export async function threadsDocx({ comments = THREADS } = {}) {
  const JSZip = require('jszip')
  const z = new JSZip()
  const ref = (id) => `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`
  let n = 0x1A000000
  const pid = () => (++n).toString(16).toUpperCase()
  const para = (key, text) => {
    const on = comments.filter((c) => c.on === key)
    const p = pid()
    return `<w:p w14:paraId="${p}" w14:textId="${p}" w:rsidR="00B21C4D" w:rsidRDefault="00B21C4D">${on.map((c) => `<w:commentRangeStart w:id="${c.id}"/>`).join('')}<w:r><w:t>${text}</w:t></w:r>${on.map((c) => `<w:commentRangeEnd w:id="${c.id}"/>${ref(c.id)}`).join('')}</w:p>`
  }
  const head = (text, style) => { const p = pid(); return `<w:p w14:paraId="${p}" w14:textId="${p}" w:rsidR="00B21C4D" w:rsidRDefault="00B21C4D"><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>` }
  const body = [head('Quarterly plan', 'Title'), head('Summary', 'Heading1'), ...Object.entries(THREAD_PARAS).map(([k, t]) => para(k, t))].join('')
  const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml'
  const MS = 'http://schemas.microsoft.com/office'
  z.file('[Content_Types].xml', `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="${WML}.styles+xml"/><Override PartName="/word/comments.xml" ContentType="${WML}.comments+xml"/><Override PartName="/word/commentsExtended.xml" ContentType="${WML}.commentsExtended+xml"/><Override PartName="/word/commentsIds.xml" ContentType="${WML}.commentsIds+xml"/><Override PartName="/word/commentsExtensible.xml" ContentType="${WML}.commentsExtensible+xml"/><Override PartName="/word/people.xml" ContentType="${WML}.people+xml"/></Types>`)
  z.file('_rels/.rels', `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
  z.file('word/_rels/document.xml.rels', `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/><Relationship Id="rId5" Type="${MS}/2011/relationships/commentsExtended" Target="commentsExtended.xml"/><Relationship Id="rId6" Type="${MS}/2016/09/relationships/commentsIds" Target="commentsIds.xml"/><Relationship Id="rId7" Type="${MS}/2018/08/relationships/commentsExtensible" Target="commentsExtensible.xml"/><Relationship Id="rId8" Type="${MS}/2011/relationships/people" Target="people.xml"/></Relationships>`)
  z.file('word/document.xml', `${XML_HEAD}<w:document ${WORD_NS}><w:body>${body}<w:sectPr w:rsidR="00B21C4D"><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>`)
  z.file('word/styles.xml', `${XML_HEAD}<w:styles ${WORD_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="278" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/><w:rPr><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:color w:val="0F4761"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style><w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style><w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style></w:styles>`)
  z.file('word/comments.xml', `${XML_HEAD}<w:comments ${WORD_NS}>${comments.map((c) => `<w:comment w:id="${c.id}" w:author="${c.author}" w:date="${c.date}" w:initials="${c.initials}"><w:p w14:paraId="${c.pid}" w14:textId="77777777" w:rsidR="00B21C4D" w:rsidRDefault="00B21C4D"><w:pPr><w:pStyle w:val="CommentText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r><w:r><w:t>${c.text}</w:t></w:r></w:p></w:comment>`).join('')}</w:comments>`)
  z.file('word/commentsExtended.xml', `${XML_HEAD}<w15:commentsEx ${WORD_NS}>${comments.map((c) => `<w15:commentEx w15:paraId="${c.pid}"${c.parent ? ` w15:paraIdParent="${c.parent}"` : ''} w15:done="${c.done ? 1 : 0}"/>`).join('')}</w15:commentsEx>`)
  z.file('word/commentsIds.xml', `${XML_HEAD}<w16cid:commentsIds ${WORD_NS}>${comments.map((c) => `<w16cid:commentId w16cid:paraId="${c.pid}" w16cid:durableId="${c.durable}"/>`).join('')}</w16cid:commentsIds>`)
  z.file('word/commentsExtensible.xml', `${XML_HEAD}<w16cex:commentsExtensible ${WORD_NS}>${comments.map((c) => `<w16cex:commentExtensible w16cex:durableId="${c.durable}" w16cex:dateUtc="${c.date}"/>`).join('')}</w16cex:commentsExtensible>`)
  z.file('word/people.xml', `${XML_HEAD}<w15:people ${WORD_NS}>${[...new Set(comments.map((c) => c.author))].map((a) => `<w15:person w15:author="${a}"><w15:presenceInfo w15:providerId="None" w15:userId="${a}"/></w15:person>`).join('')}</w15:people>`)
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
