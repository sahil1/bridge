# What to enter in Play Console

The answers for each Play Console form, true to the code as of 2.3.0. The steps around them are in
[../PLAY.md](../PLAY.md). If the app changes what it stores or sends, change these first.

## Store listing

- **App name**: Bridge AI
- **Short description**: [short-description.txt](short-description.txt) (77 of 80 characters)
- **Full description**: [full-description.txt](full-description.txt) (about 1,800 of 4,000)
- **App icon**: [icon-512.png](icon-512.png) (512 x 512, full square; Play rounds the corners)
- **Feature graphic**: [feature-graphic.png](feature-graphic.png) (1024 x 500). Sources: `icon.svg`
  and `feature-graphic.svg`, made from `public/mark.svg`.
- **Phone screenshots**: [screenshots/](screenshots) (1080 x 2160, made-up computers and agents):
  1. `1-pair.png`: pairing, with another computer already paired
  2. `2-lock-screen.png`: agents on the lock screen
  3. `3-agents.png`: the agents notification opened up

  Worth adding, from Try the demo (made-up agents, nothing private on screen): the agent list, and
  one agent's conversation with a question waiting.
- **Category**: Productivity (Tools also fits). Play has no developer-tools category.
- **Tags**: up to five from Play's list; the ones closest to developer tools and remote access.
- **Contact email**: required and shown publicly. Use an address you're happy to publish.
- **Website**: https://github.com/sahil1/bridge
- **Privacy policy**: https://github.com/sahil1/bridge/blob/main/PRIVACY.md

## App content

### Privacy policy

The URL above. It has to be public, so the repo must be public, and `PRIVACY.md` must be on `main`
before you submit.

### App access

All functionality is available without special access: the app has no account or login, and
**Try the demo** on its start screen opens the whole app on made-up agents, with no computer and no
sign-in. Real use pairs with Bridge AI on the user's computer, by QR code. Instructions to paste:

> No sign-in is needed. On the first screen, tap Try the demo. It opens the full app on made-up
> agents and data, bundled in the app: open an agent, send it a message, answer its question card,
> and review its changes. "Pair a computer" at the top goes back to the first screen.
>
> In real use, Bridge AI is the phone app for Bridge AI, a free, open-source desktop app (macOS,
> Windows, Linux) that runs AI coding agents on the user's own computer. The phone app pairs with
> that computer by QR code: in Bridge AI on the computer, Settings > Phone & notifications > Pair a
> phone. Then it shows the agents running there, and lists the ones at work on the lock screen.
>
> A video of pairing and the lock-screen notification: <link to an unlisted YouTube video>

The demo covers app access. The video is still needed for the foreground service declaration
below (the demo doesn't show the agents notification), so record it: pairing, an agent working,
the lock-screen notification, answering from the phone.

### Ads

No, the app doesn't contain ads.

### Content rating

The questionnaire's wording changes from time to time; answer what it asks against what the app
does. Category: the utility, productivity, communication or other one (not a game, not social, not
news or reference). Answer No to violence, sexuality, language, controlled substances, gambling and
the rest. On the questions about users:

- Users interact or exchange content with each other: **No**. It shows your own computer, to you.
- Shares the user's location with others: **No**.
- Digital purchases: **No**.
- Unrestricted internet access (like a web browser): **No**. Links to other sites open in your browser.
- If it asks about AI-generated content: the app shows the output of AI coding agents that you run
  on your own computer with your own accounts; it doesn't generate anything itself.

### Target audience and content

18 and over (13 to 17 also works, but nothing below 13, so the Families policy doesn't apply). Not
designed for children; doesn't appeal to them.

### News app, Government app, Financial features, Health

No, not a government app, no financial features, no health features. Each form still has to be
answered.

### Data safety

**Does your app collect or share any of the required user data types? No.**

Why that's true:

- Everything the app sends off the phone goes to your own computer over an end-to-end encrypted
  link (`relay/web/link.js`). Google's rules exempt that: "User data that is sent off device, but
  that is unreadable by you or anyone other than the sender and recipient as a result of end-to-end
  encryption does not need to be disclosed."
- It goes through a relay, a Cloudflare Worker on the user's own Cloudflare account. The developer
  doesn't run it and gets nothing from it. It passes encrypted bytes and stores only when the
  computer was last online.
- No SDKs that collect anything. The only libraries are zxing-android-embedded (scans the QR code
  on the phone), AndroidX Core and AndroidX WebKit (serves the demo from the app's own files). No
  analytics, crash reporting, ads, Firebase or Google Play services.
- The demo (Try the demo) runs entirely on the phone, from files in the app, on made-up data. It
  sends nothing anywhere.
- The camera is used only to scan the pairing QR code; frames stay on the phone.
- The microphone is used only when you dictate a message in Bridge AI; the recording goes
  end-to-end encrypted to your computer, which turns it into text (whisper.cpp, on the computer).
- On the phone: the list of paired computers (relay address and the computer's name) in the app's
  preferences, and each computer's pairing (the phone's key) in the WebView's storage. Both are
  left out of Android backups and transfers to a new phone (`res/xml/no_backup.xml`).

What the relay and Cloudflare do see, in plain text: the phone's IP address, when it connects and
how much it sends, and the app's user agent (which says `BridgeAIApp/<version>`). That's under the
user's own Cloudflare account, never the developer's, and `PRIVACY.md` says so.

No account, so nothing for account deletion.

### Foreground service permissions

Declare **Special use** (`FOREGROUND_SERVICE_SPECIAL_USE`, `AgentsService`).

Description of the feature:

> Bridge AI is the phone app for Bridge AI on the user's computer, which runs AI coding agents
> there. While any of those agents are working or waiting on the user, the app shows an ongoing
> notification, on the lock screen too, listing them and saying which one needs the user; one that
> starts waiting on the user also gets its own alert. The foreground service keeps that
> notification current: it keeps the app's end-to-end encrypted link to the user's computer open
> while the phone is locked, and updates the notification as agents start, finish or begin
> waiting. It starts only when the user has the app open and agents are active, and stops on its
> own when all of them are done. The user can stop it at any time by swiping the app away or from
> Android's active apps list.
>
> No other type fits. It isn't a transfer of a set amount of data (dataSync), media, location, a
> call, or a nearby device. Push messaging (FCM) isn't possible: the app has no server of its own;
> it connects only to a relay on the user's own Cloudflare account, and the link is end-to-end
> encrypted, so nothing in between can know an agent's state.

User impact if the task is deferred or interrupted:

> The notification would go stale: it would show agents working after they finished, or miss one
> that started waiting on the user, so the agent sits idle until the user happens to open the app.
> Being told promptly that an agent needs an answer is the point of the feature.

Video: the unlisted video from App access, showing the notification on the lock screen updating
as an agent works, then waits, then finishes.

## Release notes

Copy from CHANGELOG.md, the phone parts of the version's section, under 500 characters.
