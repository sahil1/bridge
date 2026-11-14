import { store } from '../layout.jsx'

// Memory is a page in Meetings and in Dictations (memory/Memory.jsx), a tab of each: each shows
// what came up there (and what you added), until you pick All memory. That's kept while the app is
// open, so a meeting opened from it and Back finds it as it was; going to Memory again from its tab,
// or a reload, starts it at its own again.
const memAll = { meetings: false, dictations: false }
export const memoryAll = (from) => memAll[from] === true
export function setMemoryAll(from, all) {
  memAll[from] = !!all
  window.dispatchEvent(new CustomEvent('bridge-memory-all', { detail: { from, all: !!all } }))
}
// Meetings at its Memory tab: its own, or all of it. App.jsx opens it so for ⌘K's Memory, Settings ›
// Voice & Meetings and a tab kept from when Memory was a page of its own (view:memory), which showed all of it.
export function memoryTab({ all = false } = {}) {
  setMemoryAll('meetings', all)
  store.set('cc-meet-tab', 'memory')
  window.dispatchEvent(new CustomEvent('bridge-meetings-tab', { detail: { tab: 'memory' } }))
}
// A meeting's menu: Meetings' Memory, what came up in your meetings.
export function openMemory({ all = false } = {}) {
  memoryTab({ all })
  window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { list: true } }))
}
// Someone's page in Meetings › People (Meeting Insights), from a meeting's guests: who you've met.
// Meetings takes it at once if it's open, else as it opens.
let pendingPerson = null
export function openPerson(id) {
  pendingPerson = id
  store.set('cc-meet-tab', 'people')
  window.dispatchEvent(new CustomEvent('bridge-meetings-tab', { detail: { tab: 'people', person: id } }))
  window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { list: true } }))
}
export const takePerson = () => { const p = pendingPerson; pendingPerson = null; return p }
