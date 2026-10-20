// One agent in a window of its own (the ⧉ button in an agent's header). The main window shows
// that the agent is out here; "Bring back" closes this window and opens the agent there again.
// The windows talk over a BroadcastChannel, so this works in the desktop app and in a browser.
import { useEffect } from 'react'
import Console from './Console.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import Icon from './Icon.jsx'
import { useFleet } from '../api.js'

export const CHANNEL = 'bridge-windows'

// What the agent is called, as in its header (without Claude's spinner glyph).
export const nameOf = (a) => (a.chief ? 'Chief of staff' : String(a.title || a.tab || a.workspace || 'Agent').replace(/^[^\p{L}\p{N}]+/u, '') || 'Agent')

export const tell = (msg) => { const ch = new BroadcastChannel(CHANNEL); ch.postMessage(msg); ch.close() }

export function popOut(agent) {
  if (window.bridgeApp?.popOut) return window.bridgeApp.popOut(agent.paneId, nameOf(agent))
  window.open(`/?window=${encodeURIComponent(agent.paneId)}`, `bridge-${agent.paneId}`, 'popup,width=960,height=820')
}

export default function Solo({ paneId }) {
  const { fleet } = useFleet()
  const agent = fleet?.agents?.find((a) => a.paneId === paneId)

  useEffect(() => {
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
          ? <ErrorBoundary name="This agent's view" resetKey={agent.paneId}><Console agent={agent} variant="focus" extraActions={back} queued={fleet.queue?.[paneId] || []} /></ErrorBoundary>
          : (
            <div className="viewer-empty">
              <Icon name="x" size={22} />
              <p>This agent isn't running any more.</p>
              <button className="btn small" onClick={() => window.close()}>Close this window</button>
            </div>
          )}
    </div>
  )
}
