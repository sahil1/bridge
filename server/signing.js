// AI Assist's Sign this (Sign PDFs, in Studio): a PDF you're asked to sign, explained in plain
// words by the model you pick, then your drawn signature, initials and today's date put where you
// approve, in a new copy: <its folder>/_signed/<name> (signed).pdf. The original isn't touched.
// Your signatures and initials are pictures you drew (on the pad, the trackpad or your phone), kept
// only here, sealed (signstore.js); they're never sent to a model or anywhere else. With Ask Before
// Signing on, a copy is made only once you've said it's you (signauth.js), and each signing is in the
// document's versions (studio.js noteSigned). What's written is a simple electronic signature (a
// picture on the page), not a certificate-based digital one, and the page says so. Where to sign is
// found in the page (src/components/studio/pdf/find.js), which has the PDF open already; this writes
// the copy (pdf-lib) and asks the model.
import fsp from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, StandardFonts, PDFSignature, PDFTextField, PDFName, PDFRef, degrees, rgb } from 'pdf-lib'
import { safePath } from './files.js'
import * as store from './signstore.js'
import * as auth from './signauth.js'
import * as phone from './signphone.js'
import { probe, trackpad } from './signhelper.js'
import { shownSize, fitImage, dateSize, dateSpot, toUser, KINDS } from '../shared/signmarks.js'
import { placeEn } from '../shared/places.js'

const MARKS = ['signature', 'initials'] // the two you draw
const MAX_PDF = 80 * 1024 * 1024
const MAX_MARKS = 200

// ---------- Your signatures and initials ----------
// Kept sealed (signstore.js): as many as you like, each named, one of each kind the default.
// mine(): the defaults, as the page has always had them ({ signature, initials }: their
// { id, name, at, width, height }, or null), and every one (list).
export async function mine() {
  const list = await store.list()
  const out = { list }
  for (const k of MARKS) out[k] = list.find((x) => x.kind === k && x.default) || null
  return out
}

// ---------- The PDF ----------
async function pdfAt(root, rel) {
  const { real, realRoot } = await safePath(root, rel)
  const st = await fsp.stat(real)
  if (!st.isFile() || path.extname(real).toLowerCase() !== '.pdf') throw new Error('Only a PDF can be signed here')
  if (st.size > MAX_PDF) throw new Error('Too big to sign here (80 MB at most)')
  return { real, realRoot, bytes: await fsp.readFile(real) }
}
const LOCKED = 'This PDF is locked against changes (it\'s encrypted), so a signed copy can\'t be made from it. Ask whoever sent it for one that isn\'t locked, or print it and sign it on paper.'
async function load(bytes, o = {}) {
  try { return await PDFDocument.load(bytes, { updateMetadata: false, ...o }) } catch (e) {
    if (/encrypt/i.test(`${e.name} ${e.message}`)) throw Object.assign(new Error(LOCKED), { code: 'locked' })
    throw new Error(`Couldn't read this PDF: ${e.message}`)
  }
}
// A signature field with a value: a certificate-based signature someone put on it already.
const signedFields = (doc) => { try { return doc.getForm().getFields().filter((f) => f instanceof PDFSignature && f.acroField.dict.get(PDFName.of('V'))).map((f) => f.getName()) } catch { return [] } }

// What to know before signing it: locked (no copy can be made), digital signatures on it already
// (a copy no longer proves them), and its pages.
export async function inspect(root, rel) {
  const { bytes } = await pdfAt(root, rel)
  let doc
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true }) } catch (e) { throw new Error(`Couldn't read this PDF: ${e.message}`) }
  return { encrypted: doc.isEncrypted, signed: signedFields(doc), pages: doc.getPageCount() }
}

// A field taken off the form and its pages: its widgets (itself, when the two are one), then its
// place in the form. pdf-lib's own removeField needs each widget to have a look of its own, which an
// unsigned signature field often hasn't.
function dropField(doc, form, f) {
  const refs = [f.ref]
  const kids = f.acroField.Kids()
  for (let i = 0; kids && i < kids.size(); i++) { const k = kids.get(i); if (k instanceof PDFRef) refs.push(k) }
  for (const page of doc.getPages()) for (const r of refs) page.node.removeAnnot(r)
  form.acroForm.removeField(f.acroField)
}

