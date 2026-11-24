// What the desktop app hands the server it starts, on a pipe of its own (fd 3: BRIDGE_WINDOW_FD), read
// once at start and closed: never the environment, a file in the open or anything a page has.
//   window  the secret the app's windows prove themselves with (windowkey.js), each request MAC'd
//   key     the key your saved signatures are sealed with (signstore.js), kept by the app in the
//           Keychain (Electron's safeStorage), so it isn't in the data folder and no helper hands it out
//   launch  a secret for this server's start only: the app asks the server to prove it has it
//           before it sends anything, so a program squatting on the port gets nothing
//   state   what the app last heard of the signatures' list ({ v, ask }): its version, so a copy of
//           an older list put back is noticed, and whether Ask Before Signing was on
//   store   where the app keeps those: 'keychain' (macOS), 'dpapi' (Windows), a Linux secret service,
//           or 'basic' when there's none (said in Settings › Studio)
//   listen  the address and port the app talks to it at ({ host, port }): an app-started server
//           listens there and nowhere else, whatever config.json says (index.js)
//   unreadable  the app couldn't read its own keys this time (its keychain item denied or damaged):
//           no key, so your signatures stay sealed for this run, and it's said (signstore.js)
//   code    the Mac app's own code-signing requirement (desktop/codesig.js): the signing helper
//           (signhelper.js) must be signed to it before anything it says is taken
// A server started any other way (npm start, the CLI, Docker) has none of them: its windows can't
// sign, and it keeps a key file of its own (signstore.js).
// In the tests only (BRIDGE_FIX_DRYRUN), the same comes from a file of the test's own
// (BRIDGE_TEST_WINDOW_FILE), read again at each start. There only, it can also say testHeader: a
// test's browser pages, which can't add a MAC to each request the way the app does outside its
// pages once a service worker has them (WebKit), send "test.<secret>" instead (windowkey.js); never
// from the app's pipe.
// Read as this module loads (index.js imports it first), so the pipe is closed before anything here
// starts a program of its own that could otherwise inherit it.
import fs from 'node:fs'

let got = null
const okSecret = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{32,100}$/.test(s)
function read() {
  if (got) return got
  let raw = null
  let fromTest = false
  const fd = Number(process.env.BRIDGE_WINDOW_FD)
  if (Number.isInteger(fd) && fd > 2) {
    try { raw = fs.readFileSync(fd, 'utf8') } catch { /* none */ }
    try { fs.closeSync(fd) } catch { /* closed */ }
  } else if (process.env.BRIDGE_FIX_DRYRUN && process.env.BRIDGE_TEST_WINDOW_FILE) {
    try { raw = fs.readFileSync(process.env.BRIDGE_TEST_WINDOW_FILE, 'utf8'); fromTest = true } catch { /* none */ }
  }
  delete process.env.BRIDGE_WINDOW_FD
  let j = null
  try { j = JSON.parse(String(raw || '').trim()) } catch { j = null }
  // (An app from before: the window's secret alone.)
  if (!j && okSecret(String(raw || '').trim())) j = { window: String(raw).trim() }
  const key = j && typeof j.key === 'string' ? Buffer.from(j.key, 'base64') : null
  got = {
    window: okSecret(j?.window) ? j.window : null,
    key: key?.length === 32 ? key : null,
    launch: okSecret(j?.launch) ? j.launch : null,
    state: j?.state && Number.isInteger(j.state.v) && j.state.v >= 0 ? { v: j.state.v, ask: j.state.ask === true } : null,
    store: ['keychain', 'dpapi', 'secret-service', 'basic'].includes(j?.store) ? j.store : null,
    listen: j?.listen && /^(127\.0\.0\.1|::1)$/.test(String(j.listen.host)) && Number.isInteger(j.listen.port) && j.listen.port > 0 && j.listen.port < 65536 ? { host: j.listen.host, port: j.listen.port } : null,
    unreadable: j?.unreadable === true,
    // (Tried again and still not opening: Start Over can be offered, signing.js.)
    startOver: j?.unreadable === true && j?.startOver === true,
    testHeader: fromTest && j?.testHeader === true,
    code: typeof j?.code === 'string' && j.code.length < 300 && /^(certificate leaf = H"[0-9a-f]{40}"|anchor apple generic and certificate leaf\[subject\.OU\] = "[A-Z0-9]{10}")$/.test(j.code) ? j.code : null,
  }
  return got
}
read()
export const appKeys = () => read()
