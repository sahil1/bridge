// Saving a file whole or not at all (writeFileAtomic in server/paths.js, which settings, accounts,
// devices, projects and the rest are saved with): what's saved is all there, a file keeps its
// permissions (or gets the ones asked for), a save that fails partway leaves the last one as it
// was with nothing left beside it, and a rename another program holds up (an antivirus scan on
// Windows) is tried again, then written in place.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { checks, OUT, ROOT, IS_WIN } from '../lib/harness.mjs'
import { writeFileAtomic } from '../../server/paths.js'

const { ok, skip, done } = checks('saves')
const dir = path.join(OUT, 'saves')
fs.rmSync(dir, { recursive: true, force: true })
fs.mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'config.json')
const read = () => fs.readFileSync(file, 'utf8')
const strays = () => fs.readdirSync(dir).filter((f) => f !== 'config.json')
const mode = () => fs.statSync(file).mode & 0o777
// fs as the helper sees it, with one call made to fail for a while.
const failing = (name, fail) => {
  const real = fs[name]
  let calls = 0
  fs[name] = (...a) => { calls++; const e = fail(calls, a); if (e) throw Object.assign(new Error(`${e} (made up)`), { code: e }); return real(...a) }
  return { calls: () => calls, restore: () => { fs[name] = real } }
}

try {
  writeFileAtomic(file, '{"a":1}\n')
  ok(read() === '{"a":1}\n' && !strays().length, 'a new file is saved, with nothing left beside it', { text: read(), strays: strays() })
  const big = JSON.stringify({ rows: Array.from({ length: 20000 }, (_, i) => ({ i, text: 'x'.repeat(40) })) })
  writeFileAtomic(file, big)
  ok(read() === big, 'a large one is saved whole')
  writeFileAtomic(file, Buffer.from('bytes'))
  ok(read() === 'bytes', 'bytes as well as text')

  if (IS_WIN) skip('permissions', 'Windows has no Unix permissions')
  else {
    writeFileAtomic(file, 'secret', { mode: 0o600 })
    ok(mode() === 0o600, 'one asked to be yours only is (0600)', mode().toString(8))
    fs.chmodSync(file, 0o640)
    writeFileAtomic(file, 'again')
    ok(mode() === 0o640, 'without asking, a file keeps the permissions it had', mode().toString(8))
  }

  // The disk fills up partway through: the last save is untouched.
  writeFileAtomic(file, 'last good save')
  const full = failing('writeFileSync', (n, [to]) => (typeof to === 'number' ? 'ENOSPC' : null))
  const fullErr = (() => { try { writeFileAtomic(file, 'half of a new save'); return null } catch (e) { return e.code } finally { full.restore() } })()
  ok(fullErr === 'ENOSPC', 'a save that fails says why', fullErr)
  ok(read() === 'last good save' && !strays().length, 'and leaves the last save whole, with nothing beside it', { text: read(), strays: strays() })

  // Another program has the file open for a moment (Windows refuses the rename meanwhile).
  const briefly = failing('renameSync', (n) => (n <= 2 ? 'EPERM' : null))
  try { writeFileAtomic(file, 'after a wait') } finally { briefly.restore() }
  ok(read() === 'after a wait' && briefly.calls() === 3 && !strays().length, 'a rename refused for a moment is tried again', { text: read(), calls: briefly.calls(), strays: strays() })
  const held = failing('renameSync', () => 'EBUSY')
  const t0 = Date.now()
  try { writeFileAtomic(file, 'written in place') } finally { held.restore() }
  ok(read() === 'written in place' && !strays().length, 'one that stays refused is written in place, as before', { text: read(), strays: strays() })
  ok(Date.now() - t0 < 2000, 'without holding things up for long', Date.now() - t0)
  const gone = failing('renameSync', () => 'ENOENT')
  const goneErr = (() => { try { writeFileAtomic(file, 'nowhere'); return null } catch (e) { return e.code } finally { gone.restore() } })()
  ok(goneErr === 'ENOENT' && read() === 'written in place' && !strays().length, 'any other failure says so and leaves the file as it was', { goneErr, text: read(), strays: strays() })

  // Bridge AI stopped dead in the middle of saving, again and again: the file always reads back.
  const crash = path.join(dir, 'crash.json')
  const saver = `import { writeFileAtomic } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'server', 'paths.js')).href)}
for (let n = 0; ; n++) writeFileAtomic(${JSON.stringify(crash)}, JSON.stringify({ n, rows: Array.from({ length: 5000 }, (_, i) => 'row ' + i + ' of save ' + n) }))`
  let whole = 0
  for (let i = 0; i < 5; i++) {
    const p = spawn(process.execPath, ['--input-type=module', '-e', saver], { stdio: 'ignore' })
    await new Promise((r) => setTimeout(r, 300 + i * 70))
    p.kill('SIGKILL')
    await new Promise((r) => p.once('exit', r))
    try { JSON.parse(fs.readFileSync(crash, 'utf8')); whole++ } catch { /* half a file */ }
  }
  ok(whole === 5, 'stopped dead mid-save five times, the file reads back whole each time', `${whole} of 5`)
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
}
process.exit(done().fail ? 1 : 0)
