import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { api, refetch, viaRelay, useFleet } from '../api.js'
import { t, locale } from '../i18n/index.js'

// The account switcher, like a model picker: Auto, then each agent's accounts with how much of
// its usage window is left. In the top bar a pick is the account new agents of that kind start
// with; in the New agent dialog it's the one this agent starts with. (A conversation moves to
// another account from its own message box: ModelChip.jsx.) Groups come from the server
// (accounts.js groups(): { kind, setting, pick, accounts }).

export const KIND_NAMES = { claude: 'Claude', codex: 'Codex' }
const kindName = (k) => KIND_NAMES[k] || k
const AGENT_NAMES = { claude: 'Claude Code', codex: 'Codex' }
const agentName = (k) => AGENT_NAMES[k] || k

// An email with most of its name hidden, as Usage shows it (a shared screen shows little of it).
export const maskEmail = (e) => { const [u, d] = String(e).split('@'); return d ? `${u.slice(0, 2)}•••@${d}` : String(e) }
// An account's name as shown: the one you gave it, or for your usual login unnamed, who it's signed
// in as (its email, mostly hidden), else "Your usual login" in your language (the server's label
// is the English).
export const nameOf = (a) => (!a ? '' : a.isDefault && a.named === false ? (a.account?.email ? maskEmail(a.account.email) : t('Your usual login')) : a.label)
// The name in a row, cut short with … when it's long, with its plan beside it whole.
export const AcctName = ({ a, children }) => (
  <span className="acct-name" title={nameOf(a)}><span className="acct-nm">{nameOf(a)}</span>{a.plan && <span className="plan-tag">{a.plan}</span>}{children}</span>
)
// An agent whose accounts are listed one by one: more than one, or one that isn't your usual login
// (you took that off the list). Otherwise its one login is just the agent's, as for any other.
export const asList = (g) => !!g && (g.accounts.length > 1 || !!g.usualHidden || !g.accounts.some((a) => a.isDefault))
// Some agent's accounts are listed one by one.
export const several = (groups) => (groups || []).some(asList)
// Agents to list: those with their accounts listed, those whose one login has a reading, and `also`
// (the top bar's agent), so its account and Add another account show before there's a second.
export const listed = (groups, also) => (groups || []).filter((g) => asList(g) || g.accounts[0]?.usable || g.kind === also)

// What's left: the tighter of the 5-hour and weekly windows (quota-axi's figure, which Auto
// compares), and which window that is.
export function leftOf(a) {
  if (!a?.usable || a.percentRemaining == null) return null
  const tight = (a.windows || []).filter((w) => (w.kind === 'session' || w.kind === 'weekly') && w.percentRemaining != null)
    .sort((x, y) => x.percentRemaining - y.percentRemaining)[0]
  return { pct: a.percentRemaining, win: tight?.kind === 'weekly' ? 'wk' : '5h' }
}
export const level = (v) => (v == null ? 'unknown' : v < 10 ? 'critical' : v < 30 ? 'warning' : 'good')
// Its saved sign-in ran out (quota-axi: "Claude access token expired"): its usage can't be read
// until it signs in again, or the agent runs on it and renews it. The same test as accounts.js.
export const lapsed = (a) => !a.usable && /access token expired|credentials_expired|sign-in required|reauth/i.test(a.error || '')
// off: plan usage is off, so there's no reading to wait for. inUse: an agent runs on it, which
// keeps working on a sign-in whose saved copy ran out; only its usage can't be read.
export function statusText(a, off, inUse) {
  if (a.allow) return t('needs Allow')
  if (a.signedIn === false) return t('not signed in')
  if (lapsed(a)) return inUse ? t('in use') : t('sign-in expired')
  // No usage to show (plan usage off, or not read yet): whether it's signed in, when known.
  if (off || (a.status === 'pending' && a.signedIn)) return a.signedIn ? t('signed in') : ''
  return a.status === 'pending' ? t('checking…') : a.status === 'error' ? t("couldn't read") : t('no data')
}
// Each window in words, for a tooltip.
const windowsText = (a) => (a.windows || []).filter((w) => w.kind === 'session' || w.kind === 'weekly')
  .map((w) => (w.kind === 'session' ? t('{pct}% of the 5-hour window left', { pct: String(w.percentRemaining) }) : t('{pct}% of the week left', { pct: String(w.percentRemaining) }))).join(', ')

