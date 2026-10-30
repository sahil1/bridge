// Reads a blocked agent's screen into a question: tabs, title, options, review. Used by Question.jsx,
// and by the server for notifications (server/notify.js), so both read a question the same way.
// eslint-disable-next-line no-control-regex
const strip = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '')
const RULE = /^\s*[─━]{8,}\s*$/
const EDGE = /^\s*([─━╌┄┈═]{8,}\s*|[╭┌].*)$/ // where a menu's box or panel starts
const OPTION = /^\s*(?:[❯›>]\s*)?(\d+)\.\s+(.*)$/
// A menu without numbers ("❯ No, exit" over "  Yes, I trust this folder"), answered with the
// arrows: the row with the pointer, the rows level with its text, and the hint under them.
const POINTER = /^(\s*)[❯›]\s+(\S.*)$/
const HINT = /Enter to (confirm|select)|Esc to (cancel|go back|exit)|to navigate/i

function arrowMenu(lines) {
  let c = -1
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 40); i--) if (POINTER.test(lines[i])) { c = i; break }
  if (c < 0) return null
  const col = lines[c].length - POINTER.exec(lines[c])[2].length
  const lead = (l) => l.length - l.trimStart().length
  const inMenu = (i) => i === c || (lines[i].trim() && !HINT.test(lines[i]) && lead(lines[i]) >= col)
  let start = c
  while (start > 0 && inMenu(start - 1)) start--
  let end = c
  while (end + 1 < lines.length && inMenu(end + 1)) end++
  const options = []
  for (let i = start; i <= end; i++) {
    const p = POINTER.exec(lines[i])
    if (p && i === c) options.push({ n: null, i: options.length, label: p[2].trim(), desc: '', checked: null, selected: true })
    else if (lead(lines[i]) === col) options.push({ n: null, i: options.length, label: lines[i].trim(), desc: '', checked: null, selected: false })
    else if (options.length) { const last = options.at(-1); last.desc = last.desc ? `${last.desc} ${lines[i].trim()}` : lines[i].trim() }
    else start = i + 1 // indented text above the first option is the question's, not the menu's
  }
  // Two or more answers, and the hint under them ("Enter to confirm · Esc to cancel"), so an input
  // box ("› Ask Codex") or a quote in the chat is never taken for one.
  const below = lines.slice(end + 1, end + 4).find((l) => l.trim())
  if (options.length < 2 || !below || !HINT.test(below)) return null
  const ask = []
  for (let i = start - 1; i >= Math.max(0, start - 12) && !EDGE.test(lines[i]); i--) { const l = lines[i].replace(/[│┃]/g, '').trim(); if (l) ask.unshift(l) }
  return { start, q: { kind: 'menu', arrows: true, at: options.findIndex((o) => o.selected), tabs: [], title: '', ask, multi: false, options, other: null, chat: null } }
}

export function parseScreen(ansi) {
  const raw = String(ansi || '').split('\n')
  const lines = raw.map(strip)
  // Work on the bottom of the screen: from the last tab row or the start of the last menu.
  let tabRow = -1
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 60); i--) if (/^\s*←.*→\s*$/.test(lines[i]) && /[☐☒✔]/.test(lines[i])) { tabRow = i; break }
  const firstOpt = (() => { let k = -1; for (let i = lines.length - 1; i >= Math.max(0, lines.length - 40); i--) { if (OPTION.test(lines[i])) k = i; else if (k >= 0 && RULE.test(lines[i]) && i < k - 12) break } return k })()
  // A menu without numbers below everything numbered (a numbered list in the chat above it isn't it).
  const arrows = tabRow < 0 ? arrowMenu(lines) : null
  if (arrows && (firstOpt < 0 || !lines.slice(arrows.start).some((l) => OPTION.test(l)))) return arrows.q
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
