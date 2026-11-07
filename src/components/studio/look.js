// A new Word file's look, from a design pack: its fonts and colours, as docx (docx.js) takes them.
// { body: { font, size, color }, h: [{ font, size, color, bold, italics }, … six] }, sizes in
// half-points and colours as RRGGBB, as Word has them; what a pack doesn't say is left out. (A Word
// file that's already there keeps its own look: ooxml.js reads and writes it as it is.)
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
