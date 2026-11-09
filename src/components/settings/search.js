import { t, tx } from '../../i18n/index.js'

// Every setting ⌘K finds (Palette.jsx), first in its section or under Advanced: its section, its
// name and the words it's looked for by. Its id is its data-setting there, and a link to it opens
// Settings at it, Advanced too (Settings.jsx; bridge-open-settings with section: its id). near: what
// to show instead when it isn't there just now (dictation's extras while dictation is off). when:
// only in the desktop app ('desktop'), with the desktop's top bar ('wide'), or with a beta feature
// on (its id, src/trials.js).
const at = (section, list) => list.map(([id, label, keywords = '', o = {}]) => ({ section, id, label, keywords, ...o }))

export const SETTINGS = [
  ...at('general', [
    ['name', tx('Your name'), 'first name call me morning brief'],
    ['default-agent', tx('Default agent'), 'claude codex gemini new agents chats routines'],
    ['default-model', tx('Default model'), 'model opus sonnet gpt flag', { near: 'default-agent' }],
    ['layout', tx('Layout'), 'simple everything panels today board'],
    ['location', tx('Location'), 'city weather morning brief place where'],
    ['chief', tx('Chief of Staff runs on'), 'chief of staff agent'],
    ['plan-usage', tx('Plan usage'), 'quota limits read sign-in anthropic'],
    ['permissions', tx('Permissions'), 'allow access microphone accessibility calendars full disk files automation notifications privacy macos', { near: 'name' }],
    ['commands', tx('Command History'), 'history commands asked keep delete', { when: 'routines' }],
    ['terminal', tx('Terminal app'), 'open in terminal iterm ghostty warp attach'],
    ['runtime', tx('Where agents run'), 'herdr built in runtime session'],
    ['keep-agents', tx('Keep agents running when Bridge AI quits'), 'quit stop agents running', { near: 'runtime' }],
    ['resume-work', tx('Pick up unfinished work after an update, a crash or a restart'), 'resume continue crash restart update', { near: 'default-agent' }],
  ]),
  ...at('agents', [
    ['agent-list', tx('Install an agent'), 'agents install sign in claude codex gemini copilot cursor opencode cli'],
    ['consult', tx('Your Chief of Staff can consult'), 'consult second opinion bridge ask models', { near: 'agent-list' }],
  ]),
  ...at('providers', [
    ['providers-labs', tx('API keys'), 'api key anthropic openai gemini xai grok mistral cohere perplexity meta'],
    ['accounts', tx('Accounts'), 'account switch work personal sign in login auto default', { near: 'providers-labs' }],
    ['providers-local', tx('Models on this computer'), 'local model ollama lm studio gemma offline download'],
    ['cloud', tx('Cloud Agents'), 'cloud agents cursor copilot jules claude managed keys'],
    ['providers-clouds', tx('Clouds'), 'azure aws bedrock vertex google cloud'],
    ['providers-hosted', tx('Hosted open models'), 'openrouter groq together fireworks cerebras hugging face'],
    ['more-models', tx('Show more models (Qwen Code, DeepSeek, Kimi, GLM)'), 'qwen deepseek kimi glm more models'],
    ['providers-speech', tx('Speech to text services'), 'deepgram assemblyai elevenlabs speech transcription keys'],
  ]),
  ...at('voice', [
    ['speech-model', tx('Speech to text'), 'speech model parakeet whisper transcribe download voice notes'],
    ['dictation', tx('Dictation'), 'dictation key talk hold fn background paste where typing'],
    ['edit-by-voice', tx('Edit by voice'), 'rewrite selection voice edit', { when: 'desktop', near: 'dictation' }],
    ['tidy', tx('Tidy what I say'), 'tidy cleanup filler um model', { when: 'dictation-cleanup', near: 'dictation' }],
    ['light-cleanup', tx('Light cleanup'), 'um uh capital full stop names', { near: 'dictation' }],
    ['mention-files', tx('Mention files by saying them'), 'at file mention say', { near: 'dictation' }],
    ['live-words', tx('Show the words as you talk'), 'live words as you talk', { near: 'dictation' }],
    ['dictation-history', tx('Dictation History'), 'history keep recordings delete dictations', { near: 'dictation' }],
    ['spoken-answers', tx('Spoken Answers'), 'read aloud voice speed speak answers ask out loud'],
  ]),
  ...at('meetings', [
    ['transcribe', tx('Transcribe with'), 'speech engine transcription service local apple'],
    ['speech-services', tx('Speech Services'), 'openai groq deepgram assemblyai elevenlabs gemini service', { near: 'transcribe' }],
    ['meeting-language', tx('Meeting language'), 'language detect english spanish french'],
    ['names-terms', tx('Names and terms'), 'memory vocabulary words names spelling misheard'],
    ['notes-model', tx('Notes are written by'), 'model summary notes automatic write summary'],
    ['transcript-cleanup', tx('Clean up the transcript when a meeting ends'), 'clean up fix misheard words transcript'],
    ['name-speakers', tx('Name who spoke on the call'), 'speakers names them who said'],
    ['prep', tx('Prepare for each meeting'), 'prepare prep goals questions mail invite calendar', { near: 'notes-model' }],
    ['calls', tx('Calls'), 'notice calls zoom meet teams record other side system audio stop'],
    ['save-markdown', tx('Save every meeting as Markdown'), 'markdown obsidian save notes folder'],
    ['meeting-assist', tx('AI Assist in meetings'), 'ai assist suggest what to ask how often instructions summary'],
    ['who-spoke', tx('Who Spoke'), 'speakers voices room learn my voice remember voices names from the call screen recording', { near: 'meeting-assist' }],
    ['mention-meeting', tx('Mention a Meeting'), 'mention meeting key @ message'],
    ['float-card', tx('The floating card'), 'floating card menu bar pause stop hover screenshot screen sharing hidden', { when: 'desktop' }],
    ['save-notes', tx('Save notes as Markdown'), 'folder subfolders file name pattern front matter yaml speakers obsidian granola'],
  ]),
  ...at('mail', [
    ['how-you-write', tx('How You Write'), 'tone voice profile replies drafts learn'],
    ['mail-learn', tx('Learn it again now and then'), 'learn how you write again weekly profile'],
    ['find-a-time', tx('Find a Time'), 'working days hours schedule meeting times'],
    ['find-a-time-more', tx('Kept clear around meetings'), 'buffer travel how many times offer'],
    ['mail-read-only', tx('Read-Only'), 'mail never changes send'],
  ]),
  ...at('phone', [
    ['relay', tx('From anywhere'), 'relay phone cloudflare pair a device remote away'],
    ['tailscale', tx('Tailscale'), 'tailscale phone access vpn'],
    ['machines', tx('Your Devices'), 'devices computers other computers'],
    ['link-device', tx('Link a device'), 'link pair computer address code'],
    ['this-device', tx('Notifications on this device'), 'notifications push turn on test'],
    ['notify', tx('What to notify about'), 'notify needs you finished usage low'],
    ['notify-more', tx('Answer buttons for simple questions (yes or no, or two short choices)'), 'answer buttons phone at computer muted unmute', { near: 'notify' }],
    ['notify-devices', tx('Devices getting notifications'), 'devices notifications remove', { near: 'notify' }],
    ['keep-awake', tx('Keep this computer awake while your phone can reach it'), 'awake sleep lid', { near: 'relay' }],
  ]),
  ...at('account', [
    ['delete-account', tx('Delete account…'), 'delete account bold bridge'],
  ]),
  ...at('appearance', [
    ['color-mode', tx('Color Mode'), 'dark light system mode'],
    ['theme', tx('Theme'), 'theme colors accent frame'],
    ['text-size', tx('Text Size'), 'text size zoom bigger smaller'],
    ['language', tx('Language'), 'language translate'],
    ['density', tx('Density'), 'compact comfortable'],
    ['font', tx('Font'), 'font typeface'],
    ['share-theme', tx('Share a Theme'), 'copy paste theme'],
    ['topbar', tx('In the Top Bar'), 'pin unpin top bar status weather clock usage sounds', { when: 'wide' }],
  ]),
  ...at('config', [
    ['config-file', tx('config.json'), 'json config file edit'],
    ['config-effective', tx('Effective Settings and Defaults'), 'effective defaults json'],
  ]),
  ...at('about', [
    ['version', tx('Check for new versions'), 'version update check'],
    ['auto-update', tx("Update by itself while you're away"), 'auto update automatic', { when: 'desktop', near: 'version' }],
    ['beta', tx('Beta Features'), 'beta trials studio home files routines insights tab groups'],
    ['report', tx('Report a problem'), 'bug issue github idea feedback'],
    ['usage-counts', tx('Usage Counts'), 'telemetry analytics anonymous share', { near: 'report' }],
    ['crash-reports', tx('Crash Reports'), 'crash reports send', { near: 'report' }],
    ['tour', tx('Take the tour'), 'tour help'],
    ['license', tx('License and Credits'), 'license terms privacy notices star'],
  ]),
]

const PLACES = {
  general: tx('General'), agents: tx('Agents'), providers: tx('Model Providers'), voice: tx('Voice'), meetings: tx('Meetings'), mail: tx('Mail'),
  mcp: tx('MCP Servers'), phone: tx('Devices'), account: tx('Account'), appearance: tx('Appearance'), config: tx('Config File'), about: tx('About & Updates'),
}
export const placeOf = (x) => t(PLACES[x.section])

// The ones that can show here: Mail's where Mail is read, Account's once Bold Bridge accounts exist,
// the desktop app's in it, the top bar's with it, and a beta feature's while it's on.
export const findable = (conf) => SETTINGS.filter((x) => (x.section !== 'mail' || conf?.mail) && (x.section !== 'account' || conf?.accounts)
  && (x.when !== 'desktop' || !!window.bridgeApp?.desktop) && (x.when !== 'wide' || matchMedia('(min-width: 900px)').matches)
  && (!x.when || ['desktop', 'wide'].includes(x.when) || conf?.trials?.[x.when] === true))
