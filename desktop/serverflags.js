// What the built app starts its server with, on the app's own Node (main.js), before the script:
// SIGUSR1 doesn't open Node's inspector, which would let any program running as you read the server's
// memory (the window secret, the signatures' key). Electron's fuses turn off --inspect and
// NODE_OPTIONS, but not that signal. scripts/smoke.js starts a built app's server the same way and
// checks it.
module.exports = { SERVER_NODE_FLAGS: ['--disable-sigusr1'] }
