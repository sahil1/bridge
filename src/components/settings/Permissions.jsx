import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import PermissionFix from '../PermissionFix.jsx'
import { usePoll, machineId, viaRelay } from '../../api.js'
import { KINDS, desktopApp, useFix } from '../../permissions.js'
import { SettingsAt } from './where.js'
import { t } from '../../i18n/index.js'

// Settings › General › Permissions: everything Bridge AI may be allowed on this computer (or on the
// computer this page is for, from your phone or another device), what each is for, whether it's on,
// and one button, the same way to allow it as anywhere else (PermissionFix). Only what applies: the
// server lists its computer's (server/fixes.js list: nothing on Linux or in Docker, where nothing
// asks), and the desktop app adds what only it asks for when this is its own window. Opening it asks
// nothing: each is looked at without asking, and the folders aren't looked at until you click.
const ORDER = Object.keys(KINDS)

export default function Permissions() {
  const { data } = usePoll('/fix/list', 60000)
  const { data: fix } = useFix()
  const [kinds, setKinds] = useState(null) // the desktop app's own, when this window is its own
  const [ask, setAsk] = useState(null) // { pane, n }: asked for from another device: asked here now
  const app = desktopApp()
  useEffect(() => { app?.permission?.kinds?.().then(setKinds, () => setKinds([])) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Another of your devices asked this computer to allow something (desktop/main.js brings this
  // window forward here): that one asks right away, macOS's own question when there is one.
  useEffect(() => {
    const take = () => {
      const a = window.__bridgePermAsk
      if (!a || Date.now() - a.at > 60000) return
      window.__bridgePermAsk = null
      setAsk((x) => ({ pane: a.pane, n: (x?.n || 0) + 1 }))
    }
    take()
    window.addEventListener('bridge-permission-ask', take)
    return () => window.removeEventListener('bridge-permission-ask', take)
  }, [])
  if (!data) return null
  const here = !machineId && !viaRelay
  const byPane = new Map((data.items || []).map((i) => [i.pane, i]))
  // The app's own, as the app says (it knows before the server's told).
  if (here && app) for (const k of kinds || []) if (!byPane.has(k)) byPane.set(k, { pane: k })
  let items = ORDER.filter((k) => byPane.has(k)).map((k) => byPane.get(k))
  // In a browser on this computer, the app's own aren't this page's to allow: the browser asks.
  if (here && !app) items = items.filter((i) => !KINDS[i.pane]?.app)
  if (!items.length) return null
  const device = fix?.device
  return (
    <section className="st-sec st-perms" id="permissions">
      <h4>{t('Permissions')}</h4>
      <p className="muted small">{here
        ? t('What Bridge AI may use on this computer, and whether it\'s allowed. Each is asked for the first time something needs it; nothing here asks until you click.')
        : t('What Bridge AI may use on {device}, and whether it\'s allowed there. A permission is allowed on the computer it\'s for.', { device: device || t('that computer') })}</p>
      {/* A restart asked for here comes back here (src/permissions.js). */}
      <SettingsAt.Provider value="permissions">
        <div className="perm-list">
          {/* The folders: looking at Desktop is what makes macOS ask, so not until you click. */}
          {items.map((i) => <PermissionFix key={i.pane} pane={i.pane} row quiet={i.pane === 'files'} initial={i.state || null} ask={ask?.pane === i.pane ? ask.n : 0} />)}
        </div>
      </SettingsAt.Provider>
      {here && fix?.app && !fix.app.desktop && fix.mac && <p className="muted small"><Icon name="info" size={12} /> {fix.app.name ? t('Bridge AI runs from {name} here, so macOS asks about {name}.', { name: fix.app.name }) : t('Bridge AI runs from a terminal here, so macOS asks about that terminal.')}</p>}
    </section>
  )
}
