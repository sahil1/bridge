import { t, tx, locale } from '../../../i18n/index.js'

// How a signing was asked for (server/signauth.js), and the line a document's versions keep for it
// (server/studio.js noteSigned): "Signed by you on Studio Mac (Touch ID)", the places, the time.
export const HOW = { touchid: tx('Touch ID'), password: tx('the Mac\'s password'), hello: tx('Windows Hello'), pin: tx('signing PIN') }
export const signedLine = (rec) => (rec?.how && HOW[rec.how]
  ? t('Signed by you on {computer} ({how})', { computer: rec.on || t('this computer'), how: t(HOW[rec.how]) })
  : t('Signed by you on {computer}', { computer: rec?.on || t('this computer') }))

// "2 signatures, 1 set of initials and 1 date, on pages 1 and 3"
export function placesLine(places = []) {
  const count = (k) => places.filter((m) => m.kind === k).length
  const parts = [
    count('signature') && (count('signature') === 1 ? t('1 signature') : t('{n} signatures', { n: count('signature') })),
    count('initials') && (count('initials') === 1 ? t('1 set of initials') : t('{n} sets of initials', { n: count('initials') })),
    count('date') && (count('date') === 1 ? t('1 date') : t('{n} dates', { n: count('date') })),
  ].filter(Boolean)
  const pages = [...new Set(places.map((m) => m.page))].sort((a, b) => a - b)
  if (!parts.length) return ''
  return t('{what}, on {pages}', { what: parts.join(', '), pages: pages.length === 1 ? t('page {n}', { n: pages[0] }) : t('pages {list}', { list: pages.join(', ') }) })
}
export const signedWhen = (iso) => new Date(iso).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
