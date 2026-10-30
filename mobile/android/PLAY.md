# Publishing on Google Play

Ready in the repo: the app targets Android 16 (API 36, Google Play's minimum since August 31, 2026),
release builds are shrunk with R8 and signed with your upload key from outside the repo, and
`npm run mobile:android:release` makes the bundle Play wants (an AAB). The listing text, graphics,
screenshots and every Play Console answer are in [play/](play) ([play/console.md](play/console.md)).
The privacy policy is [PRIVACY.md](../../PRIVACY.md).

What only you can do, in order:

## 1. The developer account

At https://play.google.com/console/signup. Two kinds:

- **Personal** (what you want unless you have a company): US$25 once, a government ID and a card in
  your legal name, and an Android phone with the Play Console app to verify it. New personal
  accounts must run a closed test with **12 testers for 14 days in a row** before they can publish
  (step 5).
- **Organization**: no closed-test rule, but it's for a legal entity and needs a D-U-N-S number
  (free from Dun & Bradstreet, up to 30 days to get), the organization's website and phone.

Android's developer verification (2026 and 2027) needs nothing more: an account that finished Play's
identity check counts as verified, and Play registers its apps.

## 2. The upload key

You sign each bundle with this key; Google re-signs the app for phones with its own key (Play App
Signing). Make it once, outside the repo:

```sh
mkdir -p ~/.android-keys && cd ~/.android-keys
"/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool" -genkeypair -v \
  -keystore bridge-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Bridge AI"
chmod 600 bridge-upload.jks
```

Use a long random password from your password manager (the same one for the store and the key is
fine). Back up `bridge-upload.jks` and the password together in the password manager, plus one
offline copy. If it's ever lost or leaked you aren't locked out: make a new key and use Play
Console › Protected with Play › Play Store protection › Manage Play app signing › Request upload
key reset, upload the new key's certificate, and wait for Google to approve it.

Tell the build where it is, in `~/.gradle/gradle.properties` (make that file `chmod 600`):

```properties
BRIDGE_UPLOAD_STORE_FILE=~/.android-keys/bridge-upload.jks
BRIDGE_UPLOAD_STORE_PASSWORD=<the password>
BRIDGE_UPLOAD_KEY_ALIAS=upload
BRIDGE_UPLOAD_KEY_PASSWORD=<the password>
```

Environment variables with the same names work too (for CI). Without them the build still works
but says it's unsigned, and Play won't take it.

## 3. Build

```sh
npm run mobile:android:release
```

It prints where the bundle is: `mobile/android/app/build/outputs/bundle/release/app-release.aab`
(about 0.7 MB). The version is Bridge AI's own from `package.json`; the version code Play needs is
made from it (2.3.0 is 20300), so every new version goes up by itself. Play never takes the same
version code twice: to upload again, bump the version.

## 4. Create the app

In Play Console: Create app, name **Bridge AI**, English (United States), App, Free. Then fill in
Store listing and everything under App content from [play/console.md](play/console.md). Before
you do:

- Push `PRIVACY.md` to `main` (the repo must be public; Play links to it).
- Record a short unlisted YouTube video: pair the phone, start an agent on the computer, lock the
  phone, show the notification updating as the agent works, waits on you and finishes, and answer
  from the phone. The foreground service declaration needs it; App access links it too, but
  reviewers can use Try the demo there instead.

## 5. Closed test (personal accounts)

1. Make a Google Group for testers (or use an email list).
2. Play Console › Closed testing: create a track, add the group as testers,
   create a release and upload the AAB. The first upload asks you to accept Play App Signing: accept
   the Google-generated key. Add release notes and send it for review (hours to a few days).
3. Send testers the opt-in link from the track's Testers tab. On their phone they open it with the
   Google account in the group, accept, and install from Play. They need an Android phone; having
   Bridge AI on a computer makes their feedback useful but isn't needed to count.
4. Keep 12 or more opted in for 14 days in a row. Recruit 15 to 20 so a few dropping out doesn't
   restart the clock: colleagues, friends, people who starred the repo. Ask them to keep it
   installed, try it if they can, and tell you what broke.
5. Ship fixes to the closed track during the 14 days if feedback calls for it; the production
   application asks what you learned and changed.
6. After day 14: Dashboard › Apply for production. Answer the questions about the test. Review takes
   up to 7 days, sometimes longer.

Realistic timeline from signing up: identity check a few days, closed test live in 1 to 3 days, 14
days of testing, up to a week for production access, then a few days for the first production
review. About 4 weeks.

## 6. Production

Production › Create release: promote the closed-test release or upload the AAB, add release notes,
choose countries, and start a staged rollout (say 20%, then 100% after a day or two with no crash
reports in Android vitals). The listing goes live once the review passes.

## 7. Each release after that

1. Bump the version in `package.json` and `desktop/package.json` and write the CHANGELOG section,
   as for any Bridge AI release.
2. `npm run mobile:android:release`.
3. Play Console › Production › Create release, upload the AAB, paste the phone parts of the
   changelog as release notes (500 characters), roll out.

Each August Google raises the minimum target (expect API 37 by August 2027). Before then, raise
`compileSdk` and `targetSdk` in `app/build.gradle.kts`, read Android's behavior changes for that
version, and test on an emulator.

## Risks

- **App access.** Reviewers can't pair without Bridge AI on a computer, and pairing codes last 15
  minutes, so there's no lasting login to give them. Instead, **Try the demo** on the start screen
  opens the whole app on made-up agents, bundled in it (`npm run demo:build`, built into the app's
  assets by Gradle), with no sign-in. Real use still pairs with a computer, and console.md says so.
  If review still wants a real computer: a review computer whose pairing code lasts longer
  (`PAIR_MINUTES` and `PAIR_USES` in `server/relay.js`).
- **Foreground service.** Special use is reviewed by hand against "runs only as long as needed" and
  "can't be deferred". The declaration explains why no other type fits. If it's rejected: add a
  Stop button to the agents notification, or switch to the connected device type
  (`FOREGROUND_SERVICE_CONNECTED_DEVICE` plus `CHANGE_NETWORK_STATE` in the manifest,
  `connectedDevice` on the service, `FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE` in
  `AgentsService.kt`) and declare that.
- **WebView apps.** Play rejects apps that are just a website in a WebView. This one has its own
  QR pairing, several computers, and the lock-screen agents notification, and the listing says it
  needs Bridge AI on a computer. The "webview of a website without permission" rule is about other
  people's sites; this opens only your own relay.
- **The JavaScript bridge.** Play flags a WebView with a JavaScript interface that loads untrusted
  pages. Release builds load only `https` pages on the paired relay and open everything else in
  the browser. A later hardening: androidx.webkit's `addWebMessageListener` limited to the relay's
  origin, so frames from other sites inside the page can't reach `window.bridgeAndroid`.
