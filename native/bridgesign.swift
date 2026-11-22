// bridgesign: Studio's signing on a Mac. Two things a web page can't do: draw a signature on the
// trackpad as Preview's Trackpad tab does (the finger's place on the trackpad, not the pointer's
// moves), and ask for Touch ID or this Mac's password before a document is signed (Settings ›
// Studio › Ask Before Signing). Neither needs a permission: macOS asks nothing to start either.
//
//   bridgesign probe                          what this Mac has, then exits:
//     {"trackpad":true,"touchID":true,"auth":true}
//                                             trackpad: a built-in or Magic Trackpad is connected;
//                                             touchID: Touch ID is set up and can be used now (the lid
//                                             open, a finger enrolled); auth: this Mac can ask for its
//                                             password (or Touch ID) at all.
//   bridgesign trackpad                       draws on the trackpad. Its first line on stdin says
//                                             how: {"hint":"…","seconds":120} (on stdin, not in its
//                                             arguments, which any program can list).
//                                             Then: A window over the screen takes
//                                             the trackpad's touches (indirect touches, NSTouch) while
//                                             the pointer stays still and hidden, and each finger's
//                                             place is printed as it moves, as a share of the
//                                             trackpad's width and height, from its top left:
//     {"ready":true,"w":160.2,"h":114.6}      the trackpad's size in points, once it's listening
//     {"d":[0.4123,0.5531,0.0],"ms":12}       a finger down: x, y, pressure (0 when it isn't pressed)
//     {"m":[0.4130,0.5520,0.0],"ms":20}       moved (a line for each move the trackpad reported)
//     {"u":1,"ms":120}                        lifted: the stroke ends
//     {"done":true}                           a key was pressed: finished (then it exits)
//     {"cancel":"escape"|"away"|"time"|"stop"|"focus"} Esc, another app in front, n seconds (120)
//                                             passed, "stop" on stdin / stdin closed, or macOS
//                                             didn't let its window in front (then it exits)
//                                             Only one finger draws; a second one on the trackpad is
//                                             left out until the first lifts. A click does nothing.
//   bridgesign auth                           Touch ID, or this Mac's password, for the reason on its
//                                             first line on stdin ({"reason":"sign contract.pdf"}).
//                                             Touch ID first where it's set up, with
//                                             "Use Password…" to type the password instead; the
//                                             password where it isn't. One line, then exits:
//     {"ok":true,"how":"touchid"|"password"}  or {"ok":false,"code":"cancel"|"failed"|"none","error":"…"}
//                                             none: this Mac has no password or Touch ID to ask for.
//
// key and auth answer only the program that started them, when it's signed with the same
// certificate as this helper (Bridge AI itself, the server on its Helper): another program running
// this helper gets {"error":"parent"} (key) or {"ok":false,"code":"parent"} (auth), and probe says
// auth false to it. A build of your own from a clone (scripts/calltap.js without --release) is
// built with BRIDGESIGN_ANY_PARENT, which leaves that check out; release builds never are.
//
// It exits when the process that started it goes. Built for Apple silicon and Intel, as the other
// helpers are (desktop/stage.js):
// With an Info.plist of its own in the binary (native/bridgesign.plist), so macOS names it Bridge AI
// when it asks for Touch ID ("Bridge AI is trying to sign contract.pdf"):
//   swiftc -O -target arm64-apple-macos14.0 native/bridgesign.swift -o native/bin/bridgesign \
//     -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker native/bridgesign.plist
import AppKit
import IOKit
import LocalAuthentication
import Security
import CryptoKit

let args = CommandLine.arguments
func option(_ name: String) -> String? {
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  return args[i + 1]
}
func quote(_ s: String) -> String {
  let data = try? JSONSerialization.data(withJSONObject: [s])
  let arr = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
  return String(arr.dropFirst().dropLast())
}
func say(_ line: String) {
  print(line)
  fflush(stdout)
}
func num(_ v: Double) -> String { String(format: "%.4f", v) }

// Ends with the process that started it.
func watchParent() {
  let parent = getppid()
  let watch = DispatchSource.makeTimerSource(queue: .main)
  watch.schedule(deadline: .now() + 1, repeating: 1)
  watch.setEventHandler { if getppid() != parent { exit(0) } }
  watch.resume()
  parentWatch = watch
}
var parentWatch: DispatchSourceTimer?

