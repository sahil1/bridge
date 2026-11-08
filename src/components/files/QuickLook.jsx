// Quick Look, as Finder's: the file picked, shown over the folder with Space, and the one before or
// after it with the arrow keys; Space or Esc closes it. The viewer's own previews (Files.jsx,
// FileMedia.jsx, FileExtras.jsx), read only: text and code, Markdown as it reads, a page in its
// sandbox, pictures, PDFs, videos and sounds, Word, Excel and PowerPoint, and anything else to
// download. On another of your computers too, through the link to it (base).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'
import { t } from '../../i18n/index.js'
import { Code, Markdown, HtmlView } from '../Files.jsx'
import { MediaView, PictureView, OtherFile } from '../FileMedia.jsx'
import { OfficeView } from '../FileExtras.jsx'
import { Thumb } from './views.jsx'
import { getJson, rawUrl, enc, kindName, fmtSize, fmtWhen } from './fsapi.js'

export default function QuickLook({ base, root, entry, at, count, cloud, onClose, onStep, onOpen, openLabel, onInfo, onOpenPath }) {
  const [st, setSt] = useState({ loading: true })
  const box = useRef(null)
  const folder = entry.dir || entry.pkg
  useEffect(() => {
    if (folder) { setSt({}); return }
    let live = true
    setSt({ loading: true })
    getJson(base, `/agents/${enc(root)}/file?path=${enc(entry.path)}`).then((f) => { if (live) setSt({ f }) }, (e) => { if (live) setSt({ error: e.message }) })
    return () => { live = false }
  }, [base, root, entry.path, entry.mtime, folder])
  useEffect(() => { box.current?.focus() }, [])
  const onKey = (e) => {
    const typing = e.target.closest?.('input, textarea, select, video, audio')
    if (e.key === 'Escape' || (e.key === ' ' && !typing)) { e.preventDefault(); e.stopPropagation(); onClose(); return }
    if (typing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); onStep(1) }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); onStep(-1) }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); e.stopPropagation(); onInfo() }
  }
  const f = st.f
  const raw = rawUrl(base, root, entry.path)
  const ext = (f?.ext || '').toLowerCase()
  return createPortal(
    <div className="fx-ql-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="fx-ql" role="dialog" aria-modal="true" aria-label={t('Quick Look: {name}', { name: entry.name })} tabIndex={-1} ref={box} onKeyDown={onKey}>
        <header className="fx-ql-head">
          <div className="fx-ql-title">
            <b title={entry.name}>{entry.name}</b>
            <span className="muted small">{[kindName(entry), !folder && fmtSize(entry.size), entry.mtime && fmtWhen(entry.mtime)].filter(Boolean).join(' · ')}{count > 1 ? ` · ${t('{n} of {total}', { n: at + 1, total: count })}` : ''}</span>
          </div>
          <div className="fx-ql-acts">
            {count > 1 && <>
              <button type="button" className="win-btn" onClick={() => onStep(-1)} aria-label={t('The one before')} title={t('The one before (↑)')}><Icon name="up" size={13} /></button>
              <button type="button" className="win-btn" onClick={() => onStep(1)} aria-label={t('The one after')} title={t('The one after (↓)')}><Icon name="down" size={13} /></button>
            </>}
            <button type="button" className="win-btn" onClick={onInfo} aria-label={t('Get Info')} title={t('Get Info (⌘I)')}><Icon name="info" size={13} /></button>
            {openLabel && <button type="button" className="btn small" onClick={onOpen}><Icon name={folder ? 'folder-open' : 'external'} size={12} /> {openLabel}</button>}
            <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')} title={t('Close (Space)')}><Icon name="x" size={14} /></button>
          </div>
        </header>
        {(cloud || entry.offline) && !folder && <p className="fx-ql-note small"><Icon name="cloud" size={12} /> {t('This file is on a cloud drive: showing it downloads it, if it isn\'t here already.')}</p>}
        <div className="fx-ql-body">
          {folder && (
            <div className="fx-ql-folder">
              <Thumb base={base} root={root} e={entry} big />
              <b>{entry.name}</b>
              <span className="muted small">{entry.pkg ? kindName(entry) : t('Folder')}{entry.mtime ? ` · ${t('Modified {when}', { when: fmtWhen(entry.mtime) })}` : ''}</span>
            </div>
          )}
          {st.loading && !folder && <div className="pad"><div className="skeleton-rows"><div /><div /><div /></div></div>}
          {st.error && <div className="viewer-empty"><Icon name="alert" size={22} /><p>{st.error}</p></div>}
          {f?.kind === 'text' && (ext === '.md' || ext === '.markdown'
            ? <Markdown text={f.text} pane={root} filePath={f.path} onOpenPath={onOpenPath} base={base} />
            : /^\.html?$/.test(ext)
              ? <HtmlView pane={root} filePath={f.path} base={base} />
              : <Code text={f.text} ext={ext.slice(1) || f.name.toLowerCase()} />)}
          {f?.truncated && <p className="muted small pad">{t('Showing the first 1 MB.')}</p>}
          {f?.kind === 'image' && <PictureView f={f} src={raw} />}
          {f?.kind === 'pdf' && <iframe className="pdf-view" src={raw} title={f.name} />}
          {(f?.kind === 'video' || f?.kind === 'audio') && <MediaView f={f} src={raw} />}
          {f?.kind === 'office' && <OfficeView pane={root} f={f} base={base} />}
          {f?.kind === 'binary' && <OtherFile f={f} src={raw} />}
        </div>
      </div>
    </div>,
    document.body,
  )
}
