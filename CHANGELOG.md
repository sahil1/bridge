# Changelog

Each version's section here becomes its GitHub release notes (`npm run release`).

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