// ---------- probe ----------
// A trackpad: a built-in one or a Magic Trackpad (a Magic Mouse is multitouch too, but its driver
// is another class).
func hasTrackpad() -> Bool {
  var iter: io_iterator_t = 0
  guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("AppleMultitouchTrackpadHIDEventDriver"), &iter) == KERN_SUCCESS else { return false }
  defer { IOObjectRelease(iter) }
  let first = IOIteratorNext(iter)
  if first != 0 { IOObjectRelease(first); return true }
  return false
}
// ---------- who started it ----------
// The process that started this one, signed with this helper's own certificate (its leaf, the same
// for a Developer ID or Bridge AI's own certificate): checked by its code signature, not its name.
func parentTrusted() -> Bool {
  #if BRIDGESIGN_ANY_PARENT
  return true
  #else
  var me: SecCode?
  guard SecCodeCopySelf([], &me) == errSecSuccess, let me = me else { return false }
  var meStatic: SecStaticCode?
  guard SecCodeCopyStaticCode(me, [], &meStatic) == errSecSuccess, let ms = meStatic else { return false }
  var info: CFDictionary?
  guard SecCodeCopySigningInformation(ms, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
        let d = info as? [String: Any], let certs = d[kSecCodeInfoCertificates as String] as? [SecCertificate], let leaf = certs.first else { return false }
  let hex = Insecure.SHA1.hash(data: SecCertificateCopyData(leaf) as Data).map { String(format: "%02x", $0) }.joined()
  var req: SecRequirement?
  guard SecRequirementCreateWithString("certificate leaf = H\"\(hex)\"" as CFString, [], &req) == errSecSuccess, let req = req else { return false }
  var parent: SecCode?
  let attrs = [kSecGuestAttributePid: NSNumber(value: getppid())] as CFDictionary
  guard SecCodeCopyGuestWithAttributes(nil, attrs, [], &parent) == errSecSuccess, let p = parent else { return false }
  return SecCodeCheckValidity(p, [], req) == errSecSuccess
  #endif
}
// The first line on stdin, as JSON (what a caller says without putting it in the arguments).
func firstLine() -> [String: Any] {
  guard let line = readLine(), let data = line.data(using: .utf8), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
  return j
}

func probe() {
  let ctx = LAContext()
  var err: NSError?
  let trusted = parentTrusted()
  let touch = trusted && ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) && ctx.biometryType == .touchID
  let auth = trusted && LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
  say("{\"trackpad\":\(hasTrackpad()),\"touchID\":\(touch),\"auth\":\(auth)}")
  exit(0)
}

// ---------- auth ----------
func auth(_ reason: String) {
  let done = { (line: String) in say(line); exit(0) }
  func password() {
    let ctx = LAContext()
    var err: NSError?
    guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else {
      done("{\"ok\":false,\"code\":\"none\",\"error\":\(quote(err?.localizedDescription ?? "No password to ask for"))}")
      return
    }
    ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, e in
      DispatchQueue.main.async {
        if ok { done("{\"ok\":true,\"how\":\"password\"}"); return }
        let code = (e as? LAError)?.code
        let cancel = code == .userCancel || code == .appCancel || code == .systemCancel
        done("{\"ok\":false,\"code\":\"\(cancel ? "cancel" : "failed")\",\"error\":\(quote(e?.localizedDescription ?? "Not confirmed"))}")
      }
    }
  }
  let bio = LAContext()
  bio.localizedFallbackTitle = NSLocalizedString("Use Password…", comment: "")
  var err: NSError?
  guard bio.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) else { password(); return }
  bio.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, e in
    DispatchQueue.main.async {
      if ok { done("{\"ok\":true,\"how\":\"touchid\"}"); return }
      let code = (e as? LAError)?.code
      // "Use Password…", or Touch ID locked out after too many tries: the password instead.
      if code == .userFallback || code == .biometryLockout || code == .biometryNotAvailable { password(); return }
      let cancel = code == .userCancel || code == .appCancel || code == .systemCancel
      done("{\"ok\":false,\"code\":\"\(cancel ? "cancel" : "failed")\",\"error\":\(quote(e?.localizedDescription ?? "Not confirmed"))}")
    }
  }
}

