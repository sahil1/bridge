import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { THEMES, TEXT_SIZES, FONTS, DEFAULTS, useAppearance, resolve, isDark, validHex, luminance, themeString, parseThemeString } from '../appearance.js'
import { t, tx, LANGS, chosen, setLang } from '../i18n/index.js'

// Preferences › Appearance, laid out like Slack's: color mode, theme, then text and layout.
const MODES = [
  { id: 'light', name: tx('Light') },
  { id: 'dark', name: tx('Dark') },
  { id: 'system', name: tx('Sync with system') },
]
const BASE = { light: { bg: '#eef0f3', pane: '#ffffff', line: '#dfe2e8' }, dark: { bg: '#0f1115', pane: '#1c2027', line: '#2a2f38' } }

// A tiny window: frame (top bar and sidebar), a content pane, one accent bubble.
function Mini({ frame, accent, dark, split }) {
  const b = BASE[dark ? 'dark' : 'light']
  const f = frame || b.bg
  return (
    <svg className="ap-mini" viewBox="0 0 120 72" aria-hidden="true">
      {split ? (
        <>
          <rect width="60" height="72" fill={BASE.light.bg} />
          <rect x="60" width="60" height="72" fill={BASE.dark.bg} />
          <rect x="30" y="16" width="30" height="50" rx="4" fill={BASE.light.pane} />
          <rect x="60" y="16" width="54" height="50" rx="4" fill={BASE.dark.pane} />
        </>
      ) : (
        <>
          <rect width="120" height="72" fill={f} />
          <rect x="30" y="16" width="84" height="50" rx="4" fill={b.pane} stroke={frame ? 'none' : b.line} />
        </>
      )}
      <g fill={frame && !split ? (luminance(frame) > 0.4 ? 'rgb(18 21 27 / .45)' : 'rgb(255 255 255 / .55)') : '#8a92a3'} opacity={split ? 0.5 : 1}>
        <rect x="6" y="20" width="16" height="3" rx="1.5" />
        <rect x="6" y="28" width="12" height="3" rx="1.5" opacity=".7" />
        <rect x="6" y="36" width="14" height="3" rx="1.5" opacity=".7" />
      </g>
      <rect x="6" y="6" width="22" height="4" rx="2" fill={accent || '#2f6fe0'} opacity=".9" />
      <rect x="70" y="26" width="38" height="9" rx="4.5" fill={accent || '#2f6fe0'} />
      <rect x="38" y="42" width="44" height="4" rx="2" fill={dark ? '#3a404b' : '#d5d9e0'} />
      <rect x="38" y="50" width="30" height="4" rx="2" fill={dark ? '#3a404b' : '#d5d9e0'} />
    </svg>
  )
}

function Seg({ value, options, onChange, label }) {
  return (
    <div className="seg ap-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>{o.name}</button>
      ))}
    </div>
  )
}

function ColorField({ label, value, onChange }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <label className="ap-color">
      <span className="ap-swatch" style={{ background: value }}>
        <input type="color" value={value.length === 4 ? `#${value.slice(1).split('').map((c) => c + c).join('')}` : value} onChange={(e) => onChange(e.target.value)} aria-label={t('{name} color', { name: label })} />
      </span>
      <span className="ap-color-text">
        <small>{label}</small>
        <input value={text} spellCheck={false} onChange={(e) => { setText(e.target.value); if (validHex(e.target.value)) onChange(e.target.value.toLowerCase()) }} onBlur={() => setText(value)} />
      </span>
    </label>
  )
}

