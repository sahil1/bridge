// What this computer is, so Bridge AI offers only what can run on it (speech engines and models,
// for now): the OS and its version, the chip, an Intel build running under Rosetta on an Apple
// Silicon Mac, the C library's version on Linux, its memory, whether it's a container, and free
// space where models go. Read once without asking anything that could bring up a prompt, and in
// the background (a version from sw_vers, Rosetta from sysctl); free space is read each time.
// BRIDGE_MACHINE (tests): JSON laid over what's found here, to stand in for another computer, e.g.
// {"platform":"linux","arch":"x64","glibc":"2.31"}.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

const out = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, so) => resolve(err ? '' : String(so).trim())))

// macOS from Darwin's version, when sw_vers can't say: Darwin 22 to 24 were macOS 13 to 15, then
// macOS jumped to 26 (Darwin 25). Near enough for what it's used for.
const fromDarwin = (r) => { const n = Number(String(r).split('.')[0]); return n >= 25 ? `${Math.max(26, n)}.0` : n >= 20 ? `${n - 9}.0` : null }

let found = null
async function detect() {
  const platform = process.platform
  const arch = process.arch
  const m = { platform, arch, os: null, glibc: null, rosetta: false, emulated: false, docker: false, memGB: Math.round(os.totalmem() / 1e8) / 10 }
  if (platform === 'darwin') {
    m.os = (await out('sw_vers', ['-productVersion'])) || fromDarwin(os.release())
    // The Intel build on an Apple Silicon Mac: its x64 code runs under Rosetta.
    if (arch === 'x64') m.rosetta = (await out('sysctl', ['-n', 'sysctl.proc_translated'])) === '1'
  } else if (platform === 'linux') {
    m.os = os.release()
    // glibc's version as Node itself sees it; none on a Linux built on another C library (Alpine's musl).
    try { m.glibc = process.report?.getReport?.()?.header?.glibcVersionRuntime || null } catch { /* unknown */ }
    m.docker = !!process.env.BRIDGE_DOCKER || await fs.promises.access('/.dockerenv').then(() => true, () => false)
  } else if (platform === 'win32') {
    m.os = os.release()
    // The x64 app on a Windows Arm computer, under Windows 11's emulation.
    m.emulated = arch === 'x64' && /\bARM/i.test(process.env.PROCESSOR_IDENTIFIER || '')
  }
  let over = {}
  try { over = JSON.parse(process.env.BRIDGE_MACHINE || '{}') } catch { /* ignored */ }
  return { ...m, ...over }
}
export const machine = () => (found ||= detect())

// Free bytes on the disk that holds dir (where the models go), or null when it can't be read.
// BRIDGE_MACHINE's freeMB stands in for it in tests.
export async function freeBytes(dir) {
  try { const mb = JSON.parse(process.env.BRIDGE_MACHINE || '{}').freeMB; if (mb != null) return mb * 1e6 } catch { /* ignored */ }
  // The models folder may not be there yet: the nearest folder above it that is.
  for (let d = path.resolve(dir), up; d !== up; up = d, d = path.dirname(d)) {
    try { const s = await fs.promises.statfs(d); return s.bavail * s.bsize } catch (e) { if (e.code !== 'ENOENT') return null }
  }
  return null
}

// "2.31" < "2.32", "13.7" >= "13": versions compared number by number.
export function atLeast(have, want) {
  if (!have) return false
  const a = String(have).split('.').map(Number)
  const b = String(want).split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x !== y) return x > y
  }
  return true
}
