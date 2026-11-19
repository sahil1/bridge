// Settings › Sharing: the Share Links you made (Share.jsx), from Files, Studio and the Preview tab,
// on this computer or any of your devices: each link, what it shows, who may open it, when it ends,
// who has opened it, and Stop Sharing.
import { SharesList } from '../Share.jsx'
import { t } from '../../i18n/index.js'

export default function Sharing() {
  return (
    <section className="st-sec" data-setting="shares">
      <h4>{t('Share Links')}</h4>
      <p className="muted small">{t('Links you gave people outside your devices: a file, a folder, a Studio document or an agent\'s app. Each goes through your relay, end-to-end encrypted, and works while this computer is on. Stop Sharing ends it at once, for anyone who has it open.')}</p>
      <SharesList />
    </section>
  )
}
