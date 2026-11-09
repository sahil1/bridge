import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { InstallNode, openSettings } from '../SignIn.jsx'
import { RelayUse } from './Account.jsx'
import { api, viaRelay, relayComputers } from '../../api.js'
import { t, tx, locale } from '../../i18n/index.js'
import { Advanced } from './Advanced.jsx'

// Settings › Devices › "From anywhere": your own relay on your Cloudflare account
// (server/relay.js). Optional: Bridge AI works the same without it.
//
// Once Bridge AI's own relay exists (server/hosted.js) with Bold Bridge accounts (server/account.js),
// it's offered too, as the easiest of three ways, and this starts with a choice (the way picked is
// kept by Phone.jsx, which shows Tailscale's section). It needs your account signed in here and
// allowed the relay: what's missing is said, with the button that fixes it (sign in, ask for it).
// Until then it's exactly the relay section it always was.
//
// What Bridge AI's relay can see is said as it is: with the iPhone or Android app, never what you
// do, since the app carries the code that does the encrypting; in a phone's browser that code comes
// from the relay (relay/web/shell.js says so there too).
const WAYS = [
  { id: 'hosted', title: tx('Bridge AI\'s relay'), text: tx('Easiest, with the iPhone or Android app. One click with your Bold Bridge account.'), tag: tx('Recommended') },
  { id: 'cloudflare', title: tx('Your own Cloudflare'), text: tx('Everything on your own free account.') },
  { id: 'tailscale', title: tx('Tailscale'), text: tx('If you already use it.') },
]
const CODE = 'https://github.com/sahil1/bridge/tree/main/relay'

