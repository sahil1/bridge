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

// A new agent in a new space (newSpace) or a new tab of an existing one (workspaceId).
// herdr starts the agents it knows itself, so a default model applies only to the others.
export async function launch({ kind = 'claude', cwd, label, workspaceId, newSpace, prompt: opening, model }) {
  const a = adapter(kind)
  const name = `ba-${Date.now().toString(36)}`
  const space = String(newSpace || '').trim()
  let out
  if (a.herdr) {
    out = await cli.launchTask({ name, kind: a.herdr, cwd, label: space || label, workspaceId: space ? null : workspaceId || null, prompt: opening })
  } else {
    // herdr doesn't know this agent: open a pane and run it like you would by hand.
    const created = workspaceId && !space
      ? await cli.run(['tab', 'create', '--workspace', workspaceId, '--cwd', cwd, '--label', label])
      : await cli.run(['workspace', 'create', '--cwd', cwd, '--label', space || label, '--no-focus'])
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
