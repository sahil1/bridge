// The Android app's background check (CloudCheck.kt), at most every 15 minutes while you have a
// key on the phone: one look at the agents started from this phone, a notification for each one
// that finished, failed or started waiting on you since the last look, and what changed saved for
// next time. It goes by the provider's own state, so an agent you opened while it worked still
// says when it's done.
import { paneOf } from '../../shared/cloud/follow.js'
import { ADAPTERS } from '../../shared/cloud/index.js'
import { createPhone } from './backend.js'
import { call } from './native.js'

const where = (t) => [`${ADAPTERS[t.provider].info.name} cloud`, t.repo].filter(Boolean).join(' · ')
const snap = (tasks) => new Map(tasks.map((t) => [paneOf(t), { status: t.status, ask: t.ask || null }]))

export async function check() {
  try {
    const phone = createPhone({ check: true })
    await phone.ready
    const before = snap(phone.cloud.tasks())
    await phone.cloud.once()
    for (const t of phone.cloud.tasks()) {
      const b = before.get(paneOf(t))
      if (!b || t.muted || !phone.cloud.has(t.provider)) continue
      const title = t.title || 'A cloud agent'
      if (t.status === 'blocked' && (b.status !== 'blocked' || b.ask !== (t.ask || null))) await call('notify', { pane: paneOf(t), title: `${title} needs you`, body: t.ask || where(t) }).catch(() => {})
      else if ((t.status === 'done' || t.status === 'failed') && b.status !== t.status) await call('notify', { pane: paneOf(t), title: `${title} ${t.status === 'failed' ? 'failed' : 'finished'}`, body: where(t) }).catch(() => {})
    }
    await phone.flush()
  } finally {
    call('done').catch(() => {})
  }
}
