// A video or a sound named in what an agent said ("Rendered it to out/final.mp4."), as a path inside
// its folder, so a notification about it can open it in Files, where it plays. null when there's
// none, or it's somewhere else (Files shows only the agent's folder).
const NAMED = /(?:^|[\s("'`])((?:~\/|\/|\.{1,2}\/)?(?:[\w@.+-]+\/)*[\w@+-][\w@.+-]*\.(?:mp4|m4v|mov|webm|mkv|avi|mp3|m4a|wav|aac|flac|ogg|opus|aiff?))(?=$|[\s)"'`,;:!?]|\.(?:\s|$))/gi
export function mediaNamed(text, cwd = '') {
  const s = String(text || '')
  const root = String(cwd || '').replace(/[\\/]+$/, '')
  for (const m of s.matchAll(NAMED)) {
    let p = m[1]
    // The end of a path with a space in it ("renders/take two.mov"): not one to guess at.
    const before = s.slice(0, m.index + m[0].length - p.length).match(/(\S*)\s$/)?.[1] || ''
    if (!p.includes('/') && before.includes('/')) continue
    if (root && p.startsWith(`${root}/`)) p = p.slice(root.length + 1)
    else if (/^(\/|~|\.\.\/)/.test(p)) continue
    return p.replace(/^\.\//, '')
  }
  return null
}
