// callwatch: which apps are using a microphone right now, so meeting notes can notice a call start
// and end (Zoom, Teams, Meet in a browser, FaceTime, Slack). It reads CoreAudio's list of the
// processes doing audio, and each one's "running input" flag, bundle ID and pid. Nothing is
// recorded, so macOS asks nothing. macOS 14 or later.
//
// Prints one JSON line on stdout whenever the list changes, and once at the start:
//   {"input":[{"pid":123,"bundle":"us.zoom.xos"}]}
// Checks twice a second (a handful of property reads). Exits on SIGTERM, when stdout closes, or
// when the process that started it goes.
//
//   callwatch windows <bundle id>...   the titles of those apps' windows, once, which say which
//                                      meeting a call is (Teams names it in its window's title, a
//                                      browser the tab in front). Only when macOS already lets
//                                      Bridge AI read them, through Accessibility, else Screen
//                                      Recording: it never asks. One line, then it exits:
//     {"by":"accessibility","windows":[{"bundle":"com.microsoft.teams2","title":"Weekly sync | Microsoft Teams"}]}
//     {"by":null,"windows":[]}         when it isn't allowed to read them
//   callwatch screen                   whether macOS lets Bridge AI see windows (Screen Recording),
//                                      without asking: {"allowed":true}
//   callwatch screen-ask               the same, asking macOS the first time (its own window, from
//                                      Allow on a meeting): {"allowed":false}
//   callwatch shot <out.png> <bundle id>...   a picture of the biggest window those apps have on
//                                      screen (the call's), for the names it shows as people talk.
//                                      Never asks: {"ok":true} or {"error":"not-allowed"|"no-window"}
//
//   callwatch sharing                  whether something is sharing or recording the screen now (a
//                                      call you share it on, a recording app), as the window server
//                                      says, asking nothing: a line at the start and on each change,
//     {"sharing":true}                 until stdout closes or the process that started it goes.
//     {"sharing":null}                 once, then it exits, when this macOS doesn't say.
//                                      A screenshot (⌘⇧3, 4 or 5) isn't sharing: what starts while
//                                      macOS's screenshot tool is open doesn't count. Ended once it
//                                      has stopped for a second and a half (a blip isn't the end).
//
//   swiftc -O -target arm64-apple-macos14.0 native/callwatch.swift -o native/bin/callwatch
import AppKit
import ApplicationServices
import CoreAudio
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

func address(_ sel: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}

func processes() -> [AudioObjectID] {
  var addr = address(kAudioHardwarePropertyProcessObjectList)
  let system = AudioObjectID(kAudioObjectSystemObject)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(system, &addr, 0, nil, &size) == noErr, size > 0 else { return [] }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(system, &addr, 0, nil, &size, &ids) == noErr else { return [] }
  return ids
}

func usesInput(_ id: AudioObjectID) -> Bool {
  var addr = address(kAudioProcessPropertyIsRunningInput)
  var value: UInt32 = 0
  var size = UInt32(MemoryLayout<UInt32>.size)
  return AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &value) == noErr && value != 0
}

func pidOf(_ id: AudioObjectID) -> pid_t {
  var addr = address(kAudioProcessPropertyPID)
  var value: pid_t = -1
  var size = UInt32(MemoryLayout<pid_t>.size)
  return AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &value) == noErr ? value : -1
}

func bundleOf(_ id: AudioObjectID) -> String {
  var addr = address(kAudioProcessPropertyBundleID)
  var value: Unmanaged<CFString>? = nil
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &value) == noErr, let s = value?.takeRetainedValue() else { return "" }
  return s as String
}

func quote(_ s: String) -> String {
  let data = try? JSONSerialization.data(withJSONObject: [s])
  let arr = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
  return String(arr.dropFirst().dropLast())
}

