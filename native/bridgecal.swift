// bridgecal: your calendars, through macOS's own calendar store (EventKit). macOS 14 or later.
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
//                      without notes, link and attendees (the year view). Each has its calendar's
//                      own colour (as Calendar shows it), a lasting id, this Mac's own id for it
//                      and whether it repeats (what Calendar's link to it takes: Open in Calendar),
//                      and your answer to it (accepted, tentative, declined, none yet; organizer
//                      when it's yours). Read only: nothing here adds, changes or answers an
//                      event. Without full access it prints the status word instead and exits 3.
// The reading used to be icalBuddy's; on current macOS it sees no calendars even with full access.
//   swiftc -O -target arm64-apple-macos14.0 native/bridgecal.swift -o native/bin/bridgecal
import EventKit
import Foundation

// A calendar's colour as #rrggbb, in sRGB: what Calendar shows for it.
func hex(_ c: CGColor?) -> String? {
  guard let c = c, let srgb = CGColorSpace(name: CGColorSpace.sRGB), let x = c.converted(to: srgb, intent: .defaultIntent, options: nil), let p = x.components, p.count >= 3 else { return nil }
  let n = p.prefix(3).map { Int((max(0, min(1, $0)) * 255).rounded()) }
  return String(format: "#%02x%02x%02x", n[0], n[1], n[2])
}

// Your answer to an invite: unknown 0, pending 1, accepted 2, declined 3, tentative 4, delegated 5.
func answer(_ e: EKEvent) -> String? {
  if e.organizer?.isCurrentUser == true { return "organizer" }
  guard let me = (e.attendees ?? []).first(where: { $0.isCurrentUser }) else { return nil }
  switch me.participantStatus.rawValue {
  case 2: return "accepted"
  case 3: return "declined"
  case 4: return "tentative"
  default: return "none"
  }
}
let mail = { (p: EKParticipant) -> String? in
  let u = p.url.absoluteString
  return u.lowercased().hasPrefix("mailto:") ? String(u.dropFirst(7)) : nil
}

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
        "color": hex(e.calendar?.cgColor) ?? "",
        // The same in every span asked for: a repeat's occurrences share it, so with its start.
        "uid": e.calendarItemExternalIdentifier ?? e.eventIdentifier ?? "",
        // Calendar's own link to it (ical://ekevent) goes by this, and for one of a series (or
        // one moved out of it) by when that day's starts too.
        "local": e.calendarItemIdentifier,
        "repeats": e.hasRecurrenceRules || e.isDetached,
        "response": answer(e) ?? "",
      ]
      if !light {
        it["url"] = e.url?.absoluteString ?? ""
        it["notes"] = e.notes ?? ""
        // People only: a room, a resource or a group invited to it isn't someone at it.
        let people = (e.attendees ?? []).filter { p in p.participantType == .person || p.participantType == .unknown }
        it["attendees"] = people.map { p in p.name ?? p.url.absoluteString.replacingOccurrences(of: "mailto:", with: "") }
        it["emails"] = people.compactMap(mail)
        if let o = e.organizer { it["organizer"] = o.isCurrentUser ? "" : (o.name ?? mail(o) ?? "") }
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
store.requestFullAccessToEvents { ok, _ in granted = ok; answered.signal() }
_ = answered.wait(timeout: .now() + 120)
done(granted ? "granted" : "denied")
