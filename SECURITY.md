# Security

Bridge AI runs AI agents on your computer and can type into their terminals, so security problems matter. Please report them privately, not in a public issue:

- **GitHub:** the repo's Security tab › Report a vulnerability.

Say what the problem is, how to reproduce it, and what someone could do with it. You'll get an answer within a week.

## Supported versions

Only the latest release gets security fixes. Bridge AI tells you when a newer version is out and updates itself when you say so (Settings › About & updates). Running `install.sh` (or `install.ps1` on Windows) again also updates it.

## How Bridge AI protects you

- The server listens on `127.0.0.1` only. From a browser, it answers only Bridge AI's own pages: a request from any other site, or from another port on this computer (a project's dev server, say), is turned away, and no other site can show Bridge AI in a frame.
- Your phone reaches your computer one of two ways:
  - **Your relay**, a small Cloudflare Worker on your own account. Everything between the phone and the computer is end-to-end encrypted, and the relay passes on bytes it can't read. A phone pairs with a one-time code from your computer, and you get a notification whenever a new device pairs. See [PRIVACY.md](PRIVACY.md) for what the relay keeps.
  - **Tailscale.** Only your own Tailscale login gets in. Other people on your tailnet, or on a tailnet you share, are turned away.
- Your other computers link with a one-time code, or by asking. When one asks, you allow it on the other computer after checking that both show the same six digits. Each computer commits to a random number before it sees the other's, so a relay in between can't try keys until the digits match.
- API keys you add are stored in `~/.bridge-ai/secrets.json`. The `~/.bridge-ai` folder is readable only by you. Keys are never sent anywhere except to the provider they're for.
- Markdown and HTML from agents, files and meetings are cleaned before they're shown. HTML pages you preview run in a sandbox that can't reach the app.
- Installs and updates check each download against the release's `SHA256SUMS.txt`. Every release file also has a build attestation from GitHub Actions, so you can check where it was built:

  ```sh
  gh attestation verify Bridge-AI-mac-arm64.dmg --repo sahil1/bridge
  ```

- There is no telemetry: nothing about you or your use of Bridge AI is collected or sent anywhere.
- The outside requests Bridge AI makes itself are for what it shows you: the weather (Open-Meteo, with only the coordinates you picked), market prices and news headlines (Yahoo Finance, the Federal Reserve, and public news feeds), and a check on GitHub for a newer version (Settings › About & updates turns it off). Your agents talk to their own providers with your own sign-ins.

## What it doesn't protect against

- **Other accounts on the same computer.** There's no password on `127.0.0.1`, so anyone signed in to another account on the same computer can reach it. Don't run Bridge AI on a computer you share with people you don't trust.
- **Anything already running as you.** Other apps and scripts you run can do whatever you can do in Bridge AI.
- **A linked device you don't trust.** Linked phones and computers can do what you can: start agents, read files, type into terminals. A linked computer's own pages open under this computer's address, so they're trusted the same as this one. Link only devices you own, and remove any you no longer use in Settings › Devices.
- **Your agents themselves.** They run with your permissions and do what you (and the permissions you give them) allow.
- **The Mac app's signature.** It's signed with the project's own certificate, not yet an Apple Developer ID, so macOS can't vouch for it the way it does for notarized apps. Check the checksum or the attestation above if you download it yourself.
