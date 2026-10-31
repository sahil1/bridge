# Bridge AI for iPhone and Android

The phone apps show Bridge AI from your computer through your own relay (Settings › Devices on the
computer), the same way the relay's page does in Safari or Chrome, end-to-end encrypted. Both use the relay's own phone page (`relay/web`), so pairing and the link work the same
everywhere.

- **iPhone** (`ios/`): the app serves the phone page itself and carries Bridge AI's requests over
  the encrypted link (`Tunnel.swift`), because iOS apps can't run a service worker for an address
  that's different for every relay.
- **Android** (`android/`): opens your relay's page in a WebView, which runs its service worker as
  Chrome does.

Pair by scanning the QR code from Pair a device on the computer, or by pasting the link from Copy
link.

## The demo

Before any computer is paired, the start screen also offers **Try the demo**: Bridge AI's own UI
on made-up agents (`src/demo/`), bundled in the app and run on the phone with no network. "Pair a
computer" in its top strip, or Back, returns to the start screen. Android serves it from the app's
assets (`https://appassets.androidplatform.net/assets/demo/`), iPhone from `bridge-ui://demo/`
(`BundledUI.swift`). Each app's build runs `npm run demo:build` into its own build folder, so
nothing built is committed. Other bundled UIs can be added the same way: a name in
`bundledUis` (Android) and in `project.yml` (iPhone).

## Cloud Agents

The start screen, paired or not, also offers **Cloud agents**: agents on Cursor, GitHub Copilot,
Jules or Claude, run and followed from the phone with no computer. So does a long press on the app
icon (an Android shortcut, an iPhone quick action). It's a second bundled UI, `npm run
cloud:build` (`src/cloud/`), with a small backend on the phone answering the UI's cloud requests
through the same provider code as the computer (`shared/cloud/`). Android serves it from
`https://cloud.appassets.androidplatform.net/assets/cloud/`, iPhone from `bridge-ui://cloud/`.

The keys stay with the app, never in the page:

- iPhone: in the Keychain, this device only (`CloudBridge.swift`).
- Android: encrypted with an AES key in the Android Keystore, in the app's no-backup storage
  (`CloudBridge.kt`).
- The page asks the app for each request (`src/cloud/native.js`). The app checks the address is
  that provider's own (from `providers.json`, made from `shared/cloud` at build time), adds the key
  and sends it, with no redirects. The page can save, test or remove a key and learn whether one
  is set and its last four characters. The channel exists only for the Cloud agents page: Android
  limits it to that origin, and iPhone adds it only while Cloud agents is showing.

The agents started from the phone, and what was sent to them, are kept by the app too, per provider,
and forgotten with the key. While the app is open it checks on them as Bridge AI on a computer
does. Android also checks about every 15 minutes in the background (WorkManager, `CloudCheck.kt`)
while a key is saved and notifications are allowed, and posts a notification when an agent
finishes, fails or needs you. iPhone checks only while the app is open. A computer's own cloud
agents are separate: the phone only follows the ones it started, with its own keys, so nothing is
announced twice.

Try the demo has made-up cloud agents too, one per provider.

## Several computers

Each computer running Bridge AI has its own relay and its own pairing, and one app can be paired
with all of them. Add one in Settings › Devices › Your computers › Add a computer (or scan its code
from the pairing screen), and switch there. Forget removes a computer from the phone, and removes
the phone from that computer when it's the one showing.

The app opens on the computer you used last. If that one isn't there, the start screen says so
within a few seconds (offline since when, its relay not answering, or it not answering), never just
"Connecting…", and lists your other computers with whether each is on (their relays say, before any
pairing), what that computer last sent, Cloud Agents and Try the demo, while it keeps trying: once
the computer is back, Bridge AI opens. With no other computer, what it last sent opens by itself,
under a banner whose Start screen button leads there. Bridge AI's own menu gets the same from the
page (`relay/web/shell.js`): `bridgeRelay.start()` shows the start screen, `bridgeRelay.openCloud()`
opens Cloud Agents (both null where they don't exist, in a browser), and
`bridgeRelay.computers.list()` gives each computer's `online` (true, false, or null while it isn't
known) and `lastSeen`, with `subscribe(fn)` to hear when they change.

- iPhone: the list and each pairing are in the Keychain, on this phone only.
- Android: each relay is its own site in the WebView with its own pairing; the app keeps the list.

## While your computer is offline

The apps open Bridge AI from what your computer last sent (relay/web/offline.js), with a banner
saying it's offline, and keep the messages you send meanwhile until it's back (in your relay,
sealed for the computer). Per computer, and gone when you Forget it.

- iPhone: in the app's own files (Application Support, out of backups), through `OfflineStore.swift`:
  the page can't keep it in IndexedDB here.
