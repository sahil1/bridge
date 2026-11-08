import Icon from '../Icon.jsx'
import { t } from '../../i18n/index.js'

// Files Assist: what's worth knowing about the folder on screen (files that are the same, the big
// and the old ones, how it could be organized), read only. It's being made on its own; until it
// comes, this says so in the panel the toolbar's Assist opens. Explorer.jsx shows it beside the
// folder: root and rel are the folder (a root, as the file routes name them, and a path in it),
// machine the computer it's on (null for this window's), onOpen(path) shows a file or folder there.
export default function Assist({ root, rel, machine, onOpen }) { // eslint-disable-line no-unused-vars
  return (
    <aside className="fx-assist" aria-label={t('Assist')} data-root={root} data-rel={rel || ''}>
      <header className="fx-assist-head"><Icon name="sparkle" size={14} /> <b>{t('Assist')}</b></header>
      <div className="fx-assist-soon">
        <p>{t('Assist is coming: it will point out files that are the same, the big and the old ones, and how this folder could be organized.')}</p>
        <p className="muted small">{t('It only looks, like the rest of Files: nothing is changed without you.')}</p>
      </div>
    </aside>
  )
}
