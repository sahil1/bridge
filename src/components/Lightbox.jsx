// Images full size, one at a time: arrows step through them, Esc closes.
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { t } from '../i18n/index.js'

export default function Lightbox({ pics, at, onAt, onClose }) {
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && at < pics.length - 1) onAt(at + 1)
      if (e.key === 'ArrowLeft' && at > 0) onAt(at - 1)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [at, pics.length, onAt, onClose])
  const p = pics[at]
  return createPortal(
    <div className="lightbox" role="dialog" aria-label={p.name} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <img src={p.src} alt={p.name} />
      <div className="lightbox-bar">
        <span>{p.name}{pics.length > 1 ? ` · ${t('{n} of {total}', { n: at + 1, total: pics.length })}` : ''}</span>
        {pics.length > 1 && <button className="win-btn" disabled={at === 0} onClick={() => onAt(at - 1)} aria-label={t('Previous image')}><Icon name="chevron" size={14} className="flip" /></button>}
        {pics.length > 1 && <button className="win-btn" disabled={at === pics.length - 1} onClick={() => onAt(at + 1)} aria-label={t('Next image')}><Icon name="chevron" size={14} /></button>}
        <a className="win-btn" href={p.src} target="_blank" rel="noreferrer" aria-label={t('Open in a new tab')} title={t('Open in a new tab')}><Icon name="external" size={14} /></a>
        <button className="win-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={14} /></button>
      </div>
    </div>,
    document.body,
  )
}
