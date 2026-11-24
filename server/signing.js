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
import crypto from 'node:crypto'
import { PDFDocument, StandardFonts, PDFSignature, PDFTextField, PDFName, PDFRef, PDFString, degrees, rgb } from 'pdf-lib'
import { safePath } from './files.js'
import * as store from './signstore.js'
import * as auth from './signauth.js'
import * as phone from './signphone.js'
import { probe, trackpad, limiter } from './signhelper.js'
import { shownSize, fitImage, dateSize, dateSpot, toUser, KINDS } from '../shared/signmarks.js'
import { placeEn } from '../shared/places.js'

const MARKS = ['signature', 'initials'] // the two you draw
const MAX_PDF = store.MAX_PDF
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
  if (st.size > MAX_PDF) throw tooBig(st.size)
  return { real, realRoot, bytes: await fsp.readFile(real) }
}
// Over the limit: said with its size, the reason it can't be signed.
const tooBig = (size) => Object.assign(new Error(`This PDF is ${Math.round(size / 1024 / 1024)} MB, and Studio signs PDFs up to ${MAX_PDF / 1024 / 1024} MB.`), { status: 413, code: 'too-big' })
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
// want: the sha256 of the bytes you were shown and confirmed (signauth.js grants it): the PDF must
// still be those bytes, or nothing is signed (it changed since: an agent in that folder, say). The
// copy is made from the very bytes checked, and says in its own information that it's a signed copy
// (MARK), so it's known for one wherever it goes (studio.js keeps no copy of it).
export const MARK = 'BridgeAISigned'
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
export async function sign(root, rel, marks, { want = null, id = null } = {}) {
  const { real, realRoot, bytes } = await pdfAt(root, rel)
  const fromSha256 = sha256(bytes)
  if (want && want !== fromSha256) throw Object.assign(new Error('The document changed since you confirmed: look at it again, then sign.'), { status: 409, code: 'changed' })
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
  try { doc.getInfoDict().set(PDFName.of(MARK), PDFString.of(String(id || 'yes'))) } catch { /* known by its hash still */ }
  // Only the fields filled here get a new look; the rest of the form stays as it was drawn. (Its
  // objects written out plainly, so the mark above can be found in its bytes.)
  const out = await doc.save({ updateFieldAppearances: false, useObjectStreams: false })
  const dir = path.join(path.dirname(real), '_signed')
  await fsp.mkdir(dir, { recursive: true })
  // Still inside the folder it came from (a _signed that's a link to elsewhere isn't followed).
  const at = await fsp.realpath(dir)
  if (!at.startsWith(realRoot + path.sep)) throw new Error('Its _signed folder leads outside the folder it\'s in')
  const stem = path.basename(real, path.extname(real))
  for (let n = 1; n < 1000; n++) {
    const file = path.join(at, `${stem} (signed${n > 1 ? ` ${n}` : ''}).pdf`)
    try { await fsp.writeFile(file, out, { flag: 'wx' }) } catch (e) { if (e.code === 'EEXIST') continue; throw e }
    return { path: path.relative(realRoot, file).split(path.sep).join('/'), name: path.basename(file), folder: '_signed', marks: list.length, pages: [...new Set(list.map((m) => m.page))].sort((a, b) => a - b), real: file, from: real, places: list.map(({ kind, page }) => ({ kind, page })), sha256: sha256(out), fromSha256 }
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
// Under Studio's own (/api/studio). Who may do anything with your signatures (see them, add or
// change them, sign, ask for Touch ID, start the trackpad or Sign on Phone): one of the app's own
// windows on this computer (window(req): windowkey.js, which a program that only has the key can't
// be), or one of your phones (phone(req): paired here, kept, let in, the relay proving it; never
// another computer, nor a device not kept yet). Not a browser tab, not Tailscale, not a program
// with the key: they're told signing is done in the app or on your phone. From index.js: those two,
// nameOf(req) (the device's name, or this computer's), record(…) (the document's versions,
// studio.js), and checked(…) for the PDF being asked about.
const answer = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)) } catch (e) { res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message, ...(typeof e.code === 'string' ? { code: e.code } : {}), ...(e.data && typeof e.data === 'object' ? e.data : {}) }) }
}
const SIG_ID = /^[a-z0-9]{8,32}$/
export const NOT_YOURS = 'Signing is done in the Bridge AI app on this computer, or in the app on your phone: not from here.'
// The trackpad's hint, as the helper shows it (macOS's card), in the page's language: written here,
// never taken from the request.
const HINTS = {
  en: 'Draw on the trackpad with one finger; press any key when done. Esc starts again.',
  de: 'Zeichne mit einem Finger auf dem Trackpad; drück eine beliebige Taste, wenn du fertig bist. Esc fängt neu an.',
  es: 'Dibuja en el trackpad con un dedo; pulsa cualquier tecla al terminar. Esc empieza de nuevo.',
  fr: 'Dessinez sur le trackpad avec un doigt ; appuyez sur une touche quand vous avez fini. Échap recommence.',
  hi: 'ट्रैकपैड पर एक उँगली से बनाएँ; हो जाने पर कोई भी की दबाएँ। Esc दबाने पर फिर से शुरू होता है।',
  ja: 'トラックパッド上を 1 本の指で描き、終わったら任意のキーを押します。Esc でやり直します。',
  'pt-BR': 'Desenhe no trackpad com um dedo; pressione qualquer tecla quando terminar. Esc recomeça.',
  'zh-CN': '用一根手指在触控板上画，画完按任意键。按 Esc 重新开始。',
}
const trackpads = limiter(6, 60_000)
export function routes(app, { wrap, rootOf, sq, window: fromWindow, phone: phoneOf, nameOf, record, tellApp = () => {} }) {
  // Who's asking: { here: the app's window, device: a phone of yours }, or refused.
  const asker = (req) => {
    const here = fromWindow(req)
    const device = here ? null : phoneOf(req)
    if (!here && !device) throw Object.assign(new Error(NOT_YOURS), { status: 403, code: 'not-yours' })
    return { here, device }
  }
  const me = (req) => auth.who(asker(req))
  // While Ask Before Signing is on: a change to your saved signatures with a grant for it.
  const changing = async (req) => {
    const a = asker(req)
    if (!(await auth.needed())) return a
    if (!auth.use(req.body?.grant, { purpose: 'change', ...a })) throw Object.assign(new Error('Confirm it\'s you first: Ask Before Signing is on, so changing your signatures is asked for too.'), { status: 403, code: 'ask' })
    return a
  }
  // The PDF a signing is about: in its root, a PDF that's there. Its name, for what Touch ID says.
  const realPdf = async (q) => {
    const { real } = await safePath(await rootOf(q.root), q.path)
    const st = await fsp.stat(real).catch(() => null)
    if (!st?.isFile() || path.extname(real).toLowerCase() !== '.pdf') throw Object.assign(new Error('Only a PDF can be signed here'), { status: 400 })
    return real
  }
  app.get('/api/studio/sign/setup', wrap(async (req) => {
    const here = fromWindow(req)
    const device = here ? null : phoneOf(req)
    let sigs
    try { sigs = { ...(await mine()), setAside: await store.setAsideNote(), older: await store.olderNote(), windowChanged: await store.windowChangedNote() } } catch (e) { sigs = { list: [], signature: null, initials: null, sealError: e.message, ...(e.code === 'keys-unreadable' ? { keysUnreadable: true, canStartOver: here && store.startOverOffered() } : {}) } }
    const p = here ? await probe() : { trackpad: false }
    return {
      ...sigs, sealed: store.sealedWith(), model: await modelInfo(String(req.query.model || '') || null), readsScans: !!helpers.scanText,
      // Who this is to signing: 'window', 'phone', or null (it can't sign from here: said, and why).
      who: here ? 'window' : device ? 'phone' : null, canSign: !!(here || device),
      ask: await auth.status(here), trackpad: here && !!p.trackpad,
      // Your phones the pad can ask (Sign on Phone): not the one asking.
      phones: here || device ? phone.phones().filter((x) => x.id !== device).map(({ id, name }) => ({ id, name })) : [],
    }
  }))
  // A picture: to your own windows and phones only.
  app.get('/api/studio/signature/:id', async (req, res) => {
    try {
      asker(req)
      const id = String(req.params.id)
      const x = MARKS.includes(id) ? await store.pick(id, null) : SIG_ID.test(id) ? { id } : null
      if (!x) throw Object.assign(new Error('Not drawn yet'), { status: 404 })
      const png = await store.image(x.id)
      res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Type': 'image/png', 'Content-Length': String(png.length) })
      res.end(png)
    } catch (e) { res.status(e.status === 403 ? 403 : 404).json({ error: e.status === 403 ? e.message : 'Not drawn yet', ...(e.status === 403 ? { code: e.code } : {}) }) }
  })
  // Add one (kind, name, png; default: the one to use from now on), rename one or make it the
  // default, take one away. (replace: one of yours drawn again, which keeps its name and whether
  // it's the default.)
  app.post('/api/studio/signatures', answer(async (req) => { await changing(req); const r = await store.add({ kind: String(req.body?.kind || ''), name: req.body?.name, png: req.body?.png, makeDefault: req.body?.default === true, replace: SIG_ID.test(String(req.body?.replace || '')) ? String(req.body.replace) : null }); return { id: r.id, ...(await mine()) } }))
  app.patch('/api/studio/signatures/:id', answer(async (req) => { await changing(req); await store.change(String(req.params.id), { name: req.body?.name, makeDefault: req.body?.default === true }); return mine() }))
  app.delete('/api/studio/signatures/:id', answer(async (req) => { await changing(req); await store.remove(String(req.params.id)); return mine() }))
  // Drawn again: the default of that kind replaced (or the first one, when there's none).
  app.put('/api/studio/signature/:which', answer(async (req) => {
    await changing(req)
    const kind = String(req.params.which)
    if (!MARKS.includes(kind)) throw Object.assign(new Error('Only a signature or initials'), { status: 400 })
    const was = await store.pick(kind, null)
    await store.add({ kind, png: req.body?.png, replace: was?.id || null, makeDefault: true })
    return mine()
  }))
  app.delete('/api/studio/signature/:which', answer(async (req) => {
    await changing(req)
    const was = MARKS.includes(String(req.params.which)) ? await store.pick(String(req.params.which), null) : null
    if (was) await store.remove(was.id)
    return mine()
  }))

  // ---------- Ask Before Signing ----------
  // (canSign: whether it can be changed from where it's asked: the app's window or your phone.)
  app.get('/api/studio/sign/ask', answer(async (req) => ({ ...(await auth.status(fromWindow(req))), canSign: !!(fromWindow(req) || phoneOf(req)) })))
  // Asked now (Touch ID on this Mac, or the PIN): a grant for one document's signing ('sign'), for
  // the setting ('settings'), for changing your signatures ('change') or for taking them into a
  // backup or a move ('export'). What Touch ID says is written here, from the document itself.
  app.post('/api/studio/sign/ask', answer(async (req) => {
    const a = asker(req)
    const purpose = ['settings', 'change', 'export', 'start-over'].includes(req.body?.purpose) ? req.body.purpose : 'sign'
    const q = purpose === 'sign' ? sq(req) : null
    const real = q ? await realPdf(q) : null
    // The document as it is now, and as the page showed it (its sha256, when it had it whole): the
    // same, or you'd be confirming something other than what you saw. The grant is for these bytes.
    const now = real ? sha256(await fsp.readFile(real)) : null
    const shown = /^[0-9a-f]{64}$/.test(String(req.body?.sha256 || '')) ? req.body.sha256 : null
    if (now && shown && shown !== now) throw Object.assign(new Error('The document changed since it was shown here: look at it again, then sign.'), { status: 409, code: 'changed' })
    const reason = real ? `sign "${path.basename(real).slice(0, 80)}"` : purpose === 'export' ? 'put your signatures in a backup' : purpose === 'start-over' ? 'start over with a new key for your signatures' : purpose === 'change' ? 'change your saved signatures' : 'change Ask Before Signing'
    return auth.ask({ ...a, purpose, doc: q ? { root: String(q.root), path: String(q.path) } : null, sha256: now, reason, pin: req.body?.pin != null ? String(req.body.pin) : null })
  }))
  app.post('/api/studio/sign/ask/setting', answer((req) => auth.set({ ...asker(req), on: typeof req.body?.on === 'boolean' ? req.body.on : undefined, pin: req.body?.pin != null ? String(req.body.pin) : null, removePin: req.body?.removePin === true, grant: req.body?.grant })))

  app.get('/api/studio/sign/check', wrap(async (req) => { const q = sq(req); return inspect(await rootOf(q.root), q.path) }))
  app.post('/api/studio/sign/explain', wrap(async (req) => { const q = sq(req); return explain(await rootOf(q.root), q.path, { pages: req.body?.pages, total: req.body?.total, model: req.body?.model ? String(req.body.model) : null, lang: req.body?.lang }) }))
  // The signed copy: from your window or phone only, Ask Before Signing on or off; with it on (or
  // its list unreadable), only with the grant asked for this document by this one (used up here,
  // whatever happens next). Then it's in both files' versions, with which way it was signed, how
  // it was asked, the copy's hash and a MAC over it all.
  app.post('/api/studio/sign', answer(async (req) => {
    const a = asker(req)
    const q = sq(req)
    const root = await rootOf(q.root)
    let how = null
    // The bytes you were shown (the page's sha256), and with Ask Before Signing on, the ones you
    // confirmed (the grant's): signing finds those or signs nothing.
    let want = /^[0-9a-f]{64}$/.test(String(req.body?.sha256 || '')) ? req.body.sha256 : null
    if (await auth.needed()) {
      const g = auth.use(req.body?.grant, { purpose: 'sign', doc: { root: String(q.root), path: String(q.path) }, ...a })
      if (!g) throw Object.assign(new Error('Confirm it\'s you first: Ask Before Signing is on.'), { status: 403, code: 'ask' })
      how = g.how
      if (want && g.sha256 && want !== g.sha256) throw Object.assign(new Error('The document changed since you confirmed: look at it again, then sign.'), { status: 409, code: 'changed' })
      want = g.sha256 || want
    }
    // What was shown, always (the page's own hash of the bytes it has, or for one it read in parts,
    // the one Studio took as it opened it: studio.js open): no document is signed as it is now
    // without it having been seen so. (Too big to sign: said so, its size the reason.)
    const st0 = await fsp.stat((await safePath(root, q.path)).real).catch(() => null)
    if (st0 && st0.size > MAX_PDF) throw tooBig(st0.size)
    if (!/^[0-9a-f]{64}$/.test(String(req.body?.sha256 || ''))) throw Object.assign(new Error('Open the PDF again to sign it: what it showed you wasn\'t sent.'), { status: 400, code: 'need-sha' })
    const id = `s${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
    const r = await sign(root, q.path, req.body?.marks, { want, id })
    const rec = { id, on: nameOf(req), via: a.here ? 'window' : 'phone', how, places: r.places, at: new Date().toISOString(), copy: r.path, from: String(q.path), sha256: r.sha256, fromSha256: r.fromSha256 }
    rec.mac = await store.macOf(rec, { orig: r.from, copy: r.real }).catch(() => null)
    await record({ original: r.from, copy: r.real, rec }).catch((e) => console.error(`signing: signed, but its versions couldn't say so: ${e.message}`))
    const { real: _r, from: _f, ...out } = r
    return { root: q.root, ...out, record: rec }
  }))

  // ---------- Start Over (the app's keys that can't be opened any more) ----------
  // From the app's window here, once you've confirmed with Touch ID, the Mac's password or Windows
  // Hello: the app is told (its own feed) to keep the keys that won't open and make new ones, then it
  // starts this server again with them (desktop/windowauth.js startOver, main.js).
  app.post('/api/studio/sign/start-over', answer(async (req) => {
    const a = asker(req)
    if (!a.here) throw Object.assign(new Error('Start Over is done in the Bridge AI app on this computer.'), { status: 403, code: 'not-here' })
    if (!store.startOverOffered()) throw Object.assign(new Error('There\'s nothing to start over.'), { status: 409, code: 'nothing' })
    if (!auth.use(req.body?.grant, { purpose: 'start-over', ...a })) throw Object.assign(new Error('Confirm it\'s you first.'), { status: 403, code: 'ask' })
    // (Told once this answer has gone: the app then stops this server to start it again with its new
    // keys, which would cut the answer off, and the window would say it failed.)
    setTimeout(() => tellApp('sign-start-over', { at: new Date().toISOString() }), 250)
    return { ok: true }
  }))

  // ---------- The trackpad (this Mac's own window only) ----------
  // A stream of the finger's place while you sign on the trackpad (native/bridgesign trackpad),
  // as server-sent events: ready, then d, m, u, and done or cancel. Closing it stops it. Its hint
  // is this server's, in the page's language (lang).
  app.get('/api/studio/sign/trackpad', async (req, res) => {
    if (!fromWindow(req)) return res.status(403).json({ error: 'The trackpad is this Mac\'s: sign on it in the Bridge AI app here', code: 'not-yours' })
    if (!(await probe()).trackpad) return res.status(409).json({ error: 'This Mac has no trackpad to sign on', code: 'no-trackpad' })
    if (!trackpads()) return res.status(429).json({ error: 'Started too often just now. Wait a minute and try again.', code: 'too-often' })
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.flushHeaders()
    // (Ended, it isn't started again by the browser reconnecting on its own.)
    res.write('retry: 3600000\n\n')
    const t = trackpad({
      hint: HINTS[String(req.query.lang || '')] || HINTS.en,
      onLine: (j) => res.write(`data: ${JSON.stringify(j)}\n\n`),
      onEnd: (j) => { res.write(`event: end\ndata: ${JSON.stringify(j)}\n\n`); res.end() },
    })
    req.on('close', () => t.stop())
  })

  // ---------- Sign on Phone (signphone.js) ----------
  // The pad that asks gets its own key for it (pad), and only that follows, cancels it and gets the ink.
  app.post('/api/studio/sign/phone', answer((req) => phone.ask({ asker: me(req), askerName: nameOf(req), what: req.body?.what === 'initials' ? 'initials' : 'signature', doc: String(req.body?.doc || ''), to: req.body?.to ? String(req.body.to) : null })))
  app.get('/api/studio/sign/phone/:id/state', answer((req) => phone.state(req.params.id, me(req), String(req.query.pad || ''), req.query.wait === '1' ? 25000 : 0)))
  // The phone: what's waiting for it, one of them, its answer, or cancelled there.
  app.get('/api/studio/sign/phone', answer((req) => ({ list: phone.waitingFor(phoneOf(req)) })))
  app.get('/api/studio/sign/phone/:id', answer((req) => phone.one(req.params.id, phoneOf(req))))
  app.post('/api/studio/sign/phone/:id/answer', answer((req) => phone.answer(req.params.id, phoneOf(req), { nonce: req.body?.nonce, ink: req.body?.ink })))
  app.post('/api/studio/sign/phone/:id/cancel', answer((req) => {
    const d = phoneOf(req)
    // The phone it went to, or the pad that asked (with its key).
    try { if (d) return phone.cancel(req.params.id, { device: d }) } catch (e) { if (e.code !== 'gone') throw e }
    return phone.cancel(req.params.id, { asker: me(req), pad: String(req.body?.pad || '') })
  }))
}
// Taking your signatures into a backup or a move (backup.js): from your window or a phone, with a
// grant for it ('export'), asked as Ask Before Signing asks (Touch ID or the password where this
// Mac has them), whether that's on or not.
// Signatures added from a backup or a move: only from your own window or phone, and while Ask
// Before Signing is on, once it's asked (a 'change' grant), as any other change to them.
export async function importAllowed(req, grant, { window: fromWindow, phone: phoneOf }) {
  const here = fromWindow(req)
  const device = here ? null : phoneOf(req)
  if (!here && !device) throw Object.assign(new Error(NOT_YOURS), { status: 403, code: 'not-yours' })
  if ((await auth.needed()) && !auth.use(grant, { purpose: 'change', here, device })) throw Object.assign(new Error('Confirm it\'s you first: Ask Before Signing is on, so changing your signatures is asked for too.'), { status: 403, code: 'ask' })
}
export function exportAllowed(req, grant, { window: fromWindow, phone: phoneOf }) {
  const here = fromWindow(req)
  const device = here ? null : phoneOf(req)
  if (!here && !device) throw Object.assign(new Error(NOT_YOURS), { status: 403, code: 'not-yours' })
  if (!auth.use(grant, { purpose: 'export', here, device })) throw Object.assign(new Error('Confirm it\'s you first: putting your signatures in a backup or a move is asked for.'), { status: 403, code: 'ask' })
}
