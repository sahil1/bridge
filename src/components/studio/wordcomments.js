import { parseXml, raw, els, findAll, textIn, esc } from './ooxml.js'

// A Word file's comments, as Word keeps them, read as threads and written back. Each comment is in
// comments.xml: its words, who wrote it and when. Since Word 2013, commentsExtended.xml says which
// comment one answers (a reply's parent, by the w14:paraId of each comment's last paragraph) and
// whether it's resolved (done); Word 365 adds commentsIds.xml (a lasting id for each) and
// commentsExtensible.xml (its time in UTC), and people.xml (who wrote them). In the document, a
// comment's words are between its commentRangeStart and commentRangeEnd, with its commentReference
// (the mark Word shows) after them; a reply has its own, beside its parent's, as Word puts them.
// Saved, a comment Studio didn't change is written as it was, byte for byte, and a part with
// nothing changed in it isn't written at all. No browser APIs here, so the tests read and write in Node.

// AI Assist's replies are signed with this name, in the file too (Word shows it as the author).
export const AI_AUTHOR = 'AI Assist'
const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  w15: 'http://schemas.microsoft.com/office/word/2012/wordml',
  w16cid: 'http://schemas.microsoft.com/office/word/2016/wordml/cid',
  w16cex: 'http://schemas.microsoft.com/office/word/2018/wordml/cex',
}
// Each part: its relationship from the document, its content type, its name beside the document,
// and its root as Word writes a new one.
const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml'
export const PARTS = {
  comments: { rel: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments', type: `${WML}.comments+xml`, name: 'comments.xml', root: 'w:comments', ns: ['w', 'w14'] },
  ext: { rel: 'http://schemas.microsoft.com/office/2011/relationships/commentsExtended', type: `${WML}.commentsExtended+xml`, name: 'commentsExtended.xml', root: 'w15:commentsEx', ns: ['w15'] },
  ids: { rel: 'http://schemas.microsoft.com/office/2016/09/relationships/commentsIds', type: `${WML}.commentsIds+xml`, name: 'commentsIds.xml', root: 'w16cid:commentsIds', ns: ['w16cid'] },
  cex: { rel: 'http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible', type: `${WML}.commentsExtensible+xml`, name: 'commentsExtensible.xml', root: 'w16cex:commentsExtensible', ns: ['w16cex'] },
  people: { rel: 'http://schemas.microsoft.com/office/2011/relationships/people', type: `${WML}.people+xml`, name: 'people.xml', root: 'w15:people', ns: ['w15'] },
}

// Elements and attributes by their local name, whatever prefix the file gives them.
const local = (name) => name.slice(name.indexOf(':') + 1)
const all = (n, name, out = []) => { for (const k of els(n)) { if (local(k.name) === name) out.push(k); else all(k, name, out) } return out }
const attr = (n, name) => { for (const [k, v] of Object.entries(n?.attrs || {})) if (local(k) === name) return v; return null }

// A comment's words: its paragraphs, a line each, its line breaks and tabs kept.
function wordsOf(c) {
  const para = (p) => {
    let s = ''
    const walk = (n) => { for (const k of n.kids || []) { if (!k.name) continue; const l = local(k.name); if (l === 't') s += textIn(k); else if (l === 'br' || l === 'cr') s += '\n'; else if (l === 'tab') s += '\t'; else if (l !== 'instrText' && l !== 'delText') walk(k) } }
    walk(p)
    return s
  }
  return all(c, 'p').map(para).join('\n').replace(/\s+$/, '')
}

// Every comment in the file, in the order it has them: { id, author, initials, date, text, pid
// (its last paragraph's paraId), parent (the id of the comment it answers), done, durable, raw }.
export function commentsOf(m) {
  const p = m.cparts || {}
  if (!p.comments) return []
  const list = all(parseXml(p.comments.xml), 'comment').map((c) => {
    const ps = all(c, 'p')
    return {
      id: String(attr(c, 'id')), author: attr(c, 'author') || '', initials: attr(c, 'initials') || '', date: attr(c, 'date') || null,
      text: wordsOf(c), pid: (ps.length && attr(ps[ps.length - 1], 'paraId')) || null, parent: null, done: false, durable: null, raw: raw(c),
    }
  })
  const byPid = new Map(list.filter((c) => c.pid).map((c) => [c.pid.toUpperCase(), c]))
  if (p.ext) for (const e of all(parseXml(p.ext.xml), 'commentEx')) {
    const c = byPid.get(String(attr(e, 'paraId') || '').toUpperCase())
    if (!c) continue
    const parent = byPid.get(String(attr(e, 'paraIdParent') || '').toUpperCase())
    if (parent && parent !== c) c.parent = parent.id
    c.done = ['1', 'true', 'on'].includes(String(attr(e, 'done') || '0'))
  }
  if (p.ids) for (const e of all(parseXml(p.ids.xml), 'commentId')) { const c = byPid.get(String(attr(e, 'paraId') || '').toUpperCase()); if (c) c.durable = attr(e, 'durableId') }
  // The time in UTC, where Word 365 keeps it (its w:date is the writer's own clock).
  if (p.cex) {
    const at = new Map(all(parseXml(p.cex.xml), 'commentExtensible').map((e) => [attr(e, 'durableId'), attr(e, 'dateUtc')]))
    for (const c of list) if (c.durable && at.get(c.durable)) c.date = at.get(c.durable)
  }
  // A reply to a reply is in its first comment's thread, as Word shows it.
  const byId = new Map(list.map((c) => [c.id, c]))
  for (const c of list) { let top = c.parent, n = 0; while (top && byId.get(top)?.parent && n++ < 50) top = byId.get(top).parent; c.parent = top }
  return list
}

// Threads: each comment that answers none, then its replies, in the file's order.
export function threadsOf(list) {
  const ids = new Set(list.map((c) => c.id))
  return list.filter((c) => !c.parent || !ids.has(c.parent)).map((root) => ({ id: root.id, root, items: [root, ...list.filter((c) => c.parent === root.id)] }))
}

// ---------- Made here ----------
// A paraId Word would give: 8 hex digits under 80000000, unused in the file.
export function freshId(used) {
  for (;;) {
    const v = Math.floor(Math.random() * 0x7ffffffe + 1).toString(16).toUpperCase().padStart(8, '0')
    if (!used.has(v)) { used.add(v); return v }
  }
}
// The paraIds and comment ids the file already has, so what's made here doesn't take one of them.
export function usedIds(m) {
  const used = new Set()
  for (const x of [m.main?.xml, ...Object.values(m.cparts || {}).map((p) => p.xml)]) for (const r of String(x || '').matchAll(/:(?:paraId|textId|durableId)="([0-9A-Fa-f]{8})"/g)) used.add(r[1].toUpperCase())
  return used
}
const initialsOf = (name) => String(name || '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase() || '?'
// A comment made here: { id, author, initials, date, text, pid, parent }, its time to the second.
export function newComment({ list, used, author, text, parent = null, date = new Date() }) {
  const n = Math.max(-1, ...list.map((c) => Number(c.id)).filter(Number.isFinite)) + 1
  return { id: String(n), author, initials: author === AI_AUTHOR ? 'AI' : initialsOf(author), date: date.toISOString().replace(/\.\d+Z$/, 'Z'), text: String(text), pid: freshId(used), parent, done: false, durable: null, raw: null, made: true }
}

// The marks in the document a comment needs, as Word writes them (the editor's xin nodes).
export const anchor = (k, id) => ({ type: 'xin', attrs: { k, id: String(id), t: '', raw: k === 'cs' ? `<w:commentRangeStart w:id="${id}"/>` : k === 'ce' ? `<w:commentRangeEnd w:id="${id}"/>` : `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>` } })

// ---------- Writing ----------
// A comment as Word writes one: a paragraph in the CommentText style, Word's annotation mark first,
// a line break for each new line.
function commentXml(c) {
  const lines = String(c.text || '').split('\n')
  const runs = lines.map((l, i) => `${i ? '<w:r><w:br/></w:r>' : ''}${l ? `<w:r><w:t${/^\s|\s$|\s\s/.test(l) ? ' xml:space="preserve"' : ''}>${esc(l)}</w:t></w:r>` : ''}`).join('')
  return `<w:comment w:id="${esc(c.id)}" w:author="${esc(c.author)}" w:date="${esc(c.date)}" w:initials="${esc(c.initials)}"><w:p w14:paraId="${c.pid}" w14:textId="77777777"><w:pPr><w:pStyle w:val="CommentText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>${runs}</w:p></w:comment>`
}
// A comment from the file given a paraId (to be answered or resolved in a file that had none):
// on its last paragraph, as Word puts it.
function withPid(rawXml, pid) {
  const i = rawXml.lastIndexOf('<w:p')
  const at = (j) => j >= 0 && /[\s>/]/.test(rawXml[j + 4]) ? j : -1
  let j = at(i)
  for (let k = i; j < 0 && k > 0; k = rawXml.lastIndexOf('<w:p', k - 1)) j = at(k)
  if (j < 0) return rawXml
  return `${rawXml.slice(0, j + 4)} w14:paraId="${pid}" w14:textId="77777777"${rawXml.slice(j + 4)}`
}
// A part's root start tag with the namespaces it needs declared, and ignorable by older readers
// as Word marks them.
function rootWith(head, prefixes) {
  const m = /<([\w.-]+:)?[\w.-]+\b[^>]*?(\/?)>/.exec(head.replace(/^<\?xml[^>]*\?>\s*/, ''))
  if (!m) return head
  const start = head.indexOf(m[0])
  let tag = m[0].replace(/\/>$/, '>')
  const add = []
  for (const p of [...prefixes, 'mc']) if (!new RegExp(`\\sxmlns:${p}=`).test(tag)) add.push(` xmlns:${p}="${NS[p]}"`)
  if (add.length) tag = tag.replace(/(\/?>)$/, `${add.join('')}$1`)
  const ign = prefixes.filter((p) => p !== 'w')
  const had = /\smc:Ignorable="([^"]*)"/.exec(tag)
  if (had) { const want = [...new Set([...had[1].split(/\s+/).filter(Boolean), ...ign])].join(' '); tag = tag.replace(had[0], ` mc:Ignorable="${want}"`) } else if (ign.length) tag = tag.replace(/>$/, ` mc:Ignorable="${ign.join(' ')}">`)
  return head.slice(0, start) + tag + head.slice(start + m[0].length)
}
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
// A part as it was, its root's children taken out: [what's before them, what's after them, the
// children as written by their key].
function shell(x, child, key) {
  const top = parseXml(x)
  const root = els(top)[0]
  if (!root) return null
  const by = new Map()
  for (const k of els(root)) if (local(k.name) === child) by.set(key(k), raw(k))
  // An empty part may close its root in its start tag (<w15:commentsEx …/>).
  if (/\/>$/.test(x.slice(root.s, root.st))) return { head: x.slice(0, root.st).replace(/\s*\/>$/, '>'), tail: `</${root.q}>${x.slice(root.st)}`, by }
  const end = x.lastIndexOf(`</${root.q}`)
  return { head: x.slice(0, root.st), tail: x.slice(end > root.st ? end : x.length), by }
}
const fresh = (part) => `${XML_HEAD}<${part.root} ${part.ns.concat('mc').map((p) => `xmlns:${p}="${NS[p]}"`).join(' ')} mc:Ignorable="${part.ns.filter((p) => p !== 'w').join(' ')}">`
const close = (part) => `</${part.root}>`

