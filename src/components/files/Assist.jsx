// Files Assist: the panel beside Files for the folder on screen. It looks at the folder and the
// folders in it (server/fileinsights.js) and says what takes room and how it could be tidier, each
// with what to do about it. It's read-only: its buttons open a file in Files or show it in Finder,
// nothing else, and moving, renaming and deleting stay yours to do. Ask AI sends the folder's
// names, sizes and dates (never what's in a file) to the model picked for it, and says which model
// that is and where it runs before anything is sent.
//   root, rel   the folder, as the file routes name it: an agent's pane or place:<id>, a path in it
//   machine     another of your computers' id (the look runs there, through the link), or null
//   onOpen      ({ root, rel, dir }) opens that file or folder in Files
//   onClose     closes the panel (optional)
import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import PermissionFix from '../PermissionFix.jsx'
import { BASE, machineId } from '../../api.js'
import { onComputer, REVEAL, fileOp } from '../FileExtras.jsx'
import { t, tx, locale } from '../../i18n/index.js'
import './assist.css'

const enc = encodeURIComponent
// The computer the folder is on: this one (or the one this window shows), or another through it.
async function call(machine, p, { method = 'GET', body } = {}) {
  const base = machine && machine !== machineId ? `/m/${enc(machine)}` : BASE
  const res = await fetch(`${base}/api${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, code: data.code || null, trial: data.trial || null })
  return data
}

const fmtNum = (n) => new Intl.NumberFormat(locale()).format(n || 0)
function fmtSize(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let x = n || 0
  let i = 0
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++ }
  return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: i && x < 10 ? 1 : 0 }).format(x)} ${units[i]}`
}
const fmtDay = (ms) => new Date(ms).toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' })
const baseName = (rel) => rel.split('/').pop()
const parentOf = (rel) => rel.split('/').slice(0, -1).join('/')
// The name a set of copies goes by: the plainest of theirs ("beach.jpg", not "beach copy.jpg").
const COPYISH = / copy\b|\(\d+\)/i
const plainest = (rels) => rels.map(baseName).sort((a, b) => COPYISH.test(a) - COPYISH.test(b) || a.length - b.length)[0]
const plural = (n, one, many, vars = {}) => (n === 1 ? t(one, vars) : t(many, { n: fmtNum(n), ...vars }))

// What each kind of file is called, for a folder suggested for it.
const KIND = { image: tx('Images'), screenshot: tx('Screenshots'), video: tx('Videos'), audio: tx('Music and sounds'), document: tx('Documents'), sheet: tx('Spreadsheets'), slides: tx('Presentations'), archive: tx('Archives'), installer: tx('Installers'), code: tx('Code') }
const SECTIONS = [
  { id: 'duplicates', label: tx('Duplicates'), icon: 'copy' },
  { id: 'large', label: tx('Large Files'), icon: 'layers' },
  { id: 'old', label: tx('Old and Forgotten'), icon: 'clock' },
  { id: 'organize', label: tx('Organization'), icon: 'folder' },
]
const SHOWN = 5

export default function Assist({ root, rel = '', machine = null, onOpen, onClose }) {
  const [scan, setScan] = useState(null)
  const [err, setErr] = useState(null)
  const asked = useRef('')
  const key = `${machine || ''}\n${root}\n${rel}`
  const look = useCallback(async (fresh = false) => {
    setErr(null)
    asked.current = key
    try {
      const v = await call(machine, '/files/insights', { method: 'POST', body: { root, rel, fresh } })
      if (asked.current === key) setScan(v)
    } catch (e) { if (asked.current === key) setErr(e) }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setScan(null); look(false) }, [look])
  // While it looks (or the model answers), asked again every moment.
  const busy = scan && (scan.state === 'running' || scan.ask?.state === 'running')
  useEffect(() => {
    if (!busy) return
    const id = setTimeout(async () => {
      try { const v = await call(machine, `/files/insights/${scan.id}`); if (asked.current === key) setScan(v) } catch (e) { if (asked.current === key) { setErr(e); setScan(null) } }
    }, scan.state === 'running' ? 600 : 1000)
    return () => clearTimeout(id)
  }, [scan, busy]) // eslint-disable-line react-hooks/exhaustive-deps
  const stop = async () => { try { setScan(await call(machine, `/files/insights/${scan.id}`, { method: 'DELETE' })) } catch (e) { setErr(e) } }

  // Open is Files' own; Show in Finder only for a folder on the computer this window runs on.
  const reveal = onComputer && !machine && !machineId
  const [note, setNote] = useState(null)
  const act = useCallback(async (what, r, dir) => {
    if (what === 'open') return onOpen?.({ root, rel: r, dir: !!dir })
    try { await fileOp(root, 'reveal', r) } catch (e) { setNote(e.message) }
  }, [root, onOpen])

  const name = scan?.name || baseName(rel) || t('This folder')
  const where = machine && scan?.computer ? scan.computer : null
  const bodyRef = useRef(null)
  const jump = (id) => bodyRef.current?.querySelector(`#fa-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <aside className="fa-panel" aria-label={t('Files Assist')}>
      <header className="fa-head">
        <Icon name="sparkle" size={15} />
        <div className="fa-title">
          <h2>{t('Files Assist')}</h2>
          <span className="fa-where" title={rel || name}>{where ? t('{folder} on {computer}', { folder: name, computer: where }) : name}</span>
        </div>
        <button type="button" className="win-btn" onClick={() => look(true)} disabled={scan?.state === 'running'} title={t('Look again')} aria-label={t('Look again')}><Icon name="refresh" size={13} /></button>
        {onClose && <button type="button" className="win-btn" onClick={onClose} title={t('Close Files Assist')} aria-label={t('Close Files Assist')}><Icon name="x" size={13} /></button>}
      </header>
      <div className="fa-body" ref={bodyRef}>
        <p className="fa-promise"><Icon name="eye" size={13} /> <span><b>{t('Read-only')}</b> {t('Nothing here moves, renames or deletes a file: what to do with each stays yours to do.')}</span></p>
        {err && <Problem err={err} machine={machine} where={where} onAgain={() => look(true)} />}
        {!scan && !err && <p className="fa-state muted"><Icon name="refresh" size={13} className="spin" /> {t('Starting to look…')}</p>}
        {scan?.state === 'running' && <Progress scan={scan} onStop={stop} />}
        {scan?.state === 'failed' && <Failed scan={scan} machine={machine} where={where} onAgain={() => look(true)} />}
        {scan?.state === 'stopped' && <p className="fa-note-box"><Icon name="stop" size={13} /> <span>{t('Stopped. What\'s below is from the part it looked at.')} <button type="button" className="link-btn" onClick={() => look(true)}>{t('Look again')}</button></span></p>}
        {note && <p className="error-text">{note}</p>}
        {scan?.found && (
          <>
            <Tiles found={scan.found} onJump={jump} />
            <Duplicates d={scan.found.duplicates} act={act} reveal={reveal} />
            <Large l={scan.found.large} act={act} reveal={reveal} />
            <Old o={scan.found.old} here={name} act={act} reveal={reveal} />
            <Organize o={scan.found.organize} here={name} act={act} reveal={reveal} />
            {scan.state !== 'failed' && <AskAI scan={scan} machine={machine} where={where} onScan={setScan} />}
            <Skipped list={scan.skipped} />
            <p className="fa-foot muted small">
              {t('Looked at {files} files in {folders} folders ({size}) at {time}.', { files: fmtNum(scan.progress.files), folders: fmtNum(scan.progress.folders), size: fmtSize(scan.progress.bytes), time: new Date(scan.finished || scan.started).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' }) })}
            </p>
          </>
        )}
      </div>
    </aside>
  )
}

// ---------- While it looks, and when it can't ----------
function Progress({ scan, onStop }) {
  const p = scan.progress
  const w = scan.waiting
  return (
    <div className="fa-progress" role="status">
      <p><Icon name="refresh" size={13} className="spin" /> {p.phase === 'comparing'
        ? t('Comparing files of the same size: {done} of {total}…', { done: fmtNum(p.hashed), total: fmtNum(p.toHash) })
        : p.files || p.folders ? t('Looking: {files} files in {folders} folders, {size}…', { files: fmtNum(p.files), folders: fmtNum(p.folders), size: fmtSize(p.bytes) })
        : t('Starting to look in {folder}…', { folder: scan.name })}</p>
      {w && (w.macos
        ? <p className="fa-wait"><Icon name="alert" size={13} /> <span>{t('macOS is asking whether Bridge AI may look in {folder}. Answer its question to carry on (it may be behind this window).', { folder: w.macos })}</span></p>
        : <p className="fa-wait"><Icon name="clock" size={13} /> <span>{t('Still waiting for {folder} to answer. A network or cloud drive can be slow.', { folder: scan.name })}</span></p>)}
      <button type="button" className="btn small" onClick={onStop}><Icon name="stop" size={12} /> {t('Stop')}</button>
    </div>
  )
}

function Problem({ err, machine, where, onAgain }) {
  const on = where || t('that computer')
  const text = err.trial && machine ? t('Files is a beta feature on {computer} too. Turn it on there in Settings › About & Updates › Beta Features.', { computer: on })
    : err.status === 404 && machine && !err.code ? t('Update Bridge AI on {computer} to use Files Assist there.', { computer: on })
    : err.message
  return <div className="fa-problem"><p className="error-text">{text}</p><button type="button" className="btn small" onClick={onAgain}><Icon name="refresh" size={12} /> {t('Try again')}</button></div>
}

function Failed({ scan, machine, where, onAgain }) {
  // macOS said no to Desktop, Documents or Downloads: allowed in one place, on this computer.
  if (scan.code === 'EPERM' && !machine && ['Desktop', 'Documents', 'Downloads'].includes(scan.folder)) {
    return <PermissionFix pane="files" folder={scan.folder} onCheck={onAgain}><p>{t('This folder is in your {folder} folder, and macOS hasn\'t let Bridge AI look in it.', { folder: scan.folder })}</p></PermissionFix>
  }
  const how = scan.code === 'EPERM' ? (machine
    ? t('Allow Bridge AI on {computer} in System Settings › Privacy & Security › Files and Folders, then look again.', { computer: where || t('that computer') })
    : t('Allow Bridge AI in System Settings › Privacy & Security › Files and Folders (or Full Disk Access), then look again.'))
    : scan.code === 'timeout' && scan.folder ? t('Look again and answer macOS\'s question when it comes up.') : null
  return (
    <div className="fa-problem">
      <p className="error-text">{scan.error}</p>
      {how && <p className="small">{how}</p>}
      <button type="button" className="btn small" onClick={onAgain}><Icon name="refresh" size={12} /> {t('Look again')}</button>
    </div>
  )
}

// ---------- What it found ----------
function Tiles({ found, onJump }) {
  const o = found.organize
  const tidy = o.loose.length + o.versions.length + o.copies.length + o.empty.length + o.chains.length
  const val = {
    duplicates: found.duplicates.count ? fmtSize(found.duplicates.wasted) : t('None'),
    large: found.large.files.length + found.large.folders.length ? fmtNum(found.large.files.length + found.large.folders.length) : t('None'),
    old: found.old.count || found.old.installers.length || found.old.archives.length || found.old.screenshots.length ? fmtSize(found.old.bytes + found.old.installers.reduce((n, f) => n + f.size, 0)) : t('None'),
    organize: tidy ? fmtNum(tidy) : t('None'),
  }
  return (
    <div className="fa-tiles">
      {SECTIONS.map((s) => (
        <button key={s.id} type="button" className="fa-tile" onClick={() => onJump(s.id)}>
          <span className="fa-tile-label"><Icon name={s.icon} size={12} /> {t(s.label)}</span>
          <b>{val[s.id]}</b>
        </button>
      ))}
    </div>
  )
}

function Section({ id, title, icon, lead, children, empty }) {
  return (
    <section className="fa-section" id={`fa-${id}`} aria-label={title}>
      <h3><Icon name={icon} size={13} /> {title}</h3>
      {lead && <p className="fa-lead">{lead}</p>}
      {children || <p className="muted small">{empty}</p>}
    </section>
  )
}
// A list that shows the first few, and the rest on asking.
function More({ items, n = SHOWN, children }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, n)
  return (
    <>
      {shown.map(children)}
      {items.length > n && <button type="button" className="link-btn fa-more" onClick={() => setAll(!all)}>{all ? t('Show fewer') : t('Show all {n}', { n: fmtNum(items.length) })}</button>}
    </>
  )
}
function Acts({ rel, dir, act, reveal }) {
  return (
    <span className="fa-acts">
      <button type="button" className="fa-act" onClick={() => act('open', rel, dir)} title={dir ? t('Open this folder in Files') : t('Open in Files')} aria-label={t('Open {name}', { name: baseName(rel) || rel })}><Icon name={dir ? 'folder-open' : 'open'} size={13} /></button>
      {reveal && <button type="button" className="fa-act" onClick={() => act('reveal', rel, dir)} title={t(REVEAL)} aria-label={t('{action}: {name}', { action: t(REVEAL), name: baseName(rel) || rel })}><Icon name="search" size={13} /></button>}
    </span>
  )
}
function Row({ rel, dir = false, size, note, act, reveal }) {
  return (
    <li className="fa-row">
      <Icon name={dir ? 'folder' : 'file'} size={13} className="fa-row-icon" />
      <span className="fa-row-main">
        <span className="fa-name" title={rel}>{baseName(rel) || rel}</span>
        {(parentOf(rel) || note) && <span className="fa-path">{[parentOf(rel), note].filter(Boolean).join(' · ')}</span>}
      </span>
      {size != null && <span className="fa-size">{fmtSize(size)}</span>}
      <Acts rel={rel} dir={dir} act={act} reveal={reveal} />
    </li>
  )
}
const Do = ({ children }) => <p className="fa-do"><Icon name="bulb" size={12} /> <span>{children}</span></p>

function Duplicates({ d, act, reveal }) {
  return (
    <Section id="duplicates" title={t('Duplicates')} icon="copy" empty={t('No duplicates: no two files here are the same.')}
      lead={d.count ? plural(d.count, 'One file is in more than one place, taking {size} more than it needs.', '{n} files are in more than one place, taking {size} more than they need.', { size: fmtSize(d.wasted) }) : null}>
      {d.count > 0 && (
        <More items={d.groups}>
          {(g) => (
            <div key={g.files.join('\n')} className="fa-group">
              <p className="fa-group-head"><b>{t('{n} copies of {name}', { n: fmtNum(g.count), name: plainest(g.files) })}</b> <span className="muted">{t('{size} each', { size: fmtSize(g.size) })}</span></p>
              <ul className="fa-list">{g.files.map((r) => <Row key={r} rel={r} act={act} reveal={reveal} />)}</ul>
              <Do>{t('They\'re the same, byte for byte. Keep the one where you\'d look for it, and delete the others yourself to free {size}.', { size: fmtSize(g.wasted) })}</Do>
            </div>
          )}
        </More>
      )}
    </Section>
  )
}

function Large({ l, act, reveal }) {
  const none = !l.files.length && !l.folders.length
  return (
    <Section id="large" title={t('Large Files')} icon="layers" empty={t('Nothing here is over 10 MB.')}>
      {!none && (
        <>
          {l.files.length > 0 && <ul className="fa-list"><More items={l.files}>{(f) => <Row key={f.rel} rel={f.rel} size={f.size} note={fmtDay(f.mt)} act={act} reveal={reveal} />}</More></ul>}
          {l.files.length > 0 && <Do>{t('The biggest files take the most room. Move what you\'re keeping to an external drive or cloud storage, and delete what you don\'t need.')}</Do>}
          {l.folders.length > 0 && (
            <>
              <h4>{t('Large Folders')}</h4>
              <ul className="fa-list">{l.folders.map((f) => <Row key={f.rel} rel={f.rel} dir size={f.size} note={plural(f.files, 'one file', '{n} files')} act={act} reveal={reveal} />)}</ul>
              <Do>{t('Open the biggest folder to see what fills it.')}</Do>
            </>
          )}
        </>
      )}
    </Section>
  )
}

function Old({ o, here, act, reveal }) {
  const none = !o.count && !o.installers.length && !o.archives.length && !o.screenshots.length
  return (
    <Section id="old" title={t('Old and Forgotten')} icon="clock" empty={t('Everything here was opened or changed in the past year.')}>
      {!none && (
        <>
          {o.count > 0 && (
            <>
              <p className="fa-lead">{plural(o.count, 'One file, {size}, not opened or changed in over a year.', '{n} files, {size}, not opened or changed in over a year.', { size: fmtSize(o.bytes) })}</p>
              <ul className="fa-list"><More items={o.files}>{(f) => <Row key={f.rel} rel={f.rel} size={f.size} note={t('last used {date}', { date: fmtDay(f.last) })} act={act} reveal={reveal} />}</More></ul>
              <Do>{t('Archive what you might need again (an external drive, a zip), and delete what you won\'t.')}</Do>
            </>
          )}
          {o.installers.length > 0 && (
            <>
              <h4>{t('Installers in Downloads')}</h4>
              <ul className="fa-list"><More items={o.installers}>{(f) => <Row key={f.rel} rel={f.rel} size={f.size} note={fmtDay(f.mt)} act={act} reveal={reveal} />}</More></ul>
              <Do>{t('Once an app is installed, its installer isn\'t needed. Delete the ones you\'ve installed.')}</Do>
            </>
          )}
          {o.archives.length > 0 && (
            <>
              <h4>{t('Archives Already Unpacked')}</h4>
              <ul className="fa-list"><More items={o.archives}>{(f) => <Row key={f.rel} rel={f.rel} size={f.size} note={t('unpacked in {folder}', { folder: baseName(f.unpacked) })} act={act} reveal={reveal} />}</More></ul>
              <Do>{t('The folder beside each has what\'s in it, so the archive is a second copy. Delete it if the folder has everything.')}</Do>
            </>
          )}
          {o.screenshots.map((s) => (
            <div key={s.folder} className="fa-group">
              <p className="fa-group-head"><b>{t('{n} screenshots in {folder}', { n: fmtNum(s.count), folder: s.folder || here })}</b> <span className="muted">{t('{size}, since {date}', { size: fmtSize(s.bytes), date: fmtDay(s.oldest) })}</span></p>
              <ul className="fa-list"><Row rel={s.folder} dir act={act} reveal={reveal} /></ul>
              <Do>{t('Screenshots pile up. Keep the ones you need in a Screenshots folder, and delete the rest.')}</Do>
            </div>
          ))}
        </>
      )}
    </Section>
  )
}

function Organize({ o, here, act, reveal }) {
  const none = !o.loose.length && !o.versions.length && !o.copies.length && !o.empty.length && !o.chains.length
  return (
    <Section id="organize" title={t('Organization')} icon="folder" empty={t('Nothing to tidy here: it\'s organized already.')}>
      {!none && (
        <>
          {o.loose.map((x) => (
            <div key={x.folder} className="fa-group">
              <p className="fa-group-head"><b>{t('{n} files straight in {folder}', { n: fmtNum(x.files), folder: x.folder || here })}</b>{x.mixed && <span className="muted"> {t('of many kinds')}</span>}</p>
              <ul className="fa-list"><Row rel={x.folder} dir act={act} reveal={reveal} /></ul>
              {x.suggest.length > 0 && (
                <div className="fa-suggest">
                  <p className="small">{t('A suggestion: a folder for each kind, such as')}</p>
                  <ul>{x.suggest.map((k) => <li key={k.kind}><Icon name="folder" size={12} /> {t(KIND[k.kind] || k.kind)} <span className="muted">{fmtNum(k.count)}</span></li>)}</ul>
                </div>
              )}
              <Do>{t('Many files in one place are hard to find again. Sort them into a few folders, and keep new ones going where they belong.')}</Do>
            </div>
          ))}
          {o.versions.length > 0 && (
            <>
              <h4>{t('Versions of the Same File')}</h4>
              <More items={o.versions}>
                {(v) => (
                  <div key={`${v.folder}\n${v.name}`} className="fa-group">
                    <p className="fa-group-head"><b>{t('{n} versions of {name}', { n: fmtNum(v.files.length), name: v.name })}</b></p>
                    <ul className="fa-list">{v.files.map((f, i) => <Row key={f.rel} rel={f.rel} size={f.size} note={i === 0 ? t('newest, {date}', { date: fmtDay(f.mt) }) : fmtDay(f.mt)} act={act} reveal={reveal} />)}</ul>
                    <Do>{t('Keep the newest where it is, and put the others in an Old versions folder or delete them.')}</Do>
                  </div>
                )}
              </More>
            </>
          )}
          {o.copies.length > 0 && (
            <>
              <h4>{t('Copies Beside the Original')}</h4>
              <ul className="fa-list"><More items={o.copies}>{(c) => <Row key={c.rel} rel={c.rel} size={c.size} note={c.same === true ? t('the same as {name}', { name: baseName(c.of) }) : c.same === false ? t('differs from {name}', { name: baseName(c.of) }) : t('a copy of {name}', { name: baseName(c.of) })} act={act} reveal={reveal} />}</More></ul>
              <Do>{t('Give a copy a name that says how it differs, or delete it if you don\'t need it.')}</Do>
            </>
          )}
          {o.empty.length > 0 && (
            <>
              <h4>{t('Empty Folders')}</h4>
              <ul className="fa-list"><More items={o.empty}>{(r) => <Row key={r} rel={r} dir act={act} reveal={reveal} />}</More></ul>
              <Do>{t('Nothing is in them. Delete the ones you don\'t need.')}</Do>
            </>
          )}
          {o.chains.length > 0 && (
            <>
              <h4>{t('Folders Inside Folders')}</h4>
              <ul className="fa-list">{o.chains.map((c) => <Row key={c.from} rel={c.to} dir note={t('{n} folders deep, one inside the other', { n: fmtNum(c.depth) })} act={act} reveal={reveal} />)}</ul>
              <Do>{t('Each folder above it holds only one folder. Move what\'s at the bottom up, and delete the empty folders above it.')}</Do>
            </>
          )}
        </>
      )}
    </Section>
  )
}

// ---------- Ask AI ----------
function AskAI({ scan, machine, where, onScan }) {
  const [info, setInfo] = useState(null)
  const [err, setErr] = useState(null)
  const load = useCallback(() => call(machine, '/files/assist/model').then(setInfo, (e) => setErr(e.message)), [machine])
  useEffect(() => { load() }, [load])
  const a = scan.ask
  const running = a?.state === 'running'
  const pick = async (id) => { setErr(null); try { setInfo(await call(machine, '/files/assist/model', { method: 'PUT', body: { model: id || null } })) } catch (e) { setErr(e.message) } }
  const go = async () => { setErr(null); try { onScan(await call(machine, `/files/insights/${scan.id}/ask`, { method: 'POST', body: {} })) } catch (e) { setErr(e.message) } }
  const m = info?.model
  const place = where || info?.computer
  const onIt = machine ? t('on {computer}, where the folder is', { computer: place || t('that computer') }) : t('on this computer')
  return (
    <Section id="ask" title={t('Ask AI')} icon="sparkle" lead={t('A model suggests how to organize this folder from its file and folder names, sizes and dates. It never sees what\'s in a file.')}>
      {!info && !err && <p className="muted small">{t('Finding the models you can ask…')}</p>}
      {info && (
        <div className="fa-model">
          {m
            ? <p className={`fa-privacy ${m.local ? 'here' : 'away'}`}><Icon name={m.local ? 'laptop' : 'cloud'} size={13} /> <span>{m.local
              ? t('The names go to {model}, {where}. Nothing leaves it.', { model: m.label, where: onIt })
              : t('The names go to {model} ({provider}), over the internet. Nothing else does.', { model: m.label, provider: m.provider || t('a provider') })}</span></p>
            : <p className="fa-privacy"><Icon name="info" size={13} /> <span>{info.models.length
              ? machine ? t('Pick the model to ask. One on {computer} keeps the names there; one elsewhere gets them over the internet.', { computer: place || t('that computer') })
                : t('Pick the model to ask. One on this computer keeps the names here; one elsewhere gets them over the internet.')
              : machine ? t('No model to ask on {computer} yet. Download the local model built in there, or add one, in its Settings › Model Providers.', { computer: place || t('that computer') })
                : t('No model to ask yet. Download the local model built in, or add one, in Settings › Model Providers.')}</span></p>}
          {info.missing && <p className="small muted">{t('The model picked before ({model}) isn\'t available any more.', { model: info.missing })}</p>}
          {info.models.length > 0 && (
            <label className="fa-pick">
              <span className="small muted">{t('Model')}</span>
              <select value={m?.id || ''} onChange={(e) => pick(e.target.value)} aria-label={t('Model for Ask AI')}>
                {!m && <option value="">{t('Pick a model…')}</option>}
                {info.models.map((x) => <option key={x.id} value={x.id}>{x.local ? t('{model}, on {computer}', { model: x.label, computer: machine ? place || t('that computer') : t('this computer') }) : t('{model}, {provider}', { model: x.label, provider: x.provider || '' })}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="btn small primary fa-ask" disabled={!m || running} onClick={go}>
            <Icon name={running ? 'refresh' : 'sparkle'} size={12} className={running ? 'spin' : ''} /> {running ? t('Asking {model}…', { model: m?.label || '' }) : a ? t('Ask again') : m ? t('Ask {model}', { model: m.label }) : t('Ask AI')}
          </button>
        </div>
      )}
      {err && <p className="error-text">{err}</p>}
      {a?.state === 'failed' && <p className="error-text">{a.error}</p>}
      {a?.state === 'done' && (
        <div className="fa-answer">
          {a.error && <p className="error-text">{a.error}</p>}
          {a.plan?.summary && <p>{a.plan.summary}</p>}
          {a.plan?.folders.length > 0 && (
            <ul className="fa-plan">
              {a.plan.folders.map((f, i) => (
                <li key={i}>
                  <Icon name="folder" size={13} /> <b>{f.name}</b> <span className="muted">{f.holds}</span>
                  {f.examples.length > 0 && <span className="fa-examples">{f.examples.map((x) => baseName(x)).join(', ')}</span>}
                </li>
              ))}
            </ul>
          )}
          {a.plan?.steps.length > 0 && <ol className="fa-steps">{a.plan.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
          {a.text && <p className="fa-text">{a.text}</p>}
          <p className="muted small">{t('A suggestion from {model}, {where}. It changed nothing.', { model: a.model.label, where: a.model.local ? onIt : a.model.provider || t('over the internet') })}</p>
          {a.sent?.text && (
            <details className="fa-sent">
              <summary>{t('What was sent: {n} names, sizes and dates', { n: fmtNum(a.sent.files + a.sent.folders) })}</summary>
              <pre>{a.sent.text}</pre>
            </details>
          )}
        </div>
      )}
    </Section>
  )
}

// ---------- What it left out ----------
const WHY = { denied: tx('not allowed'), slow: tx('took too long'), gone: tx('gone meanwhile'), error: tx('couldn\'t be read') }
const list = (xs) => xs.join(', ')
function Skipped({ list: items }) {
  if (!items?.length) return null
  const line = (s) => {
    switch (s.kind) {
      case 'cloud': return plural(s.count, 'One file is only in the cloud, not on this computer, so it wasn\'t read: reading it would download it.', '{n} files are only in the cloud, not on this computer, so they weren\'t read: reading one would download it.') + (s.examples?.length ? ` (${list(s.examples.map(baseName))})` : '')
      case 'protected': return t('Folders macOS asks about before any app looks inside were left out: {list}. Open one and use Files Assist there.', { list: list(s.paths) })
      case 'tools': return t('Folders kept by tools were left out: {list}.', { list: list(s.names) })
      case 'disk': return t('Folders on another disk were left out: {list}.', { list: list(s.paths) })
      case 'unreadable': return plural(s.count, 'One couldn\'t be read: {list}.', '{n} couldn\'t be read: {list}.', { list: list(s.paths.map((p) => `${p.rel} (${t(WHY[p.why] || WHY.error)})`)) })
      case 'unhashed': return plural(s.count, 'One file wasn\'t compared, to keep the look short.', '{n} files of the same size ({size}) weren\'t compared, to keep the look short.', { size: fmtSize(s.bytes) })
      case 'deep': return t('Folders more than {n} deep were left out.', { n: s.depth })
      case 'limit': return t('It stopped after {n} files. Use Files Assist on a folder inside this one to see more of it.', { n: fmtNum(s.files) })
      case 'links': return plural(s.count, 'One link wasn\'t followed.', '{n} links weren\'t followed.')
      case 'hidden': return plural(s.count, 'One hidden file or folder was left out.', '{n} hidden files and folders were left out.')
      default: return null
    }
  }
  return (
    <Section id="skipped" title={t('Not Looked At')} icon="eye-off">
      <ul className="fa-skipped">{items.map((s) => { const l = line(s); return l && <li key={s.kind} data-kind={s.kind}>{l}</li> })}</ul>
    </Section>
  )
}
