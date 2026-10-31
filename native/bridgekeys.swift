// bridgekeys: the dictation key held down in any app, for Bridge AI's "talk to your agents". It
// registers the key with Carbon's RegisterEventHotKey, which hears it pressed and let go while
// another app is in front and needs no permission: macOS asks nothing (an event tap or a global key
// monitor would need Input Monitoring or Accessibility). The key goes to Bridge AI only, not also to
// the app in front.
//
//   bridgekeys hotkey <keycode> <modifiers>   the key (a virtual key code; 49 is Space) and Carbon's
//                                             modifier bits (cmd 256, shift 512, option 2048,
//                                             control 4096). Prints one line when it's set:
//     {"ready":true}                          or {"error":"taken","by":"macOS"} (one of macOS's own
//                                             shortcuts, turned on in System Settings › Keyboard), or
//     {"error":"failed","status":n}           and then, each time the key goes down and up:
//     {"down":<ms since 1970>,"app":"Safari","bundle":"com.apple.Safari","path":"/Applications/Safari.app","pid":123,"secure":false}
//     {"up":<ms>}
//   bridgekeys modifier fn|ralt               one key on its own held to talk instead: Fn (🌐) or the
//                                             right ⌥. A listen-only event tap, which macOS allows with
//                                             Input Monitoring (or Accessibility, which covers
//                                             listening too); it never asks, it only looks
//                                             (CGPreflightListenEventAccess), so it's never what makes
//                                             macOS ask. One line when it's set: {"ready":true} or
//                                             {"error":"input-monitoring"}, then {"down":…} and {"up":…}
//                                             as for hotkey, and {"cancel":<ms>} when another key is
//                                             pressed while it's held (Fn+F5, ⌥ typing a character):
//                                             not dictation after all. The key still does what it does
//                                             in the app in front (a listen-only tap can't keep it), so
//                                             for Fn, "Press 🌐 key to" is best set to Do Nothing.
//   bridgekeys listen-access                  whether macOS lets this app listen to keys (Input
//                                             Monitoring or Accessibility), without asking:
//     {"allowed":true}
//   bridgekeys listen-ask                     the same, asking macOS the first time ("Bridge AI would
//                                             like to receive keystrokes from any application")
//   bridgekeys front                          the app in front (its name, bundle ID and where it is,
//                                             for its icon in the list of dictations) and whether
//                                             Secure Input is on (a password field has the keyboard),
//                                             then exits:
//     {"app":"Safari","bundle":"com.apple.Safari","path":"/Applications/Safari.app","pid":123,"secure":false}
//   bridgekeys paste [--pid <pid>]            the text on stdin, pasted where you're typing in the
//                                             app in front (Settings › Voice › "Where I'm typing"):
//                                             put on the clipboard, ⌘V pressed, and what was on the
//                                             clipboard put back once that app has read it. --pid: the
//                                             app that was in front when the key was pressed; if
//                                             another is now, nothing's pasted. One line, then exits:
//     {"pasted":true,"read":true,"restored":true}   read: the app took it; restored: what you had
//                                             copied is back (not when something else was copied
//                                             meanwhile, or when nothing read it: then the text stays
//                                             on the clipboard, to paste by hand), or
//     {"error":"secure"}                      Secure Input is on (a password field): nothing done
//     {"error":"accessibility"}               Bridge AI isn't allowed to press keys (Accessibility)
//     {"error":"moved","app":…}               another app is in front now
//
// Pressing ⌘V needs Accessibility. macOS counts it to the app that started this helper (Bridge AI,
// whose helper this is: the "responsible" process), so that's the app the person turns on in System
// Settings; this never asks, it only looks (CGPreflightPostEventAccess), and refuses without it.
//
// Another app's own hotkey on the same key isn't something macOS tells anyone. A held key doesn't
// repeat here. With hotkey, a line "press" or "release" on stdin goes through the same handler as the
// key itself (how the tests check it without a real key press). It exits when stdin closes or the
// process that started it goes.
//
// For the tests, which never press a key or touch your clipboard: paste --test --board <name> uses a
// pasteboard of its own (named dev.bridge-ai.test.…) and, instead of pressing ⌘V, prints
// {"posted":true,"key":9} (the key it would press) and waits for something to read it; --as secure,
// untrusted or moved acts as if that were so. bridgekeys board read|write|free --board <name> reads
// that pasteboard as an app pasting would, writes text to it (two items, one with a second type, to
// check every item and type comes back) and lets it go.
//   swiftc -O -target arm64-apple-macos14.0 native/bridgekeys.swift -o native/bin/bridgekeys
import AppKit
import Carbon