// The marks you approved, checked: their kind, page and box (kept on the page), a field they fill.
function cleanMarks(marks, pages) {
  if (!Array.isArray(marks) || !marks.length) throw Object.assign(new Error('Nothing to sign: approve where your signature goes first'), { status: 400 })
  if (marks.length > MAX_MARKS) throw Object.assign(new Error(`Too many places to sign at once (${MAX_MARKS} at most)`), { status: 400 })
  return marks.map((m) => {
    const kind = String(m?.kind || '')
    const page = Number(m?.page)
    if (!KINDS.includes(kind)) throw Object.assign(new Error(`Not something to put on a page: ${kind}`), { status: 400 })
    if (!Number.isInteger(page) || page < 1 || page > pages.length) throw Object.assign(new Error(`There's no page ${m?.page}`), { status: 400 })
    const p = pages[page - 1]
    const { x: bx, y: by, width: bw, height: bh } = p.getCropBox()
    const n = ['x', 'y', 'w', 'h'].map((k) => Number(m?.[k]))
    if (!n.every(Number.isFinite) || n[2] < 2 || n[3] < 2) throw Object.assign(new Error('A place to sign without a size'), { status: 400 })
    const w = Math.min(n[2], bw), h = Math.min(n[3], bh)
    const x = Math.min(Math.max(n[0], bx), bx + bw - w), y = Math.min(Math.max(n[1], by), by + bh - h)
    return { kind, page, x, y, w, h, align: m.align === 'left' ? 'left' : 'center', field: m.field ? String(m.field).slice(0, 300) : null, fieldType: m.fieldType === 'Sig' || m.fieldType === 'Tx' ? m.fieldType : null, text: kind === 'date' ? String(m.text || '').trim().slice(0, 60) : null, sig: kind !== 'date' && /^[a-z0-9]{8,32}$/.test(String(m.sig || '')) ? String(m.sig) : null }
  })
}

