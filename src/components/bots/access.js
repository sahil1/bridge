import { t } from '../../i18n/index.js'

// What a bot may do, in one line ("3 people may ask · reads ~/Hiring · own memory · suggests
// changes"): on its page over its tabs, in Settings › Bots, on the Bots overview's cards, and for a
// starting point before it's made. From its settings as its page has them, or the list's access in
// brief (server/index.js accessOf: how many are named, never who), or a template's access (start:
// before anyone's named, so "people you name", with its limits).
const count = (x) => (Array.isArray(x) ? x.length : Number(x) || 0)
export function accessParts(a, { start = false } = {}) {
  const askers = count(a?.askers)
  const folders = Array.isArray(a?.readsFrom) ? a.readsFrom : []
  const mcp = count(a?.mcp)
  const who = a?.who === 'channels' ? t('anyone in its channels may ask')
    : start ? t('people you name may ask')
      : askers === 0 ? t('nobody named may ask yet') : askers === 1 ? t('1 person may ask') : t('{n} people may ask', { n: askers })
  const reads = !folders.length ? (start ? null : t('reads no folders')) : folders.length === 1 ? t('reads {folder}', { folder: folders[0] }) : t('reads {folder} and {n} more', { folder: folders[0], n: folders.length - 1 })
  const memory = a?.memory === 'off' ? t('no memory') : a?.memory === 'auto' ? t('own memory, kept straight away') : t('own memory')
  const changes = a?.changes === 'pr' ? t('opens draft pull requests') : a?.changes === 'suggest' ? t('suggests changes') : t('changes nothing')
  const servers = mcp === 1 ? t('1 MCP server') : mcp > 1 ? t('{n} MCP servers', { n: mcp }) : null
  const limits = start && a?.limits?.day ? t('{n} questions a day each', { n: a.limits.day }) : null
  return [who, reads, memory, changes, servers, limits].filter(Boolean)
}
const cap = (s) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s)
export const accessSaid = (a, o) => cap(accessParts(a, o).join(' · '))
