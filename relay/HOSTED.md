# Bridge AI's hosted relay

For whoever runs it. Everyone else can ignore this file: Bridge AI works without it, and each
person can still put a relay on their own Cloudflare account, or use Tailscale.

The hosted relay is the same Worker as everyone's own relay ([worker.js](worker.js)), run once by
the project for many computers, so someone with no Cloudflare account can reach their computer from
their phone with one click. With `HOSTED` unset the Worker is a personal relay exactly as before;
with `HOSTED=1` it works like this:

- `https://<domain>/` is a small page saying what the relay is. `POST https://<domain>/_relay/register`
  gives a computer, once, `{ id, url, token }`: an id of 12 lowercase letters and digits, its own
  address `https://<id>.<domain>`, and a token only that computer has.
- Each computer gets its own Durable Object (`idFromName(id)`), which keeps only a SHA-256 hash of
  the token. The computer connects to `/_relay/host` at its address with `Authorization: Bearer
  <token>`; a wrong or missing token gets 403.
- Phones work exactly as with a relay of your own: they open the computer's address, pair, and
  everything past the handshake is end-to-end encrypted between phone and computer (in a browser,
  by the page the relay serves; the iPhone app has its own). One address per
  computer keeps each pairing, service worker and saved copy apart, as before.
- Any other name under the domain gets a plain 404: names that aren't an id (ids end in two
  checksum characters, so a made-up name is turned away without waking anything), reserved names
  (www, api, relay, admin and a few more), names two levels down, and ids that aren't registered
  (or were removed).
- Addresses are one level below the domain because Cloudflare's free Universal SSL certificate
  covers `<domain>` and `*.<domain>`, not deeper.

## Switching it on in the app

It's hidden until there is a domain. The one place to switch it on is
[server/hosted.js](../server/hosted.js):

```js
export const HOSTED_URL = 'https://<domain>'
```

While that's empty, the option doesn't show in Settings, first-run setup or `bridge-ai help`, and
nothing changes for anyone. To try it on one computer before shipping, put this in that computer's
`~/.bridge-ai/config.json` instead:

```json
"relay": { "hostedUrl": "https://<domain>" }
```

Then Settings › Phone & notifications starts with a choice of three ways (Bridge AI's relay, your
own Cloudflare, Tailscale), first-run setup offers "On your phone: Bridge AI's relay" (on unless
you change it, and it shows the pairing code right after), and `bridge-ai relay setup --hosted`
works from a terminal. Moving between the ways works too; phones pair again after a move to
another relay, and the app says so.

## Going live

1. **A domain on Cloudflare.** Buy one (or use one you have) and add it to a Cloudflare account as a
   zone. Keep the relay on a domain of its own: every name under it belongs to the relay.
2. **DNS.** Two proxied records (orange cloud), pointing nowhere in particular, since the Worker
   answers before anything is reached: `AAAA @ 100::` and `AAAA * 100::`. Proxied wildcard records
   work on every plan.
3. **SSL.** SSL/TLS › Edge Certificates: Universal SSL on (the default), and Always Use HTTPS on.
   The certificate covers `<domain>` and `*.<domain>`; wait until it says Active.
