# Bold Bridge accounts: the contract

The account a person signs into with their email, for the two things Bold Bridge runs for them:
**Early Access** (betas, [CONTRIBUTING.md](../CONTRIBUTING.md) › Releases, betas and rollouts) and
**Bridge AI's relay** ([relay/HOSTED.md](../relay/HOSTED.md)). Nothing else needs one: Bridge AI,
a relay on your own Cloudflare account and Tailscale work as before, and setup never asks for it.

What an account holds is the email, its devices, whether it's a tester, whether it may use the
relay, and the relay's use of it. Never anything from the person's computer: their meetings, mail,
code, voice and files stay there.

Three parts keep to this file:

- **The accounts service**, [worker.js](worker.js) in this folder: a Cloudflare Worker at
  `https://accounts.boldbridge.ai` with a D1 database (`bridge-accounts`), on the project's account.
- **The relay** ([relay/worker.js](../relay/worker.js), with `HOSTED=1`): checks an account's relay
  token, keeps each account's use, and enforces its limits.
- **Bridge AI** (server/account.js and Settings › Account) and **the admin view**
  (boldbridge.ai/admin, in the private repo).

## Rules

- **Sign-in is an email and a 6-digit code**, sent from `accounts@boldbridge.ai` by Cloudflare's <!-- private-ok: the service's own sending address -->
  Email Service (`send_email` binding). No passwords. A code lasts 10 minutes and allows 5 tries;
  an email gets at most 5 codes an hour, a network (IPv4 /24, IPv6 /48) at most 20. Throwaway email
  domains (a list in the Worker) are refused, saying why.
- **One account per email**, compared lowercase and trimmed. An email's first sign-in makes it.
- **At most 5 devices per account**, any mix of computers and phones. A sixth sign-in is refused
  with the list, so one can be removed first.
- **The relay is by request**: an account asks, an admin approves (`relay`: `none`, `requested`,
  `approved`, `declined`). **Early Access is by request or invitation** (`tester`: `none`,
  `requested`, `yes`, `declined`). An admin can also invite an email that has no account yet: the
  account is made, marked, and the email says so.
- **Suspended** (`status: suspended`) stops everything for the account at once: no relay token
  works, no Early Access code is handed out, and signing in says it's suspended.

## Tokens

Signed with Ed25519 by the accounts service (secret `SIGNING_KEY`); anyone holding the public key
(`ACCOUNTS_PUBLIC_KEY`, in the relay's settings and Bridge AI's code) can check one offline.
Each is `base64url(JSON payload) + "." + base64url(signature)`.

| Token | Payload | Lasts | Used for |
| --- | --- | --- | --- |
| **Device token** | `{ k: "device", a, d, iat, exp }` | 180 days, renewed by `GET /v1/me` | every call to the accounts service from that device |
| **Relay token** | `{ k: "relay", a, d, iat, exp }` | 7 days, renewed by `GET /v1/me` | a computer registering with, and connecting to, the relay |
| **Early Access code** | the format of `server/earlyaccess.js` (#158), label = the account's id | 30 days, renewed by `GET /v1/me` | the updater's Early Access channel |

`a` is the account id, `d` the device id (both 12 lowercase letters and digits). A device token is
also kept hashed (SHA-256) in D1, so signing out or removing a device ends it before it expires.
`iat` and `exp` are in seconds. The Early Access code's label is the account's id, not its email:
server/earlyaccess.js takes only letters, digits and a few marks in a label, and the label goes with
the usage stats, which never carry an email. Bridge AI checks a code with either the owner's key
(`PUBLIC_KEY`) or `ACCOUNTS_PUBLIC_KEY`.

## The API

JSON in and out. Errors are `{ error: "<a sentence for the person>", code: "<word>" }` with an
HTTP status. A device token goes in `Authorization: Bearer <token>`.

### Signing in

`POST /v1/code { email }` sends a code. `200 { sent: true }`. Errors: `invalid`, `throwaway`,
`too-many` (with `retryAfter` seconds), `suspended`, and `unsent` (502) when the email couldn't be
sent (nothing is counted then).

`POST /v1/verify { email, code, device: { name, kind: "computer" | "phone", platform }, replace? }`
checks it and adds the device. `200 { account, device, deviceToken }`. Errors: `wrong` (with
`triesLeft`), `expired` (also after the fifth wrong try), `devices` (409, with `devices: [...]`),
`suspended`. A `devices` refusal leaves the code good, so the same code with `replace: <device id>`
removes that device and adds this one in its place.

`account` is `{ id, email, tester, relay, status, createdAt }`; a `device` is
`{ id, name, kind, platform, createdAt, lastSeen, thisOne }`.

### Linked computers follow

A computer already signed in can sign in another of the person's computers (linked to it in
Bridge AI), without an email round trip:

