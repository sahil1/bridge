import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { api, refetch } from '../api.js'

// The account switcher, like a model picker: Auto, then each agent's accounts with how much of
// its usage window is left. In the top bar a pick is the account new agents of that kind start
// with; in the New agent dialog it's the one this agent starts with. Groups come from the server
// (accounts.js groups(): { kind, setting, pick, accounts }).

export const KIND_NAMES = { claude: 'Claude', codex: 'Codex' }
const kindName = (k) => KIND_NAMES[k] || k

// More than one account for some agent: only then is there anything to switch.
export const several = (groups) => (groups || []).some((g) => g.accounts.length > 1)
// Agents to list: those with several accounts, those whose one login has a reading, and `also`
// (the top bar's agent), so its account and Add another account show before there's a second.
export const listed = (groups, also) => (groups || []).filter((g) => g.accounts.length > 1 || g.accounts[0]?.usable || g.kind === also)

// What's left: the tighter of the 5-hour and weekly windows (quota-axi's figure, which Auto
// compares), and which window that is.
export function leftOf(a) {
  if (!a?.usable || a.percentRemaining == null) return null
  const tight = (a.windows || []).filter((w) => (w.kind === 'session' || w.kind === 'weekly') && w.percentRemaining != null)
    .sort((x, y) => x.percentRemaining - y.percentRemaining)[0]
  return { pct: a.percentRemaining, win: tight?.kind === 'weekly' ? 'wk' : '5h' }
}
export const level = (v) => (v == null ? 'unknown' : v < 10 ? 'critical' : v < 30 ? 'warning' : 'good')
// off: plan usage is off, so there's no reading to wait for.
export function statusText(a, off) {
  if (a.allow) return 'needs Allow'
  if (a.signedIn === false) return 'not signed in'
  // No usage to show (plan usage off, or not read yet): whether it's signed in, when known.
  if (off || (a.status === 'pending' && a.signedIn)) return a.signedIn ? 'signed in' : ''
  return a.status === 'pending' ? 'checking…' : a.status === 'error' ? "couldn't read" : 'no data'
}
// Each window in words, for a tooltip.
const windowsText = (a) => (a.windows || []).filter((w) => w.kind === 'session' || w.kind === 'weekly')
  .map((w) => `${w.percentRemaining}% of the ${w.kind === 'session' ? '5-hour window' : 'week'} left`).join(', ')

function Left({ a, off }) {
  const l = leftOf(a)
  if (!l) return <span className="acct-left muted">{statusText(a, off)}</span>
  const lv = level(l.pct)
  return (
    <span className="acct-left">
      <span className="u-bar"><span className={`u-fill f-${lv}`} style={{ width: `${Math.max(3, l.pct)}%` }} /></span>
      <b className={`t-${lv}`}>{l.pct}%</b><small>{l.win}</small>
    </span>
  )
}

// "Now: Work", or for several agents "Now: Claude on Work, Codex on Default".
function nowText(groups) {
  const multi = groups.filter((g) => g.accounts.length > 1)
  const name = (g) => g.accounts.find((a) => a.id === g.pick)?.label || 'Default'
  if (multi.length === 1) return `Now: ${name(multi[0])}`
  return `Now: ${multi.map((g) => `${kindName(g.kind)} on ${name(g)}`).join(', ')}`
}

