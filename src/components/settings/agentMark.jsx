// Agent logos come from ProviderIcon.jsx when it's present; until then, a lettered tile.
const found = import.meta.glob('./ProviderIcon.jsx', { eager: true })
const Real = Object.values(found)[0]?.AgentIcon

const TINT = { chat: '#2f6fe0', claude: '#d97757', codex: '#10a37f', gemini: '#4f7cf7', copilot: '#6e40c9', cursor: '#1f2328', grok: '#111111', opencode: '#2b2b2b', amp: '#f34e3f', qwen: '#615ced', aider: '#14b014', goose: '#3a3a3a', crush: '#ff5fd2', shell: '#5c6370' }

export default function AgentMark({ kind, label, size = 28 }) {
  if (Real) return <Real kind={kind} size={size} />
  return (
    <span className="agent-mark" style={{ width: size, height: size, background: TINT[kind] || '#5c6370', fontSize: size * 0.42 }} aria-hidden="true">
      {(label || kind || '?').slice(0, 1).toUpperCase()}
    </span>
  )
}
