# Bridge AI's Manual

<!-- Made by scripts/manual.js from README.md and the words in Settings (src/components/Settings.jsx, src/components/settings/search.js, src/trials.js, shared/places.js). Don't edit it here: change those, then run node scripts/manual.js. A test fails while it's out of date. -->

How Bridge AI works and where everything is, for you, Chief of Staff, your agents and your bots. For a question about Bridge AI itself (how to do something in it, where a setting is), look here first. Every setting is under Settings, near the end, with where it is.

## What Bridge AI Is

**One app for the AI you already use.** Bridge AI takes notes in your meetings with nothing joining the call, types what you say into any app, and passes work to the right assistant. If you write code, Claude Code, Codex, Gemini CLI and your other agents run side by side, each on its own branch, and you can answer them from your phone.

It runs on your computer. Meetings and dictation are transcribed there, your agents sign in with their own accounts, and your notes are files in a folder you choose. It's free and open source (Apache-2.0), with no account. Anonymous usage stats and crash reports are on unless you turn them off.

**For everyone**

- Notes from every meeting, with the decisions and who's doing what. Nothing joins the call, and the audio stays on your computer.
- Hold ⌥Space on a Mac and talk, and your words appear in whatever app you're typing in.
- A Chief of Staff that keeps your tasks and drafts follow-ups, using the AI plan you already have: Claude, ChatGPT, Gemini or Copilot.
- A free model that runs on your computer, even offline.

**For developers**

- Claude Code, Codex, Copilot, Cursor Agent, Gemini CLI, OpenCode and more, each in its own terminal with your own sign-in.
- Each agent on its own branch, with its changes to review, commit and push.
- One list of every agent that's waiting on you, across your Mac, Linux and Windows machines.
- A phone app to answer them, end-to-end encrypted.

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

### Android

