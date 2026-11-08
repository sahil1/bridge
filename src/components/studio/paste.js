// What's pasted into a document from another app, and what's copied out of one to another.
//
// In: Word's lists (paragraphs it marks mso-list, each with its bullet or number typed in front of
// it) and HTML's (Google Docs, a web page: ul, ol and li, nested) become what the editor reads. In a
// Word file's editor (paras) a list is paragraphs with their kind and level (wordschema.js), each
// pasted list its own; in Markdown's, lists stay HTML lists and Word's become them. Word's bullets
// typed in front are taken out, a quote is Word's Quote style where the document has it, and a
// Google Docs checklist is a checklist.
//
// Out: a Word file's list paragraphs are wrapped in ul, ol and li, so Google Docs, Word, Mail or a
// web page gets a list, not paragraphs that lost their bullets.

const NUMBERED = /^(\d+|[a-z]{1,3}|[ivxlcdm]+)[.)]$/i
const NUMBER_STYLES = /decimal|alpha|roman|latin|greek|armenian|georgian|cjk|hebrew|kana|hiragana|katakana/i
let pastes = 0

// Word's own bullet or number in front of a list paragraph, between its [if !supportLists] and
// [endif] (comments, as a browser reads them), or in a span it marks mso-list:Ignore: taken out,
// and what it was.
function wordMarker(p) {
  let text = ''
  for (const el of [...p.querySelectorAll('[style*="mso-list"]')]) {
    if (/mso-list:\s*ignore/i.test(el.getAttribute('style') || '')) { text += el.textContent; el.remove() }
  }
  const walk = document.createTreeWalker(p, NodeFilter.SHOW_COMMENT)
  const starts = []
  for (let c = walk.nextNode(); c; c = walk.nextNode()) if (/^\[if !supportLists\]/i.test(c.data)) starts.push(c)
  for (const c of starts) {
    let n = c.nextSibling
    while (n && !(n.nodeType === 8 && /^\[endif\]/i.test(n.data))) { const next = n.nextSibling; text += n.textContent || ''; n.remove(); n = next }
  }
  return text.replace(/[\s ]+/g, '')
}

// An li's kind: a checklist's item (Google Docs marks them), a number, or a bullet.
function liKind(li, list) {
  if (li.getAttribute('role') === 'checkbox') return li.getAttribute('aria-checked') === 'true' ? 'checked' : 'check'
  const type = li.style.listStyleType || list.style.listStyleType || list.getAttribute('type') || ''
  if (type && type !== 'none') return NUMBER_STYLES.test(type) || /^[1aAiI]$/.test(type) ? 'number' : 'bullet'
  return list.tagName === 'OL' ? 'number' : 'bullet'
}

// A list and the lists in it, as paragraphs: each item's first block marked with its kind and level,
// what else is in the item after it, then its own lists a level down.
function flatten(doc, list, depth, id) {
  const out = []
  for (const li of [...list.children]) {
    if (li.tagName !== 'LI') { out.push(li); continue }
    const level = Number(li.getAttribute('aria-level')) ? Number(li.getAttribute('aria-level')) - 1 : depth
    const blocks = [], nested = []
    let inline = []
    const flush = () => {
      if (!inline.some((n) => n.nodeType === 1 || n.textContent.trim())) { inline = []; return }
      const p = doc.createElement('p')
      p.append(...inline)
      blocks.push(p)
      inline = []
    }
    for (const c of [...li.childNodes]) {
      if (c.nodeType === 1 && /^(UL|OL)$/.test(c.tagName)) { flush(); nested.push(...flatten(doc, c, level + 1, id)) }
      else if (c.nodeType === 1 && /^(P|H[1-6]|DIV|BLOCKQUOTE|PRE)$/.test(c.tagName)) { flush(); blocks.push(c) }
      else inline.push(c)
    }
    flush()
    if (!blocks.length) blocks.push(doc.createElement('p'))
    const first = blocks[0]
    // One copied from a Word file here keeps its own list.
    if (!first.hasAttribute('data-num')) {
      first.setAttribute('data-list', liKind(li, list))
      first.setAttribute('data-lvl', String(Math.min(8, level)))
      first.setAttribute('data-lid', id)
    }
    out.push(...blocks, ...nested)
  }
  return out
}

