# Changelog

Each version's section here becomes its GitHub release notes (`npm run release`).

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
