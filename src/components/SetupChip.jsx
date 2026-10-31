import { useEffect, useState } from 'react'
import Icon, { StatusDot } from './Icon.jsx'
import { openSettings } from './SignIn.jsx'
import { api } from '../api.js'
import { useSetupPlan, publish, runProgress } from '../setupPlan.js'
import { t } from '../i18n/index.js'

// The top bar's "Setting up · 3 of 6": setup's Everything (or Settings › General's Set up) carries
// on in the background once its window is closed, and this says how far it is, quietly, until it's
// all done. When something needs you (your Mac's password in the Set up Bridge AI tab, or what's
// left to allow or try again once nothing's going), it says so, and one click goes there: the tab
// for the password, else Settings › General's Set up list. What's left once nothing's going stops
// showing once you've been to the list; it's all still there. line: on a phone, a line under the top
// bar (TopNotes.jsx) instead of a chip in it.
const SEEN = 'cc-setup-seen'
const remembered = () => { try { return localStorage.getItem(SEEN) } catch { return null } }

export default function SetupChip({ line = false }) {
  const [looked, setLooked] = useState(false)
  const [seen, setSeen] = useState(remembered)
  // Asked once when the app opens (a run may be going from before a reload; without one the server
  // says so at once), then only during one.
  useEffect(() => { api('/setup/plan?ifRun=1').then((p) => { if (p?.run) publish(p) }).catch(() => {}).finally(() => setLooked(true)) }, [])
  const [on, setOn] = useState(false) // looked at again while it shows
  const { plan: now } = useSetupPlan(on)
  const { total, ready, left } = runProgress(now)
  const going = !!now?.running
  const you = now?.needsYou || null
  // What's left once nothing's going, as a key: something new in it (another try, a new failure)
  // shows it again; less of it (you allowed one) doesn't.
  const leftKey = !going && left.length ? `${now.run.at}:${left.map((i) => `${i.id}=${i.state}`).join(',')}` : null
  const seenAll = (key) => { const [at, list = ''] = String(seen || '').split(':'); const was = list.split(','); return key.startsWith(`${at}:`) && key.slice(at.length + 1).split(',').every((x) => was.includes(x)) }
  const show = looked && total > 0 && (going || you || (leftKey && !seenAll(leftKey)))
  useEffect(() => { setOn(!!show) }, [show])
  if (!show) return null
  const needs = !!you || !going
  const open = () => {
    if ((you === 'password' || you === 'terminal') && now.openId) {
      window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: now.openId } }))
      return
    }
    if (leftKey) { try { localStorage.setItem(SEEN, leftKey) } catch { /* no storage */ } setSeen(leftKey) }
    openSettings('general')
  }
  const label = needs ? t('Setup needs you · {n} of {total}', { n: ready, total }) : t('Setting up · {n} of {total}', { n: ready, total })
  const title = you === 'password' ? t('Setup is waiting for your Mac\'s password, in the Set up Bridge AI tab.')
    : you === 'window' ? t('Click Install in the window macOS opened for the developer tools.')
      : you ? t('The Set up Bridge AI tab is waiting for you.')
        : needs ? t('Some of setup is left for you: see Settings › General.')
          : t('Bridge AI is setting up what it uses, in the background. Settings › General shows each part.')
  return (
    <button type="button" className={`${line ? 'top-note' : 'top-chip'} setup-chip${needs ? ' you' : ''}`} onClick={open} title={title} aria-label={label}>
      {needs ? <StatusDot status="blocked" size={8} /> : <span className="aa-spin" aria-hidden="true" />}
      <span className="setup-chip-word">{label}</span>
      {line && <Icon name="chevron" size={13} className="top-note-go" />}
    </button>
  )
}
