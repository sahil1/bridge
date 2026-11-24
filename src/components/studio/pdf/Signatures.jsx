import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../Icon.jsx'
import { api, BASE } from '../../../api.js'
import { t, tx, locale } from '../../../i18n/index.js'
import SignPad from './SignPad.jsx'
import { grantFor } from './grant.jsx'
// (Their look is pdf.css's: here too when no PDF has been opened yet, as in Settings › Studio.)
import './pdf.css'

// Your signatures and initials for AI Assist's Sign this, as Preview keeps them: as many as you like,
// each named, one of each the default (the one a new place gets). Drawn on the pad, the trackpad or
// your phone; kept only on this computer, sealed (server/signstore.js), and removed whenever you
// like. Studio's home and Settings › Studio list them; Sign this on a PDF asks for one when it needs
// one, and each place can have any of them.
// sealed (server/signstore.js sealedWith): { by: 'app', store } with the key the app keeps in the
// computer's keychain, or { by: 'file' } (a server started without the app: a key file).
const KEPT_WHERE = {
  keychain: tx('Kept only on this computer, sealed with a key in this Mac\'s Keychain. Never sent to a model, a bot or anywhere else.'),
  dpapi: tx('Kept only on this computer, sealed with a key only your Windows account can open. Never sent to a model, a bot or anywhere else.'),
  'secret-service': tx('Kept only on this computer, sealed with a key in your computer\'s keyring. Never sent to a model, a bot or anywhere else.'),
  file: tx('Kept only on this computer, sealed, in Bridge AI\'s data folder. Never sent to a model, a bot or anywhere else.'),
}
export const KEPT = KEPT_WHERE.file
export const keptText = (sealed) => t(KEPT_WHERE[sealed?.by === 'app' ? sealed.store : 'file'] || KEPT_WHERE.file)
// Said where the key isn't kept anywhere safer than a file: other programs you run can read it.
export function KeyWarning({ sealed }) {
  if (!sealed) return null
  const where = sealed.by === 'file' ? t('Your signatures\' key is in a file in Bridge AI\'s data folder, which other programs you run can read. In the Bridge AI app it\'s kept in this computer\'s keychain instead.')
    : sealed.store === 'basic' ? t('This computer has no keychain for the app to keep your signatures\' key in, so other programs you run can read it.') : null
  return where ? <p className="sd-warn small sd-key-warn" role="note"><Icon name="alert" size={11} /> {where}</p> : null
}
export const sigUrl = (id, at) => `${BASE}/api/studio/signature/${encodeURIComponent(id)}?v=${encodeURIComponent(at || '')}`
const KIND_NAME = { signature: tx('Signature'), initials: tx('Initials') }

// What Sign this has to go on: { list, signature, initials (the defaults), model, readsScans, sealed,
// ask, trackpad, phones }, null until it's come (asked once on is true).
export function useSignSetup(on = true) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const refresh = useCallback(() => api('/studio/sign/setup').then((d) => { setData(d); setErr(null); return d }, (e) => { setErr(e.message); return null }), [])
  useEffect(() => { if (on && !data) refresh() }, [on, data, refresh])
  const merge = (d) => { setData((x) => ({ ...x, ...d })); return d }
  // With Ask Before Signing on, each change to them is asked for first (grant.jsx): Touch ID, or the PIN.
  const grant = async () => grantFor('change')
  // A new one (kind, png, name, makeDefault): its id.
  // (replace: one of yours, drawn again.)
  const add = async (kind, png, { name, makeDefault = false, replace = null } = {}) => { const g = await grant(); const d = merge(await api('/studio/signatures', { method: 'POST', body: { kind, png, name: name || undefined, default: makeDefault, replace, grant: g } })); return d.id }
  // Drawn again: the default of that kind replaced.
  const keep = async (which, png) => { const g = await grant(); return merge(await api(`/studio/signature/${which}`, { method: 'PUT', body: { png, grant: g } })) }
  const change = async (id, o) => { const g = await grant(); return merge(await api(`/studio/signatures/${id}`, { method: 'PATCH', body: { ...o, grant: g } })) }
  const remove = async (id) => { const g = await grant(); return merge(await api(`/studio/signatures/${id}`, { method: 'DELETE', body: { grant: g } })) }
  return { data, err, refresh, add, keep, change, remove }
}
export const sigsOf = (setup, kind) => (setup.data?.list || []).filter((x) => x.kind === kind)

