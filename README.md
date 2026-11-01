# Bridge AI

**The bridge between you and your AI agents.** Tell a chief of staff what you need and it hands the work to the right agent, while your agents (Claude Code, Codex, Gemini CLI, Copilot, OpenCode and others, plus cloud agents) work in parallel. Spaces keep every project organized, and one window holds every provider, on your computer and your phone.

Bridge AI runs on your device. Your agents use their own logins; Bridge AI only reads their screens and transcripts and types into them for you. Nothing is sent anywhere else.

[![Bridge AI 3.0 in under a minute, with sound](site/poster.jpg)](https://sahil1.github.io/bridge/)

**[Download](https://sahil1.github.io/bridge/)** for macOS, Windows or Linux (the page offers the one for your computer, Apple Silicon or Intel) · **[Try the demo](https://sahil1.github.io/bridge/demo/)** in your browser, with made-up agents · [All releases](https://github.com/sahil1/bridge/releases/latest)

## Install

The app needs nothing else installed: no Node, no clone. Bridge AI finds the agent CLIs you already have and offers to install one if you have none.

### macOS

Paste this in Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh
```

It downloads the app for your Mac (Apple Silicon or Intel, macOS 14 Sonoma or later), checks it against the release's checksums, puts it in Applications and opens it, in a few seconds. Run it again to update. On macOS 13 Ventura it installs Bridge AI 3.7.1, the last version for it, and says so.

Prefer a download? Get `Bridge-AI-mac-arm64.dmg` (Apple Silicon) or `Bridge-AI-mac-x64.dmg` (Intel) from [Releases](https://github.com/sahil1/bridge/releases/latest) and drag Bridge AI to Applications. It's signed and notarized by Apple, so it opens without a warning.

### Windows

Paste this in PowerShell:

```powershell
irm https://raw.githubusercontent.com/sahil1/bridge/main/install.ps1 | iex
```

It installs Bridge AI for your user (no admin needed), adds it to the Start menu and opens it. Run it again to update. Or download `Bridge-AI-win-x64.exe` from [Releases](https://github.com/sahil1/bridge/releases/latest); it isn't signed yet, so SmartScreen may ask first: **More info › Run anyway**.

### Linux

The same command as macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh
```

On Debian and Ubuntu it installs the `.deb` (it asks for your password); elsewhere, or without sudo, it unpacks the AppImage into `~/.local/share/bridge-ai` (no FUSE needed) with a menu entry and a `bridge-ai` command. 64-bit Intel/AMD only for now. Both files are also on the [Releases](https://github.com/sahil1/bridge/releases/latest) page.

### Removing it

- **macOS**: quit Bridge AI and move it from Applications to the Trash.
- **Windows**: Settings › Apps › Installed apps › Bridge AI › Uninstall.
- **Linux**: `sudo apt remove bridge-ai-desktop` where it came as a `.deb` (Debian, Ubuntu); otherwise delete `~/.local/share/bridge-ai`, `~/.local/bin/bridge-ai` and the menu entry, `~/.local/share/applications/dev.bridge-ai.app.desktop` (`bridge-ai.desktop` if it was installed before 3.7.1).

Your settings, meeting notes and the rest stay in `~/.bridge-ai` in case you install it again; delete that folder to remove them too.

### From source

You need [Node.js](https://nodejs.org) 20 or newer and at least one agent CLI installed (for example [Claude Code](https://docs.claude.com/en/docs/claude-code) or [Codex](https://github.com/openai/codex)).

```bash
git clone https://github.com/sahil1/bridge.git
cd bridge
npm start
```

Open http://127.0.0.1:7420. The first start installs dependencies and builds the UI, which takes a minute.

The first time you open it, Bridge AI looks at what's already on your computer: the agent CLIs you have and whether you're signed in to them (your Claude, ChatGPT or Gemini subscriptions keep working as they are), your name and your time zone. It shows your AI and the agent your chief of staff will run on, with a Sign in button if it needs one; **Start** saves it and starts your chief of staff, and **More details** has your name, the weather and your phone. If no agent is installed yet, it asks which AI you pay for and installs its agent in a terminal tab you can watch. New installs start on the **simple layout**: your chief of staff and your agents, with the Today panel behind one button and the Agents board once you have agents. Settings › General › Layout switches to **Everything**. Then a short tour points out the main parts of the app (the phone gets its own); take it again any time from Settings › About & Updates or `⌘K`.

```bash
npm start -- dev     # hot reload: open :7421; UI edits appear live, server edits restart the API
npm run desktop:dev  # the desktop app with hot reload (runs next to the installed app)
npm start -- phone   # also publish over Tailscale HTTPS for your phone
npm run stop         # stop the server; agents keep running (npm run stop -- agents stops them too)
```

### From your terminal

Run `npm link` once in the repo to get the `bridge-ai` command:

```bash
bridge-ai list              # every agent and shell, numbered
bridge-ai attach 2          # work in one from this terminal (or: bridge-ai attach "api tests"); Ctrl+] detaches
bridge-ai attach            # pick from a list
bridge-ai open              # open the app in your browser
bridge-ai start / stop
bridge-ai status            # is it running, which agents, the relay and paired phones
bridge-ai relay setup       # your phone relay, with a Cloudflare API token (no browser needed)
bridge-ai pair              # pair a phone: QR code, link and code, right in the terminal
bridge-ai phones            # paired phones (bridge-ai phones remove <name>)
```

Attaching gives you the agent's real terminal, in your terminal app, with its keys, fonts and scrollback, the way `tmux attach` or `herdr` does. The agent keeps running in Bridge AI when you detach, and the app stays in sync. The terminal button on each agent (and "Open in terminal app" in the sidebar menu) opens the same thing in Ghostty, iTerm, Warp, WezTerm, kitty, Alacritty or Terminal on macOS, your terminal on Linux, or Windows Terminal; pick which in Settings › General. With the herdr runtime, `attach` focuses the agent and opens herdr.

## What works where

| | macOS | Linux | Windows |
|---|---|---|---|
| Agents, chat, terminal, files, changes, chief of staff | ✓ | ✓ | ✓ |
| herdr runtime and the live Herdr view | ✓ | ✓ | (herdr isn't on Windows) |
| Desktop app | ✓ | ✓ | ✓ |
| Inbox (Apple Mail) and Calendar (macOS Calendar) | ✓ | not yet | not yet |
| Meeting notes from your mic | ✓ | ✓ | ✓ |
| Meeting notes with the call's sound (who said what) | ✓ (macOS 14.2 or later) | not yet | not yet |
| Calls noticed (Take notes, stop when it ends) | ✓ | not yet | not yet |
| Whiteboards and diagrams drawn by a model | ✓ | ✓ | ✓ |

Day-to-day use so far has been on macOS. Linux and Windows use the same code paths (node-pty and Electron both support them) but have had little testing, so please open an issue if something breaks. On Linux the server has been tested mostly in the [Docker image](#run-it-on-an-always-on-machine) (Debian, amd64 and arm64): agents, terminals, git, sign-in and pairing a phone. On a Linux machine with no desktop, **Sign in** for Codex uses its device code login, since there's no browser to come back to.

## Agents

Bridge AI finds the agent CLIs on your PATH. Each one is described in [`server/agents.js`](server/agents.js): how to start it, how to resume a session, and what its screen looks like while it works.

| Agent | Command | Chat view | Sign in from Bridge AI | Extras |
|---|---|---|---|---|
| Claude Code | `claude` | ✓ | ✓, several accounts | subagents and background shells, slash commands, question cards, safe sending |
| Codex | `codex` | ✓ | ✓, several accounts | slash commands, question cards, safe sending |
| Gemini CLI | `gemini` | ✓ | ✓ (Google account) | |
| GitHub Copilot CLI | `copilot` | ✓ | ✓ | |
| Cursor Agent | `cursor-agent` | ✓ | ✓ | |
| Qwen Code | `qwen` | ✓ | in its own screen | |
| OpenCode | `opencode` | terminal | ✓ | |
| Amp | `amp` | terminal | ✓ | |
| Goose | `goose` | terminal | ✓ (`goose configure`) | |
| Crush | `crush` | terminal | ✓ | |
| Grok | `grok` | terminal | in its own screen | |
| Aider | `aider` | terminal | API keys | |
| Muse Code (Meta) | `muse` | terminal | in its own screen | |

**More models** (Qwen Code, DeepSeek, Kimi, Z.ai's GLM, and their models on OpenRouter, Together, Hugging Face or Ollama) can be turned on in Settings › Model Providers › **Show more models**.

Gemini CLI, Qwen Code, Copilot and Cursor get their Chat view from the logs they write themselves (`server/otherlogs.js`), so it shows what they said and the files they changed, and Bridge AI finds each one's conversation after it starts. Agents without a chat view work fully in the Terminal tab, and their status (working, waiting on you, finished) still shows in the sidebar. OpenCode, Crush and Goose keep their conversations in a database and Amp on its servers, which is why they're terminal only for now. Adding an agent, or a chat view for one, is a small change; see [CONTRIBUTING.md](CONTRIBUTING.md).

**No agent at all?** Bridge AI has its own chat with any model, with nothing to install: New chat, then **Any model**. It talks to whatever you can reach: a plan you're signed in to through one of the agents above (Claude, ChatGPT, Gemini, Copilot, Cursor and others, through their one-shot mode), an API key from Settings › Model Providers (OpenAI, Anthropic, Google, OpenRouter, xAI, Mistral, DeepSeek, Groq, Perplexity, Meta, Moonshot, Together, Fireworks, Cerebras, Cohere, Z.ai, Hugging Face), your cloud (Azure OpenAI with the deployments you name, AWS Bedrock with a Bedrock API key or your AWS profile's access keys, Google Vertex AI with a service account or your gcloud login), or a model on your computer (Ollama, LM Studio). Switch models mid-chat from the model button in the message box, or type `/model`. It has a Chat view and works from your phone like any agent, in the built-in runtime and in herdr.

**Any model on your files:** New agent, pick a folder, then **Any model**. It gets tools to read, search and change the files in that folder and to run commands there, and asks before each change or command with a card in Chat: **Yes**, **Yes, and don't ask again** for the rest of that chat, or **No**, after which you tell it what to do instead. Its edits show in Chat and in Changes. It works with models through an API key, a cloud or your computer; one that turns tools down carries on as a chat. A plan you're signed in to (Claude, ChatGPT) works on files through its own agent instead.

## Cloud Agents

Some providers run coding agents on their own computers, on a repo they host, and keep going while your computer sleeps. Add your key in Settings › Model Providers › Cloud Agents, then start one from New agent › In the cloud: pick the provider, the repo and a branch, and say what to do. They show up in a Cloud space in the sidebar with the same dots (working, waiting on you, done) and the same notifications, here and on your phone. Chat shows what the agent said and did, the message box sends follow-ups, and the header has Stop and the pull request. The chief of staff sees them too.

| Provider | How it works | Key | Cost |
|---|---|---|---|
| Cursor | Cursor Cloud Agents API. It pushes a branch and opens a pull request | API key from [cursor.com/dashboard/api](https://cursor.com/dashboard/api) | Your Cursor plan |
| GitHub Copilot | Bridge AI opens an issue with your task and assigns it to Copilot, which works in a draft pull request. Follow-ups are `@copilot` comments there | A fine-grained token (Metadata: read; Actions, Contents, Issues and Pull requests: read and write), or your GitHub CLI sign-in | Your Copilot plan |
| Jules | Jules API, on a repo you've connected to Jules. You can ask to see its plan first | API key from [jules.google.com/settings](https://jules.google.com/settings#api) | Your Jules plan |
| Claude | Claude Managed Agents, with your repo mounted. It pushes a branch | API key from the [Claude Console](https://platform.claude.com/settings/keys), plus an optional GitHub token for private repos and pushing | Pay per use on your Claude Console account, not your Pro or Max plan |

Bridge AI checks on running agents every 10 to 20 seconds, less often when several run at once or once they wait or finish, and backs off when a provider asks it to slow down or has trouble. Copilot and Jules have no stop in their APIs, so Stop for those is on their own pages. The provider code is in [`shared/cloud/`](shared/cloud/) and uses only `fetch`, so the phone apps run it too.

**With no computer**: the iPhone and Android apps have Cloud Agents on their start screen. Add your key on the phone and start and follow agents from there. Keys stay on the phone (iPhone's Keychain, Android's Keystore) and go only to their own provider; the phone keeps its own keys and agents, apart from your computer's. Android checks on them in the background and notifies you; iPhone checks while the app is open. More in [mobile/README.md](mobile/README.md#cloud-agents).

## Meeting notes

**Meetings** in the sidebar (on a phone, on the Agents tab), then **Start recording**. The first time, Meetings walks you through what it needs, each step a tick or one button: speech to text (the speech model's one-time download, Parakeet, or a speech service; on macOS 26 or later, the Mac's own speech meanwhile), the mic, a model to write the notes, and your calendar if you want notes named after your meetings. Until speech to text is set up, Meetings says so, and a meeting recorded meanwhile keeps its audio for **Transcribe again**. Bridge AI records your mic and, in the desktop app on macOS 14.2 or later, the call's sound, whatever app it's in (Zoom, Meet, Teams), so the transcript says who spoke: You or Them. The transcript comes in as people talk, a few seconds behind, with your own notes beside it if you want to jot any. The recording keeps going while you use the rest of the app; point at its bar in the top bar for Pause, New section, Stop, a quick note and the way back to the meeting. **New section** splits a recording into parts as it goes, like laps or the sections of a long presentation: the transcript, your notes and the summary get a heading for each, and you can rename one by clicking it in the transcript. The record button beside Meetings in the sidebar starts a meeting straight away (named after the calendar event on now, if there is one), or, while one records, stops it and starts the next. A meeting's tab has the same header as an agent's: its name, when it was, who was in it and where its notes are saved, each changed in place, and Summary, My notes, Transcript and Files as tabs, with the transcript beside the one you're on if you like.

**What was on the screen:** while it records, **Watch a screen** and pick the window where someone shares their slides (macOS's own picker in the desktop app on macOS 15 or later; on macOS 14 it watches the main screen, after macOS asks to allow Screen Recording; in a browser, the browser's picker). A picture is kept each time what's shown changes, a new slide or another page, but not for a speaker's video or a cursor moving, and **Capture** keeps one now. The pictures sit in the transcript at their time, and the words on them are read on your Mac (`native/bridgeocr.swift`, with Vision), so the summary and answers know what was shown. Paste or drop a picture into your notes and it stays where you put it. Add a note at any line of the transcript with **+**, and it shows there too. Fold the transcript away to give your notes the room, or drag the line between them.

**Files, links and emails** go with a meeting, on its Files tab: the document links in the calendar invite come by themselves, **Attach** takes a link or a file's path, files picked in Finder or dropped on the meeting, and on a Mac, the emails about the meeting in Mail with the files that came with them (Mail needs Full Disk Access). Each is linked where it is, not copied, and read when the notes are written or a question is asked: Word, PowerPoint, Excel, CSV, PDF, Markdown and text. A file that moved says so. A file dropped in a browser, which can't say where it is, is kept as a copy.

**Who said it:** the call is one sound for everyone on it, so its lines say Them. **Who spoke**, on the transcript, has your notes model name who said each line, from the names used, the words on the shared screen and who was invited; a line it can't place stays Them, and its guesses are in italics. Click a name, or Them, to set it yourself. Every meeting where the call was heard gets this before its first summary (Settings › Meetings › Name who spoke on the call), from the invite, names said ("Hi, Priya") and the meeting's name; with one other person invited, the call is them. A meeting recorded without its calendar event offers the event from around then, for its people, and says so when Bridge AI isn't allowed to see your calendar yet. A meeting called "Interview - ...", "... standup" or "... 1:1" gets that kind of notes.

Misheard a name? Edit the line, or select the word and **Fix a word**: it's fixed everywhere in that meeting, and with **Remember it**, in every meeting. **Meeting memory** (Memory, on Meetings) keeps the names and terms in your meetings, how each gets misheard and a note on each; the speech engine listens for them and the notes and answers know them. Summaries add the names they find, and a few words on who or what each is when the meeting makes it clear (never over a note of yours), and you can change or remove any. **Transcribe again** runs a meeting's audio through another speech model or service, or another language, and keeps the old transcript; a meeting heard by a light model (Small or Base) suggests Large turbo, which hears names and jargon better.

**Who said what in a room:** with your mic only (no call's sound), **Who spoke** tells the voices around the table apart, on your computer, with a small voice model (3D-Speaker's ERes2Net, 26 MB, Apache-2.0) downloaded the first time you ask, then the notes model works out who each is from names said and who was invited. Each line says Speaker 1, Speaker 2 or a name; click one to name that voice from the invite, yourself or someone else, once for all their lines. After the first time, room meetings get their speakers by themselves: as they record on a computer with four cores or more, else once they end. **Remember voices you name** (Settings › Meetings, off to start with) keeps a few hundred numbers for how each named voice sounds, on this computer only, so they're named by voice next time; Forget voices removes them. It's offered wherever Parakeet runs, with 2 GB of memory or more.

**Cleaning up the transcript:** when you're not on headphones, your mic hears the call too, so a line of yours keeps only your words and says what was heard. When a meeting ends, the notes model reads the transcript with its invite, its files and meeting memory, fixes what speech to text misheard (names, jargon, a word cut in two) and leaves out words nobody said ("Thanks for watching"). Each fixed line says what was heard, **Undo** puts one back, and a line left out can be shown and put back. Your own edits always win. Turn it off in Settings › Meetings, or run it from a meeting's ⋯ menu.

**AI Assist** (Assist, while a meeting records, on the meeting or the floating card): the notes model reads along and, about once a minute, suggests what to ask, raise or check next, from what's been said, the invite, the files that go with the meeting and your notes. In an interview it compares what the candidate says with their resume and suggests follow-ups; on a customer call, discovery questions and next steps. Each suggestion says what it's based on, the newest shows on the floating card, ✓ puts one in your notes and ✕ dismisses it. **Suggest now** asks straight away, even before anyone talks. Meeting memory is only background for it, used when today's meeting touches it. Settings › Meetings turns it on for every meeting.

**Files you got for a meeting:** a file in Downloads or on the Desktop from around the meeting, named after someone in it or its name, a resume before an interview, or one that came in while it recorded, is offered on the Files tab (and on Assist while it records) to add with a click. Its names and terms help the speech engine spell them too.

When it ends, the model you pick (Settings › Meetings › Notes are written by) writes a summary with decisions and action items, shaped by your notes. If it can't be reached, the other models you have are tried, and if none answer, the summary is written later by itself; your notes and the transcript are kept either way. Then:

- **Regenerate**, with the language to write the notes in, the model, and a template: 1:1, standup, customer call, interview or brainstorm, each with its own summary.
- **Ask about this meeting**, answered from the transcript, or tap Draft a follow-up email, What did I agree to do? or What's still open?
- **Start an agent** on an action item: it picks the project the item is about (named in it, said in the meeting, or used for this meeting before) and says why, for you to change; the agent starts there on its own branch, in a space named after the meeting, told the item, what was said about it and what was decided. You can read and change what it's told first.
- **To Chief of Staff**, one item or all of them: they go on the chief of staff's task list. It takes the ones that are yours and drafts follow-ups for the rest, without sending anything. Send action items to Chief of Staff leaves out the ones already handed on.
- Under each item, **what became of it**: its agent working, waiting on you or finished, its pull request and checks; Chief of Staff's task, what it's waiting on you for and what it did. Tick one done yourself.
- **Since last time**: the next meeting in a series (the same name, without the date), with the same people or with the same customer (an email domain they share, or a customer in meeting memory) shows in a line what became of the last one's action items, and on Meetings under Take notes before it starts.
- **Save**: Markdown in a folder you pick (pictures go in an attachments folder beside the note, and the files, links and emails are listed as links) (~/Documents/Meeting notes to start with), for Obsidian or any notes app, laid out the way Granola's sync does it: year, month and day folders, and a summary note (with your notes) and a transcript note that link to each other. Settings › Meetings › Save sets what's saved (two notes, one, or just the summary or the transcript), and each one's folder, subfolders and file name as patterns ({year}/{month}/{day}, {quarter}, {date}, {time}, {title}, {kind}), front matter, the speakers' names, and saving every meeting by itself. A saved meeting stays up to date when its summary, title or notes change, except a note you've changed in your notes app, and notes already saved can move when you change where they go.

**Ask about your meetings**, at the top of Meetings, answers from all of them ("What did I agree to do this week?", "Write my weekly update") or from the ones you've ticked, and cites the meetings it used; click one to open it. Search looks through what was said, the summaries, your notes, the words on the screen's pictures and the names of the files. Meetings in the sidebar opens their list under it, like a space; ⌘-click or Shift-click picks several to save, send to the chief, summarize again, put in a folder, archive or delete together, and right-click one for the rest of its menu. Folders sit under the days in the sidebar and are filters on Meetings. **Archive** puts a meeting away under Archived, left out of search and of questions about your meetings until you take it out. Deleting asks first, and offers the archive instead.

**Calls** (desktop app): when Zoom, Teams, FaceTime, Slack, Webex, Discord or a call in your browser starts using your mic, Bridge AI offers to take notes, named after the calendar event on now. When the call ends it offers to stop, and stops by itself two minutes later unless you keep it going. It only looks at which apps have the mic (`native/callwatch.swift`), so there's nothing to allow. A **floating card** over your other apps is a slim bar while it records, with Pause and Resume on it, and opens when you point at it: how loud you and the call are, who's talked how much, the last twelve minutes as bars, the last things said, when the meeting ends, Pause, New section, Stop, Watch a screen and Capture, a quick note and Open the meeting. Pin it open, and drag it from anywhere on it. It offers Take notes when a call starts; Settings › Meetings shows it during calls and meetings, always, in the menu bar instead (the time, with Pause, Stop and the meeting in its menu), or never, and can open it on a click instead of when you point at it. About to share your screen? Most sharing apps show windows like the card, so its **Move to the menu bar** button puts it up there for that meeting, out of the way, with **Show the card** to bring it back.

A calendar event starting in the next ten minutes shows **Take notes** on Meetings, which names the meeting after it and helps spell its people's names. Long meetings are fine: audio is transcribed in short pieces as you go and silence is skipped, so the transcript is ready a few seconds after you stop, and a long one is summarized in parts. Each meeting keeps its audio (Opus, about 11 MB an hour for each side) in `~/.bridge-ai/meetings`.

Speech to text, in Settings › Meetings (the speech model itself is picked in Settings › Voice, and voice notes use it too):

| Engine | What it needs | Price per hour of audio |
|---|---|---|
| On this computer: Parakeet (the default) | One download from Hugging Face, nothing to install: Parakeet (670 MB; English and 24 more European languages, which it tells apart itself; NVIDIA, CC-BY-4.0) or Parakeet English (663 MB; the best at tool names and jargon; NVIDIA Open Model License). Runs on the processor through sherpa-onnx, on macOS (both chips), Windows, Linux (x64 with glibc 2.32 or later, Arm) and in the Docker image | free, and the audio never leaves your computer |
| On this computer: Whisper | whisper.cpp (**Install whisper.cpp** in Settings › Voice uses Homebrew) and a model from Hugging Face: Large turbo (574 MB), Small or Small English (190 MB), Base English (60 MB) or Large (1.1 GB). For the languages Parakeet doesn't hear; not offered in the Docker image | free, and the audio never leaves your computer |
| The Mac's own speech | macOS 26 or later; nothing to install (Apple's transcriber, `native/bridgespeech.swift`). Answers by itself while the speech model downloads | free, and the audio never leaves your Mac |
| OpenAI | an OpenAI key | $0.27 (gpt-transcribe) |
| Groq | a Groq key | $0.04 (whisper-large-v3-turbo) |
| Mistral Voxtral | a Mistral key | $0.18 |
| Together AI | a Together key | $0.09 |
| Deepgram | a Deepgram key | $0.26 (nova-3) |
| ElevenLabs Scribe | an ElevenLabs key | $0.22 |
| AssemblyAI | an AssemblyAI key | $0.21 |
| Google Gemini | a Gemini key | about $0.12 |
| Another speech service | its address (and key, if it has one): any service with OpenAI-style `/audio/transcriptions`, online or on your computer (Speaches, LocalAI) | theirs |

Prices are list prices from October 2026; the service's own page is what counts. Keys go in Settings › Model Providers. Ollama and LM Studio don't do speech to text, so they write notes but can't transcribe. On this computer, the speech engine starts with your first meeting or voice note, uses two to four cores, and lets go of the model after a few idle minutes (Parakeet, about 2 GB of memory while it's loaded, runs in a process of its own). Settings › Voice lists only the models this computer can run; one that can't run here (a setting copied from another computer) is replaced by Parakeet, or Whisper where Parakeet can't run, and Settings says so.

The call's sound comes from a small helper (`native/calltap.swift`) that uses macOS's own audio tap, so it hears the call whether it plays on speakers or headphones. macOS asks once to allow **System Audio Recording**, and remembers it across updates (the app is signed with the same certificate each time). Without it, your mic still records the meeting, and hears a call on speakers.

## Your other devices

Link your other computers running Bridge AI (Mac, Windows or Linux) and switch between them from the top left: each one's Bridge AI opens in the same window, its agents, chats, terminals and files, as if you were sitting at it. The sidebar's **Devices** lists them with their agents and what needs you, and the desktop app can open one in a window of its own. A phone paired with any of them reaches them all.

1. Each device needs its relay (Settings › Devices, below).
2. On one, Settings › Devices › **Pair a device**. It shows a QR code, a link and a code, the same for a phone or a computer, for 15 minutes and up to 3 devices.
3. On the other computer, Settings › Devices › **Link a device**: paste the link, or type the address and code. They link both ways, and a third device you link is introduced to the others.

Or let your phone do it: scan the new computer's code with the Bridge AI app on a phone that's paired with another of your computers. The phone offers to link the two, asks, and takes you to the other one to allow it after checking both show the same six digits. A device's relay address alone asks the same way.

Devices talk end-to-end encrypted through each other's relay, the same way a phone does ([server/machines.js](server/machines.js)). A link looks after itself: one that goes quiet (a Mac that slept, a network that changed) starts over, a device that moves to a new relay is followed there, and one that was set up again says so and links again with a new code. When one is offline, **Fix** checks each step between the two, says plainly where it stops, and connects again. Unlink in Settings › Devices, on either one.

## Runtimes: where agents run

| Runtime | What it is | When it's used |
|---|---|---|
| **Built in** | Bridge AI runs each agent in its own terminal (node-pty, with a headless xterm keeping the screen). Nothing else to install. The terminals live in a small terminal host process, so agents keep running when Bridge AI quits, restarts or updates, and it picks them up as they are, screen and scrollback included. After a reboot, Claude Code and Codex sessions resume where they were. | Default |
| **herdr** | [herdr](https://herdr.dev) is a terminal multiplexer for agents. Bridge AI drives it, and you get herdr's own terminal UI, split panes and the live Herdr view (`Alt+2`) in the browser. | Optional. Only when you choose it; install herdr separately |

Choose in Settings › General › Where agents run, or set `"runtime": "builtin"` or `"herdr"` in your config. herdr is never required, and Bridge AI won't switch to it just because it's installed.

To have built-in agents stop with Bridge AI instead, turn off **Keep agents running when Bridge AI quits** there (`"keepAgents": false`); they resume next time, as after a reboot. **Quit and Stop Agents** in the app's menu, or `npm run stop -- agents`, stops them either way. On Windows an app update still stops them (Windows can't replace a running program) and they resume after it; in the Docker image they stop and resume with the container.

The terminal host listens on no network. Bridge AI reaches it over a socket in a folder only you can open (a named pipe on Windows) and must give it a random token first. It exits by itself once it has no agents and no Bridge AI to keep them for.

Bridge AI joins the herdr session you already have running. It shows the agents and panes in it, and anything you start from Bridge AI opens there too, so you see it in herdr as well.

**Several sessions** (`herdr --session work`): the session menu at the top of the sidebar (on the phone, at the top of Agents) lists every session herdr knows, running or not, with how many agents wait on you in each. Pick one and the agent list, the board and the Herdr view switch to it at once. The pick is saved as `herdr.session`, the same setting as Settings › General › Where agents run, so the two stay in step. From the menu you can also:

- start a new session in the background (herdr's headless server, `herdr --session <name> server`), or start a stopped one again with its saved layout;
- stop one (`herdr session stop`), after you confirm. Bridge AI refuses while any agent in it is working or waiting on you;
- open one in your terminal app (`herdr session attach`). If a new session can't start in the background, the menu offers this instead.

Each session keeps its own open tabs, queued messages and muted agents. Notifications cover the session you're looking at, and switching never announces anything: agents in the other sessions are out of view, not finished. herdr notes that a server started from a background job may not reach the macOS Keychain; if a tool in a session started here can't, stop it and start it from your terminal. To watch two sessions side by side, run a second copy of Bridge AI with its own data folder and port (`BRIDGE_HOME=~/.bridge-ai-work BRIDGE_PORT=7430 npm start`).

## Your data and settings

Everything personal lives in `~/.bridge-ai` (set `BRIDGE_HOME` to move it), never in the repo:

| File | What it holds |
|---|---|
| `config.json` | Your settings (see below) |
| `chief/` | The chief of staff's folder: its instructions, `state/playbook.md` (what it has learned about how you work), `state/ledger.md` (its hand-offs), `state/tasks.md` (tasks it does itself) and `work/` (what it makes for them) |
| `routines.json`, `ideas.md` | Recurring jobs and your ideas backlog ([`routines.example.json`](routines.example.json) shows the shape) |
| `runtime.json` | Spaces and tabs for the built-in runtime |
| `host/` | The terminal host's token, socket and log (built-in runtime), readable only by you |
| `cloud-keys.json`, `cloud-agents.json` | Your cloud agent keys (readable only by you, never given to the agents on your computer) and the cloud agents you started |
| `chat-logs/` | Your chats with any model, one file each, and whether each is working (`.state`) |
| `meetings/` | One folder per meeting: its transcript, your notes, the summary, who said what (`speakers.json`), the cleanup's fixes (`cleaned.json`), AI Assist's suggestions (`assist.json`), the audio, `captures/` (pictures of the screen and in your notes) and `files/` (copies of files sent from a browser). Sections, the folder and the archive are in its `meeting.json`. `memory.json`: meeting memory |
| `projects.json` | The projects Home offers, from setup or from where you've started agents |
| `models/` | Speech models for voice notes and meetings (Parakeet's in a folder of its own) |
| `tools/node/` | Node.js, when Bridge AI installed it for you (**Install Node.js**, on a computer without one): the official build from nodejs.org, used after any Node.js of your own |
| `herdr-own.json` | With the herdr runtime: which herdr panes hold Bridge AI's own chats |
| `activity.json`, `insights/` | Insights: Bridge AI's record of the agents it ran (when, where, how long they worked and waited on you, what you sent them; 45 days), the numbers read from your agents' logs, and the last write-up |
| `cache/` | Queued messages, watchlist, uploads, mail rules |

Settings start from [`config.example.json`](config.example.json). Put yours in `~/.bridge-ai/config.json`; [`config.local.example.json`](config.local.example.json) shows the shape.

| Key | What it does |
|---|---|
| `name` | What the chief of staff and the morning brief call you |
| `defaultAgent` | Agent used when none is picked (`claude`, `codex`, `gemini`, ...) |
| `chief.kind` | Agent the chief of staff runs on |
| `runtime` | `builtin` (default) or `herdr` |
| `keepAgents` | Built-in agents keep running when Bridge AI quits, restarts or updates (default `true`). Also in Settings › General |
| `simple` | The simple layout: the Today panel behind one button, the Agents board only once you have agents, and fewer tabs on the chief of staff. On for new installs; Settings › General › Layout |
| `meetings` | Meeting notes: `engine` (`local` or a service), `localModel`, `model` (writes the notes), `language`, `vocabulary`, `instructions`, `callAudio`, `autoSummary`, `cleanup` (clean up the transcript when a meeting ends), `assist` (AI Assist in every meeting), `assistModel`, `nameSpeakers` (name who spoke on the call before the first summary), `autoSave`, `folder`, `saveWhat` (`both`, `one`, `summary` or `transcript`), `noteSub`, `noteName`, `transcriptFolder`, `transcriptSub`, `transcriptName`, `frontmatter`, `youLabel`, `themLabel`, `keepSaved`, `detect` (notice calls), `autoStop`, `floatCard` (`meetings`, `always` or `off`). All in Settings › Meetings |
| `herdr.session` | Which herdr session Bridge AI shows when you run more than one (`herdr --session work`). Unset: `main`, else the latest one running. Switch from the sidebar's session menu or Settings › General; applies at once |
| `port` | Default 7420 |
| `location` | `{ label, lat, lon, timezone }` for weather and the brief |
| `mail.myDomains` | Your organisation's email domains, so colleagues aren't marked External |
| `assistant.cwd` | Folder that mail and meeting agents start in (point it at notes that describe you) |
| `market`, `mortgage` | Watchlist and an optional mortgage card |
| `allowedHosts` | Extra host names allowed to reach the server (Tailscale `*.ts.net` names are allowed already) |

You rarely need to edit the file by hand. **Settings** (the gear in the top bar, or `⌘,` / `Ctrl+,`) has:

| Section | What's there |
|---|---|
| General | Your name, default agent and default model, which agent runs the chief of staff, your location (from your device or a city search), where agents run |
| Agents | Every supported agent: installed or not, signed in or not, one-click install, start a chat |
| Model Providers | API keys, cloud accounts and local model servers (Ollama, LM Studio) your agents can use, and your keys for cloud agents |
| Voice | The speech models this computer can run (Parakeet, Parakeet English, Whisper), which one voice notes and meetings use, and their downloads |
| Meetings | Speech to text (this computer or a service), the language, names and terms, recording the call's sound, noticing calls and stopping when they end, the floating card, the model that writes notes, and where and how they're saved |
| MCP Servers | The tools your agents can call, across all of them, with a catalog of 35 popular servers by category (web search, docs and notes, planning, Microsoft 365, deploy and monitoring, data, design) |
| Devices | Your relay (sign in to Cloudflare, an API token, or Bridge AI's relay) or Tailscale, pairing a phone, linking your other computers, and what you're notified about on which devices |
| Appearance | Theme, color mode, text size, density, font, language |
| Config File | Your `config.json`, editable, checked before it's saved, with the effective settings and defaults beside it |

## What's in the app

- **Home**: **New** in the sidebar, or the phone's Agents tab. One message box, "What should we build in shop?", where the project's name is the picker. Chips on the box pick the agent or any model, how much it may do without asking (**Ask first**, **Edit freely**, **Full access**) and, in a git project, this folder or its own branch. Enter starts it. **or start without a project** makes it a chat, and **More options** is the full New agent dialog (cloud agents, two agents side by side, an account, the space).
- **Sidebar**: **New**, **Chief of Staff**, **Meetings** and **Whiteboards** at the top, then spaces and tabs with each agent's status, folder and git branch. Drag to reorder, double-click to rename.
- **Tabs**: open any agent as a tab, drag tabs to reorder, put two side by side.
- **Own branch** (optional, per repo): start an agent on a new branch in its own git worktree, kept in `~/.bridge-ai/worktrees`, with the ignored files listed in `.worktreeinclude` (like `.env`) copied in and your setup command (like `npm install`) run first. Closing it removes the folder only if nothing would be lost; the branch stays.
- **Each agent** has Chat (its transcript), Terminal (a live mirror you can type in; scroll to the top to read further back, up to 20,000 lines), Files (a browser with syntax highlighting and markdown, where videos and sounds play in place, PDFs and pictures show, and anything else downloads, with its progress) and Changes (git status and diffs). A video on another of your computers, or watched from your phone, plays as it comes, a part at a time over the same encrypted link, so a long one starts in a few seconds and seeks anywhere without being downloaded first. **Copy to this computer** and **Send to…** (or a file dragged from one device's Files into another's) copy a file or a folder between your computers over that link, into the folder you pick there (its Downloads, an agent's folder, or a place): with its progress, carrying on where it stopped if the connection drops, and checked (size and SHA-256) before it takes its name, which gets a number if it's taken. From a phone, **Send files from this device** puts photos and videos into the project you're looking at. **Places** are other folders you add to Files with the folder picker; nothing outside them and your agents' folders is looked at.
- **New terminal**: the terminal button at the top of the spaces, ⌘K › New terminal, or a space's menu › **New terminal here** opens a plain terminal you type straight into (`brew upgrade`, a dev server, anything you'd run yourself), on whichever machine the window is showing.
- **Review and ship**: in Changes, click lines of a diff to comment and send all your comments to the agent as one message; commit and push, and open a GitHub pull request (with `gh`) drafted from your commits, then watch its checks there.
- **Message box**: `@` to reference files and folders, `/` for slash commands, ↑ for earlier messages, voice notes (Parakeet, on your computer) and attachments. Messages to a busy agent are queued and sent when it's free.
- **Questions and approvals** from an agent show as cards you can click. That includes the questions Codex asks while it keeps working: the agent shows as needing you, and the card stays until you answer, even after Codex's own screen has dropped the question at the end of its turn.
- **What each reply changed**: "Changed 3 files" under a reply opens its own diff per file. With Claude Code, **Undo this reply** puts the files and the chat back to just before your message, without sending anything.
- **What runs in the background** shows live above the message box: the subagents Claude Code starts, the shells it and they leave running (open one for its latest output) and its monitors' news.
- **Consult other models**: the chief of staff (or you, with `node ~/.bridge-ai/chief/bin/bridge ask`) can put a one-off question to Grok, GPT, Claude, Gemini, Muse Spark, Perplexity, DeepSeek, a local Ollama model and others, for a second opinion, live news, or a very long document. It uses each agent's CLI and your existing subscription where it can, and an API key from Model Providers otherwise. Settings › Agents shows who is reachable and how.
- **Plain chats**: talk to Claude, Codex or any agent directly, like its own app, with no project folder, or to any model you have with **Any model** (see [Agents](#agents)). Home › or start without a project, New chat in `⌘K`, or New agent › Plain chat.
- **Several accounts**: as many Claude (or Codex) accounts as you like, running side by side, in one plain list. Your usual login is one of them ("Your usual login" until you rename it), and every other one has the name you give it (Work, Personal). **Add another account** is in the usage chip's menu in the top bar, in Usage, in New agent's Account row and in `⌘K`: name it, sign in right there (the agent's own login, for that account only), then start an agent on it. Each account has **Make default**, **Sign in** (again), **Sign out** and **Remove**, in Usage and in Settings › Model Providers › Accounts. New agents start on your default, which has a star, or with **Auto** on, on the one with the most left. Removing your usual login only takes it off Bridge AI's list (the agent keeps it for the terminal, and Settings can show it again); the last account always stays. When two rows turn out to be the same account, Usage offers to remove the extra one. Each agent shows the account it's on and keeps it when you fork or reopen it. The model button in the message box shows the account beside the model, and its menu continues the conversation on another account the way it switches models. An account keeps only its own login; settings, skills and history stay shared.
- **Hand off to another agent**: the model chip in the message box also lists your other installed agents and whether each is signed in. Pick one (Claude Code to Codex, say) and it starts in the same folder, on the same branch or worktree, on the account and model you choose. Agents can't open each other's conversations, so it starts with a handover Bridge AI builds from the transcript and git: your goal, the recent messages, changed files, where it stopped and what's still open (or, if you ask, the old agent's own summary). You can read it before it goes. The old agent goes to Closed agents unless you keep it open too. In the chief of staff's chat, the same menu switches the agent the chief runs on.
- **Chief of Staff**: tell it what you need. Project work goes to the agent already on that topic, or a new one, and it tells you when that's done. Standalone tasks it does itself: questions and research, drafts (emails, docs, plans, summaries), checklists and planning. It writes only in its own `work/` folder and never edits your projects. Its own tasks are in a Tasks panel above its message box: add one there to send it to the chief, mark one done or reopen it, and open what a finished task produced. The morning brief mentions its open tasks. It learns where work lives and how you like things done, in a playbook you can read and edit.
- **Threads with the chief of staff**: keep separate topics apart. **New thread** in the bar at the top of its chat starts another conversation with it, named for its topic (Q4 launch, hiring), with Main as the first. Threads run at the same time and share the chief's playbook, ledger and task list. Each thread lists the agents it handed work to, with their status, so you can see which work came from which conversation; tap one to open it. Close a thread there too (its conversation goes to Closed agents).
- **Whiteboards** (sidebar or `⌘K`; on a phone, `⌘K` or search): an Excalidraw whiteboard for shapes, arrows, text, pictures pasted in and drawing by hand, saved as a `.excalidraw` file in `~/.bridge-ai/boards` a moment after each change, with Export as PNG or SVG. **Draw this** turns a description (typed, or said with the dictation key), a meeting, a project or an agent's work into a flowchart, an architecture, a sequence or an org chart made of shapes you can move and edit, not a picture; **Change it** changes the board, or what's selected, in place, and undo takes it back. It uses the model meeting notes use (your sign-in to an agent, a key, or a model on your computer) or the one you pick, and says before you draw what goes to it; nothing else leaves the computer, and the whiteboard itself loads nothing from the internet. Diagram files agents write (`.excalidraw`, Mermaid `.mmd`, draw.io `.drawio`) open as boards in Files and from the chat, and Mermaid in Markdown or a reply has **Open as a whiteboard**. The chief of staff makes and updates boards with `bridge board`.
- **Today**: schedule, inbox ranking, morning brief, routines, ideas, usage and quota, insights, weather, markets and news.
- **Insights**: the last 30 days across every agent and every account: sessions, hours, the time agents waited on you, and the split by agent, by account and by project. The numbers come from Claude Code's and Codex's own logs (every account of each shares them) and from Bridge AI's record of the other agents it ran, so they cost nothing. **Write insights** has one of your agents, or an API key, read a summary of those sessions and write up what's working, what's in your way and what to try next; pick which one writes it. If you've run Claude Code's own /insights, its report is linked too.
- **Usage**: tokens and cost per day, model and project, with a year heatmap (from your agents' local logs via ccusage), for Claude Code and Codex together (**All**) or one at a time. Every account is counted, and **By account** shows each one's share of the last 30 days, unused ones too.
- **Phone**: the same app on your phone, as a Home Screen app with notifications. See [On your phone](#on-your-phone).
- **Appearance**: Slack-style themes that color the window frame, light and dark modes, and custom colors you can share as a string.
- **Your language**: Bridge AI in English, Español, Français, Deutsch, Português (Brasil), 日本語, 简体中文 or हिन्दी, or whatever your computer is set to (Settings › Appearance › Language). The main screens are translated: the sidebar, top bar, the Agents panel, Settings' sections, New agent, the message box, Chat, Meetings, Today, setup and the error screen, and dates follow the language. The rest is in English for now. Agents and their answers aren't affected.

## The demo

Bridge AI's own UI on made-up agents, spaces and data, with no computer or install behind it. It's what **Try the demo** opens in the phone apps. It starts as a new install (the chief of staff and one agent, in the simple layout); **See everything**, or the Studio Mac in the device switcher, opens a second made-up machine with every agent, meeting and cloud agent going (`?m=studio`).

```bash
npm run demo:build   # a static site in dist-demo/
```

`dist-demo/` is plain files with relative paths, and nothing in it loads from the network, so any static host can serve it, from any folder. The agents work, ask and reply on a script ([src/demo/](src/demo)); what needs a real computer (voice notes, your terminal app, pairing a phone, updates, adding accounts) says so in one line.

## Desktop app

`desktop/` wraps Bridge AI in an app window with a badge for agents that need you, notifications, and a global shortcut (`Alt+Cmd+A` on macOS, `Alt+Ctrl+A` elsewhere; change it with `desktop.shortcut` in config).

```bash
npm run desktop          # run it from your clone
npm run desktop:dev      # same, with hot reload
npm run desktop:dist     # build an installer to share
```

### Build it to share

`npm run desktop:dist` builds a self-contained app: Bridge AI's server, the UI and their dependencies go inside it, and it runs on the app's own Node. The people you give it to don't need Node, npm or a clone. They only need the agent CLIs they want to use (Claude Code, Codex, ...), and onboarding offers to install those. Nothing of yours goes in: settings, history and the chief of staff's memory live in each person's own `~/.bridge-ai`.

| Build on | You get (in `desktop/dist/`) |
|---|---|
| macOS | `Bridge-AI-mac-arm64` (Apple Silicon) and `Bridge-AI-mac-x64` (Intel), each as `.dmg` and `.zip`. The `.zip` files are what `install.sh` downloads. |
| Windows | `Bridge-AI-win-x64.exe` |
| Linux | `Bridge-AI-linux-x86_64.AppImage` and `Bridge-AI-linux-amd64.deb` |

**Signing the Mac app.** macOS remembers what you allowed (the mic, Calendar, your folders, the call's sound) by the app's signature. Signed ad hoc, that changes with every build, so each update asks again. `node scripts/signing.js create` makes a free self-signed certificate once (`~/.bridge-ai-signing`, its password in your login keychain), and from then on `npm run desktop:dist` signs with it ([desktop/sign.js](desktop/sign.js)), so macOS sees each build as the same app. `node scripts/signing.js github` gives it to the release builds as two repo secrets (`BRIDGE_SIGN_P12`, `BRIDGE_SIGN_PASSWORD`). Without a certificate, builds are signed ad hoc as before. It doesn't change Gatekeeper: that takes an Apple Developer ID. Keep the certificate to yourself; to macOS, anything signed with it is Bridge AI.

To publish a release:

1. Set the new version in `package.json` and `desktop/package.json`, and add a `## <version>` section to [CHANGELOG.md](CHANGELOG.md).
2. Commit, merge to `main`, and check out `main`.
3. `npm run release`.

`npm run release` checks that `main` has your code, the changelog has that version, and the tag is new, then pushes the tag `v<version>`. GitHub Actions ([release.yml](.github/workflows/release.yml)) builds the app on macOS, Windows and Linux, starts each build and checks it works (`scripts/smoke.js`), and publishes the release with every installer, checksums, and the changelog section as notes. It takes about 15 minutes; if any platform fails, nothing is published. Try `npm run release -- --dry-run` first.

You can also run the builds without releasing: Actions › Release › Run workflow. The installers are attached to the run.

## On your phone

Bridge AI works on your phone as an app on the Home Screen, with notifications when an agent needs you or finishes. It's the same app, served by your computer, so you don't need an app store; there are also iPhone and Android apps ([mobile/](mobile)) that add a lock-screen card and a demo. There are two ways to reach your computer; both are optional, and Bridge AI works the same on the computer without either.

### From anywhere, through your own relay

A small relay ([relay/](relay)) runs on your own free Cloudflare account. Bridge AI keeps one outgoing connection to it, and your phone reaches your computer through it. There's no VPN to keep connected, nothing to install on the phone, and no port opened on the computer.

1. In Bridge AI, open **Settings › Devices** and click **Sign in with Cloudflare** (or use an API token made with Cloudflare's "Edit Cloudflare Workers" template). Bridge AI deploys the relay to your account. Its sign-in is kept apart from any other Cloudflare tools you use. Signing in this way needs Node.js; on a computer without it, **Install Node.js** puts the official version from nodejs.org in Bridge AI's own folder, with no password, and signs you in right after.
2. Click **Pair a phone** and scan the QR code with the phone's camera (or open the relay's address and type the code).
3. Add it to the Home Screen: iPhone, Share › **Add to Home Screen**; Android, ⋮ › **Install app**. Open it from there, and type the code again if it asks.
4. In Bridge AI on the phone, go to **Settings › Devices** and click **Turn on notifications**.

Everything between the phone and the computer is end-to-end encrypted ([relay/web/link.js](relay/web/link.js)): each paired phone has its own key, kept on the phone, and each connection makes fresh keys. The relay, and Cloudflare, see when and how much, never what. It stores when your computer was last online, and messages waiting for your computer (below), sealed so it can't read them. Remove a phone in Settings and it's out. A phone can't pair other phones or change the relay; that's done on the computer.

Your computer has to be on and Bridge AI running. **Keep this computer awake while it's plugged in** (macOS and Linux) stops it sleeping. When it's off or asleep, the phone shows what it last sent (your agents, recent chats, usage, the brief) under a banner saying so. A message you send an agent then, or an answer to its question, waits in your relay, sealed for your computer, and goes through when the computer is back, even if you've closed the phone by then; it says "Waiting for your computer", then "Delivered". Anything else needs the computer on. Messages wait 7 days at most. The free Cloudflare plan is plenty for one person; if it's ever used up, Cloudflare stops serving until the next day rather than charging you.

### Through Tailscale

If you already use [Tailscale](https://tailscale.com), a free private network between your own devices:

1. On the computer: install Tailscale and sign in. In Bridge AI, open **Settings › Devices** and click **Turn on phone access**. It shows a QR code.
2. On the phone: install Tailscale and sign in with the same account. Scan the QR code with the camera.
3. Add it to the Home Screen and turn on notifications, as above.

Only devices signed in to your Tailscale account can reach Bridge AI; nothing is opened to the internet.

Either way, choose what you're notified about in Settings › Devices: an agent needs you, an agent finished, and usage running low (5 to 25% left). Notifications are encrypted end to end to your phone. iPhone needs iOS 16.4 or later for notifications.

- **What it's asking**: a "needs you" notification shows the agent's question or permission request, and tapping it opens that agent at its question.
- **Answer buttons**: on Android and in Chrome on a computer (not iPhone), a yes or no question, or one with two short choices, gets buttons that answer it without opening the app. Each works once, for 10 minutes, and only if the agent is still asking that same question; otherwise Bridge AI opens. Turn them off in Settings › Devices.
- **Quiet while you're at the computer**: while Bridge AI is in front on your computer, or you typed or clicked in it in the last 2 minutes, your phone isn't notified (the computer's own notifications still are). **Notify my phone even when I'm at the computer** changes that.
- **Mute an agent**: ⋯ › **Mute notifications** in its header or the sidebar, until you unmute it.

## Run it on an always-on machine

Run Bridge AI on a device that stays on, and your agents keep working with your laptop closed. Your phone pairs with it like with any other computer, through your relay.

| Machine | What to know | Rough cost |
|---|---|---|
| A Mac mini at home | The simplest: install the app as usual | The Mac, plus a few dollars of power a month |
| A Raspberry Pi 5 | Small and quiet. Get 8 GB of memory, with Raspberry Pi OS (64-bit) and Docker | About $100 once |
| A cloud server | Nothing at home to look after. 2 CPUs and 4 GB of memory or more, Ubuntu or Debian with Docker | About $10 to $25 a month |

Agents need memory (Claude Code asks for 4 GB), so give the device more if you run several at once.

### A Mac mini

Install Bridge AI as above. In **Settings › Devices** set up the relay, pair your phone and turn on **Keep this computer awake while it's plugged in**. Turn on **Open at Login** in the Bridge AI menu, and in System Settings turn on **Start up automatically after a power failure** (Energy) and automatic login (Users & Groups), so it comes back by itself after a power cut.

### Linux, a Raspberry Pi or a cloud server: Docker

[Install Docker](https://docs.docker.com/engine/install/), then:

```bash
mkdir bridge-ai && cd bridge-ai
curl -fsSLO https://raw.githubusercontent.com/sahil1/bridge/main/docker-compose.yml
docker compose up -d
docker compose exec bridge bridge-ai relay setup   # once: your relay, with a Cloudflare API token
docker compose exec bridge bridge-ai pair          # shows a QR code: scan it with your phone
```

`relay setup` asks for a Cloudflare API token. Make one at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens): **Create Token**, then the **Edit Cloudflare Workers** template, or a custom token with only **Account › Workers Scripts › Edit** and **Account › Account Settings › Read**, for your account. Bridge AI keeps it in its data folder (readable only by you) to update the relay later. `pair` prints the QR code, the link and the code to type; then finish on the phone as in [On your phone](#on-your-phone).

- **What's in it**: Node, git, `gh` and Bridge AI's server, for 64-bit Intel/AMD and Arm. It runs as a normal user, not root.
- **What's kept**: three volumes. Your home folder in the container (every agent's sign-in, git and SSH settings, agents you install), Bridge AI's data folder, and `~/code` for your repos.
- **Restarts**: after a crash or a reboot it starts again and reconnects to the relay. `docker compose exec bridge bridge-ai status` shows how it's doing.
- **Updates**: `docker compose pull && docker compose up -d`.
- **No open port**: your phone comes in through the relay. For a browser on that device or over `ssh -L 7420:127.0.0.1:7420`, see the comments in [docker-compose.yml](docker-compose.yml); the port stays on 127.0.0.1.

Without Docker, the server runs on its own too: clone the repo, `npm link`, then `bridge-ai start` (the same as `npm start`, no app window). The commands above work the same way (`bridge-ai relay setup`, `bridge-ai pair`, `bridge-ai status`).

### Signing in to your agents

Install agents in **Settings › Agents** (from your phone is fine), or with `docker compose exec bridge npm install -g @anthropic-ai/claude-code @openai/codex`. They go in your home folder, so they stay through image updates and can update themselves. You can also bake them into your own build of the image: see the `AGENTS` setting in the [Dockerfile](Dockerfile).

The device has no browser, so a sign-in shows a link that you open on your phone or laptop. On the phone, **Settings › Model Providers › Sign in** next to an agent runs its sign-in in a terminal tab you can type in. From a laptop, SSH to the device and use `docker compose exec -it bridge bash`.

- **Claude Code**: `claude auth login` (or `/login` in Claude Code) shows a link. Sign in there, then paste the code the page shows at **Paste code here if prompted**. Or, with a Claude subscription, run `claude setup-token` on any computer with a browser and put the token it prints in docker-compose.yml as `CLAUDE_CODE_OAUTH_TOKEN` under `environment`. An `ANTHROPIC_API_KEY` works too. ([Claude Code docs](https://code.claude.com/docs/en/authentication))
- **Codex**: `codex login --device-auth` shows a link and a one-time code to enter there (Bridge AI's Sign in button uses it on a device with no desktop). Turn on device code login in your ChatGPT security settings first; for a workspace, an admin does. Or use an API key: `printenv OPENAI_API_KEY | codex login --with-api-key`. ([Codex docs](https://developers.openai.com/codex/auth))

### Getting your code there

Put repos in `~/code`: agents start in folders inside the home folder. In a terminal on the device (`docker compose exec -it bridge bash`), set your name for commits once (`git config --global user.name "Your Name"` and `user.email`), then either:

- **GitHub CLI**, for all your repos (and pull requests from Bridge AI): `gh auth login`, pick GitHub.com, HTTPS and "Login with a web browser", and open the link it shows on your phone with the one-time code. Then `gh repo clone you/your-repo ~/code/your-repo`.
- **A deploy key**, for one repo and nothing else: `ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519`, add `~/.ssh/id_ed25519.pub` in the repo's **Settings › Deploy keys** (tick **Allow write access** so agents can push), then `git clone git@github.com:you/your-repo.git ~/code/your-repo`.

## Security

- The server listens on `127.0.0.1` only. It answers requests whose Host is this device or a Tailscale name and, from a browser, whose Origin is too, so other web pages can't drive your agents through localhost.
- In Docker it runs as a normal user and publishes no port. If you publish one for a browser, bind it to 127.0.0.1 as [docker-compose.yml](docker-compose.yml) shows, never to the network.
- File and git actions stay inside the agent's folder. They change things only when you ask from the app: saving a file, undoing a change, committing, pushing (never forced) or opening a pull request.
- Anyone who can reach the server can type into your agents. Phone access uses your own relay, which only lets in phones you paired (end-to-end encrypted), or `tailscale serve`, which only devices on your tailnet can reach. Never expose Bridge AI with `tailscale funnel` or a public port.
- Mail and meeting agents are told that email text is data, not instructions, and never to send or post without your OK.

## Optional setup

Each of these shows up where it's needed, with one button that does it. Installs run in a terminal tab you can watch (in the Setup space), and the screen picks up by itself once it's done.

- **All of it at once**: setup's first step recommends Just what agents need (Node.js, which asks for nothing); Everything, there or in Settings › General's Set up, does the rest in the background while you carry on: Node.js first (an agent's Install says it's waiting for it, with how far it is), then the speech model, and on a Mac Apple's command line developer tools when they aren't there (about 1 GB from Apple, so git works without macOS stopping to ask), Homebrew when what it brings is needed, and what macOS asks you to allow. The programs install in one terminal tab ([`scripts/setup-mac.sh`](scripts/setup-mac.sh)) that asks for your Mac's password once, at its start; setup shows that terminal in place, so you type it there. Once setup is closed, the top bar says "Setting up · 3 of 6", or that it needs you, until it's done.
- **Signing in to your agents**: Bridge AI's first-run setup offers Install and Sign in for Claude Code and Codex, and Sign in for any other agent it finds. An agent still on its own first-run screens (look, sign-in, trusting its folder) shows them as a card in its chat. Settings › Agents and the Usage card have Sign in too.
- **Voice notes**: tap the mic in the message box, on the computer or your phone, and talk. The first time, Bridge AI says the speech model is a one-time download (Parakeet, 670 MB, to `~/.bridge-ai/models`) and one click downloads it, then turns what you said into text. Nothing to install, on any computer, and no password. On macOS 26, the Mac's own speech answers while it downloads. Speech is turned into text on your computer; audio never leaves it. Settings › Voice has the other models (Parakeet English, and Whisper for other languages) and removes a download. If macOS has the microphone off for the app, the mic offers Allow access.
- **Meeting notes**: they use the same speech model (Settings › Voice), downloaded when your first meeting starts if it isn't here yet, or a service you pick in Settings › Meetings. For the call's sound, macOS asks to allow System Audio Recording the first time you record.
- **Inbox (macOS)**: Mail needs your account and one sync (the Inbox card's Open Mail), and Bridge AI needs Full Disk Access (Allow access). In the desktop app, Allow access opens System Settings with a tile beside it: drag Bridge AI from the tile into the list and turn it on. Restart to apply then appears at the top, for whenever it suits you.
- **Calendar (macOS)**: Install icalBuddy in the Calendar card (it offers Homebrew first when it's missing), then Allow access for Calendars when macOS asks.
- **Pull requests**: the Changes tab offers to install GitHub's `gh` and sign it in. On a Mac without Apple's developer tools, it offers those for git.
- **Agents' folders in Desktop or Documents**: if macOS was told no, the Files tab and New agent offer Allow access (Files & Folders).
- **Permissions**: every Allow access works the same way. macOS's own question comes first where it has one (the microphone, Accessibility, Calendars, Automation); System Settings opens, with the tile beside it, only when it has none (Full Disk Access) or already said no. Bridge AI notices by itself once it's on and carries on with what was waiting. If it's still off a moment after you turned it on (an answer kept from an older version of the app, or a switch that doesn't take), **Reset and ask again** forgets macOS's answer for Bridge AI only, with no password, and asks again. Settings › General › Permissions lists what Bridge AI may use on this computer, whether each is on, and one button; on a phone or another of your devices it shows that computer's, and **Ask** has that computer show its own question.
- **Plan usage**: off until you turn it on (the Usage card, or Settings › General). It asks each provider how much of your plan is left, with the sign-in your agents use on this computer, through [quota-axi](https://www.npmjs.com/package/quota-axi). Some providers, Anthropic among them, don't allow other apps to use their sign-ins, so it's your call. For Claude, macOS asks once for Keychain access (the Usage card's Allow).
- **Weather**: the Weather card asks for your city when it doesn't know it.

Testing these without changing anything on your Mac: `BRIDGE_FIX_DRYRUN=1` makes Bridge AI log what it would open in System Settings instead of opening it, and `BRIDGE_PATH` (a list of folders) makes it look for agents only there, never in your login shell's PATH or Homebrew's folders.

## License, terms and privacy

[Apache-2.0](LICENSE). See [NOTICE](NOTICE).

Bridge AI is provided as is, with no warranty, and you're responsible for what your agents do and for following the terms of the services you connect ([TERMS.md](TERMS.md)). It's an independent project, not affiliated with or endorsed by Anthropic, OpenAI, Google, GitHub, Cursor, Cloudflare or any other company whose tools it works with; their names and logos belong to them. The project collects nothing about you ([PRIVACY.md](PRIVACY.md)).