// Paragraphs marked as list items, back into HTML lists (for Markdown, and for what's copied out).
function nest(doc, root) {
  const item = (el) => el?.nodeType === 1 && el.hasAttribute('data-list')
  let el = root.firstChild
  while (el) {
    if (!item(el)) { el = el.nextSibling; continue }
    const run = []
    let after = el
    while (item(after)) { run.push(after); after = after.nextSibling }
    const out = doc.createDocumentFragment()
    const open = [] // the lists open now, outermost first: { level, list }
    for (const p of run) {
      const level = Number(p.getAttribute('data-lvl')) || 0
      const kind = p.getAttribute('data-list')
      const tag = kind === 'number' ? 'OL' : 'UL'
      while (open.length && open[open.length - 1].level > level) open.pop()
      if (open.length && open[open.length - 1].level === level && open[open.length - 1].list.tagName !== tag) open.pop()
      let at = open[open.length - 1]
      if (!at || at.level < level) {
        const list = doc.createElement(tag)
        list.setAttribute('data-tight', 'true')
        if (at) (at.list.lastElementChild || at.list).append(list)
        else out.append(list)
        at = { level, list }
        open.push(at)
      }
      const li = doc.createElement('li')
      if (kind === 'check' || kind === 'checked') { li.setAttribute('data-type', 'taskItem'); li.setAttribute('data-checked', String(kind === 'checked')); at.list.setAttribute('data-type', 'taskList') }
      li.append(p)
      at.list.append(li)
    }
    root.insertBefore(out, after)
    el = after
  }
}

// Pasted HTML, as the editor should read it. paras: a Word file's editor; quote: its Quote style's
// id when it has one; title: its Title's.
export function cleanPaste(html, { paras = true, quote = null, title = null } = {}) {
  if (!/<(ul|ol|li|blockquote|h[1-6])\b|mso-list|class="?Mso(Title|Quote)/i.test(html)) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  const id = `p${++pastes}-${Date.now().toString(36)}`
  // Word's: a list paragraph says its list and level in its style (mso-list:l0 level1 lfo1).
  let wordLists = 0
  for (const p of [...body.querySelectorAll('p')]) {
    const m = /mso-list:\s*(l\d+)\s+level(\d+)/i.exec(p.getAttribute('style') || '')
    if (!m) continue
    const marker = wordMarker(p)
    p.setAttribute('data-list', NUMBERED.test(marker) ? 'number' : marker === '☐' || marker === '□' ? 'check' : 'bullet')
    p.setAttribute('data-lvl', String(Math.min(8, Number(m[2]) - 1)))
    p.setAttribute('data-lid', `${id}-${m[1]}`)
    p.style.removeProperty('text-indent')
    p.style.removeProperty('margin-left')
    wordLists++
  }
  if (title) for (const p of body.querySelectorAll('p.MsoTitle')) p.setAttribute('data-s', title)
  if (paras) {
    for (const [i, list] of [...body.querySelectorAll('ul, ol')].filter((l) => !l.parentElement?.closest('ul, ol')).entries()) {
      // What the editor said about a slice copied from it, kept on what it starts with.
      const slice = list.getAttribute('data-pm-slice')
      const out = flatten(doc, list, 0, `${id}-${i}`)
      if (slice && out[0]?.nodeType === 1) out[0].setAttribute('data-pm-slice', slice)
      list.replaceWith(...out)
    }
    // A quote: its paragraphs in the Quote style.
    for (const q of [...body.querySelectorAll('blockquote')].reverse()) {
      if (!quote) { q.replaceWith(...q.childNodes); continue }
      const kids = [...q.childNodes]
      const out = []
      let inline = []
      const flush = () => { if (inline.some((n) => n.textContent.trim() || n.nodeType === 1)) { const p = doc.createElement('p'); p.append(...inline); out.push(p) } inline = [] }
      for (const k of kids) { if (k.nodeType === 1 && /^(P|DIV|H[1-6])$/.test(k.tagName)) { flush(); out.push(k) } else inline.push(k) }
      flush()
      for (const p of out) if (p.tagName === 'P' || p.tagName === 'DIV') p.setAttribute('data-s', quote)
      q.replaceWith(...out)
    }
    for (const p of body.querySelectorAll('p.MsoQuote')) if (quote) p.setAttribute('data-s', quote)
    // A heading (a title, a quote) from another app takes the document's own look for it: the font,
    // size and colour that app wrote on each of its words (Google Docs writes them on every one) are
    // left out, its bold, italics and links kept. One copied in Studio (the editor marks its copies)
    // keeps all of its own.
    if (!body.querySelector('[data-pm-slice]')) {
      const styled = ':is(h1, h2, h3, h4, h5, h6, p[data-s])'
      for (const el of body.querySelectorAll(`${styled}, ${styled} :is([style], font)`)) {
        for (const k of ['font-family', 'font-size', 'color', 'font']) el.style?.removeProperty(k)
        if (el.tagName === 'FONT') for (const a of ['face', 'size', 'color']) el.removeAttribute(a)
      }
    }
  } else if (wordLists) nest(doc, body)
  return body.innerHTML
}

// What's copied out of a Word file's editor: its list paragraphs in lists of their own kind.
export function listsOut(dom) {
  if (!dom.querySelector?.('[data-list]')) return dom
  nest(dom.ownerDocument || document, dom)
  return dom
}