// The Appearance panel; Settings shows it as one of its sections.
export default function Appearance() {
  const [a, save] = useAppearance()
  const [paste, setPaste] = useState('')
  const [copied, setCopied] = useState(false)
  const dark = isDark(a.mode)

  const current = resolve(a) || { chrome: dark ? '#0f1115' : '#eef0f3', accent: dark ? '#4e82ef' : '#2f6fe0' }
  const setCustom = (patch) => save({ theme: 'custom', custom: { ...a.custom, ...patch } })
  const pasted = parseThemeString(paste)
  const copy = async () => {
    try { await navigator.clipboard.writeText(themeString(current)); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* no clipboard */ }
  }

  return (
    <div className="appearance">

        <section className="ap-sec">
          <h4>{t('Color mode')}</h4>
          <p className="muted small">{t('Choose light or dark, or follow your system.')}</p>
          <div className="ap-modes">
            {MODES.map((m) => (
              <button key={m.id} type="button" className={`ap-tile ${a.mode === m.id ? 'on' : ''}`} aria-pressed={a.mode === m.id} onClick={() => save({ mode: m.id })}>
                <Mini dark={m.id === 'dark'} split={m.id === 'system'} accent={current.accent} />
                <span>{t(m.name)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="ap-sec">
          <h4>{t('Theme')}</h4>
          <p className="muted small">{t('Colors the window frame (top bar, sidebar and tabs) and the accent. Each theme has its own dark-mode shade.')}</p>
          <div className="ap-themes">
            {THEMES.map((t) => {
              const c = resolve({ ...a, theme: t.id }, dark)
              return (
                <button key={t.id} type="button" className={`ap-tile ${a.theme === t.id ? 'on' : ''}`} aria-pressed={a.theme === t.id} onClick={() => save({ theme: t.id })}>
                  <Mini frame={c?.chrome} accent={c?.accent} dark={dark} />
                  <span>{t.name}</span>
                </button>
              )
            })}
            <button type="button" className={`ap-tile ${a.theme === 'custom' ? 'on' : ''}`} aria-pressed={a.theme === 'custom'} onClick={() => save({ theme: 'custom' })}>
              <Mini frame={a.custom.chrome} accent={a.custom.accent} dark={dark} />
              <span>{t('Custom')}</span>
            </button>
          </div>
          {a.theme === 'custom' && (
            <div className="ap-custom">
              <ColorField label={t('Frame')} value={a.custom.chrome} onChange={(v) => setCustom({ chrome: v })} />
              <ColorField label={t('Accent')} value={a.custom.accent} onChange={(v) => setCustom({ accent: v })} />
            </div>
          )}
          <div className="ap-share">
            <code title={t('Send this to someone so they can use your theme')}>{themeString(current)}</code>
            <button type="button" className="ghost-btn" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={12} />{copied ? t('Copied') : t('Copy')}</button>
            <form className="ap-paste" onSubmit={(e) => { e.preventDefault(); if (pasted) { save({ theme: 'custom', custom: pasted }); setPaste('') } }}>
              <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={t('Paste a theme…')} spellCheck={false} aria-label={t('Paste a theme')} />
              <button className="ghost-btn strong" disabled={!pasted}>{t('Use')}</button>
            </form>
          </div>
        </section>

        <section className="ap-sec ap-rows">
          <div className="ap-row">
            <div><h4>{t('Text size')}</h4><p className="muted small">{t('Chat, the message box and the terminal. ⌘+ and ⌘− zoom everything.')}</p></div>
            <Seg label={t('Text size')} value={a.text} options={TEXT_SIZES} onChange={(v) => save({ text: v })} />
          </div>
          <div className="ap-row">
            <div><h4>{t('Density')}</h4><p className="muted small">{t('Compact fits more messages and sidebar rows.')}</p></div>
            <Seg label={t('Density')} value={a.density} options={[{ id: 'comfortable', name: t('Comfortable') }, { id: 'compact', name: t('Compact') }]} onChange={(v) => save({ density: v })} />
          </div>
          <div className="ap-row">
            <div><h4>{t('Font')}</h4><p className="muted small">{t('For the app. Code and terminals stay monospace.')}</p></div>
            <Seg label={t('Font')} value={a.font} options={FONTS} onChange={(v) => save({ font: v })} />
          </div>
        </section>

        <section className="ap-sec ap-rows">
          <div className="ap-row">
            <div><h4>{t('Language')}</h4><p className="muted small">{t('Bridge AI\'s own words. Not every screen is translated yet; the rest shows in English.')}</p></div>
            <select className="st-input ap-lang" aria-label={t('Language')} value={chosen()} onChange={(e) => setLang(e.target.value)}>
              <option value="auto">{t('Match this computer')}</option>
              {LANGS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </section>

        <footer className="ap-foot">
          <button type="button" className="ghost-btn" onClick={() => save({ ...DEFAULTS, mode: 'system' })}>{t('Reset appearance')}</button>
        </footer>
    </div>
  )
}