4. **The Worker's config.** In [wrangler.hosted.toml](wrangler.hosted.toml), replace `example.com`
   with the domain: in both routes (`<domain>/*` and `*.<domain>/*`, which is what sends the bare
   domain and every computer's address to the Worker) and in `HOSTED_DOMAIN`.
5. **Plan.** Workers Paid ($5 a month) before telling anyone. Workers Free works for trying it, but
   its daily allowance runs out with a few hundred computers (see Cost).
6. **Deploy**, from the repo, signed in to that Cloudflare account (`npx wrangler@4.149.0 login`):

   ```sh
   node relay/build.js relay/dist/worker.js
   npx wrangler@4.149.0 deploy -c relay/wrangler.hosted.toml
   ```

7. **Check it**: `https://<domain>/` shows the page, `https://<domain>/_relay/health` answers
   `{"ok":true,...}`, and `https://abc.<domain>/` is a 404.
8. **Try it** on one computer with the config.json override above: Settings › Phone & notifications
   › Bridge AI's relay › Use Bridge AI's relay, then Pair a phone.
9. **Ship it**: set `HOSTED_URL` in server/hosted.js, add the policy text below to PRIVACY.md and
   TERMS.md, mention it in the README, and release.

## Settings

All in `[vars]` of wrangler.hosted.toml (or Settings › Variables in the dashboard). Each limit is
per computer unless it says otherwise.

| Variable | Default | What it does, and why that default |
| --- | --- | --- |
| `HOSTED` | | `1` turns on everything here. Unset, the Worker is a personal relay. |
| `HOSTED_DOMAIN` | | The domain, without `https://`. |
| `HOSTED_OFF` | `0` | The kill switch (below). |
| `MAX_PHONES` | `16` | Connections to one computer at once: the same as a personal relay. Strangers who haven't paired make room for paired phones. |
| `MAX_MESSAGE_KB` | `256` | One message. Bridge AI's largest is 192 KB (a piece of a big file) plus a little; notes for an offline computer are 64 KB at most. |
| `MESSAGES_PER_SECOND` | `200` | Incoming messages a second, on average, with `MESSAGE_BURST` (`2000`) at once. A phone watching an agent's terminal, the busiest normal use, sends and gets about 4 a second; opening the app for the first time is about 150 in a few seconds. This only stops floods. |
| `DAILY_MESSAGES` | `200000` | Incoming messages a day (UTC). This is what Cloudflare bills. About 12 hours of a phone watching a terminal, or far more of anything else. |
| `DAILY_MB` | `512` | Data a day (UTC). Bytes aren't billed; this stops the relay being used as a general tunnel. A busy hour is about 5 MB. |
| `IDLE_DAYS` | `90` | A computer whose Bridge AI hasn't connected for this long is deleted, with everything kept for it. |
| `REGISTER_PER_IP` | `10` | New computers a day from one network (an IPv4 address, or an IPv6 /64). Enough for a household or an office, small enough to stop someone scripting it. |
| `REGISTER_PER_DAY` | `1000` | New computers a day in all: a ceiling on what a determined abuser can create. Raise it as people use it. |

### What happens at a limit

- **Too big, or too many at once**: that phone's connection is closed with a message (the phone
  shows "Too much at once for Bridge AI's relay. Connecting again in a moment.") and it reconnects
  10 seconds later. A computer's message for a phone counts against that phone.
- **Today's allowance used up**: both ends are told, "The hosted relay's daily limit for this
  computer is used up. It resets at <time>. For no limits, put the relay on your own Cloudflare
  account." The phone shows it (in place of Bridge AI, or on a bar if it's open) and waits until the
  reset; Settings on the computer shows it with a link to set up its own Cloudflare. The computer
  stays connected, quietly, so phones are back the moment the day resets (00:00 UTC).
- **Registration**: past either limit, `register` answers 429 with a message the app shows.

The daily counts are kept in each computer's Durable Object, saved every 100 messages or 256 KB
and whenever a connection ends. A Durable Object put to sleep in between forgets at most that much,
so the counts can come out a little low, never high.

## The kill switch

Set `HOSTED_OFF = "1"` (or a sentence of your own, shown instead of the default) and deploy, or set
it under Settings › Variables in the dashboard. Then:

- `register` answers 503 with the message;
- every connection, computer or phone, gets the message and is closed. Phones show "Bridge AI's
  relay is switched off for now. To keep using your phone, put a relay on your own Cloudflare
  account, or use Tailscale"; Settings on each computer shows the same;
