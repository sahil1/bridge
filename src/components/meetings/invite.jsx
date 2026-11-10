import { useState } from 'react'
import Icon from '../Icon.jsx'
import CopyButton from '../CopyButton.jsx'
import { openPerson } from '../memory/open.js'
import { t, tx } from '../../i18n/index.js'
import './invite.css'

// An invite as Google Calendar and Outlook show one (server/calendar.js reads it): who's invited,
// each with their address (to copy), whether they organised it or are optional, and their reply,
// with how many said yes, no or maybe and how many haven't replied; and the invite's own words with
// their links. Bridge AI's own part beside them: who you've met before (Meeting Insights, through
// AI Assist's prep), each a click from their page in Meetings › People. A long list shows its first
// few, with Show all. It only reads: nothing here answers an invite or writes to anyone.

const REPLY = { accepted: tx('Accepted'), declined: tx('Declined'), tentative: tx('Maybe'), pending: tx('Not replied') }
const REPLY_ICON = { accepted: 'check', declined: 'x', pending: 'clock' }
const ORDER = { accepted: 0, tentative: 1, pending: 2, declined: 3 }
const initials = (s) => String(s || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
// The name a guest is on the invite by, as the event's attendees and the prep have it.
const nameOf = (g) => g.name || (g.email ? g.email.split('@')[0] : '')
const metIn = (n) => (n === 1 ? t('Met in 1 meeting') : t('Met in {n} meetings', { n }))
// Someone's page in Meetings › People, for onPerson in the main window.
export { openPerson }

// Each guest's reply: theirs, yours as you answered (for you), the organizer's as going; null when
// the calendar doesn't say (icalBuddy).
function replyOf(g, e) {
  if (g.you && e.response) return { accepted: 'accepted', organizer: 'accepted', tentative: 'tentative', declined: 'declined', none: 'pending' }[e.response] || g.status || 'pending'
  if (g.status) return g.status
  if (g.organizer) return e.replies ? 'accepted' : null
  return e.replies ? 'pending' : null
}

// The guests in the order they're read: who organised it, you, then by reply (yes, maybe, not
// replied, no), each in the invite's order.
export function guestsOf(e) {
  const list = (e.guests || []).map((g, i) => ({ ...g, reply: replyOf(g, e), i }))
  const rank = (g) => (g.organizer ? -2 : g.you ? -1 : ORDER[g.reply] ?? 2)
  return list.sort((a, b) => rank(a) - rank(b) || a.i - b.i)
}
// "7 guests · 4 yes · 1 no · 2 awaiting", as Google says it; replies: only how they replied (under
// AI Assist's "6 invited", which counts the others, not you).
export function guestCounts(e, list = guestsOf(e), { replies = false } = {}) {
  const n = Math.max(e.guestCount || 0, list.length)
  const of = (r) => list.filter((g) => g.reply === r).length
  const said = replies ? [] : [n === 1 ? t('1 guest') : t('{n} guests', { n })]
  if (e.replies) {
    // Of those listed: past the first 150 of a big invite, no one's reply is here.
    const [yes, no, maybe, wait] = [of('accepted'), of('declined'), of('tentative'), of('pending')]
    if (yes) said.push(t('{n} yes', { n: yes }))
    if (no) said.push(t('{n} no', { n: no }))
    if (maybe) said.push(t('{n} maybe', { n: maybe }))
    if (wait) said.push(t('{n} awaiting', { n: wait }))
  }
  return said.join(' · ')
}

// The guests. e: the event (guests, guestCount, replies, response); people: AI Assist's prep's
// (known: who you've met before, each with the name they're on the invite by), or none;
// onPerson(id): someone's page in Meetings › People (none in the floating card's own window, which
// has no Meetings: then it's said, not a link); compact: the floating card's, Home's and the
// Schedule's, a line each without the address; head: how many, and their replies, above them
// ('replies': their replies only).
export function Guests({ e, people = null, onPerson = null, compact = false, head = false }) {
  const [all, setAll] = useState(false)
  const list = guestsOf(e)
  if (!list.length) return null
  const known = new Map((people?.known || []).map((k) => [String(k.invited || k.name), k]))
  const keep = compact ? 5 : 6
  const shown = all || list.length <= keep + 2 ? list : list.slice(0, keep)
  const more = Math.max(0, (e.guestCount || 0) - list.length)
  const addresses = list.filter((g) => g.email).map((g) => (g.name ? `${g.name} <${g.email}>` : g.email))
  return (
    <div className={`gu ${compact ? 'compact' : ''}`}>
      {((head && (head !== 'replies' || e.replies)) || !compact) && (
        <div className="gu-head">
          {head && <span className="gu-sum">{guestCounts(e, list, { replies: head === 'replies' })}</span>}
          {!compact && addresses.length > 1 && <CopyButton text={addresses.join(', ')} label={t('Copy addresses')} title={t('Copy every guest\'s address, to write to them')} />}
        </div>
      )}
      <ul className="gu-list">
        {shown.map((g) => {
          const name = nameOf(g)
          const met = !g.you && known.get(name)
          const reply = g.reply
          return (
            <li key={`${g.i}`} className={`gu-row r-${reply || 'unknown'}`} title={[g.name, g.email].filter(Boolean).join('\n')}>
              <span className="gu-av" aria-hidden="true">{initials(name)}{reply && <i className="gu-mark">{REPLY_ICON[reply] ? <Icon name={REPLY_ICON[reply]} size={8} /> : '?'}</i>}</span>
              <span className="gu-who">
                <span className="gu-name">
                  <b>{g.name || g.email}</b>
                  {g.you && <span className="gu-tag">{t('You')}</span>}
                  {g.organizer && <span className="gu-tag org">{t('Organizer')}</span>}
                  {g.role === 'optional' && <span className="gu-tag">{t('Optional')}</span>}
                </span>
                {(!compact && g.email && g.name) || met ? (
                  <small>
                    {!compact && g.name && g.email && <span className="gu-mail">{g.email}</span>}
                    {met && (onPerson
                      ? <button type="button" className="link-btn gu-met" onClick={() => onPerson(met.id)} title={t('Open {name} in Meetings › People', { name: met.name })}>{metIn(met.meetings)}</button>
                      : <span className="gu-met">{metIn(met.meetings)}</span>)}
                  </small>
                ) : null}
              </span>
              {reply && <span className="gu-reply">{t(REPLY[reply])}</span>}
              {g.email && <CopyButton text={g.email} label={null} title={t('Copy {email}', { email: g.email })} className="icon-btn gu-copy" size={11} />}
            </li>
          )
        })}
      </ul>
      {list.length > shown.length && <button type="button" className="ghost-btn gu-all" onClick={() => setAll(true)}>{t('Show all {n}', { n: list.length })} <Icon name="chevron" size={10} className="rot90" /></button>}
      {all && list.length > keep + 2 && <button type="button" className="ghost-btn gu-all" onClick={() => setAll(false)}>{t('Show fewer')}</button>}
      {more > 0 && <p className="muted small">{t('And {n} more on the invite: your calendar app lists them all.', { n: more })}</p>}
      {!e.replies && !compact && <p className="muted small">{t('Who has replied isn\'t known here: icalBuddy reads only who\'s invited. Your calendar app shows their replies.')}</p>}
    </div>
  )
}

// The call app a join link is for.
export const callOf = (join) => (!join ? null : /zoom\.us/.test(join) ? 'Zoom' : /meet\.google\.com/.test(join) ? 'Google Meet' : /webex\.com/.test(join) ? 'Webex' : 'Microsoft Teams')

// A link as it's shown in the invite's words: where it goes, short, the whole of it on hover.
const LINK = /https?:\/\/[^\s<>"'\])]+/g
const shortLink = (url) => { const s = url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''); return s.length > 42 ? `${s.slice(0, 40)}…` : s }
function Linked({ text }) {
  const out = []
  let at = 0
  for (const m of text.matchAll(LINK)) {
    const url = m[0].replace(/[.,;:!?]+$/, '')
    if (m.index > at) out.push(text.slice(at, m.index))
    out.push(<a key={m.index} href={url} target="_blank" rel="noreferrer" title={url}>{shortLink(url)}</a>)
    at = m.index + url.length
  }
  out.push(text.slice(at))
  return out
}

// The invite's own words, whole, with their links: the first lines of a long one, and Show more.
export function InviteText({ text }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  const long = text.length > 480 || text.split('\n').length > 9
  return (
    <div className="iv-text">
      <p className={`iv-words ${long && !open ? 'folded' : ''}`}><Linked text={text} /></p>
      {long && <button type="button" className="ghost-btn iv-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t('Show less') : t('Show more')}</button>}
    </div>
  )
}

// The call: which app, its link (to copy), and Join beside the event's other buttons.
export function CallLink({ join }) {
  if (!join) return null
  return (
    <p className="iv-call">
      <Icon name="video" size={12} />
      <span><b>{t('{app} meeting', { app: callOf(join) })}</b> <a href={join} target="_blank" rel="noreferrer" title={join}>{shortLink(join)}</a></span>
      <CopyButton text={join} label={null} title={t('Copy the link to join')} className="icon-btn iv-copy" size={11} />
    </p>
  )
}
