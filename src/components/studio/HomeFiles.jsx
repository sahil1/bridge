import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, refetch } from '../../api.js'
import { t, tx, locale } from '../../i18n/index.js'
import { canAddPlace } from '../Transfers.jsx'

// Studio's home, your files: what you opened here, and the documents, sheets, decks and PDFs you
// used lately anywhere on this computer (server/studiofound.js: Spotlight on a Mac, Recent items on
// Windows, the recently used list on Linux, and a short look through your agents' folders and your
// places). Asked for once the home is open, never before; a row each, with the folder it's in, when
// it changed, and Open. Add a folder: a place in Files, looked through from then on.
const KIND_ICON = { doc: 'doc', sheet: 'grid', deck: 'screen', pdf: 'file', page: 'code' }
const FILTERS = [['all', tx('All')], ['doc', tx('Documents')], ['sheet', tx('Sheets')], ['deck', tx('Decks')], ['pdf', tx('PDFs')]]
const SOURCE = { spotlight: tx('Spotlight'), recent: tx("Windows' Recent items"), xbel: tx('your recently used files'), folders: tx("your agents' folders and places") }
const keyOf = (f) => `${f.root}\n${f.path}`
const picker = typeof window !== 'undefined' ? window.bridgeApp?.pickFolder : null

// "5 minutes ago", "Yesterday", "Mar 3": how long ago, as near as it matters.
export function ago(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const s = (Date.now() - d.getTime()) / 1000
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
  if (s < 45) return rtf.format(0, 'second')
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  if (s < 6 * 86400) return rtf.format(-Math.round(s / 86400), 'day')
  return d.toLocaleDateString(locale(), { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })
}

// recent: Studio's own list (/studio/recent); describe(f): { kind, folder, full } in words.
export function YourFiles({ recent, refreshRecent, describe, onOpen }) {
  const [found, setFound] = useState(null) // { files, sources, errors, at } or { error }
  const [looking, setLooking] = useState(false)
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const ctl = useRef(null)
  const look = useCallback((fresh) => {
    ctl.current?.abort()
    const c = new AbortController()
    ctl.current = c
    setLooking(true)
    api(`/studio/found${fresh ? '?fresh=1' : ''}`, { signal: c.signal })
      .then((r) => { if (!c.signal.aborted) setFound(r) }, (e) => { if (!c.signal.aborted) setFound({ error: e.message }) })
      .finally(() => { if (!c.signal.aborted) setLooking(false) })
  }, [])
  // Looked for once the home is open; let go of if you leave first.
  useEffect(() => { look(false); return () => ctl.current?.abort() }, [look])
  const rows = useMemo(() => {
    const by = new Map()
    for (const f of found?.files || []) by.set(keyOf(f), { ...f, changed: f.at })
    for (const r of recent?.files || []) { const k = keyOf(r); const was = by.get(k); by.set(k, { ...(was || {}), ...r, opened: r.at, changed: was?.changed || null, mine: true }) }
    const time = (f) => Math.max(Date.parse(f.changed || 0) || 0, Date.parse(f.opened || 0) || 0)
    return [...by.values()].sort((a, b) => time(b) - time(a))
  }, [found, recent])
  const needle = q.trim().toLocaleLowerCase()
  const shown = rows.filter((f) => (filter === 'all' || f.kind === filter || (filter === 'deck' && f.ext === '.pptx')) && (!needle || f.name.toLocaleLowerCase().includes(needle)))
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, k === 'all' ? rows.length : rows.filter((f) => f.kind === k).length]))
  const forget = (f) => api(`/studio/recent?root=${encodeURIComponent(f.root)}&path=${encodeURIComponent(f.path)}`, { method: 'DELETE' }).then(refreshRecent)
  const sources = (found?.sources || []).map((s) => t(SOURCE[s] || s))
  return (
    <section className="sd-sec sd-files" aria-label={t('Recent files')}>
      <div className="sd-files-head">
        <h3>{t('Recent files')}</h3>
        <div className="sd-filter" role="tablist" aria-label={t('Show')}>
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)} disabled={k !== 'all' && !counts[k]}>{t(label)}{counts[k] > 0 && <small>{counts[k]}</small>}</button>
          ))}
        </div>
        <span className="sd-grow" />
        <label className="sd-files-search"><Icon name="search" size={13} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find a file')} aria-label={t('Find a file by its name')} /></label>
        <button type="button" className="win-btn" onClick={() => look(true)} disabled={looking} aria-label={t('Look again')} title={t('Look for your files again')}><Icon name="refresh" size={14} className={looking ? 'spin' : ''} /></button>
        {canAddPlace && <AddFolder onAdded={() => look(true)} />}
      </div>
      <div className="sd-files-table" role="table" aria-label={t('Recent files')}>
        <div className="sd-files-row head" role="row"><span role="columnheader">{t('Name')}</span><span role="columnheader">{t('Folder')}</span><span role="columnheader">{t('Changed')}</span><span role="columnheader" aria-label={t('Open')} /></div>
        {shown.map((f) => {
          const d = describe(f)
          return (
            <div key={keyOf(f)} className="sd-files-row" role="row">
              <button type="button" role="cell" className="sd-file-name" onClick={() => onOpen({ root: f.root, path: f.path })} title={d.full || f.path}>
                <span className={`sd-file-ic ${f.kind || ''}`}><Icon name={KIND_ICON[f.kind] || 'file'} size={15} /></span>
                <span className="sd-file-text"><b>{f.name}</b><small className="muted">{d.kind}</small></span>
              </button>
              <span role="cell" className="sd-file-dir" title={d.full || d.folder || ''}><Icon name="folder" size={12} /><span>{d.folder || '—'}</span></span>
              <span role="cell" className="sd-file-when" title={f.changed ? new Date(f.changed).toLocaleString(locale()) : f.opened ? new Date(f.opened).toLocaleString(locale()) : ''}>{f.changed ? ago(f.changed) : f.opened ? t('Opened {when}', { when: ago(f.opened) }) : ''}</span>
              <span role="cell" className="sd-file-acts">
                <button type="button" className="btn small" onClick={() => onOpen({ root: f.root, path: f.path })} aria-label={t('Open {name}', { name: f.name })}>{t('Open')}</button>
                {f.mine && <button type="button" className="ghost-btn sd-file-x" aria-label={t('Take {name} off the list', { name: f.name })} title={t('Take it off the list (the file stays)')} onClick={() => forget(f)}><Icon name="x" size={12} /></button>}
              </span>
            </div>
          )
        })}
        {looking && !found && <div className="sd-files-row wait" role="row"><span role="cell" className="muted small"><Icon name="refresh" size={12} className="spin" /> {t('Looking for your files…')}</span></div>}
        {!shown.length && (found || !looking) && (
          <div className="sd-files-none" role="row"><span role="cell">
            {rows.length ? t('No file here matches.') : t('No documents, sheets, decks or PDFs yet. One you open from Files, start above, or use in a folder you add shows here.')}
          </span></div>
        )}
      </div>
      {found && !found.error && (
        <p className="sd-files-src muted small">
          {sources.length ? t('From {sources}, and what you opened in Studio.', { sources: sources.join(t(' and ')) }) : t('From what you opened in Studio.')}
          {found.errors?.map((e) => <span key={e.source} className="sd-files-err" role="status"> {e.source === 'spotlight' ? t("Couldn't ask Spotlight: {error}", { error: e.error }) : t("Couldn't read {source}: {error}", { source: t(SOURCE[e.source] || e.source), error: e.error })}</span>)}
        </p>
      )}
      {found?.error && <p className="error-text small" role="alert">{t("Couldn't look for your files: {error}", { error: found.error })}</p>}
    </section>
  )
}

