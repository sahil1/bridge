# Bold Bridge accounts

For whoever runs it. Everyone else can ignore this file: Bridge AI works without an account, and
setup never asks for one.

[worker.js](worker.js) is a Cloudflare Worker at `https://accounts.boldbridge.ai`, run once by the
project: the account a person signs into with their email, one per email, for the two things Bold
Bridge runs for them, **Early Access** and **Bridge AI's relay**. [API.md](API.md) is the contract it
keeps with the relay, Bridge AI (server/account.js, Settings › Account) and the admin view.

## What it does

- **Sign-in is an email and a 6-digit code**, sent from `accounts@boldbridge.ai` by Cloudflare's <!-- private-ok: the service's own sending address -->
  Email Service. A code lasts 10 minutes and allows 5 tries, each wrong one counted in the same
  statement that checks it (so guesses sent all at once are held to 5 too), and the right one is used
  up once; an email gets at most 5 codes an hour, a network (IPv4 /24, IPv6 /48) at most 20, and the
  website's form 5 requests an hour per network. After 20 wrong codes in a day, an email gets no codes
  for a day (where it's signed in already, nothing changes). `THROWAWAY` in worker.js is a short list
  of throwaway domains, refused, saying why. An email's first sign-in makes its account, and each
  device signed in after that is said in an email to it. A suspended account's email is answered as
  any other's (whoever asked can't tell), and the email says it's suspended, with no code.
- **At most 5 devices**, computers and phones. A sixth sign-in is refused with the list, and the same
  code can then remove one to make room.
- **Tokens**, signed with Ed25519 (`SIGNING_KEY`): a device token (180 days), a relay token for a
  computer whose account may use the relay (7 days), and an Early Access code for a tester's
  computer (30 days, in `server/earlyaccess.js`'s format, for the account's id). `GET /v1/me` renews
  each past half its life. The relay and Bridge AI check them offline with the public half.
- **Linked computers follow**: a computer signed in can hand another of the person's computers a
  one-time grant (5 minutes) over the link between them, and that one signs in with it.
- **Requests**: Early Access and the relay are asked for (in Bridge AI, or the form on boldbridge.ai,
  which confirms the email with a code first), and an admin says yes or no in the admin view. The
  emails in `ADMINS` get a short note for each request.
- **What's kept**, in D1: each account's email, flags (`tester`, `relay`, `status`) and when it was
  made; its devices (name, computer or phone, platform, when added and last seen, a hash of the
  token); its requests; its history (what was done, by whom, with a note); the relay's last report of
  its use and its use by day (90 days). Codes are kept as hashes until used or ended; codes sent in
  the last hour, under a hash of the email and of the network, for an hour; wrong codes, under a hash
  of the email, for a day. Never anything from the
  person's computer. The Worker's logs are off (`[observability]` in [wrangler.toml](wrangler.toml)).
- **Deleting an account** (`DELETE /v1/account`) deletes all of that at once. The relay forgets its own
  counts within a day.

The tables are made the first time they're needed. Once a day (the cron), codes, grants, the hour's
counts and the day's wrong codes that ran out go, and the relay's use by day after 90 days.

## How the admin view and the relay bind to it

