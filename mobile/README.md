# Bridge AI for iPhone and Android

The phone apps show Bridge AI from your computer through your own relay (Settings › Phone &
notifications on the computer), the same way the relay's page does in Safari or Chrome, end-to-end
encrypted. Both use the relay's own phone page (`relay/web`), so pairing and the link work the same
everywhere.

- **iPhone** (`ios/`): the app serves the phone page itself and carries Bridge AI's requests over
  the encrypted link (`Tunnel.swift`), because iOS apps can't run a service worker for an address
  that's different for every relay.
- **Android** (`android/`): opens your relay's page in a WebView, which runs its service worker as
  Chrome does.

Pair by scanning the QR code from Pair a phone on the computer, or by pasting the link from Copy
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
with all of them. Add one in Settings › Phone & notifications › Your computers › Add a computer (or
scan its code from the pairing screen); switch there, or from the "offline" screen when the one
showing is off. Forget removes a computer from the phone, and removes the phone from that computer
when it's the one showing.

- iPhone: the list and each pairing are in the Keychain, on this phone only.
- Android: each relay is its own site in the WebView with its own pairing; the app keeps the list.

## While your computer is offline

The apps open Bridge AI from what your computer last sent (relay/web/offline.js), with a banner
saying it's offline, and keep the messages you send meanwhile until it's back (in your relay,
sealed for the computer). Per computer, and gone when you Forget it.

- iPhone: in the app's own files (Application Support, out of backups), through `OfflineStore.swift`:
  the page can't keep it in IndexedDB here.
- Android: in the WebView's storage for that relay's site, as in Chrome.

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

- iPhone: needs Xcode and XcodeGen (`brew install xcodegen`). `npm run mobile:ios` makes the Xcode
  project and opens it; choose your team under Signing & Capabilities to run it on your phone.
- Android: needs Android Studio. `npm run mobile:android` opens the project; run it on a phone or
  an emulator. From the command line, with Android Studio's Java:
  `cd mobile/android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleDebug`.
  `npm run mobile:android:release` makes the signed bundle for Google Play; publishing it is in
  [android/PLAY.md](android/PLAY.md).

The iPhone app keeps its pairing in the Keychain (iOS apps can't store the phone's key in
IndexedDB the way Safari does), so it needs to be signed, even on the simulator.

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

## App Store privacy

What to answer in App Store Connect › App Privacy, true to the code: **Data Not Collected**.
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