// Both windows (the 5-hour one is often the one that stops you), the bar for the tighter.
export function Left({ a, off, inUse }) {
  const ws = windowsOf(a)
  if (!ws.length) return <span className="acct-left muted">{statusText(a, off, inUse)}</span>
  const tight = ws.reduce((m, w) => (w.pct < m.pct ? w : m))
  return (
    <span className="acct-left" title={windowsText(a)}>
      <span className="u-bar"><span className={`u-fill f-${level(tight.pct)}`} style={{ width: `${Math.max(3, tight.pct)}%` }} /></span>
      {ws.map((w) => <span key={w.win} className="acct-win"><b className={`t-${level(w.pct)}`}>{w.pct}%</b><small>{w.win}</small></span>)}
    </span>
  )
}
// Each window with a reading, the 5-hour one first: { win: '5h' | 'wk', pct, resetsAt }.
export function windowsOf(a) {
  if (!a?.usable) return []
  return [['session', '5h'], ['weekly', 'wk']].map(([kind, win]) => {
    const w = (a.windows || []).find((x) => x.kind === kind && x.percentRemaining != null)
    return w && { win, pct: w.percentRemaining, resetsAt: w.resetsAt || null }
  }).filter(Boolean)
}
// When its week starts again: "Week resets Sat 2:00 PM", or in hours when that's soon.
export function weekResets(a) {
  const w = windowsOf(a).find((x) => x.win === 'wk')
  const h = w?.resetsAt ? (new Date(w.resetsAt) - Date.now()) / 3600e3 : NaN
  if (!(h > 0)) return null
  return h < 1 ? t('Week resets in {n} min', { n: Math.max(1, Math.round(h * 60)) }) : h < 20 ? t('Week resets in {n} h', { n: Math.round(h) }) : t('Week resets {when}', { when: new Date(w.resetsAt).toLocaleString(locale(), { weekday: 'short', hour: 'numeric', minute: '2-digit' }) })
}
// Accounts of one agent signed in as the same account (who quota-axi says each is): what Claude
// Code's /login does to your usual login, which it switches. Lists of two or more.
export function sameAs(g) {
  const by = new Map()
  for (const a of g.accounts) {
    const k = a.account?.email ? `${a.account.email}|${a.account.organization || ''}` : null
    if (k) by.set(k, [...(by.get(k) || []), a])
  }
  return [...by.values()].filter((x) => x.length > 1)
}
// Two rows that are one account: the extra one to take off the list, in one click. Your usual login
// when it's one of them (that deletes nothing), else the one that isn't your default (the newer,
// when neither is). setting: the group's default ('auto' or an id).
export function sameText(list, setting, kind) {
  const usual = list.find((a) => a.isDefault)
  const extra = usual || [...list].reverse().find((a) => a.id !== setting) || list[list.length - 1]
  const rest = list.filter((a) => a !== extra)
  const keep = rest.find((a) => a.id === setting) || rest[0]
  const extraName = usual && !usual.named ? t('your usual login') : nameOf(extra)
  return {
    title: t('{names} and {name} are the same account', { names: rest.map(nameOf).join(', '), name: extraName }),
    why: usual ? t('Taking it off the list deletes nothing: {agent} keeps it for the terminal.', { agent: agentName(kind) }) : t('{name} is signed out and removed. {other} stays.', { name: nameOf(extra), other: nameOf(keep) }),
    action: usual ? (usual.named ? t('Remove {name} from the list', { name: usual.label }) : t('Remove your usual login from the list')) : t('Remove {name}', { name: nameOf(extra) }),
    extra, keep,
  }
}

// Your default (where new agents start), as a badge: the star.
export const DefaultTag = () => <span className="def-tag" title={t('Your default: new agents start here')}><Icon name="star" size={10} />{t('Default')}</span>

// What lists accounts (Usage, the top bar, Settings, New agent) looks again.
const changed = () => { refetch('/quota'); window.dispatchEvent(new CustomEvent('bridge-accounts-changed', { detail: {} })) }
// Make default: where new agents of this kind start (an account, or 'auto' for the one with the most left).
export async function makeDefault(kind, id) {
  await api(`/accounts/active/${kind}`, { method: 'POST', body: { id } })
  changed()
}
// Remove: an added account is signed out and its folder deleted; your usual login only leaves
// Bridge AI's list. Asks first (ask: false when the click already said what happens). False: you said no.
export async function removeAccount(kind, a, { ask = true } = {}) {
  const agent = agentName(kind)
  const q = !a.isDefault ? t('Sign out of {name} and remove it from Bridge AI?', { name: nameOf(a) })
    : a.named ? t("Take {name} off Bridge AI's list? It's your usual login, so nothing is signed out: {agent} keeps it for the terminal. You can show it again in Settings › Model providers › Accounts.", { name: a.label, agent })
      : t("Take your usual login off Bridge AI's list? Nothing is signed out: {agent} keeps it for the terminal. You can show it again in Settings › Model providers › Accounts.", { agent })
  if (ask && !window.confirm(q)) return false
  await api(`/accounts/${encodeURIComponent(a.id)}`, { method: 'DELETE' })
  changed()
  return true
}
// The same-account offer's click: the extra row goes. When it was your default, the one it's the
// same as is your default now.
export async function removeTwin(kind, s, setting) {
  if (!s.extra.isDefault && !window.confirm(t('Sign out of {name} and remove it from Bridge AI?', { name: nameOf(s.extra) }))) return false
  if (setting === s.extra.id) await api(`/accounts/active/${kind}`, { method: 'POST', body: { id: s.keep.id } })
  return removeAccount(kind, s.extra, { ask: false })
}
// Sign out: the agent's own logout for this account. Your usual login is the agent's own, so it
// asks first. False: you said no.
export async function signOut(kind, a) {
  const agent = agentName(kind)
  if (a.isDefault && !window.confirm(a.named ? t("Sign out of {name}? It's your usual login, so {agent} itself signs out on this computer, in the terminal too.", { name: a.label, agent }) : t('Sign out of your usual login? {agent} itself signs out on this computer, in the terminal too.', { agent }))) return false
  await api(`/accounts/${encodeURIComponent(a.id)}/logout`, { method: 'POST' })
  changed()
  return true
}
// Whether an agent runs on the account now (one started outside Bridge AI is on your usual login).
export const usingIt = (fleet, id) => (fleet?.agents || []).some((x) => !x.cloudOnly && (x.accountId || `${x.kind}-default`) === id)