// A pad, with a name to give it, for a new one (or for drawing one again).
// kept: say where it's kept (not where the list around it says so already).
export function DrawCard({ kind, setup, again = null, onDone, onCancel, doc = '', kept = true }) {
  // (Which ways there are now: a phone opened since, or a trackpad connected.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setup.refresh() }, [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  // Opened at the bottom of a panel (Sign this, on a phone, under the page): the pad and its
  // buttons brought into view whole.
  const card = useRef(null)
  useEffect(() => { const pad = card.current?.querySelector('.sd-pad'); pad?.scrollIntoView?.({ block: 'nearest' }) }, [])
  const n = sigsOf(setup, kind).length
  const [name, setName] = useState('')
  const save = async ({ png }) => {
    setBusy(true); setErr(null)
    try {
      const id = again ? await setup.add(kind, png, { replace: again.id }) : await setup.add(kind, png, { name: name.trim() })
      onDone?.(id)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const placeholder = n ? `${t(KIND_NAME[kind])} ${n + 1}` : t(KIND_NAME[kind])
  return (
    <div className="sd-sigcard drawing" ref={card}>
      <span className="sd-draw-head">
        <b className="sd-sigcard-name">{again ? (kind === 'initials' ? t('Draw your initials again') : t('Draw your signature again')) : kind === 'initials' ? t('Draw your initials') : t('Draw your signature')}</b>
        {!again && <input className="sd-sig-name" value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder={placeholder} aria-label={t('Its name')} title={t('Its name, to tell it from the others')} disabled={busy} />}
      </span>
      <SignPad what={kind} busy={busy} onSave={save} onCancel={onCancel} setup={setup.data} doc={doc} />
      {kept && <p className="muted small sd-kept"><Icon name="lock" size={11} /> {keptText(setup.data?.sealed)}</p>}
      {err && <p className="error-text small" role="alert">{t("Couldn't keep it: {error}", { error: err })}</p>}
    </div>
  )
}

// One saved: its picture, name (renamed in place), whether it's the default, and taking it away.
function SavedSig({ sig, setup }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [naming, setNaming] = useState(null)
  const act = async (fn) => { setBusy(true); setErr(null); try { await fn() } catch (e) { setErr(e.message) } finally { setBusy(false) } }
  const remove = () => {
    if (!window.confirm(sig.kind === 'initials' ? t('Remove "{name}" (your initials) from this computer?', { name: sig.name }) : t('Remove "{name}" (your signature) from this computer?', { name: sig.name }))) return
    act(() => setup.remove(sig.id))
  }
  const rename = () => { const v = naming?.trim(); setNaming(null); if (v && v !== sig.name) act(() => setup.change(sig.id, { name: v })) }
  return (
    <li className={`sd-saved-sig${sig.default ? ' default' : ''}`} data-sig={sig.id} data-kind={sig.kind}>
      <span className="sd-sigcard-pic"><img src={sigUrl(sig.id, sig.at)} alt={sig.name} draggable={false} /></span>
      <span className="sd-sigcard-name">
        {naming != null
          ? <input className="sd-sig-name" autoFocus value={naming} onChange={(e) => setNaming(e.target.value.slice(0, 60))} onBlur={rename} onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setNaming(null) }} aria-label={t('Its name')} />
          : <button type="button" className="sd-sig-title" onClick={() => setNaming(sig.name)} title={t('Rename it')}><b>{sig.name}</b></button>}
        <small className="muted">{sig.default ? (sig.kind === 'initials' ? t('Default initials') : t('Default signature')) : t('Drawn {when}', { when: new Date(sig.at).toLocaleDateString(locale()) })}</small>
      </span>
      <span className="sd-sigcard-acts">
        {sig.default
          ? <span className="sd-default" title={t('The default: a new place to sign gets this one')} role="img" aria-label={t('The default')}><Icon name="star" size={13} /></span>
          : <button type="button" className="ghost-btn sd-make-default" onClick={() => act(() => setup.change(sig.id, { default: true }))} disabled={busy} title={t('Make default: a new place to sign gets this one')} aria-label={t('Make default')}><Icon name="star" size={13} /></button>}
        <button type="button" className="ghost-btn" onClick={remove} disabled={busy} title={t('Remove it from this computer')} aria-label={t('Remove {name}', { name: sig.name })}><Icon name="trash" size={12} /></button>
      </span>
      {err && <p className="error-text small" role="alert">{err}</p>}
    </li>
  )
}

