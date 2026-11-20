// Windows' backup and restore rights (SeBackupPrivilege, SeRestorePrivilege), for a bot's run that
// changes files. A program that has them on passes any folder's access list when it opens a file with
// backup semantics, as Node does every file it opens (libuv), so the top of a bot's copy, closed by
// its access list (botwrite.js), wouldn't be closed to it. They're on for a program started from one
// that turns them on for itself, as Cygwin's and MSYS2's runtime (Git Bash) does for an
// administrator, and so for Bridge AI started from there, and for every program it starts.
//
// So the agent of such a run never has them: the terminal it starts in (PowerShell, runtime/spawn.js)
// takes them out of its own token first, for good, before it starts the agent (noBackupRightsFirst),
// and doesn't start it when it can't. Nothing else is touched: not Bridge AI's own process, nor its
// terminal host, nor any other terminal. And the lock is tried as an agent without them meets it
// (plainProbe). Off Windows, nothing here is used.
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SYS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
const POWERSHELL = path.join(SYS, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const WHOAMI = path.join(SYS, 'whoami.exe')
const CS = fileURLToPath(new URL('./winrights.cs', import.meta.url))
// (In PowerShell's single quotes, as runtime/spawn.js quotes: its curly ones too.)
const psq = (s) => `'${String(s).replace(/['‘’‚‛]/g, '$&$&')}'`

// PowerShell, run first in the terminal before the agent: when its token has either right (whoami
// lists the ones it has, on or off), both taken out (winrights.cs, compiled here); when that can't
// be done, or whoami can't say, it says so and the terminal ends, its agent never started.
export const noBackupRightsFirst = () => `& { try { $rights = @(& ${psq(WHOAMI)} /priv /fo csv /nh | ConvertFrom-Csv -Header n,d,s); if ($LASTEXITCODE -ne 0) { throw 'whoami said nothing' }; if ($rights | Where-Object { $_.n -eq 'SeBackupPrivilege' -or $_.n -eq 'SeRestorePrivilege' }) { Add-Type -TypeDefinition ([IO.File]::ReadAllText(${psq(CS)})); $said = [BridgeRights]::Drop([uint32]$PID); if ($said -notmatch '^SeBackupPrivilege:(removed|notheld) SeRestorePrivilege:(removed|notheld)$') { throw $said } } } catch { Write-Host ('Bridge AI couldn''t take Windows'' backup and restore rights out of this terminal, so its agent doesn''t start: ' + $_); [Environment]::Exit(1) } }`

// Whether a file can be made in dir by a program without backup semantics, as it can by an agent
// without those rights: PowerShell's .NET open (CreateNew), which never uses them, whatever rights
// Bridge AI has. true made (and taken away again), false refused, null when it couldn't be told.
export function plainProbe(dir) {
  const p = path.join(dir, `.bridge-probe-${crypto.randomBytes(6).toString('hex')}`)
  const script = `try { [IO.File]::Open(${psq(p)}, 'CreateNew', 'Write').Close(); 'made' } catch [UnauthorizedAccessException] { 'refused' } catch { 'error ' + $_ }`
  return new Promise((resolve) => {
    execFile(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { timeout: 60000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, out) => {
      const said = String(out || '').trim().split(/\r?\n/).pop()
      if (said === 'made') { fs.promises.rm(p, { force: true }).catch(() => {}).then(() => resolve(true)); return }
      resolve(said === 'refused' ? false : null)
    })
  })
}
