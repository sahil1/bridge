// The environment a bot's agent starts with (its answering agent, or a session's), and the variables
// kept from its commands.
//
// A bot's agent works for whoever asked it, so it starts with no more of yours than it needs to run:
// where things are (PATH, HOME, the language, the terminal, the system's own on Windows), how to reach
// the network (a proxy, the certificates it trusts) and how this agent signs in (Claude Code: its
// Anthropic, Bedrock or Vertex settings and its account's folder; Codex: OpenAI's). Not your Model
// Providers keys for other agents, nor anything else of your shell's or Bridge AI's own (keptEnv). Its
// terminal starts it as it is, not through your login shell, whose profile could set more again
// (runtime/builtin.js). Where the runtime starts it in a shell of its own (herdr), the same: every
// variable there that it wouldn't keep is set empty (blanked), as no variable can be taken away there.
//
// What it still has for its own sign-in is kept from its commands (a session's Bash, in Claude Code's
// sandbox): each one named in sandbox.credentials.envVars with mode deny, which Claude Code unsets
// before each sandboxed command (code.claude.com/docs/en/settings-reference, sandbox.credentials.envVars),
// with every provider's key, GitHub's tokens and the cloud ones besides (CREDENTIALS): botmcp.js.
// To check with the real Claude Code: whether a sandboxed command can read its parent's environment
// (Claude Code's, which has its sign-in) another way. On Linux, /proc/<its parent>/environ; on macOS,
// ps -wwE -p $PPID, which the system gives a process's own user (KERN_PROCARGS2) unless the sandbox's
// profile denies it (process-info). Neither is something the stand-in can show.
import { PROVIDERS } from './providers.js'
import { IS_WIN } from './paths.js'

const COMMON = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LANGUAGE', 'TERM', 'COLORTERM', 'TZ', 'TMPDIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'DISABLE_TELEMETRY', 'DO_NOT_TRACK',
])
// (Windows' own, which PowerShell, Node and the agent need to start at all.)
const WINDOWS = new Set([
  'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432',
  'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'COMMONPROGRAMW6432', 'TEMP', 'TMP', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'HOMEDRIVE', 'HOMEPATH',
  'PSMODULEPATH', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'PUBLIC', 'ALLUSERSPROFILE', 'SYSTEMDRIVE',
])
// Each agent's own sign-in and settings: Claude Code's (code.claude.com/docs/en/env-vars), with the
// cloud's only when it's told to use that cloud; Codex's.
const CLAUDE = /^(ANTHROPIC_\w+|CLAUDE_CONFIG_DIR|CLAUDE_CODE_(USE_BEDROCK|USE_VERTEX|USE_FOUNDRY|SKIP_BEDROCK_AUTH|SKIP_VERTEX_AUTH|SKIP_FOUNDRY_AUTH|OAUTH_TOKEN|CLIENT_CERT|CLIENT_KEY|CLIENT_KEY_PASSPHRASE|GIT_BASH_PATH|DISABLE_NONESSENTIAL_TRAFFIC|MAX_OUTPUT_TOKENS)|MAX_THINKING_TOKENS)$/
const BEDROCK = /^AWS_(REGION|DEFAULT_REGION|PROFILE|ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|BEARER_TOKEN_BEDROCK|CONFIG_FILE|SHARED_CREDENTIALS_FILE)$/
const VERTEX = /^(CLOUD_ML_REGION|VERTEX_REGION_\w+|GOOGLE_CLOUD_PROJECT|GOOGLE_CLOUD_LOCATION|GOOGLE_APPLICATION_CREDENTIALS|CLOUDSDK_CONFIG)$/
const CODEX = /^(OPENAI_(API_KEY|BASE_URL|ORG_ID|ORGANIZATION|PROJECT_ID)|CODEX_HOME|AZURE_OPENAI_\w+)$/
const on = (v) => !!v && !/^(0|false|no|off)$/i.test(String(v))
const COMMON_UPPER = new Set([...COMMON].map((k) => k.toUpperCase()))

