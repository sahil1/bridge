// Studio's sidebar, as Finder's: Studio's own lists first (Recent, its kinds, design packs and your
// signature: shelves), then Favorites (your home folder and the usual folders in it), your cloud
// drives, your projects (the folders your agents work in) and places, and Locations (the computer's
// drives, then your other computers). It lists the computer you're looking at; another of yours
// shows its own when you pick it (without Studio's lists, which are this one's). Naming a folder
// isn't reading it: Desktop and the rest are only read once you open them (server/explorer.js).
import Icon from '../Icon.jsx'
import { t, tx } from '../../i18n/index.js'

const OS_ICON = { mac: 'laptop', windows: 'laptop', linux: 'laptop' }
// The folders' own names, said in your language (the server names them in English); a project or a
// drive keeps its own name.
const OWN = new Set([tx('Home'), tx('Desktop'), tx('Documents'), tx('Downloads'), tx('Applications'), tx('Pictures'), tx('Music'), tx('Videos'), tx('Computer')])
export const named = (label) => (OWN.has(label) ? t(label) : label)

function Row({ it, on, onPick, sub }) {
  return (
    <button type="button" className={`fx-side-row ${on ? 'on' : ''}`} onClick={onPick} title={it.full || it.label} aria-current={on ? 'location' : undefined}
      data-root={it.root} data-path={it.path ?? ''} data-label={it.label}>
      <Icon name={it.icon || 'folder'} size={14} />
      <span className="fx-side-name">{named(it.label)}</span>
      {sub && <span className="fx-side-sub">{sub}</span>}
    </button>
  )
}
function Section({ title, children }) {
  const rows = [children].flat(2).filter(Boolean)
  if (!rows.length) return null
  return (
    <section className="fx-side-sec" aria-label={title}>
      <h3>{title}</h3>
      {rows}
    </section>
  )
}

// shelves: [{ id, icon, label, n, hint }], each a list of Studio's; shelf: the one shown.
export default function Sidebar({ side, error, computers, machine, loc, onGo, onComputer, shelves = null, shelf = null, onShelf }) {
  const at = (it) => !!loc && !shelf && loc.machine === machine && loc.root === it.root && (loc.path || '') === (it.path || '')
  const pick = (it) => () => onGo({ root: it.root, path: it.path || '', hint: it.guard ? { guard: it.guard, asked: it.asked } : null })
  const row = (it, sub) => <Row key={`${it.root}|${it.path}|${it.label}`} it={it} on={at(it)} onPick={pick(it)} sub={sub} />
  const icloud = side?.clouds?.[0]?.label === 'iCloud Drive'
  const shown = machine ? computers.others.find((c) => c.id === machine) : null
  return (
    <nav className="fx-side" aria-label={t('Sidebar')}>
      {shown && (
        <div className="fx-side-on">
          <Icon name="laptop" size={13} /><span>{t('On {name}', { name: shown.name })}</span>
          <button type="button" className="link-btn" onClick={() => onComputer(null)}>{t('Back to {name}', { name: computers.here.name })}</button>
        </div>
      )}
      {shelves && !machine && (
        <Section title={t('Studio')}>
          {shelves.map((s) => (
            <button key={s.id} type="button" className={`fx-side-row ${shelf === s.id ? 'on' : ''}`} onClick={() => onShelf(s.id)} title={s.hint || s.label}
              aria-current={shelf === s.id ? 'location' : undefined} data-shelf={s.id}>
              <Icon name={s.icon} size={14} />
              <span className="fx-side-name">{s.label}</span>
              {s.n != null && <span className="fx-side-sub">{s.n}</span>}
            </button>
          ))}
        </Section>
      )}
      {error && <p className="error-text small fx-side-err">{error}</p>}
      {!side && !error && <div className="fx-side-wait"><div className="skeleton-rows"><div /><div /><div /></div></div>}
      {side && (
        <>
          <Section title={t('Favorites')}>{row(side.home)}{side.favorites.map((it) => row(it))}</Section>
          <Section title={icloud ? t('iCloud and Cloud Drives') : t('Cloud Drives')}>{side.clouds.map((it) => row(it, it.account))}</Section>
          <Section title={t('Projects')}>{side.projects.map((it) => row(it))}</Section>
          <Section title={t('Places')}>{side.places.map((it) => row(it))}</Section>
        </>
      )}
      {/* Drawn with the rest, so it doesn't show alone and then jump down under them; or, when
          they can't be read, still there to go to your other computers. */}
      {(side || error) && <Section title={t('Locations')}>
        {(side?.drives || []).map((it) => row(it))}
        {computers.others.length > 0 && [
          machine && (
            <button key="here" type="button" className="fx-side-row" onClick={() => onComputer(null)} data-computer="here">
              <Icon name={OS_ICON[computers.here.os] || 'laptop'} size={14} /><span className="fx-side-name">{computers.here.name}</span><span className="fx-side-sub">{t('this one')}</span>
            </button>
          ),
          ...computers.others.filter((c) => c.id !== machine).map((c) => (
            <button key={c.id} type="button" className={`fx-side-row ${c.online ? '' : 'away'}`} onClick={() => onComputer(c.id)} data-computer={c.name}
              title={c.online ? t('{name}\'s files, through your link to it', { name: c.name }) : t('{name} is offline', { name: c.name })}>
              <Icon name={OS_ICON[c.os] || 'laptop'} size={14} /><span className="fx-side-name">{c.name}</span>{!c.online && <span className="fx-side-sub">{t('offline')}</span>}
            </button>
          )),
        ]}
      </Section>}
    </nav>
  )
}