// The signed copy: your pictures and the date on the pages you approved, a form's own date field
// filled in, and a signature field you signed in taken off the form (it'd show as still waiting to
// be signed). Saved beside the original in _signed, never over a file that's there. Each place has
// the signature or initials it was given (m.sig, one of yours), else that kind's default.
export async function sign(root, rel, marks) {
  const { real, realRoot, bytes } = await pdfAt(root, rel)
  const doc = await load(bytes)
  const pages = doc.getPages()
  const list = cleanMarks(marks, pages)
  for (const m of list) {
    if (m.kind === 'date') continue
    const x = await store.pick(m.kind, m.sig)
    if (!x) throw Object.assign(new Error(m.kind === 'signature' ? 'Draw your signature first' : 'Draw your initials first'), { status: 400 })
    m.sig = x.id
  }
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pics = {} // by the signature's id
  // The form only when a mark fills one of its fields: asking for it adds one to a PDF without.
  const form = list.some((m) => m.field) ? (() => { try { return doc.getForm() } catch { return null } })() : null
  const done = new Set()
  for (const m of list) {
    const page = pages[m.page - 1]
    const turn = page.getRotation().angle || 0
    const shown = shownSize(m, turn)
    if (m.kind === 'date') {
      if (!m.text) throw Object.assign(new Error('A date with nothing in it'), { status: 400 })
      try { font.encodeText(m.text) } catch { throw Object.assign(new Error(`"${m.text}" has letters the PDF's own font can't write: pick a date in digits`), { status: 400 }) }
      // A form's own date field takes the date as its value, so the form stays a form.
      if (m.field && m.fieldType === 'Tx' && form) {
        try {
          const f = form.getField(m.field)
          if (f instanceof PDFTextField) {
            if (form.hasXFA()) form.deleteXFA() // otherwise Acrobat shows the form's other copy, without it
            f.setText(m.text)
            f.updateAppearances(font)
            done.add(m.field)
            continue
          }
        } catch { /* drawn on the page instead */ }
      }
      const size = dateSize(shown.w, shown.h, font.widthOfTextAtSize(m.text, 1))
      const at = dateSpot(shown.h, size)
      const o = toUser(m, turn, at.u, at.v)
      page.drawText(m.text, { x: o.x, y: o.y, size, font, color: rgb(0.1, 0.1, 0.12), rotate: degrees(turn) })
    } else {
      pics[m.sig] ||= await doc.embedPng(await store.image(m.sig))
      const img = pics[m.sig]
      const fit = fitImage(shown.w, shown.h, img.width, img.height, m.align)
      const o = toUser(m, turn, fit.u, fit.v)
      page.drawImage(img, { x: o.x, y: o.y, width: fit.w, height: fit.h, rotate: degrees(turn) })
      if (m.field && m.fieldType === 'Sig' && form && !done.has(m.field)) {
        try { const f = form.getField(m.field); if (f instanceof PDFSignature) { dropField(doc, form, f); done.add(m.field) } } catch { /* the drawing is on the page either way */ }
      }
    }
  }
  doc.setModificationDate(new Date())
  // Only the fields filled here get a new look; the rest of the form stays as it was drawn.
  const out = await doc.save({ updateFieldAppearances: false })
  const dir = path.join(path.dirname(real), '_signed')
  await fsp.mkdir(dir, { recursive: true })
  // Still inside the folder it came from (a _signed that's a link to elsewhere isn't followed).
  const at = await fsp.realpath(dir)
  if (!at.startsWith(realRoot + path.sep)) throw new Error('Its _signed folder leads outside the folder it\'s in')
  const stem = path.basename(real, path.extname(real))
  for (let n = 1; n < 1000; n++) {
    const file = path.join(at, `${stem} (signed${n > 1 ? ` ${n}` : ''}).pdf`)
    try { await fsp.writeFile(file, out, { flag: 'wx' }) } catch (e) { if (e.code === 'EEXIST') continue; throw e }
    return { path: path.relative(realRoot, file).split(path.sep).join('/'), name: path.basename(file), folder: '_signed', marks: list.length, pages: [...new Set(list.map((m) => m.page))].sort((a, b) => a - b), real: file, from: real, places: list.map(({ kind, page }) => ({ kind, page })) }
  }
  throw new Error('There are too many signed copies of it in _signed already')
}

// ---------- What you're signing ----------
// The document's text, page by page, as the page read it (pdf.js), explained in plain words by the
// model you picked (or the one meeting notes use): what it is, who, money, dates, what each side
// must do, renewal and ending it, and what's worth a closer look, each with its page. Only what
// the document says. A scan (no text) is read on a Mac (doctext.js); elsewhere that's said.
const SHAPE = '{"kind": "a few words: what sort of document it is", "what": "two or three sentences: what it is and what signing it commits the signer to", "parties": [{"name": "as written", "role": "who they are in it"}], "money": ["each amount: what for, who pays whom, when"], "dates": ["each date, deadline or period, and what happens then"], "obligations": ["what each side must or must not do, the signer\'s first"], "renewal": "whether and how it renews or carries on by itself (empty if it says nothing)", "termination": "how each side can end it, the notice needed and what ending it costs (empty if it says nothing)", "watch": [{"what": "something unusual, one-sided or easy to miss, in plain words", "page": 1, "quote": "a few exact words from the document there"}]}'
const SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string' }, what: { type: 'string' },
    parties: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, role: { type: 'string' } }, required: ['name'] } },
    money: { type: 'array', items: { type: 'string' } }, dates: { type: 'array', items: { type: 'string' } }, obligations: { type: 'array', items: { type: 'string' } },
    renewal: { type: 'string' }, termination: { type: 'string' },
    watch: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, page: { type: 'integer' }, quote: { type: 'string' } }, required: ['what'] } },
  },
  required: ['what'],
}
const SYSTEM = 'You explain a document to the person about to sign it, in plain words for someone who is not a lawyer. Use only what the document says: never invent names, amounts, dates or terms, and leave out what it does not cover. Describe what it says; do not give legal advice or tell them whether to sign. Short sentences, no filler.'
const str = (s, n = 600) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const list = (a, n = 12) => (Array.isArray(a) ? a : []).map((x) => str(x)).filter(Boolean).slice(0, n)
function tidy(v, pages) {
  return {
    kind: str(v.kind, 80), what: str(v.what, 900),
    parties: (Array.isArray(v.parties) ? v.parties : []).map((p) => ({ name: str(p?.name, 160), role: str(p?.role, 200) })).filter((p) => p.name).slice(0, 10),
    money: list(v.money), dates: list(v.dates), obligations: list(v.obligations, 16),
    renewal: str(v.renewal), termination: str(v.termination),
    watch: (Array.isArray(v.watch) ? v.watch : []).map((x) => ({ what: str(x?.what), page: Number.isInteger(x?.page) && x.page >= 1 && x.page <= pages ? x.page : null, quote: str(x?.quote, 160) })).filter((x) => x.what).slice(0, 10),
  }
}
const parsed = (text) => {
  const j = /\{[\s\S]*\}/.exec(String(text || ''))
  try { const v = JSON.parse(j ? j[0] : ''); return v && typeof v === 'object' && typeof v.what === 'string' && v.what.trim() ? v : null } catch { return null }
}
const LANG = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(String(code)) || null } catch { return null } }

