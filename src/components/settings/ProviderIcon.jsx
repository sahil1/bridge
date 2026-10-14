// Brand marks for model providers and agent CLIs, drawn on a rounded-square tile.
// Real marks come from simple-icons (CC0; each import is tree-shaken by Vite). Brands it
// doesn't carry (OpenAI, xAI, AWS, Azure, Groq, Together, Fireworks, Cohere, Cerebras, Aider,
// Goose, Crush, Amp) get a simple glyph or wordmark in the brand's color instead.
import {
  siAnthropic, siClaude, siGooglegemini, siMistralai, siDeepseek, siPerplexity, siKimi, siZdotai,
  siGooglecloud, siOpenrouter, siHuggingface, siOllama, siLmstudio, siGithubcopilot, siCursor,
  siQwen, siOpencode, siMeta,
} from 'simple-icons'

// Fallback glyphs, drawn in a 24x24 box in the tile's foreground color.
const G = {
  // A six-petal rosette, after OpenAI's knot.
  openai: (
    <g fill="none" stroke="currentColor" strokeWidth="1.7">
      {[0, 60, 120].map((r) => <ellipse key={r} cx="12" cy="12" rx="8" ry="3.6" transform={`rotate(${r} 12 12)`} />)}
    </g>
  ),
  // xAI's slashed x.
  xai: (
    <g fill="none" stroke="currentColor" strokeLinecap="round">
      <path d="M5.5 5.5 14.5 19" strokeWidth="2.6" />
      <path d="M13.2 11.4 18 5.5M5.5 19l4.3-5" strokeWidth="2.2" />
      <path d="M18.6 9v10" strokeWidth="1.6" />
    </g>
  ),
  // AWS: wordmark over the smile.
  aws: (
    <g>
      <text x="12" y="13.2" textAnchor="middle" fontSize="8.4" fontWeight="700" fill="currentColor" fontFamily="Arial, Helvetica, sans-serif" letterSpacing="-.2">aws</text>
      <path d="M5.2 15.4c4 2.4 9.6 2.4 13.6 0" fill="none" stroke="#FF9900" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M17.1 14.3l2 .9-.7 2" fill="none" stroke="#FF9900" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  ),
  // Azure's two-tone "A".
  azure: (
    <g fill="currentColor">
      <path d="M10.2 4h4.6L8.6 20H3.5z" />
      <path d="M14.9 7.5 20.5 20h-11l4.1-1.3h4.3l-3.7-6.9z" opacity=".75" />
    </g>
  ),
  fireworks: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.8 2.8M15.2 15.2 18 18M18 6l-2.8 2.8M8.8 15.2 6 18" />
    </g>
  ),
  together: (
    <g fill="currentColor">
      <rect x="5" y="5" width="6" height="6" rx="1.6" /><rect x="13" y="5" width="6" height="6" rx="3" />
      <rect x="5" y="13" width="6" height="6" rx="3" /><rect x="13" y="13" width="6" height="6" rx="1.6" />
    </g>
  ),
  cohere: (
    <g fill="currentColor">
      <path d="M8.6 13.2c1.7 0 5.2-.1 6.8-.8 2.2-.9 3.4-2.3 3.4-4.3 0-2.6-2-4.1-4.6-4.1H9.1C5.9 4 3.3 6.6 3.3 9.6s2.6 3.6 5.3 3.6z" opacity=".95" />
      <path d="M9.6 17c0-1.8 1.1-3.3 2.8-4l3.3-1.4c3.3-1.4 7 .9 7 4.5 0 2.7-2.3 4.9-5 4.9h-3.6A4.4 4.4 0 0 1 9.6 17z" opacity=".6" />
      <circle cx="5.6" cy="17.4" r="2.6" opacity=".8" />
    </g>
  ),
  cerebras: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M16.5 6.2a7.5 7.5 0 1 0 0 11.6" /><path d="M14.6 8.6a4.5 4.5 0 1 0 0 6.8" /><path d="M18.5 9.5a7.5 7.5 0 0 1 0 5" />
    </g>
  ),
  aider: <path d="m5.5 7.5 4.5 4.5-4.5 4.5M12 17h7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
  goose: (
    <g fill="currentColor">
      <path d="M14.5 4.2c1.9 0 3.2 1.3 3.2 3 0 .5-.1.9-.3 1.3l2.4.8-2.6.9c-.7 1.5-2.1 2.4-3.4 3.6-1 .9-1.3 1.9-.4 3.4 1.6 0 4.3.4 4.3 2.4H5.1c0-3.4 2.4-5.1 5-6.3 1.4-.7 1.8-1.6 1.4-3-.5-1.8.7-6.1 3-6.1z" />
      <circle cx="15" cy="7" r=".9" fill="var(--pv-tile, #000)" />
    </g>
  ),
  crush: (
    <g fill="currentColor">
      <path d="M12 3.5 19.4 7.7v8.6L12 20.5 4.6 16.3V7.7z" opacity=".35" />
      <path d="M12 7.6 15.6 9.7v4.6L12 16.4l-3.6-2.1V9.7z" />
    </g>
  ),
  amp: <path d="M6 19 12 5l6 14M8.6 13.6h6.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
  groq: (
    <g fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
      <circle cx="11.4" cy="10.2" r="5" /><path d="M16.4 10.2v4.6a4.6 4.6 0 0 1-7.6 3.5" />
    </g>
  ),
}

