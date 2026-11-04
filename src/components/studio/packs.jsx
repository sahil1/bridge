import { useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll, refetch } from '../../api.js'
import { t } from '../../i18n/index.js'

// Design packs: your look once (colours, fonts, a logo) for every deck Studio draws and every
// PowerPoint it makes. The default one is used unless a deck names another (pack: Name in its front
// matter). Kept on this computer (server/studio.js).
export function useDesignPacks() {
  const { data, refresh } = usePoll('/studio/packs', 60_000)
  return { list: data?.packs || [], refresh }
}
// The pack for a file: the one its front matter names (a deck), else the default.
export function packFor(list, meta) {
  if (!list?.length) return null
  const named = meta?.pack && list.find((p) => p.name.toLowerCase() === String(meta.pack).toLowerCase())
  return named || list.find((p) => p.isDefault) || null
}

const FONTS = ['Inter', 'Helvetica Neue', 'Georgia', 'Avenir Next', 'Source Sans Pro', 'Merriweather', 'IBM Plex Sans', 'Menlo']
const BLANK = { name: '', colors: { background: '#ffffff', text: '#1f2328', accent: '#2a78d6' }, fonts: { heading: 'Inter', body: 'Inter' }, logo: null }

export function PacksSection({ packs }) {
  const [edit, setEdit] = useState(null) // a pack being made or changed
  const [err, setErr] = useState(null)
  const save = async (e) => {
    e.preventDefault()
    setErr(null)
    try { await api('/studio/packs', { method: 'POST', body: edit }); setEdit(null); packs.refresh(); refetch('/studio/packs') } catch (x) { setErr(x.message) }
  }
  const remove = async (p) => { if (!window.confirm(t('Delete the design pack "{name}"? Decks that use it go back to your default.', { name: p.name }))) return; await api(`/studio/packs/${p.id}`, { method: 'DELETE' }); packs.refresh() }
  const logo = (file) => {
    if (!file) return
    if (file.size > 280_000) { setErr(t('A smaller logo, please (under 280 KB).')); return }
    const r = new FileReader()
    r.onload = () => setEdit((x) => ({ ...x, logo: String(r.result) }))
    r.readAsDataURL(file)
  }
  const color = (k) => <label className="sd-pack-col"><input type="color" value={edit.colors[k] || '#000000'} onChange={(e) => setEdit((x) => ({ ...x, colors: { ...x.colors, [k]: e.target.value } }))} />{{ background: t('Background'), text: t('Text'), accent: t('Accent') }[k]}</label>
  const font = (k) => <label className="sd-pack-font">{k === 'heading' ? t('Headings') : t('Body')}<select value={edit.fonts[k]} onChange={(e) => setEdit((x) => ({ ...x, fonts: { ...x.fonts, [k]: e.target.value } }))}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select></label>
  return (
    <section className="sd-sec">
      <h3>{t('Design packs')}</h3>
      <p className="muted small">{t('Your colours, fonts and logo, once, for every deck Studio draws and every PowerPoint it makes.')}</p>
      <ul className="sd-packs">
        {packs.list.map((p) => (
          <li key={p.id} className="sd-pack">
            <span className="sd-pack-sw" style={{ background: p.colors?.background, color: p.colors?.text, fontFamily: p.fonts?.heading }}><b style={{ color: p.colors?.accent }}>Aa</b>{p.logo && <img src={p.logo} alt="" />}</span>
            <span className="sd-pack-name"><b>{p.name}</b>{p.isDefault && <small className="muted">{t('Default')}</small>}</span>
            <button type="button" className="ghost-btn" onClick={() => setEdit(p)}>{t('Change')}</button>
            {!p.isDefault && <button type="button" className="ghost-btn" onClick={() => api('/studio/packs', { method: 'POST', body: { ...p, isDefault: true } }).then(packs.refresh)}>{t('Make default')}</button>}
            <button type="button" className="ghost-btn" aria-label={t('Delete {name}', { name: p.name })} onClick={() => remove(p)}><Icon name="trash" size={12} /></button>
          </li>
        ))}
      </ul>
      {!edit && <button type="button" className="ghost-btn" onClick={() => setEdit({ ...BLANK, name: packs.list.length ? '' : t('My look') })}><Icon name="plus" size={12} /> {t('New design pack')}</button>}
      {edit && (
        <form className="sd-pack-form" onSubmit={save}>
          <input autoFocus value={edit.name} onChange={(e) => setEdit((x) => ({ ...x, name: e.target.value }))} placeholder={t('Its name')} aria-label={t('Name')} maxLength={60} />
          <div className="sd-pack-row">{color('background')}{color('text')}{color('accent')}</div>
          <div className="sd-pack-row">{font('heading')}{font('body')}</div>
          <label className="sd-pack-logo"><Icon name="image" size={12} /> {edit.logo ? t('Change the logo') : t('A logo')}<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => logo(e.target.files?.[0])} hidden /></label>
          {edit.logo && <button type="button" className="link-btn" onClick={() => setEdit((x) => ({ ...x, logo: null }))}>{t('No logo')}</button>}
          <span className="sd-pack-preview" style={{ background: edit.colors.background, color: edit.colors.text }}><b style={{ color: edit.colors.accent, fontFamily: edit.fonts.heading }}>{edit.name || t('A title')}</b><span style={{ fontFamily: edit.fonts.body }}>{t('And the words under it')}</span></span>
          <div className="sd-ask-acts"><button type="submit" className="btn small primary">{t('Save')}</button><button type="button" className="ghost-btn" onClick={() => { setEdit(null); setErr(null) }}>{t('Cancel')}</button></div>
          {err && <p className="error-text small">{err}</p>}
        </form>
      )}
    </section>
  )
}
