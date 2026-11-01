// What's personal in a piece of text, wherever it turns up: keys and tokens, email addresses, home
// folders and Tailscale machine names. scripts/check-private.js keeps them out of the repo, and a
// crash report (shared/crashreport.js) takes them out before anyone reads it.

// Keys and tokens, by their shapes.
export const SECRETS = [
  ['an Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['an OpenAI-style key', /\bsk-(proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],
  ['a GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ['an AWS access key', /\b(AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a JSON web token', /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/],
  ['a web-push private key', /"privateKey"\s*:\s*"[A-Za-z0-9_-]{40,}"/],
]

// Home folders of users that aren't anyone in particular (bridge: the user inside the Docker image,
// whose home is /home/bridge).
export const GENERIC_USER = new Set(['you', 'me', 'user', 'username', 'name', 'runner', 'example', 'shared', 'public', 'yourname', 'your-name', '<you>', 'jane', 'john', 'alice', 'bob', 'admin', 'default', 'bridge'])
// A home folder and the user it's named for (the first group).
export const HOME_PATH = /(?:\/Users\/|\/home\/|[A-Za-z]:\\\\?Users\\\\?)([A-Za-z0-9._-]+)/
// Addresses made to be public, or the companies whose tools Bridge AI runs.
export const ALLOW_EMAIL = /(noreply|no-reply)@|@(users\.noreply\.github\.com|example\.(com|org)|anthropic\.com|openai\.com)$|^git@github\.com$/i
export const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/
// A machine on someone's tailnet (a name that only says what it is, like your-mac.tail1234.ts.net, aside).
export const TAILNET = /\b[a-z0-9-]+\.[a-z0-9-]+\.ts\.net\b/i
export const GENERIC_TAILNET = /^(your|my|machine|device|name|example)[.-]/i
