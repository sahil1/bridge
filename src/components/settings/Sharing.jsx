// Settings › Devices & Access › Share Links: the beta feature's switch (src/trials.js), then the links
// you made (Share.jsx), from Files, Studio and the Preview tab, on this computer or any of your
// devices: each link, what it shows, who may open it, when it ends, who has opened it, and Stop
// Sharing. With the beta off, the links already made are still here, to see and stop.
import { SharesList } from '../Share.jsx'
import { More } from './Advanced.jsx'
import { BetaSwitch } from './Beta.jsx'
import { t } from '../../i18n/index.js'

export default function Sharing() {
  return (
    <div className="st-sections">
      <BetaSwitch id="share-links" />
      <section className="st-sec" data-setting="shares">
        <p className="muted small">{t('Links you gave people outside your devices. Stop Sharing ends one at once.')} <More>{t('Links you gave people outside your devices: a file, a folder, a Studio document or an agent\'s app. Each goes through your relay, end-to-end encrypted, and works while this computer is on. Stop Sharing ends it at once, for anyone who has it open.')}</More></p>
        <SharesList />
      </section>
    </div>
  )
}
