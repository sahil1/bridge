// One agent in a window of its own (the ⧉ button in an agent's header). The main window shows
// that the agent is out here; "Bring back" closes this window and opens the agent there again.
// The windows talk over a BroadcastChannel, so this works in the desktop app and in a browser.
// Also an agent on another of your devices, in a tab of a window on this one (embedded): there
// it's not a window, so it says nothing to the others and has nothing to close.
import { useEffect, useRef } from 'react'
import Console from './Console.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import Icon from './Icon.jsx'
import { useFleet, machineId, embedded } from '../api.js'

// A channel for each device's windows: windows for two devices side by side can have agents with
// the same id.
export const CHANNEL = `bridge-windows@${machineId || 'here'}`

// What the agent is called, as in its header (without Claude's spinner glyph).
// A chief of staff's thread other than Main goes by its topic.
export const nameOf = (a) => (a.chief ? (a.thread && !a.thread.main ? `Chief of staff · ${a.title}` : 'Chief of staff') : String(a.title || a.tab || a.workspace || 'Agent').replace(/^[^\p{L}\p{N}]+/u, '') || 'Agent')

export const tell = (msg) => { const ch = new BroadcastChannel(CHANNEL); ch.postMessage(msg); ch.close() }

export function popOut(agent) {
  if (window.bridgeApp?.popOut) return window.bridgeApp.popOut(agent.paneId, nameOf(agent))
  window.open(`?window=${encodeURIComponent(agent.paneId)}`, `bridge-${agent.paneId}`, 'popup,width=960,height=820')
}

export default function Solo({ paneId }) {
  const { fleet } = useFleet()
  // The herdr session it was opened in: another session's pane with the same id is another agent.
  const home = useRef(undefined)
  if (fleet && !fleet.down && home.current === undefined) home.current = fleet.session || ''
  const away = !!fleet && home.current !== undefined && (fleet.session || '') !== home.current
  const agent = away ? null : fleet?.agents?.find((a) => a.paneId === paneId)

  useEffect(() => {
    if (embedded) return
    const ch = new BroadcastChannel(CHANNEL)
    const hello = () => ch.postMessage({ type: 'open', paneId })
    ch.onmessage = (e) => {
      if (e.data?.type === 'ping') hello()
      if (e.data?.type === 'focus' && e.data.paneId === paneId) window.focus()
      if (e.data?.type === 'close' && e.data.paneId === paneId) window.close() // brought back from the main window
    }
    hello()
    const bye = () => ch.postMessage({ type: 'closed', paneId })
    window.addEventListener('pagehide', bye)
    return () => { bye(); window.removeEventListener('pagehide', bye); ch.close() }
  }, [paneId])
  useEffect(() => { if (agent) document.title = `${nameOf(agent)} · Bridge AI` }, [agent?.title, agent?.tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const bringBack = () => {
    tell({ type: 'back', paneId })
    window.bridgeApp?.focusMain?.()
    setTimeout(() => window.close(), 50)
  }
  const back = (
    <button className="btn small" onClick={bringBack} title="Close this window and show the agent in Bridge AI again">
      <Icon name="popout" size={13} /> Bring back
    </button>
  )

  return (
    <div className="solo">
      {!fleet ? <div className="pad"><div className="skeleton-rows"><div /><div /></div></div>
        : agent
          ? <ErrorBoundary name="This agent's view" resetKey={agent.paneId}><Console agent={agent} variant="focus" extraActions={embedded ? null : back} queued={fleet.queue?.[paneId] || []} /></ErrorBoundary>
          : (
            <div className="viewer-empty">
              <Icon name="x" size={22} />
              <p>{away ? `This agent is in the herdr session ${home.current}. Switch back to it to see it here.` : "This agent isn't running any more."}</p>
              {!embedded && <button className="btn small" onClick={() => window.close()}>Close this window</button>}
            </div>
          )}
    </div>
  )
}
