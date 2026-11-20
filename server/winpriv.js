// Windows' backup and restore rights (SeBackupPrivilege, SeRestorePrivilege), taken out of a
// process's token for good when Bridge AI has them on. With them on, every file Node opens (libuv
// opens each one with backup semantics) passes any folder's access list, so a folder Bridge AI closes
// (the top of a bot's copy of its folders, botwrite.js) wouldn't be closed to it, nor to the programs
// it starts (its terminal host, an agent), which get its token. They're off for a program started as
// usual, even by an administrator; they're on when Bridge AI was started from a program that turns
// them on for itself, as Cygwin's and MSYS2's runtime does (Git Bash) for an administrator.
// Off Windows, nothing to do.
import { execFile } from 'node:child_process'
import path from 'node:path'

const SYS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
const run = (bin, args) => new Promise((resolve) => {
  execFile(bin, args, { timeout: 60000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, out, errOut) => resolve({ ok: !err, out: String(out || ''), err: String(errOut || err?.message || '').trim() }))
})

// Whether they're on in this process (whoami, run from it, says its token's): each one's state as
// SeChangeNotifyPrivilege's, which is on for everyone, so it's read the same in any language Windows
// speaks. null when it can't be told.
export async function backupRightsOn() {
  if (process.platform !== 'win32') return false
  const r = await run(path.join(SYS, 'whoami.exe'), ['/priv', '/fo', 'csv', '/nh'])
  if (!r.ok) return null
  const rows = r.out.split(/\r?\n/).map((l) => l.trim().replace(/^"|"$/g, '').split('","'))
  const state = (name) => rows.find((c) => c[0] === name)?.[2]
  const on = state('SeChangeNotifyPrivilege')
  if (!on) return null
  return ['SeBackupPrivilege', 'SeRestorePrivilege'].some((n) => state(n) === on)
}

// Taken out of the token of process pid (this one, or one it started: its terminal host), with
// AdjustTokenPrivileges (SE_PRIVILEGE_REMOVED, so nothing can turn them on again), through Windows
// PowerShell. Only when this process had them on as it started (asked once, before any is taken out),
// once for each pid. { ok, said }: ok when each is taken out, or wasn't there.
const PS = (pid) => String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BridgeRights {
  [StructLayout(LayoutKind.Sequential)] public struct LUID { public uint LowPart; public int HighPart; }
  [StructLayout(LayoutKind.Sequential)] public struct TOKEN_PRIVILEGES { public uint PrivilegeCount; public LUID Luid; public uint Attributes; }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool LookupPrivilegeValue(string system, string name, out LUID luid);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool disableAll, ref TOKEN_PRIVILEGES state, uint length, IntPtr previous, IntPtr returned);
  public static string Drop(uint pid) {
    IntPtr process = OpenProcess(0x1000, false, pid);
    if (process == IntPtr.Zero) return "process:" + Marshal.GetLastWin32Error();
    IntPtr token;
    if (!OpenProcessToken(process, 0x0028, out token)) { int e = Marshal.GetLastWin32Error(); CloseHandle(process); return "token:" + e; }
    string said = "";
    foreach (string name in new string[] { "SeBackupPrivilege", "SeRestorePrivilege" }) {
      LUID luid;
      if (!LookupPrivilegeValue(null, name, out luid)) { said += " " + name + ":lookup" + Marshal.GetLastWin32Error(); continue; }
      TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES();
      tp.PrivilegeCount = 1;
      tp.Luid = luid;
      tp.Attributes = 0x4;
      bool ok = AdjustTokenPrivileges(token, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
      int err = Marshal.GetLastWin32Error();
      said += " " + name + ":" + (!ok ? "error" + err : err == 1300 ? "notheld" : "removed");
    }
    CloseHandle(token);
    CloseHandle(process);
    return said.Trim();
  }
}
'@
[BridgeRights]::Drop(${Number(pid) >>> 0})
`
let onAtStart = null
const dropped = new Map()
export function dropBackupRights(pid = process.pid) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: true, said: 'not Windows' })
  onAtStart ||= backupRightsOn()
  if (!dropped.has(pid)) {
    dropped.set(pid, (async () => {
      if (await onAtStart === false) return { ok: true, said: 'off' }
      const r = await run(path.join(SYS, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PS(pid), 'utf16le').toString('base64')])
      const said = r.out.trim().split(/\r?\n/).pop() || r.err.split(/\r?\n/)[0] || 'no answer'
      return { ok: r.ok && /^SeBackupPrivilege:(removed|notheld) SeRestorePrivilege:(removed|notheld)$/.test(said), said: said.slice(0, 200) }
    })())
  }
  return dropped.get(pid)
}