// ---------- key ----------
func keychainKey() {
  if !parentTrusted() { say("{\"error\":\"parent\",\"status\":0}"); exit(1) }
  let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "dev.bridge-ai.signatures", kSecAttrAccount as String: "key"]
  var q = base
  q[kSecReturnData as String] = true
  q[kSecMatchLimit as String] = kSecMatchLimitOne
  var out: CFTypeRef?
  let st = SecItemCopyMatching(q as CFDictionary, &out)
  let why = { (s: OSStatus) in (SecCopyErrorMessageString(s, nil) as String?) ?? "status \(s)" }
  if st == errSecSuccess, let d = out as? Data, d.count == 32 { say("{\"key\":\"\(d.base64EncodedString())\"}"); exit(0) }
  if st != errSecItemNotFound { say("{\"error\":\(quote(why(st))),\"status\":\(st)}"); exit(1) }
  var bytes = [UInt8](repeating: 0, count: 32)
  guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { say("{\"error\":\"random\",\"status\":0}"); exit(1) }
  var add = base
  add[kSecValueData as String] = Data(bytes)
  add[kSecAttrLabel as String] = "Bridge AI signatures"
  add[kSecAttrDescription as String] = "The key Bridge AI keeps your saved signatures with"
  let made = SecItemAdd(add as CFDictionary, nil)
  if made != errSecSuccess { say("{\"error\":\(quote(why(made))),\"status\":\(made)}"); exit(1) }
  say("{\"key\":\"\(Data(bytes).base64EncodedString())\"}")
  exit(0)
}

// ---------- trackpad ----------
final class KeyWindow: NSWindow {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { true }
}

final class Pad: NSView {
  var finger: (any NSObjectProtocol & NSCopying)? // the touch drawing, by its identity
  var pressure: Double = 0
  var start = Date()
  var finished = false
  var said = false // ready said
  var sized = false // ...with the trackpad's size
  let onEnd: (String) -> Void

  init(frame: NSRect, onEnd: @escaping (String) -> Void) {
    self.onEnd = onEnd
    super.init(frame: frame)
    allowedTouchTypes = [.indirect]
    wantsRestingTouches = false
  }
  required init?(coder: NSCoder) { fatalError() }
  override var acceptsFirstResponder: Bool { true }
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  func ms() -> Int { Int(Date().timeIntervalSince(start) * 1000) }
  func ready(_ touch: NSTouch) {
    if sized { return }
    said = true
    sized = true
    let size = touch.deviceSize
    say("{\"ready\":true,\"w\":\(num(Double(size.width))),\"h\":\(num(Double(size.height)))}")
  }
  func point(_ t: NSTouch) -> String {
    let p = t.normalizedPosition // from the bottom left
    return "[\(num(Double(p.x))),\(num(1 - Double(p.y))),\(num(pressure))]"
  }

  override func touchesBegan(with event: NSEvent) {
    guard !finished, finger == nil, let t = event.touches(matching: .began, in: self).first else { return }
    ready(t)
    finger = t.identity
    say("{\"d\":\(point(t)),\"ms\":\(ms())}")
  }
  override func touchesMoved(with event: NSEvent) {
    guard !finished, let id = finger else { return }
    for t in event.touches(matching: .moved, in: self) where t.identity.isEqual(id) {
      say("{\"m\":\(point(t)),\"ms\":\(ms())}")
    }
  }
  func lift(_ event: NSEvent, _ phase: NSTouch.Phase) {
    guard let id = finger else { return }
    for t in event.touches(matching: phase, in: self) where t.identity.isEqual(id) {
      finger = nil
      say("{\"u\":1,\"ms\":\(ms())}")
    }
  }
  override func touchesEnded(with event: NSEvent) { lift(event, .ended) }
  override func touchesCancelled(with event: NSEvent) { lift(event, .cancelled) }
  // A force click's pressure, while it's pressed; 0 again once it's let go.
  override func pressureChange(with event: NSEvent) { pressure = Double(max(0, min(1, event.pressure))) }
  override func mouseUp(with event: NSEvent) { pressure = 0 }
  override func mouseDown(with event: NSEvent) {}
  override func rightMouseDown(with event: NSEvent) {}
  override func scrollWheel(with event: NSEvent) {}
  override func keyDown(with event: NSEvent) {
    if event.keyCode == 53 { onEnd("{\"cancel\":\"escape\"}") } else { onEnd("{\"done\":true}") }
  }
  override func flagsChanged(with event: NSEvent) {}
}

