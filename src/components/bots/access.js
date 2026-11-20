import { t } from '../../i18n/index.js'

// What a bot may do, in one line ("3 people may ask · reads ~/Hiring · own memory · suggests
// changes"): on its page over its tabs, in Settings › Bots, on the Bots overview's cards, and for a
// starting point before it's made. From its settings as its page has them, or the list's access in
// brief (server/index.js accessOf: how many are named, never who), or a template's access (start:
// before anyone's named, so "people you name", with its limits). A bot that changes files says where,
// and whose changes are made without asking you ("changes files in ~/Hiring for you; asks you first
// for anyone else"); one that hands changes on, that it does.
const count = (x) => (Array.isArray(x) ? x.length : Number(x) || 0)
function editsSaid(a) {
  const w = Array.isArray(a?.writesTo) ? a.writesTo : []
  if (!w.length) return t('changes files once you pick its folders')
  const folder = w.length === 1 ? w[0] : t('{folder} and {n} more', { folder: w[0], n: w.length - 1 })
  const others = count(a?.trusted)
  if (a?.trustYou === false) return others ? t('changes files in {folder} for {n} named; asks you first for anyone else, you too', { folder, n: others }) : t('changes files in {folder} once you approve each change', { folder })
  return others ? t('changes files in {folder} for you and {n} named; asks you first for anyone else', { folder, n: others }) : t('changes files in {folder} for you; asks you first for anyone else', { folder })
}
export function accessParts(a, { start = false } = {}) {
  const askers = count(a?.askers)
  const folders = Array.isArray(a?.readsFrom) ? a.readsFrom : []
  const mcp = count(a?.mcp)
  const who = a?.who === 'channels' ? t('anyone in its channels may ask')
    : start ? t('people you name may ask')
      : askers === 0 ? t('nobody named may ask yet') : askers === 1 ? t('1 person may ask') : t('{n} people may ask', { n: askers })
  const reads = !folders.length ? (start ? null : t('reads no folders')) : folders.length === 1 ? t('reads {folder}', { folder: folders[0] }) : t('reads {folder} and {n} more', { folder: folders[0], n: folders.length - 1 })
  const memory = a?.memory === 'off' ? t('no memory') : a?.memory === 'auto' ? t('own memory, kept straight away') : t('own memory')
  const changes = a?.changes === 'edit' ? editsSaid(a) : a?.changes === 'pr' ? t('opens draft pull requests') : a?.changes === 'suggest' ? t('suggests changes')
    : count(a?.handsTo) ? t('changes nothing; hands changes to files on') : t('changes nothing')
  const servers = mcp === 1 ? t('1 MCP server') : mcp > 1 ? t('{n} MCP servers', { n: mcp }) : null
  const limits = start && a?.limits?.day ? t('{n} questions a day each', { n: a.limits.day }) : null
  // (When You Ask: Full Access, server/frontdesk.js: your own asks run as your own Claude Code.)
  const full = a?.fullAccess === true ? t('Full Access when you ask') : null
  return [who, reads, memory, changes, servers, limits, full].filter(Boolean)
}
const cap = (s) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s)
export const accessSaid = (a, o) => cap(accessParts(a, o).join(' · '))
// Why the hook that checks each file a change writes didn't run, or couldn't (server/frontdesk.js
// guardNotRun, the record's guard: { why, need, have }): your Claude Code too old for it on Windows,
// its version unknown there, or Claude Code not running it. For Activity and Needs You.
export const guardWhy = (g) => (g?.why === 'claude-old' ? t('changing files on Windows needs Claude Code {need} or later, and this computer has {have}', { need: g.need || '', have: g.have || '' })
  : g?.why === 'claude-unknown' ? t('changing files on Windows needs Claude Code {need} or later, and its version here couldn\'t be read', { need: g.need || '' })
    : t('Claude Code didn\'t run it: settings of yours or your organization\'s may turn hooks off, or it couldn\'t start'))
