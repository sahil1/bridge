// A Word file's look: its text's font, size and colour, and each heading's, from its styles
// (word/styles.xml, with the theme's fonts where a style names them). mammoth reads what a file
// says, not how it looks, so without this a save in Studio put every Word file in docx's own look.
// Kept through a save, shown while it's edited, and set from a design pack for a new document.
// { body: { font, size, color }, h: [{ font, size, color, bold, italics }, … six] }, sizes in
// half-points and colours as RRGGBB, as Word has them; what a file doesn't say is left out.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'

export async function lookOf(buf) {
  try {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(buf)
    const xml = await zip.file('word/styles.xml')?.async('string')
    if (!xml) return null
    const theme = await zip.file(/^word\/theme\/theme\d*\.xml$/)[0]?.async('string')
    const th = theme ? new DOMParser().parseFromString(theme, 'application/xml') : null
    const themeFont = (which) => th?.getElementsByTagNameNS(A, which === 'major' ? 'majorFont' : 'minorFont')[0]?.getElementsByTagNameNS(A, 'latin')[0]?.getAttribute('typeface') || null
    const d = new DOMParser().parseFromString(xml, 'application/xml')
    const kid = (el, tag) => (el ? [...el.childNodes].find((n) => n.localName === tag && n.namespaceURI === W) : null)
    const val = (el, attr = 'val') => el?.getAttributeNS(W, attr) ?? null
    const on = (el) => !!el && !['0', 'false', 'off'].includes(val(el) || '')
    const runOf = (rPr) => {
      if (!rPr) return {}
      const f = kid(rPr, 'rFonts')
      const named = val(f, 'asciiTheme') || val(f, 'hAnsiTheme') // majorHAnsi, minorHAnsi…
      const font = val(f, 'ascii') || val(f, 'hAnsi') || (named ? themeFont(/^major/.test(named) ? 'major' : 'minor') : null)
      const size = Number(val(kid(rPr, 'sz'))) || null
      const color = /^[0-9a-f]{6}$/i.test(val(kid(rPr, 'color')) || '') ? val(kid(rPr, 'color')).toUpperCase() : null
      const b = kid(rPr, 'b'), i = kid(rPr, 'i')
      return Object.fromEntries(Object.entries({ font, size, color, bold: b ? on(b) : null, italics: i ? on(i) : null }).filter(([, v]) => v != null))
    }
    const styles = [...d.getElementsByTagNameNS(W, 'style')]
    const named = (re) => styles.find((s) => re.test(val(kid(s, 'name')) || ''))
    const defaults = runOf(kid(kid(kid(d.documentElement, 'docDefaults'), 'rPrDefault'), 'rPr'))
    const normal = styles.find((s) => val(s, 'type') === 'paragraph' && val(s, 'default') === '1') || named(/^normal$/i)
    const body = { ...defaults, ...runOf(kid(normal, 'rPr')) }
    delete body.bold; delete body.italics
    const h = Array.from({ length: 6 }, (_, n) => runOf(kid(named(new RegExp(`^heading ${n + 1}$`, 'i')), 'rPr')))
    return Object.keys(body).length || h.some((x) => Object.keys(x).length) ? { body, h } : null
  } catch { return null }
}

// A design pack as a Word file's look: its body font and text colour, its heading font in its
// accent colour. A Word page is white, so a colour too light to read on white (a dark pack's
// text) is left to Word's own.
const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.slice(1).toUpperCase() : undefined)
const onWhite = (c) => {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05)
}
export function lookOfPack(pack) {
  if (!pack) return null
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null))
  const text = hex(pack.colors?.text), accent = hex(pack.colors?.accent)
  return {
    body: clean({ font: pack.fonts?.body, color: text && onWhite(text) >= 4.5 ? text : undefined }),
    h: Array.from({ length: 6 }, () => clean({ font: pack.fonts?.heading, color: accent && onWhite(accent) >= 2 ? accent : undefined })),
  }
}

// For docx (styles.default): what the look says over docx's own heading looks, which a heading's
// run would otherwise replace whole.
const DOCX_HEADINGS = [{ color: '2E74B5', size: 32 }, { color: '2E74B5', size: 26 }, { color: '1F4D78', size: 24 }, { color: '2E74B5', italics: true }, { color: '2E74B5' }, { color: '1F4D78' }]
export function docxStyles(look) {
  if (!look) return undefined
  const out = { document: { run: { ...look.body } } }
  DOCX_HEADINGS.forEach((d, i) => { out[`heading${i + 1}`] = { run: { ...d, ...(look.h?.[i] || {}) } } })
  return { default: out }
}

// A font's name as CSS can take it.
export const fontCss = (name, fallback = 'sans-serif') => `'${String(name).replace(/['"\\]/g, '')}', ${fallback}`

// For the editor: the look as CSS custom properties on the page (Studio's document styles use them).
// colours: whether it says any, so the page is drawn as paper, white, the way it prints.
export const lookColours = (look) => !!(look?.body?.color || look?.h?.some((x) => x.color))
export function lookCss(look) {
  if (!look) return undefined
  const s = {}
  const pt = (half) => `${half / 2}pt`
  if (look.body?.font) s['--doc-font'] = fontCss(look.body.font, /serif|georgia|times|garamond|cambria|merriweather/i.test(look.body.font) && !/sans/i.test(look.body.font) ? 'serif' : 'sans-serif')
  if (look.body?.size) s['--doc-size'] = pt(look.body.size)
  if (look.body?.color) s['--doc-color'] = `#${look.body.color}`
  look.h?.forEach((x, i) => {
    if (x.font) s[`--doc-h${i + 1}-font`] = fontCss(x.font)
    if (x.color) s[`--doc-h${i + 1}-color`] = `#${x.color}`
    if (x.size) s[`--doc-h${i + 1}-size`] = pt(x.size)
  })
  return s
}
