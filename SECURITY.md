# Security

Bridge AI runs AI agents on your computer and can type into their terminals, so security problems matter. Please report them privately, not in a public issue:

- **GitHub:** the repo's Security tab › Report a vulnerability.

Say what the problem is, how to reproduce it, and what someone could do with it. You'll get an answer within a week.

## Supported versions

Only the latest release gets security fixes. Bridge AI tells you when a newer version is out and updates when you say so, or, in the desktop app on a Mac or Windows, by itself while you're away unless you turn that off (Settings › About & Updates). Running `install.sh` (or `install.ps1` on Windows) again also updates it.

## How Bridge AI protects you

- The server listens on `127.0.0.1` only. From a browser, it answers only Bridge AI's own pages: a request from any other site, or from another port on this computer (a project's dev server, say), is turned away, and no other site can show Bridge AI in a frame.
- Every request needs Bridge AI's key, which is kept in `~/.bridge-ai/api-token`, readable only by you. Bridge AI's own programs (the `bridge-ai` command, the Chief of Staff's `bridge`, `bridge-ai mcp`) read it from there, and the desktop app gives it to its own windows. A browser on this computer is let in by a one-time link (View › Open in Browser in the app, or `bridge-ai open`), which leaves a cookie no web page's script can read and no other site's page or link carries. Other programs, and other accounts on the computer, get nothing.
- Your phone reaches your computer one of two ways:
  - **Your relay**, a small Cloudflare Worker on your own account. Everything between the phone and the computer is end-to-end encrypted, and the relay passes on bytes it can't read. A phone pairs with a one-time code from your computer, and you get a notification whenever a new device pairs. See [PRIVACY.md](PRIVACY.md) for what the relay keeps.
  - **Tailscale.** Only your own Tailscale login gets in. Other people on your tailnet, or on a tailnet you share, are turned away.
- **Bridge AI as an MCP Server** (a Beta Feature, off to start) lets apps on this computer that you add it to (Claude Code, Claude Desktop, Cursor, Codex) read your whiteboards, the Studio files in your Places and your meetings' summaries, and make new boards, files and tasks. A change to something that exists only waits in Needs You until you keep it, and sending work to an agent is off until you turn it on, then waits for your approval each time. Transcripts, agents' conversations, mail and calendar aren't offered at all. What it returns is marked as data, not instructions, and every call is listed in Settings › MCP Servers. What an app reads goes to the model that app uses.
- Your other computers link with a one-time code, or by asking. When one asks, you allow it on the other computer after checking that both show the same six digits. Each computer commits to a random number before it sees the other's, so a relay in between can't try keys until the digits match.
- API keys you add are stored in `~/.bridge-ai/secrets.json`. The `~/.bridge-ai` folder is readable only by you. Keys are never sent anywhere except to the provider they're for.
- Markdown and HTML from agents, files and meetings are cleaned before they're shown. HTML pages you preview run in a sandbox that can't reach the app.
- Installs and updates check each download against the release's `SHA256SUMS.txt`. Every release file also has a build attestation from GitHub Actions, so you can check where it was built:

  ```sh
  gh attestation verify Bridge-AI-mac-arm64.dmg --repo sahil1/bridge
  ```

- The Android app (`Bridge-AI-android.apk`) is signed with the project's release key, the same for every version. Android installs an update over it only when it's signed with that key, so an APK from anyone else can't replace yours.

- Usage stats and crash reports are on unless you turn them off (Settings › About & Updates, or **Turn off** on the card that says they're on; `DO_NOT_TRACK=1` or `BRIDGE_TELEMETRY=0` keeps them off; see [PRIVACY.md](PRIVACY.md#usage-stats-on-unless-you-turn-them-off)): weekly and daily counts in ranges, and crash reports with names, folders, emails and keys taken out, with no ID and nothing you typed.
- The outside requests Bridge AI makes itself are for what it shows you: the weather (Open-Meteo, with only the coordinates you picked), market prices and news headlines (Yahoo Finance, the Federal Reserve, and public news feeds), and a check on GitHub for a newer version (Settings › About & Updates turns it off). Unless you turn them off, also the usage stats, to `counts.boldbridge.ai`, and crash reports, to `crashes.boldbridge.ai` (both in `shared/telemetry-schema.json`). Your agents talk to their own providers with your own sign-ins.

## What it doesn't protect against

- **Other accounts on the same computer, as an administrator.** Someone who can read your files (an administrator of the computer) can read Bridge AI's key too. Don't run Bridge AI on a computer you share with people you don't trust.
- **Anything already running as you.** Other apps and scripts you run can read your files, Bridge AI's key among them, and so do whatever you can do in Bridge AI.
- **A linked device you don't trust.** Linked phones and computers can do what you can: start agents, read files, type into terminals. In the desktop app or a browser on this computer, a linked computer's own pages open at a port of their own, so they can't reach this computer's page, what the app can do here (pictures of the screen, pasting, the microphone) or its settings; through a phone, Tailscale or another name for this computer they still open under its address. Link only devices you own, and remove any you no longer use in Settings › Devices.
- **Your agents themselves.** They run with your permissions and do what you (and the permissions you give them) allow.
- **The Mac app's signature.** It's signed with the project's own certificate, not yet an Apple Developer ID, so macOS can't vouch for it the way it does for notarized apps. Check the checksum or the attestation above if you download it yourself.
