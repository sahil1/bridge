// What Bridge AI's MCP server does (the tools in mcpdefs.js), here in the server, for `bridge-ai mcp`
// and /mcp alike: what's on and what's shared is decided here, every call is checked and written
// down here (outside.js), and nothing a client says is trusted for that, its own name included.
//
// What it reaches: whiteboards (boards.js), Studio's kinds of files in your Places (only inside a
// place, through files.js safePath), meeting summaries (never transcripts or your own notes), your
// task list, and, only while you turn it on, your agents, to send them a message you approve.
// Nothing else of the data folder: no keys, relay, accounts, mail or calendar. A change to a board
// or a file that exists is a suggestion, waiting in Needs You; a new board or file never writes over
// one. What comes back is the user's data, framed as data (mcpdefs.js asData), cut into pages.
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { asData, clean, SHAPES_URI } from './mcpdefs.js'

const PAGE = 12_000
const MAX_READ = 400_000
const PER_MINUTE = 120
const TEXT = new Set(['.md', '.markdown', '.txt', '.csv', '.tsv', '.html', '.htm'])
const NEW_FILE = new Set(['.md', '.txt', '.csv', '.tsv'])
const SKIP = new Set(['node_modules', '__pycache__', 'venv', 'dist', 'build', 'target', 'Library'])
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const enc = encodeURIComponent
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} hours ago` : new Date(ms).toISOString().slice(0, 10)
}
const say = (text, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) })
const why = (e) => Object.assign(new Error(e), { said: true })

// on(): the feature is on (a beta feature); sendOn(): sending to agents is; boards, meetings,
// places, files, studio, doctext: the server's modules; tasks: the task list (chieftasks.js);
// agents(): the agents running ({ paneId, name, kind, status, folder }); deliver(paneId, text): sends
// a message to one, now or once it's free; outside: outside.js.
export function make({ on, sendOn, boards, meetings, places, files, studio, doctext, tasks, agents, deliver, outside }) {
  const OFF = 'Bridge AI\'s MCP server is turned off. The user can turn it on in Bridge AI: Settings › MCP Servers › Bridge AI as an MCP Server.'

  // ---------- Places, and where things are ----------
  // A place's name in an address: its folder's name, or with its id when two share one.
  const placeList = () => places.pickedPlaces().map((p) => places.placeOf(p.id)).filter(Boolean).map((p) => ({ ...p, name: p.name || path.basename(p.path) }))
  const segOf = (p, all = placeList()) => (all.filter((x) => x.name === p.name).length > 1 ? `${p.name}~${p.id}` : p.name)
  const placeBy = (seg) => {
    const all = placeList()
    const s = String(seg || '')
    return all.find((p) => segOf(p, all) === s) || all.find((p) => p.name.toLowerCase() === s.toLowerCase() && all.filter((x) => x.name.toLowerCase() === s.toLowerCase()).length === 1) || null
  }
  const fileAddress = (p, rel) => `bridge://files/${enc(segOf(p))}/${rel.split(/[\\/]/).map(enc).join('/')}`
  const noPlaces = 'The user hasn\'t shared any folders with Bridge AI yet. They can add one as a Place in Bridge AI (Files, or Studio).'

  // An address: what it names, or why it names nothing.
  function parse(address) {
    let u
    try { u = new URL(String(address || '').trim()) } catch { throw why(`"${clean(address).slice(0, 100)}" isn't an address. Addresses look like bridge://boards/Roadmap, from bridge_find.`) }
    if (u.protocol !== 'bridge:') throw why('Addresses start with bridge://, as bridge_find gives them.')
    const parts = u.pathname.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x) } catch { return x } })
    if (u.host === 'boards' && parts.length === 1) return { type: 'board', id: parts[0] }
    if (u.host === 'meetings' && parts.length === 1) return { type: 'meeting', id: parts[0] }
    if (u.host === 'asks' && parts.length === 1) return { type: 'ask', id: parts[0] }
    if (u.host === 'reference' && parts[0] === 'shapes') return { type: 'shapes' }
    if (u.host === 'files' && parts.length >= 2) {
      const place = placeBy(parts[0])
      if (!place) throw why(`There's no Place called ${clean(parts[0]).slice(0, 80)}. ${placeList().length ? `The Places are: ${placeList().map((p) => segOf(p)).join(', ')}.` : noPlaces}`)
      if (parts.slice(1).some((x) => x.split(/[\\/]/).some((y) => y === '..'))) throw why('That address leads outside the Place.')
      return { type: 'file', place, rel: parts.slice(1).join('/') }
    }
    throw why('Addresses look like bridge://boards/<name>, bridge://files/<place>/<path> or bridge://meetings/<id>, as bridge_find gives them.')
  }
  // A file in a place, as files.js finds it: inside it (links followed), and never in a folder
  // with keys (Bridge AI's own, .ssh). rel: its path in the place.
  async function fileOf(place, rel) {
    let at
    try { at = await files.safePath(place.path, rel) } catch (e) { throw why(/outside/i.test(e.message) ? 'That address leads outside the Place.' : e.code === 'keptOut' ? 'Bridge AI keeps out of that folder: it holds keys.' : `There's no ${clean(rel)} in ${place.name}.`) }
    const st = await fsp.stat(at.real).catch(() => null)
    if (!st?.isFile()) throw why(`There's no file ${clean(rel)} in ${place.name}.`)
    if (!studio.opens(at.real)) throw why(`${path.basename(at.real)} isn't a kind of file Bridge AI shares (documents, sheets, decks, PDFs and pages).`)
    return { real: at.real, st, rel: at.rel }
  }

  // ---------- Finding ----------
  async function find({ query = '', kind = 'any', limit = 10 }) {
    const q = String(query || '').trim().toLowerCase()
    const words = q.split(/\s+/).filter(Boolean)
    const hit = (name) => words.every((w) => String(name).toLowerCase().includes(w))
    const out = []
    if (kind === 'any' || kind === 'board') {
      for (const b of (await boards.list()).boards) if (!q || hit(b.title)) out.push({ kind: 'whiteboard', name: b.title, at: b.mtime, where: 'Whiteboards', address: `bridge://boards/${enc(b.id)}` })
    }
    if (kind === 'any' || kind === 'meeting') {
      for (const m of meetings.list()) {
        if (!m.hasSummary || (q && !hit(m.title || ''))) continue
        out.push({ kind: 'meeting summary', name: m.title || 'Meeting', at: Date.parse(m.startedAt) || 0, where: 'Meetings', address: `bridge://meetings/${enc(m.id)}` })
      }
    }
    const all = placeList()
    if ((kind === 'any' || kind === 'file') && all.length) {
      for (const p of all) {
        const root = await files.safePath(p.path, '').then((x) => x.realRoot, () => null)
        if (!root) continue
        for (const f of await walk(root)) {
          if (q && !hit(f.rel)) continue
          out.push({ kind: kindWord(f.rel), name: path.basename(f.rel), at: f.at, where: `${segOf(p, all)}${path.dirname(f.rel) === '.' ? '' : ` › ${path.dirname(f.rel).split(path.sep).join(' › ')}`}`, address: fileAddress(p, f.rel) })
        }
      }
    }
    // By name when asked for words (the closest first), else the latest.
    const score = (x) => { const n = x.name.toLowerCase(); return n === q ? 0 : n.startsWith(q) ? 1 : 2 }
    out.sort((a, b) => (q ? score(a) - score(b) : 0) || b.at - a.at)
    const shown = out.slice(0, limit)
    const lines = shown.map((x, i) => `${i + 1}. ${x.name}: ${x.kind} in ${x.where}, ${x.kind === 'meeting summary' ? new Date(x.at).toISOString().slice(0, 10) : `changed ${ago(x.at)}`}. ${x.address}`)
    const notes = []
    if ((kind === 'any' || kind === 'file') && !all.length) notes.push(`(No files: ${noPlaces})`)
    if (out.length > shown.length) notes.push(`(${out.length - shown.length} more: narrow it with words, or raise limit.)`)
    const about = shown.length ? `Bridge AI found ${out.length}${q ? ` for "${clean(query).slice(0, 100)}"` : ', latest first'}. Read one with bridge_read and its address.` : `Nothing in Bridge AI${q ? ` matches "${clean(query).slice(0, 100)}"` : ' yet'}.${notes.length ? ` ${notes.join(' ')}` : ''}`
    if (!shown.length) return say(about)
    return say(asData({ source: 'bridge://find', about, text: [...lines, ...notes].join('\n') }))
  }
  // The files Studio opens in a place: a bounded walk, past hidden folders and ones full of code's
  // own (node_modules), never through a link out of it.
  async function walk(root) {
    const out = []
    let seen = 0
    const go = async (dir, depth) => {
      if (depth > 6 || seen > 6000) return
      const items = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of items) {
        if (++seen > 6000) return
        if (e.name.startsWith('.') || SKIP.has(e.name)) continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) await go(full, depth + 1)
        else if (e.isFile() && studio.opens(e.name)) {
          const st = await fsp.stat(full).catch(() => null)
          if (st) out.push({ rel: path.relative(root, full), at: st.mtimeMs })
        }
      }
    }
    await go(root, 0)
    return out
  }
  const kindWord = (rel) => ({ doc: 'document', sheet: 'sheet', deck: 'deck', pdf: 'PDF', page: 'web page' })[studio.kindOf(rel)] || 'file'

  // ---------- Reading ----------
  // What an address holds, whole: { about, text, source }.
  async function whole(a) {
    if (a.type === 'shapes') return { about: 'The shapes and group kinds a diagram spec can use in Bridge AI.', text: boards.shapesText(), source: SHAPES_URI, plain: true }
    if (a.type === 'board') {
      let b
      try { b = await boards.read(a.id) } catch (e) { throw why(e.status === 404 ? `There's no whiteboard called ${clean(a.id).slice(0, 80)}. Find one with bridge_find.` : e.message) }
      return { about: `Whiteboard "${clean(b.title)}" in Bridge AI, changed ${ago(b.mtime)}: its shapes, arrows and words.`, text: boards.sayBoard(b), source: `bridge://boards/${enc(b.id)}` }
    }
    if (a.type === 'meeting') {
      const m = meetings.list().find((x) => x.id === a.id)
      if (!m) throw why('There\'s no meeting with that address. Find one with bridge_find.')
      let summary = ''
      try { summary = meetings.get(m.id).summary || '' } catch { /* gone meanwhile */ }
      if (!summary.trim()) throw why(`"${clean(m.title)}" has no summary yet.`)
      return { about: `The summary of the meeting "${clean(m.title)}" (${String(m.startedAt || '').slice(0, 10)}), written by Bridge AI from it.`, text: summary, source: `bridge://meetings/${enc(m.id)}` }
    }
    if (a.type === 'ask') {
      const it = outside.get(a.id)
      if (!it) throw why('There\'s no suggestion or send with that address.')
      const what = it.kind === 'send' ? `Your message for ${it.target.name}` : `Your suggestion for ${it.target.name}`
      const state = { waiting: 'is still waiting for the user in Bridge AI\'s Needs You', kept: 'was kept by the user', discarded: 'was discarded by the user', sent: 'was approved and sent by the user', 'not sent': 'was not sent: the user declined it' }[it.status] || it.status
      return { about: `${what} ${state}${it.decidedAt ? ` (${it.decidedAt.slice(0, 16).replace('T', ' ')} UTC)` : ''}.${it.problem ? ` Last try: ${clean(it.problem)}` : ''}`, text: `Summary you gave: ${it.summary}`, source: `bridge://asks/${it.id}` }
    }
    const { real, st, rel } = await fileOf(a.place, a.rel)
    if (!doctext.readable(real)) throw why(`Bridge AI can't read ${path.extname(real).slice(1).toUpperCase() || 'this kind of'} files on this computer.`)
    const text = await doctext.textOf(real, MAX_READ).catch((e) => { throw why(`Couldn't read ${path.basename(real)}: ${e.message}`) })
    return { about: `${path.basename(real)}, a ${kindWord(real)} in the Place ${a.place.name}, changed ${ago(st.mtimeMs)}.`, text, source: fileAddress(a.place, rel) }
  }
  async function read({ address, page = 1 }) {
    const w = await whole(parse(address))
    const pages = Math.max(1, Math.ceil(w.text.length / PAGE))
    if (page > pages) throw why(`There ${pages === 1 ? 'is 1 page' : `are ${pages} pages`}.`)
    const part = w.text.slice((page - 1) * PAGE, page * PAGE)
    const more = pages > 1 ? ` Page ${page} of ${pages}${page < pages ? `: ask for page ${page + 1} for more` : ''}.` : ''
    return say(asData({ source: w.source, about: `${w.about}${more}`, text: part }))
  }

  // ---------- Making ----------
  async function newBoard({ title, format, diagram }) {
    const b = await boards.create({ title, source: { kind: format, text: diagram } }).catch((e) => { throw why(e.message) })
    return say(`Made the whiteboard "${b.id}" in Bridge AI (bridge://boards/${enc(b.id)}). It's drawn in the user's look the first time they open it in Whiteboards.`)
  }
  function placeFor(name) {
    const all = placeList()
    if (!all.length) throw why(noPlaces)
    if (!name) { if (all.length === 1) return all[0]; throw why(`Which Place? They are: ${all.map((p) => segOf(p, all)).join(', ')}.`) }
    const p = placeBy(name)
    if (!p) throw why(`There's no Place called ${clean(name).slice(0, 80)}. They are: ${all.map((x) => segOf(x, all)).join(', ')}.`)
    return p
  }
  async function newFile({ place, folder = '', name, content }) {
    const p = placeFor(place)
    const ext = path.extname(String(name)).toLowerCase()
    if (!NEW_FILE.has(ext)) throw why('The name has to end in .md, .txt, .csv or .tsv.')
    if (String(folder).split(/[\\/]/).some((x) => x === '..')) throw why('The folder has to be inside the Place.')
    const made = await studio.create(p.path, String(folder || ''), String(name), Buffer.from(String(content))).catch((e) => { throw why(/ENOENT|Not a folder/.test(e.message) ? `There's no folder ${clean(folder)} in ${p.name}.` : e.message) })
    return say(`Made ${made.name} in the Place ${p.name}${path.dirname(made.path) === '.' ? '' : ` (${path.dirname(made.path)})`}: ${fileAddress(p, made.path)}. It opens in Bridge AI's Studio.`)
  }
  async function addTask({ title }) {
    const it = tasks.add(title, { status: 'open' })
    return say(`Added task ${it.id} to the user's task list in Bridge AI: ${it.title}`)
  }

  // ---------- Suggesting ----------
  const editsOn = (text, edits) => {
    let out = text
    for (const [i, e] of edits.entries()) {
      const n = out.split(e.find).length - 1
      if (n !== 1) throw why(`Edit ${i + 1}: its find text ${n ? `appears ${n} times` : 'isn\'t in the file'}; it has to appear exactly once. Read the file again with bridge_read.`)
      out = out.replace(e.find, () => e.replace)
    }
    return out
  }
  async function suggest({ address, summary, edits, text, mode = 'add', format, diagram }, client) {
    const a = parse(address)
    let target, change
    if (a.type === 'board') {
      if (!format || !diagram) throw why('For a whiteboard, give the diagram: format and diagram, as bridge_new_board takes them.')
      if (edits || text != null) throw why('A whiteboard takes a diagram, not edits or text.')
      const b = await boards.stat(a.id).catch(() => { throw why(`There's no whiteboard called ${clean(a.id).slice(0, 80)}.`) })
      try { boards.checkSource({ kind: format, text: diagram }) } catch (e) { throw why(e.message) }
      target = { type: 'board', id: b.id, name: `the whiteboard "${b.id}"`, address: `bridge://boards/${enc(b.id)}` }
      change = { source: { kind: format, text: diagram }, mode }
    } else if (a.type === 'file') {
      const { real, rel } = await fileOf(a.place, a.rel)
      if (!TEXT.has(path.extname(real).toLowerCase())) throw why(`${path.basename(real)} can't take a suggestion yet: only Markdown, plain text, CSV, TSV and HTML files can. Make a new file with bridge_new_file instead.`)
      if (format || diagram) throw why('A file takes edits or text, not a diagram.')
      if ((edits && text != null) || (!edits?.length && text == null)) throw why('Give either edits or the whole new text.')
      const now = await fsp.readFile(real, 'utf8')
      if (edits) editsOn(now, edits)
      target = { type: 'file', place: a.place.id, rel, name: path.basename(real), where: a.place.name, address: fileAddress(a.place, rel) }
      change = edits ? { edits } : { text, base: sha(now) }
    } else throw why('Only a whiteboard or a file can take a suggestion.')
    const it = outside.add('suggestion', { client, target, summary, change })
    return say(`Suggested. It waits in Bridge AI's Needs You for the user to keep or discard; nothing has changed yet. Its address: bridge://asks/${it.id} (read it to see what they did).`)
  }

  // ---------- Sending to an agent ----------
  async function send({ agent, message }, client) {
    const list = (await agents()).filter((x) => x.paneId)
    const want = String(agent).trim().toLowerCase()
    const hits = list.filter((x) => x.name.toLowerCase() === want || x.paneId === agent)
    const a = hits.length === 1 ? hits[0] : null
    if (!a) {
      const names = list.map((x) => `${x.name} (${x.kind}, ${x.status}${x.folder ? `, in ${x.folder}` : ''})`)
      throw why(`${hits.length > 1 ? `More than one agent is called ${clean(agent)}.` : `No agent called ${clean(agent).slice(0, 80)} is running.`} ${names.length ? `The agents running: ${names.join('; ')}.` : 'No agents are running.'}`)
    }
    const it = outside.add('send', { client, target: { type: 'agent', paneId: a.paneId, name: a.name, kind: a.kind, folder: a.folder || null }, summary: String(message).split('\n')[0].slice(0, 200), change: { message } })
    return say(`Waiting for the user's approval in Bridge AI's Needs You: nothing is sent to ${a.name} until they approve it. Its address: bridge://asks/${it.id} (read it to see whether it was sent).`)
  }

  // ---------- Keeping a suggestion, sending an approved message ----------
  async function apply(item) {
    if (item.kind === 'send') {
      const a = (await agents()).find((x) => x.paneId === item.target.paneId)
      if (!a) throw new Error(`${item.target.name} isn't running any more`)
      const r = await deliver(a.paneId, `${item.change.message}\n\n(Sent by ${item.client?.name || 'another app'} through Bridge AI, with your approval.)`)
      return r?.queued ? `Queued for ${a.name}: it's busy, so it gets it when it's free.` : `Sent to ${a.name}.`
    }
    const t = item.target
    if (t.type === 'board') {
      await boards.update(t.id, item.change).catch((e) => { throw new Error(e.status === 404 ? `The whiteboard "${t.id}" isn't there any more` : e.message) })
      return 'Kept. It\'s drawn on the board the next time you open it.'
    }
    const p = placeList().find((x) => x.id === t.place)
    if (!p) throw new Error(`${t.where} isn't a Place any more`)
    const { real } = await fileOf(p, t.rel)
    const now = await fsp.readFile(real, 'utf8')
    let next
    if (item.change.edits) next = editsOn(now, item.change.edits)
    else {
      if (sha(now) !== item.change.base) throw new Error(`${t.name} changed since this was suggested, so keeping it would lose that. Discard it, or ask for it again.`)
      next = item.change.text
    }
    // Saved as Studio saves, so what was there is kept as a version to go back to.
    await studio.save(p.path, t.rel, Buffer.from(next), { force: true })
    return 'Kept. The file had a version kept first, to go back to in Studio.'
  }

  // ---------- Calls ----------
  const what = (name, x) => ({
    bridge_find: () => (x.query ? `find "${x.query}"` : 'list the latest') + (x.kind && x.kind !== 'any' ? ` (${x.kind}s)` : ''),
    bridge_read: () => `read ${x.address}${x.page > 1 ? `, page ${x.page}` : ''}`,
    bridge_new_board: () => `new whiteboard "${x.title}"`,
    bridge_new_file: () => `new file ${[x.place, x.folder, x.name].filter(Boolean).join('/')}`,
    bridge_suggest_change: () => `suggest a change to ${x.address}`,
    bridge_add_task: () => `add task "${x.title}"`,
    bridge_send_to_agent: () => `ask to send a message to ${x.agent}`,
  })[name]?.() || name
  const RUN = { bridge_find: find, bridge_read: read, bridge_new_board: newBoard, bridge_new_file: newFile, bridge_suggest_change: suggest, bridge_add_task: addTask, bridge_send_to_agent: send }
  const rate = new Map() // client -> [times]
  async function call(name, args, client) {
    const t0 = Date.now()
    const entry = { client, tool: name, what: clean(what(name, args || {})) }
    const k = client?.name || '?'
    const times = (rate.get(k) || []).filter((x) => t0 - x < 60_000)
    times.push(t0)
    rate.set(k, times)
    let r
    try {
      if (!on()) throw why(OFF)
      if (name === 'bridge_send_to_agent' && !sendOn()) throw why('Sending to agents is turned off in Bridge AI (Settings › MCP Servers).')
      if (times.length > PER_MINUTE) throw why(`That's more than ${PER_MINUTE} calls a minute: wait a minute and try again.`)
      r = await RUN[name](args || {}, client)
    } catch (e) {
      r = say(e.said ? e.message : `Bridge AI couldn't do that: ${clean(e.message).slice(0, 300)}`, true)
    }
    outside.log({ ...entry, ok: !r.isError, ...(r.isError ? { error: r.content[0].text } : {}), ms: Date.now() - t0 })
    return r
  }

  // ---------- Resources ----------
  async function resources() {
    const out = [{ uri: SHAPES_URI, name: 'shapes', title: 'Shapes for a diagram spec', description: 'The shapes and group kinds bridge_new_board and bridge_suggest_change take in a diagram spec.', mimeType: 'text/plain' }]
    if (!on()) return out
    for (const b of (await boards.list().catch(() => ({ boards: [] }))).boards.slice(0, 20)) out.push({ uri: `bridge://boards/${enc(b.id)}`, name: b.title, title: `Whiteboard: ${b.title}`, mimeType: 'text/plain', annotations: { lastModified: new Date(b.mtime).toISOString() } })
    for (const m of meetings.list().filter((x) => x.hasSummary).slice(0, 10)) out.push({ uri: `bridge://meetings/${enc(m.id)}`, name: m.title || 'Meeting', title: `Meeting summary: ${m.title || 'Meeting'}`, mimeType: 'text/markdown', annotations: { lastModified: m.startedAt } })
    return out
  }
  async function readResource(uri, client) {
    const t0 = Date.now()
    let a
    try { a = parse(uri) } catch { return null }
    if (a.type !== 'shapes' && !on()) throw new Error(OFF)
    try {
      const w = await whole(a)
      outside.log({ client, tool: 'resource', what: `read ${uri}`, ok: true, ms: Date.now() - t0 })
      return { contents: [{ uri, mimeType: a.type === 'meeting' ? 'text/markdown' : 'text/plain', text: w.plain ? w.text : asData({ source: w.source, about: w.about, text: w.text.slice(0, MAX_READ) }) }] }
    } catch (e) {
      outside.log({ client, tool: 'resource', what: `read ${uri}`, ok: false, error: e.message, ms: Date.now() - t0 })
      if (e.said) return null
      throw e
    }
  }

  const state = () => ({ on: on(), send: on() && sendOn() })
  return { call, state, resources, read: readResource, apply, parse }
}