- computers wait 30 minutes (and a bit, so they don't all come at once) before trying again.

A deploy closes every connection anyway, so it takes effect at once. Nothing is deleted. To turn it
back on, set `HOSTED_OFF = "0"` and deploy; computers are back within about half an hour, or at once
when Bridge AI restarts.

## What it keeps, and what it counts

Per computer, in its Durable Object: the token's hash, when it registered and connected last, its
paired phones as ids made from each phone's key (as a personal relay keeps them), today's counts,
which of its paired phones were counted this week (by those ids), and messages a phone sent while
the computer was offline, sealed so the relay can't read them, for 7 days at most. Forget on the
computer (Stop using the relay) deletes all of it at once; otherwise it goes after `IDLE_DAYS`.

For registration limits, a separate Durable Object keeps today's count per network, under a hash of
the network's address and the date. It's deleted the next day and never leaves that object.

**Counts for the project**, with a Workers Analytics Engine binding (`STATS`; leave it out of the
config and nothing is counted). Each is one data point with the computer's id as its index, and
nothing else: no IP addresses, no content, no user agents, no phone identifiers, no names.

| `blob1` | Written when | Also |
| --- | --- | --- |
| `register` | a computer registers | `blob2`: its Bridge AI version |
| `computer` | a computer connects | `blob2`: its Bridge AI version |
| `phone` | one of a computer's paired phones connects for the first time this week (weeks start Monday, UTC) | `blob2`: the week, as its Monday's date |
| `usage` | every 100 messages or 256 KB, and when a connection ends | `double1`: bytes, `double2`: messages, both incoming |
| `limit` | a limit turns something away | `blob2`: `size`, `rate` or `day` |
| `removed` | a computer's data is deleted | `blob2`: `forget` or `idle` |
| `refused` | a registration is refused (index empty) | `blob2`: `ip` or `all` |

The version comes from the computer (`X-Bridge-Version` when it connects, `version` when it
registers) and is kept only if it looks like `2.4.0`. Analytics Engine keeps data for three months.
Some useful queries, with the SQL API (`POST
https://api.cloudflare.com/client/v4/accounts/<account id>/analytics_engine/sql`, a token with
Account Analytics Read):

```sql
-- computers that connected in the last 7 days, by version
SELECT blob2 AS version, count(DISTINCT index1) AS computers FROM bridge_relay
WHERE blob1 = 'computer' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY version
-- phones in use, by week (each phone once per computer per week)
SELECT blob2 AS week, sum(_sample_interval) AS phones FROM bridge_relay
WHERE blob1 = 'phone' GROUP BY week ORDER BY week
-- registrations a day
SELECT toStartOfDay(timestamp) AS day, sum(_sample_interval) AS computers FROM bridge_relay
WHERE blob1 = 'register' GROUP BY day ORDER BY day
-- data relayed in the last day
SELECT sum(_sample_interval * double1) AS bytes, sum(_sample_interval * double2) AS messages
FROM bridge_relay WHERE blob1 = 'usage' AND timestamp > NOW() - INTERVAL '1' DAY
-- limits hit this week
SELECT blob2 AS why, sum(_sample_interval) AS times FROM bridge_relay
WHERE blob1 = 'limit' AND timestamp > NOW() - INTERVAL '7' DAY GROUP BY why
```

Cloudflare also sees what any site it serves sees (IP addresses, times, sizes), under its own
policy. Leave Workers Logs (observability) off, which is the default, so request details aren't
stored in the account; `wrangler tail` shows them live, IP addresses included.

## Cost

From Cloudflare's pricing pages (October 2026):

- **Durable Objects**: incoming WebSocket messages are billed as requests at 20 to 1; outgoing
  messages and protocol pings are free. Duration is billed only while an object is running code
  (128 MB per object); idle objects that can hibernate, as these can, cost nothing. Workers Free
  includes 100,000 requests and 13,000 GB-s a day. Workers Paid includes 1 million requests and
  400,000 GB-s a month, then $0.15 per million requests and $12.50 per million GB-s.
- **Workers requests** (the page's files and each new connection): Free 100,000 a day; Paid 10
  million a month, then $0.30 per million. Small next to the messages.
- **Analytics Engine**: Free 100,000 data points a day, Paid 10 million a month (not billed yet).

Measured here, with the relay running locally:

- A phone watching an agent's terminal (the busiest view; it refreshes about once a second): 4.4
  incoming messages a second, so about 16,000 an hour and 5 MB.
- The same phone on the agent's chat: 0.7 a second, about 2,500 an hour.
- Opening the app: about 45 messages, or about 150 (1.4 MB) the very first time.
- Each connected computer's keepalive: one message every 25 seconds, around the clock, phone or
  not: 3,456 a day. (They're answered without waking anything, so no duration, but count them as
  requests to be safe.)

**Per active hour of a phone** (terminal view, the expensive case): 16,000 messages is 800
requests, $0.00012 at Paid rates past the included amount. Duration, at a generous 3 ms per
message, is 48 seconds of one object, 6 GB-s or $0.00008. **About $0.0002 an hour, roughly 5,000
phone-hours per dollar**, and about a fifth of that on the chat view.

What that means:

- **Workers Paid, $5 a month**: the included million requests cover about 1,250 phone-hours a month
  in the terminal view (6,000 on chat), or the keepalives of about 190 always-on computers. Past
  that, each always-on computer's keepalives cost about $0.0008 a month, and duration stays well
  inside the included 400,000 GB-s.
- **The most one computer can cost** (its daily allowance used up every day): 10,000 requests and
  about 75 GB-s a day, about $0.07 a month.
- **Workers Free**: 100,000 requests a day is about 125 phone-hours a day, or the keepalives of
  about 580 computers with no phone use at all. When it runs out, Cloudflare stops answering until
  the next day (for everyone), so it's for trying the relay, not for launch.
- Storage is tiny (a few kilobytes per computer, plus up to 512 KB of waiting messages per phone
  for a week) and within the included 5 GB.

Turn on a billing notification (Notifications › Usage-based billing) so a surprise shows up early.

## Updating it

Same as going live, step 6: build and deploy. Any computer's or phone's connection drops and comes
back within seconds. Computers on the hosted relay never try to update it themselves (they do for a
relay on your own account). Keep `[[migrations]]` as it is: the class and its tag don't change.

## Watching it

- Workers & Pages › bridge-relay › Metrics: requests, errors, CPU time.
- Workers & Pages › Durable Objects: requests, duration and storage per class.
- Manage Account › Billing › Billable usage: what this month will cost.
- The Analytics Engine queries above: computers, phones, versions, data, limits hit.
- `npx wrangler@4.149.0 tail -c relay/wrangler.hosted.toml` for live errors (it shows IP addresses;
  don't keep its output).

## Trying it locally

`wrangler dev` passes the Host header through, and Chrome sends `*.localhost` to 127.0.0.1, so
`<id>.localhost` stands in for a computer's address:

```sh
node relay/build.js /tmp/relay/worker.js
# a wrangler.toml beside it like wrangler.hosted.toml, with main = "worker.js", no routes, and
# HOSTED_DOMAIN = "localhost"
npx wrangler@4.149.0 dev --local --port 8795
```

Then point a test Bridge AI at it with `"relay": { "hostedUrl": "http://localhost:8795" }` in its
config.json (plain http is allowed only for localhost and 127.0.0.1). Never point a computer you
use at a test relay.

## Policy text to add when it goes live

Paste these when `HOSTED_URL` is set. Until then PRIVACY.md and TERMS.md stay as they are, and stay
true for everyone who runs their own relay.

**PRIVACY.md**, in the opening paragraph, replace "None of them sends anything to the project or its
author. There is no server run by the project, no account, no analytics, no ads and no crash
reporting." with:

> Unless you choose the project's hosted relay (below), none of them sends anything to the project
> or its author. There is no account, no analytics in the app, no ads and no crash reporting.

**PRIVACY.md**, a new section after "Your relay":

> ## Bridge AI's relay (optional)
>
> If you'd rather not set up a relay of your own, you can choose Bridge AI's relay in Settings ›
> Phone & notifications. It's the same relay, run by the project on its own Cloudflare account, so
> the project's Cloudflare account carries your traffic instead of yours. Cloudflare processes it
> for the project.
>
> Everything between your phone and your computer is still end-to-end encrypted, so the relay can't
> read it. That holds as long as the page doing the encrypting is the one Bridge AI wrote: the iPhone
> app has it built in, but in a phone's browser the page comes from the relay, so whoever runs the
> relay could change it. On a relay that isn't yours, use the iPhone app. What it can see: the IP addresses of your phone and computer, when they connect, and how
> much they send. What it keeps for your computer: a random id, a hash of the token your computer
> uses to connect, when it registered and last connected, today's message and data counts (for the
> fair-use limits), and, as any relay does, your paired phones as ids made from their keys, and
> messages from your phone waiting for your computer, sealed so it can't read them, for 7 days at
> most. To limit sign-ups, it also keeps how many computers were set up from each network today,
> under a hash of the network's address and the date, deleted the next day.
>
> It also counts, for the project: when a computer registers and connects (with its Bridge AI
> version), how many paired phones connect each week, how much data passes, and when a limit is
> reached, each by your computer's random id only. No IP addresses, no content and no names are
> counted. The full list is in [relay/HOSTED.md](relay/HOSTED.md).
>
> Stop using it (Settings › Phone & notifications › Stop using the relay) and your computer's data
> there is deleted at once. A computer that hasn't connected for 90 days is deleted the same way.
> Everything else in this policy, including what Cloudflare sees, applies to it as to a relay of
> your own, except that it's the project's Cloudflare account.

**TERMS.md**, a new section after "Your accounts with other services":

> ## Bridge AI's relay
>
> The project offers an optional relay, so your phone can reach your computer without a Cloudflare
> account of your own. It's free, with fair-use limits per computer (a daily allowance of messages
> and data), and it's provided as is like the rest of Bridge AI: it may be slow, go down, change its
> limits, or stop, with or without notice. If you need it to be dependable, set up a relay on your
> own Cloudflare account instead.
>
> Use it only for Bridge AI, as Bridge AI uses it. Don't use it to pass on anything else, to get
> around its limits, to disturb other people's use of it, or for anything unlawful. The project may
> remove a computer from it, or block a network, if it's misused.

**TERMS.md**, in the opening paragraph, "the relay you can set up on your own Cloudflare account"
becomes "the relay you can set up on your own Cloudflare account (or use the project's)", and in
"Privacy", "The project collects nothing about you." becomes "The project collects nothing about
you, unless you use its relay; what that relay sees and counts is in PRIVACY.md."
