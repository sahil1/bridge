# Bridge AI

One place to run, watch and talk to all your coding agents. Start Claude Code, Codex, Gemini CLI, Copilot, OpenCode and others in any folder, see at a glance which ones are working, finished or waiting on you, chat with them from your laptop or phone, and hand work to a chief of staff agent that routes it to the right one.

Bridge AI runs on your machine. Your agents use their own logins; Bridge AI only reads their screens and transcripts and types into them for you. Nothing is sent anywhere else.

## Install

The app needs nothing else installed: no Node, no clone. Bridge AI finds the agent CLIs you already have and offers to install one if you have none.

### macOS

Paste this in Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh
```

It downloads the app for your Mac (Apple Silicon or Intel), puts it in Applications and opens it, in a few seconds. Run it again to update.

Prefer a download? Get `Bridge-AI-mac-arm64.dmg` (Apple Silicon) or `Bridge-AI-mac-x64.dmg` (Intel) from [Releases](https://github.com/sahil1/bridge/releases/latest) and drag Bridge AI to Applications. The app isn't signed by Apple yet, so macOS asks before the first open: click Done, then System Settings › Privacy & Security › **Open Anyway**. The install command above skips that step.

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

On Debian and Ubuntu it installs the `.deb` (it asks for your password); elsewhere it puts the AppImage in `~/.local/share/bridge-ai` with a menu entry and a `bridge-ai` command. 64-bit Intel/AMD only for now. Both files are also on the [Releases](https://github.com/sahil1/bridge/releases/latest) page.

### From source

You need [Node.js](https://nodejs.org) 20 or newer and at least one agent CLI installed (for example [Claude Code](https://docs.claude.com/en/docs/claude-code) or [Codex](https://github.com/openai/codex)).

```bash
git clone https://github.com/sahil1/bridge.git
cd bridge
npm start
```

Open http://127.0.0.1:7420. The first start installs dependencies and builds the UI, which takes a minute.

The first time you open it, Bridge AI looks at what's already on your computer: the agent CLIs you have and whether you're signed in to them (your Claude, ChatGPT or Gemini subscriptions keep working as they are), your name and your time zone. Change anything that's off right there, then **Finish setup** saves it and starts your chief of staff; **More options** lets you pick a default agent too. If no agent is installed yet, it offers to install one in a terminal tab you can watch.

```bash
npm start -- dev     # hot reload: open :7421; UI edits appear live, server edits restart the API
npm run desktop:dev  # the desktop app with hot reload (runs next to the installed app)
npm start -- phone   # also publish over Tailscale HTTPS for your phone
npm run stop         # stop the server
```

### From your terminal

Run `npm link` once in the repo to get the `bridge-ai` command:

```bash
bridge-ai list              # every agent and shell, numbered
bridge-ai attach 2          # work in one from this terminal (or: bridge-ai attach "api tests"); Ctrl+] detaches
bridge-ai attach            # pick from a list
bridge-ai open              # open the app in your browser
bridge-ai start / stop
```

Attaching gives you the agent's real terminal, in your terminal app, with its keys, fonts and scrollback, the way `tmux attach` or `herdr` does. The agent keeps running in Bridge AI when you detach, and the app stays in sync. The terminal button on each agent (and "Open in terminal app" in the sidebar menu) opens the same thing in Ghostty, iTerm, Warp, WezTerm, kitty, Alacritty or Terminal on macOS, your terminal on Linux, or Windows Terminal; pick which in Settings › General. With the herdr runtime, `attach` focuses the agent and opens herdr.

## What works where

| | macOS | Linux | Windows |
|---|---|---|---|
| Agents, chat, terminal, files, changes, chief of staff | ✓ | ✓ | ✓ |
| herdr runtime and the live Herdr view | ✓ | ✓ | (herdr isn't on Windows) |
| Desktop app | ✓ | ✓ | ✓ |
| Inbox (Apple Mail) and Calendar (macOS Calendar) | ✓ | not yet | not yet |

Day-to-day use so far has been on macOS. Linux and Windows use the same code paths (node-pty and Electron both support them) but have had little testing, so please open an issue if something breaks.

## Agents

Bridge AI finds the agent CLIs on your PATH. Each one is described in [`server/agents.js`](server/agents.js): how to start it, how to resume a session, and what its screen looks like while it works.

| Agent | Command | Chat view | Extras |
|---|---|---|---|
| Claude Code | `claude` | ✓ | subagents, slash commands, question cards, safe sending |
| Codex | `codex` | ✓ | slash commands |
| Gemini CLI | `gemini` | terminal | |
| GitHub Copilot CLI | `copilot` | terminal | |
| OpenCode | `opencode` | terminal | |
| Cursor Agent | `cursor-agent` | terminal | |
| Grok | `grok` | terminal | |
| Amp | `amp` | terminal | |
| Qwen Code | `qwen` | terminal | |
| Aider | `aider` | terminal | |
| Goose | `goose` | terminal | |
| Muse Code (Meta) | `muse` | terminal | |
| Crush | `crush` | terminal | |

Agents without a chat view work fully in the Terminal tab, and their status (working, waiting on you, finished) still shows in the sidebar. Adding an agent, or a chat view for one, is a small change; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Runtimes: where agents run

| Runtime | What it is | When it's used |
|---|---|---|
| **Built in** | Bridge AI runs each agent in its own terminal (node-pty, with a headless xterm keeping the screen). Nothing else to install. Spaces and tabs are saved, and after a restart Claude Code and Codex sessions resume where they were. | Default |
| **herdr** | [herdr](https://herdr.dev) is a terminal multiplexer for agents. Bridge AI drives it and adds a live Herdr view (`Alt+2`) with herdr's own UI in the browser. Agents keep running when Bridge AI stops. | Optional. Only when you choose it; install herdr separately |

Choose in Settings › General › Where agents run, or set `"runtime": "builtin"` or `"herdr"` in your config. herdr is never required, and Bridge AI won't switch to it just because it's installed.

Bridge AI joins the herdr session you already have running; it doesn't start a new one. It shows the agents and panes in it, and anything you start from Bridge AI opens there too, so you see it in herdr as well. If you run several sessions, pick one in Settings › General › Where agents run (or set `herdr.session`). Bridge AI then uses that session for everything: the agent list, the Herdr view and "Open in terminal". To use two sessions side by side, run a second copy of Bridge AI with its own data folder and port (`BRIDGE_HOME=~/.bridge-ai-work BRIDGE_PORT=7430 npm start`).

## Your data and settings

Everything personal lives in `~/.bridge-ai` (set `BRIDGE_HOME` to move it), never in the repo:

| File | What it holds |
|---|---|
| `config.json` | Your settings (see below) |
| `chief/` | The chief of staff's folder: its instructions, `state/playbook.md` (what it has learned about how you work) and `state/ledger.md` |
| `routines.json`, `ideas.md` | Recurring jobs and your ideas backlog ([`routines.example.json`](routines.example.json) shows the shape) |
| `runtime.json` | Spaces and tabs for the built-in runtime |
| `cache/` | Queued messages, watchlist, uploads, mail rules |

Settings start from [`config.example.json`](config.example.json). Put yours in `~/.bridge-ai/config.json`; [`config.local.example.json`](config.local.example.json) shows the shape.

| Key | What it does |
|---|---|
| `name` | What the chief of staff and the morning brief call you |
| `defaultAgent` | Agent used when none is picked (`claude`, `codex`, `gemini`, ...) |
| `chief.kind` | Agent the chief of staff runs on |
| `runtime` | `builtin` (default) or `herdr` |
| `herdr.session` | Which herdr session to use when you run more than one (`herdr --session work`). Unset: `main`, else the latest one running. Also in Settings › General |
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
| Model providers | API keys, cloud accounts and local model servers (Ollama, LM Studio) your agents can use |
| MCP servers | The tools your agents can call, across all of them, with a catalog of 35 popular servers by category (web search, docs and notes, planning, Microsoft 365, deploy and monitoring, data, design) |
| Appearance | Theme, color mode, text size, density, font |
| Config file | Your `config.json`, editable, checked before it's saved, with the effective settings and defaults beside it |

## What's in the app

- **Sidebar**: spaces and tabs with each agent's status, folder and git branch. Drag to reorder, double-click to rename.
- **Tabs**: open any agent as a tab, drag tabs to reorder, put two side by side.
- **Own branch** (optional, per repo): start an agent on a new branch in its own git worktree, kept in `~/.bridge-ai/worktrees`, with the ignored files listed in `.worktreeinclude` (like `.env`) copied in and your setup command (like `npm install`) run first. Closing it removes the folder only if nothing would be lost; the branch stays.
- **Each agent** has Chat (its transcript), Terminal (a live mirror you can type in), Files (a read-only browser with syntax highlighting and markdown) and Changes (git status and diffs).
- **Review and ship**: in Changes, click lines of a diff to comment and send all your comments to the agent as one message; commit and push, and open a GitHub pull request (with `gh`) drafted from your commits, then watch its checks there.
- **Message box**: `@` to reference files and folders, `/` for slash commands, ↑ for earlier messages, voice notes (whisper.cpp, on your machine) and attachments. Messages to a busy agent are queued and sent when it's free.
- **Questions and approvals** from an agent show as cards you can click.
- **What each reply changed**: "Changed 3 files" under a reply opens its own diff per file. With Claude Code, **Undo this reply** puts the files and the chat back to just before your message, without sending anything.
- **Subagents** that Claude Code starts show live above the message box.
- **Consult other models**: the chief of staff (or you, with `node ~/.bridge-ai/chief/bin/bridge ask`) can put a one-off question to Grok, GPT, Claude, Gemini, Muse Spark, Perplexity, DeepSeek, a local Ollama model and others, for a second opinion, live news, or a very long document. It uses each agent's CLI and your existing subscription where it can, and an API key from Model providers otherwise. Settings › Agents shows who is reachable and how.
- **Plain chats**: talk to Claude, Codex or any agent directly, like its own app, with no project folder (New agent › Plain chat, or New chat in `⌘K`).
- **Chief of staff**: tell it what you need; it sends the work to the agent already on that topic or starts a new one, tracks it, and tells you when it's done. It learns where work lives and how you like things done, in a playbook you can read and edit.
- **Today**: schedule, inbox ranking, morning brief, routines, ideas, usage and quota, weather, markets and news.
- **Usage**: tokens and cost per day, model and project, with a year heatmap (from your agents' local logs via ccusage).
- **Phone**: the same app on your phone, as a Home Screen app with notifications. See [On your phone](#on-your-phone).
- **Appearance**: Slack-style themes that color the window frame, light and dark modes, and custom colors you can share as a string.

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

To publish a release:

1. Set the new version in `package.json` and `desktop/package.json`, and add a `## <version>` section to [CHANGELOG.md](CHANGELOG.md).
2. Commit, merge to `main`, and check out `main`.
3. `npm run release`.

