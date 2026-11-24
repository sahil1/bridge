import { t, locale } from '../../i18n/index.js'

// How handing a meeting's action items on by themselves went (server/meetitems.js runOf), in a line:
// on the meeting, on Chief of Staff's board and in its settings. bad: it didn't go.

const at = (iso) => new Date(iso).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// "2 placed · 1 asks you · 1 not placed yet".
export function countsSaid(c) {
  if (!c) return ''
  return [
    c.placed > 0 && t('{n} placed', { n: c.placed }),
    c.asks > 0 && (c.asks === 1 ? t('1 asks you') : t('{n} ask you', { n: c.asks })),
    c.waiting > 0 && t('{n} being placed', { n: c.waiting }),
    c.stale > 0 && t('{n} not placed yet', { n: c.stale }),
    c.failed > 0 && (c.failed === 1 ? t("1 helper couldn't start") : t("{n} helpers couldn't start", { n: c.failed })),
    c.left > 0 && t('{n} left with you', { n: c.left }),
    c.done > 0 && t('{n} done', { n: c.done }),
  ].filter(Boolean).join(' · ')
}

export function runSaid(run, { title = false } = {}) {
  if (!run) return null
  const name = title ? run.title : null
  const when = at(run.at)
  const max = run.max || 12
  const more = run.capped > 0
    ? ` ${run.capWhy === 'day'
      ? (run.capped === 1 ? t('One more stays here for you: no more than {max} a day go by themselves.', { max: run.dayMax || 30 }) : t('{n} more stay here for you: no more than {max} a day go by themselves.', { n: run.capped, max: run.dayMax || 30 }))
      : (run.capped === 1 ? t('One more stays here for you: a meeting hands on {max} at most.', { max }) : t('{n} more stay here for you: a meeting hands on {max} at most.', { n: run.capped, max }))}`
    : ''
  if (run.state === 'failed') return { bad: true, text: name ? t("Couldn't hand {title}'s action items to Chief of Staff: {error}", { title: name, error: run.error }) : t("Couldn't hand these to Chief of Staff: {error}", { error: run.error }) }
  if (run.state === 'placing' || run.state === 'telling') return { text: t('Chief of Staff is placing them…') }
  if (run.state === 'capped') return { text: name ? t("{title}: none handed on, {when}: no more than {max} a day go by themselves.", { title: name, when, max: run.dayMax || 30 }) : t('None handed on: no more than {max} a day go by themselves. They stay here for you.', { max: run.dayMax || 30 }) }
  if (run.state === 'none') return { text: name ? t('{title} had no action items, {when}.', { title: name, when }) : t('No action items, so nothing went to Chief of Staff.') }
  if (run.state === 'yours') return { text: name ? t("{title}'s action items were all yours, {when}: they stay on the meeting.", { title: name, when }) : t('Every action item is yours, so they stay here.') }
  const c = countsSaid(run.counts)
  const head = run.by === 'you'
    ? (name ? t('{title}: placed by Chief of Staff on {when}, when you tried again.', { title: name, when }) : t('Placed by Chief of Staff on {when}, when you tried again.', { when }))
    : (name ? t('{title}: placed by Chief of Staff by itself on {when}.', { title: name, when }) : t('Placed by Chief of Staff by itself on {when}.', { when }))
  return { text: `${head}${c ? ` ${c}.` : ''}${more}` }
}
