import { useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import { usePersisted } from '../layout.jsx'
import { t } from '../../i18n/index.js'
import { SETS } from '../../../shared/whiteboard/catalog.js'
import { GLYPHS } from './shapes/icons.js'
import { iconSvg } from './shapes/make.js'
import { SET_NAMES, nameOf } from './shapes/library.js'

// The Shapes panel, beside the board: the catalog's sets (flowchart, network, containers, and each
// cloud's), searchable. A click adds a shape where you're looking; dragging one puts it where it's
// dropped (Whiteboard.jsx takes the drop).
export const DRAG_TYPE = 'application/x-bridge-shape'

// A small picture of each shape for its button.
function Preview({ item }) {
  if (item.kind === 'icon') return <span className="wb-shape-pic" dangerouslySetInnerHTML={{ __html: iconSvg(item.glyph, item.color).replace('width="64" height="64"', 'width="28" height="28"') }} />
  const st = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }
  const shape = item.kind === 'text' ? <text x="14" y="19" textAnchor="middle" fontSize="15" fill="currentColor">T</text>
    : item.kind === 'container' ? <rect x="3" y="5" width="22" height="18" rx="3" {...st} strokeDasharray={['region', 'zone', 'group'].includes(item.style) ? '3 2' : undefined} />
      : item.kind === 'lanes' ? <><rect x="3" y="4" width="22" height="20" rx="1" {...st} /><path d="M3 11h22M3 17.5h22" {...st} /></>
        : item.shape === 'diamond' ? <path d="M14 4 25 14 14 24 3 14z" {...st} />
          : item.shape === 'ellipse' ? <ellipse cx="14" cy="14" rx="11" ry="8" {...st} />
            : item.shape === 'note' ? <path d="M5 5h18v13l-5 5H5z" {...st} />
              : <rect x="3" y="8" width="22" height="12" rx={item.shape === 'pill' ? 6 : 2.5} {...st} />
  return <span className="wb-shape-pic"><svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">{shape}</svg></span>
}

// onAdd(item): a shape clicked. onClose: the panel closed.
export default function ShapePanel({ onAdd, onClose }) {
  const [q, setQ] = useState('')
  const [shut, setShut] = usePersisted('cc-board-shapes-shut', ['azure', 'gcp'])
  const find = q.trim().toLowerCase()
  const sets = useMemo(() => SETS.map((s) => ({ ...s, items: s.items.filter((it) => !find || `${nameOf(it)} ${it.name} ${it.id} ${it.keywords || ''} ${s.name}`.toLowerCase().includes(find)) })).filter((s) => s.items.length), [find])
  const toggle = (id) => setShut(shut.includes(id) ? shut.filter((x) => x !== id) : [...shut, id])
  return (
    <aside className="wb-shapes" aria-label={t('Shapes')}>
      <div className="wb-shapes-head">
        <b className="small">{t('Shapes')}</b>
        <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={13} /></button>
      </div>
      <label className="wb-shapes-search">
        <Icon name="search" size={12} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search shapes')} aria-label={t('Search shapes')} />
      </label>
      <div className="wb-shapes-list">
        {!sets.length && <p className="muted small">{t('No shape called that.')}</p>}
        {sets.map((s) => {
          const open = find || !shut.includes(s.id)
          return (
            <section key={s.id} className="wb-shapes-set">
              <button type="button" className="wb-shapes-title" aria-expanded={!!open} onClick={() => toggle(s.id)}>
                {s.brand && GLYPHS[s.brand] ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GLYPHS[s.brand] }} /> : null}
                <span>{t(SET_NAMES[s.id] || s.name)}</span>
                <Icon name="chevron" size={11} className={open ? 'open' : ''} />
              </button>
              {open && (
                <div className="wb-shapes-grid">
                  {s.items.map((it) => (
                    <button type="button" key={it.id} className="wb-shape" title={nameOf(it)} onClick={() => onAdd(it, s.id)}
                      draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ id: it.id, set: s.id })); e.dataTransfer.effectAllowed = 'copy' }}>
                      <Preview item={it} />
                      <span>{nameOf(it)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
      <p className="muted small wb-shapes-foot">{t("The cloud sets use open icons in each cloud's colours.")}</p>
    </aside>
  )
}
