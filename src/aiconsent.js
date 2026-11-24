// Your OK on a phone before what you give Bridge AI goes on to an AI provider (server/aiconsent.js).
// A request your computer refuses for it (409, code 'consent', with the provider and what it's for)
// is held here (api.js call) while the sheet asks (components/AiConsent.jsx): Allow tells your
// computer and sends the request again; Not Now sends nothing, and says so. One sheet at a time:
// requests waiting on the same provider share its answer, and others wait their turn. The demo and
// Cloud Agents ask the same way, keeping the answers on the phone (src/demo, src/cloud).
import { t } from './i18n/index.js'

let queue = [] // [{ consent: { provider, feature }, done: [resolve] }]
const subs = new Set()
const told = () => { for (const f of subs) f(queue[0]?.consent || null) }
// The one showing now (null: none), and to hear when that changes.
export const consentAsk = { get: () => queue[0]?.consent || null, subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn) } }

// true once allowed, false for Not Now (or when no window can ask: nothing is sent then either).
export function askConsent(consent) {
  if (!consent?.provider?.id || !subs.size) return Promise.resolve(false)
  const waiting = queue.find((x) => x.consent.provider.id === consent.provider.id)
  return new Promise((resolve) => {
    if (waiting) waiting.done.push(resolve)
    else { queue.push({ consent, done: [resolve] }); if (queue.length === 1) told() }
  })
}
// The answer to the one showing.
export function answerConsent(yes) {
  const it = queue.shift()
  if (!it) return
  for (const r of it.done) r(!!yes)
  if (!yes) notSent(it.consent.provider)
  told()
}

// A refusal for want of your OK (409, code 'consent') for a provider not asked about yet in this
// request (asked: their ids).
export const consentAsked = (status, data, asked = []) => status === 409 && data?.code === 'consent' && !!data.consent?.provider?.id && !asked.includes(data.consent.provider.id)
// ...asked: once allowed, told to the computer that refused it (its /api/ai-consent: the same
// /m/<id> as the request), for the caller to send again. Not Now throws, saying nothing was sent
// (code 'consentDeclined'), so whatever was sending says so and keeps what you wrote.
export async function settleConsent(url, data) {
  const c = data.consent
  if (!(await askConsent(c))) throw Object.assign(new Error(notSentText(c.provider)), { status: 409, code: 'consentDeclined', data })
  const at = String(url).replace(/\/api\/.*$/, '/api/ai-consent')
  const r = await fetch(at, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: c.provider, feature: c.feature || null }) })
  if (!r.ok) throw Object.assign(new Error(t("Your OK for {name} couldn't be kept, so nothing was sent. Try again.", { name: c.provider.name })), { status: r.status })
}

// What Not Now leaves behind, for the line the sheet shows once it's gone (never silent).
let said = null
const saidSubs = new Set()
export const consentSaid = { get: () => said, subscribe: (fn) => { saidSubs.add(fn); return () => saidSubs.delete(fn) }, clear: () => { said = null; for (const f of saidSubs) f(null) } }
function notSent(provider) {
  said = { text: notSentText(provider), at: Date.now() }
  for (const f of saidSubs) f(said)
}
export const notSentText = (provider) => t('Not sent. You chose Not Now, so nothing went to {name}. Send it again to be asked again.', { name: provider?.name || t('the provider') })
