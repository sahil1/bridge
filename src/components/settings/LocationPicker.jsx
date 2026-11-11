import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api } from '../../api.js'
import { t } from '../../i18n/index.js'

// Pick a place: your device's location (macOS, Windows and phones ask first) or a city search.
// The label is the nearest city found by search, or your time zone's city for device location.
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const tzCity = () => tz().split('/').pop().replace(/_/g, ' ')

export default function LocationPicker({ value, onChange }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return }
    const timer = setTimeout(() => api(`/settings/geocode?q=${encodeURIComponent(q)}`).then(setHits).catch((e) => setErr(e.message)), 250)
    return () => clearTimeout(timer)
  }, [q])

  const here = () => {
    if (!navigator.geolocation) { setErr(t("This browser can't share a location. Search for your city instead.")); return }
    setBusy(true); setErr(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false)
        const round = (n) => Math.round(n * 1e3) / 1e3 // about 100 m: plenty for weather
        onChange({ label: value?.label && !value.approximate ? value.label : tzCity(), lat: round(pos.coords.latitude), lon: round(pos.coords.longitude), timezone: tz() })
      },
      (e) => { setBusy(false); setErr(e.code === 1 ? t('Location access was declined. Search for your city instead, or allow it in your system settings.') : t("Couldn't get your location. Search for your city instead.")) },
      { timeout: 12000, maximumAge: 10 * 60 * 1000 },
    )
  }

  return (
    <div className="loc">
      <div className="loc-current">
        <Icon name="sun" size={15} />
        {value ? <span><b>{value.label}</b> <span className="muted small">{value.lat?.toFixed?.(2)}, {value.lon?.toFixed?.(2)}{value.approximate ? ` · ${t('approximate, from your time zone')}` : ''}</span></span> : <span className="muted">{t('Not set')}</span>}
        <span className="loc-acts">
          <button type="button" className="ghost-btn strong" onClick={here} disabled={busy}><Icon name="dot" size={12} />{busy ? t('Locating…') : t('Use my location')}</button>
          {value && <button type="button" className="ghost-btn" onClick={() => onChange(null)}>{t('Clear')}</button>}
        </span>
      </div>
      <div className="loc-search">
        <Icon name="search" size={13} />
        <input value={q} onChange={(e) => { setQ(e.target.value); setErr(null) }} placeholder={t('Or search for a city…')} aria-label={t('Search for a city')} />
      </div>
      {hits.length > 0 && (
        <ul className="loc-hits">
          {hits.map((h, i) => (
            <li key={i}><button type="button" onClick={() => { onChange({ label: h.label, lat: h.lat, lon: h.lon, timezone: h.timezone }); setQ(''); setHits([]) }}>
              <b>{h.label}</b> <span className="muted small">{h.detail}</span>
            </button></li>
          ))}
        </ul>
      )}
      {err && <p className="error-text">{err}</p>}
    </div>
  )
}
