// Settings › Account & Devices › Computers, with Remote Screen and Preview on (a Beta Feature):
//   This Computer's Screen  whether your other devices can see it, and if not why; who's looking now,
//                           with Stop
//   Remote Access           1. the Remote Access Password, 2. "Let my other devices control this
//                           computer" (which needs it; on a Mac, macOS's Accessibility question then),
//                           as two steps of one block; Ask Here First, which devices may connect (one
//                           unticked may use nothing here), and who's locked out, with Unlock; and
//                           Screen Sharing Notifications: on or off, where they go, and the way to set
//                           one up when nothing would hear of it (server/screentell.js)
//   Screen Activity         the record of every session, and every one turned away
// Each is changed here, at this computer, only: elsewhere (another computer's window, a phone) the
// password and Ask Here First are shown as they are, saying where they're changed; the devices and
// the record are this computer's own to see. Each says what it does in a line; the rest is under More.
import { useState } from 'react'
import Icon from '../Icon.jsx'
import { BASE, api, onThisComputer, usePoll } from '../../api.js'
import { useTrial } from '../../trials.js'
import { t, locale } from '../../i18n/index.js'
import { ACCESS } from '../../../shared/remote.js'
import { useRemote, remoteDo } from './remote.js'
import { Sessions, whoOf } from './Here.jsx'

const desktop = () => (window.bridgeApp?.desktop && window.bridgeApp.remote ? window.bridgeApp : null)
const dayOf = (iso) => new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric' })
const clockOf = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })

