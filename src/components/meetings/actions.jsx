import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { Menu } from '../FileExtras.jsx'
import { api, refetch, onThisComputer } from '../../api.js'
import { Dialog, FixWord, MemoryPanel, TranscribeAgain } from './tools.jsx'
import { t } from '../../i18n/index.js'

// What can be done to a meeting from a list (right-click a meeting in the sidebar or on the
// Meetings page), the same as its own ⋯ menu: save it, fix a word, transcribe it again, put it in a
// folder, archive it, delete it. Deleting asks first, and offers the archive instead.

const deleted = (n) => (n === 1 ? t('Deleted {n} meeting.', { n }) : t('Deleted {n} meetings.', { n }))
const archivedN = (n) => (n === 1 ? t('Archived {n} meeting.', { n }) : t('Archived {n} meetings.', { n }))
const live = (x) => x.status === 'recording' || x.status === 'paused'
const tilde = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~')
// The folders in use, by name.
export const foldersOf = (list) => [...new Set((list || []).map((x) => x.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b))
// What became of action items sent to the Chief of Staff (the server's answer: added, and sent and
// queued when it's running), the same wherever they were sent from.
export function chiefSaid({ added: n = 0, sent, queued }) {
  if (!sent) return n === 1 ? t("{n} action item is on Chief of Staff's task list. Start Chief of Staff and it picks it up.", { n }) : t("{n} action items are on Chief of Staff's task list. Start Chief of Staff and it picks them up.", { n })
  if (queued) return n === 1 ? t("{n} action item sent to Chief of Staff (after what it's doing now).", { n }) : t("{n} action items sent to Chief of Staff (after what it's doing now).", { n })
  return n === 1 ? t('{n} action item sent to Chief of Staff.', { n }) : t('{n} action items sent to Chief of Staff.', { n })
}

// Delete one meeting or several, after saying what goes. Archive instead keeps them, out of the way.
export function ConfirmDelete({ items, onClose, onDone }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const n = items.length
  const one = n === 1 ? items[0] : null
  // The title in bold, where the language puts it.
  const goes = t('{title} goes, with its recording, transcript, notes and summary.').split('{title}')
  const go = async (action) => {
    setBusy(true); setErr(null)
    try {
      const r = await api('/meetings/bulk', { method: 'POST', body: { ids: items.map((x) => x.id), action } })
      if (!r.done.length) throw new Error(r.failed[0]?.error || t("Couldn't"))
      refetch('/meetings')
      onDone?.(action, r)
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Dialog title={one ? t('Delete this meeting?') : t('Delete {n} meetings?', { n })} onClose={onClose}>
      <div className="mt-fix mt-confirm">
        <p>{one ? <>{goes[0]}<b>{one.title}</b>{goes[1]}</> : t('{n} meetings go, with their recordings, transcripts, notes and summaries.', { n })} {t("This can't be undone.")}</p>
        <p className="muted small">{t('Notes you saved to your notes folder stay.')} {one ? t('Archiving keeps it instead: out of the list and out of search, and back whenever you like.') : t('Archiving keeps them instead: out of the list and out of search, and back whenever you like.')}</p>
        {err && <p className="error-text small">{err}</p>}
        <div className="mt-dialog-acts">
          <button type="button" className="ghost-btn" onClick={onClose} autoFocus>{t('Cancel')}</button>
          {items.some((x) => !x.archived) && <button type="button" className="btn small" disabled={busy} onClick={() => go('archive')}><Icon name="archive" size={12} /> {t('Archive instead')}</button>}
          <button type="button" className="btn small danger" disabled={busy} onClick={() => go('delete')}><Icon name="trash" size={12} /> {t('Delete')}</button>
        </div>
      </div>
    </Dialog>
  )
}

// Put meetings in a folder: one already in use, or a new one. None: back to the list by day.
export function FolderPick({ items, folders, onClose, onDone }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const now = items.length === 1 ? items[0].folder || null : null
  const go = async (folder) => {
    setBusy(true); setErr(null)
    try {
      const r = await api('/meetings/bulk', { method: 'POST', body: { ids: items.map((x) => x.id), action: 'folder', folder } })
      if (!r.done.length) throw new Error(r.failed[0]?.error || t("Couldn't"))
      refetch('/meetings')
      onDone?.(folder ? t('In {folder}.', { folder }) : t('Out of its folder.'))
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Dialog title={items.length === 1 ? t('Move to a folder') : t('Move {n} meetings to a folder', { n: items.length })} onClose={onClose}>
      <div className="mt-fix mt-folders">
        {folders.length > 0 && (
          <div className="mt-folder-list" role="list">
            {folders.map((f) => (
              <button key={f} type="button" role="listitem" className={`mt-folder-opt${f === now ? ' on' : ''}`} disabled={busy || f === now} onClick={() => go(f)}>
                <Icon name="folder" size={13} /> <span>{f}</span>{f === now && <small className="muted">{t('here now')}</small>}
              </button>
            ))}
          </div>
        )}
        <form className="mt-folder-new" onSubmit={(e) => { e.preventDefault(); if (name.trim()) go(name.trim()) }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={folders.length ? t('Or a new folder') : t('A name for the folder')} aria-label={t('New folder')} autoFocus maxLength={60} />
          <button type="submit" className="btn small primary" disabled={busy || !name.trim()}>{t('Move')}</button>
        </form>
        {err && <p className="error-text small">{err}</p>}
        <div className="mt-dialog-acts">
          {items.some((x) => x.folder) && <button type="button" className="ghost-btn" disabled={busy} onClick={() => go(null)}>{now ? t('Take out of "{folder}"', { folder: now }) : t('Take out of its folder')}</button>}
          <button type="button" className="ghost-btn" onClick={onClose}>{t('Cancel')}</button>
        </div>
      </div>
    </Dialog>
  )
}

// The menu for a meeting, opened where you right-click, with its dialogs and what it said.
// list: every meeting (for the folders in use). onOpen(id): open one. onGone(ids): deleted.
export function useMeetingMenu({ list, onOpen, onGone }) {
  const [menu, setMenu] = useState(null) // { x, y, m }
  const [dialog, setDialog] = useState(null) // { kind, items }
  const [msg, setMsg] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const say = (text, error = false) => { setMsg({ text, error }); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 5000) }
  const run = (fn) => Promise.resolve().then(fn).catch((e) => say(e.message, true))
  const id = (m) => encodeURIComponent(m.id)
  const items = (m) => [
    { icon: 'doc', label: t('Open'), run: () => onOpen(m.id) },
    { icon: 'download', label: t('Save as Markdown'), run: () => run(async () => { const r = await api(`/meetings/${id(m)}/save`, { method: 'POST' }); refetch('/meetings'); say(t('Saved to {file}', { file: tilde(r.file) })) }) },
    m.saved && onThisComputer() && { icon: 'folder-open', label: t('Show saved notes in Finder'), run: () => run(() => api(`/meetings/${id(m)}/reveal`, { method: 'POST' })) },
    m.hasSummary && { icon: 'helm', label: t('Send action items to Chief of Staff'), run: () => run(async () => { const r = await api(`/meetings/${id(m)}/chief`, { method: 'POST' }); refetch('/meetings'); say(chiefSaid(r)) }) },
    'sep',
    { icon: 'edit', label: t('Fix a word everywhere'), run: () => setDialog({ kind: 'fix', items: [m] }) },
    m.status === 'done' && { icon: 'refresh', label: t('Transcribe again…'), run: () => setDialog({ kind: 'again', items: [m] }) },
    { icon: 'book', label: t('Meeting memory'), run: () => setDialog({ kind: 'memory', items: [m] }) },
    'sep',
    { icon: 'folder', label: m.folder ? t('Move to another folder…') : t('Move to a folder…'), run: () => setDialog({ kind: 'folder', items: [m] }) },
    !live(m) && (m.archived
      ? { icon: 'archive', label: t('Take out of the archive'), run: () => run(async () => { await api(`/meetings/${id(m)}`, { method: 'PATCH', body: { archived: false } }); refetch('/meetings'); say(t('{title} is back in the list.', { title: m.title })) }) }
      : { icon: 'archive', label: t('Archive'), run: () => run(async () => { await api(`/meetings/${id(m)}`, { method: 'PATCH', body: { archived: true } }); refetch('/meetings'); say(t("Archived {title}. It's under Archived, and left out of search.", { title: m.title })) }) }),
    !live(m) && { icon: 'trash', label: t('Delete meeting…'), danger: true, run: () => setDialog({ kind: 'delete', items: [m] }) },
  ]
  const open = useCallback((e, m) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, m }) }, [])
  const close = useCallback(() => setMenu(null), [])
  const shut = () => setDialog(null)
  const node = (
    <>
      {menu && <Menu x={menu.x} y={menu.y} items={items(menu.m)} onClose={close} />}
      {dialog?.kind === 'fix' && <FixWord id={dialog.items[0].id} onClose={shut} onDone={(text) => { say(text); refetch('/meetings') }} />}
      {dialog?.kind === 'again' && <TranscribeAgain ids={dialog.items.map((x) => x.id)} onClose={shut} onDone={say} />}
      {dialog?.kind === 'memory' && <MemoryPanel onClose={shut} />}
      {dialog?.kind === 'folder' && <FolderPick items={dialog.items} folders={foldersOf(list)} onClose={shut} onDone={say} />}
      {dialog?.kind === 'delete' && <ConfirmDelete items={dialog.items} onClose={shut} onDone={(action, r) => { if (action === 'delete') { onGone?.(r.done); say(deleted(r.done.length)) } else say(archivedN(r.done.length)) }} />}
    </>
  )
  return { open, node, msg, setDialog, clearMsg: () => setMsg(null) }
}
