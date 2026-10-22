import Foundation
import WebKit

// Answers everything the page asks of bridge-app://app. The phone page's own files come from the
// app; everything else is Bridge AI on your computer, so it's handed to the page (bridgeTunnel in
// relay/web/shell.js), which sends it over the encrypted link and passes the answer back in pieces
// (answer() below). It does what the service worker (relay/web/sw.js) does in Safari.
final class Tunnel: NSObject, WKURLSchemeHandler {
    weak var web: WKWebView?
    private var tasks: [Int: Pending] = [:]
    private var next = 1

    private final class Pending {
        let task: WKURLSchemeTask
        var answered = false
        init(_ task: WKURLSchemeTask) { self.task = task }
    }

    // The phone page and its files, by the path the page asks for.
    private static let own: [String: (String, String?, String)] = [
        "/_relay/shell": ("index", "web", "text/html; charset=utf-8"),
        "/shell.js": ("shell", "web", "text/javascript; charset=utf-8"),
        "/link.js": ("link", "web", "text/javascript; charset=utf-8"),
        "/offline.js": ("offline", "web", "text/javascript; charset=utf-8"),
        "/manifest.webmanifest": ("manifest", "web", "application/manifest+json"),
        "/icon-512.png": ("icon-512", nil, "image/png"),
        "/apple-touch-icon.png": ("apple-touch-icon", nil, "image/png"),
        "/mark.svg": ("mark", nil, "image/svg+xml"),
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        let path = parts.percentEncodedPath.isEmpty ? "/" : parts.percentEncodedPath
        if let (name, dir, type) = Self.own[path] {
            let ext = path == "/_relay/shell" ? "html" : (path as NSString).pathExtension
            let file = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: dir)
            return reply(task, status: file == nil ? 404 : 200, type: type, body: file.flatMap { try? Data(contentsOf: $0) } ?? Data())
        }
        if path.hasPrefix("/_relay/") { return reply(task, status: 404, type: "text/plain", body: Data()) }

        let id = next
        next += 1
        tasks[id] = Pending(task)
        let req = task.request
        var body = req.httpBody
        if body == nil, let stream = req.httpBodyStream { body = Self.read(stream) }
        var payload: [String: Any] = [
            "m": req.httpMethod ?? "GET",
            "u": path + (parts.percentEncodedQuery.map { "?\($0)" } ?? ""),
            "h": (req.allHTTPHeaderFields ?? [:]).map { [$0.key, $0.value] },
        ]
        if let body, !body.isEmpty { payload["body"] = body.base64EncodedString() }
        guard let json = try? JSONSerialization.data(withJSONObject: payload), let arg = String(data: json, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.bridgeTunnel(\(id), \(arg))") { [weak self] _, error in
            if error != nil { self?.answer(["id": id, "error": "The app isn't ready yet"]) }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        guard let id = tasks.first(where: { $0.value.task === task })?.key else { return }
        tasks[id] = nil
        webView.evaluateJavaScript("window.bridgeCancel && window.bridgeCancel(\(id))")
    }

    // A piece of an answer from the page: { id, head: { s, h } } | { id, chunk } | { id, end } | { id, error }.
    func answer(_ m: [String: Any]) {
        guard let id = (m["id"] as? NSNumber)?.intValue, let p = tasks[id], let url = p.task.request.url else { return }
        if let head = m["head"] as? [String: Any] {
            let status = (head["s"] as? NSNumber)?.intValue ?? 200
            var headers: [String: String] = [:]
            for pair in head["h"] as? [[String]] ?? [] where pair.count == 2 { headers[pair[0]] = pair[1] }
            p.answered = true
            p.task.didReceive(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!)
        } else if let chunk = m["chunk"] as? String, let data = Data(base64Encoded: chunk) {
            p.task.didReceive(data)
        } else if m["end"] != nil {
            p.task.didFinish()
            tasks[id] = nil
        } else if let error = m["error"] as? String {
            tasks[id] = nil
            if p.answered { p.task.didFailWithError(URLError(.networkConnectionLost)) }
            else { reply(p.task, status: 503, type: "text/plain; charset=utf-8", body: Data(error.utf8)) }
        }
    }

    private func reply(_ task: WKURLSchemeTask, status: Int, type: String, body: Data) {
        task.didReceive(HTTPURLResponse(url: task.request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type, "Cache-Control": "no-cache"])!)
        task.didReceive(body)
        task.didFinish()
    }

    private static func read(_ stream: InputStream) -> Data {
        var data = Data()
        stream.open()
        defer { stream.close() }
        var buf = [UInt8](repeating: 0, count: 64 * 1024)
        while stream.hasBytesAvailable {
            let n = stream.read(&buf, maxLength: buf.count)
            if n <= 0 { break }
            data.append(buf, count: n)
        }
        return data
    }
}