The phone app, for Bridge AI on your computer: on your phone, download [`Bridge-AI-android.apk`](https://github.com/sahil1/bridge/releases/latest/download/Bridge-AI-android.apk), then:

1. Allow installs from your browser or Files: when Android says it can't install apps from this source, tap **Settings** and turn on **Allow from this source**.
2. Open `Bridge-AI-android.apk` and tap **Install**.
3. Open Bridge AI and scan the QR code from your computer: **Settings › Devices & Access › Phone › Pair a device**.

It isn't on Google Play yet. To update, install a newer APK over it; your computers stay paired. Its SHA-256 is in the release's `SHA256SUMS.txt`, and it has a build attestation like every release file. With no computer yet, it has Try the demo and Cloud Agents. More in mobile/.

### Removing it

- **macOS**: quit Bridge AI and move it from Applications to the Trash.
- **Windows**: Settings › Apps › Installed apps › Bridge AI › Uninstall.
- **Linux**: `sudo apt remove bridge-ai-desktop` where it came as a `.deb` (Debian, Ubuntu); otherwise delete `~/.local/share/bridge-ai`, `~/.local/bin/bridge-ai` and the menu entry, `~/.local/share/applications/dev.bridge-ai.app.desktop` (`bridge-ai.desktop` if it was installed before 3.7.1).
- **Android**: touch and hold Bridge AI, then **App info › Uninstall**.

Your settings, meeting notes and the rest stay in `~/.bridge-ai` in case you install it again; delete that folder to remove them too.

### From your terminal

Run `npm link` once in the repo to get the `bridge-ai` command:

```bash
bridge-ai list              # every agent and shell, numbered
bridge-ai attach 2          # work in one from this terminal (or: bridge-ai attach "api tests"); Ctrl+] detaches
bridge-ai attach            # pick from a list
bridge-ai open              # open the app in your browser, let in by a one-time link (--print: just the link)
bridge-ai mcp               # Bridge AI as an MCP server for another app (Settings › Agents & Models › MCP Servers adds it)
bridge-ai start / stop
bridge-ai status            # is it running, which agents, the relay and paired phones
bridge-ai relay setup       # your phone relay, with a Cloudflare API token (no browser needed)
bridge-ai pair              # pair a phone: QR code, link and code, right in the terminal
bridge-ai phones            # paired phones (bridge-ai phones remove <name>)
```

Attaching gives you the agent's real terminal, in your terminal app, with its keys, fonts and scrollback, the way `tmux attach` or `herdr` does. The agent keeps running in Bridge AI when you detach, and the app stays in sync. The terminal button on each agent (and "Open in terminal app" in the sidebar menu) opens the same thing in Ghostty, iTerm, Warp, WezTerm, kitty, Alacritty or Terminal on macOS, your terminal on Linux, or Windows Terminal; pick which in Settings › Agents & Models › Agents (under Advanced). With the herdr runtime, `attach` focuses the agent and opens herdr.

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

Day-to-day use so far has been on macOS. Linux and Windows use the same code paths (node-pty and Electron both support them) but have had little testing, so please open an issue if something breaks. On Linux the server has been tested mostly in the Docker image (Debian, amd64 and arm64): agents, terminals, git, sign-in and pairing a phone. On a Linux machine with no desktop, **Sign in** for Codex uses its device code login, since there's no browser to come back to.

## Agents

Bridge AI finds the agent CLIs on your PATH. Each one is described in `server/agents.js`: how to start it, how to resume a session, and what its screen looks like while it works.

| Agent | Command | Chat view | Sign in from Bridge AI | Extras |
|---|---|---|---|---|
| Claude Code | `claude` | ✓ | ✓, several accounts | subagents and background shells, slash commands, question cards, safe sending |
| Codex | `codex` | ✓ | ✓, several accounts | slash commands, question cards, safe sending |
| Antigravity CLI | `agy` | terminal | in its own screen (your Google account, the first time) | what Google AI plans use since 18 June 2026 |
| Gemini CLI | `gemini` | ✓ | ✓ (a Gemini API key, or a Code Assist licence) | |
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

**More models** (Qwen Code, DeepSeek, Kimi, Z.ai's GLM, and their models on OpenRouter, Together, Hugging Face or Ollama) can be turned on in Settings › Agents & Models › Model Providers › **More Models**.

Gemini CLI, Qwen Code, Copilot and Cursor get their Chat view from the logs they write themselves (`server/otherlogs.js`), so it shows what they said and the files they changed, and Bridge AI finds each one's conversation after it starts. Agents without a chat view work fully in the Terminal tab, and their status (working, waiting on you, finished) still shows in the sidebar. OpenCode, Crush and Goose keep their conversations in a database and Amp on its servers, which is why they're terminal only for now. Adding an agent, or a chat view for one, is a small change; see CONTRIBUTING.md.

**No agent at all?** Bridge AI has its own chat with any model, with nothing to install: New chat, then **Any model**. It talks to whatever you can reach: a plan you're signed in to through one of the agents above (Claude, ChatGPT, Gemini, Copilot, Cursor and others, through their one-shot mode), an API key from Settings › Agents & Models › Model Providers (OpenAI, Anthropic, Google, OpenRouter, xAI, Mistral, DeepSeek, Groq, Perplexity, Meta, Moonshot, Together, Fireworks, Cerebras, Cohere, Z.ai, Hugging Face), your cloud (Azure OpenAI with the deployments you name, AWS Bedrock with a Bedrock API key or your AWS profile's access keys, Google Vertex AI with a service account or your gcloud login), or a model on your computer (Ollama, LM Studio). Switch models mid-chat from the model button in the message box, or type `/model`. It has a Chat view and works from your phone like any agent, in the built-in runtime and in herdr.

**A model on this computer, one download:** Settings › Agents & Models › Model Providers › **Local model on this computer** recommends the Gemma 4 model (Google, Apache-2.0) that fits this computer and says why: Gemma 4 E2B (2.8 GB) with 8 GB of memory or no GPU, Gemma 4 E4B (4.6 GB) with 16 GB and a GPU, Gemma 4 26B-A4B (14.6 GB) with 32 GB and a GPU; the ones this computer can't run aren't offered, and you can pick another of those that are. It downloads from Hugging Face when you click Download, never by itself, and the desktop app runs it with llama.cpp, which comes with it: free, private and offline, good at rewriting text, Edit by voice, Tidy what I say, questions about a meeting and notes for short meetings. Once it's here, every model list offers it as on this computer, and **Models for Each Task** sets where each task on **Automatic** runs: **Auto** (short jobs here; meetings longer than about 50 minutes, diagrams, live suggestions and the transcript cleanup on Claude or your other models; everything here when there's no other model), **On this computer** (never elsewhere: a job that can't run here says why) or **Cloud first**. What ran says which model it was. It loads when first asked and lets go of its memory (3 to 16 GB) a few minutes after. Offered on computers with 8 GB of memory or more: Macs on macOS 13.3 or later (on the GPU on Apple Silicon, the processor on Intel), Windows (with a Vulkan GPU, else the processor; its Arm build on Windows on Arm) and Linux x64 with glibc 2.34 or later. Not in the Docker image or a server run from source, which don't come with llama.cpp (`node scripts/llama.js native/llama` fetches this computer's build for a checkout). Ollama and LM Studio are asked for a context that fits each job, with thinking off for Bridge AI's own jobs.

**A model for each task:** Settings › Agents & Models › Which Model Does What › **Models for Each Task** has a row for meeting notes, AI Assist, mail (on a Mac), titles and tidy-ups, live AI Assist and diagrams. Each is **Automatic** (as above), or a model of its own picked from every provider you've connected (a key's, a cloud's, a sign-in's, Ollama, LM Studio or the local model built in), by provider and searchable, with others to fall back on in order. Pick one from a provider with no key yet (Together AI, Groq, Fireworks, Cerebras, OpenRouter, Hugging Face and the rest) and its key form opens right there; until there's a key, the row says the task can't run, and so does the task. When the first can't run (no key, its provider down or over its limit, Ollama closed, a local model not downloaded), the next one does at once; the row's last run says which ran and why the other couldn't, as do the usage log and a meeting's notes. A task goes from a model on this computer to one elsewhere only when its list says so. A model picked where it's used (a meeting's own for its notes, Studio's writer) still comes first; Edit by voice and Tidy what I say keep their own picks. Meeting notes are picked here only: Settings › Meetings & Voice shows which model writes them, with Change it to come here, and one picked there before 3.22.0 is first in this row, followed by the models it fell back on then (up to three of the others you have), so it falls back as before. Live AI Assist, the live board and the transcript's cleanup go by their own rows, whatever writes the notes.

**Any model on your files:** New agent, pick a folder, then **Any model**. It gets tools to read, search and change the files in that folder and to run commands there, and asks before each change or command with a card in Chat: **Yes**, **Yes, and don't ask again** for the rest of that chat, or **No**, after which you tell it what to do instead. Its edits show in Chat and in Changes. It works with models through an API key, a cloud or your computer; one that turns tools down carries on as a chat. A plan you're signed in to (Claude, ChatGPT) works on files through its own agent instead.

## Cloud Agents

Some providers run coding agents on their own computers, on a repo they host, and keep going while your computer sleeps. Add your key in Settings › Agents & Models › Model Providers › Cloud Agents, then start one from New agent › In the cloud: pick the provider, the repo and a branch, and say what to do. They show up in a Cloud space in the sidebar with the same dots (working, waiting on you, done) and the same notifications, here and on your phone. Chat shows what the agent said and did, the message box sends follow-ups, and the header has Stop and the pull request. The chief of staff sees them too.

| Provider | How it works | Key | Cost |
|---|---|---|---|
| Cursor | Cursor Cloud Agents API. It pushes a branch and opens a pull request | API key from [cursor.com/dashboard/api](https://cursor.com/dashboard/api) | Your Cursor plan |
| GitHub Copilot | Bridge AI opens an issue with your task and assigns it to Copilot, which works in a draft pull request. Follow-ups are `@copilot` comments there | A fine-grained token (Metadata: read; Actions, Contents, Issues and Pull requests: read and write), or your GitHub CLI sign-in | Your Copilot plan |
| Jules | Jules API, on a repo you've connected to Jules. You can ask to see its plan first | API key from [jules.google.com/settings](https://jules.google.com/settings#api) | Your Jules plan |
| Claude | Claude Managed Agents, with your repo mounted. It pushes a branch | API key from the [Claude Console](https://platform.claude.com/settings/keys), plus an optional GitHub token for private repos and pushing | Pay per use on your Claude Console account, not your Pro or Max plan |

Bridge AI checks on running agents every 10 to 20 seconds, less often when several run at once or once they wait or finish, and backs off when a provider asks it to slow down or has trouble. Copilot and Jules have no stop in their APIs, so Stop for those is on their own pages. The provider code is in `shared/cloud/` and uses only `fetch`, so the phone apps run it too.

**With no computer**: the iPhone and Android apps have Cloud Agents on their start screen. Add your key on the phone and start and follow agents from there. Keys stay on the phone (iPhone's Keychain, Android's Keystore) and go only to their own provider; the phone keeps its own keys and agents, apart from your computer's. Android checks on them in the background and notifies you; iPhone checks while the app is open. More in mobile/README.md.

## Meeting notes

**Meetings** in the sidebar (on a phone, on the Agents tab), then **Start recording**. The first time, Meetings walks you through what it needs, each step a tick or one button: speech to text (the speech model's one-time download, Parakeet, or a speech service; on macOS 26 or later, the Mac's own speech meanwhile), the mic, a model to write the notes, and your calendar if you want notes named after your meetings. Until speech to text is set up, Meetings says so, and a meeting recorded meanwhile keeps its audio for **Transcribe again**. Bridge AI records your mic and, in the desktop app on macOS 14.2 or later, the call's sound, whatever app it's in (Zoom, Meet, Teams), so the transcript says who spoke: You or Them. The transcript comes in as people talk, a few seconds behind, with your own notes beside it if you want to jot any. The recording keeps going while you use the rest of the app; point at its bar in the top bar for Pause, New section, Stop, a quick note and the way back to the meeting. **New section** splits a recording into parts as it goes, like laps or the sections of a long presentation: the transcript, your notes and the summary get a heading for each, and you can rename one by clicking it in the transcript. The record button beside Meetings in the sidebar starts a meeting straight away (named after the calendar event on now, if there is one), or, while one records, stops it and starts the next. A meeting's tab has the same header as an agent's: its name, when it was, who was in it and where its notes are saved, each changed in place, and Summary, My notes, Transcript and Files as tabs, with the transcript beside the one you're on if you like.

**What was on the screen:** while it records, **Watch a screen** and pick the window where someone shares their slides (macOS's own picker in the desktop app on macOS 15 or later; on macOS 14 it watches the main screen, after macOS asks to allow Screen Recording; in a browser, the browser's picker). A picture is kept each time what's shown changes, a new slide or another page, but not for a speaker's video or a cursor moving, and **Capture** keeps one now. The pictures sit in the transcript at their time, and the words on them are read on your Mac (`native/bridgeocr.swift`, with Vision), so the summary and answers know what was shown. Paste or drop a picture into your notes and it stays where you put it. Add a note at any line of the transcript with **+**, and it shows there too. Fold the transcript away to give your notes the room, or drag the line between them.

**Files, links and emails** go with a meeting, on its Files tab: the document links in the calendar invite come by themselves, **Attach** takes a link or a file's path, files picked in Finder or dropped on the meeting, and on a Mac, the emails about the meeting in Mail with the files that came with them (Mail needs Full Disk Access). Each is linked where it is, not copied, and read when the notes are written or a question is asked: Word, PowerPoint, Excel, CSV, PDF, Markdown and text. A file that moved says so. A file dropped in a browser, which can't say where it is, is kept as a copy.

**Who said it:** the call is one sound for everyone on it, so its lines say Them. **Who spoke**, on the transcript, has the model that writes your notes name who said each line, from the names used, the words on the shared screen and who was invited; a line it can't place stays Them, and its guesses are in italics. Click a name, or Them, to set it yourself. Every meeting where the call was heard gets this before its first summary (Settings › Meetings & Voice › Meetings › Name who spoke on the call), from the invite, names said ("Hi, Priya") and the meeting's name; with one other person invited, the call is them. A meeting recorded without its calendar event offers the event from around then, for its people, and says so when Bridge AI isn't allowed to see your calendar yet. A meeting called "Interview - ...", "... standup" or "... 1:1" gets that kind of notes.

Misheard a name? Edit the line, or select the word and **Fix a word**: it's fixed everywhere in that meeting, and with **Remember it**, in every meeting. **Memory** (a tab of Meetings and of Dictations, on a phone too, each showing what came up there and the names you added, or all of it) keeps the people, organizations, projects and terms from your meetings and dictations, how each gets misheard and a note on each; the speech engine listens for them and the notes and answers know them. Summaries add the names they find, and a few words on who or what each is when the meeting makes it clear (never over a note of yours), and you can change or remove any, merge two that are the same, and tidy away what adds little. **About You**, a few lines on who you are and who you deal with most made from it on your computer (or written by you), goes to the models you use for meetings (notes, Who spoke, cleanup, AI Assist and your questions about meetings) and the one that tidies dictation, and to the Chief of Staff, until you switch it off there. **Pointers**, beside it, is what you mean by "that": "the deck from Tuesday" to its file, "the pricing doc" to a link. Chief of Staff and the Claude Code agents you start read it, and add one when they had to search or ask to find what you meant; each says who added it, and one an agent added says it isn't checked until you keep it. Add, change, keep, pin (never tidied away) or delete them there, on a phone too. Past a size the list is tidied, the oldest an agent added first, and it says so. A bot sees only the ones it learned from the person it's answering, in a direct message with them, and yours you let bots use whose file is in its own folders. **Transcribe again** runs a meeting's audio through another speech model or service, or another language, and keeps the old transcript; a meeting heard by a light model (Small or Base) suggests Large turbo, which hears names and jargon better.

**Who said what in a room:** with your mic only (no call's sound), **Who spoke** tells the voices around the table apart, on your computer, with a small voice model (3D-Speaker's ERes2Net, 26 MB, Apache-2.0) downloaded the first time you ask, then the model that writes your notes works out who each is from names said and who was invited. Each line says Speaker 1, Speaker 2 or a name; click one to name that voice from the invite, yourself or someone else, once for all their lines. After the first time, room meetings get their speakers by themselves: as they record on a computer with four cores or more, else once they end. **Remember voices you name** (Settings › Meetings & Voice › Meetings, off to start with) keeps a few hundred numbers for how each named voice sounds, on this computer only, so they're named by voice next time; Forget voices removes them. It's offered wherever Parakeet runs, with 2 GB of memory or more.

**Cleaning up the transcript:** when you're not on headphones, your mic hears the call too, so a line of yours keeps only your words and says what was heard. When a meeting ends, the model that writes your notes reads the transcript with its invite, its files and Memory, fixes what speech to text misheard (names, jargon, a word cut in two) and leaves out words nobody said ("Thanks for watching"). Each fixed line says what was heard, **Undo** puts one back, and a line left out can be shown and put back. Your own edits always win. Turn it off in Settings › Meetings & Voice › Meetings, or run it from the meeting's **AI Assist**.

**Suggest what to ask** (AI Assist on a meeting while it records, or on the floating card; the suggestions are on its Suggestions tab): the model that writes your notes reads along and, about once a minute, suggests what to ask, raise or check next, from what's been said, the invite, the files that go with the meeting and your notes. In an interview it compares what the candidate says with their resume and suggests follow-ups; on a customer call, discovery questions and next steps. Each suggestion says what it's based on, the newest shows on the floating card, ✓ puts one in your notes and ✕ dismisses it. **Suggest now** asks straight away, even before anyone talks. Memory is only background for it, used when today's meeting touches it. Settings › Meetings & Voice › Meetings turns it on for every meeting.

**Files you got for a meeting:** a file in Downloads or on the Desktop from around the meeting, named after someone in it or its name, a resume before an interview, or one that came in while it recorded, is offered on the Files tab (and on Suggestions while it records) to add with a click. Its names and terms help the speech engine spell them too.

When it ends, the model for meeting notes (Settings › Agents & Models › Which Model Does What › Models for Each Task; Settings › Meetings & Voice › Meetings › Notes are written by says which) writes a summary with decisions and action items, shaped by your notes. If it can't be reached, the next in its row is tried (with Automatic, the other models you have), and if none answer, the summary is written later by itself; your notes and the transcript are kept either way. Then:

- **Regenerate**, with the language to write the notes in, the model, and a template: 1:1, standup, customer call, interview or brainstorm, each with its own summary.
- **Ask about this meeting**, answered from the transcript, or tap Draft a follow-up email, What did I agree to do? or What's still open?
- **Start an agent** on an action item: it picks the project the item is about (named in it, said in the meeting, or used for this meeting before) and says why, for you to change; the agent starts there on its own branch, in a space named after the meeting, told the item, what was said about it and what was decided. You can read and change what it's told first.
- **To Chief of Staff**, one item or all of them: they go on the chief of staff's task list. It takes the ones that are yours and drafts follow-ups for the rest, without sending anything. Send action items to Chief of Staff leaves out the ones already handed on.
- Under each item, **what became of it**: its agent working, waiting on you or finished, its pull request and checks; Chief of Staff's task, what it's waiting on you for and what it did. Tick one done yourself.
- **Since last time**: the next meeting in a series (the same name, without the date), with the same people or with the same customer (an email domain they share, or a customer in Memory) shows in a line what became of the last one's action items, and on Meetings under Take notes before it starts.
- **Save**: Markdown in a folder you pick (pictures go in an attachments folder beside the note, and the files, links and emails are listed as links) (~/Documents/Meeting notes to start with), for Obsidian or any notes app, laid out the way Granola's sync does it: year, month and day folders, and a summary note (with your notes) and a transcript note that link to each other. Settings › Meetings & Voice › Meetings › Save notes as Markdown sets what's saved (two notes, one, or just the summary or the transcript), and each one's folder, subfolders and file name as patterns ({year}/{month}/{day}, {quarter}, {date}, {time}, {title}, {kind}), front matter, the speakers' names, and saving every meeting by itself. A saved meeting stays up to date when its summary, title or notes change, except a note you've changed in your notes app, and notes already saved can move when you change where they go.

**Ask about your meetings**, at the top of Meetings, answers from all of them ("What did I agree to do this week?", "Write my weekly update") or from the ones you've ticked, and cites the meetings it used; click one to open it. Search looks through what was said, the summaries, your notes, the words on the screen's pictures and the names of the files. Meetings in the sidebar opens their list under it, like a space; ⌘-click or Shift-click picks several to save, send to the chief, summarize again, put in a folder, archive or delete together, and right-click one for the rest of its menu. Folders sit under the days in the sidebar and are filters on Meetings. **Archive** puts a meeting away under Archived, left out of search and of questions about your meetings until you take it out. Deleting asks first, and offers the archive instead.

**Meeting Insights**: Insights and People, tabs of Meetings, add up your meetings (how much time, when in the week, which series, your share of the talk) and the people you meet, worked out on your computer and never sent. It turns on by itself once 5 meetings are recorded on the computer, and says so once in Meetings with Turn off; its switch is in Settings › Meetings & Voice › Meetings.

**Calls** (desktop app): when Zoom, Teams, FaceTime, Slack, Webex, Discord or a call in your browser starts using your mic, Bridge AI offers to take notes, named after the calendar event on now. When the call ends it offers to stop, and stops by itself two minutes later unless you keep it going. It only looks at which apps have the mic (`native/callwatch.swift`), so there's nothing to allow. A **floating card** over your other apps is a slim bar while it records, with Pause and Resume on it, and opens when you point at it: how loud you and the call are, who's talked how much, the last twelve minutes as bars, the last things said, when the meeting ends, Pause, New section, Stop, Watch a screen and Capture, a quick note and Open the meeting. Pin it open, and drag it from anywhere on it. It offers Take notes when a call starts; Settings › Meetings & Voice › Meetings shows it during calls and meetings, always, in the menu bar instead (the time, with Pause, Stop and the meeting in its menu), or never, and can open it on a click instead of when you point at it. Share your screen on a Mac and the card goes to the menu bar by itself (most sharing apps show windows like it, even ones that ask to be left out), and comes back when you stop; its **Move to the menu bar** button puts it up there for the rest of the meeting, with **Show the card** to bring it back.

A calendar event starting in the next ten minutes shows **Take notes** on Meetings, which names the meeting after it and helps spell its people's names. Long meetings are fine: audio is transcribed in short pieces as you go and silence is skipped, so the transcript is ready a few seconds after you stop, and a long one is summarized in parts. Each meeting keeps its audio (Opus, about 11 MB an hour for each side) in `~/.bridge-ai/meetings`.

**Transcribe a file or a folder:** drop audio or video anywhere in Bridge AI's window, or on its Dock icon on a Mac, or use **Transcribe a file** in Meetings (or ⌘K), from your phone too. Each file becomes a transcript of its own in Meetings, with who spoke (Speaker 1, Speaker 2, told apart by voice on your computer) and when, which you name, search, edit and **Ask about** with AI Assist as a meeting's. Pick the speech model and the language as you add it (Whisper takes a language Parakeet doesn't hear). Save it as text, Markdown, or subtitles (SRT or WebVTT). A folder goes one file after another, each with its own line, and one that can't be transcribed says why. Bridge AI reads WAV itself, and on a Mac every kind macOS reads (MP3, M4A, MP4, MOV, FLAC…); elsewhere ffmpeg reads the rest when it's installed, or the window reads it. The file's sound is kept with its transcript (16 kHz, about 115 MB an hour), the copy that came in isn't; nothing is written by a model or saved to your notes folder until you ask.

Speech to text, in Settings › Meetings & Voice (the speech model itself is picked in its Speech Models tab, and voice notes use it too):

| Engine | What it needs | Price per hour of audio |
|---|---|---|
| On this computer: Parakeet (the default) | One download from Hugging Face, nothing to install: Parakeet (670 MB; English and 24 more European languages, which it tells apart itself; NVIDIA, CC-BY-4.0) or Parakeet English (663 MB; the best at tool names and jargon; NVIDIA Open Model License). Runs on the processor through sherpa-onnx, on macOS (both chips), Windows, Linux (x64 with glibc 2.32 or later, Arm) and in the Docker image | free, and the audio never leaves your computer |
| On this computer: Whisper | One download from Hugging Face, nothing to install: Large turbo (1.0 GB), Large (1.8 GB), Small (376 MB) or Base (161 MB), OpenAI's models (MIT) in the ONNX form made by the sherpa-onnx project. About 100 languages, and it tells which it hears; for the languages Parakeet doesn't. Runs in the same engine as Parakeet, wherever Parakeet runs (the Docker image too) | free, and the audio never leaves your computer |
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

Prices are list prices from October 2026; the service's own page is what counts. Keys go in Settings › Agents & Models › Model Providers. Ollama and LM Studio don't do speech to text, so they write notes but can't transcribe. On this computer, the speech engine starts with your first meeting or voice note, uses two to four cores, and lets go of the model after a few idle minutes (Parakeet, about 2 GB of memory while it's loaded, runs in a process of its own). Settings › Meetings & Voice › Speech Models lists only the models this computer can run; one that can't run here (a setting copied from another computer) is replaced by Parakeet, and Settings says so. Where neither can run (Linux older than Ubuntu 22.04, musl, 32-bit Arm), a whisper.cpp already installed on that computer runs Whisper instead, as in 3.22 and before (Settings says so; Bridge AI doesn't install it), else meetings can use a speech service. Whisper models downloaded by earlier versions for whisper.cpp aren't used any more: Speech Models offers to remove them.

The call's sound comes from a small helper (`native/calltap.swift`) that uses macOS's own audio tap, so it hears the call whether it plays on speakers or headphones. macOS asks once to allow **System Audio Recording**, and remembers it across updates (the app is signed with the same certificate each time). Without it, your mic still records the meeting, and hears a call on speakers.

## Your other devices

Link your other computers running Bridge AI (Mac, Windows or Linux) and switch between them from the top left: each one's Bridge AI opens in the same window, its agents, chats, terminals and files, as if you were sitting at it. The sidebar's **Devices** lists them with their agents and what needs you, and the desktop app can open one in a window of its own. A phone paired with any of them reaches them all.

1. Each device needs its relay (Settings › Devices & Access, below).
2. On one, Settings › Devices & Access › Phone › **Pair a device**. It shows a QR code, a link and a code, the same for a phone or a computer, for 15 minutes and one device (**Add another device** makes a new one). A pairing link opened on a phone asks "Pair with <name>?" first.
3. On the other computer, Settings › Devices & Access › Computers › **Link a device**: paste the link, or type the address and code; from a phone showing it, **Scan QR code** reads the code instead. They link both ways. The first one says the new device paired, with **Keep** and **Remove**; once you keep it, it's introduced to your other devices too.

Or let your phone do it: scan the new computer's code with the Bridge AI app on a phone that's paired with another of your computers. The phone offers to link the two, asks, and takes you to the other one to allow it after checking both show the same six digits. A device's relay address alone asks the same way.

Devices talk end-to-end encrypted through each other's relay, the same way a phone does. A link looks after itself: one that goes quiet (a Mac that slept, a network that changed) starts over, a device that moves to a new relay is followed there, and one that was set up again says so and links again with a new code. When one is offline, **Fix** checks each step between the two, says plainly where it stops, and connects again. Unlink in Settings › Devices & Access › Computers, on either one.

The relay in between is trusted with nothing. What a device says about itself (its name, that it's a computer, where it's reached) counts only when it comes sealed, a refusal or another key through the relay is said ("the answer couldn't be checked") and tried again rather than acted on, and only the computer's own sealed word, or your Forget, unpairs a phone or unlinks a computer.

## Runtimes: where agents run

| Runtime | What it is | When it's used |
|---|---|---|
| **Built in** | Bridge AI runs each agent in its own terminal (node-pty, with a headless xterm keeping the screen). Nothing else to install. The terminals live in a small terminal host process, so agents keep running when Bridge AI quits, restarts or updates, and it picks them up as they are, screen and scrollback included. After a reboot, Claude Code and Codex sessions resume where they were. | Default |
| **herdr** | [herdr](https://herdr.dev) is a terminal multiplexer for agents. Bridge AI drives it, and you get herdr's own terminal UI, split panes and the live Herdr view (`Alt+2`) in the browser. | Optional. Only when you choose it; install herdr separately |

Choose in Settings › Agents & Models › Agents › Where agents run, or set `"runtime": "builtin"` or `"herdr"` in your config. herdr is never required, and Bridge AI won't switch to it just because it's installed.

To have built-in agents stop with Bridge AI instead, turn off **Keep agents running when Bridge AI quits** there (`"keepAgents": false`); they resume next time, as after a reboot. **Quit and Stop Agents** in the app's menu, or `npm run stop -- agents`, stops them either way. On Windows an app update still stops them (Windows can't replace a running program) and they resume after it; in the Docker image they stop and resume with the container.

The terminal host listens on no network. Bridge AI reaches it over a socket in a folder only you can open (a named pipe on Windows) and must give it a random token first. It exits by itself once it has no agents and no Bridge AI to keep them for.

Bridge AI joins the herdr session you already have running. It shows the agents and panes in it, and anything you start from Bridge AI opens there too, so you see it in herdr as well.

**Several sessions** (`herdr --session work`): the session menu at the top of the sidebar (on the phone, at the top of Agents) lists every session herdr knows, running or not, with how many agents wait on you in each. Pick one and the agent list, the board and the Herdr view switch to it at once. The pick is saved as `herdr.session`, the same setting as Settings › Agents & Models › Agents › Where agents run, so the two stay in step. From the menu you can also:

- start a new session in the background (herdr's headless server, `herdr --session <name> server`), or start a stopped one again with its saved layout;
- stop one (`herdr session stop`), after you confirm. Bridge AI refuses while any agent in it is working or waiting on you;
- open one in your terminal app (`herdr session attach`). If a new session can't start in the background, the menu offers this instead.

Each session keeps its own open tabs, queued messages and muted agents. Notifications cover the session you're looking at, and switching never announces anything: agents in the other sessions are out of view, not finished. herdr notes that a server started from a background job may not reach the macOS Keychain; if a tool in a session started here can't, stop it and start it from your terminal. To watch two sessions side by side, run a second copy of Bridge AI with its own data folder and port (`BRIDGE_HOME=~/.bridge-ai-work BRIDGE_PORT=7430 npm start`).

## Your data and settings

Everything personal lives in `~/.bridge-ai` (set `BRIDGE_HOME` to move it), never in the repo:

| File | What it holds |
|---|---|
| `config.json` | Your settings (see below) |
| `chief/` | The chief of staff's folder: its instructions, `state/playbook.md` (what it has learned about how you work), `state/ledger.md` (its hand-offs), `state/tasks.md` (tasks it does itself and ones it delegated) and `work/` (what it and its helpers make for them, a folder per task) |
| `routines.json`, `ideas.md` | Recurring jobs and your ideas backlog (`routines.example.json` shows the shape); each routine's runs are in `cache/routines-log.json` |
| `commands/` | With Scheduled Routines on: what you typed into Bridge AI's boxes, a month to a file, for History › Commands (90 days unless Settings › Agents & Models › Agents says otherwise) |
| `runtime.json` | Spaces and tabs for the built-in runtime |
| `host/` | The terminal host's token, socket and log (built-in runtime), readable only by you |
| `cloud-keys.json`, `cloud-agents.json` | Your cloud agent keys (readable only by you, never given to the agents on your computer) and the cloud agents you started |
| `chat-logs/` | Your chats with any model, one file each, and whether each is working (`.state`) |
| `meetings/` | One folder per meeting: its transcript, your notes, the summary, who said what (`speakers.json`), the cleanup's fixes (`cleaned.json`), AI Assist's suggestions (`assist.json`), the audio, `captures/` (pictures of the screen and in your notes) and `files/` (copies of files sent from a browser). Sections, the folder and the archive are in its `meeting.json`. `memory.json`: meeting memory |
| `projects.json` | The projects Home offers, from setup or from where you've started agents |
| `models/` | Speech models for voice notes and meetings (Parakeet's in a folder of its own), and the local model in `models/llm/` once you download it |
| `tools/node/` | Node.js, when Bridge AI installed it for you (**Install Node.js**, on a computer without one): the official build from nodejs.org, used after any Node.js of your own |
| `herdr-own.json` | With the herdr runtime: which herdr panes hold Bridge AI's own chats |
| `activity.json`, `insights/` | Insights: Bridge AI's record of the agents it ran (when, where, how long they worked and waited on you, what you sent them; 45 days), the numbers read from your agents' logs, and the last write-up |
| `cache/` | Queued messages, watchlist, uploads, mail rules |

Settings start from `config.example.json`. Put yours in `~/.bridge-ai/config.json`; `config.local.example.json` shows the shape.

| Key | What it does |
|---|---|
| `name` | What the chief of staff and the morning brief call you |
| `defaultAgent` | Agent used when none is picked (`claude`, `codex`, `gemini`, ...) |
| `chief.kind` | Agent the chief of staff runs on |
| `chief.helpers.max` | How many of the chief of staff's helpers work at once (default 3); more wait their turn. Settings › Agents & Models › Agents |
| `chief.helpers.editOwnFolder` | Helpers may change files in their task's own work folder without asking (default `false`; Claude Code, Codex, Gemini CLI and Antigravity CLI). Settings › Agents & Models › Agents |
| `runtime` | `builtin` (default) or `herdr` |
| `keepAgents` | Built-in agents keep running when Bridge AI quits, restarts or updates (default `true`). Also in Settings › Agents & Models › Agents |
| `simple` | The simple layout: the Today panel behind one button, the Agents board only once you have agents, and fewer tabs on the chief of staff. On for new installs; Settings › You › Layout |
| `meetings` | Meeting notes: `engine` (`local` or a service), `localModel`, `model` (writes the notes), `language`, `vocabulary`, `instructions`, `callAudio`, `autoSummary`, `cleanup` (clean up the transcript when a meeting ends), `assist` (AI Assist's Suggest what to ask, in every meeting), `assistModel`, `nameSpeakers` (name who spoke on the call before the first summary), `autoSave`, `folder`, `saveWhat` (`both`, `one`, `summary` or `transcript`), `noteSub`, `noteName`, `transcriptFolder`, `transcriptSub`, `transcriptName`, `frontmatter`, `youLabel`, `themLabel`, `keepSaved`, `detect` (notice calls), `autoStop`, `floatCard` (`meetings`, `always` or `off`). All in Settings › Meetings & Voice › Meetings |
| `herdr.session` | Which herdr session Bridge AI shows when you run more than one (`herdr --session work`). Unset: `main`, else the latest one running. Switch from the sidebar's session menu or Settings › Agents & Models › Agents; applies at once |
| `port` | Default 7420 |
| `location` | `{ label, lat, lon, timezone }` for weather and the brief |
| `mail.myDomains` | Your organisation's email domains, so colleagues aren't marked External |
| `assistant.cwd` | Folder that mail and meeting agents start in (point it at notes that describe you) |
| `market`, `mortgage` | Watchlist and an optional mortgage card |
| `allowedHosts` | Extra host names allowed to reach the server (Tailscale `*.ts.net` names are allowed already) |

You rarely need to edit the file by hand. **Settings** (the gear in the top bar, or `⌘,` / `Ctrl+,`) opens on **Your Features**: a card for each feature (Home, Meetings, Meeting Insights, Dictation, Tidy What I Say in the desktop app, the Chief of Staff, Scheduled Routines, Phone, Mail, Notifications, Bridge AI as an MCP Server, and every beta feature, Share Links among them) with its switch where it has one, how it's doing in a line ("Notes by Claude · 12 this week", "3 links open", "Off · password set") and **Open**, to its section; then Set up, what Bridge AI uses besides your agents. The sections are by what you're doing:

| Section | What's there |
|---|---|
| Your Features | Every feature at a glance, as above. Beta features are marked, never hidden |
| You | Your name, your location (from your device or a city search), the layout, **Home** (on unless you turn it off; Bridge AI opens where you were either way, and at Home when there's nowhere to go back to), color mode, theme, text size and language; under Advanced, density, the font, sharing a theme, what's in the top bar, and what Bridge AI is allowed on this computer (Permissions) |
| Agents & Models | Four tabs. **Agents**: the default agent and its model, picking up unfinished work, the Chief of Staff (which agent it runs on, how many helpers work at once, what it can consult), **Scheduled Routines** (on unless you turn it off: a routine runs by itself only once you give it a time), and every supported agent, installed or not, signed in or not, with one-click install and the model and effort Claude Code starts with, as recommended for your plan; under Advanced, plan usage, Command History, the terminal app and where agents run. **Model Providers**: API keys, accounts, cloud accounts, the local model built in and local model servers (Ollama, LM Studio), and your keys for cloud agents. **Which Model Does What**: every model Bridge AI picks in one place: what new agents and the Chief of Staff run on, the model for each task (meeting notes, AI Assist, mail, titles and tidy-ups, live AI Assist, diagrams) with its fallbacks, and the speech model and dictation's own. **MCP Servers**: the tools your agents can call, with a catalog of 35 popular servers, and Bridge AI as an MCP Server, off until you turn it on at the computer itself, as other apps on it can then read your boards and files |
| Meetings & Voice | Four tabs. **Meetings**: its beta features' switches, speech to text (this computer or a service), the language, names and terms, the model that writes notes, recording the call's sound, noticing calls, the floating card, **Meeting Insights** (on by itself once 5 meetings are recorded on the computer, unless you set it), and where and how notes are saved. **Dictation**: on or off, its key, where the words go, cleanup (**Tidy what I say**, in the desktop app: on to start with where the local model fits the computer, and your words as you said them when the model is slow), and its history. **Speech Models** (listening): the speech models this computer can run (Parakeet, Parakeet English, Whisper), which one voice notes, dictation and meetings use, and their downloads. **Spoken Answers** (speaking): the voice that reads the Chief of Staff's answers aloud |
| Mail & Calendar | On a Mac: How You Write, for Reply Assist, and your working hours for Find a Time. Read-only: nothing is sent or changed |
| Studio | Your Signatures (your saved signatures and initials: add, rename, make one the default, remove) and Ask Before Signing (Touch ID or the Mac's password, Windows Hello, or a signing PIN before a copy is signed). Changed in the app on the computer or on your phone, not a browser tab |
| Bots | The Bots beta feature's switch, and Open Bots, where your bots, their connections and their conversations are |
| Devices & Access | Four tabs. **Phone**: how your phone reaches this computer (Bridge AI's relay, a relay on your own Cloudflare, or Tailscale) and pairing a phone. **Computers**: linking your other computers. **Remote Access**: Remote Screen and Preview (a beta feature): this computer's screen, the Remote Access Password and control, Ask Here First and Screen Activity; and Which Devices May Connect, always, the beta on or off. **Share Links**: Share Links (a beta feature) has its switch here, then the links you gave people outside your devices, who opened them (when, from which country, which email), and Stop Sharing, the beta on or off |
| Notifications | Where you're told (this device, and every device that gets them), what about, with a sound or without, and Screen Sharing Notifications |
| Account & Backup | **Account** (once Bold Bridge accounts exist): your account, for Bridge AI's relay and Early Access, its devices, the relay's allowance, sign out, delete it. **Back Up & Move**: your setup to a file sealed with a passphrase, restored with everything shown first, or straight to a linked computer. Called Back Up & Move until accounts exist |
| About & Updates | The version and updates, the update channel (Stable, Early Access or Nightly, picked on the computer itself with no code), every beta feature with the way to its own place, privacy (usage counts and crash reports), and reporting a problem; under Advanced, the tour, the license and credits, and your `config.json`, editable, checked before it's saved, with the effective settings and defaults |

Each setting is one line; what it does in full is under **More**. What most people change first shows first, and the rest is under **Advanced** at the section's end: closed until you open it, then kept open or closed for that section. Each beta feature's switch is at the top of its own place, marked Beta, and About & Updates lists them all. A setting that needs another one on shows greyed, with what it needs and **Turn On**, rather than disappearing. ⌘K finds any setting, Advanced or not, and opens Settings at it. On a phone, Settings is the same sections, each a row in a list.

## What's in the app

- **AI Assist**: wherever a model can help with what's open, the same button with a magic wand at the right end of the header or toolbar, and a menu of what it can do there, in plain verbs. In Mail: Draft a reply and Find a time. In the calendar: Prepare for this meeting. In a meeting: Suggest what to ask while it records, Write the summary, Clean up the transcript, Work out who said each line, Ask about this meeting and Make a deck. In Studio: a document's Rewrite, Shorten and Fix spelling and grammar for the words picked, a sheet's Write a formula and Make a chart (and an empty one's Make a sheet), a deck's Write the deck and Rewrite this slide, and a PDF's Sign this. In an agent's Files and Studio's folders: Look over this folder. On a whiteboard: Draw this and Change it. Each says which model it uses and what goes to it, and shows you what it wrote before anything changes. Handing work to a coding agent (Ask an agent, Start an agent) is separate.
- **Home**: what needs you on every computer, answered right there, then what's ready to look at and what's coming up, with Everything a click away: the first row of the sidebar, and the phone's first tab. Bridge AI opens where you were (starting again after a restart or an update, a reload, switching to another computer and back) and never puts Home over it; Home is where it starts when there's nowhere to go back to: a new install, a computer's window shown for the first time, the phone app's first open, or a place that's gone since (a closed agent, a deleted meeting or file). Settings › You › Home turns it off.
- **New**: in the sidebar, or the phone's Agents tab. One message box, "What should we build in shop?", where the project's name is the picker. Chips on the box pick the agent or any model, how much it may do without asking (**Ask first**, **Edit freely**, **Full access**) and, in a git project, this folder or its own branch. Enter starts it. **or start without a project** makes it a chat, and **More options** is the full New agent dialog (cloud agents, two agents side by side, an account, the space).
- **Sidebar**: **New**, **Chief of Staff**, **Meetings** and **Studio** at the top, then spaces and tabs with each agent's status, folder and git branch. Drag to reorder, double-click to rename. Once you've dictated, Meetings has two tabs at its top, **Meetings** and **Dictations** (everything you've said with the dictation key, where it went, to find, copy or send again).
- **Tabs**: open any agent as a tab, drag tabs to reorder, put two side by side. The tabs are grouped as the sidebar has them: each space's together after a chip in its color, your other computers' agents at the end under each computer's name; click a chip to fold its group away, right-click it for the rest. Your own groups and pinned tabs, as in Chrome, from a tab's right-click menu.
- **Back and Forward**: ‹ and › at the start of the top bar go back and forward through where you've been in the window, as in a browser: each view and tab and what it showed, a section of Settings, Today full size. So do ⌘[ and ⌘] on a Mac (Alt+← and Alt+→ on Windows and Linux) and the mouse's back and forward buttons; hold or right-click ‹ or › to pick a place.
- **Own branch** (optional, per repo): start an agent on a new branch in its own git worktree, kept in `~/.bridge-ai/worktrees`, with the ignored files listed in `.worktreeinclude` (like `.env`) copied in and your setup command (like `npm install`) run first. Closing it removes the folder only if nothing would be lost; the branch stays.
- **Each agent** has Chat (its transcript), Terminal (a live mirror you can type in; scroll to the top to read further back, up to 20,000 lines), Files (a browser with syntax highlighting and markdown, where videos and sounds play in place, PDFs and pictures show, and anything else downloads, with its progress) and Changes (git status and diffs). A video on another of your computers, or watched from your phone, plays as it comes, a part at a time over the same encrypted link, so a long one starts in a few seconds and seeks anywhere without being downloaded first. **Copy to this computer** and **Send to…** (or a file dragged from one device's Files into another's) copy a file or a folder between your computers over that link, into the folder you pick there (its Downloads, an agent's folder, or a place): with its progress, carrying on where it stopped if the connection drops, and checked (size and SHA-256) before it takes its name, which gets a number if it's taken. From a phone, **Send files from this device** puts photos and videos into the project you're looking at. **Places** are other folders you add to Files with the folder picker; nothing outside them and your agents' folders is looked at, except what you open in **Studio**.
- **Studio** (sidebar or `⌘K`; on a phone, More): every file on this computer and your other computers, and the place to edit documents, sheets, decks, PDFs and pages, by you or your agents, with every version kept, and your whiteboards. Its home is your files as Finder shows them: in its sidebar, Studio's own lists first (**Recent**, each kind of document, your design packs and signatures, and **Shared**, your Share Links), then your usual folders, cloud drives, projects, places and drives and your other computers; a folder as a list, icons or columns, Quick Look, Get Info and a search, with AI Assist's Look over this folder beside it (duplicates, big and forgotten files, a tidier layout). A document opens in Studio's editor, anything else in Quick Look (or its own app on this computer). **New** makes a document, sheet, deck, page or whiteboard, in the folder you're in or one you pick. Your folders are read only for now: nothing is renamed, moved or deleted from there. **Comments** on a Word file's words, an Excel file's cells, a PowerPoint's slides and a whiteboard's shapes are kept in the file itself, so Word, Excel and PowerPoint show them too; **@bridge** in one asks AI Assist, which answers in the thread, and a change it makes is a suggestion to keep or discard. **Make a sheet**: say what a new sheet is for (New › Sheet, or on an empty sheet) and AI Assist writes the workbook, its formulas, formats and dropdowns, shown to keep or discard. **Sign this** (AI Assist on a PDF) says what it is in plain words, then puts the signature you drew where it goes (or Sign everywhere it asks), in a signed copy in a `_signed` folder beside it. Keep several signatures and initials, named, one of each the default; draw them with the mouse or a pen, on a Mac's trackpad (as Preview does), or on your phone (Sign on Phone). They're kept encrypted on your computer. **Ask Before Signing** (Settings › Studio) asks for Touch ID, your Mac's password, Windows Hello or a signing PIN before a copy is signed, and each signing is in the document's versions.
- **Effort, with Recommended Settings**: once Claude Code is signed in, Settings › Agents & Models › Agents says the model and effort that suit your plan (Pro, Max, Team or an API key), with Use these or Keep Claude Code's defaults. New and Home's box have an effort chip for each task, suggested from what you ask, and an agent Chief of Staff starts gets an effort suggested from its brief. Claude Code's own settings are left as they are.
- **New terminal**: the terminal button at the top of the spaces, ⌘K › New terminal, or a space's menu › **New terminal here** opens a plain terminal you type straight into (`brew upgrade`, a dev server, anything you'd run yourself), on whichever machine the window is showing.
- **Review and ship**: in Changes, click lines of a diff to comment and send all your comments to the agent as one message; commit and push, and open a GitHub pull request (with `gh`) drafted from your commits, then watch its checks there.
- **Message box**: `@` to reference files and folders, `/` for slash commands, ↑ for earlier messages, voice notes (Parakeet, on your computer) and attachments. Messages to a busy agent are queued and sent when it's free.
- **Questions and approvals** from an agent show as cards you can click. That includes the questions Codex asks while it keeps working: the agent shows as needing you, and the card stays until you answer, even after Codex's own screen has dropped the question at the end of its turn.
- **What each reply changed**: "Changed 3 files" under a reply opens its own diff per file. With Claude Code, **Undo this reply** puts the files and the chat back to just before your message, without sending anything.
- **What runs in the background** shows live above the message box: the subagents Claude Code starts, the shells it and they leave running (open one for its latest output) and its monitors' news.
- **Consult other models**: the chief of staff (or you, with `node ~/.bridge-ai/chief/bin/bridge ask`) can put a one-off question to Grok, GPT, Claude, Gemini, Muse Spark, Perplexity, DeepSeek, a local Ollama model and others, for a second opinion, live news, or a very long document. It uses each agent's CLI and your existing subscription where it can, and an API key from Model Providers otherwise. Settings › Agents & Models › Agents shows who is reachable and how.
- **Plain chats**: talk to Claude, Codex or any agent directly, like its own app, with no project folder, or to any model you have with **Any model** (see Agents). New › or start without a project, New chat in `⌘K`, or New agent › Plain chat.
- **Several accounts**: as many Claude (or Codex) accounts as you like, running side by side, in one plain list. Your usual login is one of them ("Your usual login" until you rename it), and every other one has the name you give it (Work, Personal). **Add another account** is in the usage chip's menu in the top bar, in Usage, in New agent's Account row and in `⌘K`: name it, sign in right there (the agent's own login, for that account only), then start an agent on it. Each account has **Make default**, **Sign in** (again), **Sign out** and **Remove**, in Usage and in Settings › Agents & Models › Model Providers › Accounts. New agents start on your default, which has a star, or with **Auto** on, on the one with the most left. Removing your usual login only takes it off Bridge AI's list (the agent keeps it for the terminal, and Settings can show it again); the last account always stays. When two rows turn out to be the same account, Usage offers to remove the extra one. Each agent shows the account it's on and keeps it when you fork or reopen it. The model button in the message box shows the account beside the model, and its menu continues the conversation on another account the way it switches models. An account keeps only its own login; settings, skills and history stay shared.
- **Hand off to another agent**: the model chip in the message box also lists your other installed agents and whether each is signed in. Pick one (Claude Code to Codex, say) and it starts in the same folder, on the same branch or worktree, on the account and model you choose. Agents can't open each other's conversations, so it starts with a handover Bridge AI builds from the transcript and git: your goal, the recent messages, changed files, where it stopped and what's still open (or, if you ask, the old agent's own summary). You can read it before it goes. The old agent goes to Closed agents unless you keep it open too. In the chief of staff's chat, the same menu switches the agent the chief runs on.
- **Chief of Staff**: tell it what you need. It answers quick questions and coordinates; anything that takes longer, or is a piece of work of its own (a presentation, some research, a long draft, a change to a project), it hands to a **helper**: an agent of its own with a role it picks (marketing, research, engineer), working in that task's own folder or in the project. Independent pieces run in parallel, three helpers at once unless you change it in Settings › Agents & Models › Agents › Advanced; the rest wait their turn and start as one finishes. When a helper stops, Bridge AI tells the chief of staff what it said last and the files it made, on any agent, and it checks the work and tells you. Follow-ups go to the agent already on that work. It writes only in its own `work/` folder and never edits your projects; helpers ask before changing files, as agents do, unless you let them edit in their own work folder. Its tasks are in a Tasks panel above its message box: add one there to send it to the chief, mark one done or reopen it, and open what a finished task produced. **Board** there, the Tasks tab on its header, or the board button by its row in the sidebar shows them all as a board: Queued, Working, Needs you and Done, each card with its helper's role, what it's doing now and for how long; a card opens its helper, a finished one has what it said and its file, and one that couldn't start says why, with Try again. On a phone the board shows one column at a time. The morning brief mentions its open tasks. It learns where work lives and how you like things done, in a playbook you can read and edit.
- **Long sessions tidied while you're idle**: a session of Chief of Staff's, a helper's or a bot's in Claude Code that's past about 100,000 tokens is compacted once it has been idle for 15 minutes, keeping your asks, your standing rules and where the work is, rather than by Claude Code itself in the middle of an answer, which holds that answer up for a minute or more. Never while it's working or something is typed in its box. Its chat says each time, with how big it was (a bot's, its record), and why when it wasn't. Settings › Agents & Models › Agents › Tidy Long Sessions While Idle turns it off.
- **Threads with the chief of staff**: keep separate topics apart. **New thread** in the bar at the top of its chat starts another conversation with it, named for its topic (Q4 launch, hiring), with Main as the first. Threads run at the same time and share the chief's playbook, ledger and task list. Each thread lists the agents it handed work to, with their status, so you can see which work came from which conversation; tap one to open it. Close a thread there too (its conversation goes to Closed agents).
- **Whiteboards** (in Studio: its Files lists them under Whiteboards, and New makes one; or `⌘K`): an Excalidraw whiteboard for shapes, arrows, text, pictures pasted in and drawing by hand, saved as a `.excalidraw` file in `~/.bridge-ai/boards` a moment after each change, with Export as PNG or SVG. **AI Assist › Draw this** turns a description (typed, or said with the dictation key), a meeting, a project or an agent's work into a flowchart, an architecture, a sequence or an org chart made of shapes you can move and edit, not a picture; **Change it** changes the board, or what's selected, in place, and undo takes it back. It uses the model meeting notes use (your sign-in to an agent, a key, or a model on your computer) or the one you pick, and says before you draw what goes to it; nothing else leaves the computer, and the whiteboard itself loads nothing from the internet. Diagram files agents write (`.excalidraw`, Mermaid `.mmd`, draw.io `.drawio`) open as boards in Files and from the chat, and Mermaid in Markdown or a reply has **Open as a whiteboard**. The chief of staff makes and updates boards with `bridge board`.
- **Help**: `⌘K` › Help (on a phone, More › Help) opens Bridge AI's manual, made from this README and every setting with where it is, and checked at each release, with a search; a question typed in `⌘K` offers the parts that answer it. Chief of Staff, the Claude Code agents you start and your bots answer "how do I…" from the same manual.
- **Today**: schedule, inbox ranking, morning brief, routines, ideas, usage and quota, insights, weather, markets and news.
- **Scheduled Routines**: a routine with a time ("every weekday at 9") runs by itself then, on its computer, each run's result kept; one with no time only reminds you when it's due. **Make a routine** from any message you sent, and History › Commands keeps what you asked, on your computer, with a routine suggested when you ask the same thing on a schedule. On unless you turn it off in Settings › Agents & Models › Agents.
- **Insights**: the last 30 days across every agent and every account: sessions, hours, the time agents waited on you, and the split by agent, by account and by project. The numbers come from Claude Code's and Codex's own logs (every account of each shares them) and from Bridge AI's record of the other agents it ran, so they cost nothing. **Write insights** has one of your agents, or an API key, read a summary of those sessions and write up what's working, what's in your way and what to try next; pick which one writes it. If you've run Claude Code's own /insights, its report is linked too.
- **Usage**: tokens and cost per day, model and project, with a year heatmap (from your agents' local logs via ccusage), for Claude Code and Codex together (**All**) or one at a time. Every account is counted, and **By account** shows each one's share of the last 30 days, unused ones too.
- **Share Links** (a beta feature: off until it's turned on in Settings › About & Updates › Beta Features, or at the top of Settings › Devices & Access › Share Links): **Share Link…** on a file or folder in Files, on a Studio document, or on an agent's app in its Preview tab gives a link (and a QR code) for people outside your devices: anyone with it (with a password if you like), or only the people you name by email, each with a code sent to them first. A folder opens read-only (as a site, scripts and all, on Bridge AI's relay once it has its share domain; with nothing in it run on a relay of your own, which shares no sites or apps); a Studio document always shows its latest; an app can be used, buttons included. It goes through your relay, end-to-end encrypted, lasts an hour, a day or a week, and works while this computer is on. Settings › Devices & Access › Share Links lists each link, who opened it, and Stop Sharing. Turned off, no new link is made (nor offered, a bot's included), and the links already made keep working until they end or you stop them.
- **Phone**: the same app on your phone, as a Home Screen app with notifications. See On your phone.
- **Appearance**: Slack-style themes that color the window frame, light and dark modes, and custom colors you can share as a string.
- **Your language**: Bridge AI in English, Español, Français, Deutsch, Português (Brasil), 日本語, 简体中文 or हिन्दी, or whatever your computer is set to (Settings › You › Language). The main screens are translated: the sidebar, top bar, the Agents panel, Settings' sections, New agent, the message box, Chat, Meetings, Today, setup and the error screen, and dates follow the language. The rest is in English for now. Agents and their answers aren't affected.

## Desktop app

`desktop/` wraps Bridge AI in an app window with a badge for agents that need you, notifications, and a global shortcut (`Alt+Cmd+A` on macOS, `Alt+Ctrl+A` elsewhere; change it with `desktop.shortcut` in config).

```bash
npm run desktop          # run it from your clone
npm run desktop:dev      # same, with hot reload
npm run desktop:dist     # build an installer to share
```

## On your phone

Bridge AI works on your phone as an app on the Home Screen, with notifications when an agent needs you or finishes. It's the same app, served by your computer, so you don't need an app store; there are also iPhone and Android apps that add a lock-screen card and a demo (the Android one is a download). There are two ways to reach your computer; both are optional, and Bridge AI works the same on the computer without either.

### From anywhere, through Bridge AI's relay

The quickest way: a relay the project runs at boldbridge.app, so you need no Cloudflare account. It comes with a Bold Bridge account, by request.

1. In Bridge AI, open **Settings › Devices & Access**. On its Account tab, type your email, then the 6-digit code it's sent: that's your Bold Bridge account. Click **Request access** under Bridge AI's Relay. (Or on the Phone tab, where Bridge AI's relay is picked: your email and code there, and the relay is asked for by itself.)
2. Bold Bridge emails you when it's on. A computer with nothing else set up for your phone starts using it by itself and says so; otherwise click **Use it on this computer** on the Account tab. It's set up right there, saying how it goes, and then shows **On for this computer** with the pairing code.
3. Scan the QR code with the Bridge AI app on your phone (**Pair a phone** makes another).

A computer on a relay of your own moves to it with **Use Bridge AI's relay instead**, and back with **Change how your phone connects**. Its phones and linked computers stay paired and follow it: the ones connected then are told the new address at once, and the computer stays at the old address for two weeks to tell the rest (an iPhone moves by itself; a browser or the Android app pairs there with one tap). A browser's page left at the old address, opened again, says where the computer went, with **Open it there** and **Pair again**. **Stop using the relay** isn't needed for a move: it forgets every paired phone and gives the computer a new key. The Account tab also lists your other computers and which relay each uses; each moves in its own Bridge AI.

Everything between the phone and the computer is end-to-end encrypted, as on a relay of your own. The relay sees the IP addresses of your phone and computer, and when and how much data passes. With the iPhone or Android app it can't read the rest; in a phone's browser the page comes from the relay, so use the apps. Your account has an allowance of messages every 8 hours and each week (Settings › Account & Backup › Account shows it), and the relay takes a limited number of accounts, so it can be full. PRIVACY.md says what it keeps, and relay/HOSTED.md how it's run. A second computer signed in with the same email is on the same account.

### From anywhere, through your own relay

A small relay runs on your own free Cloudflare account. Bridge AI keeps one outgoing connection to it, and your phone reaches your computer through it. There's no VPN to keep connected, nothing to install on the phone, and no port opened on the computer.

1. In Bridge AI, open **Settings › Devices & Access › Phone** and click **Sign in with Cloudflare** (or use an API token made with Cloudflare's "Edit Cloudflare Workers" template). Bridge AI deploys the relay to your account. Its sign-in is kept apart from any other Cloudflare tools you use. Signing in this way needs Node.js; on a computer without it, **Install Node.js** puts the official version from nodejs.org in Bridge AI's own folder, with no password, and signs you in right after.
2. Click **Pair a device** and scan the QR code with the phone's camera (or open the relay's address and type the code).
3. Add it to the Home Screen: iPhone, Share › **Add to Home Screen**; Android, ⋮ › **Install app**. Open it from there, and type the code again if it asks.
4. In Bridge AI on the phone, go to **Settings › Notifications** and click **Turn on notifications**.

Everything between the phone and the computer is end-to-end encrypted: each paired phone has its own key, kept on the phone, and each connection makes fresh keys. The relay, and Cloudflare, see when and how much, never what. That holds as long as the page doing the encrypting is Bridge AI's own: the iPhone and Android apps carry their own copy; in a phone's browser the page comes from the relay, which here is yours. It stores when your computer was last online, and messages waiting for your computer (below), sealed so it can't read them. Remove a phone in Settings and it's out. A phone can't pair other phones or change the relay; that's done on the computer.

Your computer has to be on and Bridge AI running. **Keep this computer awake while it's plugged in** (macOS and Linux) stops it sleeping. When it's off or asleep, the phone shows what it last sent (your agents, recent chats, usage, the brief) under a banner saying so. A message you send an agent then, or an answer to its question, waits in your relay, sealed for your computer, and goes through when the computer is back, even if you've closed the phone by then; it says "Waiting for your computer", then "Delivered". Anything else needs the computer on. Messages wait 7 days at most. The free Cloudflare plan is plenty for one person; if it's ever used up, Cloudflare stops serving until the next day rather than charging you.

### Through Tailscale

If you already use [Tailscale](https://tailscale.com), a free private network between your own devices:

1. On the computer: install Tailscale and sign in. In Bridge AI, open **Settings › Devices & Access › Phone** and click **Turn on phone access**. It shows a QR code.
2. On the phone: install Tailscale and sign in with the same account. Scan the QR code with the camera. It lets that phone in, as View › Open in Browser lets in a browser on the computer: each code works once, within two minutes, and a new one shows every minute.
3. Add it to the Home Screen and turn on notifications, as above.

Only devices signed in to your Tailscale account can reach Bridge AI, and only a phone let in with a code gets in; nothing is opened to the internet.

Either way, choose what you're notified about in Settings › Notifications: an agent needs you, an agent finished, and usage running low (5 to 25% left). Notifications are encrypted end to end to your phone. iPhone needs iOS 16.4 or later for notifications.

- **What it's asking**: a "needs you" notification shows the agent's question or permission request, and tapping it opens that agent at its question.
- **Answer buttons**: on Android and in Chrome on a computer (not iPhone), a yes or no question, or one with two short choices, gets buttons that answer it without opening the app. Each works once, for 10 minutes, and only if the agent is still asking that same question; otherwise Bridge AI opens. Turn them off in Settings › Notifications.
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

Install Bridge AI as above. In **Settings › Devices & Access** set up the relay, pair your phone and turn on **Keep this computer awake while it's plugged in**. Turn on **Open at Login** in the Bridge AI menu, and in System Settings turn on **Start up automatically after a power failure** (Energy) and automatic login (Users & Groups), so it comes back by itself after a power cut.

### Linux, a Raspberry Pi or a cloud server: Docker

[Install Docker](https://docs.docker.com/engine/install/), then:

```bash
mkdir bridge-ai && cd bridge-ai
curl -fsSLO https://raw.githubusercontent.com/sahil1/bridge/main/docker-compose.yml
docker compose up -d
docker compose exec bridge bridge-ai relay setup   # once: your relay, with a Cloudflare API token
docker compose exec bridge bridge-ai pair          # shows a QR code: scan it with your phone
```

`relay setup` asks for a Cloudflare API token. Make one at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens): **Create Token**, then the **Edit Cloudflare Workers** template, or a custom token with only **Account › Workers Scripts › Edit** and **Account › Account Settings › Read**, for your account. Bridge AI keeps it in its data folder (readable only by you) to update the relay later. `pair` prints the QR code, the link and the code to type; then finish on the phone as in On your phone.

- **What's in it**: Node, git, `gh` and Bridge AI's server, for 64-bit Intel/AMD and Arm. It runs as a normal user, not root.
- **What's kept**: three volumes. Your home folder in the container (every agent's sign-in, git and SSH settings, agents you install), Bridge AI's data folder, and `~/code` for your repos.
- **Restarts**: after a crash or a reboot it starts again and reconnects to the relay. `docker compose exec bridge bridge-ai status` shows how it's doing.
- **Updates**: `docker compose pull && docker compose up -d`.
- **No open port**: your phone comes in through the relay. For a browser on that device or over `ssh -L 7420:127.0.0.1:7420`, see the comments in docker-compose.yml; the port stays on 127.0.0.1.

Without Docker, the server runs on its own too: clone the repo, `npm link`, then `bridge-ai start` (the same as `npm start`, no app window). The commands above work the same way (`bridge-ai relay setup`, `bridge-ai pair`, `bridge-ai status`).

### Signing in to your agents

Install agents in **Settings › Agents & Models › Agents** (from your phone is fine), or with `docker compose exec bridge npm install -g @anthropic-ai/claude-code @openai/codex`. They go in your home folder, so they stay through image updates and can update themselves. You can also bake them into your own build of the image: see the `AGENTS` setting in the Dockerfile.

The device has no browser, so a sign-in shows a link that you open on your phone or laptop. On the phone, **Settings › Agents & Models › Model Providers › Sign in** next to an agent runs its sign-in in a terminal tab you can type in. From a laptop, SSH to the device and use `docker compose exec -it bridge bash`.

- **Claude Code**: `claude auth login` (or `/login` in Claude Code) shows a link. Sign in there, then paste the code the page shows at **Paste code here if prompted**. Or, with a Claude subscription, run `claude setup-token` on any computer with a browser and put the token it prints in docker-compose.yml as `CLAUDE_CODE_OAUTH_TOKEN` under `environment`. An `ANTHROPIC_API_KEY` works too. ([Claude Code docs](https://code.claude.com/docs/en/authentication))
- **Codex**: `codex login --device-auth` shows a link and a one-time code to enter there (Bridge AI's Sign in button uses it on a device with no desktop). Turn on device code login in your ChatGPT security settings first; for a workspace, an admin does. Or use an API key: `printenv OPENAI_API_KEY | codex login --with-api-key`. ([Codex docs](https://developers.openai.com/codex/auth))

### Getting your code there

Put repos in `~/code`: agents start in folders inside the home folder. In a terminal on the device (`docker compose exec -it bridge bash`), set your name for commits once (`git config --global user.name "Your Name"` and `user.email`), then either:

- **GitHub CLI**, for all your repos (and pull requests from Bridge AI): `gh auth login`, pick GitHub.com, HTTPS and "Login with a web browser", and open the link it shows on your phone with the one-time code. Then `gh repo clone you/your-repo ~/code/your-repo`.
- **A deploy key**, for one repo and nothing else: `ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519`, add `~/.ssh/id_ed25519.pub` in the repo's **Settings › Deploy keys** (tick **Allow write access** so agents can push), then `git clone git@github.com:you/your-repo.git ~/code/your-repo`.

## Security

- The server listens on `127.0.0.1` only. It answers requests whose Host is this device or a Tailscale name and, from a browser, whose Origin is too, so other web pages can't drive your agents through localhost.
- In Docker it runs as a normal user and publishes no port. If you publish one for a browser, bind it to 127.0.0.1 as docker-compose.yml shows, never to the network.
- File and git actions stay inside the agent's folder. They change things only when you ask from the app: saving a file, undoing a change, committing, pushing (never forced) or opening a pull request.
- Anyone who can reach the server can type into your agents. Phone access uses your own relay, which only lets in phones you paired (end-to-end encrypted), or `tailscale serve`, which only devices on your tailnet can reach. Never expose Bridge AI with `tailscale funnel` or a public port.
- Mail and meeting agents are told that email text is data, not instructions, and never to send or post without your OK.

## Optional setup

Each of these shows up where it's needed, with one button that does it. Installs run in a terminal tab you can watch (in the Setup space), and the screen picks up by itself once it's done.

- **All of it at once**: setup's first step recommends Just what agents need (Node.js, which asks for nothing); Everything, there or in Settings › Your Features › Set up, does the rest in the background while you carry on: Node.js first (an agent's Install says it's waiting for it, with how far it is), then the speech model, and on a Mac Apple's command line developer tools when they aren't there (about 1 GB from Apple, so git works without macOS stopping to ask), Homebrew when what it brings is needed, and what macOS asks you to allow. The programs install in one terminal tab (`scripts/setup-mac.sh`) that asks for your Mac's password once, at its start; setup shows that terminal in place, so you type it there. Once setup is closed, the top bar says "Setting up · 3 of 6", or that it needs you, until it's done.
- **Signing in to your agents**: Bridge AI's first-run setup offers Install and Sign in for Claude Code and Codex, and Sign in for any other agent it finds. An agent still on its own first-run screens (look, sign-in, trusting its folder) shows them as a card in its chat. Settings › Agents & Models › Agents and the Usage card have Sign in too.
- **Voice notes**: tap the mic in the message box, on the computer or your phone, and talk. The first time, Bridge AI says the speech model is a one-time download (Parakeet, 670 MB, to `~/.bridge-ai/models`) and one click downloads it, then turns what you said into text. Nothing to install, on any computer, and no password. On macOS 26, the Mac's own speech answers while it downloads. Speech is turned into text on your computer; audio never leaves it. Settings › Meetings & Voice › Speech Models has the other models (Parakeet English, and Whisper for other languages) and removes a download. If macOS has the microphone off for the app, the mic offers Allow access.
- **Meeting notes**: they use the same speech model (Settings › Meetings & Voice), downloaded when your first meeting starts if it isn't here yet, or a service you pick there. For the call's sound, macOS asks to allow System Audio Recording the first time you record.
- **Inbox (macOS)**: Mail needs your account and one sync (the Inbox card's Open Mail), and Bridge AI needs Full Disk Access (Allow access). In the desktop app, Allow access opens System Settings with a tile beside it: drag Bridge AI from the tile into the list and turn it on. Restart to apply then appears at the top, for whenever it suits you.
- **Calendar (macOS)**: Install icalBuddy in the Calendar card (it offers Homebrew first when it's missing), then Allow access for Calendars when macOS asks.
- **Pull requests**: the Changes tab offers to install GitHub's `gh` and sign it in. On a Mac without Apple's developer tools, it offers those for git.
- **Agents' folders in Desktop or Documents**: if macOS was told no, the Files tab and New agent offer Allow access (Files & Folders).
- **Permissions**: every Allow access works the same way. macOS's own question comes first where it has one (the microphone, Accessibility, Calendars, Automation); System Settings opens, with the tile beside it, only when it has none (Full Disk Access) or already said no. Bridge AI notices by itself once it's on and carries on with what was waiting. If it's still off a moment after you turned it on (an answer kept from an older version of the app, or a switch that doesn't take), **Reset and ask again** forgets macOS's answer for Bridge AI only, with no password, and asks again. Settings › You › Permissions lists what Bridge AI may use on this computer, whether each is on, and one button; on a phone or another of your devices it shows that computer's, and **Ask** has that computer show its own question.
- **Plan usage**: off until you turn it on (the Usage card, or Settings › Agents & Models › Agents). It asks each provider how much of your plan is left, with the sign-in your agents use on this computer, through [quota-axi](https://www.npmjs.com/package/quota-axi). Some providers, Anthropic among them, don't allow other apps to use their sign-ins, so it's your call. For Claude, macOS asks once for Keychain access (the Usage card's Allow).
- **Weather**: the Weather card asks for your city when it doesn't know it.

Testing these without changing anything on your Mac: `BRIDGE_FIX_DRYRUN=1` makes Bridge AI log what it would open in System Settings instead of opening it, and `BRIDGE_PATH` (a list of folders) makes it look for agents only there, never in your login shell's PATH or Homebrew's folders.

## License, terms and privacy

Apache-2.0. See NOTICE.

Bridge AI is provided as is, with no warranty, and you're responsible for what your agents do and for following the terms of the services you connect. It's an independent project, not affiliated with or endorsed by Anthropic, OpenAI, Google, GitHub, Cursor, Cloudflare or any other company whose tools it works with; their names and logos belong to them. The project collects nothing that identifies you: the app sends it anonymous usage stats and crash reports, on unless you turn them off in Settings › About & Updates.

## Settings

Settings opens with ⌘, (Ctrl+, on Windows and Linux), or from ⌘K (Ctrl+K), where typing a setting's name finds it and opens Settings at it. It opens on Your Features. On a phone it's a list of its sections, each opening full width.
Each section below says what it's for, then each setting in it, with where it is and the words it's found by. Most sections show what people change first, with the rest under Advanced at its end.

### Your Features

Each feature at a glance: on or off, how it's doing, and where to change it.

- [Set up](#setting-setup): Settings › Your Features › Set up. Found by: setup install node homebrew developer tools speech model calendar mail full disk.

### You

Your name and place, and how Bridge AI looks.

- [Your name](#setting-name): Settings › You › Your name. Found by: first name call me morning brief.
- [Location](#setting-location): Settings › You › Location. Found by: city weather morning brief place where.
- [Layout](#setting-layout): Settings › You › Layout. Found by: simple everything panels today board.
- [Home](#setting-home): Settings › You › Home. Found by: home where bridge ai opens needs you start page open where you were.
- [Enter Key](#setting-enter-key): Settings › You › Enter Key. Found by: enter return key send new line line break message box smart command ctrl shift typing.
- [Color Mode](#setting-color-mode): Settings › You › Color Mode. Found by: dark light system mode appearance.
- [Theme](#setting-theme): Settings › You › Theme. Found by: theme colors accent frame appearance.
- [Text Size](#setting-text-size): Settings › You › Text Size. Found by: text size zoom bigger smaller.
- [Language](#setting-language): Settings › You › Language. Found by: language translate.
- [Density](#setting-density): Settings › You › Density. Found by: compact comfortable.
- [Font](#setting-font): Settings › You › Font. Found by: font typeface.
- [Share a Theme](#setting-share-theme): Settings › You › Share a Theme. Found by: copy paste theme.
- [In the Top Bar](#setting-topbar): Settings › You › In the Top Bar. In a wide window (the desktop's top bar). Found by: pin unpin top bar status weather clock usage sounds.
- [Permissions](#setting-permissions): Settings › You › Permissions. Found by: allow access microphone accessibility calendars full disk files automation notifications privacy macos.

### Agents & Models

Your agents, model providers, which model does what, and MCP servers.

Its Agents tab:

- [Default agent](#setting-default-agent): Settings › Agents & Models › Agents › Default agent. Found by: claude codex gemini new agents chats routines.
- [Default model](#setting-default-model): Settings › Agents & Models › Agents › Default model. Found by: model opus sonnet gpt flag.
- [Pick up unfinished work after an update, a crash or a restart](#setting-resume-work): Settings › Agents & Models › Agents › Pick up unfinished work after an update, a crash or a restart. Found by: resume continue crash restart update.
- [Chief of Staff runs on](#setting-chief): Settings › Agents & Models › Agents › Chief of Staff runs on. Found by: chief of staff agent.
- [Helpers at once](#setting-chief-helpers): Settings › Agents & Models › Agents › Helpers at once. Found by: chief of staff helpers delegate parallel queue queued at once.
- [Helpers may edit in their own work folder](#setting-chief-helpers-edit): Settings › Agents & Models › Agents › Helpers may edit in their own work folder. Found by: chief of staff helpers edit permission ask work folder.
- [Hand on action items when a meeting ends](#setting-chief-meeting-items): Settings › Agents & Models › Agents › Hand on action items when a meeting ends. Found by: chief of staff meeting meetings action items hand on by itself automatically helpers agents to do.
- [Tidy Long Sessions While Idle](#setting-tidy-sessions): Settings › Agents & Models › Agents › Tidy Long Sessions While Idle. Found by: compact compaction long session context tokens stall idle tidy chief of staff helpers bots summarize.
- [Scheduled Routines](#setting-scheduled-routines): Settings › Agents & Models › Agents › Scheduled Routines. Found by: routines schedule scheduled every weekday run by itself time history commands.
- [Your Chief of Staff can consult](#setting-consult): Settings › Agents & Models › Agents › Your Chief of Staff can consult. Found by: consult second opinion bridge ask models.
- [Install an agent](#setting-agent-list): Settings › Agents & Models › Agents › Install an agent. Found by: agents install sign in claude codex gemini copilot cursor opencode cli.
- [Plan usage](#setting-plan-usage): Settings › Agents & Models › Agents › Plan usage. Found by: quota limits read sign-in anthropic.
- [Command History](#setting-commands): Settings › Agents & Models › Agents › Command History. With Scheduled Routines on. Found by: history commands asked keep delete.
- [Terminal app](#setting-terminal): Settings › Agents & Models › Agents › Terminal app. Found by: open in terminal iterm ghostty warp attach.
- [Where agents run](#setting-runtime): Settings › Agents & Models › Agents › Where agents run. Found by: herdr built in runtime session.
- [Keep agents running when Bridge AI quits](#setting-keep-agents): Settings › Agents & Models › Agents › Keep agents running when Bridge AI quits. Found by: quit stop agents running.

Its Model Providers tab:

- [Usage Across Every Provider](#setting-beta-usage-everywhere): Settings › Agents & Models › Model Providers › Usage Across Every Provider. Found by: beta usage tokens cost every provider today.
- [API keys](#setting-providers-labs): Settings › Agents & Models › Model Providers › API keys. Found by: api key anthropic openai gemini xai grok mistral cohere perplexity meta.
- [Accounts](#setting-accounts): Settings › Agents & Models › Model Providers › Accounts. Found by: account switch work personal sign in login auto default.
- [Models on this computer](#setting-providers-local): Settings › Agents & Models › Model Providers › Models on this computer. Found by: local model ollama lm studio gemma offline download.
- [Cloud Agents](#setting-cloud): Settings › Agents & Models › Model Providers › Cloud Agents. Found by: cloud agents cursor copilot jules claude managed keys.
- [Clouds](#setting-providers-clouds): Settings › Agents & Models › Model Providers › Clouds. Found by: azure aws bedrock vertex google cloud.
- [Hosted open models](#setting-providers-hosted): Settings › Agents & Models › Model Providers › Hosted open models. Found by: openrouter groq together fireworks cerebras hugging face.
- [More Models](#setting-more-models): Settings › Agents & Models › Model Providers › More Models. Found by: show more models qwen code deepseek kimi glm.
- [Speech to text services](#setting-providers-speech): Settings › Agents & Models › Model Providers › Speech to text services. Found by: deepgram assemblyai elevenlabs speech transcription keys.

Its Which Model Does What tab:

- [Agents and the Chief of Staff](#setting-models-agents): Settings › Agents & Models › Which Model Does What › Agents and the Chief of Staff. Found by: which model default agent model chief of staff runs on.
- [Models for Each Task](#setting-model-jobs): Settings › Agents & Models › Which Model Does What › Models for Each Task. Found by: model task job meeting notes ai assist mail titles diagrams live fallback auto cloud first together groq openrouter fireworks cerebras hugging face.
- [Speech and Dictation](#setting-models-elsewhere): Settings › Agents & Models › Which Model Does What › Speech and Dictation. Found by: speech model parakeet whisper edit by voice tidy rewritten tidied.

Its MCP Servers tab:

- [Bridge AI as an MCP Server](#setting-mcp-server): Settings › Agents & Models › MCP Servers › Bridge AI as an MCP Server. Found by: mcp server claude desktop cursor codex boards files meeting summaries other apps.
- [MCP Servers](#setting-mcp-list): Settings › Agents & Models › MCP Servers. Found by: mcp servers tools add install playwright github browser.

### Meetings & Voice

Meetings, dictation, the speech models that listen and the voice that answers.

Its Meetings tab:

- [Live Meeting Board](#setting-beta-meeting-board): Settings › Meetings & Voice › Meetings › Live Meeting Board. Found by: beta live board whiteboard decisions timeline.
- [Answers in AI Assist](#setting-beta-assist-answers): Settings › Meetings & Voice › Meetings › Answers in AI Assist. Found by: beta answers questions perplexity web.
- [Speakers From the Call's Video](#setting-beta-call-video): Settings › Meetings & Voice › Meetings › Speakers From the Call's Video. On a Mac. Found by: beta video speakers faces mouth names.
- [Transcribe with](#setting-transcribe): Settings › Meetings & Voice › Meetings › Transcribe with. Found by: speech engine transcription service local apple.
- [Speech models](#setting-meetings-speech-model): Settings › Meetings & Voice › Meetings › Speech models. Found by: parakeet whisper download speech model.
- [Speech Services](#setting-speech-services): Settings › Meetings & Voice › Meetings › Speech Services. Found by: openai groq deepgram assemblyai elevenlabs gemini service.
- [Meeting language](#setting-meeting-language): Settings › Meetings & Voice › Meetings › Meeting language. Found by: language detect english spanish french.
- [Names and terms](#setting-names-terms): Settings › Meetings & Voice › Meetings › Names and terms. Found by: memory vocabulary words names spelling misheard.
- [Notes are written by](#setting-notes-model): Settings › Meetings & Voice › Meetings › Notes are written by. Found by: model summary notes automatic write summary.
- [Clean up the transcript when a meeting ends](#setting-transcript-cleanup): Settings › Meetings & Voice › Meetings › Clean up the transcript when a meeting ends. Found by: clean up fix misheard words transcript.
- [Name who spoke on the call](#setting-name-speakers): Settings › Meetings & Voice › Meetings › Name who spoke on the call. Found by: speakers names them who said.
- [Prepare for each meeting](#setting-prep): Settings › Meetings & Voice › Meetings › Prepare for each meeting. Found by: prepare prep goals questions mail invite calendar.
- [Keep a live board, in every meeting](#setting-meeting-board): Settings › Meetings & Voice › Meetings › Keep a live board, in every meeting. With the beta feature Live Meeting Board on (Settings › About & Updates › Beta Features). Found by: live board whiteboard every meeting.
- [Answers in AI Assist](#setting-assist-answers): Settings › Meetings & Voice › Meetings › Answers in AI Assist. With the beta feature Answers in AI Assist on (Settings › About & Updates › Beta Features). Found by: answers perplexity web questions.
- [Calls](#setting-calls): Settings › Meetings & Voice › Meetings › Calls. Found by: notice calls zoom meet teams record other side system audio stop.
- [Remind me before meetings](#setting-meeting-remind): Settings › Meetings & Voice › Meetings › Remind me before meetings. In the desktop app. Found by: remind reminder before meeting snooze later floating card join turn off.
- [Record the other side of calls](#setting-call-audio): Settings › Meetings & Voice › Meetings › Record the other side of calls. Found by: system audio zoom meet teams them.
- [Crop pictures of a call to what's shared](#setting-crop-shots): Settings › Meetings & Voice › Meetings › Crop pictures of a call to what's shared. Found by: crop pictures screenshots slide shared.
- [Meeting Insights](#setting-meeting-insights): Settings › Meetings & Voice › Meetings › Meeting Insights. Found by: insights time people talk share added up week series.
- [Save every meeting as Markdown](#setting-save-markdown): Settings › Meetings & Voice › Meetings › Save every meeting as Markdown. Found by: markdown obsidian save notes folder.
- [AI Assist in meetings](#setting-meeting-assist): Settings › Meetings & Voice › Meetings › AI Assist in meetings. Found by: ai assist suggest what to ask how often instructions summary.
- [Who Spoke](#setting-who-spoke): Settings › Meetings & Voice › Meetings › Who Spoke. Found by: speakers voices room learn my voice remember voices names from the call screen recording.
- [Mention a Meeting](#setting-mention-meeting): Settings › Meetings & Voice › Meetings › Mention a Meeting. Found by: mention meeting key @ message.
- [The floating card](#setting-float-card): Settings › Meetings & Voice › Meetings › The floating card. In the desktop app. Found by: floating card menu bar pause stop hover screenshot screen sharing recording hidden.
- [Save notes as Markdown](#setting-save-notes): Settings › Meetings & Voice › Meetings › Save notes as Markdown. Found by: folder subfolders file name pattern front matter yaml speakers obsidian granola.

Its Dictation tab:

- [Dictation](#setting-dictation): Settings › Meetings & Voice › Dictation. Found by: dictation key talk hold fn background paste where typing.
- [Cleanup and Mentions](#setting-dictation-more): Settings › Meetings & Voice › Dictation › Cleanup and Mentions. Found by: cleanup mentions dictation extras.
- [Edit by voice](#setting-edit-by-voice): Settings › Meetings & Voice › Dictation › Edit by voice. In the desktop app. Found by: rewrite selection voice edit.
- [Tidy what I say](#setting-tidy): Settings › Meetings & Voice › Dictation › Tidy what I say. In the desktop app. Found by: tidy cleanup filler um false starts model local.
- [Light cleanup](#setting-light-cleanup): Settings › Meetings & Voice › Dictation › Light cleanup. Found by: um uh capital full stop names.
- [Mention files by saying them](#setting-mention-files): Settings › Meetings & Voice › Dictation › Mention files by saying them. Found by: at file mention say.
- [Show the words as you talk](#setting-live-words): Settings › Meetings & Voice › Dictation › Show the words as you talk. Found by: live words as you talk.
- [Dictation History](#setting-dictation-history): Settings › Meetings & Voice › Dictation › Dictation History. Found by: history keep recordings delete dictations.

Its Speech Models tab:

- [Speech Model](#setting-speech-model): Settings › Meetings & Voice › Speech Models › Speech Model. Found by: speech to text model parakeet whisper transcribe download voice notes listening.
- [Whisper, for other languages](#setting-whisper): Settings › Meetings & Voice › Speech Models › Whisper, for other languages. Found by: whisper whisper.cpp languages.

Its Spoken Answers tab:

- [Spoken Answers](#setting-spoken-answers): Settings › Meetings & Voice › Spoken Answers. Found by: read aloud voice speed speak answers ask out loud speaking.

### Mail & Calendar

How You Write, and the hours AI Assist offers times in.

- [How You Write](#setting-how-you-write): Settings › Mail & Calendar › How You Write. Where Bridge AI reads Apple Mail (a Mac). Found by: tone voice profile replies drafts learn.
- [Learn it again now and then](#setting-mail-learn): Settings › Mail & Calendar › Learn it again now and then. Where Bridge AI reads Apple Mail (a Mac). Found by: learn how you write again weekly profile.
- [Find a Time](#setting-find-a-time): Settings › Mail & Calendar › Find a Time. Where Bridge AI reads Apple Mail (a Mac). Found by: working days hours schedule meeting times calendar.
- [Kept clear around meetings](#setting-find-a-time-more): Settings › Mail & Calendar › Kept clear around meetings. Where Bridge AI reads Apple Mail (a Mac). Found by: buffer travel how many times offer.
- [Read-Only](#setting-mail-read-only): Settings › Mail & Calendar › Read-Only. Where Bridge AI reads Apple Mail (a Mac). Found by: mail never changes send.

### Studio

Your signatures and initials, and Ask Before Signing.

- [Your Signatures](#setting-signatures): Settings › Studio › Your Signatures. Found by: signature signatures initials sign pdf draw trackpad phone default studio.
- [Ask Before Signing](#setting-ask-before-signing): Settings › Studio › Ask Before Signing. Found by: touch id password pin windows hello confirm sign signing signature security studio.

### Bots

Turned on here, then made and run in Bots, in the sidebar.

A beta feature: its switch is at the top of this section, and nothing of it shows until it's on.

- [Bots](#setting-bots-beta): Settings › Bots. Found by: beta bots slack discord teams bot.
- [Open Bots](#setting-bots-open): Settings › Bots › Open Bots. Found by: bots connections who can ask instructions reads from answers limits channels scheduled posts export activity memory pause tokens socket mode manifest.
- [Set up a bot](#setting-beta-bots-start): Settings › Bots › Set up a bot. With the beta feature Bots on (Settings › About & Updates › Beta Features). Found by: set up a bot first bot.

### Devices & Access

Your phone, your other computers, who may see this screen, and Share Links.

Its Phone tab:

- [From anywhere](#setting-relay): Settings › Devices & Access › Phone › From anywhere. Found by: relay phone cloudflare pair a device remote away.
- [Tailscale](#setting-tailscale): Settings › Devices & Access › Phone › Tailscale. Found by: tailscale phone access vpn.
- [Keep this computer awake while your phone can reach it](#setting-keep-awake): Settings › Devices & Access › Phone › Keep this computer awake while your phone can reach it. Found by: awake sleep lid.
- [AI Providers](#setting-ai-providers): Settings › Devices & Access › Phone › AI Providers. Found by: ai providers consent allow allowed privacy anthropic openai google send sent phone permission take back revoke.

Its Computers tab:

- [Your Devices](#setting-machines): Settings › Devices & Access › Computers › Your Devices. Found by: devices computers other computers.
- [Link a device](#setting-link-device): Settings › Devices & Access › Computers › Link a device. Found by: link pair computer address code.

Its Remote Access tab:

- [Remote Screen and Preview](#setting-beta-remote-screen): Settings › Devices & Access › Remote Access › Remote Screen and Preview. Found by: beta remote screen view control preview.
- [Which Devices May Connect](#setting-remote-devices): Settings › Devices & Access › Remote Access › Which Devices May Connect. Found by: which devices may connect allow untick keep out block phone computer kept out.
- [This Computer's Screen](#setting-remote-screen): Settings › Devices & Access › Remote Access › This Computer's Screen. With the beta feature Remote Screen and Preview on (Settings › About & Updates › Beta Features). Found by: screen viewing who is looking stop screen recording.
- [Remote Access](#setting-remote-access): Settings › Devices & Access › Remote Access. With the beta feature Remote Screen and Preview on (Settings › About & Updates › Beta Features). Found by: remote access password screen control lock locked out unlock.
- [Remote Access Password](#setting-remote-password): Settings › Devices & Access › Remote Access › Remote Access Password. With the beta feature Remote Screen and Preview on (Settings › About & Updates › Beta Features). Found by: password remote set change remove.
- [Let my other devices control this computer](#setting-remote-control): Settings › Devices & Access › Remote Access › Let my other devices control this computer. With the beta feature Remote Screen and Preview on (Settings › About & Updates › Beta Features). Found by: control mouse keyboard accessibility.
- [Ask Here First](#setting-remote-ask-first): Settings › Devices & Access › Remote Access › Ask Here First. With the beta feature Remote Screen and Preview on (Settings › About & Updates › Beta Features). Found by: ask here first allow deny.
- [Screen Activity](#setting-remote-sessions): Settings › Devices & Access › Remote Access › Screen Activity. With the beta feature Remote Screen and Preview on (Settings › About & Updates › Beta Features). Found by: screen activity record sessions who viewed controlled lockout denied.

Its Share Links tab:

- [Share Links](#setting-beta-share-links): Settings › Devices & Access › Share Links. Found by: beta share link sharing shared public url outside people file folder document app.
- [Links You Shared](#setting-shares): Settings › Devices & Access › Share Links › Links You Shared. With the beta feature Share Links on (Settings › About & Updates › Beta Features). Found by: share link sharing shared public url outside people password email code expire stop qr.

### Notifications

What you're told about, on which devices, and with what sound.

- [Notifications on this device](#setting-this-device): Settings › Notifications › Notifications on this device. Found by: notifications push turn on test.
- [What to notify about](#setting-notify): Settings › Notifications › What to notify about. Found by: notify needs you finished usage low.
- [Notification sounds](#setting-notify-sounds): Settings › Notifications › Notification sounds. Found by: sound sounds silent mute speaker.
- [Screen Sharing Notifications](#setting-remote-notify): Settings › Notifications › Screen Sharing Notifications. Found by: screen sharing notifications notify phone told stop block remote.
- [Answer buttons for simple questions (yes or no, or two short choices)](#setting-notify-more): Settings › Notifications › Answer buttons for simple questions (yes or no, or two short choices). Found by: answer buttons phone at computer muted unmute.
- [Devices getting notifications](#setting-notify-devices): Settings › Notifications › Devices getting notifications. Found by: devices notifications remove.

### Account & Backup

Called Back Up & Move until Bold Bridge accounts are on: its Account tab is theirs.

Your Bold Bridge account, and your setup to a file or another computer.

Its Account tab (once Bold Bridge accounts are on):

- [Bold Bridge account](#setting-bold-bridge): Settings › Account & Backup › Account › Bold Bridge account. Once Bold Bridge accounts are on. Found by: account sign in sign out email code bold bridge.
- [Bridge AI's Relay](#setting-hosted-relay): Settings › Account & Backup › Account › Bridge AI's Relay. Once Bold Bridge accounts are on. Found by: relay hosted phone allowance request access use it on this computer pair a phone.
- [Delete account…](#setting-delete-account): Settings › Account & Backup › Account › Delete account… Once Bold Bridge accounts are on. Found by: delete account bold bridge.

Its Back Up & Move tab:

- [Back Up & Move](#setting-backup): Settings › Back Up & Move. Found by: backup back up restore move new computer migrate transfer passphrase bots connections tokens.
- [What Goes](#setting-backup-what): Settings › Back Up & Move › What Goes. Found by: what goes backup included keys settings.
- [With your signatures](#setting-backup-signatures): Settings › Back Up & Move › With your signatures. Found by: backup move signatures initials studio.

### About & Updates

Version, updates, beta features, privacy, and reporting a problem.

- [Check for new versions](#setting-version): Settings › About & Updates › Check for new versions. Found by: version update check.
- [Update by itself while you're away](#setting-auto-update): Settings › About & Updates › Update by itself while you're away. In the desktop app. Found by: auto update automatic.
- [Update Channel](#setting-channel): Settings › About & Updates › Update Channel. Found by: channel stable early access beta pre-release nightly testers.
- [Beta Features](#setting-beta): Settings › About & Updates › Beta Features. Found by: beta trials usage board answers slack bots remote screen video speakers share links.
- [Usage Counts](#setting-usage-counts): Settings › About & Updates › Usage Counts. Found by: telemetry analytics anonymous share privacy.
- [Crash Reports](#setting-crash-reports): Settings › About & Updates › Crash Reports. Found by: crash reports send privacy.
- [Privacy](#setting-privacy): Settings › About & Updates › Privacy. Found by: privacy usage counts crash reports what is sent.
- [Report a problem](#setting-report): Settings › About & Updates › Report a problem. Found by: bug issue github idea feedback.
- [Details for a Report](#setting-report-details): Settings › About & Updates › Details for a Report. Found by: diagnostics details version system.
- [Take the tour](#setting-tour): Settings › About & Updates › Take the tour. Found by: tour help.
- [License and Credits](#setting-license): Settings › About & Updates › License and Credits. Found by: license terms privacy notices star.
- [Config File](#setting-config-file): Settings › About & Updates › Config File. Found by: json config file edit config.json.
- [Effective Settings and Defaults](#setting-config-effective): Settings › About & Updates › Effective Settings and Defaults. Found by: effective defaults json.

### Beta Features

New parts of Bridge AI that ship hidden until you turn them on, in Settings › About & Updates › Beta Features (each also at the top of its own place). Turning one off hides it again; what was made with it stays.

- **Usage Across Every Provider**: The tokens each provider and model used, in Today › Usage. In Today › Usage: the tokens each provider and model used, by day and by what in Bridge AI used them, with the cost where an API key has a price and the time a model took on this computer. It stays on this computer.
- **Live Meeting Board**: A whiteboard of the meeting, kept by AI Assist while it records. While a meeting records, AI Assist keeps a whiteboard of it from what's said: what's decided, a timeline with owners and dates, who does what and the questions still open, each a suggestion you keep or discard. In any call app or a room, with the model that writes your notes, one on this computer too.
- **Answers in AI Assist**: A question raised in a meeting, answered on a card. While a meeting records with AI Assist on, a question raised that has a general or factual answer is answered on a card, from your past meetings, notes and files first, else from what the model knows; with a Perplexity key, one that needs current facts is looked up on the web, sending only the question. Kept, an answer goes in your notes.
- **Bots**: Your own bots in Slack, Discord and Microsoft Teams. Your own bots in Slack, Discord and Microsoft Teams, each a Claude Code session in a folder you give it that remembers every thread, with a Chief that hands each question to the right one. People you choose ask them, a push waits for your OK, and everything they do is kept in their record. From this computer, never through Bold Bridge.
- **Remote Screen and Preview**: See your other computers' screens, and control them once each allows it. See your other computers' screens, and control them once each one allows it, from a computer or your phone, peer-to-peer where the network allows and through your relay where it doesn't, end-to-end encrypted either way. An agent's Preview on another computer shows its app here too. Turn it on on each computer you want to see, at that computer. A computer being seen says so, with Stop, and keeps a record.
- **Share Links**: A link for people outside your devices to a file, a folder, a Studio document or an agent's app. A link for people outside your devices to a file, a folder, a Studio document or an agent's app, from Files, Studio and the Preview tab: for anyone with it (and its password), or only the people you name by email, for an hour, a day or a week. It goes through your relay, end-to-end encrypted, while this computer is on, and Stop Sharing ends it at once. Turned off, no new link is made; the links already made work until they end or you stop them.
- **Speakers From the Call's Video**: On a call, whose mouth moves on its video names who said what. While a call records and someone talks, a few pictures of the call's window are read on this Mac for whose mouth is moving and the name under that face, so the transcript says who said what, people sharing a room's camera too. Only who was seen talking, and when, is kept: never the pictures. It needs Screen Recording, as names from the screen do.