// Every part the comments need, written: what's in them now, from the list (each comment as it was
// unless it's new, answered, resolved or opened again). w: the document's Writer (its relationships
// and parts); put(path, xml, was): ooxml.js's, writing only what changed.
export function writeComments(m, w, put, list) {
  const was = m.cread || (m.cread = commentsOf(m))
  const before = new Map(was.map((c) => [c.id, c]))
  const same = list.length === was.length && list.every((c, i) => { const o = was[i]; return o && o.id === c.id && o.done === c.done && (o.parent || null) === (c.parent || null) && o.pid === c.pid })
  // Nothing changed since the file was read: every part as it was (and as last saved, if it was).
  if (same && !Object.keys(m.cwritten || {}).length) return
  const used = m.cused || (m.cused = usedIds(m))
  // Commented on, answered or resolved, a comment needs a paraId: one from the file without one
  // (made by another app) is given one, the same each save.
  const extended = !!m.cparts?.ext || !!m.cwritten?.ext || list.some((c) => c.parent || c.done)
  const pids = m.cpids || (m.cpids = new Map())
  const pidOf = (c) => c.pid || (extended ? pids.get(c.id) || (pids.set(c.id, freshId(used)), pids.get(c.id)) : null)
  const docDir = m.docPath.slice(0, m.docPath.lastIndexOf('/') + 1)
  const path = (k) => m.cparts?.[k]?.path || `${docDir}${PARTS[k].name}`
  const write = (k, xml) => {
    const p = path(k)
    put(p, xml, m.cparts?.[k]?.xml)
    if (!m.cparts?.[k]) { w.relsAdd(m.docPath, PARTS[k].rel, PARTS[k].name); m.added.parts[p] = PARTS[k].type }
    m.cwritten = { ...(m.cwritten || {}), [k]: true }
  }
  // comments.xml: each comment as it was (given a paraId if it needs one now), or as Word writes a new one.
  const body = list.map((c) => {
    const o = before.get(c.id)
    if (o?.raw) return o.pid || !pidOf(c) ? o.raw : withPid(o.raw, pidOf(c))
    return commentXml({ ...c, pid: pidOf(c) || c.pid })
  }).join('')
  const cx = m.cparts?.comments?.xml
  const cs = cx ? shell(cx, 'comment', (k) => attr(k, 'id')) : null
  const needW14 = list.some((c) => pidOf(c))
  write('comments', cs ? `${needW14 ? rootWith(cs.head, ['w', 'w14']) : cs.head}${body}${cs.tail}` : `${fresh(PARTS.comments)}${body}${close(PARTS.comments)}`)
  // commentsExtended.xml: which each answers and whether it's resolved, for each with a paraId.
  if (extended) {
    const byPid = new Map(list.map((c) => [c.id, pidOf(c)]))
    const ex = m.cparts?.ext ? shell(m.cparts.ext.xml, 'commentEx', (k) => String(attr(k, 'paraId') || '').toUpperCase()) : null
    const rows = list.filter((c) => pidOf(c)).map((c) => {
      const pid = pidOf(c)
      const parent = c.parent ? byPid.get(c.parent) : null
      const had = ex?.by.get(pid.toUpperCase())
      if (had) return /\sw15:done="[^"]*"/.test(had) ? had.replace(/(\sw15:done=")[^"]*(")/, `$1${c.done ? 1 : 0}$2`) : had.replace(/\s*\/>$/, ` w15:done="${c.done ? 1 : 0}"/>`)
      return `<w15:commentEx w15:paraId="${pid}"${parent ? ` w15:paraIdParent="${parent}"` : ''} w15:done="${c.done ? 1 : 0}"/>`
    }).join('')
    write('ext', ex ? `${rootWith(ex.head, ['w15'])}${rows}${ex.tail}` : `${fresh(PARTS.ext)}${rows}${close(PARTS.ext)}`)
  }
  // Word 365's lasting ids and UTC times, where the file has them: kept for each comment still
  // there, and given to each new one.
  if (m.cparts?.ids || m.cparts?.cex) {
    const durable = m.cdurable || (m.cdurable = new Map())
    const idOf = (c) => c.durable || durable.get(c.id) || (durable.set(c.id, freshId(used)), durable.get(c.id))
    if (m.cparts.ids) {
      const s = shell(m.cparts.ids.xml, 'commentId', (k) => String(attr(k, 'paraId') || '').toUpperCase())
      const rows = list.filter((c) => pidOf(c)).map((c) => s.by.get(pidOf(c).toUpperCase()) || `<w16cid:commentId w16cid:paraId="${pidOf(c)}" w16cid:durableId="${idOf(c)}"/>`).join('')
      write('ids', `${rootWith(s.head, ['w16cid'])}${rows}${s.tail}`)
    }
    if (m.cparts.cex) {
      const s = shell(m.cparts.cex.xml, 'commentExtensible', (k) => String(attr(k, 'durableId') || ''))
      const rows = list.filter((c) => pidOf(c)).map((c) => s.by.get(idOf(c)) || `<w16cex:commentExtensible w16cex:durableId="${idOf(c)}" w16cex:dateUtc="${esc(c.date)}"/>`).join('')
      write('cex', `${rootWith(s.head, ['w16cex'])}${rows}${s.tail}`)
    }
  }
  // people.xml, where the file has it: each new author named, as Word adds them.
  if (m.cparts?.people) {
    const s = shell(m.cparts.people.xml, 'person', (k) => attr(k, 'author'))
    const add = [...new Set(list.map((c) => c.author))].filter((a) => a && !s.by.has(a)).map((a) => `<w15:person w15:author="${esc(a)}"><w15:presenceInfo w15:providerId="None" w15:userId="${esc(a)}"/></w15:person>`).join('')
    if (add) write('people', `${rootWith(s.head, ['w15'])}${[...s.by.values()].join('')}${add}${s.tail}`)
  }
  // The styles a comment made here uses, as Word has them.
  if (list.some((c) => !before.has(c.id))) { w.needStyle('CommentText'); w.needStyle('CommentReference') }
}
