// The computer, for usage stats (counts.js), in the public list's words (shared/telemetry-schema.json):
// the OS's version (macOS 15.1, Windows 11 (26100), Ubuntu 24.04), the chip's family (Apple M2 Pro,
// Intel Core i7, AMD Ryzen 7; never the exact part), and memory and cores as ranges.
import fs from 'node:fs'
import os from 'node:os'

let osRelease = null
// m: what machine.js found (its os is macOS's version).
export async function osVersion(m = {}, platform = process.platform) {
  if (platform === 'darwin') return m.os ? `macOS ${String(m.os).split('.').slice(0, 2).join('.')}` : 'macOS'
  if (platform === 'win32') { const build = Number(String(os.release()).split('.')[2]) || 0; return `Windows ${build >= 22000 ? 11 : 10}${build ? ` (${build})` : ''}` }
  osRelease ??= await fs.promises.readFile('/etc/os-release', 'utf8').then(parseOsRelease, () => ({}))
  return linuxName(osRelease)
}
export const parseOsRelease = (t) => Object.fromEntries(String(t).split('\n').map((l) => /^(\w+)="?([^"]*)"?$/.exec(l.trim())).filter(Boolean).map((x) => [x[1], x[2]]))
export function linuxName(r = {}) {
  const id = String(r.ID || 'linux').replace(/[^\w-]/g, '')
  return `${id.charAt(0).toUpperCase()}${id.slice(1)}${r.VERSION_ID ? ` ${String(r.VERSION_ID).replace(/[^\w.]/g, '')}` : ''}`.slice(0, 40)
}
export function chipOf(model = '', arch = process.arch) {
  const m = String(model)
  let x
  if ((x = /Apple (M\d+)(?: (Pro|Max|Ultra))?/.exec(m))) return `Apple ${x[1]}${x[2] ? ` ${x[2]}` : ''}`
  if ((x = /Core(?:\(TM\))? Ultra (\d)/i.exec(m))) return `Intel Core Ultra ${x[1]}`
  if ((x = /Core(?:\(TM\))? (i\d)/i.exec(m))) return `Intel Core ${x[1]}`
  if (/Xeon/i.test(m)) return 'Intel Xeon'
  if (/Intel/i.test(m)) return 'Intel, other'
  if ((x = /Ryzen(?: AI)?(?: (?:Threadripper|PRO))? (\d)/i.exec(m))) return `AMD Ryzen ${x[1]}`
  if (/EPYC/i.test(m)) return 'AMD EPYC'
  if (/AMD/i.test(m)) return 'AMD, other'
  if (/Snapdragon|Qualcomm/i.test(m)) return 'Qualcomm Snapdragon'
  return arch === 'arm64' ? 'Arm, other' : 'other'
}
export const memoryRange = (gb) => (gb < 7.5 ? 'under 8 GB' : gb < 15.5 ? '8-15 GB' : gb < 31.5 ? '16-31 GB' : gb < 63.5 ? '32-63 GB' : '64+ GB')
export const coreRange = (n) => (n <= 4 ? '1-4' : n <= 8 ? '5-8' : n <= 12 ? '9-12' : n <= 16 ? '13-16' : '17+')
