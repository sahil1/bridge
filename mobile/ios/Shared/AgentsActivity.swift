import ActivityKit
import Foundation

// The lock screen card (a Live Activity): the agents working on one computer, the ones waiting on
// you, and the ones that finished meanwhile. The app starts and updates it; Widgets draws it.
struct AgentsActivity: ActivityAttributes {
    struct Agent: Codable, Hashable {
        var id: String
        var name: String
        var status: String // working, blocked (needs you) or done
        var since: Date // when it started that
    }

    struct ContentState: Codable, Hashable {
        var working: Int
        var blocked: Int
        var finished: Int
        var agents: [Agent]
        var ended: Bool
    }

    var computer: String
}

extension AgentsActivity.ContentState {
    // "2 working · 1 needs you"
    var summary: String {
        if ended { return finished == 1 ? "Finished" : "All \(finished) finished" }
        return [working > 0 ? "\(working) working" : nil, blocked > 0 ? "\(blocked) need\(blocked == 1 ? "s" : "") you" : nil].compactMap { $0 }.joined(separator: " · ")
    }

    // Where tapping the card goes: the agent waiting on you, if one is.
    var link: URL {
        guard let a = agents.first(where: { $0.status == "blocked" }) ?? (agents.count == 1 ? agents.first : nil),
              let id = a.id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { return URL(string: "bridgeai://open")! }
        return URL(string: "bridgeai://agent?id=\(id)")!
    }
}
