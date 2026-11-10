import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, refetch, usePoll, onThisComputer } from '../../api.js'
import { useWidth, usePersisted } from '../layout.jsx'
import { t, tx, locale } from '../../i18n/index.js'
import { canAddPlace } from '../Transfers.jsx'
import { fileOp } from '../FileExtras.jsx'

// Studio's Files: what you opened here, the documents, sheets, decks and PDFs on this computer
// (server/studiofound.js: Spotlight on a Mac, Recent items on Windows, the recently used list on
// Linux, and a short look through your agents' folders, your places and Studio's own folder) and
// your whiteboards. Asked for once Studio is open, never before. Shown by what's picked on the left:
// Recent, a kind, or where they are (Bridge AI's own, a project, a place, a cloud drive, a folder);
// a search looks through all of them. A row each, with its folder, when it changed, and Open, which
// shows it in Preview, in its own editor. Add a folder: a place in Files, looked through from then on.
const KIND_ICON = { doc: 'doc', sheet: 'grid', deck: 'screen', pdf: 'file', page: 'code', board: 'shapes' }
const KINDS = [
  ['doc', tx('Documents'), tx('No documents found: Word, Markdown or text files.')],
  ['deck', tx('Presentations'), tx('No presentations found: PowerPoint files or Markdown decks.')],
  ['sheet', tx('Sheets'), tx('No sheets found: Excel or CSV files.')],
  ['pdf', tx('PDFs'), tx('No PDFs found.')],
  ['page', tx('Pages'), tx('No pages found: HTML files.')],
  ['board', tx('Whiteboards'), tx('No whiteboards yet. Make one in Whiteboards, or ask an agent or the Chief of Staff to draw one.')],
]
const AREA_ICON = { studio: 'layers', project: 'bot', place: 'pin', cloud: 'cloud', folder: 'folder', home: 'home', other: 'folder' }
const AREA_ORDER = ['studio', 'project', 'place', 'cloud', 'folder', 'home', 'other']
const SOURCE = { spotlight: tx('Spotlight'), recent: tx("Windows' Recent items"), xbel: tx('your recently used files'), folders: tx("your agents' folders and places"), studio: tx("Studio's own folder"), boards: tx('your whiteboards') }
const RECENT_DAYS = 30
const RECENT_MAX = 60
const keyOf = (f) => `${f.root}\n${f.path}`
const areaKey = (a) => `${a?.type || 'other'}:${a?.name || ''}`
const areaName = (a) => (a.type === 'studio' ? t('Bridge AI') : a.type === 'home' ? t('Home folder') : a.name || t('Elsewhere'))
const picker = typeof window !== 'undefined' ? window.bridgeApp?.pickFolder : null
// A file's own app opens it on the computer it's on, so only from a window there (not a phone, or
// another computer's window).
const inApp = typeof window !== 'undefined' && onThisComputer()
const when = (f) => Math.max(Date.parse(f.changed || 0) || 0, Date.parse(f.opened || 0) || 0)

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

