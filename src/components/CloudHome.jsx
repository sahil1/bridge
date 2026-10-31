// The phone apps' Cloud agents, with no computer (src/cloud): the agents started from this phone
// and a way to start one. Before the first key, what this is, what each provider costs and where
// to get a key.
import Icon from './Icon.jsx'
import Board from './Board.jsx'
import CloudKeys from './settings/CloudKeys.jsx'
import { usePoll } from '../api.js'
import './cloud.css'

export default function CloudHome({ fleet, onOpen, onNew }) {
  const { data, error, refresh } = usePoll('/cloud', 60_000)
  if (!data) {
    return error
      ? <div className="mate-hero"><div className="hero-mark"><Icon name="cloud" size={30} /></div><h3>Cloud Agents</h3><p className="error-text">{error}</p></div>
      : <div className="skeleton-rows pad"><div /><div /></div>
  }
  const ready = (data.providers || []).filter((p) => p.saved?.set)
  if (!ready.length) {
    return (
      <div className="cl-welcome">
        <div className="cl-hello">
          <div className="hero-mark"><Icon name="cloud" size={30} /></div>
          <h3>Cloud Agents, from your phone</h3>
          <p>Start a coding agent on Cursor, GitHub Copilot, Jules or Claude and follow it here. It works on a repo they host, on their computers, so no computer of yours needs to be on.</p>
          <p>Add a key for one of them to begin. Tap one to see where to get it.</p>
        </div>
        <CloudKeys bare onChange={() => refresh()} />
      </div>
    )
  }
  const names = ready.map((p) => p.name)
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0]
  return (
    <Board fleet={fleet} compact tally onOpen={onOpen} title="Cloud Agents" icon="cloud"
      action={<button type="button" className="btn primary small cl-new" onClick={onNew}><Icon name="plus" size={13} />New</button>}
      empty={(
        <div className="mate-hero cl-none">
          <div className="hero-mark"><Icon name="cloud" size={30} /></div>
          <h3>Nothing running yet</h3>
          <p>Start an agent on {list}. It keeps going on their computers, and you can check on it, answer it and send it more from here.</p>
          <button type="button" className="btn primary" onClick={onNew}><Icon name="plus" size={14} /> New cloud agent</button>
        </div>
      )} />
  )
}
