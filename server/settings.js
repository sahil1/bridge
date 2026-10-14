// Your settings file (~/.bridge-ai/config.json): read, change and validate it from the app, find a
// location, and work out a sensible first-run setup from what's already on this machine.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { ROOT, dataFile, ensureDir, DATA, IS_MAC } from './paths.js'

export const FILE = dataFile('config.json')
// Changes to these only take effect when the server starts again.
export const RESTART_KEYS = ['port', 'host', 'runtime', 'herdr', 'allowedHosts']

const readJSON = (f, d = {}) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
export const readUser = () => readJSON(FILE)
export const readRaw = () => { try { return fs.readFileSync(FILE, 'utf8') } catch { return '{\n}\n' } }
export const defaults = () => readJSON(path.join(ROOT, 'config.example.json'))

function writeUser(obj) {
  ensureDir(DATA)
  const tmp = `${FILE}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`)
  fs.renameSync(tmp, FILE)
}

// Which top-level keys differ, so the app can say what needs a restart.
const changedKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))

// Merge a patch into your settings. Objects merge one level deep; null removes a key.
export function patch(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Settings must be an object')
  const before = readUser()
  const next = { ...before }
  for (const [k, v] of Object.entries(p)) {
    if (v === null) delete next[k]
    else if (v && typeof v === 'object' && !Array.isArray(v) && next[k] && typeof next[k] === 'object' && !Array.isArray(next[k])) next[k] = { ...next[k], ...v }
    else next[k] = v
  }
  writeUser(next)
  return changedKeys(before, next)
}

// Replace the whole file with text you edited. It must be a JSON object.
export function replaceRaw(text) {
  let obj
  try { obj = JSON.parse(text) } catch (e) { throw Object.assign(new Error(`Not valid JSON: ${e.message}`), { status: 400 }) }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw Object.assign(new Error('The file must hold a JSON object ({ ... })'), { status: 400 })
  const before = readUser()
  writeUser(obj)
  return changedKeys(before, obj)
}

// ---------- Location ----------
// City search through Open-Meteo's geocoder (no key, no account).
export async function geocode(q) {
  const name = String(q || '').trim().slice(0, 80)
  if (name.length < 2) return []
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=8&language=en&format=json`, { signal: AbortSignal.timeout(6000) })
  if (!res.ok) throw new Error(`Location search failed (${res.status})`)
  const d = await res.json()
  return (d.results || []).map((r) => ({
    label: r.name, detail: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: Math.round(r.latitude * 1e4) / 1e4, lon: Math.round(r.longitude * 1e4) / 1e4, timezone: r.timezone,
  }))
}

// A first guess without asking for permission: the city in your time zone's name
// (America/Los_Angeles -> Los Angeles). Close enough for weather; you can refine it.
export async function guessLocation() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const city = tz?.split('/').pop()?.replace(/_/g, ' ')
  if (!city || /^(UTC|GMT|Etc)/i.test(tz)) return null
  try {
    const hit = (await geocode(city)).find((r) => r.timezone === tz) || null
    return hit ? { label: hit.label, lat: hit.lat, lon: hit.lon, timezone: tz, approximate: true } : null
  } catch { return null }
}

// ---------- Your name ----------
const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { timeout: 4000 }, (err, out) => resolve(err ? '' : String(out).trim())))
export async function guessName() {
  const full = IS_MAC ? await run('id', ['-F']) : ''
  const git = await run('git', ['config', '--global', 'user.name'])
  const raw = full || git || os.userInfo().username || ''
  return raw.split(/\s+/)[0] || '' // first name reads better in a greeting
}
