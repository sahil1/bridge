// View Options, as Finder's (⌘J): how a folder shows. How it's arranged (Arrange By), in groups by
// kind or not, how big its icons are and how big its names' text. What you change in a folder is
// kept for it (as Finder keeps each folder's), the latest few hundred folders, and the rest follows
// the defaults; Use as Defaults makes this folder's the defaults. On this device, where the folders'
// view and sort were kept before (cc-fx-sort is the default sort, as it was every folder's).
import { useEffect, useRef } from 'react'
import Icon from '../Icon.jsx'
import { usePersisted } from '../layout.jsx'
import { t } from '../../i18n/index.js'
import { ARRANGE, firstWay } from './fsapi.js'

// Finder's range of icon sizes; ⌘+ and ⌘− go a step, ⌘0 back to the usual size.
export const ICON_SIZE = { min: 32, max: 256, step: 16, usual: 64 }
const TEXT_SIZES = [10, 11, 12, 13, 14, 15, 16]
const LOOK = { group: false, icon: ICON_SIZE.usual, text: 13 }
const KEEP = 300

// A folder's, on a computer (null: this one).
export const lookKey = (machine, root, path) => `${machine || ''}\n${root}\n${path || ''}`
const fit = (n) => Math.max(ICON_SIZE.min, Math.min(ICON_SIZE.max, Math.round(Number(n) || ICON_SIZE.usual)))
const same = (a, b) => a.sort.by === b.sort.by && !!a.sort.desc === !!b.sort.desc && a.group === b.group && a.icon === b.icon && a.text === b.text
const without = (o, key) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key))

// How the folder at key shows: { sort, group, icon, text }, what was changed in it its own and the
// rest the defaults; set(change) keeps a change as this folder's own; asDefaults() makes this
// folder's the defaults; useDefaults() lets go of its own; sortAt(key): another folder's sort (the
// columns on the way to this one).
export function useLook(key) {
  const [sort, setSort] = usePersisted('cc-fx-sort', { by: 'name', desc: false })
  const [def, setDef] = usePersisted('cc-fx-look', LOOK)
  const [own, setOwn] = usePersisted('cc-fx-folders', {})
  const base = { sort, group: !!def.group, icon: fit(def.icon), text: Number(def.text) || LOOK.text }
  const mine = own[key] || null
  const look = mine ? { ...base, ...mine, icon: fit(mine.icon ?? base.icon) } : base
  const set = (change) => setOwn((o) => {
    const next = { ...without(o, key), [key]: { ...o[key], ...change, ...(change.icon ? { icon: fit(change.icon) } : {}) } }
    const keys = Object.keys(next)
    return keys.length > KEEP ? Object.fromEntries(keys.slice(-KEEP).map((k) => [k, next[k]])) : next
  })
  const asDefaults = () => { setSort(look.sort); setDef({ group: look.group, icon: look.icon, text: look.text }); setOwn((o) => without(o, key)) }
  const useDefaults = () => setOwn((o) => without(o, key))
  const sortAt = (k) => own[k]?.sort || sort
  const isDefault = same(look, base)
  return { ...look, own: !!mine && !isDefault, isDefault, set, asDefaults, useDefaults, sortAt }
}

// The icon size slider: in the folder's bar while it shows icons, and in View Options.
export function IconSize({ look, className = '' }) {
  return (
    <span className={`fx-size ${className}`} title={t('Icon size: {n} px (⌘+ and ⌘−, ⌘0 for {usual} px)', { n: look.icon, usual: ICON_SIZE.usual })}>
      <Icon name="image" size={10} />
      <input type="range" min={ICON_SIZE.min} max={ICON_SIZE.max} step={8} value={look.icon} onChange={(e) => look.set({ icon: Number(e.target.value) })}
        aria-label={t('Icon size')} aria-valuetext={t('{n} pixels', { n: look.icon })} />
      <Icon name="image" size={15} />
    </span>
  )
}

// The panel, under its button in the folder's bar; onClose(back): closed, back: by Esc or its close
// button (the keys go back to the folder). name: the folder's; icons: it shows as icons (its
// icon size is offered); created: the computer says when its files were made (Arrange By Date
// Created), false when it doesn't (a disk that doesn't keep it: said), null while that isn't known.
export default function ViewOptions({ look, name, icons, created, onClose }) {
  const ref = useRef(null)
  // Closed by a click outside it or Esc (wherever the focus is), as a menu is.
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target) && !e.target.closest?.('.fx-vo-btn')) onClose() }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(true) } }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    ref.current?.querySelector('select')?.focus({ preventScroll: true })
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true) }
  }, [onClose])
  const arrange = ARRANGE.filter(([by]) => by !== 'btime' || created || look.sort.by === 'btime')
  // A button that goes once pressed (Use the Defaults) leaves the focus in the panel.
  const then = (fn) => () => { fn(); ref.current?.focus({ preventScroll: true }) }
  return (
    <div className="fx-vo" role="dialog" aria-label={t('View Options for {name}', { name })} ref={ref} tabIndex={-1}>
      <div className="fx-vo-head">
        <b>{t('View Options')}</b>
        <span className="fx-vo-name muted small" title={name}>{name}</span>
        <button type="button" className="win-btn" onClick={() => onClose(true)} aria-label={t('Close View Options')} title={t('Close (Esc)')}><Icon name="x" size={12} /></button>
      </div>
      <label className="fx-vo-row">
        <span>{t('Arrange By')}</span>
        <select value={look.sort.by} onChange={(e) => look.set({ sort: { by: e.target.value, desc: firstWay(e.target.value) } })}>
          {arrange.map(([by, label]) => <option key={by} value={by}>{t(label)}</option>)}
        </select>
      </label>
      <label className="fx-vo-check"><input type="checkbox" checked={look.group} onChange={(e) => look.set({ group: e.target.checked })} /><span>{t('Group by Kind')}</span></label>
      {icons && <div className="fx-vo-row"><span>{t('Icon Size')}</span><IconSize look={look} /></div>}
      <label className="fx-vo-row">
        <span>{t('Text Size')}</span>
        <select value={look.text} onChange={(e) => look.set({ text: Number(e.target.value) })}>
          {TEXT_SIZES.map((n) => <option key={n} value={n}>{t('{n} pt', { n })}</option>)}
        </select>
      </label>
      {created === false && <p className="fx-vo-note muted small">{t('Date Created isn\'t offered here: this disk doesn\'t say when its files were made.')}</p>}
      <div className="fx-vo-acts">
        {look.own && <button type="button" className="ghost-btn" onClick={then(look.useDefaults)} title={t('Show this folder as the defaults say')}>{t('Use the Defaults')}</button>}
        <button type="button" className="btn small" onClick={then(look.asDefaults)} disabled={look.isDefault}
          title={look.isDefault ? t('This folder shows as the defaults say') : t('Every folder without options of its own shows like this one')}>
          {look.isDefault ? t('These Are the Defaults') : t('Use as Defaults')}
        </button>
      </div>
    </div>
  )
}
