import Icon from './Icon.jsx'
import { t } from '../i18n/index.js'

// The phone's More tab: the places a computer opens from its sidebar and ⌘K that have no tab of
// their own on a phone (Whiteboards, Terminals, the agent map, Dictations, Needs you, History,
// Settings), one row each. A row opens its place in this tab, with a way back to this list, or the
// panel it stands for. Something new on the desktop gets a row here, or a place in one of the other
// tabs: test/suites/phone-parity.mjs fails until it has one.
// rows: [{ id, icon, label, hint, count, run }], in the order shown.
export default function More({ rows }) {
  return (
    <div className="m-stack m-more">
      <ul className="m-more-list" aria-label={t('More')}>
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" className="m-more-row" data-id={r.id} onClick={r.run}>
              <span className="m-more-ico"><Icon name={r.icon} size={17} /></span>
              <span className="m-more-text"><b>{r.label}</b>{r.hint && <span>{r.hint}</span>}</span>
              {r.count > 0 && <span className="badge m-more-count">{r.count}</span>}
              <Icon name="chevron" size={13} className="muted" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
