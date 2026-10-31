import UIKit
import WebKit

// A file from your computer that Bridge AI opens in a new tab (a picture, a PDF, a page an agent made,
// a meeting's file), shown over the app with Done to go back. Safari opens it in a tab of its own,
// through the page's link; here it comes through the same link (Tunnel). Its web view has nothing of
// the app's: no messages to it, no stored pairing or keys, and storage of its own that goes with it,
// so a page from your computer shown here can't reach the app.
final class FileViewer: UIViewController, WKNavigationDelegate {
    // Only Bridge AI's own files: /api/... on the computer showing, or /m/<id>/api/... on another of
    // your devices through it.
    static func shows(_ url: URL) -> Bool {
        url.scheme == WebViewController.scheme && url.host == "app" && url.path.range(of: #"^/(m/[A-Za-z0-9_-]{1,20}/)?api/"#, options: .regularExpression) != nil
    }

    static func sheet(_ url: URL, tunnel: Tunnel) -> UIViewController {
        let nav = UINavigationController(rootViewController: FileViewer(url, tunnel: tunnel))
        nav.modalPresentationStyle = .pageSheet
        return nav
    }

    private let url: URL
    private let tunnel: Tunnel
    private var web: WKWebView!

    private init(_ url: URL, tunnel: Tunnel) {
        self.url = url
        self.tunnel = tunnel
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("not from a storyboard") }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(tunnel, forURLScheme: WebViewController.scheme)
        config.websiteDataStore = .nonPersistent()
        config.allowsInlineMediaPlayback = true
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.allowsBackForwardNavigationGestures = true
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // The file's name until the page says its title: ?path=…/name.pdf, else the address's last part.
        let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "path" })?.value
        title = (path ?? url.path).split(separator: "/").last.map(String.init) ?? ""
        navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })
        web.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let t = webView.title, !t.isEmpty { title = t }
    }

    // Links to the web open in Safari; the computer's own stay here.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard let u = action.request.url else { return decisionHandler(.cancel) }
        if ["http", "https", "mailto", "tel"].contains(u.scheme ?? "") {
            if action.navigationType == .linkActivated { UIApplication.shared.open(u) }
            return decisionHandler(.cancel)
        }
        decisionHandler(u.scheme == WebViewController.scheme || u.scheme == "about" || u.scheme == "blob" || u.scheme == "data" ? .allow : .cancel)
    }
}
