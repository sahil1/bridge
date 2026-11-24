import { t } from '../i18n/index.js'

// Why one of your other computers can't be reached, in a few words, for wherever it's listed (the
// devices menu, the sidebar, the agent map, Settings › Devices & Access › Computers), so none of them
// says only "Offline" when there's more to it: turned away, its relay out of reach, moved, too old.
// The whole sentence, with what to do (server/machines.js list: error), goes in a title beside it, and
// Settings says it in full. m: a computer as /api/machines or /api/agent-map gives it. null: nothing
// more to say than that it's offline (its relay says it isn't connected), or it's connected.
export function whyNot(m) {
  if (!m || m.online || m.notLetIn) return null
  return ({
    unreachable: t("Can't reach its relay"),
    unchecked: t("Can't connect"),
    gone: t("Not at its relay's address"),
    norelay: t('No relay to reach it by'),
    noAnswer: t('Not answering'),
    update: t('Needs a Bridge AI update'),
  })[m.why] || null
}
