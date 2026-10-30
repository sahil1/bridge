import { useCallback, useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import PermissionFix from './PermissionFix.jsx'
import { api } from '../api.js'
import { t, tx, locale } from '../i18n/index.js'

// Everything Bridge AI uses, set up at once (server: /api/setup/plan and /api/setup/run): what's
// left on this computer, each with whether it's ready, going, or yours to allow. In setup (the first
// step) and in Settings › General, so "Later" is never lost.
const ITEMS = {
  node: [tx('Node.js'), tx('So any coding agent installs in one click.')],
  homebrew: [tx('Homebrew'), tx('Brings the programs below. It asks for your password once, in a terminal tab.')],
  meetings: [tx('Meeting notes'), tx('whisper.cpp and a speech model, so meetings are transcribed on this computer.')],
  voice: [tx('Voice notes'), tx('ffmpeg and whisper.cpp, so what you say becomes text here.')],
  calendar: [tx('Your calendar'), tx('icalBuddy reads macOS Calendar, then Bridge AI asks to see it.')],
  mail: [tx('Mail'), tx("Full Disk Access, to read Mail's own index for the Inbox. Nothing leaves your Mac.")],
}
// What an item still needs, by name (the programs keep theirs).
const PART = { whisper: 'whisper.cpp', 'whisper-cli': 'whisper.cpp', ffmpeg: 'ffmpeg', model: tx('the speech model') }
const listOf = (names) => new Intl.ListFormat(locale(), { type: 'conjunction' }).format([...new Set(names)])
const name = (id) => t(ITEMS[id]?.[0] || id)
// "Already set up, so left as it is": the items set up before this list first showed.
export const alreadyLine = (ids) => (ids.length ? t('Already set up, so left as it is: {list}', { list: listOf(ids.map(name)) }) : null)
const WHY = { calendars: tx('Bridge AI needs your permission to read Calendar. Your events stay on this Mac.'), 'full-disk': tx("Bridge AI needs Full Disk Access to read Mail's local index. Nothing leaves your Mac.") }

// The plan, looked at again every 2 seconds while something is going, else every 15.
export function useSetupPlan(on = true) {
  const [plan, setPlan] = useState(null)
  const load = useCallback(() => api('/setup/plan').then(setPlan).catch(() => {}), [])
  useEffect(() => {
    if (!on) return
    load()
    const id = setInterval(() => { if (!document.hidden) load() }, plan?.running ? 2000 : 15000)
    return () => clearInterval(id)
  }, [on, load, plan?.running])
  const run = async (level) => { const p = await api('/setup/run', { method: 'POST', body: { level } }); setPlan(p); return p }
  return { plan, load, run }
}

export const readyCount = (plan) => (plan?.items || []).filter((i) => i.state === 'done').length

function stateOf(i) {
  if (i.state === 'done') return <span className="sa-st ok"><Icon name="check" size={12} /> {t('Ready')}</span>
  if (i.state === 'running') return <span className="sa-st"><span className="aa-spin" /> {i.downloading ? t('Downloading {n}%', { n: i.downloading.percent || 0 }) : t('Installing…')}</span>
  if (i.state === 'failed') return <span className="sa-st bad">{t("Didn't work")}</span>
  if (i.state === 'restart') return <span className="sa-st">{t('Restart to apply')}</span>
  if (i.state === 'allow') return <span className="sa-st">{t('Yours to allow')}</span>
  return <span className="sa-st muted">{i.canRun === false ? t('Install it yourself') : t('Not set up')}</span>
}

// The list. onOpen: show a terminal tab (Homebrew asks for your password there). only: 'basic',
// just what agents need. onRetry: Try again, once nothing's going and something didn't work or
// isn't set up (setup has it; Settings has its own button for what's left).
export function SetupList({ plan, onOpen, reload, only = null, onRetry = null }) {
  const [open, setOpen] = useState(null) // the item whose Allow is open
  // Set up before the list first showed: named once below it, not listed (so nothing you have is
  // offered again). Whatever gets set up while it shows stays, as Ready.
  const [had, setHad] = useState(null)
  useEffect(() => { if (plan && !had) setHad(plan.items.filter((i) => i.state === 'done').map((i) => i.id)) }, [plan, had])
  if (!plan || !had) return <div className="skeleton-rows"><div /><div /></div>
  const brewing = plan.items.some((i) => i.id === 'homebrew' && i.state === 'running')
  const mine = plan.items.filter((i) => !only || i.basic)
  const items = mine.filter((i) => !had.includes(i.id))
  const kept = mine.filter((i) => had.includes(i.id)).map((i) => i.id)
  const again = onRetry && !plan.running && items.some((i) => ['todo', 'failed'].includes(i.state) && i.canRun !== false)
  // Part of it here already (ffmpeg, say): what it adds.
  const adds = (i) => (i.state !== 'done' && i.parts && i.needs?.length && i.needs.length < i.parts.length ? t('Adds only {list}. The rest is already here.', { list: listOf(i.needs.map((n) => t(PART[n] || n))) }) : null)
  return (
    <>
      {items.length > 0
        ? <ul className="sa-list">
        {items.map((i) => (
          <li key={i.id} className={`sa-item ${i.state}`}>
            <span className="sa-main"><b>{name(i.id)}</b><small>{t(ITEMS[i.id]?.[1] || '')}</small>
              {adds(i) && <small>{adds(i)}</small>}
              {i.state === 'failed' && i.error && <small className="error-text">{i.error}</small>}
            </span>
            {stateOf(i)}
            {i.state === 'allow' && <button type="button" className="btn small" aria-expanded={open === i.id} onClick={() => setOpen(open === i.id ? null : i.id)}>{t('Allow')}</button>}
            {open === i.id && i.state === 'allow' && <div className="sa-fix"><PermissionFix pane={i.pane} onCheck={() => { setOpen(null); reload?.() }}><p>{t(WHY[i.pane])}</p></PermissionFix></div>}
          </li>
        ))}
        </ul>
        : !only && <p className="sa-all"><Icon name="check" size={13} /> {t('Everything Bridge AI uses is already set up here.')}</p>}
      {items.length > 0 && kept.length > 0 && <p className="muted small sa-kept">{alreadyLine(kept)}</p>}
      {!items.length && only && <p className="muted small sa-kept">{alreadyLine(kept)}</p>}
      {plan.openId && plan.running && (
        <p className="muted small sa-note"><Icon name="terminal" size={12} /> {brewing ? t('Homebrew asks for your password in the Set up Bridge AI tab.') : t('The programs install in the Set up Bridge AI tab.')}
          {onOpen && <button type="button" className="link-btn small" onClick={() => onOpen(plan.openId)}>{t('Show it')}</button>}
        </p>
      )}
      {again && <div className="sa-again"><button type="button" className="btn small" onClick={onRetry}>{t('Try again')}</button></div>}
    </>
  )
}

// Settings › General: the same list, and one button for what's left.
export default function SetupAll({ onOpen }) {
  const { plan, load, run } = useSetupPlan()
  const [err, setErr] = useState(null)
  const left = (plan?.items || []).filter((i) => ['todo', 'failed'].includes(i.state) && i.canRun !== false)
  const go = async () => { setErr(null); try { await run('full') } catch (e) { setErr(e.message) } }
  return (
    <section className="st-sec" id="st-setup">
      <h4>{t('Set up')}</h4>
      <p className="muted small">{t('What Bridge AI uses besides your agents. Set up everything that\'s left in one go, and allow what macOS asks about here.')}</p>
      <SetupList plan={plan} onOpen={onOpen} reload={load} />
      {left.length > 0 && <div><button type="button" className="btn small primary" disabled={plan?.running} onClick={go}>{plan?.running ? t('Setting up…') : t('Set up everything that\'s left')}</button></div>}
      {err && <p className="error-text small">{err}</p>}
    </section>
  )
}
