import { useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, refetch } from '../../api.js'
import { TranscribeAgain } from './tools.jsx'
import { ConfirmDelete, FolderPick, foldersOf, chiefSaid } from './actions.jsx'
import { t, locale } from '../../i18n/index.js'

// Lists of meetings, in the sidebar and on the Meetings page: grouped by day, and several picked at
// once (⌘ or Ctrl-click, Shift-click for a run, or the boxes on the Meetings page) for what can be
// done to all of them together.

export const day = (iso) => {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((today - new Date(d).setHours(0, 0, 0, 0)) / 86400000)
  return diff === 0 ? t('Today') : diff === 1 ? t('Yesterday') : d.toLocaleDateString(locale(), { weekday: diff < 7 ? 'long' : undefined, month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
}
export const timeOf = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
export function byDay(list) {
  const groups = []
  for (const x of list) { const d = day(x.startedAt); if (groups.at(-1)?.d !== d) groups.push({ d, items: [] }); groups.at(-1).items.push(x) }
  return groups
}

export function useSelection(list) {
  const [picked, setPicked] = useState(() => new Set())
  const [anchor, setAnchor] = useState(null)
  const ids = useMemo(() => list.map((x) => x.id), [list])
  // Only ones still in the list (one deleted elsewhere drops out).
  const sel = useMemo(() => new Set([...picked].filter((id) => ids.includes(id))), [picked, ids])
  const toggle = (id, { range = false } = {}) => {
    setPicked((s) => {
      const n = new Set([...s].filter((x) => ids.includes(x)))
      if (range && anchor && ids.includes(anchor)) {
        const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y)
        for (const x of ids.slice(a, b + 1)) n.add(x)
      } else if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
    setAnchor(id)
  }
  return { sel, toggle, clear: () => setPicked(new Set()), all: () => setPicked(new Set(ids)) }
}

function said(action, r) {
  const n = r.done.length
  const ok = {
    delete: n === 1 ? t('Deleted {n} meeting.', { n }) : t('Deleted {n} meetings.', { n }),
    archive: n === 1 ? t('Archived {n} meeting.', { n }) : t('Archived {n} meetings.', { n }),
    unarchive: n === 1 ? t('{n} meeting back in the list.', { n }) : t('{n} meetings back in the list.', { n }),
    save: n === 1 ? t('Saved {n} meeting to your notes folder.', { n }) : t('Saved {n} meetings to your notes folder.', { n }),
    summarize: n === 1 ? t('Writing {n} summary again.', { n }) : t('Writing {n} summaries again.', { n }),
    chief: chiefSaid(r),
  }[action]
  const f = r.failed?.length
  const bad = f ? ` ${f === 1 ? t("{n} meeting couldn't: {error}", { n: f, error: r.failed[0].error }) : t("{n} meetings couldn't: {error}", { n: f, error: r.failed[0].error })}` : ''
  return n ? `${ok}${bad}` : bad.trim()
}

// The actions for the picked meetings, in a bar under the list. list: every meeting (the picked
// ones, and the folders in use).
export function BulkBar({ selection, compact = false, onDeleted, list = [] }) {
  const { sel, clear } = selection
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [again, setAgain] = useState(false)
  const [dialog, setDialog] = useState(null) // 'delete' | 'folder'
  if (!sel.size && !msg) return null
  const n = sel.size
  const picked = [...sel].map((id) => list.find((x) => x.id === id) || { id, title: t('Meeting') })
  const allArchived = picked.length > 0 && picked.every((x) => x.archived)
  const run = async (action) => {
    const ids = [...sel]
    setBusy(action); setMsg(null)
    try {
      const r = await api('/meetings/bulk', { method: 'POST', body: { ids, action } })
      setMsg({ text: said(action, r), error: !r.done.length })
      refetch('/meetings')
      if (action === 'archive' || action === 'unarchive') clear()
    } catch (e) { setMsg({ text: e.message, error: true }) } finally { setBusy(null) }
  }
  const btn = (action, icon, label) => (
    <button type="button" className={compact ? 'ghost-btn' : 'btn small'} onClick={() => run(action)} disabled={!!busy || !n} title={label} aria-label={label}>
      <Icon name={busy === action ? 'refresh' : icon} size={12} className={busy === action ? 'spin' : ''} />{!compact && ` ${label}`}
    </button>
  )
  return (
    <div className={`mt-bulk${compact ? ' compact' : ''}`} role="toolbar" aria-label={t('Picked meetings')}>
      {n > 0 && <>
        <b className="mt-bulk-n">{t('{n} picked', { n })}</b>
        {btn('save', 'download', t('Save as notes'))}
        {btn('chief', 'helm', t('Send action items to Chief of Staff'))}
        {btn('summarize', 'sparkle', t('Summarize again'))}
        <button type="button" className={compact ? 'ghost-btn' : 'btn small'} onClick={() => setAgain(true)} disabled={!!busy || !n} title={t('Transcribe again')} aria-label={t('Transcribe again')}><Icon name="refresh" size={12} />{!compact && ` ${t('Transcribe again')}`}</button>
        <button type="button" className={compact ? 'ghost-btn' : 'btn small'} onClick={() => setDialog('folder')} disabled={!!busy || !n} title={t('Move to a folder')} aria-label={t('Move to a folder')}><Icon name="folder" size={12} />{!compact && ` ${t('Folder')}`}</button>
        {allArchived ? btn('unarchive', 'archive', t('Take out of the archive')) : btn('archive', 'archive', t('Archive'))}
        <button type="button" className={compact ? 'ghost-btn' : 'btn small'} onClick={() => setDialog('delete')} disabled={!!busy || !n} title={t('Delete')} aria-label={t('Delete')}><Icon name="trash" size={12} />{!compact && ` ${t('Delete')}`}</button>
        <button type="button" className="ghost-btn mt-bulk-x" onClick={() => { clear(); setMsg(null) }} aria-label={t('Unpick all')} title={t('Unpick all')}><Icon name="x" size={12} /></button>
      </>}
      {again && <TranscribeAgain ids={[...sel]} onClose={() => setAgain(false)} onDone={(text) => setMsg({ text })} />}
      {dialog === 'delete' && <ConfirmDelete items={picked} onClose={() => setDialog(null)} onDone={(action, r) => { setMsg({ text: said(action, r), error: !r.done.length }); if (action === 'delete') onDeleted?.(r.done); clear() }} />}
      {dialog === 'folder' && <FolderPick items={picked} folders={foldersOf(list)} onClose={() => setDialog(null)} onDone={(text) => { setMsg({ text }); clear() }} />}
      {msg && <p className={`small mt-bulk-msg ${msg.error ? 'error-text' : 'muted'}`} role="status">{msg.text}{!n && <button type="button" className="link-btn" onClick={() => setMsg(null)}>{` ${t('OK')}`}</button>}</p>}
    </div>
  )
}
