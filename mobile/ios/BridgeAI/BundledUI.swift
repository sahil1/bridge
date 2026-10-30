import Foundation
import WebKit

// Bridge AI's own UI bundled in the app, to run with no computer behind it: the demo. Each is a
// folder in the app (built by project.yml's pre-build script) served from bridge-ui://<name>/, so
// each has an address, and storage, of its own, apart from your computers.
final class BundledUI: NSObject, WKURLSchemeHandler {
    static let scheme = "bridge-ui"
    static func url(_ name: String) -> URL { URL(string: "\(scheme)://\(name)/index.html")! }
    static func has(_ name: String) -> Bool { Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: name) != nil }

    private static let types = [
        "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
        "svg": "image/svg+xml", "png": "image/png", "json": "application/json",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let name = url.host else { return }
        // Only files inside that UI's own folder.
        let root = Bundle.main.bundleURL.appendingPathComponent(name, isDirectory: true).standardizedFileURL
        let file = root.appendingPathComponent(url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())).standardizedFileURL
        let data = file.path.hasPrefix(root.path + "/") ? try? Data(contentsOf: file) : nil
        let type = data == nil ? "text/plain" : Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        task.didReceive(HTTPURLResponse(url: url, statusCode: data == nil ? 404 : 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": type, "Cache-Control": "no-cache"])!)
        task.didReceive(data ?? Data())
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
