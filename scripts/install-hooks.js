#!/usr/bin/env node
// Runs on `npm install` (the "prepare" script): points git at .githooks, so every commit and push
// from this clone runs the privacy check (scripts/check-private.js). Does nothing outside a git
// clone of this repo (the packaged app, an npm tarball), and leaves a hooks folder you set
// yourself alone.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }

const top = git('rev-parse', '--show-toplevel')
if (!top || path.resolve(top) !== ROOT || !fs.existsSync(path.join(ROOT, '.githooks'))) process.exit(0)
const current = git('config', '--get', 'core.hooksPath')
if (current === '.githooks') process.exit(0)
if (current) {
  console.log(`install-hooks: core.hooksPath is already ${current}; leaving it. Run the privacy check yourself with npm run check:private.`)
  process.exit(0)
}
git('config', 'core.hooksPath', '.githooks')
console.log('install-hooks: commits and pushes from this clone now run the privacy check (.githooks)')