func windowTitles(_ bundles: [String]) -> (by: String?, windows: [(bundle: String, title: String)]) {
  let apps = bundles.flatMap { NSRunningApplication.runningApplications(withBundleIdentifier: $0) }
  var out: [(bundle: String, title: String)] = []
  if AXIsProcessTrusted() {
    for app in apps {
      let el = AXUIElementCreateApplication(app.processIdentifier)
      AXUIElementSetMessagingTimeout(el, 1.0) // an app that's stuck doesn't hold us up
      var value: CFTypeRef?
      guard AXUIElementCopyAttributeValue(el, kAXWindowsAttribute as CFString, &value) == .success, let windows = value as? [AXUIElement] else { continue }
      for w in windows {
        var title: CFTypeRef?
        if AXUIElementCopyAttributeValue(w, kAXTitleAttribute as CFString, &title) == .success, let s = title as? String, !s.isEmpty { out.append((app.bundleIdentifier ?? "", s)) }
      }
    }
    return ("accessibility", out)
  }
  if CGPreflightScreenCaptureAccess() {
    var bundleOfPid: [pid_t: String] = [:]
    for app in apps { bundleOfPid[app.processIdentifier] = app.bundleIdentifier ?? "" }
    let list = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    for w in list {
      guard let pid = w[kCGWindowOwnerPID as String] as? pid_t, let b = bundleOfPid[pid], (w[kCGWindowLayer as String] as? Int) == 0,
            let s = w[kCGWindowName as String] as? String, !s.isEmpty else { continue }
      out.append((b, s))
    }
    return ("screen", out)
  }
  return (nil, [])
}

// The call's window, as a PNG at out: the biggest one on screen of those apps.
func shot(_ out: String, _ bundles: [String]) -> String {
  if !CGPreflightScreenCaptureAccess() { return "{\"error\":\"not-allowed\"}" }
  let done = DispatchSemaphore(value: 0)
  var said = "{\"error\":\"no-window\"}"
  Task.detached {
    defer { done.signal() }
    guard let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true) else { return }
    let wins = content.windows.filter { w in bundles.contains(w.owningApplication?.bundleIdentifier ?? "") && w.windowLayer == 0 && w.frame.width >= 320 && w.frame.height >= 200 }
    guard let w = wins.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else { return }
    let cfg = SCStreamConfiguration()
    // Enough to read names on tiles; no bigger than 1600 wide.
    let scale = min(2.0, 1600.0 / max(1.0, Double(w.frame.width)))
    cfg.width = Int(Double(w.frame.width) * scale)
    cfg.height = Int(Double(w.frame.height) * scale)
    cfg.showsCursor = false
    guard let img = try? await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: w), configuration: cfg),
          let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, UTType.png.identifier as CFString, 1, nil) else { return }
    CGImageDestinationAddImage(dest, img, nil)
    if CGImageDestinationFinalize(dest) { said = "{\"ok\":true}" }
  }
  _ = done.wait(timeout: .now() + 8)
  return said
}

signal(SIGPIPE, SIG_DFL) // stdout closed: the server has gone, so do we
let args = CommandLine.arguments.dropFirst()
if args.first == "screen" { print("{\"allowed\":\(CGPreflightScreenCaptureAccess())}"); exit(0) }
if args.first == "screen-ask" { print("{\"allowed\":\(CGRequestScreenCaptureAccess())}"); exit(0) }
if args.first == "shot", args.count >= 3 {
  print(shot(Array(args)[1], Array(args.dropFirst(2))))
  exit(0)
}
if args.first == "windows" {
  let (by, windows) = windowTitles(Array(args.dropFirst()))
  print("{\"by\":\(by.map(quote) ?? "null"),\"windows\":[" + windows.map { "{\"bundle\":\(quote($0.bundle)),\"title\":\(quote($0.title))}" }.joined(separator: ",") + "]}")
  exit(0)
}
if args.first == "sharing" {
  // CGSIsScreenWatcherPresent: the window server's own word on whether anything is capturing the
  // screen, which macOS has no public call for (what Focus's "when sharing the screen" goes by).
  typealias Present = @convention(c) () -> Bool
  guard let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGSIsScreenWatcherPresent") else {
    print("{\"sharing\":null}")
    exit(0)
  }
  let present = unsafeBitCast(sym, to: Present.self)
  let parent = getppid()
  var sharing = false
  var said: Bool? = nil
  var quiet = 0
  while true {
    let watched = present()
    let shooting = !NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.screencaptureui").isEmpty
    if watched && !shooting { sharing = true; quiet = 0 } else if !watched { quiet += 1; if quiet >= 6 { sharing = false } }
    if sharing != said {
      said = sharing
      print("{\"sharing\":\(sharing)}")
      fflush(stdout)
    }
    if getppid() != parent { exit(0) }
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.25))
  }
}
let parent = getppid()
var last = ""
while true {
  let using = processes().filter(usesInput).map { (pid: pidOf($0), bundle: bundleOf($0)) }.sorted { $0.pid < $1.pid }
  let line = "{\"input\":[" + using.map { "{\"pid\":\($0.pid),\"bundle\":\(quote($0.bundle))}" }.joined(separator: ",") + "]}"
  if line != last {
    last = line
    print(line)
    fflush(stdout)
  }
  if getppid() != parent { exit(0) }
  usleep(500_000)
}
