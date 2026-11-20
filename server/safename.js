// A name someone chose for themselves or a place (a Slack display name, a Discord nickname, a Teams
// display name, a channel's or a team's name), as it may reach a bot's agent: letters, digits,
// spaces and . - _ ' only, at most n characters, so a name can't bring an instruction's punctuation
// or length with it (frontdesk.js briefs, each platform's mentions). '' when nothing's left.
export const safeName = (s, n = 40) => String(s ?? '').normalize('NFKC').replace(/[^\p{L}\p{N} .\-_']/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n).trim()