`npm run release` checks that `main` has your code, the changelog has that version, and the tag is new, then pushes the tag `v<version>`. GitHub Actions ([release.yml](.github/workflows/release.yml)) builds the app on macOS, Windows and Linux, starts each build and checks it works (`scripts/smoke.js`), and publishes the release with every installer, checksums, and the changelog section as notes. It takes about 15 minutes; if any platform fails, nothing is published. Try `npm run release -- --dry-run` first.

You can also run the builds without releasing: Actions › Release › Run workflow. The installers are attached to the run.

## On your phone

Bridge AI works on your phone as an app on the Home Screen, with notifications when an agent needs you or finishes. No app store is involved: it's the same app, served by your computer. There are two ways to reach it; both are optional, and Bridge AI works the same on the computer without either.

### From anywhere, through your own relay

A small relay ([relay/](relay)) runs on your own free Cloudflare account. Bridge AI keeps one outgoing connection to it, and your phone reaches your computer through it. There's no VPN to keep connected, nothing to install on the phone, and no port opened on the computer.

1. In Bridge AI, open **Settings › Phone & notifications** and click **Sign in with Cloudflare** (or use an API token made with Cloudflare's "Edit Cloudflare Workers" template). Bridge AI deploys the relay to your account. Its sign-in is kept apart from any other Cloudflare tools you use.
2. Click **Pair a phone** and scan the QR code with the phone's camera (or open the relay's address and type the code).
3. Add it to the Home Screen: iPhone, Share › **Add to Home Screen**; Android, ⋮ › **Install app**. Open it from there, and type the code again if it asks.
4. In Bridge AI on the phone, go to **Settings › Phone & notifications** and click **Turn on notifications**.

