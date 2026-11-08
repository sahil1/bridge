import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { api, viaRelay } from '../api.js'
import { t } from '../i18n/index.js'

// First-run setup (Onboarding.jsx): where to set up Bridge AI on your phone. Setup asks for nothing,
// so it only says where: Settings › Devices, once setup is done (Bridge AI's relay there needs a Bold
// Bridge account, signed in and asked for in Settings › Account). Said only once Bridge AI's relay
// exists (server/hosted.js, server/account.js) and nothing is set up yet; otherwise none of this shows.
export function usePhoneOffer() {
  const [offer, setOffer] = useState(false)
  useEffect(() => { if (!viaRelay) api('/relay').then((r) => setOffer(!!r.hostedAvailable && !r.configured)).catch(() => {}) }, [])
  return { offer }
}

export function PhonePick() {
  return (
    <p className="wiz-awake wiz-phone" role="note">
      <Icon name="phone" size={14} />
      <b>{t('Use Bridge AI on your phone')}</b>
      <small>{t('Once setup is done, Settings › Devices sets it up: Bridge AI\'s relay with a Bold Bridge account, a relay on your own Cloudflare account, or Tailscale.')}</small>
    </p>
  )
}
