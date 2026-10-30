import ActivityKit
import SwiftUI
import WidgetKit

// Draws the lock screen card and the Dynamic Island for AgentsActivity.
@main
struct Widgets: WidgetBundle {
    var body: some Widget { AgentsWidget() }
}

struct AgentsWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AgentsActivity.self) { context in
            LockCard(computer: context.attributes.computer, state: context.state, stale: context.isStale)
                .activityBackgroundTint(Color(red: 11 / 255, green: 13 / 255, blue: 17 / 255).opacity(0.85))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.state.link)
        } dynamicIsland: { context in
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label { Text(context.attributes.computer).lineLimit(1) } icon: { Mark() }
                        .font(.caption.weight(.semibold))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(s.summary).font(.caption).foregroundStyle(s.blocked > 0 ? Palette.blocked : .secondary).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    AgentRows(agents: Array(s.agents.prefix(3)), stale: context.isStale)
                }
            } compactLeading: {
                Mark()
            } compactTrailing: {
                Count(state: s)
            } minimal: {
                Count(state: s)
            }
            .widgetURL(s.link)
            .keylineTint(s.blocked > 0 ? Palette.blocked : Palette.working)
        }
    }
}

enum Palette {
    static let working = Color(red: 0.38, green: 0.65, blue: 1)
    static let blocked = Color(red: 1, green: 0.66, blue: 0.2)
    static let done = Color(red: 0.3, green: 0.82, blue: 0.5)
    static func of(_ status: String) -> Color { status == "blocked" ? blocked : status == "done" ? done : working }
}

struct Mark: View {
    var body: some View {
        if let image = UIImage(named: "apple-touch-icon.png") {
            Image(uiImage: image).resizable().frame(width: 18, height: 18).clipShape(RoundedRectangle(cornerRadius: 5))
        } else {
            Image(systemName: "sparkles")
        }
    }
}

// The Dynamic Island when it's small: how many need you, or how many are working.
struct Count: View {
    let state: AgentsActivity.ContentState
    var body: some View {
        if state.ended {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Palette.done)
        } else if state.blocked > 0 {
            Label("\(state.blocked)", systemImage: "hand.raised.fill").foregroundStyle(Palette.blocked).font(.caption.weight(.semibold))
        } else {
            Label("\(state.working)", systemImage: "circle.dotted").foregroundStyle(Palette.working).font(.caption.weight(.semibold))
        }
    }
}

struct LockCard: View {
    let computer: String
    let state: AgentsActivity.ContentState
    let stale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Mark()
                Text(computer).font(.subheadline.weight(.semibold)).lineLimit(1)
                Spacer(minLength: 8)
                Text(state.summary).font(.subheadline.weight(.medium)).foregroundStyle(state.blocked > 0 ? Palette.blocked : state.ended ? Palette.done : .secondary).lineLimit(1)
            }
            AgentRows(agents: Array(state.agents.prefix(3)), stale: stale)
            if stale && !state.ended {
                Text("Open Bridge AI for the latest").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .foregroundStyle(.white)
        .padding(14)
    }
}

struct AgentRows: View {
    let agents: [AgentsActivity.Agent]
    let stale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(agents, id: \.id) { a in
                HStack(spacing: 8) {
                    Circle().fill(Palette.of(a.status)).frame(width: 7, height: 7)
                    Text(a.name).font(.footnote).lineLimit(1)
                    Spacer(minLength: 8)
                    status(a).font(.footnote).foregroundStyle(a.status == "blocked" ? Palette.blocked : .secondary).lineLimit(1)
                }
            }
        }
    }

    @ViewBuilder private func status(_ a: AgentsActivity.Agent) -> some View {
        switch a.status {
        case "blocked": Text("Needs you")
        case "done": Text("Finished \(a.since, style: .time)")
        default:
            // A running clock while the app keeps the card current; when it can't, when it started.
            if stale { Text("Since \(a.since, style: .time)") } else { Text(a.since, style: .timer).monospacedDigit().multilineTextAlignment(.trailing).frame(maxWidth: 64, alignment: .trailing) }
        }
    }
}
