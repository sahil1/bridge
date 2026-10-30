// bridgeocr: the text in a picture (a screen captured in a meeting) or a PDF, for meeting notes.
// Everything stays on this Mac: Vision reads the picture, PDFKit the PDF.
//   bridgeocr image <file>          the lines of text in the picture, top to bottom
//   bridgeocr pdf <file> [pages]    the text of each page (the first 60, or as many as given)
// Prints UTF-8 text; exits 1 with a message on stderr when it can't read the file.
import Foundation
import Vision
import PDFKit

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(1)
}

let args = CommandLine.arguments
guard args.count >= 3 else { fail("usage: bridgeocr image|pdf <file> [pages]") }
let url = URL(fileURLWithPath: args[2])

switch args[1] {
case "image":
  let handler = VNImageRequestHandler(url: url, options: [:])
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = true
  req.automaticallyDetectsLanguage = true
  do { try handler.perform([req]) } catch { fail("Couldn't read the picture: \(error.localizedDescription)") }
  // Top to bottom, then left to right (Vision's y runs up from the bottom).
  let found = (req.results ?? []).compactMap { o -> (CGRect, String)? in
    guard let t = o.topCandidates(1).first, t.confidence >= 0.3 else { return nil }
    return (o.boundingBox, t.string)
  }.sorted { a, b in abs(a.0.midY - b.0.midY) > 0.01 ? a.0.midY > b.0.midY : a.0.minX < b.0.minX }
  print(found.map { $0.1 }.joined(separator: "\n"))
case "pdf":
  guard let doc = PDFDocument(url: url) else { fail("Couldn't open the PDF") }
  if doc.isLocked { fail("The PDF is locked with a password") }
  let most = args.count > 3 ? max(1, Int(args[3]) ?? 60) : 60
  var out: [String] = []
  for i in 0..<min(doc.pageCount, most) {
    let text = (doc.page(at: i)?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !text.isEmpty { out.append("--- Page \(i + 1) ---\n\(text)") }
  }
  if doc.pageCount > most { out.append("(\(doc.pageCount - most) more pages not read)") }
  print(out.joined(separator: "\n\n"))
default:
  fail("usage: bridgeocr image|pdf <file> [pages]")
}
