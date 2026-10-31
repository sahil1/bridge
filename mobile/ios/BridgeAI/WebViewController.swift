import UIKit
import WebKit

// The whole app: the relay's phone page (relay/web, bundled in), served from bridge-app://app.
// The page keeps the end-to-end encrypted link to your computer, as it does in Safari. Safari
// gives it a service worker to carry Bridge AI's requests over that link; an app can't have one
// for an address that's different for everyone, so Tunnel does that job here. With no computer,
// the phone page can offer the demo instead, which is bundled in too (BundledUI), and Cloud agents:
// agents on Cursor, Copilot, Jules or Claude with your own keys, kept by the app (CloudBridge).
final class WebViewController: UIViewController, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    static let scheme = "bridge-app"
    private static let shell = URL(string: "bridge-app://app/_relay/shell")!
    // The launch screen's colour, light or dark as the phone is, until the page draws its own.
    private static let background = UIColor(named: "LaunchBackground") ?? UIColor(red: 11 / 255, green: 13 / 255, blue: 17 / 255, alpha: 1)

    private var web: WKWebView!
    private let tunnel = Tunnel()
    private let bundled = BundledUI()
    private let cloud = CloudBridge()
    private var showingBundled = false
    private let store = OfflineStore() // what the page keeps for when your computer is offline

    // The computer showing now, by its relay (from its pairing link). The others are in the Keychain.
    private var relay: String? {
        get { UserDefaults.standard.string(forKey: "relay") }
        set { UserDefaults.standard.set(newValue, forKey: "relay") }
    }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(tunnel, forURLScheme: Self.scheme)
        config.setURLSchemeHandler(bundled, forURLScheme: BundledUI.scheme)
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1"
        // The page tells the app from Safari by this, and Bridge AI names the phone "iPhone (app)".
        config.applicationNameForUserAgent = "BridgeAIApp/\(version) Mobile/15E148 Safari/604.1"
        config.allowsInlineMediaPlayback = true
        config.userContentController.add(WeakHandler(self), name: "bridge")
        config.userContentController.addScriptMessageHandler(store, contentWorld: .page, name: "store")
        web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = self
        web.navigationDelegate = self
        web.isOpaque = false
        web.backgroundColor = Self.background
        web.scrollView.backgroundColor = Self.background
        // The page lays itself out around the notch and the Home indicator (env(safe-area-inset-*)).
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = false
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        tunnel.web = web
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        #if DEBUG
        // For testing on the simulator, which has no camera: launch with -pair <link>.
        if let link = UserDefaults.standard.string(forKey: "pair"), usePairingLink(link) { return }
        // ...and with -open demo, straight to a bundled UI.
        if let name = UserDefaults.standard.string(forKey: "open"), BundledUI.has(name) { return openBundled(name) }
        #endif
        load(fragment: nil)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .default }

    private func load(fragment: String?) {
        showingBundled = false
        UIApplication.shared.isIdleTimerDisabled = false // a meeting recording in the page before ends with it
        let ucc = web.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.removeScriptMessageHandler(forName: CloudBridge.name, contentWorld: .page)
        let pairing = Keychain.computers().first(where: { $0["relay"] as? String == relay })?["pairing"]
        // bundled: the UIs in the app the page can offer (the demo, Cloud agents).
        ucc.addUserScript(WKUserScript(source: """
            window.bridgeNative = { platform: 'ios', relay: \(Self.js(relay)), pairing: \(Self.js(pairing)), computers: \(Self.js(listed())), bundled: \(Self.js(["demo", "cloud"].filter(BundledUI.has))), post: (m) => window.webkit.messageHandlers.bridge.postMessage(m) }
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Bridge AI itself, from your computer, is a frame in the page. It tells the app from Safari by
        // a bridgeNative of its own, and says through it when a meeting is recording (the only message
        // the app takes from a frame).
        ucc.addUserScript(WKUserScript(source: """
            if (window !== window.top && location.protocol === '\(Self.scheme):' && !window.bridgeNative) window.bridgeNative = { platform: 'ios', post: (m) => window.webkit.messageHandlers.bridge.postMessage(m) }
            """, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        // Bodies that are Blobs (a photo, a voice note) don't reach an app's own handler, so send
        // their bytes instead.
        ucc.addUserScript(WKUserScript(source: """
            (() => { const f = window.fetch; window.fetch = async function (input, init) { if (init && init.body instanceof Blob) init = { ...init, body: await init.body.arrayBuffer() }; return f.call(this, input, init) } })()
            """, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        logConsole(ucc)
        var url = URLComponents(url: Self.shell, resolvingAgainstBaseURL: false)!
        url.fragment = fragment
        web.load(URLRequest(url: url.url!))
    }

    // A UI bundled in the app (BundledUI), in place of the phone page. It knows nothing of your
    // computers, and can only ask to go back to the start (bridgeNative.post({ type: 'home' })).
    // Cloud agents alone also gets its channel for keys and requests (CloudBridge).
    private func openBundled(_ name: String) {
        guard BundledUI.has(name) else { return }
        showingBundled = true
        UIApplication.shared.isIdleTimerDisabled = false
        let ucc = web.configuration.userContentController
        ucc.removeAllUserScripts()
        ucc.removeScriptMessageHandler(forName: CloudBridge.name, contentWorld: .page)
        if name == "cloud" { ucc.addScriptMessageHandler(cloud, contentWorld: .page, name: CloudBridge.name) }
        ucc.addUserScript(WKUserScript(source: """
            window.bridgeNative = { platform: 'ios', post: (m) => window.webkit.messageHandlers.bridge.postMessage(m) }
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        logConsole(ucc)
        web.load(URLRequest(url: BundledUI.url(name)))
    }

    // Debug builds pass the page's console to Xcode's.
    private func logConsole(_ ucc: WKUserContentController) {
        #if DEBUG
        ucc.addUserScript(WKUserScript(source: """
            (() => { const send = (k, a) => { try { window.webkit.messageHandlers.bridge.postMessage({ type: 'log', text: k + ' ' + a.map((x) => x && x.stack ? x.name + ': ' + x.message + ' @ ' + x.stack : String(x)).join(' ') }) } catch {} }
            for (const k of ['log', 'warn', 'error']) { const o = console[k]; console[k] = (...a) => { send(k, a); o.apply(console, a) } }
            addEventListener('error', (e) => send('uncaught', [e.message, e.filename + ':' + e.lineno]))
            addEventListener('unhandledrejection', (e) => send('rejection', [e.reason && (e.reason.stack || e.reason)])) })()
            """, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        #endif
    }

    // ---------- messages from the page ----------
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let m = message.body as? [String: Any], let type = m["type"] as? String, message.webView === web else { return }
        // Only the app's own page, not a frame in it (an HTML file shown in Files, say): a frame could
        // otherwise forget the pairing, move the app to another relay or answer the app's requests.
        // Bridge AI's frame can only say a meeting is recording.
        let origin = message.frameInfo.securityOrigin
        let page = message.frameInfo.isMainFrame && [Self.scheme, BundledUI.scheme].contains(origin.protocol)
        guard type == "log" || page || (type == "recording" && origin.protocol == Self.scheme) else { return }
        // A bundled UI can only go back to the start.
        if showingBundled && type != "home" && type != "log" { return }
        switch type {
        case "open": if let name = m["name"] as? String { openBundled(name) }
        case "home": load(fragment: nil)
        case "res": tunnel.answer(m)
        case "relay": if let url = m["url"] as? String { relay = url }
        case "scan": scan()
        case "keep": keep(m["pairing"].flatMap { $0 is NSNull ? nil : $0 })
        case "name": if let name = m["name"] as? String { change(relay) { $0["name"] = String(name.prefix(60)) } }
        case "switch": if let url = m["url"] as? String { relay = url; load(fragment: nil) }
        case "forget": if let url = m["url"] as? String { forget(url) }
        case "activity": if let state = m["state"] as? [String: Any] { LiveCard.show(state) }
        // A meeting recording: the screen stays on, since a locked iPhone stops the page's microphone.
        case "recording": UIApplication.shared.isIdleTimerDisabled = (m["on"] as? Bool) ?? false
        #if DEBUG
        case "log": NSLog("[page] %@", m["text"] as? String ?? "")
        #endif
        default: break
        }
    }

    // Cloud agents, from the Home Screen quick action.
    func openCloud() { if CloudBridge.available() { openBundled("cloud") } }

    // The lock screen card was tapped (bridgeai://agent?id=<pane>): show that agent.
    func open(_ url: URL) {
        guard url.scheme == "bridgeai", url.host == "agent",
              let id = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "id" })?.value else { return }
        web.evaluateJavaScript("window.bridgeOpenAgent && window.bridgeOpenAgent(\(Self.js(id)))")
    }

    // ---------- the computers ----------
    // For the page: [{ relay, name }], without the pairings.
    private func listed() -> [[String: Any]] {
        Keychain.computers().compactMap { c in (c["relay"] as? String).map { ["relay": $0, "name": c["name"] ?? NSNull()] } }
    }

    private func change(_ url: String?, _ edit: (inout [String: Any]) -> Void) {
        guard let url else { return }
        var list = Keychain.computers()
        guard let i = list.firstIndex(where: { $0["relay"] as? String == url }) else { return }
        edit(&list[i])
        Keychain.save(list)
        updateList()
    }

    // The page paired with the computer showing now (or forgot it, when it refused this phone).
    private func keep(_ pairing: Any?) {
        guard let url = relay else { return }
        var list = Keychain.computers()
        let i = list.firstIndex(where: { $0["relay"] as? String == url })
        if let pairing {
            if let i { list[i]["pairing"] = pairing } else { list.append(["relay": url, "pairing": pairing]) }
        } else if let i {
            list.remove(at: i)
        }
        Keychain.save(list)
        updateList()
    }

    private func forget(_ url: String) {
        Keychain.save(Keychain.computers().filter { $0["relay"] as? String != url })
        OfflineStore.forget(url)
        guard url == relay else { return updateList() }
        relay = Keychain.computers().first?["relay"] as? String
        load(fragment: nil)
    }

    private func updateList() {
        web.evaluateJavaScript("window.bridgeNative && (window.bridgeNative.computers = \(Self.js(listed())))")
    }

    private static func js(_ value: Any?) -> String {
        guard let value, !(value is NSNull), let data = try? JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed) else { return "null" }
        return String(data: data, encoding: .utf8) ?? "null"
    }

    private func scan() {
        let scanner = ScannerViewController()
        scanner.onResult = { [weak self] text in
            guard let self, let text else { return }
            if !self.usePairingLink(text) { self.alert("That isn't a Bridge AI pairing code. On your computer, open Settings › Devices and click Pair a device.") }
        }
        top.present(scanner, animated: true)
    }

    // A pairing link: https://<your relay>/#pair=<code>. The relay is remembered; the page pairs.
    private func usePairingLink(_ text: String) -> Bool {
        guard let link = URL(string: text), link.scheme == "https" || Self.testRelay(link), let host = link.host,
              let code = link.fragment.flatMap({ URLComponents(string: "x:?\($0)")?.queryItems?.first(where: { $0.name == "pair" })?.value })
        else { return false }
        relay = "\(link.scheme!)://\(host)\(link.port.map { ":\($0)" } ?? "")"
        load(fragment: "pair=\(code)")
        return true
    }

    // Debug builds also take a relay running on this computer (wrangler dev), for testing.
    private static func testRelay(_ link: URL) -> Bool {
        #if DEBUG
        return link.scheme == "http" && link.host == "127.0.0.1"
        #else
        return false
        #endif
    }

    // ---------- links, dialogs, camera and microphone ----------
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        // Web links open in Safari; the app and its frames stay here.
        if let url = action.request.url, ["http", "https", "mailto", "tel"].contains(url.scheme ?? ""), action.targetFrame?.isMainFrame != false {
            UIApplication.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    // A new tab or window. A web page opens in Safari. A file from your computer (a picture, a PDF, a
    // meeting's file: "Open in a new tab") opens in a tab of its own in Safari, through the page's link;
    // here it's shown over the app (FileViewer), through the same link.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url else { return nil }
        if url.scheme == "http" || url.scheme == "https" { UIApplication.shared.open(url) }
        else if webView === web, !showingBundled, FileViewer.shows(url) { top.present(FileViewer.sheet(url, tunnel: tunnel), animated: true) }
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        UIApplication.shared.isIdleTimerDisabled = false
        webView.reload()
    }

    // Dialogs go over whatever is showing (the scanner, a file), or they'd never be answered.
    private var top: UIViewController {
        var c: UIViewController = self
        while let p = c.presentedViewController, !p.isBeingDismissed { c = p }
        return c
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        top.present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        top.present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { [weak a] _ in completionHandler(a?.textFields?.first?.text) })
        top.present(a, animated: true)
    }

    // The microphone, for dictation, voice notes and meetings: the phone page and Bridge AI in it, from
    // your computer. iOS asks once itself, the first time one of them is used (Info.plist says why),
    // so WebKit doesn't ask again on top. The bundled UIs never record (the demo stands in for the
    // mic), so they can't start the question.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void) {
        let ours = webView === web && !showingBundled && origin.protocol == Self.scheme && frame.securityOrigin.protocol == Self.scheme
        decisionHandler(ours ? .grant : .deny)
    }

    private func alert(_ text: String) {
        let a = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        top.present(a, animated: true)
    }
}

// WKUserContentController holds its handlers strongly; this keeps it from holding the controller.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(c, didReceive: m) }
}
