import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import CopyButton from '../CopyButton.jsx'
import { api, settingsChanged } from '../../api.js'
import { ago } from '../Machines.jsx'
import { t } from '../../i18n/index.js'

// Settings › MCP Servers › Bridge AI as an MCP Server (a beta feature, off to start): other apps on
// this computer (Claude Code, Claude Desktop, Cursor, Codex) using Bridge AI through `bridge-ai mcp`
// (server/mcptools.js). Says plainly what they get and what they never do, adds it to each app that's
// here in one click (server/mcp.js bridgeMcp), shows how to add it by hand, the switch for sending
// work to agents (each message then waits in Needs You), and the latest calls, which app and what.
// Only on the computer it runs on: another computer's window or a phone shows it read-only.
// What other apps can do, a sentence each, its verb marked **so** and shown in bold: each language
// puts the verb where its grammar needs it, which a bold word and the rest side by side couldn't.
const lead = (s) => s.split('**').map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))

export default function BridgeServer({ here = true }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null) // what's being changed
  const [said, setSaid] = useState({}) // app id -> what adding it said
  const [mine, setMine] = useState({}) // the switches as you set them, at once; saved behind
  const load = () => api('/mcp-server').then((x) => { setD(x); setError(null) }, (e) => setError(e.message))
  useEffect(() => { load(); const id = setInterval(() => { if (!document.hidden) load() }, 10000); return () => clearInterval(id) }, [])
  const set = async (what, patch, v) => {
    setMine((m) => ({ ...m, [what]: v }))
    setBusy(what)
    try { await api('/settings', { method: 'PATCH', body: patch }); settingsChanged(); await load() } catch (e) { setError(e.message) } finally { setBusy(null); setMine((m) => { const n = { ...m }; delete n[what]; return n }) }
  }
  const add = async (app) => {
    setBusy(app.id)
    try { const r = await api('/mcp-server/add', { method: 'POST', body: { app: app.id } }); setSaid((s) => ({ ...s, [app.id]: { ok: true, text: r.note } })) } catch (e) { setSaid((s) => ({ ...s, [app.id]: { ok: false, text: e.message } })) }
    setBusy(null)
    load()
  }
  const on = mine.on ?? !!d?.on
  const sendOn = mine.send ?? !!d?.sendToAgents
  const apps = (d?.apps || []).filter((a) => a.there)
  const by = d?.command ? [d.command.command, ...(d.command.args || [])].map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(' ') : ''
  return (
    <section className={`mcp-self ${on ? 'on' : ''}`} aria-labelledby="mcp-self-h" data-setting="mcp-server">
      <div className="mcp-self-head">
        <span className="mcp-self-mark" aria-hidden="true"><Icon name="link" size={15} /></span>
        <div className="mcp-self-title">
          <h4 id="mcp-self-h">{t('Bridge AI as an MCP Server')} <span className="mcp-tag">{t('Beta')}</span></h4>
          <p className="muted small">{t('Let Claude Code, Claude Desktop, Cursor and Codex on this computer use your whiteboards, files and meeting summaries.')}</p>
        </div>
        <label className="mcp-switch">
          <input type="checkbox" role="switch" checked={on} disabled={!d || !here || busy === 'on'} onChange={(e) => set('on', { trials: { 'mcp-server': e.target.checked } }, e.target.checked)} aria-label={t('Bridge AI as an MCP Server')} />
          <span>{on ? t('On') : t('Off')}</span>
        </label>
      </div>
      {error && <p className="mcp-error" role="alert"><Icon name="alert" size={13} />{error}</p>}
      {on && (
        <div className="mcp-self-body">
          <div className="mcp-self-block">
            <h5>{t('What They Can Do')}</h5>
            <ul className="mcp-shared">
              <li><Icon name="eye" size={13} /><span>{lead(t('**Read** your whiteboards, the Studio files in your Places, and your meetings\' summaries.'))}</span></li>
              <li><Icon name="plus" size={13} /><span>{lead(t('**Make** new whiteboards and files, and tasks on your list.'))}</span></li>
              <li><Icon name="edit" size={13} /><span>{lead(t('**Suggest** changes to a board or a file that exists, which wait for you to keep or discard in Needs You.'))}</span></li>
              <li className="no"><Icon name="blocked" size={13} /><span>{lead(t('**Never** your meetings\' transcripts, your agents\' conversations, your mail or your calendar.'))}</span></li>
            </ul>
            <p className="muted small">{t('What Bridge AI gives an app goes to the model that app uses: for Claude Code and Claude Desktop, Anthropic\'s.')}</p>
          </div>
          <div className="mcp-self-block">
            <h5>{t('Add It to an App')}</h5>
            {apps.length > 0 && (
              <ul className="mcp-apps">
                {apps.map((a) => (
                  <li key={a.id}>
                    <span className="mcp-app-name">{a.label}</span>
                    <span className="mcp-app-file muted small" title={a.file}>{a.file}</span>
                    {a.added
                      ? <span className="mcp-tag good"><Icon name="check" size={11} /> {t('Added')}</span>
                      : <button type="button" className="btn small" disabled={!here || busy === a.id} onClick={() => add(a)}><Icon name="plus" size={12} /> {busy === a.id ? t('Adding…') : t('Add')}</button>}
                    {said[a.id] && <p className={`mcp-app-said ${said[a.id].ok ? 'ok' : 'bad'}`} role="status"><Icon name={said[a.id].ok ? 'check' : 'alert'} size={12} />{said[a.id].text}</p>}
                  </li>
                ))}
              </ul>
            )}
            {d && !apps.length && <p className="muted small">{t('None of Claude Code, Claude Desktop, Cursor or Codex is on this computer. Add Bridge AI to another app by hand, below.')}</p>}
            <details className="mcp-byhand">
              <summary>{t('Add it by hand')}</summary>
              <p className="muted small">{t('As a local (stdio) server named bridge-ai, run by:')}</p>
              <div className="mcp-cmd"><code>{by}</code><CopyButton text={by} className="ghost-btn" size={12} /></div>
              <p className="muted small">{t('Or, for an app that takes an address: {url}, sending Bridge AI\'s key (the api-token file in its data folder) as Authorization: Bearer.', { url: d?.http || '' })}</p>
            </details>
          </div>
          <div className="mcp-self-block">
            <h5>{t('Sending to Agents')}</h5>
            <label className="st-check">
              <input type="checkbox" checked={sendOn} disabled={!d || !here || busy === 'send'} onChange={(e) => set('send', { mcpServer: { sendToAgents: e.target.checked } }, e.target.checked)} />
              <span><b>{t('Let them send work to your agents')}</b> <span className="muted small">{t('Each message waits for you to approve it in Needs You before it\'s sent. Agents run commands on this computer.')}</span></span>
            </label>
          </div>
          <div className="mcp-self-block">
            <h5>{t('Recent Calls')}{d?.waiting > 0 && <span className="mcp-tag warn">{t('{n} waiting in Needs You', { n: d.waiting })}</span>}</h5>
            {!d?.calls?.length
              ? <p className="muted small">{t('None yet. Once an app has Bridge AI and you ask it about your boards, files or meetings, each call shows here.')}</p>
              : (
                <ul className="mcp-calls">
                  {d.calls.slice(0, 10).map((c, i) => (
                    <li key={`${c.at}-${i}`} className={c.ok ? '' : 'bad'}>
                      <Icon name={c.ok ? 'check' : 'alert'} size={12} />
                      <span className="mcp-call-who">{c.client?.name || t('An app')}</span>
                      <span className="mcp-call-what" title={c.error || c.what}>{c.what}{!c.ok && c.error ? `: ${c.error}` : ''}</span>
                      <time dateTime={c.at} className="muted small">{ago(c.at)}</time>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </div>
      )}
    </section>
  )
}
