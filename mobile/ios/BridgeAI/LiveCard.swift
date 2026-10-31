import ActivityKit
import Foundation

// Starts, updates and ends the lock screen card from what the page says ({ type: 'activity' }).
// The app can only update it while it runs: once it's in the background iOS stops it within
// seconds, so the card says how old it is ("as of 2:16") rather than looking current. All of it
// on the main thread, where the page's messages and the scene's changes come.
@MainActor
enum LiveCard {
    static func show(_ m: [String: Any]) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled, let state = parse(m) else { return }
        last = m
        let computer = m["computer"] as? String ?? "Your computer"
        let current = Activity<AgentsActivity>.activities.first { $0.activityState == .active }
        let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(stale))

        if let current, current.attributes.computer == computer, !current.content.state.ended {
            let before = current.content.state
            Task {
                if state.ended {
                    // Stays on the lock screen a while, then goes.
                    await current.end(content, dismissalPolicy: .after(Date().addingTimeInterval(15 * 60)))
                } else if state.blocked > before.blocked, let a = state.agents.first(where: { $0.status == "blocked" }) {
                    // Something new needs you: light up the screen.
                    await current.update(content, alertConfiguration: AlertConfiguration(title: "\(a.name) needs you", body: "\(computer)", sound: .default))
                } else {
                    await current.update(content)
                }
            }
            return
        }
        // A new run (or another computer): the old card goes, a new one starts.
        for a in Activity<AgentsActivity>.activities { Task { await a.end(nil, dismissalPolicy: .immediate) } }
        if state.ended { return }
        _ = try? Activity.request(attributes: AgentsActivity(computer: computer), content: content, pushType: nil)
    }

    // The app is going to the background: say the card won't be updated from here on.
    static func freeze() {
        for a in Activity<AgentsActivity>.activities where a.activityState == .active && !a.content.state.ended {
            Task { await a.update(ActivityContent(state: a.content.state, staleDate: Date())) }
        }
    }

    // While the app runs, the card is current; this is a backstop if it stops without saying.
    private static let stale: TimeInterval = 120

    // ...and back: current again.
    static func thaw() {
        if let last, last["ended"] as? Bool != true { show(last) }
    }

    private static var last: [String: Any]?

    private static func parse(_ m: [String: Any]) -> AgentsActivity.ContentState? {
        guard let list = m["agents"] as? [[String: Any]] else { return nil }
        let agents = list.compactMap { a -> AgentsActivity.Agent? in
            guard let id = a["id"] as? String, let status = a["status"] as? String else { return nil }
            let since = (a["since"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date()
            return AgentsActivity.Agent(id: id, name: a["name"] as? String ?? "Agent", status: status, since: since)
        }
        let n = { (k: String) in m[k] as? Int ?? 0 }
        return AgentsActivity.ContentState(working: n("working"), blocked: n("blocked"), finished: n("finished"), agents: agents, ended: m["ended"] as? Bool ?? false)
    }
}