- Android: in the WebView's storage for that relay's site, as in Chrome.

## The microphone, files and the screen (iPhone)

Bridge AI records on the phone for dictation (hold the mic button), voice notes and meetings: 16 kHz
sound made in the page (`src/audio/pcm.js`, an AudioWorklet) from the microphone, sent end-to-end
encrypted to the computer, which turns it into text. In the app that's WKWebView:

- The page is a secure context (`bridge-app://` is the app's own scheme), so `getUserMedia`, the
  AudioWorklet and WebCrypto are there as in Safari.
- Nothing is asked when the app opens. The first time you use one of them, iOS asks for the
  microphone with Info.plist's reason (`NSMicrophoneUsageDescription`); WebKit doesn't ask again on
  top (`requestMediaCapturePermissionFor`, granted for the app's own page and Bridge AI in it). The
  bundled UIs never record (the demo stands in for the mic), so they're refused.
- Bridge AI runs in a frame of the phone page, and it gets a `window.bridgeNative` of its own
  (`{ platform: 'ios', post }`), the way Android's `bridgeAndroid` reaches every frame. Through it a
  meeting that's recording keeps the screen on (`{ type: 'recording' }`, the only message the app
  takes from a frame), since a locked iPhone stops the page's microphone.
- Recordings and photos are sent as Blobs, which don't reach an app's own scheme handler: a small
  script sends their bytes instead. Files Bridge AI opens in a new tab (a picture, a PDF, a page an
  agent made, a meeting's file) open in a tab of Safari's through the page's link; the app shows
  them over itself (`FileViewer.swift`), through the same link, with Done to go back.

## On the lock screen

While any agents are working or waiting on you, the apps show them on the lock screen, with the
ones that finished meanwhile; tapping it opens the one that needs you. When all are done it says
so for 15 minutes, then goes. An agent that starts waiting on you also gets its own alert.

- iPhone: a Live Activity (`Widgets/`, `Shared/`), on the lock screen and in the Dynamic Island.
  The app can only update it while it runs, and iOS stops an app within seconds of it going to
  the background, so once the phone is locked the card says how old it is ("Since 5:40 PM",
  "Open Bridge AI for the latest") instead of looking current. Keeping it current with the phone
  locked needs Apple's push service (ActivityKit push), which needs a paid Apple Developer account.
- Android: an ongoing notification from a foreground service (`AgentsService.kt`). The service
  keeps the app running while the phone is locked, and the page keeps its link to your computer
  open (`PageView`), so the notification stays current.

## Building

- iPhone: needs Xcode (26 or later: the App Store takes nothing older) and XcodeGen
  (`brew install xcodegen`). `npm run mobile:ios` makes the Xcode project and opens it; choose your
  team under Signing & Capabilities, for both targets (BridgeAI and Widgets), to run it on your phone.
  The project is made again each time, so the team is chosen again too. For the Simulator with no
  signing, from `mobile/ios`:
  `xcodegen generate && xcodebuild -project BridgeAI.xcodeproj -scheme BridgeAI -sdk iphonesimulator
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`. CI builds it that
  way (Release) on every push and pull request (`.github/workflows/test.yml`), with Swift warnings
  failing the build, and `npm test -- ios-app` checks what the App Store asks of its files.
- Android: needs Android Studio. `npm run mobile:android` opens the project; run it on a phone or
  an emulator. From the command line, with Android Studio's Java:
  `cd mobile/android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug`.
  `npm run mobile:android:release` makes the signed bundle for Google Play; publishing it is in
  [android/PLAY.md](android/PLAY.md).

The iPhone app keeps its pairing in the Keychain (iOS apps can't store the phone's key in
IndexedDB the way Safari does), so it needs to be signed, even on the simulator. A debug build made
for the Simulator with no signing keeps the list in the app's defaults instead (`Keychain.swift`),
so pairing, several computers and switching can be tried there; never on a phone or in a release
build. A paired computer for it, with nothing leaving the Mac: the test kit's Bridge AI and relay
(`test/lib/harness.mjs`: `startKit`, `startRelay`), and `-pair` with a link from its
`/api/relay/pair`.

Simulators and emulators have no camera, so debug builds take the pairing link when launched:

- iPhone: `xcrun simctl launch booted dev.bridge-ai.phone -pair '<link>'`
- Android: `adb shell "am start -n dev.bridgeai.phone/.MainActivity --es pair '<link>'"`

They open the demo straight away with `-open demo` (iPhone) or `--es open demo` (Android), and
Cloud agents with `open cloud`.

To try Cloud agents without real keys, `npm run cloud:mocks` serves stand-in providers (the demo's,
`src/demo/clouds.js`) on 127.0.0.1, ports 7701 to 7704, and debug builds use them when launched
with `cloudMock`. Any key works except one with "bad" in it.

- iPhone simulator: `xcrun simctl launch booted dev.bridge-ai.phone -open cloud -cloudMock 127.0.0.1`
- Android emulator: `adb reverse tcp:7701 tcp:7701` (and 7702, 7703, 7704), then
  `adb shell am start -n dev.bridgeai.phone/.MainActivity --es open cloud --es cloudMock 127.0.0.1`.
  `--es cloudMock ""` goes back to the real providers. The background check runs on request with
  `adb shell am broadcast -n dev.bridgeai.phone/.CloudCheckNow`.

None of this is in release builds: on iPhone it's behind `#if DEBUG`; on Android it's in
`app/src/debug` (`TestHosts.kt`, `CloudCheckNow.kt`), and release builds get the
`app/src/release` `TestHosts.kt`, which allows nothing.

Notifications from your computer aren't in the apps yet: they need Apple's and Google's push
services. The relay's page added to the Home Screen has them today. Android's Cloud agents
notifications are made on the phone.

## Releasing to the App Store

What's in the repo: the version (`MARKETING_VERSION` in `ios/project.yml`, set with each release,
and the build number `CURRENT_PROJECT_VERSION`), the privacy manifest (`BridgeAI/PrivacyInfo.xcprivacy`:
no tracking, no data collected, and the reason for the one required reason API the app's code uses,
UserDefaults; the widget uses none), iOS's reasons for the camera, microphone and photos
(`Info.plist`), the app icon (1024 px, no transparency), the launch screen (light or dark as the
phone is), iPhone and iPad, and the widget extension for the Live Activity. What only the owner of
the Apple Developer account can do, in order:

1. **Apple Developer Program** membership, and its team.
2. **Identifiers** (Certificates, Identifiers & Profiles): the app `dev.bridge-ai.phone` and the
   widget extension `dev.bridge-ai.phone.widgets`. No capabilities to add: Live Activities need only
   Info.plist's `NSSupportsLiveActivities`, and the Keychain needs no entitlement.
3. **Signing**: the team for both targets in Xcode, Automatic signing; Xcode makes the App Store
   profiles for both when it uploads.
4. **The App Store Connect record**: a new iOS app with the bundle ID `dev.bridge-ai.phone`, a name
   (Bridge AI, if it's free), primary language English, a SKU, category Developer Tools (Productivity
   second). Price: free. Trader status for the EU (Digital Services Act) on the account.
5. **App Privacy**: Data Not Collected (below), the privacy policy URL
   `https://github.com/sahil1/bridge/blob/main/PRIVACY.md` (also linked on the app's first screen and
   in Settings › About & Updates), a support URL (`https://github.com/sahil1/bridge/issues`) and the
   marketing URL (`https://sahil1.github.io/bridge/`).
6. **Age rating**: the questionnaire, answered for what the app is (a developer tool; it shows what
   your own agents write, and opens web links in Safari, not in the app).
7. **Export compliance** (below): the answers, then `ITSAppUsesNonExemptEncryption` in `Info.plist`
   so they aren't asked for each upload.
8. **Screenshots**: App Store Connect wants iPhone 6.3" (1206 × 2622 or 1179 × 2556; iPhone 17,
   17 Pro) and, since the app runs on iPad, iPad 13" (2064 × 2752 or 2048 × 2732); 6.9"
   (1320 × 2868) is accepted and scaled down. The Simulator's iPhone 17, iPhone 18 Pro Max and iPad
   Pro 13-inch take them at exactly those sizes (`xcrun simctl io booted screenshot`, after
   `xcrun simctl status_bar booted override --time 9:41`). From April 2027 an app built with the
   iOS 27.1 SDK or later also needs iPhone Duo pictures.