`POST /v1/grant` (device token) gives `{ grant }`: a one-time grant, good for 5 minutes. The
signed-in computer hands it to the other over their existing end-to-end link.

`POST /v1/redeem { grant, device, replace? }` adds that device. It answers like `/v1/verify`, with
the same 5-device limit (and `replace`); a grant that ran out, or was used, is `expired`.

### Who I am, and what I may use

`GET /v1/me` (device token) gives
`{ account, devices, earlyAccess: { code } | null, relay: { token, limits, used } | null }`, and
renews whichever tokens are past half their life (a new device token comes as `deviceToken`; the old
one keeps working until the new one is used). It also marks the device seen. A device token that's
signed out, removed or past its end is refused with `signed-out` (401) on every call.

- `earlyAccess` only when `tester: "yes"`.
- `relay` only when `relay: "approved"` and the device is a computer.
- `limits` is `{ window: { hours: 8, messages }, week: { messages }, devices: 5 }`.
- `used` is the relay's own count, `{ window: { messages, resetsAt }, week: { messages, resetsAt } }`,
  as it last reported it (every few minutes while the account uses it; a window or week that has
  ended since reads 0), or `null` before it has reported any.

Bridge AI asks it at start, then every 6 hours, and when Settings › Account is opened.

### Requests

`POST /v1/request { kind: "early" | "relay", note }` (device token) asks for Early Access or the
relay. `200 { account }`. It's kept for the admin view, and the admins' emails get a short note.

