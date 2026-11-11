// An agent's own title, or '' when it's only its shell's: on Windows a terminal's title starts as the
// console's own, the program's path ("Administrator: C:\Windows\System32\…\powershell.exe"), which
// took the agent's name on its card and in its header. A title the agent sets (Claude Code's
// "✳ Fixing the build") still shows.
const SHELL_TITLE = /^(?:Administrator:\s*)?(?:[A-Za-z]:[\\/]|\\\\)[^\n]*?\.(?:exe|cmd|bat|com)(?:\s.*)?$/i
export const ownTitle = (a) => (SHELL_TITLE.test(String(a?.title || '').trim()) ? '' : a?.title || '')