let helpers = { reply: null, pickModel: null, describe: (id) => id, via: async () => null, contextOf: async () => null, scanText: null }
export const setHelpers = (h) => { helpers = { ...helpers, ...h } }
// The model that reads it: the one asked for, else AI Assist's for a document of that text (with
// Auto, a short one on this computer). Without text, as for a long one; set to stay on this computer
// and it can't, null from setup, and from explain the error saying why.
export async function modelInfo(id, text = null, { strict = false } = {}) {
  const use = id || await (strict ? helpers.pickModel?.(text) : helpers.pickModel?.(text).catch(() => null))
  return use ? { id: use, label: helpers.describe(use), via: await helpers.via(use).catch(() => null) } : null
}

// How much of it fits in one request: a cloud model takes 150,000 characters; a model on this
// computer what its context holds, less room for the answer.
async function budget(model) {
  const ctx = await helpers.contextOf(model).catch(() => null)
  return ctx ? Math.max(0, (ctx - 2500) * 3) : 150_000
}
export async function explain(root, rel, { pages: given, total, model, lang } = {}) {
  const { real } = await safePath(root, rel)
  if (path.extname(real).toLowerCase() !== '.pdf') throw new Error('Only a PDF can be read for signing')
  let pages = (Array.isArray(given) ? given : []).slice(0, 2000).map((p, i) => ({ n: Number(p?.n) || i + 1, text: String(p?.text || '').slice(0, 60_000) }))
  const info = await modelInfo(model, pages.map((p) => p.text).join('\n').slice(0, 400_000), { strict: true })
  if (!info) throw Object.assign(new Error(`No model to read it with. Sign in to an agent, or add an API key or a local model in ${placeEn('providers')}.`), { code: 'no_model' })
  let scanned = false
  // Pictures of pages with no text: read them on a Mac, else say so.
  if (pages.reduce((n, p) => n + p.text.trim().length, 0) < 40) {
    if (!helpers.scanText) throw Object.assign(new Error('This PDF is pictures of pages, with no text in it to read. Bridge AI reads those on a Mac.'), { code: 'scan' })
    const text = await helpers.scanText(real).catch((e) => { throw Object.assign(new Error(`This PDF is pictures of pages, and reading them didn't work: ${e.message}`), { code: 'scan' }) })
    if (String(text).trim().length < 40) throw Object.assign(new Error('This PDF is pictures of pages, and no words could be read from them.'), { code: 'scan' })
    pages = [{ n: 1, text: String(text) }]
    scanned = true
  }
  const room = await budget(info.id)
  if (room < 3000) throw Object.assign(new Error(`${info.label} reads too little at a time for this. Pick another model.`), { code: 'too_small' })
  let used = 0, read = 0, cut = false
  const parts = []
  for (const p of pages) {
    const block = `--- Page ${p.n} ---\n${p.text.trim()}\n`
    if (used + block.length > room && parts.length) break
    if (block.length > room) cut = true
    parts.push(block.slice(0, room))
    used += block.length
    read++
  }
  // The page sends at most so much of a long PDF; its whole length is said either way.
  const all = Math.max(pages.length, scanned ? 0 : Math.min(100_000, Number(total) || 0))
  const language = LANG(lang)
  const ask = [
    'Explain this document, which I have been asked to sign.',
    `Answer with JSON only, in this shape:\n${SHAPE}`,
    'Leave a list empty, or a field "", when the document says nothing about it. "watch" is for what deserves a careful read: an automatic renewal, a penalty, a one-sided right, an unusual limit, a short deadline, something that looks unfinished or missing.',
    language && language !== 'English' ? `Write the explanation in ${language}; keep names, amounts and quotes as the document writes them.` : '',
    `The document${read < all ? ` (its first ${read} of ${all} pages)` : ''}:\n${parts.join('\n')}`,
  ].filter(Boolean).join('\n\n')
  const msgs = [{ role: 'user', text: ask }]
  const o = { system: SYSTEM, feature: 'studio' }
  let r = await helpers.reply(info.id, msgs, o)
  // (Another in AI Assist's own list, when that one couldn't answer: index.js replyFor.)
  const by = r.model && r.model !== info.id ? await modelInfo(r.model) : info
  let v = parsed(r.text)
  if (!v) { r = await helpers.reply(by.id, msgs, { ...o, json: SCHEMA }); v = parsed(r.text) }
  if (!v) throw new Error(`${by.label} answered, but not in a form Bridge AI can read. Try again, or pick another model.`)
  return { model: by, explained: tidy(v, all || pages.length), pagesRead: scanned ? all || 1 : read, pagesAll: scanned ? all || 1 : all, cut, scanned, at: new Date().toISOString() }
}