Everything between the phone and the computer is end-to-end encrypted ([relay/web/link.js](relay/web/link.js)): each paired phone has its own key, kept on the phone, and each connection makes fresh keys. The relay, and Cloudflare, see when and how much, never what. It stores nothing but when your computer was last online. Remove a phone in Settings and it's out. A phone can't pair other phones or change the relay; that's done on the computer.

Your computer has to be on and Bridge AI running. **Keep this computer awake while it's plugged in** (macOS and Linux) stops it sleeping. The free Cloudflare plan is plenty for one person; if it's ever used up, Cloudflare stops serving until the next day rather than charging you.

### Through Tailscale

If you already use [Tailscale](https://tailscale.com), a free private network between your own devices:

1. On the computer: install Tailscale and sign in. In Bridge AI, open **Settings › Phone & notifications** and click **Turn on phone access**. It shows a QR code.
2. On the phone: install Tailscale and sign in with the same account. Scan the QR code with the camera.
3. Add it to the Home Screen and turn on notifications, as above.

Only devices signed in to your Tailscale account can reach Bridge AI; nothing is opened to the internet.

Either way, choose what you're notified about in Settings › Phone & notifications: an agent needs you, an agent finished, and usage running low (5 to 25% left). Notifications are encrypted end to end to your phone. iPhone needs iOS 16.4 or later for notifications.

- **What it's asking**: a "needs you" notification shows the agent's question or permission request, and tapping it opens that agent at its question.
- **Answer buttons**: on Android and in Chrome on a computer (not iPhone), a yes or no question, or one with two short choices, gets buttons that answer it without opening the app. Each works once, for 10 minutes, and only if the agent is still asking that same question; otherwise Bridge AI opens. Turn them off in Settings › Phone & notifications.
- **Quiet while you're at the computer**: while Bridge AI is in front on your computer, or you typed or clicked in it in the last 2 minutes, your phone isn't notified (the computer's own notifications still are). **Notify my phone even when I'm at the computer** changes that.
- **Mute an agent**: ⋯ › **Mute notifications** in its header or the sidebar, until you unmute it.

## Security

- The server listens on `127.0.0.1` only. It answers requests whose Host is this machine or a Tailscale name and, from a browser, whose Origin is too, so other web pages can't drive your agents through localhost.
- File and git actions stay inside the agent's folder. They change things only when you ask from the app: saving a file, undoing a change, committing, pushing (never forced) or opening a pull request.
- Anyone who can reach the server can type into your agents. Phone access uses your own relay, which only lets in phones you paired (end-to-end encrypted), or `tailscale serve`, which only devices on your tailnet can reach. Never expose Bridge AI with `tailscale funnel` or a public port.
- Mail and meeting agents are told that email text is data, not instructions, and never to send or post without your OK.

## Optional setup

- **Quota in the top bar**: run `npx quota-axi --provider claude --allow-keychain-prompt` once and allow access.
- **Voice notes**: install `ffmpeg` and `whisper-cli` (whisper.cpp) and put a model at `~/.bridge-ai/models/ggml-small.en-q5_1.bin`.
- **Inbox (macOS)**: turn on Mail for your account, open Mail once, and give Full Disk Access to the app that starts Bridge AI.
- **Calendar (macOS)**: `brew install ical-buddy`.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE).
