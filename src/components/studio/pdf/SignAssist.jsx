import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../Icon.jsx'
import { api } from '../../../api.js'
import { t, tx, currentLang, locale } from '../../../i18n/index.js'
import { q as fileQuery } from '../files.js'
import { SIZES } from '../../../../shared/signmarks.js'
import { findPlaces } from './find.js'
import { pageData, pagesText } from './read.js'
import { SignatureChooser, sigsOf, NotHere } from './Signatures.jsx'
import { HOW, signedLine, placesLine } from './signed.js'
import { KIND } from './Marks.jsx'
import { AssistHead } from '../../AiAssist.jsx'
import { where } from '../../settings/search.js'

// AI Assist's Sign this, beside a PDF: one step at a time, as calm as its suggestions in a meeting.
//   1. What you're signing: the model you pick reads its text and says, in plain words, what it is,
//      who's in it, the money, the dates, what you'd agree to, renewal and ending it, and what's
//      worth a closer look (each a tap from its page). It says which model read it, and that the
//      text went to it. It explains; it isn't legal advice.
//   2. Where to sign: your signature (drawn here if it isn't yet; another of yours picked, or a new
//      one drawn), then the places the PDF asks for one (find.js), each on its page to move, resize
//      and approve, or Sign everywhere it asks at once; more added by hand, as many as it needs.
//   3. A signed copy: the places you approved, written into a new PDF in _signed beside this one
//      (server/signing.js), which then opens. The original stays as it is. With Ask Before Signing
//      on, Touch ID (or the Mac's password, Windows Hello, your signing PIN) first, once for them
//      all; the signing is in both files' versions, with how it was asked.
// Honest throughout: it's a drawn signature on the page, not a certificate-based digital one.
const STEPS = [['read', tx('What you\'re signing')], ['place', tx('Where to sign')], ['save', tx('Save a signed copy')]]
const read = new Map() // what was explained, by file and version, while the app is open
const keyOf = (f) => `${f.root}\n${f.path}\n${f.mtime}`

