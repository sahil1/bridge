import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, fmtRelative } from '../../api.js'
import { t, tx } from '../../i18n/index.js'

// Whiteboard Settings: the look (Bridge AI's clean one, or hand-drawn), and what the whiteboard
// has learnt you like from how you change what a model draws (server/boards.js, learn.js): each
// preference readable, changeable and forgettable, with the edits it came from, and any of them
// can be set by hand before it's learnt. It's kept on this computer and only goes to the model you
// draw with, inside the prompt.
export const PREF_KEYS = [
  ['direction', tx('Direction'), { LR: tx('Left to right'), TB: tx('Top to bottom') }],
  ['iconSet', tx('Icons'), { network: tx('Plain network icons'), aws: tx('AWS icons'), azure: tx('Azure icons'), gcp: tx('Google Cloud icons') }],
  ['colours', tx('Colours'), { soft: tx('Soft colours'), muted: tx('Muted colours'), vivid: tx('Vivid colours'), none: tx('No fills') }],
  ['spacing', tx('Spacing'), { roomy: tx('Roomy spacing'), normal: tx('Normal spacing'), tight: tx('Compact spacing') }],
  ['labels', tx('Labels'), { title: tx('Labels in Title Case'), sentence: tx('Labels in sentence case'), short: tx('Short labels') }],
  ['arrows', tx('Arrows'), { elbow: tx('Right-angled arrows'), straight: tx('Straight arrows'), curved: tx('Curved arrows') }],
  ['look', tx('Look'), { clean: tx('Clean lines'), sketch: tx('Hand-drawn') }],
]

// "Left to right · AWS icons · Muted colours", from what's learnt or chosen.
export function prefsSummary(p) {
  if (!p?.on) return ''
  const parts = PREF_KEYS.filter(([k]) => p.prefs?.[k]?.value).map(([k, , vals]) => p.prefs[k].text || t(vals[p.prefs[k].value] || p.prefs[k].value))
  for (const n of (p.prefs?.naming?.pairs || []).slice(-3)) parts.push(t('“{from}” becomes “{to}”', { from: n.from, to: n.to }))
  return parts.join(' · ')
}

// look: this board's. onLook(look): picked. prefs, onPrefs(next): the profile and its update.
export default function BoardSettings({ look, onLook, prefs, onPrefs, onClose }) {
  const [notes, setNotes] = useState(prefs?.notes || '')
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState(null)
  useEffect(() => { setNotes(prefs?.notes || '') }, [prefs?.notes])
  const send = (body) => api('/boards/preferences', { method: 'PUT', body }).then(onPrefs).catch((e) => setErr(e.message))
  const p = prefs?.prefs || {}
  const learnt = PREF_KEYS.filter(([k]) => p[k]?.value)
  const unset = PREF_KEYS.filter(([k]) => !p[k]?.value)
  const pairs = p.naming?.pairs || []
  const summary = prefsSummary(prefs)
  return (
    <section className="wb-settings" aria-label={t('Whiteboard Settings')}>
      <div className="wb-draw-head">
        <b>{t('Whiteboard Settings')}</b>
        <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={13} /></button>
      </div>
      <h5>{t('Look')}</h5>
      <div className="seg small-seg wb-look" role="radiogroup" aria-label={t('Look')}>
        <button type="button" role="radio" aria-checked={look === 'clean'} className={look === 'clean' ? 'on' : ''} onClick={() => onLook('clean')}>{t('Clean')}</button>
        <button type="button" role="radio" aria-checked={look === 'sketch'} className={look === 'sketch' ? 'on' : ''} onClick={() => onLook('sketch')}>{t('Hand-drawn')}</button>
      </div>
      <p className="muted small">{look === 'clean' ? t('Straight lines, a plain font and right-angled arrows that snap to shapes. For this whiteboard and new ones.') : t('Sketchy lines and a handwritten font. For this whiteboard and new ones.')}</p>

      <h5>{t('Preferences')}</h5>
      <label className="ph-check small"><input type="checkbox" checked={prefs?.on !== false} onChange={(e) => send({ on: e.target.checked })} /> {t('Learn from what I change after a model draws')}</label>
      {prefs?.on !== false && (
        <>
          <p className="small wb-summary">{summary ? <><span className="muted">{t('You like:')}</span> {summary}</> : t('Nothing learnt yet. Change what a model draws (the direction, colours, names, icons) and it learns what you like.')}</p>
          {learnt.length > 0 && (
            <ul className="wb-prefs">
              {learnt.map(([k, label, vals]) => {
                const x = p[k]
                const n = (x.evidence || []).length
                return (
                  <li key={k}>
                    <div className="wb-pref-row">
                      <span className="muted small">{t(label)}</span>
                      <select value={x.value} onChange={(e) => send({ set: { [k]: e.target.value } })} aria-label={t(label)}>
                        {Object.entries(vals).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
                      </select>
                      <button type="button" className="link-btn small" onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k}>{x.set ? t('Set by you') : n === 1 ? t('From 1 edit') : t('From {n} edits', { n })}</button>
                      <button type="button" className="win-btn" onClick={() => send({ forget: k })} aria-label={t('Forget {what}', { what: t(label) })} title={t('Forget')}><Icon name="x" size={12} /></button>
                    </div>
                    {open === k && (
                      <ul className="wb-evidence muted small">
                        {(x.evidence || []).slice().reverse().map((ev, i) => <li key={i}>{t('{what} on “{board}”, {when}', { what: t(vals[ev.value] || ev.value), board: ev.board || t('a whiteboard'), when: fmtRelative(ev.at) })}</li>)}
                        {x.set && <li>{t('Chosen here by you')}</li>}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {unset.length > 0 && (
            <select className="wb-pref-add" value="" onChange={(e) => { const [k, v] = e.target.value.split(':'); if (k && v) send({ set: { [k]: v } }) }} aria-label={t('Set a preference yourself')}>
              <option value="">{t('Set a preference yourself')}</option>
              {unset.map(([k, label, vals]) => <optgroup key={k} label={t(label)}>{Object.entries(vals).map(([v, l]) => <option key={v} value={`${k}:${v}`}>{t(l)}</option>)}</optgroup>)}
            </select>
          )}
          {pairs.length > 0 && (
            <ul className="wb-prefs">
              {pairs.map((n) => (
                <li key={n.from} className="wb-pref-row">
                  <span className="small">{t('“{from}” becomes “{to}”', { from: n.from, to: n.to })}</span>
                  <span className="wb-grow" />
                  <button type="button" className="win-btn" onClick={() => send({ forget: { naming: n.from } })} aria-label={t('Forget')} title={t('Forget')}><Icon name="x" size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          <label className="wb-notes">
            <span className="muted small">{t('Anything else to keep in mind')}</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (prefs?.notes || '') && send({ notes })} placeholder={t('Say which protocols to put on arrows, or a colour for each team…')} />
          </label>
          {(learnt.length > 0 || pairs.length > 0 || prefs?.notes) && <button type="button" className="btn small" onClick={() => send({ forget: 'all' })}>{t('Forget everything')}</button>}
          <p className="muted small">{t("Kept on this computer only. It goes to the model you draw with, with your words, and nowhere else.")}</p>
        </>
      )}
      {err && <p className="error-text small" role="alert">{err}</p>}
      <p className="muted small wb-credit">{t('Whiteboards are drawn with Excalidraw (MIT License).')} <a href="https://github.com/excalidraw/excalidraw" target="_blank" rel="noreferrer">github.com/excalidraw/excalidraw</a></p>
    </section>
  )
}