9. **Archive and upload**: Product › Archive (Any iOS Device), Distribute App › App Store Connect.
   Each upload of the same version needs a higher build number: let the upload raise it, or raise
   `CURRENT_PROJECT_VERSION`.
10. **TestFlight first**: internal testers (no review), on a real iPhone: pairing by QR code,
    dictation held on the mic button (iOS asks for the mic then, once), a voice note, a meeting with
    the screen kept on, a file opened in a new tab, the Live Activity, two computers with one off,
    Cloud Agents with a real key. Then external testers (a short beta review), then **Submit for
    Review** with the notes below.

### Export compliance

The facts: the app's own code implements no encryption algorithm. HTTPS goes through iOS
(URLSession, WebKit). The end-to-end link to your computer (ECDH P-256, HKDF and AES-GCM,
`relay/web/link.js`) is made with WebKit's WebCrypto (`crypto.subtle`), which is iOS's own, as is
SHA-256 (CryptoKit, for folder names) and the Keychain. All are standard algorithms; none is
proprietary, and the code is public. Apple's table (App Store Connect Help, "Export compliance
documentation for encryption"): an app using "encryption limited to that within the Apple operating
system" needs no documentation; "an industry standard algorithm, not provided within the Apple
operating system" needs the French declaration, only for the App Store in France; proprietary
algorithms need a CCATS too.