// active: look at all (the devices menu looks only while it's open).
export function useControl(active = true) {
  const here = onThisComputer()
  const on = useTrial('remote-screen')
  const r = useRemote(BASE, 4000, on && active)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = async (want) => {
    setBusy(true)
    setErr(null)
    try {
      // Turned on at a Mac: macOS's own Accessibility question now, never before.
      if (want && r.data?.os === 'mac' && r.data?.access?.password) await desktop()?.remote.controlAsk().catch(() => null)
      await remoteDo(BASE, '/control', { on: want })
      r.refresh()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return { on, here, data: r.data, error: r.error, busy, err, set, refresh: r.refresh }
}

// A device in Which Devices May Connect: its name, and for one through another of your computers, which.
const deviceName = (d) => (d.through ? t('{name}, through {computer}', { name: whoOf({ by: d }), computer: d.through }) : whoOf({ by: d }))

// A linked computer on a Bridge AI from before its devices were told apart from it (server/relay.js
// builtOf): said, since this list can't keep its devices out apart from it.
function Older({ d }) {
  if (d.kind !== 'computer' || !d.older) return null
  return <span className="small rs-older"><Icon name="info" size={11} /> {t('{name} runs an older Bridge AI: devices reaching this computer through it can\'t be told apart from {name} itself, so the list can\'t keep them out separately. Update Bridge AI on {name}.', { name: deviceName(d) })}</span>
}

// Unticked: the other entries that may be the same device (paired with the same key, or of the
// same name: server/remote.js accessStatus same), still let in, offered to keep out too.
function SameToo({ d, all, keep }) {
  const others = (d.same || []).map((id) => all.find((x) => x.id === id)).filter((x) => x && x.allowed)
  if (!others.length) return null
  return (
    <span className="small rs-same">
      {t('It may be the same device as {others}.', { others: others.map(deviceName).join(', ') })}{' '}
      <button type="button" className="ghost-btn small" onClick={async () => { for (const x of others) await keep(x.id) }}>{others.length === 1 ? t('Keep That Out Too') : t('Keep Those Out Too')}</button>
    </span>
  )
}

// With Remote Screen and Preview off, the devices you unticked here are still kept out of this
// computer (server/remote.js): listed with Allow where the Beta Feature's settings would be, at this
// computer only, which is where they're let back in.
export function KeptOut() {
  const here = onThisComputer()
  const on = useTrial('remote-screen')
  const { data, refresh } = usePoll('/remote', 15000, { enabled: here && !on })
  const [err, setErr] = useState(null)
  const out = (data?.access?.devices || []).filter((d) => d.out)
  if (on || !here || !out.length) return null
  const allow = async (id) => { setErr(null); try { await remoteDo(BASE, '/devices', { id, allowed: true }); refresh() } catch (e) { setErr(e.message) } }
  return (
    <section className="st-sec rs-settings" data-setting="remote-kept-out">
      <h4>{t('Kept Out of This Computer')}</h4>
      <p className="muted small">{t('You unticked these in Which Devices May Connect. They can\'t use this computer at all, with Remote Screen and Preview on or off.')}</p>
      <ul className="rs-devices">
        {out.map((d) => (
          <li key={d.id}>
            <span><Icon name={d.kind === 'computer' ? 'laptop' : 'phone'} size={12} /> {deviceName(d)} <span className="muted">{d.kind === 'computer' ? t('computer') : t('phone')}</span></span>
            <button type="button" className="btn small" onClick={() => allow(d.id)}>{t('Allow')}</button>
            <Older d={d} />
          </li>
        ))}
      </ul>
      {err && <p className="error-text small" role="alert">{err}</p>}
    </section>
  )
}
// Under the Beta Feature, once it's off here: that the devices you unticked stay out.
export function StaysOut() {
  const here = onThisComputer()
  const { data } = usePoll('/remote', 15000, { enabled: here })
  const n = (data?.access?.devices || []).filter((d) => d.out).length
  if (!here || !n) return null
  return <p className="muted small ab-trial-go"><Icon name="lock" size={11} /> {n === 1 ? t('The device you unticked stays out of this computer while this is off. Settings › Account & Devices › Computers lets it back in.') : t('The {n} devices you unticked stay out of this computer while this is off. Settings › Account & Devices › Computers lets them back in.', { n })}</p>
}

// What a setting does in full, folded away under its one line.
const More = ({ children }) => <details className="rs-more"><summary><Icon name="chevron" size={11} />{t('More')}</summary>{children}</details>

// Step 1, the Remote Access Password: set, changed or taken off here; elsewhere, whether there is one.
function Password({ access, here, name, refresh }) {
  const [edit, setEdit] = useState(null) // null | 'set' | 'remove'
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const min = access.limits?.passwordMin || ACCESS.passwordMin
  const close = () => { setEdit(null); setA(''); setB(''); setErr(null) }
  const save = async (e) => {
    e.preventDefault()
    if ([...a].length < min) return setErr(t('Use at least {n} characters.', { n: min }))
    if (a !== b) return setErr(t('The two passwords aren\'t the same.'))
    setBusy(true)
    setErr(null)
    try { await remoteDo(BASE, '/password', { password: a }); close(); refresh() } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  const remove = async () => { setBusy(true); setErr(null); try { await remoteDo(BASE, '/password', { remove: true }); close(); refresh() } catch (x) { setErr(x.message) } finally { setBusy(false) } }
  return (
    <div className="rs-step" data-setting="remote-password">
      <span className={`rs-step-n${access.password ? ' done' : ''}`} aria-hidden="true">{access.password ? <Icon name="check" size={11} /> : '1'}</span>
      <div className="rs-step-body">
        <b>{t('Remote Access Password')}</b>
        <p className="muted small">{t('Asked of each of your devices before it sees this screen.')}</p>
        {access.password
          ? <p className="small rs-ok"><Icon name="lock" size={12} /> {access.passwordAt ? t('Set on {date}.', { date: dayOf(access.passwordAt) }) : t('Set.')}</p>
          : <p className="small rs-no"><Icon name="info" size={12} /> {t('No password yet: your devices see this screen without one.')}</p>}
        {!here && <p className="muted small">{t('The password is set at {name} itself, never from another device.', { name })}</p>}
        {here && !edit && (
          <div className="st-row">
            <button type="button" className="btn small" onClick={() => setEdit('set')}>{access.password ? t('Change Password') : t('Set Password')}</button>
            {access.password && <button type="button" className="ghost-btn small" onClick={() => setEdit('remove')}>{t('Remove')}</button>}
          </div>
        )}
        {here && edit === 'set' && (
          <form className="rs-pw-form" onSubmit={save}>
            <input className="st-input" type="password" name="bridge-remote-new" autoComplete="new-password" autoFocus value={a} onChange={(e) => setA(e.target.value)} placeholder={t('New password')} aria-label={t('New password')} />
            <input className="st-input" type="password" name="bridge-remote-again" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} placeholder={t('The same again')} aria-label={t('The same again')} />
            <div className="st-row">
              <button type="submit" className="btn small primary" disabled={busy || !a || !b}>{t('Save Password')}</button>
              <button type="button" className="ghost-btn small" onClick={close}>{t('Cancel')}</button>
            </div>
          </form>
        )}
        {here && edit === 'remove' && (
          <div className="st-row between">
            <p className="small">{t('Remove the password? Control goes off with it, as it needs one.')}</p>
            <span className="st-row">
              <button type="button" className="btn small danger" disabled={busy} onClick={remove}>{t('Remove Password')}</button>
              <button type="button" className="ghost-btn small" onClick={close}>{t('Cancel')}</button>
            </span>
          </div>
        )}
        {err && <p className="error-text small" role="alert">{err}</p>}
      </div>
    </div>
  )
}

// Screen Sharing Notifications: on unless turned off here (at this computer only); where they go (the
// devices that get this computer's notifications, and each linked computer's, which it passes them
// on to); and, when that's nowhere, saying so with the way to set one up.
function Notify({ nt, here, name, set }) {
  if (!nt) return null
  const devices = nt.devices || []
  const through = (nt.computers || []).filter((c) => c.devices > 0)
  // (Where they go is said at this computer only.)
  const nowhere = !!nt.devices && !devices.length && !through.length
  const setUp = () => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'notifications' } }))
  return (
    <div className="rs-block" data-setting="remote-notify">
      <label className="st-check">
        <input type="checkbox" role="switch" checked={!!nt.on} disabled={!here} onChange={(e) => set(e.target.checked)} />
        <span>
          <b>{t('Screen Sharing Notifications')}</b><br />
          <small className="muted">{t('Your other devices are told when this screen is viewed, with Stop and Block This Device.')}</small>
        </span>
      </label>
      {nt.on && !nowhere && (
        <ul className="rs-goes small">
          {devices.length > 0 && <li><Icon name="bell" size={12} /> {t('On this computer: {list}.', { list: devices.map((d) => d.label).join(', ') })}</li>}
          {through.map((c) => <li key={c.id}><Icon name="laptop" size={12} /> {c.devices === 1 ? t('Through {name}: 1 device.', { name: c.name }) : t('Through {name}: {n} devices.', { name: c.name, n: c.devices })}</li>)}
        </ul>
      )}
      {nt.on && nowhere && (
        <div className="st-row between rs-nowhere">
          <p className="small"><Icon name="alert" size={12} /> {t('No notification channel is set up on this computer or your other computers, so nobody would be told. Screen Activity and the notice on this computer still say each time.')}</p>
          <button type="button" className="btn small primary" onClick={setUp}>{t('Set Up Notifications')}</button>
        </div>
      )}
      {!nt.on && <p className="small rs-no"><Icon name="info" size={12} /> {t('Off: your other devices aren\'t told when this screen is viewed. Screen Activity and the notice on this computer still say each time.')}</p>}
      {!here && <p className="muted small">{t('Turned on and off at {name} itself.', { name })}</p>}
      <More><p className="muted small">{t('When any device starts viewing this screen, takes control or waits on Ask Here First, your other devices are told, with Stop and Block This Device. Every window of Bridge AI shows it too, while it lasts. The device doing the viewing isn\'t told of its own session.')}</p></More>
    </div>
  )
}

