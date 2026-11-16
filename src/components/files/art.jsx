// Studio's home's icons, drawn as a Mac draws them: a folder filled in its own blue with its tab, and
// a mark on it for what it is (Desktop, Documents, Downloads, iCloud Drive, a project, another
// computer…); a file as a page with its corner turned, in its kind's colour, with its kind's mark and
// its extension; an app as a tile; a drive as a drive. Drawn here, in the app's own icons for the
// marks, so nothing is read to make them. The colours are explorer.css's (--fx-fold-*, --fx-k-*), for
// light and dark.
import Icon from '../Icon.jsx'
import { artOf, extOf } from './fsapi.js'

// The mark for each kind of file, from the app's icons (none: lines, as a page of writing).
const MARK = { sheet: 'table', deck: 'screen', page: 'code', code: 'code', data: 'braces', image: 'image', video: 'video', audio: 'volume', archive: 'archive', disk: 'drive', book: 'book', board: 'shapes' }
const LINES = new Set(['doc', 'text', 'pdf'])

// A mark from the app's icons, placed in the drawing's own units (its 64 by 64).
const Mark = ({ name, x, y, size }) => <g transform={`translate(${x} ${y})`}><Icon name={name} size={size} /></g>

// glyph: the mark on it (one of the app's icons: screen, doc, download, cloud, code, laptop…).
export function FolderIcon({ glyph = null, size = 64 }) {
  const small = size < 28
  return (
    <svg className="fx-art fx-fold" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path className="fx-fold-back" d="M5 16a5 5 0 0 1 5-5h12.6c1.5 0 2.6.5 3.6 1.6l2.2 2.5c.8.9 1.6 1.3 2.8 1.3H54a5 5 0 0 1 5 5V50a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" />
      <path className="fx-fold-front" d="M4 25a5 5 0 0 1 5-5h46a5 5 0 0 1 5 5v25.5a4.5 4.5 0 0 1-4.5 4.5h-47A4.5 4.5 0 0 1 4 50.5z" />
      {!small && <path className="fx-fold-shine" d="M9 20.8h46" />}
      {glyph && !small && <g className="fx-fold-glyph"><Mark name={glyph} x={22.5} y={28} size={19} /></g>}
    </svg>
  )
}

// e: the entry; art: what it's drawn as, when that's known otherwise (a whiteboard). A package that's
// an app is a tile; anything else a page.
export function FileIcon({ e, art = null, size = 64 }) {
  const k = art || artOf(e)
  if (k === 'app') return <AppIcon size={size} />
  const small = size < 28
  const ext = extOf(e.name).toUpperCase().slice(0, 4)
  return (
    <svg className={`fx-art fx-page k-${k}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path className="fx-page-paper" d="M17.5 5H39l13 13v36.5a4.5 4.5 0 0 1-4.5 4.5h-30a4.5 4.5 0 0 1-4.5-4.5v-45A4.5 4.5 0 0 1 17.5 5z" />
      <path className="fx-page-fold" d="M39 5v9a4 4 0 0 0 4 4h9z" />
      {small
        ? <rect className="fx-page-band" x="13" y="44" width="39" height="9" />
        : <>
          {LINES.has(k) ? <path className="fx-page-lines" d="M20 23h17M20 29h25M20 35h25M20 41h16" /> : MARK[k] && <g className="fx-page-mark"><Mark name={MARK[k]} x={22.5} y={18} size={19} /></g>}
          {ext && <><rect className="fx-page-band" x="13" y="45" width="39" height="10" /><text className="fx-page-ext" x="32.5" y="52.6" textAnchor="middle">{ext}</text></>}
        </>}
    </svg>
  )
}

// An app (a Mac's .app, or an installer), as a tile: its own picture would mean reading inside it.
export function AppIcon({ size = 64 }) {
  return (
    <svg className="fx-art fx-app" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect className="fx-app-tile" x="8" y="8" width="48" height="48" rx="12" />
      {size >= 28 && <g className="fx-app-mark"><Mark name="grid" x={20} y={20} size={24} /></g>}
    </svg>
  )
}

// A drive, a computer's own disk or one plugged in.
export function DriveIcon({ size = 64 }) {
  return (
    <svg className="fx-art fx-drive" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect className="fx-drive-body" x="6" y="18" width="52" height="30" rx="6" />
      <rect className="fx-drive-face" x="6" y="36" width="52" height="12" rx="5" />
      <circle className="fx-drive-light" cx="48" cy="42" r="2" />
    </svg>
  )
}

// The icon for an entry: a folder (with its mark), a drive, an app or a page.
export function EntryIcon({ e, glyph = null, size = 64 }) {
  if (e.drive) return <DriveIcon size={size} />
  if (e.dir) return <FolderIcon glyph={glyph} size={size} />
  return <FileIcon e={e} size={size} />
}
