import CryptoKit
import Foundation
import WebKit

// What the phone page keeps for when your computer is offline (relay/web/offline.js): a saved copy
// of what Bridge AI last showed, and the messages waiting to go. Safari keeps it in IndexedDB; here
// the page asks the app instead ({ op: get | set | del | clear, relay, key, value }). Files in
// Application Support, a folder per computer (by its relay), left out of backups. Forgetting a
// computer deletes its folder.
final class OfflineStore: NSObject, WKScriptMessageHandlerWithReply {
    private let queue = DispatchQueue(label: "dev.bridge-ai.offline")

    nonisolated private static let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("offline", isDirectory: true)
    nonisolated private static func hash(_ s: String) -> String { SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined() }
    nonisolated private static func folder(_ relay: String) -> URL { base.appendingPathComponent(hash(relay), isDirectory: true) }

    static func forget(_ relay: String) { try? FileManager.default.removeItem(at: folder(relay)) }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        // Only the phone page itself, not Bridge AI in its frame.
        guard message.frameInfo.isMainFrame, let m = message.body as? [String: Any], let op = m["op"] as? String,
              let relay = m["relay"] as? String, !relay.isEmpty else { return replyHandler(nil, "Not allowed") }
        let dir = Self.folder(relay)
        let file = (m["key"] as? String).map { dir.appendingPathComponent(Self.hash($0)) }
        let value = m["value"] as? String
        queue.async {
            let fm = FileManager.default
            var out: String?
            switch op {
            case "get": out = file.flatMap { try? String(contentsOf: $0, encoding: .utf8) }
            case "set":
                guard let file, let value else { break }
                if !fm.fileExists(atPath: Self.base.path) {
                    try? fm.createDirectory(at: Self.base, withIntermediateDirectories: true)
                    var url = Self.base
                    var values = URLResourceValues()
                    values.isExcludedFromBackup = true
                    try? url.setResourceValues(values)
                }
                try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
                try? value.write(to: file, atomically: true, encoding: .utf8)
            case "del": if let file { try? fm.removeItem(at: file) }
            case "clear": try? fm.removeItem(at: dir)
            default: break
            }
            let answer = out
            DispatchQueue.main.async { replyHandler(answer, nil) }
        }
    }
}