func trackpad(seconds: Double, hint: String?) {
  let app = NSApplication.shared
  app.setActivationPolicy(.accessory)
  // Over the whole screen the pointer is on (where the pad is), almost clear: the app's pad shows
  // the ink, under it. A small card says what's going on.
  let mouse = NSEvent.mouseLocation
  let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens[0]
  let win = KeyWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
  win.level = .modalPanel
  win.isOpaque = false
  win.backgroundColor = NSColor(calibratedWhite: 0, alpha: 0.02)
  win.ignoresMouseEvents = false
  win.hasShadow = false
  win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
  var ended = false
  func end(_ line: String) {
    if ended { return }
    ended = true
    CGAssociateMouseAndMouseCursorPosition(1)
    NSCursor.unhide()
    say(line)
    win.orderOut(nil)
    exit(0)
  }
  let pad = Pad(frame: NSRect(origin: .zero, size: screen.frame.size), onEnd: end)
  win.contentView = pad

  // What to do, at the bottom of the screen, in the system's own words where it can.
  let card = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: 420, height: 44))
  card.material = .hudWindow
  card.blendingMode = .withinWindow
  card.state = .active
  card.wantsLayer = true
  card.layer?.cornerRadius = 12
  let label = NSTextField(labelWithString: hint ?? "Draw on the trackpad with one finger. Press any key when done; Esc cancels.")
  label.font = NSFont.systemFont(ofSize: 13, weight: .medium)
  label.textColor = .labelColor
  label.alignment = .center
  label.lineBreakMode = .byTruncatingTail
  label.frame = NSRect(x: 14, y: 12, width: 392, height: 20)
  card.addSubview(label)
  card.frame.origin = NSPoint(x: (screen.frame.width - card.frame.width) / 2, y: 64)
  pad.addSubview(card)

  // The pointer stays where it is and out of sight: the finger draws, it doesn't point.
  CGAssociateMouseAndMouseCursorPosition(0)
  NSCursor.hide()
  win.makeKeyAndOrderFront(nil)
  win.makeFirstResponder(pad)
  app.activate(ignoringOtherApps: true)
  // Before the first touch, the trackpad's size isn't known: it's said with 0 by 0 after a moment,
  // so the page knows it's listening, and again with its size at the first touch.
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
    if !pad.said { pad.said = true; say("{\"ready\":true,\"w\":0,\"h\":0}") }
  }
  NotificationCenter.default.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { _ in end("{\"cancel\":\"away\"}") }
  // The trackpad's touches go to the window in front only: if macOS didn't bring this one in front
  // (it can keep another app there), asked once more, then said, rather than a pad that hears nothing.
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
    if app.isActive && win.isKeyWindow { return }
    NSRunningApplication.current.activate(options: [.activateAllWindows])
    win.makeKeyAndOrderFront(nil)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
      if !(app.isActive && win.isKeyWindow) { end("{\"cancel\":\"focus\"}") }
    }
  }
  DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { end("{\"cancel\":\"time\"}") }
  Thread {
    while let line = readLine() {
      if line.trimmingCharacters(in: .whitespaces) == "stop" { break }
    }
    DispatchQueue.main.async { end("{\"cancel\":\"stop\"}") }
  }.start()
  signal(SIGTERM, SIG_IGN)
  let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
  term.setEventHandler { end("{\"cancel\":\"stop\"}") }
  term.resume()
  sigterm = term
  watchParent()
  app.run()
}
var sigterm: DispatchSourceSignal?

switch args.count > 1 ? args[1] : "" {
case "probe":
  probe()
case "key":
  keychainKey()
case "auth":
  if !parentTrusted() { say("{\"ok\":false,\"code\":\"parent\",\"error\":\"Only Bridge AI can ask with this helper\"}"); exit(1) }
  let said = firstLine()
  NSApplication.shared.setActivationPolicy(.accessory)
  auth(String((said["reason"] as? String ?? "sign a document").prefix(140)))
  watchParent()
  NSApplication.shared.run()
case "trackpad":
  let said = firstLine()
  let secs = (said["seconds"] as? NSNumber)?.doubleValue ?? 120
  trackpad(seconds: max(5, min(600, secs)), hint: (said["hint"] as? String).map { String($0.prefix(160)) })
default:
  FileHandle.standardError.write("usage: bridgesign probe | bridgesign key | bridgesign trackpad | bridgesign auth (the trackpad's and auth's details on stdin)\n".data(using: .utf8)!)
  exit(2)
}
