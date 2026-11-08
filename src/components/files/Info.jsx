// Get Info, as Finder's: what it is, how big (a folder's size worked out when you ask, and stopped
// when you close it), where it is, when it was made, changed and last opened, and whether you can
// change it. Renaming and moving to the Trash are named where Finder has them, as coming: Files only
// looks for now.
import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { locale, t } from '../../i18n/index.js'
import { Thumb } from './views.jsx'
import { getJson, enc, kindName, fmtSize, fmtWhen } from './fsapi.js'

const SOON = () => t('Files only looks for now: renaming, moving and deleting are coming.')

export default function Info({ base, root, entry, cloud, onClose, onOpen, openLabel, onReveal, revealLabel, onCopy }) {
  const [d, setD] = useState(null)
  const [sz, setSz] = useState(null) // { busy } | the size | { error }
  const ctl = useRef(null)
  useEffect(() => {
    let live = true
    let timer = null
    setD(null); setSz(null)
    // A folder macOS is asking about (or a slow drive) is asked again until it answers.
    const load = () => getJson(base, `/files/info?root=${enc(root)}&path=${enc(entry.path)}`).then((x) => { if (live) setD(x) }, (e) => {
      if (!live) return
      if (e.code === 'waiting') { setD({ waiting: true }); timer = setTimeout(load, 1500) } else setD({ error: e.message })
    })
    load()
    return () => { live = false; clearTimeout(timer); ctl.current?.abort() }
  }, [base, root, entry.path])
  const count = () => {
    ctl.current?.abort()
    const c = new AbortController()
    ctl.current = c
    setSz({ busy: true })
    getJson(base, `/files/size?root=${enc(root)}&path=${enc(entry.path)}`, { signal: c.signal })
      .then((x) => setSz(x), (e) => setSz(e.name === 'AbortError' ? null : { error: e.message }))
  }
  const stop = () => { ctl.current?.abort(); setSz(null) }
  const num = (n) => n.toLocaleString(locale())
  const folder = d && !d.waiting && !d.error ? d.dir : entry.dir
  const row = (label, value, extra = null) => value != null && value !== '' && (
    <div className="fx-info-row"><dt>{label}</dt><dd>{value}{extra}</dd></div>
  )
  return (
    <aside className="fx-info" role="dialog" aria-label={t('Info: {name}', { name: entry.name })} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <header className="fx-info-head">
        <Thumb base={base} root={root} e={entry} cloud={cloud} big />
        <div className="fx-info-title"><b title={entry.name}>{entry.name}</b><span className="muted small">{kindName({ ...entry, dir: folder })}</span></div>
        <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close Info')} title={t('Close (Esc)')}><Icon name="x" size={14} /></button>
      </header>
      {(!d || d.waiting) && <div className="pad"><div className="skeleton-rows"><div /><div /></div></div>}
      {d?.waiting && <p className="muted small">{entry.guard && !entry.asked ? t('macOS is asking whether Bridge AI may open it: choose Allow in its window.') : t('It\'s taking a while to answer. Bridge AI keeps waiting.')}</p>}
      {d?.error && <p className="error-text small pad">{d.error}</p>}
      {d && !d.error && !d.waiting && (
        <dl className="fx-info-list">
          {row(t('Kind'), kindName({ ...entry, dir: d.dir }))}
          {!d.dir && row(t('Size'), `${fmtSize(d.size)}${d.size >= 1000 ? ` (${t('{n} bytes', { n: num(d.size) })})` : ''}`)}
          {d.dir && (
            <div className="fx-info-row fx-info-size"><dt>{t('Size')}</dt><dd>
              {!sz && <button type="button" className="link-btn" onClick={count}>{t('Work out its size')}</button>}
              {sz?.busy && <span className="muted">{t('Adding it up…')} <button type="button" className="link-btn" onClick={stop}>{t('Stop')}</button></span>}
              {sz?.error && <span className="error-text">{sz.error}</span>}
              {sz && !sz.busy && !sz.error && (
                <span data-size={sz.size}>
                  {sz.files === 1 ? t('{size} in 1 file', { size: fmtSize(sz.size) }) : t('{size} in {files} files', { size: fmtSize(sz.size), files: num(sz.files) })}{sz.partial ? ` ${t('(at least: it stopped part way)')}` : ''}
                  {sz.skipped?.length > 0 && <span className="muted small fx-info-skip">{t('Not counted: {names}. Bridge AI doesn\'t go into them from here.', { names: sz.skipped.join(', ') })}</span>}
                </span>
              )}
            </dd></div>
          )}
          {row(t('Where'), <span className="fx-info-where mono" title={d.full}>{d.where}</span>, <button type="button" className="win-btn" onClick={() => onCopy(d.full)} aria-label={t('Copy path')} title={t('Copy path')}><Icon name="copy" size={12} /></button>)}
          {row(t('Created'), d.created ? fmtWhen(d.created, { long: true }) : null)}
          {row(t('Modified'), fmtWhen(d.modified, { long: true }))}
          {!d.dir && row(t('Last opened'), d.opened ? fmtWhen(d.opened, { long: true }) : null)}
          {row(t('You can'), d.writable ? t('Read and change it') : t('Only read it'))}
          {d.link && row(t('Link'), t('It\'s a link to this'))}
          {(d.offline || (cloud && !d.dir)) && row(t('Cloud'), d.offline ? t('Only in the cloud for now: opening it downloads it') : t('On a cloud drive'))}
        </dl>
      )}
      <div className="fx-info-acts">
        {openLabel && <button type="button" className="btn small" onClick={onOpen}><Icon name={folder ? 'folder-open' : 'external'} size={12} /> {openLabel}</button>}
        {onReveal && <button type="button" className="btn small" onClick={onReveal}><Icon name="folder-open" size={12} /> {revealLabel}</button>}
        <button type="button" className="btn small" disabled title={SOON()}>{t('Rename (coming)')}</button>
        <button type="button" className="btn small" disabled title={SOON()}>{t('Move to Trash (coming)')}</button>
      </div>
      <p className="muted small fx-info-soon">{SOON()}</p>
    </aside>
  )
}
