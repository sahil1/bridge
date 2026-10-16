# Changelog

Each version's section here becomes its GitHub release notes (`npm run release`).

## 2.2.0

See your app running, keep talking while agents work, and edit what you sent.

### What's new

- **Preview tab:** next to Files and Changes, it shows the web servers running from the agent's folder (port, program, page title) and the app itself, with an address bar, reload, open in your browser and stop. Nothing running? It offers the project's own way to start one (`./start.sh`, `npm run dev`, `make dev` and others), in a terminal tab you can watch, and shows the app as soon as it answers. An `index.html` that needs its dev server now says so in the file viewer.
- **Type while the agent works:** with Claude Code and Codex, Enter sends straight to the agent, the way typing in its terminal does (it picks it up after its current step). ⌘/Ctrl+Enter still interrupts and sends now.
- **/btw side questions:** ask Claude something while it keeps working; the answer appears in a card above the message box.
- **Edit a sent message (Claude Code and Codex):** hover your message and choose Edit. It goes into the message box; send it and the agent goes back to just before it and answers your edit instead. Your files stay as they are unless you also choose to undo the agent's file changes since then (Claude Code).
- **Send what you see to the agent:** in the Preview tab, Send to agent attaches a picture of the app to a message, with its address.
- **History (⌘/Ctrl+Shift+F):** search every Claude Code and Codex conversation on this computer, and open or resume the one you find. Agents you close are kept there too, to resume later with their full history.
- **Fork:** copy an agent's conversation into a new tab next to it, to try another way while the original stays as it is.
- **Undo and commit in the Changes tab:** undo one change or a whole file, and commit all changes or just the file you're looking at.
- **Compare two agents:** in New agent, send the same first message to a second kind of agent and see both side by side.
- **Saved prompts:** the star in the message box keeps messages you send often. {{Blanks}} like {{week}} are selected for you to fill in; Tab goes to the next.
- **Terminal tab:** the cursor sits where you type (the agent's input line), and what you type in the message box shows up there as you type. The agent's screen now fits the pane's width (no cut-off lines or sideways scrolling), scrollbars match the terminal, and a short screen no longer leaves the view scrolled down to empty space.
- **Images stay in your messages:** pictures you attached or pasted show as thumbnails after sending; click one to see it full size. In the message box, attached images are bigger, numbered (Image 1, Image 2) so you can refer to one, and open full size with a click.
- **Word, PowerPoint and Excel in Files:** spreadsheets and CSV files show as a table with a tab per sheet. Documents and decks show laid out page by page when LibreOffice is installed (Bridge AI uses it in the background); without it, you see the text in them. "Open in app" opens one in Word, Excel or PowerPoint.
- **File menu in Files:** right-click a file or folder (or use ⋯ in the viewer) for Reveal in Finder, Open in its app, Mention to the agent, Copy path, Copy relative path, Duplicate, Rename, Move to Trash, and New file or folder. The + at the top of the tree adds a file or folder there.

### Fixes

- Claude Code showed as idle while working on the built-in runtime with newer Claude Code versions.
- Chat no longer shows messages that were rewound away (also when you rewind in the terminal).
- The file viewer no longer opens every file in Edit after you edited one.
- Chat's live activity line works again with newer Claude Code versions, and Chat follows Codex after you rewind it in its terminal.

### Install

- **macOS and Linux:** `curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh`
- **Windows (PowerShell):** `irm https://raw.githubusercontent.com/sahil1/bridge/main/install.ps1 | iex`

On 2.0 or later? Settings › About & updates updates it in one click.

## 2.1.0

Edit files in place, more than one account per agent, and spaces you can arrange.

### What's new

- **Spaces you can arrange:** make a new space from the sidebar (the layers button), and drag an agent or terminal tab from one space to another, onto a tab to place it there, or onto **Drop here for a new space**. Each tab's menu also has **Move to space…**. Terminals keep running while they move, in the built-in runtime and in herdr.
- **Pick the herdr session:** with more than one herdr session running, Settings › General chooses which one Bridge AI shows and drives.
- **Edit files in the Files tab:** Markdown, HTML and other text files now have an Edit mode, with a live preview next to the text for Markdown and HTML. ⌘/Ctrl+S saves. If an agent changed the file while you were editing, Bridge AI asks before overwriting it.
- **HTML preview:** HTML files open as the page itself, with its styles, scripts and images, in a sandbox that can't reach Bridge AI.
- **Several accounts per agent:** add a work and a personal Claude account, or two ChatGPT logins for Codex, in Settings › Model providers › Accounts. Sign in opens the agent's own login flow in a terminal tab. Pick which account new agents use there, or per agent in New agent. Settings, skills and session history are shared between accounts.
- **Privacy check:** `npm run check:private` keeps personal data (keys, logins, transcripts, your name and paths) out of the repo. It runs before every commit and push from a source clone (`npm install` turns the hooks on), before releases and app builds, and in CI.

### Install

- **macOS and Linux:** `curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh`
- **Windows (PowerShell):** `irm https://raw.githubusercontent.com/sahil1/bridge/main/install.ps1 | iex`

On 2.0? Settings › About & updates updates it in one click.

## 2.0.0

Bridge AI on your phone, with notifications.

### What's new

- **On your phone, no app store:** Settings › Phone & notifications turns on phone access through Tailscale (free, private to your own devices) and shows a QR code. Add Bridge AI to your Home Screen and it opens like an app.
- **Notifications** on your phone or in your browser when an agent needs you, when it finishes, and when a usage quota runs low (you pick the threshold). They're end-to-end encrypted to your device. Tapping one opens that agent.
- **Send now:** while an agent is working, Enter still queues your message; **Send now** (or ⌘/Ctrl+Enter) interrupts the agent and sends it straight away.
- **Updates:** Bridge AI tells you when a new version is out (a chip in the top bar) and the desktop app updates itself in one click. Settings › About & updates.
- **Reporting problems:** Settings › About & updates › Copy details gives the version and system details for a bug report, and nothing personal.
- **Works offline gracefully:** if your phone can't reach your computer, it says so instead of a blank page.
- **Faster everywhere:** finding installed agents no longer starts a process per agent (much faster on Windows), and the GitHub sign-in check only runs when Copilot is installed.

### Install

- **macOS and Linux:** `curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh`
- **Windows (PowerShell):** `irm https://raw.githubusercontent.com/sahil1/bridge/main/install.ps1 | iex`

Already on 1.24? Run the install command again. From 2.0 on, Bridge AI updates itself from Settings › About & updates.

## 1.24.0

Bridge AI for Windows and Linux.

### Install

- **macOS and Linux:** `curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh`
- **Windows (PowerShell):** `irm https://raw.githubusercontent.com/sahil1/bridge/main/install.ps1 | iex`

Or download the file for your system below:

| System | File |
|---|---|
| macOS, Apple Silicon | `Bridge-AI-mac-arm64.dmg` |
| macOS, Intel | `Bridge-AI-mac-x64.dmg` |
| Windows | `Bridge-AI-win-x64.exe` |
| Linux, Debian and Ubuntu | `Bridge-AI-linux-amd64.deb` |
| Linux, other | `Bridge-AI-linux-x86_64.AppImage` |

The apps aren't signed yet, so macOS and Windows ask before the first open of a downloaded file (macOS: System Settings › Privacy & Security › **Open Anyway**; Windows: **More info › Run anyway**). The install commands skip that.

### What's new

- **Windows and Linux apps**, with one-line installers. Windows installs for your user with no admin rights; Linux installs the .deb on Debian and Ubuntu, or the AppImage elsewhere.
- Every platform is built and tested automatically before a release is published.

## 1.23.1

Faster to install and faster to use.

### Install

Paste this in Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh
```

It downloads the right app for your Mac, puts it in Applications and opens it, in a few seconds, with no security prompt. Run it again any time to update.

Or download a file below: `Bridge-AI-mac-arm64.dmg` for Apple Silicon (M1 and later), `Bridge-AI-mac-x64.dmg` for Intel. The app isn't signed by Apple yet, so the first open asks for confirmation: click Done, then System Settings › Privacy & Security › **Open Anyway**.

### What's new

- **One-line install** for Mac, with no "can't check this app" step.
- **Opens faster:** the first screen loads less than half as much code. Terminals, the file viewer, Settings and other views load in the background once the app is idle, so they still open instantly. A repeat launch draws in about a second.
- **Snappier while you use it:** views share data instead of each fetching it, and a view you reopen shows its last state right away.
- **Smaller app:** 227 MB instead of 270 MB, and a smaller, faster-opening .dmg.
- **Onboarding:** change your name, location and chief of staff right on the welcome screen; consistent buttons; the "You're set" tips stay until you close them.

## 1.23.0

The first public release: one place to run your AI coding agents and talk to them, with a chief of staff that sends each request to the right one.

- **Chief of staff:** one agent you talk to that routes work to the right agent, starts new ones when needed, learns your preferences, and can consult other models for a second opinion (`bridge ask`).
- **Every agent in one window:** chat view, live activity, subagents, slash commands, questions you can answer inline, and the full terminal when you want it.
- **Onboarding** that detects your agents and sign-ins and sets everything up in one click.
- **Settings:** default agent and model, 22 model providers, MCP servers for all your agents from one list, themes and appearance, and the config file itself.
- **Usage:** quotas and token stats per provider.
- **Terminal access:** `bridge-ai attach` or "Open in terminal" in your own terminal app.
- **Runs agents itself**; herdr is supported but optional.
- **Private by default:** everything stays on your computer in `~/.bridge-ai`, the server only listens on 127.0.0.1, and there is no telemetry.