`POST /v1/request-public { email, kind, note, os }`, from the form on boldbridge.ai, does the same
without a sign-in. It's limited per network, and the email gets a code to confirm before the request
counts: `200 { sent: true }`, then the same with `code` gives `200 { account }` (the account is made
if it's new). Only this route answers another origin (`SITE`, CORS).

### Devices and leaving

`DELETE /v1/devices/:id` (device token) removes one of the account's devices, this one included:
`200 { account, devices }`.

`POST /v1/signout` (device token) removes this device.

`DELETE /v1/account` (device token, with `{ email }` typed again) deletes the account, its devices
and its requests: `200 { deleted: true }`, or `mismatch` if the email isn't the account's. The relay
forgets its counts within a day.

### For the admin view only

These aren't on the public address (it answers 404). The admin view's Worker reaches them through a
**service binding** named `ACCOUNTS` to the Worker `bridge-accounts` and its named entrypoint
`Internal`, which nothing on the internet can reach (`services = [{ binding = "ACCOUNTS", service =
"bridge-accounts", entrypoint = "Internal" }]`), at any address (`https://accounts.boldbridge.ai/admin/…`).
Each call carries the signed-in admin's email in `X-Admin-Email`, which is written to the account's
history as `by`; without it, `400 admin`.

| Call | Answers |
| --- | --- |
| `GET /admin/stats` | `{ accounts, devices, testers, relayAccounts, waiting: { early, relay }, codesToday, codesMonth, relayMax }` (relayMax: the relay's `MAX_ACCOUNTS`, as `RELAY_MAX_ACCOUNTS` in the service's settings) |
| `GET /admin/requests?kind=&state=` | `{ requests: [{ account, email, kind, note, os, at }] }`, newest first; `account` is its id; `state` is `open` unless it says (`approved`, `declined`, `all`) |
| `GET /admin/accounts?q=&page=&tester=&relay=&sort=use` | `{ accounts: [{ ...account, devices, lastSeen, used }], limits, page, pages, total }`, 50 a page; `q` an email (or part of one) or an id; `tester`, `relay` a flag's value; `sort=use` the week's relay use, heaviest first |
| `GET /admin/accounts/:id` | `{ account, devices, history: [{ at, by, what, note }], usage: [{ day, messages }], used, limits }` (the relay's use by day, 90 days) |
| `POST /admin/accounts/:id { tester?, relay?, status?, note? }` | `{ account, emailed }`: approve, decline, suspend or restore. `tester` is `none`, `yes` or `declined`; `relay` `none`, `approved` or `declined`; `status` `active` (Restore) or `suspended`, and either needs a `note` (`400 note`). Emails the person when `tester` becomes `yes` or `relay` `approved` (`emailed` false when none went, or it couldn't be sent). Approving the relay with `relayMax` accounts approved: `409 { error, code: "full" }` |
| `POST /admin/invite { email, tester: "yes", note? }` | `{ account, created, emailed }`: makes the account if it's new, marks it, and emails an invitation (`relay: "approved"` works too) |
| `DELETE /admin/accounts/:id/devices/:dev` | `{ devices }` |

`used` and `limits` are as in `GET /v1/me`. The relay uses the same entrypoint for `GET
/internal/status?a=` (`{ status: "active" | "suspended" | "gone", relay, tester }`) and `POST
/internal/usage` (below).

## The relay's side

- **Registering a computer** (`POST /_relay/register`) needs `Authorization: Bearer <relay token>`.
  The relay checks the signature and expiry offline and keeps `{ a, d }` with the computer. One relay
  address per device: registering again with the same `d` gives the same address back.
- **Connecting** (`/_relay/host`) needs the computer's own token, as now, and a relay token that
  hasn't expired, in `X-Relay-Token`, for the same account. Bridge AI sends a fresh one each time it
  connects.
- **Each account's use** is kept by a Durable Object per account (`idFromName(a)`), fed by the
  account's Hubs as they tally messages. Limits are the relay's settings:

  | Setting | Default | Means |
  | --- | --- | --- |
  | `ACCOUNT_WINDOW_HOURS` | 8 | the window, starting at the first message after the last one ended (as Claude's are) |
  | `ACCOUNT_WINDOW_MESSAGES` | 150,000 | more than a phone watching a terminal for all 8 hours |
  | `ACCOUNT_WEEK_MESSAGES` | 1,000,000 | about 60 hours of watching a terminal, 400 of chat; the week starts on the account's first use |
  | `MAX_ACCOUNTS` | 500 | accounts with a computer on the relay; past it, approving one says the relay is full (the service's `RELAY_MAX_ACCOUNTS` is the same number), and a new account's first computer is refused as full |

  Past either limit, the account's phones are told why and when it resets (`{ t: "limit", why:
  "window" | "week", until }`) and let go; its computers stay registered, and phones can connect
  again once it resets. `RELAY_DAILY_REQUESTS` stays as the whole relay's backstop.
- **Suspension** takes effect within a minute: the relay asks the accounts service (service
  binding `ACCOUNTS`, `GET /internal/status?a=`) when a computer registers or connects, when a phone
  connects, and every few minutes while anything passes; it keeps the answer for a minute. A
  computer whose account is suspended, has no relay any more or was deleted hears
  `{ t: "limit", why: "suspended" | "relay" | "deleted" }` and is let go with its phones.
- **The use is reported** to the accounts service (`POST /internal/usage { a, window, week, days:
  { "<day>": messages }, limits }`, service binding) every few minutes per account while it's used,
  and once a day otherwise, for `GET /v1/me` and the admin view; the answer is the account's status.

## Switching it on

Like the relay, all of this is hidden until it's switched on. In Bridge AI, `ACCOUNTS_URL` in
server/accounts.js is empty until the service is deployed, and while it is, nothing about
accounts shows, and the hosted relay and Early Access work as they do without one. The owner's
steps are in [README.md](README.md).
