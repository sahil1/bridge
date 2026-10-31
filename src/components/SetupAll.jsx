import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import PermissionFix from './PermissionFix.jsx'
import LiveShell from './LiveShell.jsx'
import { viaRelay } from '../api.js'
import { useSetupPlan } from '../setupPlan.js'
import { t, tx, locale } from '../i18n/index.js'

export { useSetupPlan }

// Everything Bridge AI uses, set up at once (server: /api/setup/plan and /api/setup/run): what's
// left on this computer, each with whether it's ready, going, or yours to allow. In setup (the first
// step) and in Settings › General, so "Later" is never lost.
const ITEMS = {
  node: [tx('Node.js'), tx('So any coding agent installs in one click.')],
  devtools: [tx('Developer tools'), tx('Apple\'s command line tools, so git works for your agents and the Chief of Staff without macOS stopping to ask. About 1 GB from Apple, so it takes a while.')],
  homebrew: [tx('Homebrew'), tx('Brings the programs below. It asks for your password once, in a terminal tab.')],
  meetings: [tx('Meeting notes'), tx('A speech model, so meetings are transcribed on this computer.')],
  voice: [tx('Voice notes'), tx('The speech model, so what you say becomes text here.')],
  calendar: [tx('Your calendar'), tx('icalBuddy reads macOS Calendar, then Bridge AI asks to see it.')],
  mail: [tx('Mail'), tx("Full Disk Access, to read Mail's own index for the Inbox. Nothing leaves your Mac.")],
}
// The calendar through Bridge AI's own helper: nothing to install, only your yes.
const CALENDAR_OWN = tx('Bridge AI asks macOS to see your calendars. Your events stay on this Mac.')
// What an item still needs, by name (the programs keep theirs).
const PART = { whisper: 'whisper.cpp', 'whisper-cli': 'whisper.cpp', model: tx('the speech model') }
const listOf = (names) => new Intl.ListFormat(locale(), { type: 'conjunction' }).format([...new Set(names)])
const name = (id) => t(ITEMS[id]?.[0] || id)
const about = (i) => t(i.id === 'calendar' && !i.via ? CALENDAR_OWN : ITEMS[i.id]?.[1] || '')
// "Already set up, so left as it is": the items set up before this list first showed.
export const alreadyLine = (ids) => (ids.length ? t('Already set up, so left as it is: {list}', { list: listOf(ids.map(name)) }) : null)
const WHY = { calendars: tx('Bridge AI needs your permission to read Calendar. Your events stay on this Mac.'), 'full-disk': tx("Bridge AI needs Full Disk Access to read Mail's local index. Nothing leaves your Mac.") }

function stateOf(i) {
  if (i.state === 'done') return <span className="sa-st ok"><Icon name="check" size={12} /> {t('Ready')}</span>
  if (i.state === 'running') return <span className="sa-st"><span className="aa-spin" /> {i.downloading ? t('Downloading {n}%', { n: i.downloading.percent || 0 }) : i.after === 'node' ? t('Next, after Node.js') : t('Installing…')}</span>
  if (i.state === 'failed') return <span className="sa-st bad">{t("Didn't work")}</span>
  if (i.state === 'restart') return <span className="sa-st">{t('Restart to apply')}</span>
  if (i.state === 'allow') return <span className="sa-st">{t('Yours to allow')}</span>
  return <span className="sa-st muted">{i.canRun === false ? t('Install it yourself') : t('Not set up')}</span>
}

// What the Set up Bridge AI tab is waiting for you to do, said where you are: your Mac's password
// (typed right here, into that tab's terminal, so setup's dialog or Settings needn't be closed for
// it), a key, or macOS's own window for the developer tools. onOpen: show the tab itself.
export function NeedsYou({ plan, onOpen }) {
  const what = plan?.needsYou
  if (!what) return null
  const here = !viaRelay && !!plan.paneId && what !== 'window'
  const say = {
    password: here ? t('Your Mac\'s password, once. Type it below and press Return; the rest carries on by itself.') : t('Your Mac\'s password, once, in the Set up Bridge AI tab on your computer.'),
    terminal: here ? t('The Set up Bridge AI tab is waiting for you, below.') : t('The Set up Bridge AI tab is waiting for you.'),
    window: t('Click Install in the window macOS opened for the developer tools. Closed it? Close the Set up Bridge AI tab, then try again.'),
  }[what]
  return (
    <div className="sa-you" role="status">
      <p className="sa-you-say"><span className="sa-you-dot" aria-hidden="true" /><b>{t('Needs you')}</b> <span>{say}</span>
        {onOpen && plan.openId && <button type="button" className="link-btn small" onClick={() => onOpen(plan.openId)}>{t('Show it')}</button>}
      </p>
      {here && <div className="sa-term"><LiveShell key={plan.paneId} paneId={plan.paneId} /></div>}
    </div>
  )
}

// The list. onOpen: show a terminal tab (the developer tools and Homebrew install there). only:
// 'basic', just what agents need. onRetry: Try again, once nothing's going and something didn't
// work or isn't set up (setup has it; Settings has its own button for what's left).
export function SetupList({ plan, onOpen, reload, only = null, onRetry = null }) {
  const [open, setOpen] = useState(null) // the item whose Allow is open
  // Set up before the list first showed: named once below it, not listed (so nothing you have is
  // offered again). Whatever gets set up while it shows stays, as Ready.
  const [had, setHad] = useState(null)
  useEffect(() => { if (plan && !had) setHad(plan.items.filter((i) => i.state === 'done').map((i) => i.id)) }, [plan, had])
  if (!plan || !had) return <div className="skeleton-rows"><div /><div /></div>
  const mine = plan.items.filter((i) => !only || i.basic)
  const items = mine.filter((i) => !had.includes(i.id))
  const kept = mine.filter((i) => had.includes(i.id)).map((i) => i.id)
  const again = onRetry && !plan.running && items.some((i) => ['todo', 'failed'].includes(i.state) && i.canRun !== false)
  // Part of it here already (ffmpeg, say): what it adds.
  const adds = (i) => (i.state !== 'done' && i.parts && i.needs?.length && i.needs.length < i.parts.length ? t('Adds only {list}. The rest is already here.', { list: listOf(i.needs.map((n) => t(PART[n] || n))) }) : null)
  return (
    <>
      {!only && <NeedsYou plan={plan} onOpen={onOpen} />}
      {items.length > 0
        ? <ul className="sa-list">
        {items.map((i) => (
          <li key={i.id} className={`sa-item ${i.state}`} data-id={i.id}>
            <span className="sa-main"><b>{name(i.id)}</b><small>{about(i)}</small>
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
      {plan.openId && plan.running && !plan.needsYou && (
        <p className="muted small sa-note"><Icon name="terminal" size={12} /> {t('The programs install in the Set up Bridge AI tab.')}
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
