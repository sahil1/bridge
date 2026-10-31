import Foundation
import Security
import WebKit

// Cloud agents on the phone alone (src/cloud, bundled as bridge-ui://cloud/): your own keys for
// Cursor, GitHub Copilot, Jules and Claude, kept here and never handed to the page. The page asks
// the app to make each request to a provider (fetch below); the app checks the address is that
// provider's own API, adds the key itself, and passes back the answer with the key taken out. The
// page can set, test or remove a key and learn whether one is set and its last 4 characters.
//
// Keys are in the Keychain, on this iPhone only, readable while it's unlocked, never in backups to
// another phone or iCloud. What's kept for the agents you started is a file in the app's own
// folder, left out of backups, and goes with the key. iPhone apps can't check in the background on
// their own, so agents are followed while the app is open.
final class CloudBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "cloud"
    private static let service = "dev.bridge-ai.phone.cloud"
    private static let providers = ["cursor", "copilot", "jules", "claude"]
    private static let standInGithub = "\"bridge-app-key:claude.github\""
    private static let passed: Set<String> = ["accept", "content-type", "if-none-match", "x-github-api-version", "anthropic-version", "anthropic-beta"]
    private static let kept = ["content-type", "etag", "retry-after", "x-ratelimit-remaining", "x-ratelimit-reset"]

    // Each provider's API address and the header its key goes in: providers.json, written into the
    // bundled page from the adapters (vite.config.js), read from the app itself.
    private lazy var known: [String: [String: String]] = {
        guard let url = Bundle.main.url(forResource: "providers", withExtension: "json", subdirectory: "cloud"),
              let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: [String: String]] else { return [:] }
        return json
    }()

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.httpCookieStorage = nil
        config.urlCache = nil
        return URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    }()

    static func available() -> Bool { BundledUI.has("cloud") }

    // ---------- Messages from the page ----------
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        // Only the Cloud agents page itself, not a frame in it or any other page.
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == BundledUI.scheme, origin.host == "cloud",
              let m = message.body as? [String: Any], let op = m["op"] as? String else { return replyHandler(nil, "Not allowed") }
        let reply: (Any?, String?) -> Void = { value, error in DispatchQueue.main.async { replyHandler(value, error) } }
        do {
            switch op {
            case "config":
                let s = state()
                reply(["keys": view(), "state": s["agents"] ?? [:], "rev": s["rev"] ?? 0, "bases": Self.testBases()], nil)
            case "load":
                let s = state()
                reply(["state": s["agents"] ?? [:], "rev": s["rev"] ?? 0], nil)
            case "setKey":
                let slot = try slot(m["slot"])
                let key = (m["key"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                guard !key.isEmpty else { throw Problem("Paste a key first") }
                guard key.count <= 4096, !key.contains(where: { $0.isWhitespace || $0 == "\0" }) else { throw Problem("That doesn't look like a key") }
                Self.write(slot, key)
                reply(["keys": view()], nil)
            case "copyKey":
                guard let key = Self.read(try slot(m["from"])) else { throw Problem("There's no key to copy") }
                Self.write(try slot(m["to"]), key)
                reply(["keys": view()], nil)
            case "removeKey":
                // A provider's key goes with its GitHub token and everything kept for its agents.
                let slot = try slot(m["slot"])
                Self.delete(slot)
                if Self.providers.contains(slot) {
                    Self.delete("\(slot).github")
                    _ = save(slot, nil)
                }
                reply(["keys": view()], nil)
            case "save":
                let provider = try slot(m["provider"])
                guard Self.providers.contains(provider) else { throw Problem("Unknown provider") }
                reply(["rev": save(provider, m["state"] as? String)], nil)
            case "fetch":
                try fetch(m, reply)
            default:
                throw Problem("Unknown request")
            }
        } catch {
            reply(nil, (error as? Problem)?.text ?? error.localizedDescription)
        }
    }

    private struct Problem: Error { let text: String; init(_ t: String) { text = t } }

    private func slot(_ v: Any?) throws -> String {
        guard let s = v as? String, known[s] != nil else { throw Problem("Unknown provider") }
        return s
    }

    // ---------- A request to a provider ----------
    private func fetch(_ m: [String: Any], _ reply: @escaping (Any?, String?) -> Void) throws {
        let provider = try slot(m["provider"])
        guard let p = known[provider], let api = p["base"].flatMap(URL.init(string:)), let header = p["header"] else { throw Problem("Unknown provider") }
        guard let key = Self.read(provider) else { throw Problem("No key saved for that provider") }
        guard let url = URL(string: m["url"] as? String ?? "") else { throw Problem("That isn't an address") }
        // Its own API only: https on its host (debug builds may also name a stand-in for testing).
        let own = url.scheme == "https" && url.host?.lowercased() == api.host?.lowercased() && (url.port == nil || url.port == 443)
        guard own || Self.testAllows(provider, url) else { throw Problem("That address isn't \(api.host ?? "its API")") }
        let method = (m["method"] as? String ?? "GET").uppercased()
        guard ["GET", "POST", "PUT", "PATCH", "DELETE"].contains(method) else { throw Problem("Unsupported request") }
        var body = m["body"] as? String
        // Claude can take your GitHub token for the repo: the page names it, the app puts it in,
        // only in the request that starts a session, to Anthropic.
        if let b = body, b.contains(Self.standInGithub) {
            guard provider == "claude", method == "POST", url.path == "/v1/sessions" else { throw Problem("Unsupported request") }
            let token = Self.read("claude.github") ?? ""
            let quoted = (try? JSONSerialization.data(withJSONObject: token, options: .fragmentsAllowed)).flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
            body = b.replacingOccurrences(of: Self.standInGithub, with: quoted)
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        for (name, value) in m["headers"] as? [String: Any] ?? [:] where Self.passed.contains(name.lowercased()) { req.setValue("\(value)", forHTTPHeaderField: name) }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1"
        req.setValue("BridgeAI/\(version) (iPhone)", forHTTPHeaderField: "User-Agent")
        let scheme = p["scheme"] ?? ""
        req.setValue(scheme.isEmpty ? key : "\(scheme) \(key)", forHTTPHeaderField: header)
        if let body, !body.isEmpty { req.httpBody = Data(body.utf8) }
        let secrets = Self.slots().compactMap(Self.read).filter { $0.count > 6 }
        session.dataTask(with: req) { data, response, error in
            guard let http = response as? HTTPURLResponse else { return reply(nil, error?.localizedDescription ?? "Couldn't reach it") }
            var text = String(data: data ?? Data(), encoding: .utf8) ?? ""
            // Never a key back to the page, even if a provider repeats one.
            for s in secrets { text = text.replacingOccurrences(of: s, with: "***") }
            var headers: [String: String] = [:]
            for name in Self.kept { if let v = http.value(forHTTPHeaderField: name) { headers[name] = v } }
            reply(["status": http.statusCode, "headers": headers, "body": text], nil)
        }.resume()
    }

    // A redirect could carry the key elsewhere: none are followed.
    private final class NoRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }

    // ---------- Keys, in the Keychain ----------
    private static func query(_ slot: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: slot]
    }

    static func read(_ slot: String) -> String? {
        var q = query(slot)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func write(_ slot: String, _ key: String) {
        delete(slot)
        var item = query(slot)
        item[kSecValueData as String] = Data(key.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }

    static func delete(_ slot: String) { SecItemDelete(query(slot) as CFDictionary) }

    static func slots() -> [String] {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitAll]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let items = out as? [[String: Any]] else { return [] }
        return items.compactMap { $0[kSecAttrAccount as String] as? String }
    }

    // What the page may know: which slots have a key, and the last 4 characters of a long one.
    private func view() -> [String: Any] {
        var out: [String: Any] = [:]
        for s in Self.slots() { if let k = Self.read(s) { out[s] = ["set": true, "last4": k.count >= 16 ? String(k.suffix(4)) : ""] } }
        return out
    }

    // ---------- What's kept for the agents ----------
    private var stateFile: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("cloud-state.json")
    }

    private func state() -> [String: Any] {
        (try? Data(contentsOf: stateFile)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    }

    private func save(_ provider: String, _ value: String?) -> Int {
        var s = state()
        var agents = s["agents"] as? [String: Any] ?? [:]
        agents[provider] = value
        let rev = (s["rev"] as? Int ?? 0) + 1
        s = ["agents": agents, "rev": rev]
        var file = stateFile
        if let data = try? JSONSerialization.data(withJSONObject: s) {
            try? data.write(to: file, options: [.atomic, .completeFileProtection])
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? file.setResourceValues(values)
        }
        return rev
    }

    // ---------- Stand-in providers, debug builds only ----------
    // xcrun simctl launch booted dev.bridge-ai.phone -open cloud -cloudMock 127.0.0.1 points Cursor
    // at http://127.0.0.1:7701, GitHub at :7702, Jules at :7703 and Claude at :7704. Release builds
    // compile none of this: they only ever talk to each provider's own https API.
    private static let testPorts = ["cursor": 7701, "copilot": 7702, "jules": 7703, "claude": 7704, "claude.github": 7702]
    private static func testHost() -> String? {
        #if DEBUG
        return UserDefaults.standard.string(forKey: "cloudMock").flatMap { $0 == "127.0.0.1" ? $0 : nil }
        #else
        return nil
        #endif
    }

    private static func testBases() -> [String: String] {
        guard let h = testHost() else { return [:] }
        return Dictionary(uniqueKeysWithValues: providers.map { ($0, "http://\(h):\(testPorts[$0]!)") })
    }

    private static func testAllows(_ provider: String, _ url: URL) -> Bool {
        guard let h = testHost() else { return false }
        return url.scheme == "http" && url.host == h && url.port == testPorts[provider]
    }
}