// id -> { si } (simple-icons mark) or { glyph, bg, fg }.
// tile: 'brand' paints the tile in the brand color; 'ink' uses the theme's ink (for black marks).
const MARKS = {
  anthropic: { si: siAnthropic, tile: 'ink' },
  openai: { glyph: 'openai', tile: 'ink' },
  gemini: { si: siGooglegemini, tile: 'soft' },
  xai: { glyph: 'xai', tile: 'ink' },
  meta: { si: siMeta, tile: 'soft' },
  mistral: { si: siMistralai, tile: 'brand' },
  deepseek: { si: siDeepseek, tile: 'brand' },
  cohere: { glyph: 'cohere', bg: '#39594D', fg: '#D18EE2' },
  perplexity: { si: siPerplexity, tile: 'brand' },
  moonshot: { si: siKimi, tile: 'ink' },
  zai: { si: siZdotai, tile: 'ink' },
  azure: { glyph: 'azure', bg: '#0078D4', fg: '#ffffff' },
  bedrock: { glyph: 'aws', bg: '#232F3E', fg: '#ffffff' },
  vertex: { si: siGooglecloud, tile: 'soft' },
  openrouter: { si: siOpenrouter, bg: '#6467F2', fg: '#ffffff' },
  groq: { glyph: 'groq', bg: '#F55036', fg: '#ffffff' },
  together: { glyph: 'together', bg: '#0F6FFF', fg: '#ffffff' },
  fireworks: { glyph: 'fireworks', bg: '#6720FF', fg: '#ffffff' },
  cerebras: { glyph: 'cerebras', bg: '#F15A29', fg: '#ffffff' },
  huggingface: { si: siHuggingface, tile: 'brand', fg: '#1a1a1a' },
  ollama: { si: siOllama, tile: 'ink' },
  lmstudio: { si: siLmstudio, bg: '#4F46E5', fg: '#ffffff' },
}

const AGENT_MARKS = {
  claude: { si: siClaude, tile: 'brand' },
  codex: MARKS.openai,
  gemini: MARKS.gemini,
  grok: MARKS.xai,
  cursor: { si: siCursor, tile: 'ink' },
  copilot: { si: siGithubcopilot, tile: 'ink' },
  opencode: { si: siOpencode, tile: 'ink' },
  amp: { glyph: 'amp', bg: '#F34E3F', fg: '#ffffff' },
  qwen: { si: siQwen, tile: 'brand' },
  aider: { glyph: 'aider', bg: '#14B014', fg: '#ffffff' },
  goose: { glyph: 'goose', tile: 'ink' },
  crush: { glyph: 'crush', bg: '#6B50FF', fg: '#FF60FF' },
  muse: MARKS.meta,
}

function initials(name = '?') {
  const parts = String(name).replace(/[^\w\s]/g, ' ').trim().split(/\s+/)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase()
}

function Tile({ mark, size, name, className = '' }) {
  const m = mark || {}
  let style
  if (m.bg) style = { background: m.bg, color: m.fg || '#fff' }
  else if (m.tile === 'brand' && m.si) style = { background: `#${m.si.hex}`, color: m.fg || '#fff' }
  else if (m.tile === 'soft' && m.si) style = { background: 'var(--pane-3)', color: `#${m.si.hex}` }
  else if (m.tile === 'ink') style = { background: 'var(--ink)', color: 'var(--pane)' }
  else style = { background: 'var(--pane-3)', color: 'var(--ink-2)' }
  const inner = Math.round(size * 0.56)
  return (
    <span className={`pv-tile ${className}`} style={{ ...style, width: size, height: size, borderRadius: Math.round(size * 0.27), '--pv-tile': style.background }} title={name} aria-hidden="true">
      {m.si ? (
        <svg viewBox="0 0 24 24" width={inner} height={inner} fill="currentColor"><path d={m.si.path} /></svg>
      ) : m.glyph ? (
        <svg viewBox="0 0 24 24" width={Math.round(size * 0.66)} height={Math.round(size * 0.66)}>{G[m.glyph]}</svg>
      ) : (
        <span className="pv-tile-text" style={{ fontSize: Math.round(size * 0.36) }}>{initials(name)}</span>
      )}
    </span>
  )
}

export default function ProviderIcon({ id, size = 44, name, className }) {
  return <Tile mark={MARKS[id]} size={size} name={name || id} className={className} />
}

export function AgentIcon({ kind, size = 28, name, className }) {
  return <Tile mark={AGENT_MARKS[kind]} size={size} name={name || kind} className={className} />
}