// Every one of a kind, and Add.
function KindList({ kind, setup }) {
  const [adding, setAdding] = useState(false)
  const list = sigsOf(setup, kind)
  return (
    <div className="sd-sig-kind" data-kind={kind}>
      <div className="sd-sig-kind-head">
        <b>{kind === 'initials' ? t('Initials') : t('Signatures')}</b>
        {!adding && <button type="button" className="btn small" onClick={() => setAdding(true)} disabled={!setup.data}><Icon name="plus" size={11} /> {kind === 'initials' ? t('Add initials') : t('Add a signature')}</button>}
      </div>
      {!!list.length && <ul className="sd-saved-sigs">{list.map((s) => <SavedSig key={s.id} sig={s} setup={setup} />)}</ul>}
      {!list.length && !adding && <p className="muted small">{kind === 'initials' ? t('None yet: for pages that ask for your initials.') : t('None yet: for the places you sign.')}</p>}
      {adding && <DrawCard kind={kind} setup={setup} kept={false} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />}
    </div>
  )
}
// Where signing can't be done (a browser tab, a computer of yours showing this one, Tailscale):
// said plainly, with where it can.
export const NotHere = () => <p className="sd-warn small sd-not-here" role="note"><Icon name="lock" size={11} /> {t('Signing is done in the Bridge AI app on this computer, or in the app on your phone. From here your signatures aren\'t shown and nothing can be signed.')}</p>
// The app's keys still not opening after being tried again: start over with new ones, once it's
// asked that it's you (Touch ID, the Mac's password or Windows Hello). The old keys are kept, and the
// signatures sealed with them are set aside, so they can't be opened here.
function StartOver({ setup }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(false)
  const go = async () => {
    setBusy(true); setErr(null)
    try {
      const g = await api('/studio/sign/ask', { method: 'POST', body: { purpose: 'start-over' } })
      await api('/studio/sign/start-over', { method: 'POST', body: { grant: g.grant } })
      setDone(true)
      setTimeout(() => setup.refresh(), 8000)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  if (done) return <p className="muted small" role="status">{t('Starting again with a new key: Bridge AI opens again in a moment.')}</p>
  return (
    <div className="sd-start-over">
      <p className="muted small">{t('Start over to sign again: a new key is made, and the signatures sealed with the old one are set aside, where they can\'t be opened. The old key\'s file is kept.')}</p>
      <button type="button" className="btn small" onClick={go} disabled={busy}><Icon name="fingerprint" size={12} /> {t('Start Over')}</button>
      {err && <p className="error-text small" role="alert">{err}</p>}
    </div>
  )
}
export function SignatureList({ setup }) {
  if (setup.data && !setup.data.canSign) return <NotHere />
  if (setup.err && !setup.data) return <p className="error-text small" role="alert">{setup.err} <button type="button" className="link-btn" onClick={setup.refresh}>{t('Try again')}</button></p>
  if (!setup.data) return <div className="sd-sigcards waiting" aria-busy="true"><span className="sd-sigcard waiting"><span className="sd-sigcard-pic" /></span></div>
  return (
    <div className="sd-siglist">
      {setup.data.keysUnreadable ? <><p className="error-text small" role="alert">{t('Bridge AI couldn\'t read its keychain item this time, so your signatures can\'t be opened. Quit and reopen Bridge AI to try again, and allow it if macOS asks.')}</p>{setup.data.canStartOver && <StartOver setup={setup} />}</>
        : setup.data.sealError && <p className="error-text small" role="alert">{t('Your saved signatures can\'t be opened: {error}', { error: setup.data.sealError })}</p>}
      <KeyWarning sealed={setup.data.sealed} />
      {setup.data.older && <p className="sd-warn small" role="status"><Icon name="alert" size={11} /> {t('Your signatures\' list is older than the app last saw, as if a copy from before was put back. Signing asks that it\'s you each time until you confirm it once.')}</p>}
      {setup.data.windowChanged && <p className="sd-warn small" role="status"><Icon name="alert" size={11} /> {t('The Bridge AI app\'s key for its windows changed on {date}. That happens when it\'s reinstalled or its Keychain item is reset; if neither happened, look at what runs on this computer.', { date: new Date(setup.data.windowChanged.at).toLocaleDateString(locale(), { dateStyle: 'medium' }) })}</p>}
      {setup.data.setAside?.n > 0 && <p className="sd-warn small" role="status"><Icon name="alert" size={11} /> {setup.data.setAside.n === 1 ? t('A saved signature couldn\'t be opened with this computer\'s key, so it was set aside.') : t('{n} saved signatures couldn\'t be opened with this computer\'s key, so they were set aside.', { n: setup.data.setAside.n })}</p>}
      <KindList kind="signature" setup={setup} />
      <KindList kind="initials" setup={setup} />
    </div>
  )
}

// In Sign this, beside the places: the one new places of this kind get (value; the default until
// you pick another), another to pick, or a new one to draw. With none yet, the pad at once.
export function SignatureChooser({ which, setup, value, onChange, doc = '' }) {
  const list = sigsOf(setup, which)
  const chosen = list.find((s) => s.id === value) || list.find((s) => s.default) || list[0] || null
  const [drawing, setDrawing] = useState(null) // null | 'new' | 'again'
  const name = which === 'initials' ? t('Your initials') : t('Your signature')
  if (!setup.data) {
    return (
      <div className="sd-sigcard compact waiting" aria-busy="true">
        <span className="sd-sigcard-pic" />
        <span className="sd-sigcard-name"><b>{name}</b></span>
      </div>
    )
  }
  if (drawing || !chosen) {
    return <DrawCard kind={which} setup={setup} doc={doc} again={drawing === 'again' ? chosen : null} onDone={(id) => { setDrawing(null); if (id) onChange?.(id) }} onCancel={chosen ? () => setDrawing(null) : null} />
  }
  return (
    <div className="sd-sigcard compact" data-kind={which}>
      <span className="sd-sigcard-name"><b>{name}</b></span>
      <span className="sd-sigcard-pic"><img src={sigUrl(chosen.id, chosen.at)} alt={chosen.name} draggable={false} /></span>
      <span className="sd-sigcard-acts">
        {list.length > 1 && (
          <select className="sd-sig-pick" value={chosen.id} onChange={(e) => onChange?.(e.target.value)} aria-label={which === 'initials' ? t('Which initials') : t('Which signature')} title={which === 'initials' ? t('Which initials') : t('Which signature')}>
            {list.map((s) => <option key={s.id} value={s.id}>{s.name}{s.default ? ` · ${t('default')}` : ''}</option>)}
          </select>
        )}
        <button type="button" className="btn small" onClick={() => setDrawing('again')}><Icon name="edit" size={12} /> {t('Draw again')}</button>
        <button type="button" className="ghost-btn" onClick={() => setDrawing('new')} title={which === 'initials' ? t('Add initials') : t('Add a signature')} aria-label={which === 'initials' ? t('Add initials') : t('Add a signature')}><Icon name="plus" size={12} /></button>
      </span>
    </div>
  )
}

// On Studio's home and in Settings › Studio: every one, with what they're for and where they're kept.
export default function SignatureHome({ settings = false }) {
  const setup = useSignSetup()
  return (
    <section className={`sd-sec sd-sign-home${settings ? ' in-settings' : ''}`} aria-busy={!setup.data && !setup.err}>
      {!settings && <h3>{t('Your Signatures')}</h3>}
      <p className="muted small">{t('Draw your signature and initials once, or a few of each. Then open a PDF you\'re asked to sign and pick AI Assist › Sign this: it says what you\'re signing in plain words, finds where your signature goes, and saves a signed copy in a _signed folder beside it.')}</p>
      <SignatureList setup={setup} />
      <p className="muted small sd-kept"><Icon name="lock" size={11} /> {keptText(setup.data?.sealed)}</p>
    </section>
  )
}
