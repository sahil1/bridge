// A whiteboard as a PDF: the board's SVG (Excalidraw's own export) drawn into the PDF as lines,
// shapes and real text with jsPDF and svg2pdf.js (both MIT), loaded only when a PDF is asked for.
// Text goes in in the PDF's own Helvetica (Courier for code), which covers Western European
// languages; a board with other scripts (Chinese, Hindi…) goes in as a sharp picture instead, as
// those fonts can't be put in the PDF yet.
//   A dark PDF: Excalidraw darkens its SVG with a CSS filter, which a PDF has no such thing as, so
//   the colours are turned here the same way (invert 93%, then hue turned 180°), pictures drawn as
//   SVG too. Photos stay as they are, as on the board.

const LATIN = /^[\u0000-ÿ–—‘’‚“”„†‡•…‰‹›€™]*$/
// Excalidraw's dark filter, on one colour.
const HUE = [[-0.574, 1.43, 0.144], [0.426, 0.43, 0.144], [0.426, 1.43, -0.856]]
function darken(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim())
  if (!m) return color
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]
  const inv = [0, 2, 4].map((i) => 237.15 - 0.86 * parseInt(h.slice(i, i + 2), 16))
  const out = HUE.map((row) => Math.max(0, Math.min(255, Math.round(row[0] * inv[0] + row[1] * inv[1] + row[2] * inv[2]))))
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
const darkenAll = (s) => s.replace(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi, (c) => darken(c))
function darkenSvg(root) {
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const a of ['fill', 'stroke', 'stop-color', 'color']) { const v = el.getAttribute(a); if (v) el.setAttribute(a, darkenAll(v)) }
    const st = el.getAttribute('style')
    if (st) el.setAttribute('style', darkenAll(st))
    // An SVG picture (an icon) turned too; a photo stays.
    for (const a of ['href', 'xlink:href']) {
      const v = el.getAttribute(a)
      if (v && v.startsWith('data:image/svg+xml;base64,')) el.setAttribute(a, `data:image/svg+xml;base64,${btoa(darkenAll(atob(v.slice(26))))}`)
    }
  }
  root.removeAttribute('filter')
}

// name: for the PDF's title. svg: Excalidraw's exportToSvg of what's to go in. png(): a picture of
// it, for a board whose words the PDF's fonts can't show. Returns the PDF as a Blob.
export async function svgToPdf(svg, { dark = false, name = 'Whiteboard', png } = {}) {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
  const w = parseFloat(svg.getAttribute('width')) || 800, h = parseFloat(svg.getAttribute('height')) || 600
  const doc = new jsPDF({ orientation: w > h ? 'landscape' : 'portrait', unit: 'pt', format: [w, h], compress: true })
  doc.setProperties({ title: name, creator: 'Bridge AI' })
  const words = [...svg.querySelectorAll('text')].map((t) => t.textContent || '').join('')
  if (!LATIN.test(words) && png) {
    const blob = await png()
    const data = new Uint8Array(await blob.arrayBuffer())
    doc.addImage(data, 'PNG', 0, 0, w, h)
    return doc.output('blob')
  }
  // The fonts embedded in the SVG are for browsers; the PDF uses its own.
  svg.querySelectorAll('style').forEach((s) => s.remove())
  for (const t of svg.querySelectorAll('text')) t.setAttribute('font-family', /cascadia|comic|mono/i.test(t.getAttribute('font-family') || '') ? 'courier' : 'helvetica')
  if (dark) darkenSvg(svg)
  // svg2pdf reads styles as a browser works them out, so the SVG is in the page while it's drawn.
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-100000px;top:0;width:0;height:0;overflow:hidden'
  holder.append(svg)
  document.body.append(holder)
  try { await svg2pdf(svg, doc, { x: 0, y: 0, width: w, height: h }) } finally { holder.remove() }
  return doc.output('blob')
}