func quote(_ s: String) -> String {
  let data = try? JSONSerialization.data(withJSONObject: [s])
  let arr = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
  return String(arr.dropFirst().dropLast())
}
func say(_ line: String) {
  print(line)
  fflush(stdout)
}
func now() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }
func front() -> String {
  let a = NSWorkspace.shared.frontmostApplication
  return "\"app\":\(quote(a?.localizedName ?? "")),\"bundle\":\(quote(a?.bundleIdentifier ?? "")),\"path\":\(quote(a?.bundleURL?.path ?? "")),\"pid\":\(a?.processIdentifier ?? -1),\"secure\":\(IsSecureEventInputEnabled())"
}
// One of macOS's own shortcuts that's turned on (Spotlight's ⌘Space, the input sources' ⌃Space…).
let MODS: UInt32 = 0x1F00 // cmd, shift, caps lock, option, control
func macOSHas(_ code: UInt32, _ mods: UInt32) -> Bool {
  var list: Unmanaged<CFArray>?
  guard CopySymbolicHotKeys(&list) == noErr, let all = list?.takeRetainedValue() as? [[String: Any]] else { return false }
  return all.contains { d in
    (d[kHISymbolicHotKeyEnabled as String] as? Bool) == true &&
      (d[kHISymbolicHotKeyCode as String] as? NSNumber)?.uint32Value == code &&
      ((d[kHISymbolicHotKeyModifiers as String] as? NSNumber)?.uint32Value ?? 0) & MODS == mods & MODS
  }
}

let args = CommandLine.arguments
func option(_ name: String) -> String? {
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  return args[i + 1]
}

// ---------- Paste where you're typing ----------
// The clipboard (or, for the tests, a pasteboard of their own: never another name).
func board() -> NSPasteboard? {
  guard let name = option("--board") else { return .general }
  return name.hasPrefix("dev.bridge-ai.test.") ? NSPasteboard(name: NSPasteboard.Name(name)) : nil
}
// Clipboard managers leave alone what's marked this way (nspasteboard.org): the text is there for a
// moment, not something you copied.
let TRANSIENT = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")

// The text, handed over only when an app asks for it: that's how we know the app in front has read it.
final class Promised: NSObject, NSPasteboardItemDataProvider {
  let text: String
  var reads = 0
  init(_ text: String) { self.text = text }
  func pasteboard(_ pasteboard: NSPasteboard?, item: NSPasteboardItem, provideDataForType type: NSPasteboard.PasteboardType) {
    reads += 1
    item.setString(text, forType: type)
  }
}

// The key that types "v" with ⌘ held, in the keyboard layout in use: apps match ⌘V by the letter, and
// on Dvorak, say, the letter isn't where it is on QWERTY. 9 (QWERTY's, and AZERTY's and QWERTZ's) when
// no key types it (a Russian or Greek layout, where apps take ⌘V at QWERTY's place).
func keyForV() -> CGKeyCode {
  guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
        let raw = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { return 9 }
  let data = Unmanaged<CFData>.fromOpaque(raw).takeUnretainedValue() as Data
  return data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) -> CGKeyCode in
    guard let layout = bytes.baseAddress?.assumingMemoryBound(to: UCKeyboardLayout.self) else { return 9 }
    let cmd = UInt32((cmdKey >> 8) & 0xFF)
    for code in 0..<128 {
      var dead: UInt32 = 0
      var len = 0
      var chars = [UniChar](repeating: 0, count: 4)
      let r = UCKeyTranslate(layout, UInt16(code), UInt16(kUCKeyActionDown), cmd, UInt32(LMGetKbdType()), OptionBits(kUCKeyTranslateNoDeadKeysBit), &dead, 4, &len, &chars)
      if r == noErr && len == 1 && chars[0] == UniChar(UInt8(ascii: "v")) { return CGKeyCode(code) }
    }
    return 9
  }
}