// recent: Studio's own list (/studio/recent); describe(f): { kind, folder, full } in words;
// areaOf(f): where a file Studio opened is ({ type, name }) when the look didn't find it;
// onEmpty(yes): whether there are no files at all, once that's known.
export function YourFiles({ recent, refreshRecent, describe, areaOf, onOpen, onEmpty }) {
  const [found, setFound] = useState(null) // { files, sources, errors, at, capped, skipped } or { error }
  const [looking, setLooking] = useState(false)
  const [note, setNote] = useState(null) // { text, error }: what came of Open in app
  useEffect(() => { if (!note || note.error) return undefined; const id = setTimeout(() => setNote(null), 4000); return () => clearTimeout(id) }, [note])
  const openInApp = (f) => fileOp(f.root, 'open', f.path).then(() => setNote({ text: t('Opening {name} in its own app…', { name: f.name }) }), (e) => setNote({ text: t("Couldn't open {name}: {error}", { name: f.name, error: e.message }), error: true }))
  const [group, setGroup] = usePersisted('cc-studio-group', 'recent') // recent, kind:<kind> or area:<type>:<name>
  const [q, setQ] = useState('')
  const [boxRef, boxW] = useWidth()
  const narrow = boxW > 0 && boxW < 640
  const boards = usePoll('/boards', 60_000)
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
  // Looked for once Studio is open; let go of if you leave first.
  useEffect(() => { look(false); return () => ctl.current?.abort() }, [look])
  // Each file once: what the look found, what you opened here (its kind as it opened: a Markdown deck
  // is a deck), and your whiteboards, which are Bridge AI's own.
  const rows = useMemo(() => {
    const by = new Map()
    for (const f of found?.files || []) by.set(keyOf(f), { ...f, changed: f.at })
    for (const r of recent?.files || []) { const k = keyOf(r); const was = by.get(k); by.set(k, { ...(was || {}), ...r, area: was?.area || areaOf(r), opened: r.at, changed: was?.changed || null, mine: true }) }
    for (const b of boards.data?.boards || []) by.set(`board\n${b.id}`, { root: 'board', path: b.id, name: b.id, kind: 'board', changed: new Date(b.mtime).toISOString(), area: { type: 'studio', name: null } })
    return [...by.values()].sort((a, b) => when(b) - when(a))
  }, [found, recent, boards.data, areaOf])
  useEffect(() => { onEmpty?.(!!found && !rows.length) }, [found, rows, onEmpty])
  // Recent: what you opened here, and what was opened or changed in the last 30 days.
  const recentRows = useMemo(() => rows.filter((f) => f.mine || Date.now() - when(f) < RECENT_DAYS * 86400_000).slice(0, RECENT_MAX), [rows])
  const areas = useMemo(() => {
    const by = new Map()
    for (const f of rows) { const k = areaKey(f.area); const a = by.get(k) || { key: k, ...(f.area || { type: 'other', name: null }), n: 0 }; a.n++; by.set(k, a) }
    return [...by.values()].sort((a, b) => AREA_ORDER.indexOf(a.type) - AREA_ORDER.indexOf(b.type) || (a.type === 'folder' || a.type === 'cloud' ? b.n - a.n : 0) || areaName(a).localeCompare(areaName(b), locale()))
  }, [rows])
  const kindCount = Object.fromEntries(KINDS.map(([k]) => [k, rows.filter((f) => f.kind === k).length]))
  // A group that's gone (its folder no longer has a file) shows Recent.
  const pick = group === 'recent' || (group.startsWith('kind:') && KINDS.some(([k]) => `kind:${k}` === group)) || areas.some((a) => `area:${a.key}` === group) ? group : 'recent'
  const needle = q.trim().toLocaleLowerCase()
  const kind = pick.startsWith('kind:') ? KINDS.find(([k]) => `kind:${k}` === pick) : null
  const area = pick.startsWith('area:') ? areas.find((a) => `area:${a.key}` === pick) : null
  const shown = needle ? rows.filter((f) => f.name.toLocaleLowerCase().includes(needle))
    : kind ? rows.filter((f) => f.kind === kind[0]) : area ? rows.filter((f) => areaKey(f.area) === area.key) : recentRows
  const forget = (f) => api(`/studio/recent?root=${encodeURIComponent(f.root)}&path=${encodeURIComponent(f.path)}`, { method: 'DELETE' }).then(refreshRecent)
  const sources = [...(found?.sources || []), ...(boards.data ? ['boards'] : [])].map((s) => t(SOURCE[s] || s))
  const capped = Object.entries(found?.capped || {})
  const title = needle ? t('Matching “{q}”', { q: q.trim() }) : kind ? t(kind[1]) : area ? areaName(area) : t('Recent')
  const none = needle ? t('No file of yours matches “{q}”.', { q: q.trim() })
    : kind ? t(kind[2])
      : !rows.length ? t('No documents, sheets, decks or PDFs yet. One you open from an agent\'s Files, start above, or keep in a folder you add shows here.')
        : t('Nothing opened or changed in the last 30 days. Pick a kind or a folder to see the rest.')
  const groupBtn = (id, icon, label, n, hint) => (
    <button key={id} type="button" className={pick === id && !needle ? 'on' : ''} aria-current={pick === id && !needle ? 'true' : undefined} onClick={() => { setGroup(id); setQ('') }} title={hint || label}>
      <Icon name={icon} size={14} /><span>{label}</span><small>{n}</small>
    </button>
  )
  return (
    <section className="sd-sec sd-files" aria-label={t('Your Files')} ref={boxRef}>
      <div className="sd-files-head">
        <h3>{t('Your Files')}</h3>
        <span className="sd-grow" />
        <label className="sd-files-search"><Icon name="search" size={13} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find a file')} aria-label={t('Find a file by its name, in all your files')} /></label>
        <button type="button" className="win-btn" onClick={() => look(true)} disabled={looking} aria-label={t('Look again')} title={t('Look for your files again')}><Icon name="refresh" size={14} className={looking ? 'spin' : ''} /></button>
        {canAddPlace && <AddFolder onAdded={() => look(true)} />}
      </div>
      <div className={`sd-browse${narrow ? ' narrow' : ''}`}>
        {narrow ? (
          <label className="sd-group-pick"><span className="muted small">{t('Show')}</span>
            <select value={pick} onChange={(e) => { setGroup(e.target.value); setQ('') }} aria-label={t('Show')}>
              <option value="recent">{t('Recent')} ({recentRows.length})</option>
              <optgroup label={t('Kinds')}>{KINDS.map(([k, label]) => <option key={k} value={`kind:${k}`}>{t(label)} ({kindCount[k]})</option>)}</optgroup>
              {areas.length > 0 && <optgroup label={t('Where')}>{areas.map((a) => <option key={a.key} value={`area:${a.key}`}>{areaName(a)} ({a.n})</option>)}</optgroup>}
            </select>
          </label>
        ) : (
          <nav className="sd-groups" aria-label={t('Show')}>
            {groupBtn('recent', 'clock', t('Recent'), recentRows.length, t('What you opened here, and what was opened or changed in the last 30 days'))}
            <h4>{t('Kinds')}</h4>
            {KINDS.map(([k, label]) => groupBtn(`kind:${k}`, KIND_ICON[k], t(label), kindCount[k]))}
            {areas.length > 0 && <h4>{t('Where')}</h4>}
            {areas.map((a) => groupBtn(`area:${a.key}`, AREA_ICON[a.type] || 'folder', areaName(a), a.n, a.type === 'studio' ? t('Bridge AI\'s own: decks made from meetings, new files with nowhere else to go, and your whiteboards') : undefined))}
          </nav>
        )}
        <div className="sd-list">
          <div className="sd-list-head">
            <b>{title}</b>
            <small className="muted">{shown.length === 1 ? t('1 file') : t('{n} files', { n: shown.length })}</small>
            {kind && found?.capped?.[kind[0]] && <small className="muted">{t('the newest {n} of {total}', { n: found.perKind, total: found.capped[kind[0]].toLocaleString(locale()) })}</small>}
          </div>
          {note && <p className={`sd-files-note small${note.error ? ' error-text' : ' muted'}`} role={note.error ? 'alert' : 'status'}>{note.text}</p>}
          <div className="sd-files-table" role="table" aria-label={title}>
            <div className="sd-files-row head" role="row"><span role="columnheader">{t('Name')}</span><span role="columnheader">{t('Folder')}</span><span role="columnheader">{t('Changed')}</span><span role="columnheader" aria-label={t('Open')} /></div>
            {shown.map((f) => {
              const d = describe(f)
              // A kind Studio doesn't open (an older Word file, Keynote…): its own app opens it, from a
              // window on its computer; anywhere else that's said rather than offered.
              const other = f.opens === false
              const open = other ? (inApp ? () => openInApp(f) : null) : () => onOpen({ root: f.root, path: f.path })
              const inner = <>
                <span className={`sd-file-ic${f.kind ? ` k-${f.kind}` : ''}`}><Icon name={KIND_ICON[f.kind] || 'file'} size={15} /></span>
                <span className="sd-file-text"><b>{f.name}</b><small className="muted">{other ? t('{kind}, opened in its own app', { kind: d.kind }) : d.kind}</small></span>
              </>
              return (
                <div key={keyOf(f)} className={`sd-files-row${other ? ' other' : ''}`} role="row">
                  {open ? <button type="button" role="cell" className="sd-file-name" onClick={open} title={d.full || f.path}>{inner}</button> : <span role="cell" className="sd-file-name" title={d.full || f.path}>{inner}</span>}
                  <span role="cell" className="sd-file-dir" title={d.full || d.folder || ''}><Icon name="folder" size={12} /><span>{d.folder || '—'}</span></span>
                  <span role="cell" className="sd-file-when" title={f.changed ? new Date(f.changed).toLocaleString(locale()) : f.opened ? new Date(f.opened).toLocaleString(locale()) : ''}>{f.changed ? ago(f.changed) : f.opened ? t('Opened {when}', { when: ago(f.opened) }) : ''}</span>
                  <span role="cell" className="sd-file-acts">
                    {!other && <button type="button" className="btn small" onClick={open} aria-label={t('Open {name}', { name: f.name })} title={t('Open it in Preview, in its own editor')}>{t('Open')}</button>}
                    {other && inApp && <button type="button" className="btn small" onClick={open} aria-label={t('Open {name} in its app', { name: f.name })} title={t("Studio doesn't open this kind of file: open it in the app that usually does")}><Icon name="external" size={11} /> {t('Open in app')}</button>}
                    {other && !inApp && <span className="sd-file-away muted small" title={t("Studio doesn't open this kind of file, and its app opens it only in a window on the computer it's on")}>{t('Open it on its computer')}</span>}
                    {f.mine && <button type="button" className="ghost-btn sd-file-x" aria-label={t('Take {name} off the list', { name: f.name })} title={t('Take it off the list (the file stays)')} onClick={() => forget(f)}><Icon name="x" size={12} /></button>}
                  </span>
                </div>
              )
            })}
            {looking && !found && <div className="sd-files-row wait" role="row"><span role="cell" className="muted small"><Icon name="refresh" size={12} className="spin" /> {t('Looking for your files…')}</span></div>}
            {!shown.length && (found || !looking) && <div className="sd-files-none" role="row"><span role="cell">{none}</span></div>}
          </div>
        </div>
      </div>
      {found && !found.error && (
        <p className="sd-files-src muted small">
          {sources.length ? t('From {sources}, and what you opened in Studio.', { sources: sources.join(t(' and ')) }) : t('From what you opened in Studio.')}
          {capped.length > 0 && <> {t('The newest {n} of each kind are listed; there are more: {list}.', { n: found.perKind, list: capped.map(([k, n]) => `${t(KINDS.find((x) => x[0] === k)?.[1] || k)} ${n.toLocaleString(locale())}`).join(', ') })}</>}
          {found.skipped > 0 && <> {t('In your projects\' code only documents and decks are listed, not its Markdown, text, pages and data ({n} files): open those from the agent\'s Files.', { n: found.skipped })}</>}
          {found.errors?.map((e) => <span key={e.source} className="sd-files-err" role="status"> {e.partial ? (e.source === 'spotlight' ? t('Spotlight took too long to answer, so some files may be missing. Look again to try once more.') : t('A folder was slow to answer and the look ran out of time, so some files may be missing. Look again to try once more.')) : e.source === 'spotlight' ? t("Couldn't ask Spotlight: {error}", { error: e.error }) : t("Couldn't read {source}: {error}", { source: t(SOURCE[e.source] || e.source), error: e.error })}</span>)}
          {boards.error && !boards.data && <span className="sd-files-err" role="status"> {t("Couldn't read {source}: {error}", { source: t(SOURCE.boards), error: boards.error })}</span>}
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
