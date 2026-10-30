// Speech to text on the Mac itself, for meeting notes when whisper.cpp isn't set up: Apple's own
// on-device transcriber (the Speech framework, macOS 26 and later), which needs no download from
// us and nothing installed. Nothing leaves the Mac. server/speech.js runs it.
//   bridgespeech status [lang]       {"available":true,"locale":"en-US","installed":true}
//   bridgespeech install [lang]      fetches the language's model through macOS (once), then the status
//   bridgespeech file <wav> [lang]   the text
// lang: a language like en or en-US, or "auto" for the Mac's own.
import AVFoundation
import Foundation
import Speech

func out(_ obj: [String: Any]) {
  let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}
func fail(_ msg: String) -> Never {
  FileHandle.standardError.write(Data("\(msg)\n".utf8))
  exit(1)
}

@available(macOS 26.0, *)
func locale(_ arg: String?) async -> Locale? {
  let want = (arg == nil || arg == "auto" || arg == "") ? Locale.current : Locale(identifier: arg!)
  return await SpeechTranscriber.supportedLocale(equivalentTo: want)
}

@available(macOS 26.0, *)
func installed(_ loc: Locale) async -> Bool {
  let tag = loc.identifier(.bcp47)
  return await SpeechTranscriber.installedLocales.contains { $0.identifier(.bcp47) == tag }
}

@available(macOS 26.0, *)
func status(_ arg: String?) async -> [String: Any] {
  guard SpeechTranscriber.isAvailable else { return ["available": false, "why": "This Mac can't transcribe on its own"] }
  guard let loc = await locale(arg) else { return ["available": false, "why": "This language isn't one the Mac transcribes"] }
  return ["available": true, "locale": loc.identifier(.bcp47), "installed": await installed(loc)]
}

@available(macOS 26.0, *)
func install(_ loc: Locale) async throws {
  let t = SpeechTranscriber(locale: loc, preset: .transcription)
  if let request = try await AssetInventory.assetInstallationRequest(supporting: [t]) {
    try await request.downloadAndInstall()
  }
}

@available(macOS 26.0, *)
func transcribe(_ path: String, _ arg: String?) async throws -> String {
  guard let loc = await locale(arg) else { fail("This language isn't one the Mac transcribes") }
  if !(await installed(loc)) { try await install(loc) }
  let t = SpeechTranscriber(locale: loc, preset: .transcription)
  let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
  let analyzer = SpeechAnalyzer(modules: [t])
  let text = Task { () throws -> String in
    var all = ""
    for try await r in t.results { all += String(r.text.characters) }
    return all
  }
  if let end = try await analyzer.analyzeSequence(from: file) {
    try await analyzer.finalizeAndFinish(through: end)
  } else {
    await analyzer.cancelAndFinishNow()
  }
  return try await text.value.trimmingCharacters(in: .whitespacesAndNewlines)
}

@main
struct BridgeSpeech {
  static func main() async {
    let args = CommandLine.arguments
    guard args.count >= 2 else { fail("usage: bridgespeech status|install|file <wav> [lang]") }
    guard #available(macOS 26.0, *) else {
      if args[1] == "status" { out(["available": false, "why": "Needs macOS 26 or later"]); exit(0) }
      fail("Transcribing on the Mac itself needs macOS 26 or later")
    }
    do {
      switch args[1] {
      case "status":
        out(await status(args.count > 2 ? args[2] : nil))
      case "install":
        guard let loc = await locale(args.count > 2 ? args[2] : nil) else { fail("This language isn't one the Mac transcribes") }
        try await install(loc)
        out(await status(args.count > 2 ? args[2] : nil))
      case "file":
        guard args.count >= 3 else { fail("usage: bridgespeech file <wav> [lang]") }
        print(try await transcribe(args[2], args.count > 3 ? args[3] : nil))
      default:
        fail("usage: bridgespeech status|install|file <wav> [lang]")
      }
    } catch {
      fail(error.localizedDescription)
    }
  }
}
