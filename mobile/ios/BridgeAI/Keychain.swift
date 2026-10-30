import Foundation
import Security

// The computers this phone is paired with, in the Keychain: each one's relay, the name it goes by,
// and the pairing (this phone's key for it and the computer's). Only on this phone, never in backups
// to another one or iCloud, and readable once it has been unlocked.
enum Keychain {
    private static let base: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "dev.bridge-ai.phone",
        kSecAttrAccount as String: "computers",
    ]

    // [{ relay, name?, pairing }], in the order they were added.
    static func computers() -> [[String: Any]] {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return [] }
        return (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] ?? []
    }

    static func save(_ list: [[String: Any]]) {
        SecItemDelete(base as CFDictionary)
        guard !list.isEmpty, let data = try? JSONSerialization.data(withJSONObject: list) else { return }
        var item = base
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(item as CFDictionary, nil)
    }
}
