// What an agent changed in files, read from the tool calls in its transcript: a count per file for
// Chat's "Changed 3 files" line under a reply, and that reply's own diff when you open it.
// Claude Code: Edit, MultiEdit, Write, NotebookEdit (once a call has run, its result holds the
// patch Claude applied). Codex: apply_patch (the patch is in the call itself).
// Each edit is { path, add, del, lines }, lines in unified diff form: "@@ ...", " same", "-old", "+new".

export const CLAUDE_EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

const linesOf = (s) => { const t = String(s ?? ''); return t ? t.replace(/\n$/, '').split('\n') : [] }
export const count = (lines) => {
  let add = 0, del = 0
  for (const l of lines) { if (l[0] === '+') add++; else if (l[0] === '-') del++ }
  return { add, del }
}

// Two texts as removed and added lines, with up to 3 unchanged lines around them. Only for an edit
// whose result has no patch (a call still running, or an older Claude), so it stays simple.
function lineDiff(a, b) {
  const x = linesOf(a), y = linesOf(b)
  let p = 0
  while (p < x.length && p < y.length && x[p] === y[p]) p++
  let s = 0
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++
  return [...x.slice(Math.max(0, p - 3), p).map((l) => ` ${l}`), ...x.slice(p, x.length - s).map((l) => `-${l}`), ...y.slice(p, y.length - s).map((l) => `+${l}`), ...x.slice(x.length - s, x.length - s + 3).map((l) => ` ${l}`)]
}

// One Claude edit, from the call's input and (once it ran) the toolUseResult on its result entry.
export function claudeEdit(name, input = {}, result = null) {
  const path = input.file_path || input.notebook_path || result?.filePath || ''
  const patch = Array.isArray(result?.structuredPatch) && result.structuredPatch.length ? result.structuredPatch : null
  let lines
  if (patch) lines = patch.flatMap((h) => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...(h.lines || [])])
  else if (name === 'Write') lines = typeof result?.originalFile === 'string' ? ['@@', ...lineDiff(result.originalFile, input.content)] : ['@@ new file @@', ...linesOf(input.content).map((l) => `+${l}`)]
  else if (name === 'NotebookEdit') lines = input.edit_mode === 'delete' ? [`@@ cell ${input.cell_id || ''} deleted @@`] : [`@@ cell ${input.cell_id || 'new'} @@`, ...linesOf(input.new_source).map((l) => `+${l}`)]
  else if (name === 'MultiEdit') lines = (input.edits || []).flatMap((x) => ['@@', ...lineDiff(x.old_string, x.new_string)])
  else lines = ['@@', ...lineDiff(input.old_string, input.new_string)]
  return { path, ...count(lines), lines }
}

// The patch in a Codex call: apply_patch as its own tool, or a shell command that runs it.
export function codexPatch(p) {
  if (p.type !== 'custom_tool_call' && p.type !== 'function_call') return null
  let text = typeof p.input === 'string' ? p.input : ''
  if (!text.includes('*** Begin Patch')) {
    try { const a = JSON.parse(p.arguments || '{}'); text = [a.input, a.patch, a.cmd, ...[a.command].flat()].filter((x) => typeof x === 'string').join('\n') } catch { return null }
  }
  const m = /\*\*\* Begin Patch\r?\n([\s\S]*?)(?:\r?\n\*\*\* End Patch|$)/.exec(text)
  return m ? parsePatch(m[1]) : null
}

// "*** Add File: a", "*** Update File: b" (maybe "*** Move to: c"), "*** Delete File: d", each with its lines.
function parsePatch(body) {
  const files = []
  let cur = null
  for (const l of body.split(/\r?\n/)) {
    const h = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(l)
    if (h) { cur = { path: h[2].trim(), op: h[1].toLowerCase(), lines: h[1] === 'Add' ? ['@@ new file @@'] : h[1] === 'Delete' ? ['@@ file deleted @@'] : [] }; files.push(cur); continue }
    if (!cur) continue
    const mv = /^\*\*\* Move to: (.+)$/.exec(l)
    if (mv) { cur.lines.push(`@@ moved from ${cur.path} @@`); cur.path = mv[1].trim(); continue }
    if (l.startsWith('***')) continue // "*** End of File"
    if (cur.op === 'add') cur.lines.push(l.startsWith('+') ? l : `+${l}`)
    else if (cur.op === 'update') cur.lines.push(l.startsWith('@@') || /^[ +-]/.test(l) ? l : ` ${l}`)
  }
  return files.map(({ path, lines }) => ({ path, ...count(lines), lines: lines[0]?.startsWith('@@') ? lines : ['@@', ...lines] }))
}

// A Codex call's output says the patch didn't apply (exit code, or the error apply_patch prints).
export function codexFailed(output) {
  if (output?.success === false) return true
  let text = typeof output === 'string' ? output : output?.content || ''
  try { const o = JSON.parse(text); if (typeof o?.metadata?.exit_code === 'number') return o.metadata.exit_code !== 0; text = o?.output || text } catch { /* plain text */ }
  return /^(apply_patch verification failed|Invalid patch|Failed to (apply|find|read))|rejected by (the )?user/i.test(String(text).trim())
}