// ⌘ down, V down and up, ⌘ up, as a keyboard would: some apps only take ⌘V with the ⌘ key's own events.
func pressPaste(_ v: CGKeyCode) {
  let source = CGEventSource(stateID: .hidSystemState)
  let cmd: CGKeyCode = 0x37
  for (key, down) in [(cmd, true), (v, true), (v, false), (cmd, false)] {
    let e = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: down)
    e?.flags = key == cmd && !down ? [] : .maskCommand
    e?.post(tap: .cghidEventTap)
  }
}

// Answer apps asking for the text (the promise above) for up to `seconds`, or until `done`.
func pump(_ seconds: Double, until done: () -> Bool = { false }) {
  let end = Date().addingTimeInterval(seconds)
  while !done() && Date() < end { RunLoop.current.run(mode: .default, before: min(end, Date().addingTimeInterval(0.02))) }
}

func paste() -> Never {
  let test = args.contains("--test")
  let pretend = option("--as")
  guard let pb = board(), !test || option("--board") != nil else { say("{\"error\":\"board\"}"); exit(2) }
  let text = String(decoding: FileHandle.standardInput.readDataToEndOfFile(), as: UTF8.self)
  if text.isEmpty { say("{\"error\":\"empty\"}"); exit(1) }
  // A password field has the keyboard: pasting there is never what you meant.
  if pretend == "secure" || (!test && IsSecureEventInputEnabled()) { say("{\"error\":\"secure\"}"); exit(1) }
  // Only looks: pressing a key without Accessibility would make macOS ask.
  if pretend == "untrusted" || (!test && !CGPreflightPostEventAccess()) { say("{\"error\":\"accessibility\"}"); exit(1) }
  if pretend == "moved" { say("{\"error\":\"moved\",\(front())}"); exit(1) }
  if !test, let want = option("--pid").flatMap({ Int32($0) }), let now = NSWorkspace.shared.frontmostApplication, now.processIdentifier != want {
    say("{\"error\":\"moved\",\(front())}")
    exit(1)
  }
  // What's there now, every item and every type of each, to put back.
  let saved = (pb.pasteboardItems ?? []).map { item in item.types.compactMap { t in item.data(forType: t).map { (t, $0) } } }
  let promised = Promised(text)
  let item = NSPasteboardItem()
  item.setDataProvider(promised, forTypes: [.string])
  item.setData(Data(), forType: TRANSIENT)
  pb.clearContents()
  pb.writeObjects([item])
  let ours = pb.changeCount
  let v = keyForV()
  if test { say("{\"posted\":true,\"key\":\(v)}") } else { pressPaste(v) }
  pump((Double(option("--wait") ?? "") ?? 2000) / 1000, until: { promised.reads > 0 })
  let read = promised.reads > 0
  // It may ask again (for another type, or a second look) a moment later.
  if read { pump((Double(option("--settle") ?? "") ?? 250) / 1000) }
  var restored = false
  // Only while the clipboard is still ours: something copied meanwhile stays.
  if pb.changeCount == ours {
    pb.clearContents()
    if read {
      pb.writeObjects(saved.map { types in
        let it = NSPasteboardItem()
        for (t, d) in types { it.setData(d, forType: t) }
        return it
      })
      restored = true
    } else {
      // Nothing read it (no text field there, or an app slow to answer): the text stays, to paste by
      // hand. Put back now, what you had copied would be what a slow app pastes.
      pb.setString(text, forType: .string)
    }
  }
  say("{\"pasted\":true,\"read\":\(read),\"restored\":\(restored)}")
  exit(0)
}