// Add a folder: the system's folder picker in the desktop app, else (a browser on this computer)
// typed, with this computer's folders as you type. A place in Files from then on.
function AddFolder({ onAdded }) {
  const [typing, setTyping] = useState(false)
  const [v, setV] = useState('~/')
  const [dirs, setDirs] = useState([])
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (!typing) return undefined
    const id = setTimeout(() => api(`/dirs?q=${encodeURIComponent(v)}`).then((d) => setDirs(d.dirs || [])).catch(() => {}), 150)
    return () => clearTimeout(id)
  }, [v, typing])
  const add = async (p) => {
    setErr(null)
    try { await api('/places', { method: 'POST', body: { path: p } }); refetch('/places'); setTyping(false); onAdded() } catch (e) { setErr(e.message) }
  }
  const start = async () => {
    if (!picker) return setTyping(true)
    const p = await picker(undefined, { place: true }).catch(() => null)
    if (p) add(p)
  }
  return (
    <span className="sd-add-folder">
      <button type="button" className="btn small" onClick={start} title={t('Add a folder: Studio looks for your files there too, and Files shows it')}><Icon name="plus" size={12} /> {t('Add a folder')}</button>
      {typing && (
        <form className="sd-add-form" onSubmit={(e) => { e.preventDefault(); add(v) }}>
          <input className="input" value={v} onChange={(e) => setV(e.target.value)} list="sd-add-dirs" autoFocus spellCheck={false} aria-label={t('Folder on this computer')} />
          <datalist id="sd-add-dirs">{dirs.map((d) => <option key={d} value={d} />)}</datalist>
          <button type="submit" className="btn small primary">{t('Add')}</button>
          <button type="button" className="ghost-btn" onClick={() => setTyping(false)}>{t('Cancel')}</button>
          {err && <p className="error-text small" role="alert">{err}</p>}
        </form>
      )}
      {!typing && err && <span className="error-text small" role="alert">{err}</span>}
    </span>
  )
}
