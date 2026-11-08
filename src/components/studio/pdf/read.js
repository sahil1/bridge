// What AI Assist's Sign this reads from a PDF open in pdf.js: each page's text (for the model to
// explain), and its words with where they are, the lines drawn on it and its form fields (for
// find.js), all in the page's own points.

// The text runs on a page, laid flat (sideways text is left out: no one signs along it).
function itemsOf(tc) {
  const out = []
  for (const it of tc.items) {
    if (!it.str || !it.transform) continue
    const [a, b, c, d, e, f] = it.transform
    if (Math.abs(b) > Math.abs(a) * 0.1) continue
    out.push({ str: it.str, x: e, y: f, w: it.width, h: it.height || Math.hypot(c, d) })
  }
  return out
}
// A page's text as it reads, a line a line.
export const textOf = (tc) => tc.items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

// Thin shapes it paints: where a path filled or stroked sits, with the transforms it's drawn in.
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]
const at = (m, x, y) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]]
function shapesOf(ops, OPS) {
  const PAINT = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])
  const out = []
  const stack = []
  let m = [1, 0, 0, 1, 0, 0]
  for (let i = 0; i < ops.fnArray.length && out.length < 4000; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i]
    if (fn === OPS.save || fn === OPS.paintFormXObjectBegin) { stack.push(m); if (fn === OPS.paintFormXObjectBegin && a?.[0]) m = mul(m, a[0]) }
    else if (fn === OPS.restore || fn === OPS.paintFormXObjectEnd) m = stack.pop() || [1, 0, 0, 1, 0, 0]
    else if (fn === OPS.transform && a) m = mul(m, a)
    else if (fn === OPS.constructPath && a && PAINT.has(a[0]) && a[2]) {
      const [x0, y0, x1, y1] = a[2]
      if (![x0, y0, x1, y1].every(Number.isFinite)) continue
      const pts = [at(m, x0, y0), at(m, x1, y0), at(m, x0, y1), at(m, x1, y1)]
      out.push([Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))])
    }
  }
  return out
}

// Its form fields, as pdf.js reads them.
const fieldsOf = (anns) => anns.filter((x) => x.subtype === 'Widget' && x.fieldType).map((x) => ({
  name: x.fieldName || '', type: x.fieldType, rect: x.rect, label: x.alternativeText || '',
  value: Array.isArray(x.fieldValue) ? x.fieldValue.join(' ') : x.fieldValue || '', readOnly: !!x.readOnly, hidden: !!x.hidden,
}))

// Everything find.js needs from one page.
export async function pageData(lib, doc, n) {
  const page = await doc.getPage(n)
  const [tc, anns, ops] = await Promise.all([
    page.getTextContent(),
    page.getAnnotations({ intent: 'display' }).catch(() => []),
    page.getOperatorList().catch(() => null),
  ])
  return { n, view: page.view, rotate: page.rotate, items: itemsOf(tc), shapes: ops ? shapesOf(ops, lib.OPS) : [], fields: fieldsOf(anns), text: textOf(tc) }
}

// The text of every page, for the model: at most `max` characters in all.
export async function pagesText(doc, max = 200_000) {
  const out = []
  let used = 0
  for (let n = 1; n <= doc.numPages && used < max; n++) {
    const text = textOf(await (await doc.getPage(n)).getTextContent()).slice(0, max - used)
    out.push({ n, text })
    used += text.length
  }
  return { pages: out, all: doc.numPages }
}
