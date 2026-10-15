# Security

Bridge AI runs AI agents on your computer and can type into their terminals, so security problems matter. Please report them privately, not in a public issue:

- **GitHub:** the repo's Security tab › Report a vulnerability.

Say what the problem is, how to reproduce it, and what someone could do with it. You'll get an answer within a week.

## How Bridge AI protects you

- The server listens on `127.0.0.1` only. Requests must come from this machine (or your Tailscale name, for phone access) and, from a browser, from Bridge AI's own pages, so other websites can't drive your agents.
- Phone access goes through Tailscale: only devices signed in to your tailnet can reach it, and nothing is opened to the internet.
- API keys you add are stored in `~/.bridge-ai/secrets.json`, readable only by you, and are never sent anywhere except to the provider they're for.
- There is no telemetry: nothing about you or your use of Bridge AI is collected or sent anywhere.
- The outside requests Bridge AI makes itself are for what it shows you: the weather (Open-Meteo, with only the coordinates you picked), market prices and news headlines (Yahoo Finance, the Federal Reserve, and public news feeds), and a check on GitHub for a newer version (Settings › About & updates turns it off). Your agents talk to their own providers with your own sign-ins.