export default function Relay({ way, setWay, onOffer }) {
  const [st, setSt] = useState(null)
  const [err, setErr] = useState(null)
  const [mode, setMode] = useState(null) // 'token' while pasting an API token
  const [token, setToken] = useState('')
  const [accounts, setAccounts] = useState(null)
  const [working, setWorking] = useState(false)
  const [changing, setChanging] = useState(false) // choosing another way, with a relay in use
  const timer = useRef(null)
  const load = () => api('/relay').then(setSt).catch((e) => setErr(e.message))
  useEffect(() => { load(); return () => clearInterval(timer.current) }, [])
  const offer = !!st?.hostedAvailable && !viaRelay
  useEffect(() => { onOffer?.(offer) }, [offer]) // eslint-disable-line react-hooks/exhaustive-deps
  // Your Bold Bridge account, for Bridge AI's relay: signed in, and allowed it? (Asked of the account
  // as this opens, so a request approved since shows.)
  const [acct, setAcct] = useState(null)
  const [asking, setAsking] = useState(false)
  useEffect(() => { if (offer) api('/account?fresh=1').then(setAcct).catch(() => setAcct(null)) }, [offer, st?.hosted])
  const askRelay = async () => {
    setAsking(true); setErr(null)
    try { setAcct(await api('/account/request', { method: 'POST', body: { kind: 'relay' } })) } catch (e) { setErr(e.message) } finally { setAsking(false) }
  }
  // While deploying, while the relay is still connecting (so Pair a device turns on by itself), and
  // while a code is shown (to see the phone arrive), keep the status fresh.
  const waiting = !!(st?.configured && !st?.online)
  useEffect(() => {
    clearInterval(timer.current)
    if (working || st?.busy || st?.pairing || waiting) timer.current = setInterval(load, 1500)
    // On Bridge AI's relay: its account's use, and a limit reached, as they change.
    else if (st?.hosted) timer.current = setInterval(load, 5000)
    return () => clearInterval(timer.current)
  }, [working, st?.busy, !!st?.pairing, waiting, !!st?.hosted]) // eslint-disable-line react-hooks/exhaustive-deps

  // (Bridge AI's relay being full is said by its own box, from st.hostedFull, not an error line.)
  const run = async (path, body) => {
    setErr(null)
    try { const r = await api(path, { method: 'POST', body }); setSt(r); return r } catch (e) { setErr(e.code === 'hostedFull' ? null : e.message); load() }
  }
  const deploy = async (account) => {
    if (st.hosted && !account && !window.confirm('Move to a relay on your own Cloudflare account? Your phones pair again with it afterwards.')) return
    setWorking(true)
    const r = await run('/relay/deploy', { method: mode === 'token' ? 'token' : 'browser', token: mode === 'token' ? token.trim() : undefined, account })
    setWorking(false)
    if (r?.chooseAccount) setAccounts(r.chooseAccount)
    else if (r) { setAccounts(null); setMode(null); setToken(''); setChanging(false); setWay?.(null) }
  }
  const useHosted = async () => {
    if (st.configured && !st.hosted && !window.confirm('Move to Bridge AI\'s relay? Your phones pair again with it afterwards.')) return
    setWorking(true)
    const r = await run('/relay/deploy', { method: 'hosted' })
    setWorking(false)
    if (r) { setChanging(false); setWay?.(null) }
    else { setWay?.((w) => w || 'hosted'); api('/account').then(setAcct).catch(() => {}) } // turned away: it stays picked, saying why
  }

  if (!st) return <section className="st-sec" data-setting="relay"><h4>From anywhere</h4><div className="skeleton-rows"><div /></div></section>

  if (viaRelay) {
    return (
      <section className="st-sec" data-setting="relay">
        <h4>From anywhere</h4>
        <p className="muted small"><Icon name="check" size={12} /> This phone is connected to your computer through {st.hosted ? 'Bridge AI\'s relay' : 'your own relay'}, end-to-end encrypted. To add or remove phones, use Bridge AI on the computer.</p>
        {relayComputers && <Computers />}
      </section>
    )
  }

  const busy = working || !!st.busy
  const cloudflare = accounts ? (
    <div className="relay-box">
      <p className="small"><b>Which Cloudflare account should the relay go on?</b></p>
      <div className="st-row">
        {accounts.map((a) => <button key={a.id} type="button" className="btn small" disabled={busy} onClick={() => deploy(a.id)}>{a.name}</button>)}
        <button type="button" className="ghost-btn" onClick={() => setAccounts(null)}>Cancel</button>
      </div>
    </div>
  ) : busy ? (
    <p className="st-note"><Icon name="refresh" size={13} className="spin" /> {st.busy || 'Working…'} {st.loginUrl && <a href={st.loginUrl} target="_blank" rel="noreferrer">Open the sign-in page</a>}</p>
  ) : mode === 'token' ? (
    <form className="relay-box" onSubmit={(e) => { e.preventDefault(); deploy() }}>
      <p className="small">In Cloudflare, go to <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">My Profile › API Tokens</a>, click <b>Create Token</b>, use the <b>Edit Cloudflare Workers</b> template, and paste the token here. It stays on this computer, for updating the relay.</p>
      <input className="st-input mono" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Cloudflare API token" autoComplete="off" spellCheck={false} aria-label="Cloudflare API token" />
      <div className="st-row">
        <button type="submit" className="btn primary small" disabled={token.trim().length < 20}>Deploy the relay</button>
        <button type="button" className="ghost-btn" onClick={() => setMode(null)}>Cancel</button>
      </div>
    </form>
  ) : (
    <div className="st-row">
      <button type="button" className="btn primary" onClick={() => deploy()}><Icon name="external" size={13} /> Sign in with Cloudflare</button>
      <button type="button" className="ghost-btn" onClick={() => setMode('token')}>Use an API token instead</button>
      <span className="muted small" title="Bridge AI keeps this sign-in to itself, apart from any other Cloudflare tools you use.">Free. Opens Cloudflare in your browser; Bridge AI then sets up the relay.</span>
    </div>
  )
  // Signing in with the browser needs Node.js, and there's none: install it, then sign in.
  const problem = (err || st.error) && !busy && (st.needs === 'node'
    ? <div className="relay-box"><p className="small">Signing in with the browser needs Node.js, which this computer doesn't have yet. Install it here and Bridge AI signs you in right after, or use an API token instead.</p><InstallNode onDone={() => deploy()} /></div>
    : <p className="st-note bad"><Icon name="alert" size={13} /> {err || st.error}</p>)

  // Bridge AI's relay is full for now: the other ways, a click away.
  const full = st.hostedFull && <HostedFull onWay={(w) => { if (st.configured) setChanging(true); setWay?.(w) }} onRetry={useHosted} busy={busy} />

  // Bridge AI's relay is offered: first, how should the phone reach this computer? (Full for now,
  // your own Cloudflare is the one picked.)
  if (offer && (!st.configured || changing)) {
    const pick = way || (st.configured ? null : st.hostedFull ? 'cloudflare' : 'hosted')
    const current = st.configured ? (st.hosted ? 'hosted' : 'cloudflare') : null
    return (
      <section className="st-sec" data-setting="relay">
        <h4>Use Bridge AI on your phone</h4>
        <p className="muted small">Pick how your phone reaches this computer when you're away from it.{st.configured ? ' Moving to another relay means pairing your phones again.' : ''}</p>
        <div className="ph-ways" role="radiogroup" aria-label="How your phone reaches this computer">
          {WAYS.map((w) => (
            <button key={w.id} type="button" role="radio" aria-checked={pick === w.id} className={`ph-way ${pick === w.id ? 'on' : ''}`} onClick={() => setWay?.(w.id)}>
              <span className="ph-way-head"><b>{t(w.title)}</b>{current === w.id ? <span className="st-chip">In use</span> : w.id === 'hosted' && st.hostedFull ? <span className="st-chip warn">{t('Full for now')}</span> : w.tag && !current && <span className="st-chip good">{t(w.tag)}</span>}</span>
              <span className="muted small">{t(w.text)}</span>
            </button>
          ))}
        </div>
        {pick === 'hosted' && (
          <div className="relay-box">
            <p className="small">{t('A relay run by Bold Bridge passes your phone\'s connection on to this computer. It comes with a Bold Bridge account, by request; nothing to set up.')}</p>
            <ul className="ph-facts">
              <li><b>{t('What it can see:')}</b> {t('the IP addresses of your phone and this computer, and when and how much data passes. With the iPhone or Android app, never what you do: everything between them is end-to-end encrypted by code the app carries. In a phone\'s browser, that code comes from the relay.')}</li>
              <li><b>{t('Fair use:')}</b> {t('your account has an allowance every 8 hours and each week, across its computers, plenty for normal use. Settings › Account shows it.')}</li>
              <li><b>Open source:</b> the relay's code is <a href={CODE} target="_blank" rel="noreferrer">on GitHub</a>. If you'd rather not use the project's, pick your own Cloudflare instead.</li>
            </ul>
            {current === 'hosted' ? <p className="muted small"><Icon name="check" size={12} /> This is how your phone connects now.</p>
              : busy ? <p className="st-note"><Icon name="refresh" size={13} className="spin" /> {st.busy || 'Working…'}</p>
              : <Needs acct={acct} asking={asking} onAsk={askRelay}>{full || <div className="st-row"><button type="button" className="btn primary" onClick={useHosted}><Icon name="phone" size={14} /> Use Bridge AI's relay</button></div>}</Needs>}
          </div>
        )}
        {pick === 'cloudflare' && (
          <>
            <p className="muted small" title="A small relay on your own free Cloudflare account: everything stays on your account, with no limits beyond Cloudflare's free plan. Bridge AI puts it there for you and keeps it up to date. Everything between phone and computer is end-to-end encrypted, so neither the relay nor Cloudflare can read it.">A small relay on your own free Cloudflare account, end-to-end encrypted: neither the relay nor Cloudflare can read it.</p>
            {current === 'cloudflare' ? <p className="muted small"><Icon name="check" size={12} /> This is how your phone connects now.</p> : cloudflare}
          </>
        )}
        {pick === 'tailscale' && <p className="muted small">No relay at all: your phone reaches this computer over your own private Tailscale network. Tailscale has to be installed and connected on both. Its steps are just below.{current ? ' The relay keeps working alongside it until you stop using it.' : ''}</p>}
        {changing && <div><button type="button" className="ghost-btn" onClick={() => { setChanging(false); setWay?.(null) }}>Cancel</button></div>}
        {problem}
      </section>
    )
  }

  // What Bridge AI's relay said last: today's limit reached (this computer's, or the whole relay's),
  // a phone turned away for now, or it's switched off ('gone' has its own way back, below).
  const resetAt = st.limit && new Date(st.limit.until).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
  const resetOn = st.limit && new Date(st.limit.until).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  const limitText = st.limit?.why === 'window' ? t('Your Bold Bridge account has used its allowance on Bridge AI\'s relay for now, so your phones can\'t reach your computers through it. It resets at {time}. For no limits, put the relay on your own Cloudflare account.', { time: resetAt })
    : st.limit?.why === 'week' ? t('Your Bold Bridge account has used this week\'s allowance on Bridge AI\'s relay, so your phones can\'t reach your computers through it. It resets on {date}. For no limits, put the relay on your own Cloudflare account.', { date: resetOn })
    : st.limit?.why === 'all' ? t('Bridge AI\'s relay has carried all it can today, for every computer on it. It starts again at {time}. For no limits, put the relay on your own Cloudflare account.', { time: resetAt })
    : st.limit && st.limit.why !== 'gone' ? st.limit.text : null
  // ...and its account's use there, in the window and the week, as the usage chip shows a plan's.
  const use = st.hosted && st.use?.window?.limit ? st.use : null
  const useLimits = use && { window: { hours: use.window.hours || 8, messages: use.window.limit }, week: { messages: use.week.limit } }
  const isoOf = (n) => (n ? new Date(n).toISOString() : null)
  const used = use && { window: { messages: use.window.messages, resetsAt: isoOf(use.window.resetsAt) }, week: { messages: use.week.messages, resetsAt: isoOf(use.week.resetsAt) } }
  // Phones (and a browser) paired here. Your other computers connect the same way, but they're
  // under Your Devices, where unlinking one tells it too (removing it here left it half linked).
  const phones = (st.devices || []).filter((d) => d.kind !== 'computer')
  return (
    <section className="st-sec" data-setting="relay">
      <h4>{st.hosted ? 'From anywhere, through Bridge AI\'s relay' : 'From anywhere, through your own relay'}</h4>
      {st.hosted
        ? <p className="muted small" title={t('Your phone reaches this computer through a relay run by Bold Bridge, for your Bold Bridge account. Everything between them is end-to-end encrypted: the relay sees IP addresses, and when and how much data passes. With the iPhone or Android app it can\'t read the rest, since the app carries the code that does the encrypting; in a phone\'s browser that code comes from the relay. Your account has a fair-use allowance every 8 hours and each week.')}>{t('End-to-end encrypted: the relay sees IP addresses and how much data passes. With the phone apps, never what you do; in a browser, the page\'s code comes from the relay.')}</p>
        : <p className="muted small" title="Your phone reaches this computer through a small relay on your own free Cloudflare account. No VPN and no app to keep running: Bridge AI connects to it whenever it's open. Everything between phone and computer is end-to-end encrypted, so neither the relay nor Cloudflare can read it.">On your own free Cloudflare account, end-to-end encrypted: neither the relay nor Cloudflare can read it.</p>}

      {!st.configured ? cloudflare : (
        <>
          <div className="st-row">
            {st.online
              ? <span className="st-chip good"><Icon name="check" size={11} /> Connected</span>
              : <span className="st-chip warn">Connecting…</span>}
            <code className="small">{st.url.replace(/^https:\/\//, '')}</code>
            {st.account && <span className="muted small">on {st.account}</span>}
          </div>
          {use && <RelayUse used={used} limits={useLimits} />}
          {st.busy && <p className="st-note"><Icon name="refresh" size={13} className="spin" /> {st.busy}</p>}
          {limitText && <p className="st-note warn"><Icon name="alert" size={13} /> {limitText} {['window', 'week', 'all', 'suspended', 'relay', 'deleted'].includes(st.limit.why) && <button type="button" className="link-btn" onClick={() => { setChanging(true); setWay?.('cloudflare') }}>{t('Use your own Cloudflare')}</button>}{st.limit.why === 'token' && <button type="button" className="link-btn" onClick={() => openSettings('account')}>{t('Open Settings › Account')}</button>}</p>}
          {st.limit?.why === 'gone' && !busy && (full || <div className="st-row"><button type="button" className="btn primary" onClick={useHosted}><Icon name="refresh" size={13} /> Set up Bridge AI's relay again</button><span className="muted small">Phones you paired pair again afterwards.</span></div>)}
          {st.needsUpdate && !st.busy && <p className="st-note warn"><Icon name="alert" size={13} /> Your relay is older than this Bridge AI. <button type="button" className="link-btn" onClick={() => run('/relay/update')}>Update it</button></p>}
          {st.hosted && <PageCheck onOwn={() => { setChanging(true); setWay?.('cloudflare') }} />}

          {/* A code pairs one device: once it has, its QR code goes, and another is a click away. */}
          {st.pairing ? <PairCode p={st.pairing} onStop={() => run('/relay/pair', { stop: true })} /> : (
            <div className="st-row">
              {st.paired && <span className="st-chip good" role="status"><Icon name="check" size={11} /> {t('{name} paired', { name: st.paired.name })}</span>}
              <button type="button" className={st.paired ? 'btn' : 'btn primary'} disabled={!st.online} onClick={() => run('/relay/pair')}><Icon name={st.paired ? 'plus' : 'link'} size={14} /> {st.paired ? t('Add another device') : t('Pair a device')}</button>
              {!st.online && <span className="muted small">Waiting for the relay to connect.</span>}
            </div>
          )}

          {phones.length > 0 && (
            <ul className="ph-devices">
              {phones.map((d) => (
                <li key={d.id}>
                  <Icon name="phone" size={14} /><span>{d.name}</span>
                  {d.fresh && <span className="st-chip">{t('New')}</span>}
                  <span className="muted small">{d.connected ? 'connected now' : d.lastSeen ? `last used ${new Date(d.lastSeen).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</span>
                  {/* Just paired: Keep it (yours), as the app's notice offers too. */}
                  {d.fresh && <button type="button" className="ghost-btn" onClick={async () => { setErr(null); try { setSt(await api(`/relay/devices/${encodeURIComponent(d.id)}/keep`, { method: 'POST' })); window.dispatchEvent(new Event('bridge-machines')) } catch (e) { setErr(e.message) } }}>{t('Keep')}</button>}
                  <button type="button" className="ghost-btn" onClick={async () => { if (window.confirm(`Remove ${d.name}? It won't be able to reach this computer until you pair it again.`)) { setErr(null); try { setSt(await api(`/relay/devices/${encodeURIComponent(d.id)}`, { method: 'DELETE' })) } catch (e) { setErr(e.message) } } }}>Remove</button>
                </li>
              ))}
            </ul>
          )}

          <Advanced order={20}><KeepAwake st={st} onChange={setSt} /></Advanced>
          <div className={offer ? 'st-row' : undefined}>
            {offer && <button type="button" className="ghost-btn" onClick={() => { setChanging(true); setWay?.(null) }}>Change how your phone connects</button>}
            <button type="button" className="ghost-btn" onClick={() => { if (window.confirm(st.hosted ? 'Stop using Bridge AI\'s relay? Paired phones are forgotten, and this computer\'s address on the relay is removed.' : 'Stop using this relay? Paired phones are forgotten and Bridge AI signs out of Cloudflare. The relay stays on your Cloudflare account; delete it there if you like.')) run('/relay/forget') }}>Stop using the relay</button>
          </div>
        </>
      )}
      {problem}
    </section>
  )
}

// What Bridge AI's relay needs before this computer can use it: your Bold Bridge account signed in
// here, and allowed the relay. What's missing is said, with the button that fixes it (sign in, ask
// for it); asked, it says so; given, what's inside (Use Bridge AI's relay) shows.
function Needs({ acct, asking, onAsk, children }) {
  if (!acct) return <div className="skeleton-rows"><div /></div>
  const a = acct.signedIn ? acct.account : null
  const say = (text, button) => <div className="st-note relay-needs" role="status"><Icon name="info" size={13} /> <span>{text}</span>{button}</div>
  if (!a) return say(t('Bridge AI\'s relay comes with a Bold Bridge account: sign in with your email, then ask for it.'), <button type="button" className="btn small primary" onClick={() => openSettings('account')}><Icon name="user" size={13} /> {t('Sign in')}</button>)
  if (a.status === 'suspended') return say(t('Your Bold Bridge account is suspended, so it can\'t use Bridge AI\'s relay for now. Your own Cloudflare or Tailscale still work.'))
  if (a.relay === 'requested') return say(t('You asked for Bridge AI\'s relay ({email}). Bold Bridge emails you when it\'s on, and then it\'s one click here.', { email: a.email }))
  if (a.relay !== 'approved') return say(a.relay === 'declined' ? t('Your request for Bridge AI\'s relay was declined. You can ask again, or use your own Cloudflare or Tailscale.') : t('Your Bold Bridge account ({email}) doesn\'t have Bridge AI\'s relay yet. It\'s by request.', { email: a.email }), <button type="button" className="btn small primary" disabled={asking} onClick={onAsk}>{asking ? t('Asking…') : a.relay === 'declined' ? t('Ask again') : t('Request access')}</button>)
  return children
}

// On Bridge AI's relay: whether the phone page it serves to browsers is a release's own
// (server/relaycheck.js, once a day and as this opens). The last check is said quietly; a page that
// differs is said plainly, with what to do: phones in a browser run that page, the apps don't.
const REPORT = 'https://github.com/sahil1/bridge/security/advisories/new'
function PageCheck({ onOwn }) {
  const [c, setC] = useState(null)
  const timer = useRef(null)
  const gone = useRef(false)
  // now: Check again, at once; while a check is under way, asked again until it's done.
  const ask = (now = false) => {
    clearTimeout(timer.current)
    api(`/relay/pagecheck${now ? '?now=1' : ''}`).then((x) => {
      if (gone.current) return
      setC(x)
      if (x.checking) timer.current = setTimeout(ask, 1500)
    }).catch(() => {})
  }
  useEffect(() => { gone.current = false; ask(); return () => { gone.current = true; clearTimeout(timer.current) } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!c?.on) return null
  const again = <button type="button" className="link-btn" disabled={c.checking} onClick={() => ask(true)}>{c.checking ? t('Checking…') : t('Check again')}</button>
  const when = c.at ? new Date(c.at).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
  if (c.why) {
    return (
      <div className="st-note warn" role="alert" data-check="page">
        <p><Icon name="alert" size={13} /> {c.why === 'unreleased'
          ? t('Bridge AI\'s relay says its phone page is from Bridge AI {version}, which isn\'t a release.', { version: c.version })
          : c.differs.length === 1 ? t('Bridge AI\'s relay is serving a phone page that isn\'t Bridge AI {version}\'s: {file} differs.', { version: c.version, file: c.differs[0] })
            : t('Bridge AI\'s relay is serving a phone page that isn\'t Bridge AI {version}\'s: {files} differ.', { version: c.version, files: c.differs.join(', ') })}
        {' '}{t('A phone in a browser runs that page, so it could read what you do there; the iPhone and Android apps carry their own copy and aren\'t affected. Use the apps, or a relay on your own Cloudflare, until this is explained, and please report it.')}</p>
        <div className="st-row">
          <button type="button" className="btn small" onClick={onOwn}>{t('Use your own Cloudflare')}</button>
          <a className="ghost-btn" href={REPORT} target="_blank" rel="noreferrer">{t('Report it')}</a>
          {again}
        </div>
      </div>
    )
  }
  if (c.error && !c.version) return <p className="muted small" data-check="page">{t('Couldn\'t check the phone page Bridge AI\'s relay serves ({error}). It tries again tomorrow, and when you open this.', { error: c.error })} {again}</p>
  if (!c.at) return <p className="muted small" data-check="page"><Icon name="refresh" size={12} className="spin" /> {t('Checking the phone page Bridge AI\'s relay serves…')}</p>
  return (
    <p className="muted small" data-check="page" title={t('Once a day, and when you open this, this computer checks that the page Bridge AI\'s relay serves to phones in a browser is a released version\'s, unchanged. The iPhone and Android apps carry their own copy.')}>
      <Icon name="check" size={12} /> {c.error
        ? t('The relay\'s phone page was Bridge AI {version}\'s, unchanged, when last checked. Couldn\'t check again just now ({error}).', { version: c.version, error: c.error })
        : t('The relay\'s phone page is Bridge AI {version}\'s, unchanged (checked {when}).', { version: c.version, when })} {again}
    </p>
  )
}

// Bridge AI's relay turned this computer away: it takes so many accounts at once, and has them.
// The other two ways, one click each (onWay picks one), or try again later. In Settings › Devices,
// and in first-run setup without the buttons (Settings has them).
export function HostedFull({ onWay, onRetry, busy }) {
  return (
    <div className="st-note warn hosted-full" role="alert">
      <p><Icon name="alert" size={13} /> {t('Bridge AI\'s relay is full for now, so it can\'t take this computer.')} {onWay ? t('Your phone can still reach it: through a relay on your own Cloudflare account (free, and Bridge AI sets it up), or through Tailscale.') : t('Your phone can still reach it: Settings › Devices sets up a relay on your own Cloudflare account (free), or Tailscale.')}</p>
      {onWay && (
        <div className="st-row">
          <button type="button" className="btn primary small" onClick={() => onWay('cloudflare')}>{t('Use your own Cloudflare')}</button>
          <button type="button" className="btn small" onClick={() => onWay('tailscale')}>{t('Use Tailscale')}</button>
          {onRetry && <button type="button" className="ghost-btn" disabled={busy} onClick={onRetry}>{t('Try again')}</button>}
        </div>
      )}
    </div>
  )
}

// Keeping this computer awake while a phone can reach it (server/relay.js, holdAwake): one setting
// for the relay's phones and for Tailscale's phone access, shown with each. st: the relay's status,
// when the caller has it.
export function KeepAwake({ st: given = null, onChange }) {
  const [own, setOwn] = useState(null)
  useEffect(() => { if (!given) api('/relay').then(setOwn).catch(() => {}) }, [given])
  const st = given || own
  if (viaRelay || !st?.canAwake) return null
  const set = async (on) => {
    try { const s = await api('/relay/awake', { method: 'POST', body: { on } }); setOwn(s); onChange?.(s) } catch { /* left as it was */ }
  }
  return (
    <div className="ph-awake" data-setting="keep-awake">
      <label className="ph-check">
        <input type="checkbox" checked={!!st.awake} onChange={(e) => set(e.target.checked)} /> {t('Keep this computer awake while your phone can reach it')}
        {st.awake && st.awakeNow && <span className="st-chip good">{t('Awake now')}</span>}
      </label>
      <p className="muted small" title={t("Walk away and your agents are still a tap away. The screen still turns off and locks. Closing a laptop's lid can still put it to sleep.")}>{t("The screen still locks; closing a laptop's lid can still put it to sleep.")}</p>
    </div>
  )
}

// In the iPhone or Android app: the computers it's paired with, to switch between, add or forget.
function Computers() {
  const [list, setList] = useState(() => relayComputers.list())
  const forget = async (c) => {
    const msg = c.current ? `Forget ${c.name} on this phone? It's removed from this computer's paired phones too, and you'd need a new code to pair again.` : `Forget ${c.name} on this phone? To remove this phone there too, use Bridge AI on that computer.`
    if (!window.confirm(msg)) return
    await relayComputers.forget(c.relay)
    setList(relayComputers.list())
  }
  return (
    <>
      <h4>Your Computers</h4>
      <ul className="ph-devices">
        {list.map((c) => (
          <li key={c.relay}>
            <Icon name="laptop" size={14} /><span>{c.name}</span>
            <span className="muted small">{c.current ? 'showing now' : ''}</span>
            {!c.current && <button type="button" className="ghost-btn" onClick={() => relayComputers.open(c.relay)}>Open</button>}
            <button type="button" className="ghost-btn" onClick={() => forget(c)}>Forget</button>
          </li>
        ))}
      </ul>
      <p className="muted small">{t('Bridge AI on another computer? On it, open Settings › Devices and choose Pair a device, then add it here.')}</p>
      <div><button type="button" className="ghost-btn" onClick={() => relayComputers.add()}><Icon name="plus" size={12} /> Add a computer</button></div>
    </>
  )
}

// Pair a device: one code for a phone or another computer, as a QR code, a link and the code itself.
function PairCode({ p, onStop, forPhone = false }) {
  const left = Math.max(0, Math.round((p.expires - Date.now()) / 60000))
  const [copied, setCopied] = useState(false)
  const host = p.link.split('#')[0].replace(/^https:\/\//, '').replace(/\/$/, '')
  const copy = () => navigator.clipboard?.writeText(p.link).then(() => setCopied(true), () => {})
  return (
    <div className="ph-pair">
      <div className="ph-qr" aria-label={t('QR code to pair a device')} dangerouslySetInnerHTML={{ __html: p.qr }} />
      <div className="ph-pair-text">
        <ol className="ph-steps">
          <li><b>{t('A phone:')}</b> {t('scan this with its camera, or in the Bridge AI app. To use it like an app in a browser, add it to the Home Screen (iPhone: Share › Add to Home Screen; Android: ⋮ › Install app) and pair it there. A code pairs one device.')}</li>
          {!forPhone && <li><b>{t('Another computer:')}</b> {t('in Bridge AI there, open Settings › Devices › Link a device, and paste the link or type the address and code.')}</li>}
          {!forPhone && <li><b>{t('Or let your phone link them:')}</b> {t('scan this with the Bridge AI app on a phone that\'s paired with the other computer, and it offers to link the two.')}</li>}
        </ol>
        <div className="ph-code">
          <span className="muted small">{t('Address')}</span><code>{host}</code>
          <span className="muted small">{t('Code')}</span><b className="mono">{p.code}</b>
        </div>
        <p className="muted small">{left === 1 ? t('The code works for 1 more minute, for one device.') : t('The code works for {n} more minutes, for one device.', { n: left })}</p>
        <div className="st-row">
          <button type="button" className="ghost-btn" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={12} /> {copied ? t('Copied') : t('Copy link')}</button>
          <button type="button" className="ghost-btn" onClick={onStop}>{t('Done')}</button>
        </div>
      </div>
    </div>
  )
}

export { PairCode }
