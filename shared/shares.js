// Share Links (server/shares.js): what the server, the app and the tests agree on.

// How long a link lasts: an hour, a day (what's picked unless you pick another) or a week.
export const LASTS = [{ id: 'hour', hours: 1 }, { id: 'day', hours: 24 }, { id: 'week', hours: 168 }]
export const LAST_DEFAULT = 'day'

// Every limit, said where you make a link and in Settings › Sharing:
//   shares       links at once (those that ended aren't counted)
//   viewers      pages open on one link at once
//   fileMB       the biggest file a link sends (a bigger one is said, not sent)
//   people       emails one link may name
//   password     at least min characters; tries wrong ones in a row lock that page out for
//                lockMinutes, and linkTries from anyone in lockMinutes lock the link itself
//   code         a code sent to an email has digits, lasts minutes and allows tries; an email gets
//                perHour an hour and perDay a day, and after wrongPerDay wrong ones none that day; a
//                link sends linkPerDay a day in all
//   perSecond    requests one page may make a second, on average (a site's or an app's)
//   streams      answers one page may have on their way at once, and a link (all its pages)
//   listed       entries a folder's list shows
export const LIMITS = {
  shares: 50, viewers: 10, fileMB: 1024, people: 30,
  password: { min: 8, tries: 5, linkTries: 20, lockMinutes: 15 },
  code: { digits: 8, minutes: 10, tries: 5, perHour: 5, perDay: 10, wrongPerDay: 20, linkPerDay: 60 },
  perSecond: 40, streams: { page: 8, link: 32 }, listed: 2000,
}

// An email as it's compared: trimmed, lowercase.
export const cleanEmail = (e) => String(e ?? '').trim().toLowerCase()
export const EMAIL = /^[^\s@<>"(),;:]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/
export const isEmail = (e) => cleanEmail(e).length <= 254 && EMAIL.test(cleanEmail(e))
