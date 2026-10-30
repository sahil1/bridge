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
//     {"down":<ms since 1970>,"app":"Safari","bundle":"com.apple.Safari","pid":123,"secure":false}
//     {"up":<ms>}
//   bridgekeys front                          the app in front and whether Secure Input is on (a
//                                             password field has the keyboard), then exits:
//     {"app":"Safari","bundle":"com.apple.Safari","pid":123,"secure":false}
//
// Another app's own hotkey on the same key isn't something macOS tells anyone. A held key doesn't
// repeat here. With hotkey, a line "press" or "release" on stdin goes through the same handler as the
// key itself (how the tests check it without a real key press). It exits when stdin closes or the
// process that started it goes.
//   swiftc -O -target arm64-apple-macos13.0 native/bridgekeys.swift -o native/bin/bridgekeys
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
  return "\"app\":\(quote(a?.localizedName ?? "")),\"bundle\":\(quote(a?.bundleIdentifier ?? "")),\"pid\":\(a?.processIdentifier ?? -1),\"secure\":\(IsSecureEventInputEnabled())"
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
if args.count >= 2 && args[1] == "front" {
  say("{\(front())}")
  exit(0)
}
guard args.count >= 4, args[1] == "hotkey", let code = UInt32(args[2]), let mods = UInt32(args[3]) else {
  FileHandle.standardError.write("usage: bridgekeys hotkey <keycode> <modifiers> | bridgekeys front\n".data(using: .utf8)!)
  exit(2)
}

signal(SIGPIPE, SIG_DFL) // stdout closed: Bridge AI has gone, so do we
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
