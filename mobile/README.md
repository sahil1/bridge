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

They open the demo straight away with `-open demo` (iPhone) or `--es open demo` (Android).

Notifications aren't in the apps yet: they need Apple's and Google's push services. The relay's
page added to the Home Screen has them today.
