import Foundation
import Security

// The computers this phone is paired with, in the Keychain: each one's relay, the name it goes by,
// and the pairing (this phone's key for it and the computer's). Only on this phone, never in backups
// to another one or iCloud, and readable once it has been unlocked.
enum Keychain {
    private static var base: [String: Any] { [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "dev.bridge-ai.phone",
        kSecAttrAccount as String: "computers",
    ] }

    // [{ relay, name?, pairing }], in the order they were added.
    static func computers() -> [[String: Any]] {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        if status == errSecMissingEntitlement, let kept = Unsigned.read() { return kept }
        guard status == errSecSuccess, let data = out as? Data else { return [] }
        return (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] ?? []
    }

    static func save(_ list: [[String: Any]]) {
        SecItemDelete(base as CFDictionary)
        guard !list.isEmpty, let data = try? JSONSerialization.data(withJSONObject: list) else { return Unsigned.write(nil) }
        var item = base
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        if SecItemAdd(item as CFDictionary, nil) == errSecMissingEntitlement { Unsigned.write(data) }
    }

    // A Simulator build made with no signing (the tests', CI's, one without a team) has no Keychain.
    // Debug builds keep the list in the app's defaults there instead, so pairing, several computers
    // and switching between them can be tried. Never on a phone, never in a release build.
    private enum Unsigned {
        static func read() -> [[String: Any]]? {
            #if DEBUG && targetEnvironment(simulator)
            return UserDefaults.standard.data(forKey: "unsignedComputers").flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [[String: Any]] }
            #else
            return nil
            #endif
        }

        static func write(_ data: Data?) {
            #if DEBUG && targetEnvironment(simulator)
            UserDefaults.standard.set(data, forKey: "unsignedComputers")
            #endif
        }
    }
}