// The tests' pasteboard: read as an app pasting would, written, let go.
func boardTool() -> Never {
  guard args.count >= 3, option("--board") != nil, let pb = board() else { say("{\"error\":\"board\"}"); exit(2) }
  switch args[2] {
  case "read":
    let text = pb.string(forType: .string) ?? ""
    let types = (pb.pasteboardItems ?? []).flatMap { $0.types.map { $0.rawValue } }
    let list = types.map { quote($0) }.joined(separator: ",")
    say("{\"text\":\(quote(text)),\"items\":\(pb.pasteboardItems?.count ?? 0),\"types\":[\(list)],\"change\":\(pb.changeCount)}")
  case "write":
    let text = String(decoding: FileHandle.standardInput.readDataToEndOfFile(), as: UTF8.self)
    let first = NSPasteboardItem()
    first.setString(text, forType: .string)
    first.setData(Data("extra".utf8), forType: NSPasteboard.PasteboardType("dev.bridge-ai.test.extra"))
    let second = NSPasteboardItem()
    second.setString("second item", forType: .string)
    pb.clearContents()
    pb.writeObjects([first, second])
    say("{\"change\":\(pb.changeCount)}")
  case "free":
    pb.releaseGlobally()
    say("{\"ok\":true}")
  default:
    exit(2)
  }
  exit(0)
}

if args.count >= 2 && args[1] == "front" {
  say("{\(front())}")
  exit(0)
}
if args.count >= 2 && args[1] == "paste" { paste() }
if args.count >= 2 && args[1] == "board" { boardTool() }
// Listening to keys: Input Monitoring, or Accessibility (which covers it).
func mayListen() -> Bool { CGPreflightListenEventAccess() || AXIsProcessTrusted() }
if args.count >= 2 && args[1] == "listen-access" { say("{\"allowed\":\(mayListen())}"); exit(0) }
if args.count >= 2 && args[1] == "listen-ask" { say("{\"allowed\":\(CGRequestListenEventAccess() || mayListen())}"); exit(0) }
signal(SIGPIPE, SIG_DFL) // stdout closed: Bridge AI has gone, so do we

// ---------- One key on its own: Fn or the right ⌥ ----------
let kFn: Int64 = 63 // kVK_Function
let kRightOption: Int64 = 61 // kVK_RightOption
var loneCode: Int64 = kFn
var loneHeld = false
var loneTap: CFMachPort?
// Is it down? Fn has a flag of its own; the right ⌥ is the device bit for that side (NX_DEVICERALTKEYMASK).
func loneDown(_ flags: CGEventFlags) -> Bool { loneCode == kFn ? flags.contains(.maskSecondaryFn) : flags.rawValue & 0x40 != 0 }
func loneEvent(_ what: String) {
  if what == "down" {
    if loneHeld { return }
    loneHeld = true
    say("{\"down\":\(now()),\(front())}")
  } else if what == "up" {
    if !loneHeld { return }
    loneHeld = false
    say("{\"up\":\(now())}")
  } else if loneHeld {
    loneHeld = false
    say("{\"cancel\":\(now())}")
  }
}
func loneKey(_ which: String) -> Never {
  loneCode = which == "ralt" ? kRightOption : kFn
  let app = NSApplication.shared
  app.setActivationPolicy(.prohibited)
  if !mayListen() { say("{\"error\":\"input-monitoring\"}"); exit(1) }
  let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
  let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: CGEventMask(mask), callback: { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
      if let t = loneTap { CGEvent.tapEnable(tap: t, enable: true) }
      return Unmanaged.passUnretained(event)
    }
    if type == .flagsChanged {
      let code = event.getIntegerValueField(.keyboardEventKeycode)
      if code == loneCode {
        // On its own: with ⌘, ⌃, ⇧ or the other of the two held, it's a shortcut, not this.
        let others: CGEventFlags = loneCode == kFn ? [.maskCommand, .maskControl, .maskShift, .maskAlternate] : [.maskCommand, .maskControl, .maskShift, .maskSecondaryFn]
        if loneDown(event.flags) { if event.flags.intersection(others).isEmpty { loneEvent("down") } } else { loneEvent("up") }
      } else if loneHeld { loneEvent("cancel") }
    } else if type == .keyDown && loneHeld {
      loneEvent("cancel")
    }
    return Unmanaged.passUnretained(event)
  }, userInfo: nil)
  guard let tap else { say("{\"error\":\"input-monitoring\"}"); exit(1) }
  loneTap = tap
  CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(nil, tap, 0), .commonModes)
  CGEvent.tapEnable(tap: tap, enable: true)
  say("{\"ready\":true}")
  // "press", "release" and "other" on stdin, as the key itself (the tests' way in).
  Thread {
    while let line = readLine() {
      let cmd = line.trimmingCharacters(in: .whitespaces)
      DispatchQueue.main.async { loneEvent(cmd == "press" ? "down" : cmd == "release" ? "up" : "cancel") }
    }
    exit(0) // stdin closed
  }.start()
  let parent = getppid()
  let watch = DispatchSource.makeTimerSource(queue: .main)
  watch.schedule(deadline: .now() + 1, repeating: 1)
  watch.setEventHandler { if getppid() != parent { exit(0) } }
  watch.resume()
  app.run()
  exit(0)
}
if args.count >= 3 && args[1] == "modifier" { loneKey(args[2]) }

