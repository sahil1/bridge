// bridgecal: your calendars, through macOS's own calendar store (EventKit). macOS 13 or later.
//   bridgecal          asks for access the way an app has to now ("Bridge AI would like full access
//                      to your calendars"), which also puts Bridge AI in System Settings › Privacy &
//                      Security › Calendars, a list with no + to add it. Prints one word: granted,
//                      denied (said no, now or before: turn it on in System Settings) or restricted
//                      (a profile on this Mac doesn't allow it). Waits up to two minutes for an
//                      answer, then says denied.
//   bridgecal status   the same word without asking, or unknown when it hasn't asked yet.
//   bridgecal events <from> <to> full|light [leave out]...
//                      the events from the start of <from> to the end of <to> (YYYY-MM-DD, this
//                      Mac's time zone) as JSON, leaving out the calendars named after them. light:
//                      without notes, link and attendees (the year view). Without full access it
//                      prints the status word instead and exits 3.
// The reading used to be icalBuddy's; on current macOS it sees no calendars even with full access.
//   swiftc -O -target arm64-apple-macos13.0 native/bridgecal.swift -o native/bin/bridgecal
import EventKit
import Foundation

func done(_ word: String, _ code: Int32 = 0) -> Never {
  print(word)
  fflush(stdout)
  exit(code)
}

// notDetermined 0, restricted 1, denied 2, authorized or fullAccess 3, writeOnly 4 (macOS 14).
func status() -> String {
  switch EKEventStore.authorizationStatus(for: .event).rawValue {
  case 3: return "granted"
  case 2, 4: return "denied" // write-only can add events but not see them
  case 1: return "restricted"
  default: return "unknown"
  }
}

let args = Array(CommandLine.arguments.dropFirst())

if args.first == "status" { done(status()) }

if args.first == "events" {
  let now = status()
  if now != "granted" { done(now, 3) }
  let day = DateFormatter()
  day.dateFormat = "yyyy-MM-dd"
  day.timeZone = .current
  guard args.count >= 4, let from = day.date(from: args[1]), let to = day.date(from: args[2]) else {
    FileHandle.standardError.write("usage: bridgecal events <from YYYY-MM-DD> <to YYYY-MM-DD> full|light [leave out]...\n".data(using: .utf8)!)
    exit(2)
  }
  let light = args[3] == "light"
  let leaveOut = Set(args.dropFirst(4))
  let cal = Calendar.current
  let start = cal.startOfDay(for: from)
  let end = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: to))!
  let store = EKEventStore()
  let calendars = store.calendars(for: .event).filter { !leaveOut.contains($0.title) }
  let iso = ISO8601DateFormatter()
  var out: [[String: Any]] = []
  if !calendars.isEmpty {
    for e in store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: calendars)) {
      // An all-day event ends at the next midnight, whichever way its store wrote the end.
      let last = e.isAllDay ? cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: e.endDate.addingTimeInterval(-1)))! : e.endDate!
      var it: [String: Any] = [
        "title": e.title ?? "",
        "calendar": e.calendar?.title ?? "",
        "start": iso.string(from: e.startDate),
        "end": iso.string(from: last),
        "allDay": e.isAllDay,
        "location": e.location ?? "",
        "canceled": e.status == .canceled,
      ]
      if !light {
        it["url"] = e.url?.absoluteString ?? ""
        it["notes"] = e.notes ?? ""
        it["attendees"] = (e.attendees ?? []).map { p in p.name ?? p.url.absoluteString.replacingOccurrences(of: "mailto:", with: "") }
      }
      out.append(it)
    }
  }
  let json = try! JSONSerialization.data(withJSONObject: out)
  FileHandle.standardOutput.write(json)
  exit(0)
}

switch EKEventStore.authorizationStatus(for: .event).rawValue {
case 3: done("granted")
case 2: done("denied")
case 1: done("restricted")
default: break // not asked yet, or write-only: ask for full access
}
let store = EKEventStore()
let answered = DispatchSemaphore(value: 0)
var granted = false
if #available(macOS 14.0, *) {
  store.requestFullAccessToEvents { ok, _ in granted = ok; answered.signal() }
} else {
  store.requestAccess(to: .event) { ok, _ in granted = ok; answered.signal() }
}
_ = answered.wait(timeout: .now() + 120)
done(granted ? "granted" : "denied")
