// calltap: the sound of a call (everything this Mac plays, except this process and the ones named
// with --exclude) as 16 kHz mono 16-bit PCM on stdout, for Bridge AI's meeting notes.
//
// A Core Audio process tap (macOS 14.2 and later): macOS asks once for System Audio Recording, and
// there's no screen recording and no video. The tap is private to this process and leaves what you
// hear as it is. Apple's converter brings the tap's own rate (often 48 kHz) down to the one asked for.
//
// Stops on SIGTERM, SIGINT or SIGHUP, when whatever reads stdout goes away, or when the process that
// started it does; the tap and its device go with it. Lines on stderr: "ready <rate>" once it
// records, "error: ..." when it can't (exit 3: macOS too old).
//
// Build: swiftc -O -target arm64-apple-macos14.2 native/calltap.swift -o calltap (and x86_64, then lipo).
import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation

setvbuf(stderr, nil, _IONBF, 0)
signal(SIGPIPE, SIG_IGN)

func say(_ s: String) { FileHandle.standardError.write(Data("\(s)\n".utf8)) }
func fail(_ s: String, _ code: Int32 = 1) -> Never { say("error: \(s)"); exit(code) }

var rate = 16000.0
var excluded: [pid_t] = []
var argv = CommandLine.arguments.dropFirst().makeIterator()
while let a = argv.next() {
  switch a {
  case "--rate": rate = Double(argv.next() ?? "") ?? 16000
  case "--exclude": excluded += (argv.next() ?? "").split(separator: ",").compactMap { pid_t($0) }
  default: fail("unknown argument \(a)", 2)
  }
}

// Core Audio's object for a running process, to leave it out of the tap.
func processObject(_ pid: pid_t) -> AudioObjectID? {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var p = pid
  var obj = AudioObjectID(kAudioObjectUnknown)
  var size = UInt32(MemoryLayout<AudioObjectID>.size)
  let err = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, UInt32(MemoryLayout<pid_t>.size), &p, &size, &obj)
  return err == noErr && obj != kAudioObjectUnknown ? obj : nil
}

@available(macOS 14.2, *)
final class CallTap {
  private var tap = AudioObjectID(kAudioObjectUnknown)
  private var device = AudioObjectID(kAudioObjectUnknown)
  private var proc: AudioDeviceIOProcID?
  private let queue = DispatchQueue(label: "calltap.audio")
  private var converter: AVAudioConverter?
  private var inFormat: AVAudioFormat?
  private let outFormat: AVAudioFormat
  private var stopped = false

  init(rate: Double) {
    outFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: rate, channels: 1, interleaved: true)!
  }

  func start(excluding pids: [pid_t]) throws -> Double {
    let desc = CATapDescription(monoGlobalTapButExcludeProcesses: ([getpid()] + pids).compactMap(processObject))
    desc.uuid = UUID()
    desc.name = "Bridge AI meeting notes"
    desc.isPrivate = true
    desc.muteBehavior = .unmuted
    try check(AudioHardwareCreateProcessTap(desc, &tap), "make the tap")

    var addr = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var asbd = AudioStreamBasicDescription()
    var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    try check(AudioObjectGetPropertyData(tap, &addr, 0, nil, &size, &asbd), "read the tap's format")
    guard let f = AVAudioFormat(streamDescription: &asbd), let c = AVAudioConverter(from: f, to: outFormat) else { throw Failure("the tap's format can't be converted") }
    inFormat = f
    converter = c

    // A private device holding only the tap (adding the speakers too would double the sound).
    let agg: [String: Any] = [
      kAudioAggregateDeviceNameKey: "Bridge AI meeting notes",
      kAudioAggregateDeviceUIDKey: UUID().uuidString,
      kAudioAggregateDeviceIsPrivateKey: true,
      kAudioAggregateDeviceIsStackedKey: false,
      kAudioAggregateDeviceTapAutoStartKey: true,
      kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: desc.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]],
    ]
    try check(AudioHardwareCreateAggregateDevice(agg as CFDictionary, &device), "make the recording device")
    try check(AudioDeviceCreateIOProcIDWithBlock(&proc, device, queue) { [weak self] _, input, _, _, _ in self?.take(input) }, "listen to it")
    try check(AudioDeviceStart(device, proc), "start recording")
    return f.sampleRate
  }

  private func take(_ input: UnsafePointer<AudioBufferList>) {
    guard !stopped, let inFormat, let converter,
          let buf = AVAudioPCMBuffer(pcmFormat: inFormat, bufferListNoCopy: input, deallocator: nil), buf.frameLength > 0 else { return }
    let room = AVAudioFrameCount(Double(buf.frameLength) * outFormat.sampleRate / inFormat.sampleRate) + 64
    guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: room) else { return }
    var given = false
    var error: NSError?
    // .noDataNow, not end of stream: the converter keeps its state between pieces, so there are
    // no clicks where they meet.
    converter.convert(to: out, error: &error) { _, status in
      if given { status.pointee = .noDataNow; return nil }
      given = true
      status.pointee = .haveData
      return buf
    }
    guard error == nil, out.frameLength > 0, let ch = out.int16ChannelData else { return }
    let bytes = Int(out.frameLength) * MemoryLayout<Int16>.size
    let wrote = fwrite(ch[0], 1, bytes, stdout)
    fflush(stdout)
    if wrote < bytes { stop(); exit(0) } // nobody's reading any more
  }

  func stop() {
    if stopped { return }
    stopped = true
    if let proc { AudioDeviceStop(device, proc); AudioDeviceDestroyIOProcID(device, proc) }
    if device != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(device) }
    if tap != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tap) }
  }

  private func check(_ status: OSStatus, _ what: String) throws {
    if status != noErr { throw Failure("couldn't \(what) (\(status))") }
  }
}

struct Failure: Error, CustomStringConvertible {
  let description: String
  init(_ s: String) { description = s }
}

guard #available(macOS 14.2, *) else { fail("recording a call's sound needs macOS 14.2 or later", 3) }
let recorder = CallTap(rate: rate)
do {
  let from = try recorder.start(excluding: excluded)
  say("ready \(Int(from))")
} catch {
  recorder.stop()
  fail("\(error)")
}

var signals: [DispatchSourceSignal] = []
for sig in [SIGTERM, SIGINT, SIGHUP] {
  signal(sig, SIG_IGN)
  let s = DispatchSource.makeSignalSource(signal: sig, queue: .main)
  s.setEventHandler { recorder.stop(); exit(0) }
  s.resume()
  signals.append(s)
}
// Whoever started it is gone (it was handed to launchd): stop too.
let parent = getppid()
let watch = DispatchSource.makeTimerSource(queue: .main)
watch.schedule(deadline: .now() + 2, repeating: 2)
watch.setEventHandler { if getppid() != parent { recorder.stop(); exit(0) } }
watch.resume()
dispatchMain()