guard args.count >= 4, args[1] == "hotkey", let code = UInt32(args[2]), let mods = UInt32(args[3]) else {
  FileHandle.standardError.write("usage: bridgekeys hotkey <keycode> <modifiers> | bridgekeys modifier fn|ralt | bridgekeys listen-access | bridgekeys listen-ask | bridgekeys front | bridgekeys paste [--pid <pid>]\n".data(using: .utf8)!)
  exit(2)
}
// An app with no Dock icon or menu, so the key's events reach it.
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let signature: OSType = 0x4252_4b59 // "BRKY"
var held = false

func handle(_ kind: UInt32) {
  if kind == UInt32(kEventHotKeyPressed) {
    if held { return } // a repeat, or a press already told
    held = true
    say("{\"down\":\(now()),\(front())}")
  } else if kind == UInt32(kEventHotKeyReleased) {
    if !held { return }
    held = false
    say("{\"up\":\(now())}")
  }
}

var specs = [
  EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
  EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased)),
]
InstallEventHandler(GetApplicationEventTarget(), { _, event, _ -> OSStatus in
  guard let event = event else { return OSStatus(eventNotHandledErr) }
  var id = EventHotKeyID()
  let got = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
  if got != noErr || id.signature != signature { return OSStatus(eventNotHandledErr) }
  handle(GetEventKind(event))
  return noErr
}, specs.count, &specs, nil, nil)

if macOSHas(code, mods) { say("{\"error\":\"taken\",\"by\":\"macOS\"}"); exit(1) }
var ref: EventHotKeyRef?
let status = RegisterEventHotKey(code, mods, EventHotKeyID(signature: signature, id: 1), GetApplicationEventTarget(), 0, &ref)
if status == OSStatus(eventHotKeyExistsErr) { say("{\"error\":\"taken\"}"); exit(1) }
if status != noErr { say("{\"error\":\"failed\",\"status\":\(status)}"); exit(1) }
say("{\"ready\":true}")

// The event the key makes, for "press" and "release" on stdin.
func inject(_ kind: Int) {
  var event: EventRef?
  guard CreateEvent(nil, OSType(kEventClassKeyboard), UInt32(kind), 0, EventAttributes(kEventAttributeNone), &event) == noErr, let e = event else { return }
  var id = EventHotKeyID(signature: signature, id: 1)
  SetEventParameter(e, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), MemoryLayout<EventHotKeyID>.size, &id)
  SendEventToEventTarget(e, GetApplicationEventTarget())
  ReleaseEvent(e)
}
Thread {
  while let line = readLine() {
    let cmd = line.trimmingCharacters(in: .whitespaces)
    DispatchQueue.main.async {
      if cmd == "press" { inject(kEventHotKeyPressed) } else if cmd == "release" { inject(kEventHotKeyReleased) }
    }
  }
  exit(0) // stdin closed
}.start()

let parent = getppid()
let watch = DispatchSource.makeTimerSource(queue: .main)
watch.schedule(deadline: .now() + 1, repeating: 1)
watch.setEventHandler { if getppid() != parent { exit(0) } }
watch.resume()
app.run()
