// Saved prompts: messages you send often (the weekly update, an ops review), one click from any
// agent's message box. {{blanks}} in them are filled in each time. In <data>/prompts.json.
import fs from 'node:fs'
import crypto from 'node:crypto'
import { dataFile, ensureDir, DATA } from './paths.js'

const FILE = dataFile('prompts.json')
const load = () => { try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(d) ? d : [] } catch { return [] } }
const save = (list) => { ensureDir(DATA); fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n') }
const clean = (s, max) => String(s || '').replace(/\0/g, '').trim().slice(0, max)

export const all = () => load()

export function add({ name, text }) {
  const t = clean(text, 20000)
  if (!t) throw new Error('The prompt is empty')
  const item = { id: crypto.randomBytes(5).toString('hex'), name: clean(name, 80) || t.split('\n')[0].slice(0, 60), text: t, updatedAt: new Date().toISOString() }
  save([item, ...load()])
  return item
}

export function update(id, { name, text }) {
  const list = load()
  const it = list.find((x) => x.id === id)
  if (!it) throw new Error('No such prompt')
  if (name != null) it.name = clean(name, 80) || it.name
  if (text != null) { const t = clean(text, 20000); if (!t) throw new Error('The prompt is empty'); it.text = t }
  it.updatedAt = new Date().toISOString()
  save(list)
  return it
}

// Used: moves to the top, so the ones you use most stay first.
export function used(id) {
  const list = load()
  const i = list.findIndex((x) => x.id === id)
  if (i > 0) { const [it] = list.splice(i, 1); save([it, ...list]) }
}

export function remove(id) { save(load().filter((x) => x.id !== id)) }