The choice:

- **Exempt** (what the facts above support): in App Store Connect, encryption is used, limited to
  what's in Apple's operating system; then `<key>ITSAppUsesNonExemptEncryption</key><false/>` in
  `Info.plist`. Apple's page notes a year-end self-classification report to the US government may be
  needed for exempt encryption; check the current EAR rules for mass-market software (5D992.c).
- **Not exempt**, read strictly (the app sets up its own encrypted channel, even with iOS's
  algorithms): standard algorithms, the French declaration (or no App Store in France), then
  `ITSAppUsesNonExemptEncryption` true and `ITSEncryptionExportComplianceCode` with the code Apple
  gives.

Until one is chosen the key stays out, and App Store Connect asks at each upload.

### Notes for App Review

> Bridge AI is a free, open-source companion for Bridge AI on your own computer (macOS, Windows or
> Linux), where coding agents such as Claude Code and Codex run. The app pairs with that computer by
> scanning a QR code and shows Bridge AI from it over an end-to-end encrypted link, through a relay
> on the user's own Cloudflare account. There's no account, sign-in or server of ours, and nothing
> to buy.
>
> To review it without a computer: on the first screen, tap **Try the demo**. It's the whole of
> Bridge AI on made-up agents, run inside the app with no network. "Pair a computer" or Back returns
> to the first screen. **Cloud Agents** (first screen, or a long press on the app icon) runs agents
> on Cursor, GitHub Copilot, Jules or Claude with the user's own API key, kept in the Keychain and
> sent only to that provider; the demo has made-up cloud agents to look at without a key.
>
> To pair a real computer: install Bridge AI from https://sahil1.github.io/bridge/, open
> Settings › Devices › Pair a device, and scan the QR code. A video of that is attached.
>
> Permissions are asked when first used, never at launch: the camera when you tap Scan the QR code
> (or take a photo to attach), the microphone when you first hold the mic button, record a voice note
> or start a meeting.

Attach a short screen recording of pairing and using it with a real computer: reviewers can't pair
one themselves.

### What App Review may question

- **Remote desktop clients (4.2.7)** ask for the host and the client on the same local network. The
  app isn't a screen mirror: it's the client for Bridge AI on your own computer, reached through
  your own relay (or Tailscale), like the apps for a self-hosted server. Say so if asked.
- **Code from the computer (2.5.2, 4.7)**: Bridge AI's interface comes from your computer and runs
  in WebKit, as a website does in a browser. The demo and Cloud Agents are in the app itself.
- **Needs another device (2.1, 4.2.3)**: Try the demo and Cloud Agents work on the phone alone; the
  notes above and the video cover pairing.
- **Third-party AI (5.1.2)**: Cloud Agents sends your task and repo to the provider you add a key
  for. The screen says the key goes only to that provider; App Review may want a plainer "what's
  sent where" before the first task.
- **Other companies' names and logos (5.2)**: Cursor, GitHub Copilot, Jules and Claude are shown as
  services you use with your own account, through their public APIs.
- **Encryption**: the export compliance answers above.

## App Store privacy

What to answer in App Store Connect › App Privacy, true to the code (and to the app's privacy
manifest, `ios/BridgeAI/PrivacyInfo.xcprivacy`): **Data Not Collected**.
Apple's definition ([App privacy details](https://developer.apple.com/app-store/app-privacy-details/)):
"'Collect' refers to transmitting data off the device in a way that allows you and/or your
third-party partners to access it for a period longer than what is necessary to service the
transmitted request in real time", and third-party partners are "analytics tools, advertising
networks, third-party SDKs, or other external vendors whose code you've added to your app".

- With a computer, everything goes end-to-end encrypted to the user's own computer, through a
  relay on their own Cloudflare account. The project can't read it and never receives it.
- Cloud agents sends the task, the repo and the user's key straight from the phone to the provider
  the user picked (Cursor, GitHub, Google for Jules, Anthropic), into the user's own account there.
  The project never has access to it, and the providers are services the user chose and signs up
  for, not partners whose code is in the app. It's like Apple's payment service example: when
  "you as the developer never have access to the payment information, it is not collected".
- No analytics, ads, crash reporting or third-party SDKs.

If App Review sees it differently, the type is User Content › Other User Content, used for App
Functionality, not linked to identity by the project and not used for tracking. Keep this in step
with `PRIVACY.md` and Android's Data safety answers (`android/play/console.md`), which declare it,
because Google's definition of collection is wider.