// groups: the agents to list. value (dialog only): 'auto' or an account id; without it, a pick
// changes the default. onPick(kind, id) may return a promise (kind null: Auto for every agent).
// anchor: the element holding the button that opened it (clicks there don't count as outside).
// onAdd(kind): Add another account (kind: the menu's one agent, if it lists one). off: plan usage is off.
export default function AccountMenu({ groups, value, onPick, onAdd, extra = [], onClose, anchor, off, className = '' }) {
  const ref = useRef(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const dialog = value !== undefined
  const items = () => [...(ref.current?.querySelectorAll('[data-item]') || [])]
  const back = () => anchor?.current?.querySelector('[aria-haspopup]')?.focus()
  useEffect(() => {
    ;(ref.current?.querySelector('[data-item][aria-checked="true"]') || items()[0])?.focus()
    const down = (e) => { if (!ref.current?.contains(e.target) && !anchor?.current?.contains(e.target)) onClose() }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e) => {
    const list = items()
    const i = list.indexOf(document.activeElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus()
    } else if (e.key === 'Escape') {
      // Only the menu: not the dialog it's in, nor the maximized panel behind it.
      e.preventDefault(); e.stopPropagation()
      onClose(); back()
    } else if (e.key === 'Tab') onClose()
  }
  const pick = async (kind, id) => {
    setBusy(true); setErr(null)
    try { await onPick(kind, id); onClose(); back() } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  const run = (fn) => { onClose(); fn() }

  const multi = groups.filter((g) => g.accounts.length > 1)
  const autoOn = dialog ? value === 'auto' : multi.length > 0 && multi.every((g) => g.setting === 'auto')
  return (
    <div className={`acct-pop ${className}`} ref={ref} role="menu" aria-label="Accounts" onKeyDown={onKeyDown} aria-busy={busy}>
      {multi.length > 0 && (
        <button type="button" data-item role="menuitemradio" aria-checked={autoOn} className="acct-item auto" onClick={() => pick(null, 'auto')} disabled={busy}>
          <span className="acct-check">{autoOn && <Icon name="check" size={13} />}</span>
          <span className="acct-main">
            <span className="acct-name">Auto</span>
            <span className="acct-desc">{dialog ? 'Starts on the account with the most left' : 'New agents start on the account with the most left'}. {nowText(multi)}</span>
          </span>
        </button>
      )}
      {groups.map((g) => (
        <div key={g.kind} role="group" aria-label={kindName(g.kind)}>
          <div className="acct-sec" aria-hidden="true">{kindName(g.kind)}</div>
          {g.accounts.map((a) => {
            const on = dialog ? value === a.id : g.setting === a.id
            // Who Auto would start with right now.
            const auto = (dialog ? value === 'auto' : g.setting === 'auto') && g.pick === a.id && g.accounts.length > 1
            return (
              <button type="button" key={a.id} data-item role="menuitemradio" aria-checked={on} className="acct-item" onClick={() => pick(g.kind, a.id)} disabled={busy}
                title={[windowsText(a), a.signedIn === false && 'Not signed in yet (Settings › Model providers › Accounts)'].filter(Boolean).join('\n') || undefined}>
                <span className="acct-check">{on && <Icon name="check" size={13} />}</span>
                <span className="acct-main">
                  <span className="acct-name">{a.label}{a.plan && <span className="plan-tag">{a.plan}</span>}{auto && <span className="best-tag">auto</span>}</span>
                  {a.isDefault && g.accounts.length === 1 && <span className="acct-desc">Your usual login</span>}
                </span>
                <Left a={a} off={off} />
              </button>
            )
          })}
        </div>
      ))}
      {err && <p className="error-text small acct-err" role="alert">{err}</p>}
      <div className="acct-sep" role="separator" />
      {onAdd && (
        <button type="button" data-item role="menuitem" className="acct-item plain" onClick={() => run(() => onAdd(groups.length === 1 ? groups[0].kind : undefined))}>
          <span className="acct-check"><Icon name="plus" size={13} /></span>
          <span className="acct-main">
            <span className="acct-name">Add another account…</span>
            <span className="acct-desc">A work and a personal {groups.length === 1 ? kindName(groups[0].kind) : 'Claude'}, side by side</span>
          </span>
        </button>
      )}
      {extra.map((x) => (
        <button type="button" key={x.label} data-item role="menuitem" className="acct-item plain" onClick={() => run(x.run)}>
          <span className="acct-check"><Icon name={x.icon} size={13} /></span><span className="acct-main"><span className="acct-name">{x.label}</span></span>
        </button>
      ))}
    </div>
  )
}

// The top bar's choice: the account new agents of a kind start with, or Auto for each agent that
// has several. Every view of /quota then shows the change.
export async function setDefault(groups, kind, id) {
  const kinds = kind ? [kind] : groups.filter((g) => g.accounts.length > 1).map((g) => g.kind)
  await Promise.all(kinds.map((k) => api(`/accounts/active/${k}`, { method: 'POST', body: { id } })))
  refetch('/quota')
}

// The New agent dialog's control: a button showing the choice, opening the menu for that agent.
export function AccountPicker({ group, value, onChange, onAdd, off }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const cur = value === 'auto' ? group.accounts.find((a) => a.id === group.pick) : group.accounts.find((a) => a.id === value)
  const l = leftOf(cur)
  return (
    <div className="acct-wrap acct-field" ref={wrap}>
      <button type="button" className="acct-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}>
        <span className="acct-btn-main">
          {value === 'auto' ? <><b>Auto</b><span className="muted"> · {cur?.label || 'Default'}</span></> : <b>{cur?.label || 'Default'}</b>}
          {cur?.plan && <span className="plan-tag">{cur.plan}</span>}
        </span>
        {l ? <span className={`acct-btn-left t-${level(l.pct)}`}>{l.pct}% <small className="muted">{l.win}</small></span> : cur && <span className="muted small">{statusText(cur, off)}</span>}
        <Icon name="down" size={12} className="muted" />
      </button>
      {open && <AccountMenu groups={[group]} value={value} anchor={wrap} className="in-field" off={off} onClose={() => setOpen(false)} onPick={(k, id) => onChange(id)} onAdd={onAdd} />}
    </div>
  )
}

// macOS keeps a second Claude account's login in its own Keychain item and asks once before
// anything else can read it. Allow runs quota-axi for that account with permission to ask.
export function AllowKeychain({ id, onDone }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const allow = async () => {
    setBusy(true); setErr(null)
    try { await api(`/quota/allow/${encodeURIComponent(id)}`, { method: 'POST' }); refetch('/quota'); onDone?.() } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="allow-kc">
      <span className="small">macOS asks once before Bridge AI can read this account's usage: click Allow, then choose <b>Always Allow</b> in the window on this computer.</span>
      <button type="button" className="btn small" onClick={allow} disabled={busy}>{busy ? 'Waiting for macOS…' : 'Allow'}</button>
      {err && <span className="error-text small">{err}</span>}
    </div>
  )
}
