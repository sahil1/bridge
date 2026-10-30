import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { InstallNode } from '../SignIn.jsx'
import { api, viaRelay, relayComputers } from '../../api.js'
import { t, locale } from '../../i18n/index.js'

// Settings › Devices › "From anywhere": your own relay on your Cloudflare account
// (server/relay.js). Optional: Bridge AI works the same without it.
//
// Once Bridge AI's own relay exists (server/hosted.js), it's offered too, as the easiest of three
// ways, and this starts with a choice (the way picked is kept by Phone.jsx, which shows Tailscale's
// section). Until then it's exactly the relay section it always was.
const WAYS = [
  { id: 'hosted', title: 'Bridge AI\'s relay', text: 'Easiest. No account, one click.', tag: 'Recommended' },
  { id: 'cloudflare', title: 'Your own Cloudflare', text: 'Everything on your own free account.' },
  { id: 'tailscale', title: 'Tailscale', text: 'If you already use it.' },
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
  // While deploying, while the relay is still connecting (so Pair a device turns on by itself), and
  // while a code is shown (to see the phone arrive), keep the status fresh.
  const waiting = !!(st?.configured && !st?.online)
  useEffect(() => {
    clearInterval(timer.current)
    if (working || st?.busy || st?.pairing || waiting) timer.current = setInterval(load, 1500)
    return () => clearInterval(timer.current)
  }, [working, st?.busy, !!st?.pairing, waiting]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (path, body) => {
    setErr(null)
    try { const r = await api(path, { method: 'POST', body }); setSt(r); return r } catch (e) { setErr(e.message); load() }
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
  }

  if (!st) return <section className="st-sec"><h4>From anywhere</h4><div className="skeleton-rows"><div /></div></section>

  if (viaRelay) {
    return (
      <section className="st-sec">
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
      <span className="muted small">Free. Opens Cloudflare in your browser; Bridge AI then sets up the relay. Bridge AI keeps this sign-in to itself, apart from any other Cloudflare tools you use.</span>
    </div>
  )
  // Signing in with the browser needs Node.js, and there's none: install it, then sign in.
  const problem = (err || st.error) && !busy && (st.needs === 'node'
    ? <div className="relay-box"><p className="small">Signing in with the browser needs Node.js, which this computer doesn't have yet. Install it here and Bridge AI signs you in right after, or use an API token instead.</p><InstallNode onDone={() => deploy()} /></div>
    : <p className="st-note bad"><Icon name="alert" size={13} /> {err || st.error}</p>)

  // Bridge AI's relay is offered: first, how should the phone reach this computer?
  if (offer && (!st.configured || changing)) {
    const pick = way || (st.configured ? null : 'hosted')
    const current = st.configured ? (st.hosted ? 'hosted' : 'cloudflare') : null
    return (
      <section className="st-sec">
        <h4>Use Bridge AI on your phone</h4>
        <p className="muted small">Pick how your phone reaches this computer when you're away from it.{st.configured ? ' Moving to another relay means pairing your phones again.' : ''}</p>
        <div className="ph-ways" role="radiogroup" aria-label="How your phone reaches this computer">
          {WAYS.map((w) => (
            <button key={w.id} type="button" role="radio" aria-checked={pick === w.id} className={`ph-way ${pick === w.id ? 'on' : ''}`} onClick={() => setWay?.(w.id)}>
              <span className="ph-way-head"><b>{w.title}</b>{current === w.id ? <span className="st-chip">In use</span> : w.tag && !current && <span className="st-chip good">{w.tag}</span>}</span>
              <span className="muted small">{w.text}</span>
            </button>
          ))}
        </div>
        {pick === 'hosted' && (
          <div className="relay-box">
            <p className="small">A relay run by the Bridge AI project passes your phone's connection on to this computer. There's nothing to sign up for or set up.</p>
            <ul className="ph-facts">
              <li><b>What it can see:</b> the IP addresses of your phone and this computer, and when and how much data passes. Never what you do: everything between them is end-to-end encrypted.</li>
              <li><b>Fair use:</b> each computer has a daily allowance, plenty for normal use. If it runs out, it resets the next day.</li>
              <li><b>Open source:</b> the relay's code is <a href={CODE} target="_blank" rel="noreferrer">on GitHub</a>. If you'd rather not use the project's, pick your own Cloudflare instead.</li>
            </ul>
            {current === 'hosted' ? <p className="muted small"><Icon name="check" size={12} /> This is how your phone connects now.</p>
              : busy ? <p className="st-note"><Icon name="refresh" size={13} className="spin" /> {st.busy || 'Working…'}</p>
              : <div className="st-row"><button type="button" className="btn primary" onClick={useHosted}><Icon name="phone" size={14} /> Use Bridge AI's relay</button></div>}
          </div>
        )}
        {pick === 'cloudflare' && (
          <>
            <p className="muted small">A small relay on your own free Cloudflare account: everything stays on your account, with no limits beyond Cloudflare's free plan. Bridge AI puts it there for you and keeps it up to date. Everything between phone and computer is end-to-end encrypted, so neither the relay nor Cloudflare can read it.</p>
            {current === 'cloudflare' ? <p className="muted small"><Icon name="check" size={12} /> This is how your phone connects now.</p> : cloudflare}
          </>
        )}
        {pick === 'tailscale' && <p className="muted small">No relay at all: your phone reaches this computer over your own private Tailscale network. Tailscale has to be installed and connected on both. Its steps are just below.{current ? ' The relay keeps working alongside it until you stop using it.' : ''}</p>}
        {changing && <div><button type="button" className="ghost-btn" onClick={() => { setChanging(false); setWay?.(null) }}>Cancel</button></div>}
        {problem}
      </section>
    )
  }

  const limitText = st.limit?.why === 'day' ? `The hosted relay's daily limit for this computer is used up. It resets at ${new Date(st.limit.until).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })}. For no limits, put the relay on your own Cloudflare account.` : st.limit?.why === 'off' ? st.limit.text : null
  // Phones (and a browser) paired here. Your other computers connect the same way, but they're
  // under Your devices, where unlinking one tells it too (removing it here left it half linked).
  const phones = (st.devices || []).filter((d) => d.kind !== 'computer')
  return (
    <section className="st-sec">
      <h4>{st.hosted ? 'From anywhere, through Bridge AI\'s relay' : 'From anywhere, through your own relay'}</h4>
      {st.hosted
        ? <p className="muted small">Your phone reaches this computer through a relay run by the Bridge AI project. Everything between them is end-to-end encrypted, so the relay can't read it: it sees IP addresses, and when and how much data passes. Each computer has a fair-use daily allowance.</p>
        : <p className="muted small">Your phone reaches this computer through a small relay on your own free Cloudflare account. No VPN and no app to keep running: Bridge AI connects to it whenever it's open. Everything between phone and computer is end-to-end encrypted, so neither the relay nor Cloudflare can read it.</p>}

      {!st.configured ? cloudflare : (
        <>
          <div className="st-row">
            {st.online
              ? <span className="st-chip good"><Icon name="check" size={11} /> Connected</span>
              : <span className="st-chip warn">Connecting…</span>}
            <code className="small">{st.url.replace(/^https:\/\//, '')}</code>
            {st.account && <span className="muted small">on {st.account}</span>}
          </div>
          {st.busy && <p className="st-note"><Icon name="refresh" size={13} className="spin" /> {st.busy}</p>}
          {limitText && <p className="st-note warn"><Icon name="alert" size={13} /> {limitText} {st.limit.why === 'day' && <button type="button" className="link-btn" onClick={() => { setChanging(true); setWay?.('cloudflare') }}>Use your own Cloudflare</button>}</p>}
          {st.limit?.why === 'gone' && !busy && <div className="st-row"><button type="button" className="btn primary" onClick={useHosted}><Icon name="refresh" size={13} /> Set up Bridge AI's relay again</button><span className="muted small">Phones you paired pair again afterwards.</span></div>}
          {st.needsUpdate && !st.busy && <p className="st-note warn"><Icon name="alert" size={13} /> Your relay is older than this Bridge AI. <button type="button" className="link-btn" onClick={() => run('/relay/update')}>Update it</button></p>}

          {st.pairing ? <PairCode p={st.pairing} onStop={() => run('/relay/pair', { stop: true })} /> : (
            <div className="st-row">
              <button type="button" className="btn primary" disabled={!st.online} onClick={() => run('/relay/pair')}><Icon name="link" size={14} /> {t('Pair a device')}</button>
              {!st.online && <span className="muted small">Waiting for the relay to connect.</span>}
            </div>
          )}

          {phones.length > 0 && (
            <ul className="ph-devices">
              {phones.map((d) => (
                <li key={d.id}>
                  <Icon name="phone" size={14} /><span>{d.name}</span>
                  <span className="muted small">{d.connected ? 'connected now' : d.lastSeen ? `last used ${new Date(d.lastSeen).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</span>
                  <button type="button" className="ghost-btn" onClick={async () => { if (window.confirm(`Remove ${d.name}? It won't be able to reach this computer until you pair it again.`)) { setErr(null); try { setSt(await api(`/relay/devices/${encodeURIComponent(d.id)}`, { method: 'DELETE' })) } catch (e) { setErr(e.message) } } }}>Remove</button>
                </li>
              ))}
            </ul>
          )}

          {st.canAwake && (
            <label className="ph-check"><input type="checkbox" checked={st.awake} onChange={(e) => run('/relay/awake', { on: e.target.checked })} /> Keep this computer awake while it's plugged in, so your phone can always reach it</label>
          )}
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
      <h4>Your computers</h4>
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
          <li><b>{t('A phone:')}</b> {t('scan this with its camera, or in the Bridge AI app. Then add it to your Home Screen (iPhone: Share › Add to Home Screen; Android: ⋮ › Install app), open it from there, and type the code again if it asks.')}</li>
          {!forPhone && <li><b>{t('Another computer:')}</b> {t('in Bridge AI there, open Settings › Devices › Link a device, and paste the link or type the address and code.')}</li>}
          {!forPhone && <li><b>{t('Or let your phone link them:')}</b> {t('scan this with the Bridge AI app on a phone that\'s paired with the other computer, and it offers to link the two.')}</li>}
        </ol>
        <div className="ph-code">
          <span className="muted small">{t('Address')}</span><code>{host}</code>
          <span className="muted small">{t('Code')}</span><b className="mono">{p.code}</b>
        </div>
        <p className="muted small">{left === 1 ? t('The code works for 1 more minute, for up to 3 devices.') : t('The code works for {n} more minutes, for up to 3 devices.', { n: left })}</p>
        <div className="st-row">
          <button type="button" className="ghost-btn" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={12} /> {copied ? t('Copied') : t('Copy link')}</button>
          <button type="button" className="ghost-btn" onClick={onStop}>{t('Done')}</button>
        </div>
      </div>
    </div>
  )
}

export { PairCode }