// Who has the most left now: "Work", or for several agents "Claude on Work, Codex on Personal".
function bestText(multi) {
  const name = (g) => nameOf(g.accounts.find((a) => a.id === g.pick))
  if (multi.length === 1) return name(multi[0])
  return multi.map((g) => t('{agent} on {account}', { agent: kindName(g.kind), account: name(g) })).join(', ')
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
  // An account whose usage macOS holds back until you allow it once (its Keychain item).
  const [allowing, setAllowing] = useState(null)
  const allow = async (a) => {
    setBusy(true); setErr(null); setAllowing(a.id)
    try { await api(`/quota/allow/${encodeURIComponent(a.id)}`, { method: 'POST' }); refetch('/quota') } catch (x) { setErr(x.message) } finally { setBusy(false); setAllowing(null) }
  }
  // An account whose sign-in ran out: its own login in a terminal tab, as Usage's Sign in again.
  const [signing, setSigning] = useState(null)
  const signIn = async (a) => {
    setBusy(true); setErr(null); setSigning(a.id)
    try { const r = await api(`/accounts/${encodeURIComponent(a.id)}/login`, { method: 'POST' }); if (r.renewed) refetch('/quota'); onClose() } catch (x) { setErr(x.message) } finally { setBusy(false); setSigning(null) }
  }
  // Two rows that are one account: the extra one off the list.
  const removeExtra = async (g, s) => {
    setBusy(true); setErr(null)
    try { if (await removeTwin(g.kind, s, g.setting)) { onClose(); back() } } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }

  const { fleet } = useFleet()
  const multi = groups.filter((g) => g.accounts.length > 1)
  const autoOn = dialog ? value === 'auto' : multi.length > 0 && multi.every((g) => g.setting === 'auto')
  return (
    <div className={`acct-pop ${className}`} ref={ref} role="menu" aria-label={t('Accounts')} onKeyDown={onKeyDown} aria-busy={busy}>
      {multi.length > 0 && (
        <button type="button" data-item role="menuitemradio" aria-checked={autoOn} className="acct-item auto" onClick={() => pick(null, 'auto')} disabled={busy}
          title={dialog ? t('Starts on the account with the most left') : t('New agents start on the account with the most left')}>
          <span className="acct-check">{autoOn && <Icon name="check" size={13} />}</span>
          <span className="acct-main">
            <span className="acct-name">{t('Auto')}</span>
            <span className="acct-desc">{t('Most left now: {name}', { name: bestText(multi) })}</span>
          </span>
        </button>
      )}
      {groups.map((g) => (
        <div key={g.kind} role="group" aria-label={kindName(g.kind)}>
          <div className="acct-sec" aria-hidden="true">{dialog ? kindName(g.kind) : t('New {agent} agents start on', { agent: kindName(g.kind) })}</div>
          {g.accounts.map((a) => {
            const on = dialog ? value === a.id : g.setting === a.id
            // Who Auto would start with right now.
            const auto = (dialog ? value === 'auto' : g.setting === 'auto') && g.pick === a.id && g.accounts.length > 1
            // Your usual login: said under its name, when its name is its email or one you gave it.
            const usual = a.isDefault && (a.named ? g.accounts.length === 1 : !!a.account?.email)
            const inUse = usingIt(fleet, a.id)
            // What it needs from you, on its own row: macOS's Allow, or its sign-in again when it ran out.
            const needs = off ? null : a.allow ? 'allow' : a.signedIn !== false && lapsed(a) ? 'signin' : null
            // The extra row of two that are one account: said under it, with Remove.
            const twin = off ? null : sameAs(g).map((list) => sameText(list, g.setting, g.kind)).find((x) => x.extra.id === a.id)
            // Why it has a button, in a few words (the tooltip says more, but a phone has no hover).
            const why = needs === 'allow' ? t('Allow once to see its usage') : needs === 'signin' ? (inUse ? t('In use: sign in to see its usage') : t('Sign-in expired')) : null
            const sub = allowing === a.id ? t('macOS asks once: choose Always Allow in its window') : [!dialog && on && t('Default'), usual && t('Your usual login'), why || weekResets(a)].filter(Boolean).join(' · ')
            // In the top bar, what a click on the row does, said on it: Set as default.
            const canSet = !dialog && !on && !needs && g.accounts.length > 1
            return (
              <div key={a.id} className={`acct-row ${needs ? 'has-act' : ''} ${canSet ? 'can-set' : ''}`}>
                <button type="button" data-item role="menuitemradio" aria-checked={on} className="acct-item" onClick={() => pick(g.kind, a.id)} disabled={busy}
                  title={[!dialog && on && t('Your default: new agents start here'), windowsText(a), a.signedIn === false && t('Not signed in yet (Settings › Model providers › Accounts)')].filter(Boolean).join('\n') || undefined}>
                  {/* In the top bar a pick is your default: the star, as in Usage and Settings. */}
                  <span className={`acct-check ${on && !dialog ? 'is-default' : ''}`}>{on && <Icon name={dialog ? 'check' : 'star'} size={13} />}</span>
                  <span className="acct-main">
                    <AcctName a={a}>{auto && <span className="best-tag" title={t('Auto starts new agents here now: it has the most left')}>{t('auto')}</span>}</AcctName>
                    {sub ? <span className="acct-desc">{sub}</span> : null}
                  </span>
                  {!needs && <Left a={a} off={off} inUse={inUse} />}
                </button>
                {canSet && (
                  <button type="button" data-item role="menuitem" className="link-btn acct-set" onClick={() => pick(g.kind, a.id)} disabled={busy} aria-label={t('Set {name} as default', { name: nameOf(a) })} title={t('New {agent} agents start on {name}', { agent: kindName(g.kind), name: nameOf(a) })}>
                    <Icon name="star" size={11} />{t('Set as default')}
                  </button>
                )}
                {needs === 'allow' && (
                  <button type="button" data-item role="menuitem" className="btn small acct-act" onClick={() => allow(a)} disabled={busy} title={t('macOS asks once: choose Always Allow in its window')} aria-label={t("Show {name}'s usage", { name: nameOf(a) })}>
                    {allowing === a.id && <Icon name="refresh" size={12} className="spin" />}{t('Allow')}
                  </button>
                )}
                {needs === 'signin' && (
                  <button type="button" data-item role="menuitem" className="btn small acct-act" onClick={() => signIn(a)} disabled={busy} aria-label={t('Sign in to {name} again', { name: nameOf(a) })}
                    title={`${inUse ? t('An agent is using it, so it still works, but its usage can\'t be read until it signs in again.') : t('Its sign-in expired.')} ${viaRelay ? t('It signs in again in a terminal tab on your computer') : t('Your browser opens to sign in')}`}>
                    {signing === a.id && <Icon name="refresh" size={12} className="spin" />}{t('Sign in')}
                  </button>
                )}
                {twin && (
                  <div className="acct-under acct-same">
                    <Icon name="alert" size={11} />
                    <span>{t('Same account as {name}', { name: twin.keep ? nameOf(twin.keep) : '' })}</span>
                    <button type="button" data-item role="menuitem" className="link-btn" onClick={() => removeExtra(g, twin)} disabled={busy} title={`${twin.action}. ${twin.why}`}>{t('Remove')}</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
      {err && <p className="error-text small acct-err" role="alert">{err}</p>}
      <div className="acct-sep" role="separator" />
      {onAdd && (
        <button type="button" data-item role="menuitem" className="acct-item plain" onClick={() => run(() => onAdd(groups.length === 1 ? groups[0].kind : undefined))}
          title={t('As many {agent} accounts as you like, each with its own name', { agent: groups.length === 1 ? kindName(groups[0].kind) : t('Claude or Codex') })}>
          <span className="acct-check"><Icon name="plus" size={13} /></span>
          <span className="acct-main"><span className="acct-name">{t('Add another account…')}</span></span>
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
  changed()
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
          {value === 'auto' ? <><b>{t('Auto')}</b>{cur && <span className="muted"> · {nameOf(cur)}</span>}</> : <b>{nameOf(cur)}</b>}
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
      <button type="button" className="btn small" onClick={allow} disabled={busy}>{busy ? t('Waiting for macOS…') : t('Allow')}</button>
      {err && <span className="error-text small">{err}</span>}
    </div>
  )
}
