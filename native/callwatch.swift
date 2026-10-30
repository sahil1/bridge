// callwatch: which apps are using a microphone right now, so meeting notes can notice a call start
// and end (Zoom, Teams, Meet in a browser, FaceTime, Slack). It reads CoreAudio's list of the
// processes doing audio, and each one's "running input" flag, bundle ID and pid. Nothing is
// recorded, so macOS asks nothing. macOS 14 or later.
//
// Prints one JSON line on stdout whenever the list changes, and once at the start:
//   {"input":[{"pid":123,"bundle":"us.zoom.xos"}]}
// Checks twice a second (a handful of property reads). Exits on SIGTERM, when stdout closes, or
// when the process that started it goes.
//   swiftc -O -target arm64-apple-macos14.0 native/callwatch.swift -o native/bin/callwatch
import CoreAudio
import Foundation

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

signal(SIGPIPE, SIG_DFL) // stdout closed: the server has gone, so do we
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