// Today, as a date can be written on a PDF (its own font has Latin letters and digits only).
const latin = (s) => /^[\x20-\x7e\xa0-\xff]+$/.test(s)
function dateChoices() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const out = [
    d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`,
    `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`,
    `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`,
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  ]
  const own = d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' })
  if (latin(own) && !out.includes(own)) out.push(own)
  return { list: out, first: currentLang() === 'en' ? out[0] : latin(own) ? own : out[5] }
}

// shown(): the sha256 of the PDF's bytes as this page has them (PdfView), sent with what's asked
// and signed, so a file changed since it was shown is said, never signed (server/signing.js).
export default function SignAssist({ file, pdf, shown = null, setup, marks, setMarks, picked, setPicked, onApprove, dateText, setDateText, using, setUsing, onShow, onPoint, onOpen, onClose }) {
  // Back where you were: at the places, once there are some.
  const [step, setStep] = useState(() => (marks.length ? 'place' : 'read'))
  const go = (s) => { setStep(s); body.current?.scrollTo?.({ top: 0 }) }
  const body = useRef(null)
  const approved = marks.filter((m) => m.approved)
  const [skipped, setSkipped] = useState(false)
  const [said, setSaid] = useState(() => read.get(keyOf(file)) || null)
  const summary = {
    read: said ? (said.explained.kind || t('Read')) : skipped ? t('Skipped') : null,
    place: approved.length ? (approved.length === 1 ? t('1 place approved') : t('{n} places approved', { n: approved.length })) : null,
    save: null,
  }
  return (
    <aside className="sd-sign" aria-label={t('AI Assist')}>
      <AssistHead className="sd-panel-head sd-sign-head" what={t('Sign this')} onClose={onClose} />
      <div className="sd-sign-body" ref={body}>
        {setup.data && !setup.data.canSign && <NotHere />}
        <ol className="sd-steps">
          {STEPS.map(([id, title], i) => {
            const on = step === id
            const done = !on && !!summary[id]
            return (
              <li key={id} className={`sd-step${on ? ' on' : ''}${done ? ' done' : ''}`}>
                <button type="button" className="sd-step-head" onClick={() => go(id)} aria-expanded={on} disabled={on}>
                  <span className="sd-step-n" aria-hidden="true">{done ? <Icon name="check" size={11} /> : i + 1}</span>
                  <span className="sd-step-title"><b>{t(title)}</b>{!on && summary[id] && <small className="muted">{summary[id]}</small>}</span>
                </button>
                {on && (
                  <div className="sd-step-body">
                    {id === 'read' && <Explain file={file} pdf={pdf} setup={setup} said={said} onSaid={(r) => { read.set(keyOf(file), r); setSaid(r) }} onPoint={onPoint} onNext={() => go('place')} onSkip={() => { setSkipped(true); go('place') }} />}
                    {id === 'place' && <Place file={file} pdf={pdf} setup={setup} marks={marks} setMarks={setMarks} picked={picked} setPicked={setPicked} onApprove={onApprove} dateText={dateText} setDateText={setDateText} using={using} setUsing={setUsing} onShow={onShow} onNext={() => go('save')} />}
                    {id === 'save' && <Save file={file} shown={shown} setup={setup} marks={marks} dateText={dateText} using={using} onBack={() => go('place')} onOpen={onOpen} />}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
        <p className="muted small sd-sign-honest"><Icon name="info" size={11} /> {t('AI Assist puts a picture of the signature you drew on the page: a simple electronic signature. It isn\'t a certificate-based digital signature, so it doesn\'t lock the PDF or prove who signed it.')}</p>
      </div>
    </aside>
  )
}

// ---------- 1. What you're signing ----------
const SECTIONS = [['money', tx('Money')], ['dates', tx('Dates')], ['obligations', tx('What each side agrees to')]]
function Explain({ file, pdf, setup, said, onSaid, onPoint, onNext, onSkip }) {
  const [models, setModels] = useState(null)
  const [pick, setPick] = useState(() => { try { return localStorage.getItem('cc-sign-model') || '' } catch { return '' } })
  const [busy, setBusy] = useState(null) // what it's doing, in words
  const [err, setErr] = useState(null)
  useEffect(() => { api('/chat/models').then((r) => setModels(r.models || []), () => setModels([])) }, [])
  const dflt = setup.data?.model
  const use = (models || []).find((m) => m.id === pick) || (models || []).find((m) => m.id === dflt?.id) || (dflt ? { id: dflt.id, label: dflt.label, via: dflt.via } : null)
  const name = use ? (use.provider ? `${use.label} (${use.provider.replace(/^Your /, '')})` : use.label) : ''
  const choose = (id) => { setPick(id); try { localStorage.setItem('cc-sign-model', id) } catch { /* this time only */ } }
  const explain = async () => {
    setErr(null)
    try {
      setBusy(t('Reading its pages…'))
      const { pages, all } = await pagesText(pdf.doc)
      setBusy(pages.length === 1 ? t('{model} is reading it…', { model: name }) : t('{model} is reading its {n} pages…', { model: name, n: all }))
      const r = await api('/studio/sign/explain', { method: 'POST', body: { root: file.root, path: file.path, pages, total: all, model: use?.id || null, lang: currentLang() } })
      onSaid(r)
    } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }
  if (said) {
    const x = said.explained
    const label = said.model?.label || said.model?.id
    return (
      <div className="sd-explained">
        {x.kind && <span className="sd-kind">{x.kind}</span>}
        <p className="sd-what">{x.what}</p>
        {said.scanned && <p className="muted small">{t('It\'s a scan: its words were read from the pictures of its pages on this computer first.')}</p>}
        {said.cut && said.pagesRead >= said.pagesAll && <p className="sd-warn small"><Icon name="alert" size={11} /> {t('{model} read the first part of it: that\'s as much as it takes at once. Read the rest yourself, or pick a model that takes more.', { model: label })}</p>}
        {said.pagesRead < said.pagesAll && <p className="sd-warn small"><Icon name="alert" size={11} /> {t('{model} read its first {n} of {total} pages: that\'s as much as it takes at once. Read the rest yourself, or pick a model that takes more.', { model: label, n: said.pagesRead, total: said.pagesAll })}</p>}
        {!!x.parties.length && (
          <div className="sd-ex-sec"><b>{t('Who')}</b>
            <ul className="sd-parties">{x.parties.map((p, i) => <li key={i}><b>{p.name}</b>{p.role && <span className="muted"> · {p.role}</span>}</li>)}</ul>
          </div>
        )}
        {SECTIONS.map(([k, title]) => !!x[k]?.length && (
          <div key={k} className="sd-ex-sec"><b>{t(title)}</b><ul>{x[k].map((s, i) => <li key={i}>{s}</li>)}</ul></div>
        ))}
        {x.renewal && <div className="sd-ex-sec"><b>{t('Renewal')}</b><p>{x.renewal}</p></div>}
        {x.termination && <div className="sd-ex-sec"><b>{t('Ending it')}</b><p>{x.termination}</p></div>}
        {!!x.watch.length && (
          <div className="sd-ex-sec sd-watch"><b><Icon name="flag" size={12} /> {t('Worth a closer look')}</b>
            <ul>{x.watch.map((w, i) => (
              <li key={i}>
                <span>{w.what}</span>
                {(w.page || w.quote) && <button type="button" className="link-btn" onClick={() => onPoint(w.page, w.quote)} title={w.quote ? t('Show it in the PDF, marked') : t('Go to its page')}>{w.page ? t('Page {n}', { n: w.page }) : t('Show it')}</button>}
              </li>
            ))}</ul>
          </div>
        )}
        <p className="muted small sd-ex-by">{t('Read by {model}. It explains what the document says and can miss things; it isn\'t legal advice. For anything that matters, ask a lawyer.', { model: label })}</p>
        <div className="sd-step-acts">
          <button type="button" className="btn small primary" onClick={onNext}>{t('Next: where to sign')} <Icon name="chevron" size={12} /></button>
          <button type="button" className="ghost-btn" onClick={() => onSaid(null) || explain()} disabled={!!busy}>{t('Read it again')}</button>
        </div>
      </div>
    )
  }
  const local = use?.via === 'local'
  return (
    <div className="sd-explain">
      <p className="small">{t('Before you sign, a model reads it and tells you in plain words what it is, who\'s in it, the money and dates, what you\'d agree to, and anything worth a closer look.')}</p>
      {setup.err ? <p className="error-text small" role="alert">{setup.err}</p> : models === null || !setup.data ? <p className="muted small">{t('Opening…')}</p> : use ? (
        <>
          <label className="sd-field sd-model"><span className="muted small">{t('Read by')}</span>
            <select value={use.id} onChange={(e) => choose(e.target.value)} disabled={!!busy}>
              {!(models || []).some((m) => m.id === use.id) && <option value={use.id}>{name}</option>}
              {(models || []).map((m) => <option key={m.id} value={m.id}>{m.label} ({m.provider.replace(/^Your /, '')})</option>)}
            </select>
          </label>
          <p className="muted small sd-sent"><Icon name={local ? 'laptop' : 'cloud'} size={11} /> {local ? t('Its text goes to {model}, on this computer: it doesn\'t leave it. Your signature is never sent.', { model: name }) : t('Its text goes to {model} to be explained. Your signature is never sent.', { model: name })}</p>
        </>
      ) : (
        <p className="sd-warn small" role="alert"><Icon name="alert" size={11} /> {t('There\'s no model to read it with yet. Sign in to an agent, or add a key or a model on this computer in {place}. You can skip this and sign anyway.', { place: where('providers') })}{' '}
          <button type="button" className="link-btn" onClick={() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } }))}>{t('Model Providers')}</button></p>
      )}
      {err && <p className="error-text small" role="alert">{t("Couldn't explain it: {error}", { error: err })}</p>}
      <div className="sd-step-acts">
        <button type="button" className="btn small primary" onClick={explain} disabled={!use || !!busy}>{busy ? <><Icon name="refresh" size={12} className="spin" /> {busy}</> : <><Icon name="wand" size={12} /> {err ? t('Try again') : t('Explain it')}</>}</button>
        <button type="button" className="ghost-btn" onClick={onSkip} disabled={!!busy}>{t('Skip this')}</button>
      </div>
    </div>
  )
}

// ---------- 2. Where to sign ----------
const FROM = { field: tx('Its form\'s own field'), text: tx('Next to "{label}"'), you: tx('Added by you') }
let added = 0
function Place({ file, pdf, setup, marks, setMarks, picked, setPicked, onApprove, dateText, setDateText, using, setUsing, onShow, onNext }) {
  const [look, setLook] = useState(marks.length ? { done: true } : { at: 0, of: pdf.doc.numPages }) // { at, of } | { done } | { error }
  const [tries, setTries] = useState(0)
  const sig = setup.data?.signature
  const hasInitials = marks.some((m) => m.kind === 'initials')
  const dates = useMemo(dateChoices, [])
  useEffect(() => { if (!dateText) setDateText(dates.first) }, [dateText, dates, setDateText])
  // Looked for once, page by page (again after an error).
  const looked = useRef(marks.length ? 'done' : null) // null | 'busy' | 'done'
  useEffect(() => {
    if (looked.current) return undefined
    looked.current = 'busy'
    let on = true
    ;(async () => {
      const all = []
      for (let n = 1; n <= pdf.doc.numPages && on; n++) {
        setLook({ at: n, of: pdf.doc.numPages })
        all.push(await pageData(pdf.lib, pdf.doc, n))
      }
      if (!on) return
      looked.current = 'done'
      const found = findPlaces(all)
      setMarks((ms) => [...ms, ...found])
      setLook({ done: true, found: found.length })
      if (found[0]) { setPicked(found[0].id); onShow(found[0]) }
    })().catch((e) => { looked.current = null; if (on) setLook({ error: e.message }) })
    return () => { on = false; if (looked.current === 'busy') looked.current = null }
  }, [tries, pdf, setMarks, setPicked, onShow])
  const pick = (m) => { setPicked(m.id); onShow(m) }
  // Another, by hand: in the middle of the page in view.
  const add = (kind) => {
    const v = pdf.viewer
    const n = v.currentPageNumber
    const pv = v.getPageView(n - 1)
    const c = v.container
    const top = Math.max(0, c.scrollTop - pv.div.offsetTop), bottom = Math.min(pv.div.clientHeight, c.scrollTop + c.clientHeight - pv.div.offsetTop)
    const [cx, cy] = pv.viewport.convertToPdfPoint(pv.div.clientWidth / 2, (top + bottom) / 2)
    const s = SIZES[kind]
    const [x0, y0, x1, y1] = pv.pdfPage.view
    const m = { id: `you-${++added}`, kind, page: n, x: Math.max(x0, Math.min(x1 - s.w, cx - s.w / 2)), y: Math.max(y0, Math.min(y1 - s.h, cy - s.h / 2)), w: s.w, h: s.h, align: 'left', source: 'you', label: '' }
    setMarks((ms) => [...ms, m])
    setPicked(m.id)
  }
  const next = () => {
    const order = marks.filter((m) => !m.approved)
    const at = order.findIndex((m) => m.id === picked)
    const m = order[(at + 1) % order.length] || order[0]
    if (m) pick(m)
  }
  const open = marks.filter((m) => !m.approved).length
  const ok = marks.length - open
  // Sign everywhere it asks: each place the PDF asks for (its form's fields, the lines it found),
  // approved at once, with yours in it. Not the ones you added: those you place yourself.
  const asked = marks.filter((m) => m.source !== 'you' && !m.approved)
  const canAll = asked.length > 1 && asked.every((m) => m.kind === 'date' || sigsOf(setup, m.kind).length)
  const signAll = () => setMarks((ms) => ms.map((m) => (m.source !== 'you' ? { ...m, approved: true } : m)))
  return (
    <div className="sd-place">
      <SignatureChooser which="signature" setup={setup} value={using.signature} onChange={(id) => setUsing((u) => ({ ...u, signature: id }))} doc={file.name} />
      {hasInitials && <SignatureChooser which="initials" setup={setup} value={using.initials} onChange={(id) => setUsing((u) => ({ ...u, initials: id }))} doc={file.name} />}
      {look && !look.done && !look.error && <p className="muted small sd-looking" role="status"><Icon name="refresh" size={12} className="spin" /> {t('Looking for where to sign: page {n} of {total}…', { n: look.at, total: look.of })}</p>}
      {look?.error && <p className="error-text small" role="alert">{t("Couldn't look for where to sign: {error}", { error: look.error })} <button type="button" className="link-btn" onClick={() => setTries((n) => n + 1)}>{t('Try again')}</button></p>}
      {look?.done && (
        <p className="small sd-found">{marks.length
          ? (marks.length === 1 ? t('1 place to sign. Look at it on the page, move or resize it if it needs it, and approve it.') : t('{n} places to sign. Look at each on its page, move or resize it if it needs it, and approve the ones that are yours.', { n: marks.length }))
          : t('This PDF doesn\'t say where to sign. Add your signature below, then drag it into place on the page.')}</p>
      )}
      {!!marks.length && (
        <ul className="sd-places">
          {marks.map((m) => (
            <li key={m.id} className={`${m.approved ? 'ok' : ''}${picked === m.id ? ' on' : ''}`}>
              <button type="button" className="sd-place-open" onClick={() => pick(m)} aria-current={picked === m.id || undefined}>
                <span className={`sd-place-ic k-${m.kind}`}><Icon name={m.approved ? 'check' : m.kind === 'date' ? 'calendar' : 'signature'} size={12} /></span>
                <span className="sd-place-name"><b>{t(KIND[m.kind])} · {t('page {n}', { n: m.page })}</b><small className="muted">{m.source === 'text' ? t(FROM.text, { label: m.label.length > 34 ? `${m.label.slice(0, 33)}…` : m.label }) : t(FROM[m.source] || FROM.you)}</small></span>
              </button>
              {m.kind !== 'date' && sigsOf(setup, m.kind).length > 1 && m.sig && <span className="sd-place-sig" title={t('This place has its own')}>{sigsOf(setup, m.kind).find((x) => x.id === m.sig)?.name}</span>}
              {m.approved
                ? <button type="button" className="ghost-btn sd-place-undo" onClick={() => setMarks((ms) => ms.map((x) => (x.id === m.id ? { ...x, approved: false } : x)))} title={t('Approved: press to change your mind')}>{t('Approved')}</button>
                : <button type="button" className="btn small" onClick={() => onApprove(m.id)}>{t('Approve')}</button>}
              <button type="button" className="ghost-btn sd-place-x" onClick={() => { setMarks((ms) => ms.filter((x) => x.id !== m.id)); if (picked === m.id) setPicked(null) }} aria-label={t('Take this place away')} title={t('Take this place away')}><Icon name="x" size={11} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="sd-add" role="group" aria-label={t('Add a place to sign')}>
        <button type="button" className="btn small" onClick={() => add('signature')} disabled={!look?.done} title={t('A place for your signature, on the page in view')}><Icon name="plus" size={11} /> {t('Signature')}</button>
        <button type="button" className="btn small" onClick={() => add('initials')} disabled={!look?.done} title={t('A place for your initials, on the page in view')}><Icon name="plus" size={11} /> {t('Initials')}</button>
        <button type="button" className="btn small" onClick={() => add('date')} disabled={!look?.done} title={t('A place for the date, on the page in view')}><Icon name="plus" size={11} /> {t('Date')}</button>
      </div>
      {marks.some((m) => m.kind === 'date') && (
        <label className="sd-field sd-date"><span className="muted small">{t('Today\'s date, in the date places')}</span>
          <span className="sd-date-row">
            <input value={dateText} onChange={(e) => setDateText(e.target.value.slice(0, 40))} aria-label={t('The date to put in')} />
            <select value="" onChange={(e) => e.target.value && setDateText(e.target.value)} aria-label={t('How the date is written')} title={t('How the date is written')}>
              <option value="" disabled hidden>{t('Format')}</option>
              {dates.list.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </span>
          {dateText && !latin(dateText) && <span className="error-text small">{t('The PDF\'s own font writes Latin letters and digits only: pick a date in digits.')}</span>}
        </label>
      )}
      {canAll && (
        <div className="sd-all">
          <button type="button" className="btn small" onClick={signAll}><Icon name="signature" size={12} /> {t('Sign everywhere it asks')}</button>
          <small className="muted">{t('Approves all {n} places it found, with your default signature, initials and the date. Look them over on the pages before you save.', { n: asked.length })}</small>
        </div>
      )}
      <div className="sd-step-acts">
        {open > 0 && <button type="button" className="btn small" onClick={next}>{t('Next place')} <Icon name="down" size={12} /></button>}
        <button type="button" className="btn small primary" onClick={onNext} disabled={!ok || (!sig && marks.some((m) => m.approved && m.kind === 'signature'))}>{t('Next: save a signed copy')} <Icon name="chevron" size={12} /></button>
      </div>
      {!ok && !!marks.length && <p className="muted small">{t('Approve at least one place to go on. The ones you don\'t approve are left blank.')}</p>}
    </div>
  )
}

// ---------- 3. A signed copy ----------
// Ask Before Signing on: asked once here, for every place at once (server/signauth.js), by the way
// this device is asked (Touch ID or the Mac's password; Windows Hello; else the signing PIN typed
// here), then signed with the grant it gives.
const ASKED = {
  cancelled: tx('Not signed: Touch ID or the password was cancelled.'),
  'no-pin': tx('Ask Before Signing is on, and from here it asks for your signing PIN, but there isn\'t one yet. Set it in {place}, on the computer.'),
  changed: tx('The PDF changed since it was shown here, so nothing was signed. Open it again to see it as it is now, then sign.'),
  'need-sha': tx('Nothing was signed: Bridge AI couldn\'t tell what this PDF showed you. Open it again, then sign.'),
}
function Save({ file, shown, setup, marks, dateText, using, onBack, onOpen }) {
  const [check, setCheck] = useState(null)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(null)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(null)
  const [pin, setPin] = useState('')
  useEffect(() => { api(`/studio/sign/check?${fileQuery(file)}`).then(setCheck, (e) => setCheck({ error: e.message })) }, [file])
  const ok = marks.filter((m) => m.approved)
  const count = (k) => ok.filter((m) => m.kind === k).length
  const missing = ['signature', 'initials'].filter((k) => count(k) && !sigsOf(setup, k).length)
  const stem = file.name.replace(/\.pdf$/i, '')
  // Ask Before Signing as it is now (it may have been turned on or off since Sign this opened).
  const [ask, setAsk] = useState(setup.data?.ask || null)
  useEffect(() => { api('/studio/sign/ask').then(setAsk, () => {}) }, [])
  const way = ask?.on ? ask.way : null
  const sayErr = (e) => {
    if (e.code === 'pin-wrong') return t('That PIN isn\'t right ({n} tries left).', { n: e.data?.left ?? 0 })
    if (e.code === 'pin-locked') return t('The signing PIN was wrong too many times, so it\'s locked until {time}.', { time: new Date(e.data?.until || Date.now()).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }) })
    if (e.code === 'no-pin') return t(ASKED['no-pin'], { place: where('ask-before-signing') })
    if (e.code === 'cancelled' && way === 'device') return t(ASKED.cancelled)
    if (e.code === 'changed') return t(ASKED.changed)
    if (e.code === 'need-sha') return t(ASKED['need-sha'])
    return t("Couldn't make the signed copy: {error}", { error: e.message })
  }
  const save = async () => {
    setBusy(true); setErr(null)
    try {
      // (The bytes this page has, or for one it read in parts, as Studio found it when it opened it.)
      const sha = (shown ? await shown().catch(() => null) : null) || file.sha256 || null
      let grant = null
      if (way) {
        setAsking(way === 'device' ? (ask.touchID ? t('Touch ID, or your Mac\'s password, on this Mac…') : t('Your Mac\'s password, on this Mac…')) : way === 'hello' ? t('Windows Hello, on this computer…') : t('Checking your PIN…'))
        const g = await api('/studio/sign/ask', { method: 'POST', body: { root: file.root, path: file.path, ...(sha ? { sha256: sha } : {}), ...(way === 'pin' ? { pin } : {}) } })
        grant = g.grant || null
      }
      setAsking(null)
      const r = await api('/studio/sign', { method: 'POST', body: { root: file.root, path: file.path, grant, ...(sha ? { sha256: sha } : {}), marks: ok.map(({ kind, page, x, y, w, h, align, field, fieldType, sig }) => ({ kind, page, x, y, w, h, align, field, fieldType, ...(kind === 'date' ? { text: dateText || '' } : { sig: sig || using?.[kind] || undefined }) })) } })
      setDone(r)
      setPin('')
      setTimeout(() => onOpen?.({ root: r.root || file.root, path: r.path }), 1400)
    } catch (e) { setErr(sayErr(e)) } finally { setBusy(false); setAsking(null) }
  }
  if (done) {
    return (
      <div className="sd-saved" role="status">
        <span className="sd-saved-ic"><Icon name="check" size={16} /></span>
        <b>{t('Signed. Saved as {name}', { name: done.name })}</b>
        {done.record && <span className="small sd-saved-rec">{signedLine(done.record)} · {placesLine(done.record.places)}</span>}
        <span className="muted small">{t('In the _signed folder beside the original, which stays as it was; both keep this in their versions. Opening it…')}</span>
        <button type="button" className="btn small" onClick={() => onOpen?.({ root: done.root || file.root, path: done.path })}><Icon name="external" size={12} /> {t('Open it')}</button>
      </div>
    )
  }
  const what = placesLine(ok)
  const label = way === 'device' ? (ask.touchID ? t('Sign with Touch ID') : t('Sign with your password')) : way === 'hello' ? t('Sign with Windows Hello') : t('Sign and save a copy')
  return (
    <div className="sd-save">
      <p className="small">{what ? `${what}.` : t('Nothing approved yet.')}</p>
      <p className="muted small">{t('A new PDF, {name}, in a _signed folder beside this one. The original stays as it is, and a file that\'s there already is never replaced.', { name: `${stem} (signed).pdf` })}</p>
      {way && (
        <p className="small sd-ask-note"><Icon name={way === 'pin' ? 'lock' : 'fingerprint'} size={12} /> {way === 'pin'
          ? t('Ask Before Signing is on: type your signing PIN to sign every place at once.')
          : t('Ask Before Signing is on: {how} is asked once, for every place.', { how: t(way === 'hello' ? HOW.hello : ask.touchID ? HOW.touchid : HOW.password) })}</p>
      )}
      {way === 'pin' && (
        <label className="sd-field sd-pin"><span className="muted small">{t('Signing PIN')}</span>
          <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))} onKeyDown={(e) => { if (e.key === 'Enter' && pin.length >= 4) save() }} aria-label={t('Signing PIN')} disabled={busy} />
        </label>
      )}
      {check?.encrypted && <p className="error-text small" role="alert">{t('This PDF is locked against changes (it\'s encrypted), so a signed copy can\'t be made from it. Ask whoever sent it for one that isn\'t locked, or print it and sign it on paper.')}</p>}
      {!!check?.signed?.length && <p className="sd-warn small"><Icon name="alert" size={11} /> {t('Someone has signed this PDF with a digital certificate already. The signed copy is a new file, so that signature won\'t check out in it: keep the original too.')}</p>}
      {check?.error && <p className="error-text small" role="alert">{check.error}</p>}
      {!!missing.length && <p className="error-text small" role="alert">{missing.includes('signature') ? t('Draw your signature first (step 2).') : t('Draw your initials first (step 2).')}</p>}
      {asking && <p className="small sd-asking" role="status"><Icon name="fingerprint" size={12} /> {asking}</p>}
      {err && <p className="error-text small" role="alert">{err}</p>}
      <div className="sd-step-acts">
        <button type="button" className="btn small primary" onClick={save} disabled={busy || !ok.length || !!missing.length || !!check?.encrypted || !check || (way === 'pin' && pin.length < 4)}>{busy ? t('Signing…') : <><Icon name={way && way !== 'pin' ? 'fingerprint' : 'signature'} size={12} /> {label}</>}</button>
        <button type="button" className="ghost-btn" onClick={onBack} disabled={busy}>{t('Back')}</button>
      </div>
    </div>
  )
}
