import Icon from './Icon.jsx'
import { Card, Updated } from './Trackers.jsx'
import { fmtRelative } from '../api.js'
import { useMail, threads, Reasons, MailSetup } from './MailView.jsx'
import { openToday } from './today.js'

// Overview card: the few threads that need you, with counts. The Mail tab has the rest.
export function Inbox() {
  const { data, error, refresh } = useMail()
  if (data && !data.available) {
    return (
      <Card icon="mail" title="Inbox" summary="Needs setup">
        <div className="mail-setup">
          <MailSetup data={data} onCheck={() => refresh('?refresh=1')} />
          <p className="muted small">The dashboard reads Mail's local index read-only. Nothing is sent anywhere.</p>
        </div>
      </Card>
    )
  }
  const msgs = data?.messages || []
  const needs = threads(msgs.filter((m) => m.bucket === 'needs')).sort((a, b) => (b.unread > 0) - (a.unread > 0) || b.score - a.score)
  const unreadNeeds = needs.filter((t) => t.unread).length
  const action = msgs.filter((m) => m.bucket === 'action').length
  const open = (id) => openToday('mail', id ? { mailId: id } : {})
  return (
    <Card icon="mail" title="Inbox" summary={data ? `${unreadNeeds} need you · ${data.unread} unread` : ''}
      right={<Updated data={data} onRefresh={() => refresh('?refresh=1')} />}>
      {!data && !error && <div className="skeleton-rows"><div /><div /></div>}
      {error && <p className="error-text">{error}</p>}
      {data && (
        <>
          <div className="mail-stats">
            <button onClick={() => open()}><b>{unreadNeeds}</b><span>need you</span></button>
            <button onClick={() => open()}><b>{action}</b><span>want action</span></button>
            <button onClick={() => open()}><b>{data.waiting?.length || 0}</b><span>awaiting reply</span></button>
            <button onClick={() => open()}><b>{data.unread}</b><span>unread</span></button>
          </div>
          <ul className="mail-list">
            {needs.slice(0, 6).map((t) => (
              <li key={t.key} className={`mail ${t.unread ? '' : 'read'}`}>
                <button className="mail-btn" onClick={() => open(t.latest.id)}>
                  <span className="mail-dot">{t.lead.flagged ? <Icon name="star" size={11} /> : t.unread > 0 && <span className="unread-dot" />}</span>
                  <span className="mail-main">
                    <span className="mail-top"><b>{t.people.slice(0, 2).join(', ')}{t.count > 1 ? ` (${t.count})` : ''}</b><span>{fmtRelative(t.latest.received)}</span></span>
                    <span className="mail-subject">{t.latest.subject}</span>
                    {(t.lead.ai || t.latest.snippet) && <span className="mail-snippet">{t.lead.ai || t.latest.snippet}</span>}
                    <Reasons list={t.lead.reasons} max={2} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {!needs.length && <p className="muted small">Nothing needs you right now.</p>}
          <button className="ghost-btn idea-more" onClick={() => open()}>Open Mail{needs.length > 6 ? ` · ${needs.length - 6} more need you` : ''} <Icon name="chevron" size={10} /></button>
        </>
      )}
    </Card>
  )
}