export function RemoteSettings() {
  const { on, here, data, error, busy, err, set, refresh } = useControl()
  const [asked, setAsked] = useState(null)
  const [aErr, setAErr] = useState(null)
  if (!on) return null
  if (!data) return <section className="st-sec"><h4>{t("This Computer's Screen")}</h4>{error ? <p className="error-text small">{error.message === 'update' ? t('Bridge AI here is too old for this. Update it.') : error.message}</p> : <div className="skeleton-rows"><div /></div>}</section>
  const sc = data.screen || {}
  const c = data.control || {}
  const ac = data.access || { devices: [], locks: [], limits: ACCESS }
  const name = data.name
  const askScreen = async () => { setAsked(null); try { const r = await api('/calls/screen', { method: 'POST' }); setAsked(r.allowed ? 'ok' : 'asked'); refresh() } catch (e) { setAsked(e.message) } }
  const allowAx = async () => { await desktop()?.permission?.ask('accessibility').catch(() => null); refresh() }
  const access = async (path, body) => { setAErr(null); try { await remoteDo(BASE, path, body); refresh() } catch (e) { setAErr(e.message) } }
  const watching = (data.sessions || []).filter((s) => s.kind === 'screen')
  const needsPassword = !ac.password
  const elsewhere = <p className="muted small">{t('Changed at {name} itself.', { name })}</p>
  return (
    <>
      <section className="st-sec rs-settings" data-setting="remote-screen">
        <h4>{t("This Computer's Screen")}</h4>
        <p className="muted small">{t('Your other devices can see this screen, and the apps your agents serve here, through their encrypted link. While one does, this screen says so, with Stop, and each time is kept below.')}</p>
        {sc.can
          ? <p className="small rs-ok"><Icon name="check" size={12} /> {t('Your other devices can see this screen while Bridge AI is open here.')}</p>
          : <p className="small rs-no"><Icon name="info" size={12} /> {sc.why}</p>}
        {data.os === 'mac' && here && sc.can && sc.permission === 'ask' && (
          <div className="st-row between">
            <p className="muted small">{asked === 'asked' ? t('macOS asked: turn on Bridge AI under Screen & System Audio Recording, then open Bridge AI again.') : t('macOS asks about Screen Recording the first time one of your devices looks. You can say yes now instead, so nobody has to be here then.')}</p>
            <button type="button" className="btn small" onClick={askScreen}>{t('Allow Screen Recording')}</button>
          </div>
        )}
        {typeof asked === 'string' && !['ok', 'asked'].includes(asked) && <p className="error-text small">{asked}</p>}
        {watching.length > 0 && (
          <ul className="rs-now">
            {watching.map((s) => (
              <li key={s.id}>
                <span className="rs-dot on" aria-hidden="true" />
                <span>{s.waiting ? t('{who} is connecting to this screen', { who: whoOf(s) }) : s.controlled ? t('{who} is controlling this screen', { who: whoOf(s) }) : t('{who} is viewing this screen', { who: whoOf(s) })}</span>
                {here && <button type="button" className="btn small danger" onClick={() => remoteDo(BASE, `/sessions/${encodeURIComponent(s.id)}/stop`).then(refresh, () => {})}>{t('Stop')}</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="st-sec rs-settings" data-setting="remote-access">
        <h4>{t('Remote Access')}</h4>
        {/* One block, in order: the password, then control, which needs it. */}
        <div className="rs-steps">
          <Password access={ac} here={here} name={name} refresh={refresh} />
          <div className={`rs-step${needsPassword ? ' off' : ''}`} data-setting="remote-control">
            <span className={`rs-step-n${c.on ? ' done' : ''}`} aria-hidden="true">{c.on ? <Icon name="check" size={11} /> : '2'}</span>
            <div className="rs-step-body">
              <label className="st-check rs-control">
                <input type="checkbox" role="switch" checked={!!c.on} disabled={!here || busy || (!c.on && (needsPassword || !c.can))} onChange={(e) => set(e.target.checked)} />
                <span>
                  <b>{t('Let my other devices control this computer')}</b><br />
                  <small className="muted">{t('Their mouse and keyboard work here while they view this screen.')}</small>
                </span>
              </label>
              {needsPassword && <p className="muted small rs-needs"><Icon name="lock" size={12} /> {t('Set a Remote Access Password first: control needs one.')}</p>}
              {!here && <p className="muted small">{t('Control is turned on and off at {name} itself.', { name })}</p>}
              {here && !needsPassword && !c.can && c.why && <p className="muted small"><Icon name="info" size={12} /> {c.why}</p>}
              {here && c.on && c.asks === 'accessibility' && c.allowed === false && (
                <div className="st-row between">
                  <p className="small">{t("macOS doesn't let Bridge AI control this Mac yet: turn on Bridge AI in System Settings › Privacy & Security › Accessibility.")}</p>
                  {desktop() && <button type="button" className="btn small" onClick={allowAx}>{t('Open Accessibility')}</button>}
                </div>
              )}
              {err && <p className="error-text small">{err}</p>}
            </div>
          </div>
          <More>
            <p className="muted small">{t('Asked before any of your devices sees this screen, from a computer or a phone, and checked here. {n} wrong tries lock that device out for {m} minutes. It\'s kept on this computer only, scrambled, and never sent anywhere.', { n: ac.limits?.tries || ACCESS.tries, m: ac.limits?.lockMinutes || ACCESS.lockMinutes })}</p>
            <p className="muted small">{t('It guards seeing and controlling this computer\'s screen, and the apps its agents serve. Which Devices May Connect, below, decides which of your devices may use this computer at all.')}</p>
            <p className="muted small">{t('Their mouse and keyboard work on this screen while they view it, and the clipboard goes both ways. Anyone here moving the mouse or pressing a key pauses them for a moment, and after {n} minutes without input they\'re back to view-only.', { n: ac.limits?.idleMinutes || ACCESS.idleMinutes })}</p>
          </More>
        </div>

        <div className="rs-block" data-setting="remote-ask-first">
          <label className="st-check">
            <input type="checkbox" role="switch" checked={!!ac.askFirst} disabled={!here} onChange={(e) => access('/ask-first', { on: e.target.checked })} />
            <span>
              <b>{t('Ask Here First')}</b><br />
              <small className="muted">{t('Allow or Deny shows here for each of your devices that wants to see this screen. No answer in {n} seconds is a no.', { n: ac.limits?.askSeconds || ACCESS.askSeconds })}</small>
            </span>
          </label>
          {!here && elsewhere}
        </div>

        <div className="rs-block" data-setting="remote-devices">
          <b>{t('Which Devices May Connect')}</b>
          <p className="muted small">{t('A device you untick can\'t use this computer at all.')}</p>
          {!here ? null : ac.devices?.length
            ? (
              <ul className="rs-devices">
                {ac.devices.map((d) => (
                  <li key={d.id}>
                    <label className="st-check">
                      <input type="checkbox" checked={d.allowed} disabled={!here} onChange={(e) => access('/devices', { id: d.id, allowed: e.target.checked })} />
                      <span><Icon name={d.kind === 'computer' ? 'laptop' : 'phone'} size={12} /> {deviceName(d)} <span className="muted">{d.kind === 'computer' ? t('computer') : t('phone')}</span>{d.fresh && !d.allowed && <span className="st-chip rs-new">{t('New')}</span>}</span>
                    </label>
                    {d.locked && <span className="rs-locked small"><Icon name="lock" size={11} /> {t('Locked out until {time}', { time: clockOf(d.locked) })}</span>}
                    {d.out && <SameToo d={d} all={ac.devices} keep={(id) => access('/devices', { id, allowed: false })} />}
                    <Older d={d} />
                    {d.locked && here && <button type="button" className="ghost-btn small" onClick={() => access(`/locks/${encodeURIComponent(d.id)}/clear`)}>{t('Unlock')}</button>}
                  </li>
                ))}
              </ul>
            )
            : <p className="muted small">{t('No phone or computer is paired with this one yet.')}</p>}
          {(ac.locks || []).filter((l) => !ac.devices?.some((d) => d.id === l.id)).map((l) => (
            <p key={l.id} className="small rs-locked"><Icon name="lock" size={11} /> {t('{name} is locked out until {time}', { name: whoOf({ by: { name: l.name }, for: l.for }), time: clockOf(l.until) })} {here && <button type="button" className="ghost-btn small" onClick={() => access(`/locks/${encodeURIComponent(l.id)}/clear`)}>{t('Unlock')}</button>}</p>
          ))}
          {!here && elsewhere}
          <More>
            <p className="muted small">{t('Every phone paired with this computer and every computer linked to it, unless you untick it. One unticked can\'t use this computer at all, with Remote Screen and Preview on or off: no agents, terminals, files, previews or screen, and what it has open here ends.')}</p>
            {here && <p className="muted small">{t('A device of another of your computers comes through that computer, which checks its own list first; once it has, it\'s listed here too, as coming through it, to untick here. So the same phone can be here more than once: paired here, and through each of your other computers it\'s paired with. It\'s known as the same device only if it paired with both using the same key, which a phone\'s browser and the Android app don\'t: untick it each way it comes.')}</p>}
            {here && <p className="muted small">{t('Once you set a password or Ask Here First, or untick a device, a phone or computer paired after that, or first seen through another of your computers, starts New, and waits in Needs You while Remote Screen and Preview is on: tick it here, or Allow it there, to let it in.')}</p>}
          </More>
        </div>
        <Notify nt={data.notify} here={here} name={name} set={(on) => access('/notify', { on })} />
        {aErr && <p className="error-text small" role="alert">{aErr}</p>}
      </section>

      <section className="st-sec" data-setting="remote-sessions">
        <h4>{t('Screen Activity')}</h4>
        <p className="muted small">{t('Who connected to this computer, from which device, when, for how long and whether they used control; and each one turned away, and why. Kept on this computer only, the last 200.')}</p>
        {here ? <Sessions log={data.log} here={here} /> : <p className="muted small">{t('Kept at {name} itself: see it there.', { name })}</p>}
      </section>
    </>
  )
}
