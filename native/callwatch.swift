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
//   callwatch faces <n> <gap ms> <bundle id>...   n pictures of that window, gap ms apart, read
//                                      on this Mac for the faces on them and how open each mouth
//                                      is, and the names on the tiles (faces(), below). Never asks.
//   callwatch faces-files <png>...     the same for pictures already taken, to check it by.
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
import Vision

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

// Whose mouth moves on the call's video: `frames` pictures of the call's window, `gap` ms apart, each
// read by Vision for the faces on it and how open each mouth is (the inner lips' height, as a share
// of the face's), and the first for the words on it and where (the names on the tiles). A face is
// followed from picture to picture by where it is: tiles stay put for a second. Everything stays in
// memory, nothing is written, and only the numbers and words come out:
//   {"ok":true,"faces":[{"x":0.1,"y":0.2,"w":0.08,"h":0.12,"open":[0.01,0.06,...]}],"labels":[{"x":...,"text":"Priya Shah"}]}
// x, y, w and h are shares of the window's width and height, from its top left.
func faces(_ frames: Int, _ gap: Int, _ bundles: [String]) -> String {
  if !CGPreflightScreenCaptureAccess() { return "{\"error\":\"not-allowed\"}" }
  let done = DispatchSemaphore(value: 0)
  var shots: [CGImage] = []
  Task.detached {
    defer { done.signal() }
    guard let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true) else { return }
    let wins = content.windows.filter { w in bundles.contains(w.owningApplication?.bundleIdentifier ?? "") && w.windowLayer == 0 && w.frame.width >= 320 && w.frame.height >= 200 }
    guard let w = wins.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else { return }
    let cfg = SCStreamConfiguration()
    // Faces in a room's camera are small: up to twice the window's points, and 2400 wide.
    let scale = min(2.0, 2400.0 / max(1.0, Double(w.frame.width)))
    cfg.width = Int(Double(w.frame.width) * scale)
    cfg.height = Int(Double(w.frame.height) * scale)
    cfg.showsCursor = false
    let filter = SCContentFilter(desktopIndependentWindow: w)
    for i in 0..<frames {
      if i > 0 { try? await Task.sleep(nanoseconds: UInt64(gap) * 1_000_000) }
      if let img = try? await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg) { shots.append(img) }
    }
  }
  _ = done.wait(timeout: .now() + .milliseconds(frames * (gap + 1500) + 2000))
  return shots.isEmpty ? "{\"error\":\"no-window\"}" : facesIn(shots)
}

func facesIn(_ shots: [CGImage]) -> String {
  struct Face { var x, y, w, h: Double; var open: [Double] }
  var tracked: [Face] = []
  for img in shots {
    let req = VNDetectFaceLandmarksRequest()
    try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
    for o in req.results ?? [] {
      let b = o.boundingBox // Vision's: from the bottom left
      let f = Face(x: b.minX, y: 1 - b.maxY, w: b.width, h: b.height, open: [])
      guard let lips = o.landmarks?.innerLips?.normalizedPoints, lips.count >= 4 else { continue }
      let ys = lips.map { Double($0.y) }
      let open = (ys.max()! - ys.min()!)
      let cx = f.x + f.w / 2, cy = f.y + f.h / 2
      if let i = tracked.firstIndex(where: { t in abs(t.x + t.w / 2 - cx) < max(t.w, f.w) / 2 && abs(t.y + t.h / 2 - cy) < max(t.h, f.h) / 2 }) {
        tracked[i].open.append(open)
      } else {
        var n = f
        n.open = [open]
        tracked.append(n)
      }
    }
  }
  let text = VNRecognizeTextRequest()
  text.recognitionLevel = .accurate
  text.usesLanguageCorrection = false
  try? VNImageRequestHandler(cgImage: shots[0], options: [:]).perform([text])
  let labels: [[String: Any]] = (text.results ?? []).prefix(200).compactMap { o in
    guard let s = o.topCandidates(1).first, s.confidence >= 0.3 else { return nil }
    let b = o.boundingBox
    return ["x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height, "text": String(s.string.prefix(60))]
  }
  let round = { (v: Double) in (v * 10000).rounded() / 10000 }
  let out: [String: Any] = [
    "ok": true, "frames": shots.count,
    "faces": tracked.prefix(40).map { ["x": round($0.x), "y": round($0.y), "w": round($0.w), "h": round($0.h), "open": $0.open.map(round)] },
    "labels": labels,
  ]
  guard let data = try? JSONSerialization.data(withJSONObject: out), let s = String(data: data, encoding: .utf8) else { return "{\"error\":\"unreadable\"}" }
  return s
}

signal(SIGPIPE, SIG_DFL) // stdout closed: the server has gone, so do we
let args = CommandLine.arguments.dropFirst()
if args.first == "screen" { print("{\"allowed\":\(CGPreflightScreenCaptureAccess())}"); exit(0) }
if args.first == "screen-ask" { print("{\"allowed\":\(CGRequestScreenCaptureAccess())}"); exit(0) }
if args.first == "shot", args.count >= 3 {
  print(shot(Array(args)[1], Array(args.dropFirst(2))))
  exit(0)
}
if args.first == "faces", args.count >= 4 {
  let a = Array(args)
  print(faces(max(1, min(12, Int(a[1]) ?? 6)), max(0, min(1000, Int(a[2]) ?? 160)), Array(a.dropFirst(3))))
  exit(0)
}
if args.first == "faces-files", args.count >= 2 {
  let imgs = args.dropFirst().compactMap { f -> CGImage? in
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: f) as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
  }
  print(imgs.isEmpty ? "{\"error\":\"unreadable\"}" : facesIn(imgs))
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
