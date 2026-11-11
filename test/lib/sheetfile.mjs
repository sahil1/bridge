// An Excel file with threaded comments, as Excel 365 writes one, for Studio's tests: a budget whose
// cells have threads (xl/threadedComments/threadedComment1.xml: each comment's cell, time, person,
// id, the one it answers, and done on a resolved thread's first), the people who wrote them
// (xl/persons/person.xml, from the workbook), and for older Excels each thread's placeholder note
// in the sheet's comments part (written by tc={the thread's id}, with xr:uid, saying "[Threaded
// comment]" and what the thread says) with its box in the VML, beside a plain note of the old kind.
// Avery asks about hosting and Sam answers; Avery's note on the design quote is resolved; and Sam
// asks @bridge to double the travel cost (it came in the file, so it isn't yours to send).
import path from 'node:path'
import { createRequire } from 'node:module'
import { ROOT } from './harness.mjs'

const require = createRequire(path.join(ROOT, 'package.json'))
const MS = 'http://schemas.microsoft.com/office'
export const PEOPLE = { avery: { id: '{6A1C2B3D-1111-4E5F-8A9B-0C1D2E3F4A5B}', name: 'Avery Stone' }, sam: { id: '{7B2D3C4E-2222-4F60-9BAC-1D2E3F4A5B6C}', name: 'Sam Lee' } }
export const SHEET_THREADS = [
  { id: '{A0000001-0000-4000-8000-000000000001}', ref: 'B2', who: 'avery', dT: '2026-10-01T10:00:00.00', text: 'Is hosting monthly or yearly?' },
  { id: '{A0000001-0000-4000-8000-000000000002}', ref: 'B2', who: 'sam', dT: '2026-10-01T11:30:00.00', text: 'Monthly.', parent: '{A0000001-0000-4000-8000-000000000001}' },
  { id: '{A0000001-0000-4000-8000-000000000003}', ref: 'B3', who: 'avery', dT: '2026-10-02T09:00:00.00', text: 'Check the design quote.', done: true },
  { id: '{A0000001-0000-4000-8000-000000000004}', ref: 'B6', who: 'sam', dT: '2026-10-03T08:00:00.00', text: '@bridge double this cost' },
]
export const NOTE = { ref: 'A2', author: 'Avery Stone', text: 'Ask finance about the hosting plan.' }
const SAY = '[Threaded comment]\n\nYour version of Excel allows you to read this threaded comment; however, any edits to it will get removed if the file is opened in a newer version of Excel. Learn more: https://go.microsoft.com/fwlink/?linkid=870924\n\nComment:\n    '
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'

export async function threadsXlsx() {
  const ExcelJS = require('exceljs')
  const JSZip = require('jszip')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Budget')
  ws.columns = [{ width: 18 }, { width: 12 }, { width: 12 }]
  ws.addRow(['Item', 'Cost'])
  for (const [n, c] of [['Hosting', 120], ['Design', 900], ['Fonts', 45], ['Legal', 610], ['Travel', 300]]) ws.addRow([n, c])
  ws.getCell('A7').value = 'Total'
  ws.getCell('B7').value = { formula: 'SUM(B2:B6)', result: 1975 }
  // A box in the VML for each comment, as ExcelJS draws a note's (the threads' placeholders too).
  const roots = SHEET_THREADS.filter((x) => !x.parent)
  ws.getCell(NOTE.ref).note = NOTE.text
  for (const r of roots) ws.getCell(r.ref).note = 'placeholder'
  const z = await JSZip.loadAsync(await wb.xlsx.writeBuffer())
  // The comments part as Excel 365 writes it: the note by its author, each placeholder by tc={id}.
  const authors = [NOTE.author, ...roots.map((r) => `tc=${r.id}`)]
  const entries = [{ ref: NOTE.ref, xml: `<comment ref="${NOTE.ref}" authorId="0" shapeId="0" xr:uid="{B0000001-0000-4000-8000-000000000009}"><text><r><rPr><b/><sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr><t>${esc(NOTE.author)}:</t></r><r><rPr><sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr><t xml:space="preserve">\n${esc(NOTE.text)}</t></r></text></comment>` },
    ...roots.map((r, i) => ({ ref: r.ref, xml: `<comment ref="${r.ref}" authorId="${i + 1}" shapeId="0" xr:uid="${r.id}"><text><t>${esc(SAY + [r, ...SHEET_THREADS.filter((x) => x.parent === r.id)].map((x, k) => `${k ? 'Reply:\n    ' : ''}${x.text}`).join('\n'))}</t></text></comment>` }))]
  z.file('xl/comments1.xml', `${XML_HEAD}<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="xr" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision"><authors>${authors.map((a) => `<author>${esc(a)}</author>`).join('')}</authors><commentList>${entries.map((e) => e.xml).join('')}</commentList></comments>`)
  z.file('xl/threadedComments/threadedComment1.xml', `${XML_HEAD}<ThreadedComments xmlns="${MS}/spreadsheetml/2018/threadedcomments" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${SHEET_THREADS.map((x) => `<threadedComment ref="${x.ref}" dT="${x.dT}" personId="${PEOPLE[x.who].id}" id="${x.id}"${x.parent ? ` parentId="${x.parent}"` : ''}${x.done ? ' done="1"' : ''}><text>${esc(x.text)}</text></threadedComment>`).join('')}</ThreadedComments>`)
  z.file('xl/persons/person.xml', `${XML_HEAD}<personList xmlns="${MS}/spreadsheetml/2018/threadedcomments" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${Object.values(PEOPLE).map((p) => `<person displayName="${esc(p.name)}" id="${p.id}" userId="${esc(p.name.toLowerCase().replace(' ', '.'))}@example.com" providerId="AD"/>`).join('')}</personList>`)
  const sheetRels = await z.file('xl/worksheets/_rels/sheet1.xml.rels').async('string')
  z.file('xl/worksheets/_rels/sheet1.xml.rels', sheetRels.replace('</Relationships>', `<Relationship Id="rId9" Type="${MS}/2017/10/relationships/threadedComment" Target="../threadedComments/threadedComment1.xml"/></Relationships>`))
  const wbRels = await z.file('xl/_rels/workbook.xml.rels').async('string')
  z.file('xl/_rels/workbook.xml.rels', wbRels.replace('</Relationships>', `<Relationship Id="rId9" Type="${MS}/2017/10/relationships/person" Target="persons/person.xml"/></Relationships>`))
  const ct = await z.file('[Content_Types].xml').async('string')
  z.file('[Content_Types].xml', ct.replace('</Types>', '<Override PartName="/xl/threadedComments/threadedComment1.xml" ContentType="application/vnd.ms-excel.threadedcomments+xml"/><Override PartName="/xl/persons/person.xml" ContentType="application/vnd.ms-excel.person+xml"/></Types>'))
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
