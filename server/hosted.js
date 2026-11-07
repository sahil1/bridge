// Bridge AI's hosted relay (relay/HOSTED.md): a relay the project runs, so a phone can reach this
// computer without a Cloudflare account of your own. Until it exists this stays empty, and while
// it's empty the option shows nowhere (Settings, first-run setup, the command line).
//
// The one place to switch it on: its address below, e.g. 'https://example.com'. One computer can
// also point at another with "relay": { "hostedUrl": "https://…" } in its config.json, and
// BRIDGE_HOSTED_URL stands in for this one (the tests set it empty, so none reaches the project's).
import { loadConfig } from './paths.js'

export const HOSTED_URL = ''

// Its address, or null when there's none. https only (plain http just for a test relay on this
// computer).
export function hostedBase() {
  const u = String(loadConfig().relay?.hostedUrl ?? process.env.BRIDGE_HOSTED_URL ?? HOSTED_URL).trim().replace(/\/+$/, '')
  return /^https:\/\/[a-z0-9.-]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(u) ? u : null
}