Only the public routes (`/v1/...`) are on `accounts.boldbridge.ai`; `/admin/...` and `/internal/...`
answer 404 there. They're on the Worker's named entrypoints, which a service binding can name and
nothing on the internet can reach: `Internal` (the admin view's: `/admin` and `/internal`) and
`Relay` (the relay's: `/internal` only, so a relay Worker that was taken over still can't reach the
admin routes). Any address works through them (the host isn't looked at).

- **The admin view** (boldbridge.ai/admin, in the private repo), in its own wrangler config:

  ```toml
  [[services]]
  binding = "ACCOUNTS"
  service = "bridge-accounts"
  entrypoint = "Internal"
  ```

  and calls `env.ACCOUNTS.fetch('https://accounts.boldbridge.ai/admin/…', { headers: { 'X-Admin-Email': <the signed-in admin> } })`.
  Whoever can deploy a Worker on the project's Cloudflare account can bind to it, so that's who
  the admin routes are open to; the admin view decides which signed-in people are admins.
- **The relay** ([relay/wrangler.hosted.toml](../relay/wrangler.hosted.toml)) binds to `Relay`
  instead (`entrypoint = "Relay"`), for `GET /internal/status?a=&d=` and `POST /internal/usage`.

## Settings

All in `[vars]` of [wrangler.toml](wrangler.toml).

| Variable | Default | What it does |
| --- | --- | --- |
| `FROM` | `accounts@boldbridge.ai` <!-- private-ok: the service's own sending address --> | The address codes and notices come from. Its domain is onboarded on Email Service. |
| `ADMINS` | | Emails (comma separated) that get a short note for each request. Empty: requests are only in the admin view. |
| `SITE` | `https://boldbridge.ai` | The website, whose form may ask for Early Access or the relay (`/v1/request-public`, the only route open to another origin). |
| `RELAY_MAX_ACCOUNTS` | `500` | The relay's `MAX_ACCOUNTS`, the same number: approving the relay for one account more is refused as full. `GET /admin/stats` says it as `relayMax`. |

One secret, set with `npx wrangler@4.149.0 secret put SIGNING_KEY -c account/wrangler.toml` and never
in the file: `SIGNING_KEY`, the Ed25519 private key every token is signed with, as PKCS #8 PEM.

## Going live

In this order, on the project's Cloudflare account, from the repo on the computer releases are made
on, signed in to Cloudflare (`npx wrangler@4.149.0 login`), with boldbridge.ai already a zone there.
The relay ([relay/HOSTED.md](../relay/HOSTED.md)) goes live after this, since it binds to it.

1. **Workers Paid** (Workers & Pages › Plans, $5 a month): Email Service sends to anyone only on
   Workers Paid. The relay needs it anyway.
2. **The sending domain**: Compute › Email Service › Email Sending › Onboard Domain › boldbridge.ai ›
   Done. Cloudflare adds what sending needs: MX records on the `cf-bounce` subdomain for bounces, a
   TXT record for SPF, one for DKIM, and DMARC on `_dmarc.boldbridge.ai`; it usually takes 5 to 15
   minutes. If boldbridge.ai has an SPF or DMARC record already (another mail service), merge them
   rather than keep two.
3. **The key**: `node account/key.js`. It makes the key pair once, keeps the private key in
   `~/.config/bridge-ai/accounts-key.pem` (put a copy in a password manager; never in the repo), and
   prints the public key and the commands for the next steps.
4. **The database**: `npx wrangler@4.149.0 d1 create bridge-accounts`, then put the `database_id` it
   prints into [wrangler.toml](wrangler.toml).
5. **The settings**: your email in `ADMINS` (or leave it empty), and `RELAY_MAX_ACCOUNTS` the same as
   the relay's `MAX_ACCOUNTS`.
6. **Deploy**, then the secret:

   ```sh
   npx wrangler@4.149.0 deploy -c account/wrangler.toml
   npx wrangler@4.149.0 secret put SIGNING_KEY -c account/wrangler.toml < ~/.config/bridge-ai/accounts-key.pem
   ```

   The custom domain makes the DNS record and certificate for `accounts.boldbridge.ai` itself.
7. **The rate limiting rule** (required, before anyone is told the address): boldbridge.ai ›
   Security › WAF › Rate limiting rules › Create rule. When incoming requests match: Hostname equals
   `accounts.boldbridge.ai`. With the same characteristics: IP. When rate exceeds 30 requests per
   10 seconds, Block for 10 seconds (the Free plan's one rule does it). The Worker's own limits (5
   tries a code, 20 wrong codes a day for an email, codes an hour for an email and a network) are
   counted in D1, after the Worker has run; this turns a burst from one address away before it does,
   where nothing is billed, and keeps a burst of guesses from reaching D1 at all. Bridge AI's own use
   is far below it.
8. **Check it**: `https://accounts.boldbridge.ai/` sends a browser to the privacy policy;
   `curl -s -X POST https://accounts.boldbridge.ai/v1/code -H 'content-type: application/json' -d '{"email":"x"}'`
   answers `{"error":"That doesn't look like an email address…","code":"invalid"}`;
   `https://accounts.boldbridge.ai/admin/stats` is a 404. Then ask for a code to your own email, and
   it arrives. 40 requests in a few seconds from one computer (`for i in $(seq 40); do curl -s -o
   /dev/null -w '%{http_code} ' https://accounts.boldbridge.ai/; done`) end in 429s: the rule is on.
9. **The public key in the relay**: `ACCOUNTS_PUBLIC_KEY` in relay/wrangler.hosted.toml (`node
   account/key.js --public` prints it again), and go live with the relay (HOSTED.md).
10. **The admin view**: its binding, as above, and deploy it.
11. **Try it on one computer** before shipping, with this in that computer's
    `~/.bridge-ai/config.json`: `"account": { "url": "https://accounts.boldbridge.ai", "publicKey": "<the public key>" }`.
    Settings › Account appears; sign in, ask for Early Access, approve it in the admin view, and
    About & Updates says Early Access is on with your account.
12. **Ship it**: in server/account.js, set `ACCOUNTS_URL = 'https://accounts.boldbridge.ai'` and
    `ACCOUNTS_PUBLIC_KEY` to the public key, and paste the policy text below into PRIVACY.md and
    TERMS.md, in the same commit. Then `npm test -- account-service relay-hosted privacy-hosts`, and
    release. Until that commit, nothing about accounts shows in the app.

## Cost

On Workers Paid, which the relay needs anyway. Each sign-in is about five Worker requests and a few
dozen D1 rows, so even 10,000 sign-ins a month are far inside Workers Paid's 10 million requests and
D1's included rows (25 billion read, 50 million written). Each Bridge AI signed in asks `GET /v1/me`
about 4 times a day: 500 accounts with 5 devices each come to 300,000 requests a month. The relay
reports each account's use every 5 minutes while it's used: at most 4.3 million a month for 500
accounts, through the service binding, which isn't billed as requests. Email Service includes 3,000
emails a month, then $0.35 a thousand: codes are at most 5 an hour per email, so a flood of
sign-ins costs little, and the WAF rule above stops one network sending it.

## Running your own

A fork can run its own on its own Cloudflare account: change `name`, the route and `FROM` in
wrangler.toml, onboard its own sending domain, make its own key, and point its build at it
(`ACCOUNTS_URL`, `ACCOUNTS_PUBLIC_KEY` in server/account.js), with its relay's `ACCOUNTS_PUBLIC_KEY`
and binding to match. `PRIVACY` in worker.js is where a browser opening the address goes.

## Policy text to add when it goes live

Paste these in the same change that sets `ACCOUNTS_URL`. Until then PRIVACY.md and TERMS.md stay as
they are. The `account-service` test keeps these in step: each "Replace" must still be word for word
in its file, and pasted in, they must say what the account keeps and sends, and how to delete it.

### PRIVACY.md: the opening paragraph

Replace

> There is no account and no ads.

with

> There are no ads, and there's no account unless you want Early Access or Bridge AI's relay, which
> come with a Bold Bridge account (below).

### PRIVACY.md: in "Usage stats", who an early-access code is for

Replace

> who the code is for: the first name or nickname
> the project gave that tester when it made the code;

with

> who the code is for: the first name or nickname
> the project gave that tester when it made the code, or, with Early Access from your Bold Bridge
> account, that account's id (below);

### PRIVACY.md: in "Usage stats", what they don't have

Replace

> Neither has your name (on Early Access, the tester's name is the one the project chose for the
> code it gave them), an ID for you or your computer

with

> Neither has your name (on Early Access, the tester's name is the one the project chose for the
> code it gave them, or your Bold Bridge account's id), an ID for your computer

### PRIVACY.md: in "Crash reports"

Replace

> with the tester's name the project chose)

with

> with the tester's name the project chose, or your Bold Bridge account's id)

### PRIVACY.md: a new section after "Crash reports (on unless you turn them off)"

> ## Your Bold Bridge account (optional)
>
> Early Access and Bridge AI's relay come with a Bold Bridge account. Nothing else needs one, and
> Bridge AI never asks you to make one. You sign in in Settings › Account with your email and a
> 6-digit code it's sent (there's no password), at `accounts.boldbridge.ai`, run by the project on
> Cloudflare; its code is [account/worker.js](account/worker.js) in this repo.
>
> **What it keeps**: your email; your devices (five at most): the name each was given (your
> computer's name in Bridge AI), whether it's a computer or a phone, its system, when it was added
> and last used, and a hash of its sign-in token; whether you asked for or have Early Access and the
> relay, and whether the account is suspended; your requests and their notes; what was changed on
> the account and by whom; and, if you use Bridge AI's relay, its counts for your account (messages
> in each 8-hour window and each week, and each day's total, kept 90 days). To limit codes, it keeps
> for an hour how many were sent to each email and from each network, and for a day the wrong codes
> entered for each email, under a hash of each. Never
> anything from your computer: your agents, meetings, mail, files and what you type stay there.
>
> **What goes with it**: your email, when you sign in or ask for something; the codes and notices
> emailed to you, sent with Cloudflare's Email Service; and, on Early Access, your account's id in the
> usage stats and crash reports (above), so the project can tell testers' reports apart.
>
> **Your other computers**: once one of your computers is signed in, it can sign in the others linked
> to it (Settings › Account), over the end-to-end encrypted link between them. One that would rather
> not says so, and is left alone.
>
> **Leaving**: Sign out, or remove a device, in Settings › Account. Delete account there deletes the
> account, its devices, requests, history and counts at once (Bridge AI's relay forgets its own within
> a day). Bold Bridge's admins see what's kept, to answer requests, and can suspend an account that
> misuses Early Access or the relay.

### TERMS.md: in "Privacy"

Replace

> The project collects nothing that identifies you.

with

> The project collects nothing that identifies you, unless you make a Bold Bridge account (below).

### TERMS.md: a new section after "Your accounts with other services"

> ## Your Bold Bridge account
>
> A Bold Bridge account is optional. It's for Early Access and Bridge AI's relay, one per email with
> up to five devices, and you can delete it at any time in Settings › Account. Early Access and the
> relay are by request or invitation: the project may say no, and may stop either for an account at
> any time. Anyone who can read your email can sign in to your account, so keep it yours. The project
> may suspend an account that misuses Early Access or the relay.
