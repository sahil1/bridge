import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, viaRelay, relayComputers } from '../../api.js'

// Settings › Phone & notifications › "From anywhere": your own relay on your Cloudflare account
// (server/relay.js). Optional: Bridge AI works the same without it.
export default function Relay() {
  const [st, setSt] = useState(null)
  const [err, setErr] = useState(null)
  const [mode, setMode] = useState(null) // 'token' while pasting an API token
  const [token, setToken] = useState('')
  const [accounts, setAccounts] = useState(null)
  const [working, setWorking] = useState(false)
  const timer = useRef(null)
  const load = () => api('/relay').then(setSt).catch((e) => setErr(e.message))
  useEffect(() => { load(); return () => clearInterval(timer.current) }, [])
  // While deploying, while the relay is still connecting (so Pair a phone turns on by itself), and
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
    setWorking(true)
    const r = await run('/relay/deploy', { method: mode === 'token' ? 'token' : 'browser', token: mode === 'token' ? token.trim() : undefined, account })
    setWorking(false)
    if (r?.chooseAccount) setAccounts(r.chooseAccount)
    else if (r) { setAccounts(null); setMode(null); setToken('') }
  }

  if (!st) return <section className="st-sec"><h4>From anywhere</h4><div className="skeleton-rows"><div /></div></section>

  if (viaRelay) {
    return (
      <section className="st-sec">
        <h4>From anywhere</h4>
        <p className="muted small"><Icon name="check" size={12} /> This phone is connected to your computer through your own relay, end-to-end encrypted. To add or remove phones, use Bridge AI on the computer.</p>
        {relayComputers && <Computers />}
      </section>
    )
  }

  const busy = working || !!st.busy
  return (
    <section className="st-sec">
      <h4>From anywhere, through your own relay</h4>
      <p className="muted small">Your phone reaches this computer through a small relay on your own free Cloudflare account. No VPN and no app to keep running: Bridge AI connects to it whenever it's open. Everything between phone and computer is end-to-end encrypted, so neither the relay nor Cloudflare can read it.</p>

      {!st.configured ? (
        accounts ? (
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
      ) : (
        <>
          <div className="st-row">
            {st.online
              ? <span className="st-chip good"><Icon name="check" size={11} /> Connected</span>
              : <span className="st-chip warn">Connecting…</span>}
            <code className="small">{st.url.replace(/^https:\/\//, '')}</code>
            {st.account && <span className="muted small">on {st.account}</span>}
          </div>
          {st.busy && <p className="st-note"><Icon name="refresh" size={13} className="spin" /> {st.busy}</p>}
          {st.needsUpdate && !st.busy && <p className="st-note warn"><Icon name="alert" size={13} /> Your relay is older than this Bridge AI. <button type="button" className="link-btn" onClick={() => run('/relay/update')}>Update it</button></p>}

          {st.pairing ? <PairCode p={st.pairing} onStop={() => run('/relay/pair', { stop: true })} /> : (
            <div className="st-row">
              <button type="button" className="btn primary" disabled={!st.online} onClick={() => run('/relay/pair')}><Icon name="phone" size={14} /> Pair a phone</button>
              {!st.online && <span className="muted small">Waiting for the relay to connect.</span>}
            </div>
          )}

          {st.devices.length > 0 && (
            <ul className="ph-devices">
              {st.devices.map((d) => (
                <li key={d.id}>
                  <Icon name="phone" size={14} /><span>{d.name}</span>
                  <span className="muted small">{d.connected ? 'connected now' : d.lastSeen ? `last used ${new Date(d.lastSeen).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</span>
                  <button type="button" className="ghost-btn" onClick={async () => { if (window.confirm(`Remove ${d.name}? It won't be able to reach this computer until you pair it again.`)) { setErr(null); try { setSt(await api(`/relay/devices/${encodeURIComponent(d.id)}`, { method: 'DELETE' })) } catch (e) { setErr(e.message) } } }}>Remove</button>
                </li>
              ))}
            </ul>
          )}

          {st.canAwake && (
            <label className="ph-check"><input type="checkbox" checked={st.awake} onChange={(e) => run('/relay/awake', { on: e.target.checked })} /> Keep this computer awake while it's plugged in, so your phone can always reach it</label>
          )}
          <div><button type="button" className="ghost-btn" onClick={() => { if (window.confirm('Stop using this relay? Paired phones are forgotten and Bridge AI signs out of Cloudflare. The relay stays on your Cloudflare account; delete it there if you like.')) run('/relay/forget') }}>Stop using the relay</button></div>
        </>
      )}
      {(err || st.error) && !busy && <p className="st-note bad"><Icon name="alert" size={13} /> {err || st.error}</p>}
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
      <p className="muted small">Bridge AI on another computer? On it, open Settings › Phone &amp; notifications and click Pair a phone, then add it here.</p>
      <div><button type="button" className="ghost-btn" onClick={() => relayComputers.add()}><Icon name="plus" size={12} /> Add a computer</button></div>
    </>
  )
}

function PairCode({ p, onStop }) {
  const left = Math.max(0, Math.round((p.expires - Date.now()) / 60000))
  return (
    <div className="ph-pair">
      <div className="ph-qr" aria-label="QR code to pair a phone" dangerouslySetInnerHTML={{ __html: p.qr }} />
      <div className="ph-pair-text">
        <ol className="ph-steps">
          <li><b>Scan this code</b> with the phone's camera. Or open <code>{p.link.split('#')[0]}</code> on the phone and type <b className="mono">{p.code}</b>.</li>
          <li><b>Add it to your Home Screen</b> so it opens like an app. iPhone: Share › Add to Home Screen. Android: ⋮ › Install app.</li>
          <li><b>Open it from the Home Screen</b> (type the code again if it asks) and turn on notifications in Settings › Phone & notifications there.</li>
        </ol>
        <p className="muted small">The code works for {left} more minute{left === 1 ? '' : 's'}, for up to 3 devices.</p>
        <div className="st-row">
          <button type="button" className="ghost-btn" onClick={() => navigator.clipboard?.writeText(p.link).catch(() => {})}><Icon name="copy" size={12} /> Copy link</button>
          <button type="button" className="ghost-btn" onClick={onStop}>Done</button>
        </div>
      </div>
    </div>
  )
}
