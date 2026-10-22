import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        let controller = WebViewController()
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window
        if let url = connectionOptions.urlContexts.first?.url { controller.loadViewIfNeeded(); controller.open(url) }
        if connectionOptions.shortcutItem?.type == Self.cloud { controller.loadViewIfNeeded(); controller.openCloud() }
    }

    // The Home Screen quick action (Info.plist): Cloud agents, paired or not.
    private static let cloud = "dev.bridge-ai.phone.cloud"
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        let ok = shortcutItem.type == Self.cloud
        if ok { (window?.rootViewController as? WebViewController)?.openCloud() }
        completionHandler(ok)
    }

    func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
        if let url = contexts.first?.url { (window?.rootViewController as? WebViewController)?.open(url) }
    }

    // A little time in the background to carry the last changes to the lock screen card, then it
    // says it's no longer current.
    private var background: UIBackgroundTaskIdentifier = .invalid

    func sceneDidEnterBackground(_ scene: UIScene) {
        background = UIApplication.shared.beginBackgroundTask { [weak self] in self?.endBackground() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in self?.endBackground() }
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        guard background == .invalid else { return endBackground(freeze: false) }
        LiveCard.thaw()
    }

    private func endBackground(freeze: Bool = true) {
        guard background != .invalid else { return }
        if freeze { LiveCard.freeze() }
        UIApplication.shared.endBackgroundTask(background)
        background = .invalid
    }
}