// ---------- Routes ----------
// Under Studio's own (/api/studio). From index.js: here(req) (this computer itself), device(req)
// (the paired device a request came through, and the one a computer says it asks for), nameOf(req)
// (that device's name, or this computer's), page(req) (one of your own windows: a page's cookie, or
// a device through the relay; not a program holding the key), and record(…) (the document's
// versions, studio.js).
const answer = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)) } catch (e) { res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message, ...(typeof e.code === 'string' ? { code: e.code } : {}), ...(e.data && typeof e.data === 'object' ? e.data : {}) }) }
}
const SIG_ID = /^[a-z0-9]{8,32}$/
export function routes(app, { wrap, rootOf, sq, here, device, nameOf, page, record }) {
  // Who may sign, or ask for Ask Before Signing's grant: this computer itself, or one of your devices
  // the relay proves (not a request that only says it's one, nor one through Tailscale, which can't
  // be told from a program here).
  const asker = (req) => {
    const h = here(req)
    const { device: d, forId } = device(req)
    if (!h && !d) throw Object.assign(new Error('Sign in Bridge AI on the computer, or on one of your devices paired with it.'), { status: 403, code: 'not-here' })
    return { here: h, device: d, forId }
  }
  const me = (req) => auth.who(asker(req))
  // (Signing with Ask Before Signing off: anyone who reaches this server as you, as before.)
  const signer = (req) => { try { return asker(req) } catch { return { here: false, device: null, forId: null } } }
  app.get('/api/studio/sign/setup', wrap(async (req) => {
    const h = here(req)
    let sigs
    try { sigs = { ...(await mine()), setAside: await store.setAsideNote() } } catch (e) { sigs = { list: [], signature: null, initials: null, sealError: e.message } }
    const p = h ? await probe() : { trackpad: false }
    const me = device(req).device
    return {
      ...sigs, sealed: store.sealedWith(), model: await modelInfo(String(req.query.model || '') || null), readsScans: !!helpers.scanText,
      ask: await auth.status(h), trackpad: !!p.trackpad,
      // Your phones the pad can ask (Sign on Phone): not the one asking.
      phones: phone.phones().filter((x) => x.id !== me).map(({ id, name }) => ({ id, name })),
    }
  }))
  // A picture, to your own windows only: never to a program on this computer holding the key alone
  // (the CLI, `bridge-ai mcp`, a script), which has no use for one.
  app.get('/api/studio/signature/:id', async (req, res) => {
    try {
      if (!page(req)) throw Object.assign(new Error('Your signatures are shown only in Bridge AI\'s own windows'), { status: 403 })
      const id = String(req.params.id)
      const x = MARKS.includes(id) ? await store.pick(id, null) : SIG_ID.test(id) ? { id } : null
      if (!x) throw Object.assign(new Error('Not drawn yet'), { status: 404 })
      const png = await store.image(x.id)
      res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Type': 'image/png', 'Content-Length': String(png.length) })
      res.end(png)
    } catch (e) { res.status(e.status === 403 ? 403 : 404).json({ error: e.status === 403 ? e.message : 'Not drawn yet' }) }
  })
  // Add one (kind, name, png; default: the one to use from now on), rename one or make it the
  // default, take one away.
  // (replace: one of yours drawn again, which keeps its name and whether it's the default.)
  app.post('/api/studio/signatures', answer(async (req) => { const r = await store.add({ kind: String(req.body?.kind || ''), name: req.body?.name, png: req.body?.png, makeDefault: req.body?.default === true, replace: SIG_ID.test(String(req.body?.replace || '')) ? String(req.body.replace) : null }); return { id: r.id, ...(await mine()) } }))
  app.patch('/api/studio/signatures/:id', answer(async (req) => { await store.change(String(req.params.id), { name: req.body?.name, makeDefault: req.body?.default === true }); return mine() }))
  app.delete('/api/studio/signatures/:id', answer(async (req) => { await store.remove(String(req.params.id)); return mine() }))
  // Drawn again: the default of that kind replaced (or the first one, when there's none).
  app.put('/api/studio/signature/:which', answer(async (req) => {
    const kind = String(req.params.which)
    if (!MARKS.includes(kind)) throw Object.assign(new Error('Only a signature or initials'), { status: 400 })
    const was = await store.pick(kind, null)
    await store.add({ kind, png: req.body?.png, replace: was?.id || null, makeDefault: true })
    return mine()
  }))
  app.delete('/api/studio/signature/:which', answer(async (req) => {
    const was = MARKS.includes(String(req.params.which)) ? await store.pick(String(req.params.which), null) : null
    if (was) await store.remove(was.id)
    return mine()
  }))

  // ---------- Ask Before Signing ----------
  app.get('/api/studio/sign/ask', answer((req) => auth.status(here(req))))
  // Asked now (Touch ID on this Mac, or the PIN): a grant for this document's signing, or for a
  // change to the setting.
  app.post('/api/studio/sign/ask', answer(async (req) => {
    const purpose = req.body?.purpose === 'settings' ? 'settings' : 'sign'
    const q = purpose === 'sign' ? sq(req) : null
    if (q) await rootOf(q.root)
    const name = q ? path.basename(String(q.path || '')) : null
    return auth.ask({ ...asker(req), purpose, doc: q ? { root: String(q.root), path: String(q.path) } : null, reason: name ? `sign ${name.slice(0, 80)}` : 'change Ask Before Signing', pin: req.body?.pin != null ? String(req.body.pin) : null })
  }))
  app.post('/api/studio/sign/ask/setting', answer((req) => auth.set({ ...asker(req), on: typeof req.body?.on === 'boolean' ? req.body.on : undefined, pin: req.body?.pin != null ? String(req.body.pin) : null, removePin: req.body?.removePin === true, grant: req.body?.grant })))

  app.get('/api/studio/sign/check', wrap(async (req) => { const q = sq(req); return inspect(await rootOf(q.root), q.path) }))
  app.post('/api/studio/sign/explain', wrap(async (req) => { const q = sq(req); return explain(await rootOf(q.root), q.path, { pages: req.body?.pages, total: req.body?.total, model: req.body?.model ? String(req.body.model) : null, lang: req.body?.lang }) }))
  // The signed copy: with Ask Before Signing on, only with the grant asked for this document by this
  // device (used up here, whatever happens next). Then it's in the document's versions.
  app.post('/api/studio/sign', answer(async (req) => {
    const q = sq(req)
    const root = await rootOf(q.root)
    let how = null
    if (await auth.needed()) {
      const g = auth.use(req.body?.grant, { purpose: 'sign', doc: { root: String(q.root), path: String(q.path) }, ...signer(req) })
      if (!g) throw Object.assign(new Error('Confirm it\'s you first: Ask Before Signing is on.'), { status: 403, code: 'ask' })
      how = g.how
    }
    const r = await sign(root, q.path, req.body?.marks)
    const on = nameOf(req)
    const rec = { on, how, places: r.places, at: new Date().toISOString(), copy: r.path, from: String(q.path) }
    await record({ original: r.from, copy: r.real, rec }).catch((e) => console.error(`signing: signed, but its versions couldn't say so: ${e.message}`))
    const { real: _r, from: _f, ...out } = r
    return { root: q.root, ...out, record: rec }
  }))

  // ---------- The trackpad (this Mac's own window only) ----------
  // A stream of the finger's place while you sign on the trackpad (native/bridgesign trackpad),
  // as server-sent events: ready, then d, m, u, and done or cancel. Closing it stops it.
  app.get('/api/studio/sign/trackpad', async (req, res) => {
    if (!here(req)) return res.status(403).json({ error: 'The trackpad is this computer\'s: sign on it in Bridge AI on this computer', code: 'here' })
    if (!(await probe()).trackpad) return res.status(409).json({ error: 'This Mac has no trackpad to sign on', code: 'no-trackpad' })
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.flushHeaders()
    // (Ended, it isn't started again by the browser reconnecting on its own.)
    res.write('retry: 3600000\n\n')
    const t = trackpad({
      hint: String(req.query.hint || '').slice(0, 160) || null,
      onLine: (j) => res.write(`data: ${JSON.stringify(j)}\n\n`),
      onEnd: (j) => { res.write(`event: end\ndata: ${JSON.stringify(j)}\n\n`); res.end() },
    })
    req.on('close', () => t.stop())
  })

  // ---------- Sign on Phone (signphone.js) ----------
  app.post('/api/studio/sign/phone', answer((req) => phone.ask({ asker: me(req), askerName: nameOf(req), what: req.body?.what === 'initials' ? 'initials' : 'signature', doc: String(req.body?.doc || ''), to: req.body?.to ? String(req.body.to) : null })))
  // The pad that asked: how it stands (wait=1: until it changes, or 25 s), and cancelled from there.
  app.get('/api/studio/sign/phone/:id/state', answer((req) => phone.state(req.params.id, me(req), req.query.wait === '1' ? 25000 : 0)))
  // The phone: what's waiting for it, one of them, its answer, or cancelled there.
  const phoneOf = (req) => { const d = device(req); return d.forId ? null : d.device }
  app.get('/api/studio/sign/phone', answer((req) => ({ list: phone.waitingFor(phoneOf(req)) })))
  app.get('/api/studio/sign/phone/:id', answer((req) => phone.one(req.params.id, phoneOf(req))))
  app.post('/api/studio/sign/phone/:id/answer', answer((req) => phone.answer(req.params.id, phoneOf(req), { nonce: req.body?.nonce, ink: req.body?.ink })))
  app.post('/api/studio/sign/phone/:id/cancel', answer((req) => {
    const d = phoneOf(req)
    // The phone it went to, or the pad that asked.
    try { if (d) return phone.cancel(req.params.id, { device: d }) } catch (e) { if (e.code !== 'gone') throw e }
    return phone.cancel(req.params.id, { asker: me(req) })
  }))
}
