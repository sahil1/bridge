// Runtime: herdr (https://herdr.dev), a terminal multiplexer built for agents. herdr owns the
// panes and tracks each agent's status; Bridge AI reads and drives them over herdr's CLI and
// API socket. Agents herdr doesn't know are started as a command in a plain pane.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import * as cli from './herdr-cli.js'
import * as sock from './herdr-socket.js'
import { adapter } from '../agents.js'
import { quoteCommand } from './spawn.js'
import { envFor } from '../accounts.js'

export const name = 'herdr'
export const caps = { liveView: true, reorder: true, splits: true }

// Usable when the herdr binary is installed and a session is running.
export function available() {
  try { execFileSync(process.env.HERDR_BIN || 'herdr', ['--version'], { stdio: 'ignore', timeout: 3000 }) } catch { return false }
  return !!cli.herdrSocket()
}

export async function fleet() {
  const [f, snap] = await Promise.all([cli.fleet(), cli.snapshot()])
  const ws = Object.fromEntries((snap.workspaces || []).map((w, i) => [w.workspace_id, { label: w.label, number: i + 1 }]))
  const tabs = Object.fromEntries((snap.tabs || []).map((t) => [t.tab_id, t.label]))
  const rects = {}
  for (const l of snap.layouts || []) for (const p of l.panes || []) rects[p.pane_id] = p.rect
  f.panes = (snap.panes || []).map((p) => ({
    paneId: p.pane_id, workspaceId: p.workspace_id, tabId: p.tab_id,
    workspace: ws[p.workspace_id]?.label || p.workspace_id, number: ws[p.workspace_id]?.number || 0, tab: tabs[p.tab_id] || '',
    agent: p.agent || null, status: p.agent_status || null,
    title: p.terminal_title_stripped || '', cwd: p.foreground_cwd || p.cwd,
    cols: rects[p.pane_id]?.width || null, rows: rects[p.pane_id]?.height || null,
  }))
  return f
}

export const read = (paneId, lines) => sock.read(paneId, lines).catch(() => cli.readPane(paneId, lines))
export const input = (paneId, steps) => sock.input(paneId, steps)
export const keys = (paneId, k) => cli.sendKeys(paneId, k)
export const paneKeys = (paneId, k) => cli.paneSendKeys(paneId, k)
export const text = (paneId, t) => cli.paneSendText(paneId, t)
export const prompt = (paneId, t) => cli.prompt(paneId, t)
export const focusAgent = (paneId) => cli.focusAgent(paneId)
export const focusTab = (tabId) => cli.focusTab(tabId)
export const renameTab = cli.renameTab
export const closeTab = cli.closeTab
export const renameWorkspace = cli.renameWorkspace
export const closeWorkspace = cli.closeWorkspace
export const moveWorkspace = (wsId, index) => sock.call('workspace.move', { workspace_id: wsId, insert_index: index })
export const moveTab = (tabId, index) => sock.call('tab.move', { tab_id: tabId, insert_index: index })

// A new space. herdr has no empty spaces: it opens with a shell tab in your home folder.
export async function createSpace({ label, cwd = os.homedir() }) {
  const r = await sock.call('workspace.create', { label: String(label || 'Space').slice(0, 80), cwd, focus: false })
  return { workspaceId: r?.workspace?.workspace_id || null }
}

// Move a tab to another space (or a new one named newSpace), at `index` among its tabs. herdr
// moves panes, not tabs: the first pane becomes a new tab there, the others join it side by
// side. The terminals keep running, but get new pane ids (returned as moved: old -> new).
// The space left empty closes by itself.
export async function moveTabToSpace(tabId, { workspaceId, newSpace, index } = {}) {
  const snap = await cli.snapshot()
  const tab = (snap.tabs || []).find((t) => t.tab_id === tabId)
  if (!tab) throw new Error('Not found')
  const ids = (snap.layouts || []).find((l) => l.tab_id === tabId)?.panes?.map((p) => p.pane_id)
    || (snap.panes || []).filter((p) => p.tab_id === tabId).map((p) => p.pane_id)
  if (!ids.length) throw new Error('That tab has nothing in it')
  const label = tab.label && !/^\d+$/.test(tab.label) ? tab.label : null
  const moved = {}
  const first = await sock.call('pane.move', { pane_id: ids[0], destination: newSpace
    ? { type: 'new_workspace', label: String(newSpace).slice(0, 80), tab_label: label }
    : { type: 'new_tab', workspace_id: workspaceId, label } })
  const pane = first?.move_result?.pane
  if (!pane) throw new Error('herdr did not move the tab')
  moved[ids[0]] = pane.pane_id
  for (const id of ids.slice(1)) {
    const r = await sock.call('pane.move', { pane_id: id, destination: { type: 'tab', tab_id: pane.tab_id, split: 'right' } })
    if (r?.move_result?.pane) moved[id] = r.move_result.pane.pane_id
  }
  if (Number.isInteger(index) && !newSpace) {
    try { await sock.call('tab.move', { tab_id: pane.tab_id, insert_index: index }) } catch { /* left at the end */ }
  }
  return { workspaceId: pane.workspace_id, tabId: pane.tab_id, moved }
}

// A new agent in a new space (newSpace) or a new tab of an existing one (workspaceId).
// herdr starts the agents it knows itself, so a default model applies only to the others.
export async function launch({ kind = 'claude', cwd, label, workspaceId, newSpace, prompt: opening, model, account }) {
  const env = envFor(kind, account) // a second account's config folder, if one was picked
  const a = adapter(kind)
  const name = `ba-${Date.now().toString(36)}`
  const space = String(newSpace || '').trim()
  let out
  if (a.herdr) {
    out = await cli.launchTask({ name, kind: a.herdr, cwd, label: space || label, workspaceId: space ? null : workspaceId || null, prompt: opening, env })
  } else {
    // herdr doesn't know this agent: open a pane and run it like you would by hand.
    const created = workspaceId && !space
      ? await cli.run(['tab', 'create', '--workspace', workspaceId, '--cwd', cwd, '--label', label, ...Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`])])
      : await cli.run(['workspace', 'create', '--cwd', cwd, '--label', space || label, '--no-focus', ...Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`])])
    const paneId = cli.findPaneId(created)
    if (!paneId) throw new Error('herdr did not return a pane for the new tab')
    await cli.paneSendText(paneId, quoteCommand(a.bin[0], [...(model && a.model ? a.model(model) : []), ...a.start({})]))
    await cli.paneSendKeys(paneId, ['enter'])
    out = { paneId, promptPending: !!opening }
    if (opening) setTimeout(() => cli.prompt(paneId, opening).catch(() => cli.paneSendText(paneId, opening).then(() => cli.paneSendKeys(paneId, ['enter'])).catch(() => {})), 6000)
  }
  if (space) { try { await cli.renameTabOfPane(out.paneId, label) } catch { /* default tab name */ } }
  return out
}

// Your herdr status colors, so both views use the same ones.
export function theme() {
  const out = {}
  try {
    const toml = fs.readFileSync(path.join(os.homedir(), '.config', 'herdr', 'config.toml'), 'utf8')
    const block = toml.split(/^\[theme\.custom\]/m)[1]?.split(/^\[/m)[0] || ''
    for (const m of block.matchAll(/^(\w+)\s*=\s*"(#[0-9a-fA-F]{6})"/gm)) out[m[1]] = m[2]
  } catch { /* defaults in CSS */ }
  return out
}
