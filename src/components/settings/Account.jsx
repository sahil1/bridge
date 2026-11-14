// Settings › Account: your Bold Bridge account (server/account.js), for Early Access and Bridge AI's
// relay, and nothing else: Bridge AI works the same without it. The section shows only once Bold
// Bridge accounts exist (Settings.jsx).
// Signed out: your email, then the 6-digit code it's sent (a wrong one, one that ran out, too many:
// each says why, and what to do); an account with as many devices as it takes lists them, to remove
// one and sign in here. Signed in: the account, its devices (Remove), Early Access and Bridge AI's
// relay (each on, or to ask for, asked, or declined; the relay's use as the usage chip shows it),
// your other computers (sign them in too), Sign out and Delete account. A computer another one
// signed in says so, and can be signed out again.
import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { WindowRow } from '../Usage.jsx'
import { openSettings } from '../SignIn.jsx'
import { api } from '../../api.js'
import { t, locale } from '../../i18n/index.js'
import { Advanced } from './Advanced.jsx'
import './account.css'

const day = (iso) => (iso ? new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const seen = (iso) => (iso ? new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
const minutes = (s) => Math.max(1, Math.ceil((Number(s) || 60) / 60))

export function useAccount() {
  const [st, setSt] = useState(null)
  const [err, setErr] = useState(null)
  const load = (fresh) => api(`/account${fresh ? '?fresh=1' : ''}`).then((s) => { setSt(s); setErr(null); return s }).catch((e) => setErr(e.message))
  useEffect(() => { load(true) }, [])
  return { st, setSt, err, setErr, load }
}

export default function Account() {
  const { st, setSt, err, setErr, load } = useAccount()
  if (!st) return err ? <p className="st-note bad"><Icon name="alert" size={13} /> {err}</p> : <div className="skeleton-rows"><div /><div /></div>
  if (!st.available) return <p className="muted small">{t('Bold Bridge accounts aren\'t available in this version of Bridge AI.')}</p>
  return (
    <div className="st-sections acct">
      {err && <p className="st-note bad"><Icon name="alert" size={13} /> {err}</p>}
      {st.signedIn ? <SignedIn st={st} setSt={setSt} setErr={setErr} load={load} /> : <SignIn st={st} onIn={setSt} />}
    </div>
  )
}

// ---------- signing in ----------
// (inline: in Settings › Devices, under Bridge AI's relay, which says what it's for itself.)
export function SignIn({ st, onIn, inline = false }) {
  const [email, setEmail] = useState(st.pending?.email || '')
  const [code, setCode] = useState('')
  const [step, setStep] = useState(st.pending ? 'code' : 'email')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null) // { text, code, devices }
  const [sentTo, setSentTo] = useState(st.pending?.email || null)
  const codeRef = useRef(null)
  useEffect(() => { if (step === 'code') codeRef.current?.focus() }, [step])
  const run = async (fn) => {
    setBusy(true); setProblem(null)
    try { return await fn() } catch (e) { setProblem({ text: e.message, code: e.code, devices: e.data?.devices, retryAfter: e.data?.retryAfter }); return null } finally { setBusy(false) }
  }
  // The old code goes as a new one is asked for, not when the answer comes: the email can be
  // quicker, and a code typed from it meanwhile stays.
  const send = () => run(async () => { setCode(''); const r = await api('/account/code', { method: 'POST', body: { email } }); setSentTo(r.pending?.email || email.trim()); setStep('code'); return true })
  const verify = (replace) => run(async () => { const s = await api('/account/verify', { method: 'POST', body: { email, code, ...(replace ? { replace } : {}) } }); onIn(s); return s })
  const other = () => { api('/account/cancel', { method: 'POST' }).catch(() => {}); setStep('email'); setCode(''); setProblem(null) }
  // What went wrong, with the way on: a new code, another email, a device to remove.
  const said = problem && (
    problem.code === 'account-too-many' ? t('Too many codes asked for in the last hour. Try again in {n} minutes.', { n: minutes(problem.retryAfter) })
      : problem.code === 'account-wrong' ? problem.text
        : problem.text)
  return (
    <section className={inline ? 'acct-in k-inline' : 'st-sec acct-in'}>
      {inline ? <p className="small"><b>{t('Your email, to ask for it.')}</b> {t('There\'s no password: you\'re emailed a code, and that\'s your Bold Bridge account.')}</p> : (
        <>
          <h4>{t('Sign in to Bold Bridge')}</h4>
          <p className="muted small">{t('For Early Access and Bridge AI\'s relay; Bridge AI works the same without one. There\'s no password: you\'re emailed a code.')}</p>
        </>
      )}
      {st.signedOut && <p className="st-note warn acct-out"><Icon name="alert" size={13} /> {st.signedOut.why}</p>}
      {step === 'email' ? (
        <form className="st-row acct-form" onSubmit={(e) => { e.preventDefault(); if (email.trim()) send() }}>
          <input className="st-input acct-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('Your email')} aria-label={t('Your email')} autoComplete="email" spellCheck={false} autoFocus={!inline} />
          <button type="submit" className="btn small primary" disabled={busy || !email.trim()}><Icon name="mail" size={13} /> {busy ? t('Sending…') : t('Email me a code')}</button>
        </form>
      ) : (
        <>
          <p className="small acct-sent">{t('A code is on its way to {email}. It works for 10 minutes.', { email: sentTo || email })}</p>
          <form className="st-row acct-form" onSubmit={(e) => { e.preventDefault(); if (/^\d{6}$/.test(code.trim())) verify() }}>
            <input ref={codeRef} className="st-input acct-code mono" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} placeholder="123456" aria-label={t('The 6-digit code')} />
            <button type="submit" className="btn small primary" disabled={busy || !/^\d{6}$/.test(code.replace(/\s/g, ''))}><Icon name="check" size={13} /> {busy ? t('Signing in…') : t('Sign in')}</button>
          </form>
          <div className="st-row">
            <button type="button" className="ghost-btn" disabled={busy} onClick={send}><Icon name="refresh" size={12} /> {t('Send a new code')}</button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={other}>{t('Use another email')}</button>
          </div>
        </>
      )}
      {said && problem.code !== 'account-devices' && <p className="st-note bad acct-problem" role="alert"><Icon name="alert" size={13} /> {said}{problem.code === 'account-expired' && step === 'code' && <> <button type="button" className="link-btn" onClick={send}>{t('Send a new code')}</button></>}</p>}
      {problem?.code === 'account-devices' && (
        <div className="relay-box acct-full">
          <p className="small"><b>{t('Your account has 5 devices, as many as it takes.')}</b> {t('Remove one to sign in here; it\'s signed out there.')}</p>
          <ul className="ph-devices">
            {(problem.devices || []).map((d) => (
              <li key={d.id}>
                <Icon name={d.kind === 'phone' ? 'phone' : 'laptop'} size={14} /><span>{d.name}</span>
                <span className="muted small">{d.lastSeen ? t('last used {when}', { when: seen(d.lastSeen) }) : ''}</span>
                <button type="button" className="btn small" disabled={busy} onClick={() => verify(d.id)}>{t('Remove it and sign in here')}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted small" title={t('What Bold Bridge keeps: your email, the names of the devices you sign in on, and what you ask for. Never anything from this computer: your agents, meetings, mail and files stay here.')}>{t('Bold Bridge keeps your email, your devices\' names and what you ask for. Never anything from this computer.')}</p>
    </section>
  )
}

// ---------- signed in ----------
function SignedIn({ st, setSt, setErr, load }) {
  const a = st.account
  const [busy, setBusy] = useState(null)
  const act = async (what, fn) => {
    setBusy(what); setErr(null)
    try { const s = await fn(); if (s && s.available !== undefined) setSt(s); return s } catch (e) { setErr(e.message); return null } finally { setBusy(null) }
  }
  const stopped = a.status === 'suspended'
  return (
    <>
      {st.signedInBy && <Followed st={st} act={act} />}
      <section className="st-sec acct-who">
        <h4>{t('Your Account')}</h4>
        <div className="st-row">
          <Icon name="user" size={15} /><b className="acct-mail">{a.email}</b>
          {stopped ? <span className="st-chip warn">{t('Suspended')}</span> : <span className="st-chip good"><Icon name="check" size={11} /> {t('Signed in')}</span>}
        </div>
        <p className="muted small">{t('Since {date}.', { date: day(a.createdAt) })} {st.checkedAt && t('Last checked {when}.', { when: seen(st.checkedAt) })}</p>
        {stopped && <p className="st-note warn"><Icon name="alert" size={13} /> {t('Your account is suspended, so Early Access and Bridge AI\'s relay are off for now. If you think that\'s a mistake, reply to an email from Bold Bridge.')}</p>}
        {st.error && <p className="st-note warn"><Icon name="alert" size={13} /> {t('Couldn\'t check your account just now: {why}. What\'s here is from {when}.', { why: st.error, when: seen(st.checkedAt) })}</p>}
      </section>
      <Devices st={st} act={act} busy={busy} />
      <EarlyRow st={st} act={act} busy={busy} stopped={stopped} />
      <RelayRow st={st} act={act} busy={busy} stopped={stopped} />
      <Others st={st} />
      <Leave st={st} act={act} busy={busy} load={load} />
    </>
  )
}

// Signed in by another of your computers: kept, or signed out (and not again that way).
function Followed({ st, act }) {
  return (
    <div className="st-note acct-followed" role="status">
      <Icon name="info" size={13} /> <span>{t('{name} signed this computer in to your Bold Bridge account on {date}.', { name: st.signedInBy.name, date: day(new Date(st.signedInBy.at).toISOString()) })}</span>
      <span className="st-row">
        <button type="button" className="btn small" onClick={() => act('followed', () => api('/account/followed', { method: 'POST', body: { keep: true } }))}>{t('Keep it')}</button>
        <button type="button" className="ghost-btn" onClick={() => act('followed', () => api('/account/followed', { method: 'POST', body: { keep: false } }))}>{t('Sign this computer out')}</button>
      </span>
    </div>
  )
}

function Devices({ st, act, busy }) {
  const remove = (d) => {
    if (d.thisOne) return act('out', () => api('/account/signout', { method: 'POST' }))
    if (!window.confirm(t('Remove {name} from your account? It\'s signed out there.', { name: d.name }))) return
    act(`rm:${d.id}`, () => api(`/account/devices/${encodeURIComponent(d.id)}`, { method: 'DELETE' }))
  }
  return (
    <section className="st-sec acct-devices">
      <h4>{t('Devices')}</h4>
      <p className="muted small">{st.devices.length === 1 ? t('1 of 5 devices on your account, computers and phones.') : t('{n} of 5 devices on your account, computers and phones.', { n: st.devices.length })}</p>
      <ul className="ph-devices">
        {st.devices.map((d) => (
          <li key={d.id}>
            <Icon name={d.kind === 'phone' ? 'phone' : 'laptop'} size={14} /><span>{d.name}</span>
            {d.thisOne ? <span className="st-chip">{t('This computer')}</span> : <span className="muted small">{d.lastSeen ? t('last used {when}', { when: seen(d.lastSeen) }) : ''}</span>}
            {!d.thisOne && <button type="button" className="ghost-btn" disabled={!!busy} onClick={() => remove(d)}>{t('Remove')}</button>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function EarlyRow({ st, act, busy, stopped }) {
  const s = st.early?.state
  const ask = () => act('early', () => api('/account/request', { method: 'POST', body: { kind: 'early' } }))
  return (
    <section className="st-sec acct-early">
      <div className="st-row between">
        <h4>{t('Early Access')}</h4>
        {!stopped && (s === 'yes' ? <span className="st-chip good"><Icon name="check" size={11} /> {t('On')}</span> : s === 'requested' ? <span className="st-chip">{t('Requested')}</span> : s === 'declined' ? <span className="st-chip warn">{t('Declined')}</span> : null)}
      </div>
      {s === 'yes' && !stopped ? (
        st.earlyLeft
          ? <div className="st-row"><span className="muted small">{t('This computer left Early Access, so it stays on regular releases.')}</span><button type="button" className="btn small" disabled={!!busy} onClick={() => act('early', () => api('/account/early', { method: 'POST' }))}>{t('Join again')}</button></div>
          : <p className="muted small">{st.earlyHere ? t('Your computers get pre-releases of Bridge AI before everyone else, by themselves. To leave on this one, open Settings › About & Updates.') : t('Your account has Early Access. It\'s for the desktop app: this copy of Bridge AI updates another way, so it stays on regular releases.')}</p>
      ) : s === 'requested' ? <p className="muted small">{t('You asked for Early Access. Bold Bridge emails you when it\'s on.')}</p>
        : stopped ? <p className="muted small">{t('Off while your account is suspended.')}</p>
          : (
            <div className="st-row">
              <span className="muted small">{s === 'declined' ? t('Your request was declined.') : t('Pre-releases of Bridge AI, before everyone else, to try new things and say what\'s wrong.')}</span>
              <button type="button" className="btn small" disabled={!!busy} onClick={ask}>{busy === 'early' ? t('Asking…') : s === 'declined' ? t('Ask again') : t('Request Early Access')}</button>
            </div>
          )}
    </section>
  )
}

// The relay's use in its 8-hour window and its week, as the usage chip shows a plan's: what's left,
// and when it resets. limits: { window: { hours, messages }, week: { messages } }.
export function RelayUse({ used, limits }) {
  if (!limits) return null
  const row = (label, u, max) => ({ label, percentRemaining: Math.max(0, Math.round(100 - ((u?.messages || 0) / max) * 100)), resetsAt: u?.resetsAt || null })
  return (
    <div className="acct-use">
      <WindowRow w={row(t('{h}-hour window', { h: limits.window.hours }), used?.window, limits.window.messages)} />
      <WindowRow w={row(t('This week'), used?.week, limits.week.messages)} />
      <p className="muted small">{used ? t('{n} of {max} messages in this window, {w} of {wmax} this week, across your computers.', { n: (used.window?.messages || 0).toLocaleString(locale()), max: limits.window.messages.toLocaleString(locale()), w: (used.week?.messages || 0).toLocaleString(locale()), wmax: limits.week.messages.toLocaleString(locale()) }) : t('Nothing used yet. A window starts with the first message after the last one ended; a week, with your first use.')}</p>
    </div>
  )
}

function RelayRow({ st, act, busy, stopped }) {
  const r = st.relay || {}
  const s = r.state
  const ask = () => act('relay', () => api('/account/request', { method: 'POST', body: { kind: 'relay' } }))
  return (
    <section className="st-sec acct-relay">
      <div className="st-row between">
        <h4>{t('Bridge AI\'s Relay')}</h4>
        {!stopped && (s === 'approved' ? <span className="st-chip good"><Icon name="check" size={11} /> {t('On')}</span> : s === 'requested' ? <span className="st-chip">{t('Requested')}</span> : s === 'declined' ? <span className="st-chip warn">{t('Declined')}</span> : null)}
      </div>
      {s === 'approved' && !stopped ? (
        <>
          <p className="muted small">{t('Your phone reaches your computers through a relay run by Bold Bridge, end-to-end encrypted. Your account has an allowance every {h} hours and each week, across its computers.', { h: r.limits?.window?.hours || 8 })}</p>
          <RelayUse used={r.used} limits={r.limits} />
          {!st.relayHere && <div className="st-row"><button type="button" className="btn small" onClick={() => openSettings('phone')}><Icon name="phone" size={13} /> {t('Use it on this computer')}</button><span className="muted small">{t('In Settings › Devices.')}</span></div>}
        </>
      ) : s === 'requested' ? <p className="muted small">{t('You asked for Bridge AI\'s relay. Bold Bridge emails you when it\'s on.')}</p>
        : stopped ? <p className="muted small">{t('Off while your account is suspended.')}</p>
          : (
            <div className="st-row">
              <span className="muted small">{s === 'declined' ? t('Your request was declined. Your own Cloudflare or Tailscale still work, in Settings › Devices.') : t('Reach your computers from your phone without a Cloudflare account of your own. It\'s by request.')}</span>
              <button type="button" className="btn small" disabled={!!busy} onClick={ask}>{busy === 'relay' ? t('Asking…') : s === 'declined' ? t('Ask again') : t('Request access')}</button>
            </div>
          )}
    </section>
  )
}

// Your other computers (linked to this one in Settings › Devices): those not signed in yet are
// offered, "Also sign in Desk and Laptop?"; each says how it went. Not now puts it away here.
function Others({ st }) {
  const [list, setList] = useState(null)
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [later, setLater] = useState(() => { try { return JSON.parse(localStorage.getItem('cc-account-later') || '[]') } catch { return [] } })
  useEffect(() => { api('/account/others').then((r) => setList(r.others || [])).catch(() => setList([])) }, [st.account?.id])
  if (!list?.length) return null
  const offer = list.filter((o) => o.state === 'not-signed-in')
  const asked = offer.filter((o) => !later.includes(o.id))
  const names = (xs) => (xs.length === 1 ? xs[0].name : t('{some} and {last}', { some: xs.slice(0, -1).map((x) => x.name).join(', '), last: xs.at(-1).name }))
  const go = async () => {
    setBusy(true)
    try { const r = await api('/account/others', { method: 'POST', body: { ids: asked.map((o) => o.id) } }); setResults(r.results); setList(r.others) } catch (e) { setResults([{ ok: false, text: e.message }]) } finally { setBusy(false) }
  }
  const notNow = () => { const ids = [...later, ...asked.map((o) => o.id)]; setLater(ids); try { localStorage.setItem('cc-account-later', JSON.stringify(ids)) } catch { /* not kept */ } }
  const STATE = { 'signed-in': t('Signed in'), 'not-signed-in': t('Not signed in'), declined: t('Said not to be signed in from here'), other: t('Signed in to another account'), offline: t('Offline'), old: t('Needs a newer Bridge AI'), none: t('No Bold Bridge accounts there') }
  return (
    <section className="st-sec acct-others">
      <h4>{t('Your Other Computers')}</h4>
      {asked.length > 0 && !results && (
        <div className="relay-box acct-offer">
          <p className="small"><b>{t('Also sign in {names}?', { names: names(asked) })}</b> {t('They\'re linked to this computer, so they can be signed in to {email} from here, without the email.', { email: st.account.email })}</p>
          <div className="st-row">
            <button type="button" className="btn small primary" disabled={busy} onClick={go}><Icon name="check" size={13} /> {busy ? t('Signing in…') : asked.length === 1 ? t('Sign it in') : t('Sign them in')}</button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={notNow}>{t('Not now')}</button>
          </div>
        </div>
      )}
      {results?.map((r, i) => <p key={r.id || i} className={`st-note ${r.ok ? 'ok' : 'warn'} acct-result`}><Icon name={r.ok ? 'check' : 'alert'} size={13} /> {r.ok ? t('{name} is signed in.', { name: r.name }) : r.why === 'declined' ? t('{name} said not to be signed in from your other computers. Sign in there by hand, in Settings › Account.', { name: r.name }) : r.why === 'devices' ? t('{name}: your account has 5 devices already. Remove one above, then try again.', { name: r.name }) : `${r.name ? `${r.name}: ` : ''}${r.text}`}</p>)}
      <ul className="ph-devices">
        {list.map((o) => <li key={o.id}><Icon name="laptop" size={14} /><span>{o.name}</span><span className={`st-chip ${o.state === 'signed-in' ? 'good' : ''}`}>{STATE[o.state] || o.state}</span></li>)}
      </ul>
      {offer.length > 0 && !asked.length && !results && <div><button type="button" className="ghost-btn" onClick={() => { setLater([]); try { localStorage.removeItem('cc-account-later') } catch { /* not kept */ } }}>{t('Sign in {names} too', { names: names(offer) })}</button></div>}
    </section>
  )
}

function Leave({ st, act, busy, load }) {
  const [deleting, setDeleting] = useState(false)
  const [typed, setTyped] = useState('')
  const [warning, setWarning] = useState(null)
  const out = async () => {
    if (!window.confirm(t('Sign out of Bold Bridge on this computer? Early Access from your account and Bridge AI\'s relay stop here until you sign in again.'))) return
    const s = await act('out', () => api('/account/signout', { method: 'POST' }))
    if (s?.warning) setWarning(s.warning)
  }
  const del = async () => { const s = await act('delete', () => api('/account', { method: 'DELETE', body: { email: typed } })); if (s) load(false) }
  return (
    <section className="st-sec acct-leave">
      {warning && <p className="st-note warn"><Icon name="alert" size={13} /> {warning}</p>}
      <div className="st-row">
        <button type="button" className="btn small" disabled={!!busy} onClick={out}><Icon name="x" size={13} /> {t('Sign out')}</button>
      </div>
      {/* Rarely wanted, and for good: under Advanced. */}
      <Advanced order={10}>
        <div className="st-sections acct">
          <section className="st-sec acct-del" data-setting="delete-account">
            <h4>{t('Delete Account')}</h4>
            {!deleting && <div className="st-row"><button type="button" className="ghost-btn" onClick={() => setDeleting(true)}>{t('Delete account…')}</button></div>}
            {deleting && (
              <form className="relay-box acct-delete" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) del() }}>
                <p className="small"><b>{t('Delete your Bold Bridge account?')}</b> {t('Your account, its devices and requests, and the relay\'s counts for it are deleted, and every device is signed out. Early Access and Bridge AI\'s relay stop. This can\'t be undone. Type your email to say so.')}</p>
                <div className="st-row">
                  <input className="st-input" type="email" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={st.account.email} aria-label={t('Your email, to delete the account')} autoComplete="off" spellCheck={false} />
                  <button type="submit" className="btn small danger" disabled={!!busy || typed.trim().toLowerCase() !== st.account.email}>{busy === 'delete' ? t('Deleting…') : t('Delete account')}</button>
                  <button type="button" className="ghost-btn" onClick={() => { setDeleting(false); setTyped('') }}>{t('Cancel')}</button>
                </div>
              </form>
            )}
          </section>
        </div>
      </Advanced>
    </section>
  )
}
