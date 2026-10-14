#!/usr/bin/env node
// npm run desktop / desktop:dev / desktop:dist: install the desktop app's own dependencies (Electron) the first
// time, then start it or build it.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'desktop')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = (args) => {
  const r = spawnSync(npm, args, { cwd: DESKTOP, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status) process.exit(r.status)
}
const ready = ['electron', 'electron-builder'].every((m) => fs.existsSync(path.join(DESKTOP, 'node_modules', m, 'package.json')))
if (!ready) {
  console.log('Installing the desktop app\'s dependencies (Electron), once...')
  run(['install', '--no-audit', '--no-fund'])
}
const mode = process.argv[2]
if (mode === 'dev') process.env.BRIDGE_DEV = '1'
run(mode === 'dist' ? ['run', 'dist'] : ['start'])
