// Who's a person, among what a calendar, an invite or a transcript lists: for who an event invites
// (calendar.js), who a call is with (meetings.js) and the people you meet (meetinsights.js).
// Not a person: a room or a resource ("Conf Room
// 4 (8)", "London-5-Thames [TV]", a calendar's own address), a group or a mailing list
// ("payments-team@", "eng-all"), a mailbox for a job rather than a person ("schedule@", "noreply@"),
// a note taker ("Otter.ai Notetaker"), a phone dialling in, and a call's own words taken for a name
// ("Speaker 2", "Guest"). A role in brackets after a name ("Priya Shah (Organizer)") is left off it.
export const EMAIL = /<?([^\s<>@,;]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,})>?/i
// Words that are a name only of a job, a room or a group: a name made of nothing else isn't a person.
const JOBS = new Set(('schedule scheduling scheduler calendar calendars invite invites invitation invitations booking bookings reservation reservations '
  + 'noreply donotreply notifications notification notify alerts mailer postmaster bounce bounces daemon admin administrator info information hello contact '
  + 'support helpdesk help desk service sales billing accounts accounting finance legal recruiting recruitment careers jobs talent office reception frontdesk '
  + 'marketing press newsletter updates feedback events meeting meetings notes team teams group groups list lists all everyone everybody staff dl distro '
  + 'department dept committee channel organizer organiser host cohost presenter moderator guest guests participant participants attendee attendees '
  + 'speaker unknown someone caller dialin phone telephone mobile iphone android room rooms resource resources assistant bot notetaker recorder '
  + 'transcriber no reply do not').split(' '))
// Words that make any name they're in a room, a group or a machine.
const NEVER = new Set(('room rooms conference conf boardroom huddle noreply donotreply calendar schedule scheduling scheduler team teams group groups '
  + 'everyone everybody staff all list lists dl distro leads managers members owners bot notetaker assistant iphone android dialin resource resources '
  + 'meeting meetings zoom webex gotomeeting calendly otter fireflies fathom tldv gong chorus avoma krisp notta sembly airgram supernormal tactiq').split(' '))
// A calendar's own address, a group's or a list's (Google's rooms and shared calendars, Google Groups).
const NOT_MAILBOX = /(^|\.)(resource|group|group\.v|import)\.calendar\.google\.com$|(^|\.)googlegroups\.com$|^(lists?|groups?)\./i
const NOT_A_NAME = /^(you|them|me|speaker \d+|unknown|null)$/i
// "(Organizer)", "(she/her)", "(me)": a note after a name. "(8)" and "[TV]" are a room's size and kit.
const NOTE = /\s*\((?![^)]*\d)[^)]*\)/g
const KIT = /\[[^\]]*\]|\(\s*\d[^)]*\)/
export const withoutNote = (s) => String(s || '').replace(NOTE, '').replace(/\s+/g, ' ').trim()
export function notPerson(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim()
  const em = EMAIL.exec(s)
  if (em && NOT_MAILBOX.test(em[1].split('@')[1])) return true
  const shown = (em ? s.replace(em[0], '') : s).replace(/["']/g, '').trim()
  if (KIT.test(shown)) return true
  const name = withoutNote(shown) || (em ? em[1].split('@')[0] : '')
  if (!name || NOT_A_NAME.test(name) || !/\p{L}/u.test(name)) return true
  // Digits: a room's number, Speaker 2, a phone, a calendar's id. An address may end in some (priya.shah2).
  if (/\d/.test(/\s/.test(name) ? name : name.replace(/\d+$/, ''))) return true
  const words = name.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)
  return !words.length || words.length > 5 || words.every((w) => JOBS.has(w)) || words.some((w) => NEVER.has(w))
}