// Whether a variable is one this kind of agent starts with.
// (On Windows, where a bot's agent never runs commands, so nothing it runs can read its environment:
// all but what holds a key that isn't its own sign-in, and the markers of the session Bridge AI may
// itself run in. Windows' own and PowerShell's (its module paths and caches, the processor, the
// profile folders) are more than a list would keep up with, and the terminal that starts the agent
// (PowerShell, which on a run that changes files first gives up Windows' backup rights: winpriv.js)
// needs them; a key's name is what's kept out. A name is the same whatever its case: Path is PATH.)
const KEYLIKE = /KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL|AUTH|HEADERS/i
const MARKERS = /^(HERDR_|TMUX$|CLAUDECODE$|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_CODE_(ENTRYPOINT|CHILD_SESSION|SESSION_ID|SESSION_ATTENDED|BRIDGE_SESSION_ID|MESSAGING_SOCKET|MESSAGING_TOKEN|EXECPATH|SSE_PORT)$)/i
export function keeps(kind, name, env = {}) {
  const k = String(name)
  if (COMMON.has(k) || /^LC_[A-Z]+$/.test(k)) return true
  if (IS_WIN && (WINDOWS.has(k.toUpperCase()) || COMMON_UPPER.has(k.toUpperCase()))) return true
  const own = kind === 'claude' ? CLAUDE.test(k) || (on(env.CLAUDE_CODE_USE_BEDROCK) && BEDROCK.test(k)) || (on(env.CLAUDE_CODE_USE_VERTEX) && VERTEX.test(k)) : kind === 'codex' ? CODEX.test(k) : false
  if (own) return true
  if (IS_WIN) return !MARKERS.test(k) && !KEYLIKE.test(k) && !CREDENTIALS_SET().has(k.toUpperCase()) && !/^(ANTHROPIC_|OPENAI_|CODEX_|CLAUDE_CONFIG_DIR$)/i.test(k)
  return false
}
// The environment, of all given (yours, Bridge AI's, your saved keys, the account's folder), it starts
// with: what it keeps, then extra (what Bridge AI gives this run: its hook's Node, its session's own
// folders), as given.
export function keptEnv(kind, all = {}, extra = {}) {
  const out = {}
  for (const [k, v] of Object.entries(all || {})) if (v != null && keeps(kind, k, all)) out[k] = String(v)
  return { ...out, ...extra }
}
// Every variable that holds a key: your Model Providers' (each field and the names it's also read
// as), Claude Code's and GitHub's and the clouds' besides. Kept from a session's commands (sandbox
// credentials, deny), and set empty where its runtime starts it with a shell's own environment.
const KNOWN = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
  'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GITHUB_PAT', 'GITLAB_TOKEN', 'GL_TOKEN', 'BITBUCKET_TOKEN',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_BEARER_TOKEN_BEDROCK', 'GOOGLE_APPLICATION_CREDENTIALS', 'AZURE_CLIENT_SECRET',
  'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'PYPI_TOKEN', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'DISCORD_TOKEN', 'SSH_AUTH_SOCK',
  // (Claude Code's own that carry a sign-in: a header with a key in it, Foundry's key, a client key.)
  'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_FOUNDRY_API_KEY', 'CLAUDE_CODE_CLIENT_KEY', 'CLAUDE_CODE_CLIENT_CERT',
  'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_VERTEX_BASE_URL', 'ANTHROPIC_FOUNDRY_BASE_URL', 'ANTHROPIC_BASE_URL',
  'AZURE_API_KEY', 'AZURE_OPENAI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'CLOUDSDK_AUTH_ACCESS_TOKEN', 'GOOGLE_OAUTH_ACCESS_TOKEN',
]
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
let credentialsSet = null
const CREDENTIALS_SET = () => (credentialsSet ||= new Set(CREDENTIALS.map((x) => x.toUpperCase())))
export const CREDENTIALS = [...new Set([
  ...KNOWN,
  ...PROVIDERS.flatMap((p) => [...p.fields.filter((f) => f.type === 'secret').map((f) => f.env), ...(p.alsoEnv || []), ...Object.keys(p.aliases || {}).filter((a) => /KEY|TOKEN|SECRET/i.test(a))]),
])].filter((n) => NAME.test(n)).sort()
// Of all given, the variables that look like a key and aren't this agent's own sign-in: set empty for
// it where its runtime starts it in a shell with that shell's environment (herdr).
// (Every name it's given, every key besides, that it wouldn't keep: keptEnv's list, as a shell's
// environment can only be emptied a name at a time.)
export function blanked(kind, all = {}) {
  const names = new Set([...CREDENTIALS, ...Object.keys(all || {})])
  return Object.fromEntries([...names].filter((k) => NAME.test(k) && !keeps(kind, k, all)).map((k) => [k, '']))
}
