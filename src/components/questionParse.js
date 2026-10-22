// Reads a blocked agent's screen into a question: tabs, title, options, review. Used by Question.jsx,
// and by the server for notifications (server/notify.js), so both read a question the same way.
// eslint-disable-next-line no-control-regex
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '')
const RULE = /^\s*[─━]{8,}\s*$/
const EDGE = /^\s*([─━╌┄┈═]{8,}\s*|[╭┌].*)$/ // where a menu's box or panel starts
const OPTION = /^\s*(?:[❯›>]\s*)?(\d+)\.\s+(.*)$/

export function parseScreen(ansi) {
  const raw = String(ansi || '').split('\n')
  const lines = raw.map(strip)
  // Work on the bottom of the screen: from the last tab row or the start of the last menu.
  let tabRow = -1
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 60); i--) if (/^\s*←.*→\s*$/.test(lines[i]) && /[☐☒✔]/.test(lines[i])) { tabRow = i; break }
  const firstOpt = (() => { let k = -1; for (let i = lines.length - 1; i >= Math.max(0, lines.length - 40); i--) { if (OPTION.test(lines[i])) k = i; else if (k >= 0 && RULE.test(lines[i]) && i < k - 12) break } return k })()
  if (tabRow < 0 && firstOpt < 0) return null
  // A menu starts at its last "1." (a numbered list in the chat just above isn't part of it).
  let first = firstOpt
  if (tabRow < 0) for (let i = lines.length - 1; i > firstOpt; i--) if (OPTION.exec(lines[i])?.[1] === '1') { first = i; break }
  const start = tabRow >= 0 ? tabRow + 1 : first
  // What a menu asks sits just above it ("Do you want to proceed?" and what it's about), up to
  // the rule or box it starts in.
  const ask = []
  if (tabRow < 0) for (let i = start - 1; i >= Math.max(0, start - 12) && !EDGE.test(lines[i]); i--) { const l = lines[i].replace(/[│┃]/g, '').trim(); if (l) ask.unshift(l) }

  // Tabs: "☒ Fruit  ☐ Colors  ✔ Submit"; the open one has a background colour.
  let tabs = []
  if (tabRow >= 0) {
    const hit = /\x1b\[[0-9;]*48;[0-9;]*m([^\x1b]*)/.exec(raw[tabRow])
    const activeText = hit ? strip(hit[1]).replace(/[☐☒✔]/g, '').trim() : null
    tabs = [...lines[tabRow].matchAll(/([☐☒✔])\s+([^☐☒✔→]+?)(?=\s{2,}|\s*[☐☒✔→]|$)/g)].map((m) => ({ label: m[2].trim(), done: m[1] === '☒', submit: m[1] === '✔', active: m[2].trim() === activeText }))
  }

  const body = lines.slice(start).filter((l) => !/(Enter to (select|confirm)|Esc to cancel|to navigate)/i.test(l))
  // Review step: "Review your answers" with ● question / → answer pairs.
  if (body.some((l) => /Review your answers/i.test(l))) {
    const review = []
    body.forEach((l, i) => { const q = /^\s*●\s+(.*)$/.exec(l); if (q) review.push({ q: q[1].trim(), a: (/^\s*→\s+(.*)$/.exec(body[i + 1] || '') || [])[1] || '' }) })
    const opts = body.map((l) => OPTION.exec(l)).filter(Boolean).map((m) => ({ n: m[1], label: m[2].trim() }))
    return { kind: 'review', tabs, review, options: opts }
  }

  const title = []
  const options = []
  for (const l of body) {
    if (RULE.test(l)) continue
    const m = OPTION.exec(l)
    if (m) {
      let label = m[2].trim()
      const box = /^\[([ ✔x])\]\s*(.*)$/.exec(label)
      const checked = box ? box[1] !== ' ' : null
      if (box) label = box[2]
      options.push({ n: m[1], label, desc: '', checked, selected: /^\s*[❯›>]/.test(l) })
      continue
    }
    if (!l.trim()) continue
    if (options.length) {
      const last = options.at(-1)
      // An indented line under an option is its description ("Submit" under a checkbox list is the confirm row).
      if (/^\s{3,}\S/.test(l) && !/^\s*Submit\s*$/.test(l)) last.desc = last.desc ? `${last.desc} ${l.trim()}` : l.trim()
    } else title.push(l.trim())
  }
  if (!options.length) return null
  const multi = options.some((o) => o.checked != null)
  const other = options.find((o) => /^Type something\.?$/i.test(o.label))
  const chat = options.find((o) => /^Chat about this$/i.test(o.label))
  return {
    kind: tabRow >= 0 ? 'question' : 'menu',
    tabs,
    title: title.slice(-3).join(' '),
    ask,
    multi,
    options: options.filter((o) => o !== other && o !== chat),
    other,
    chat,
  }
}
