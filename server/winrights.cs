// Windows' backup and restore rights (SeBackupPrivilege, SeRestorePrivilege) taken out of a process's
// token for good (SE_PRIVILEGE_REMOVED: nothing can turn them on again), for winpriv.js: compiled by
// Windows PowerShell (Add-Type) in the terminal a bot's run that changes files starts its agent in,
// and run on that PowerShell itself, so its agent has them neither. Drop(pid) says, for each, removed,
// notheld (it wasn't there), or what went wrong.
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
    // PROCESS_QUERY_LIMITED_INFORMATION; TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY.
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
      tp.Attributes = 0x4; // SE_PRIVILEGE_REMOVED
      bool ok = AdjustTokenPrivileges(token, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
      int err = Marshal.GetLastWin32Error();
      said += " " + name + ":" + (!ok ? "error" + err : err == 1300 ? "notheld" : "removed");
    }
    CloseHandle(token);
    CloseHandle(process);
    return said.Trim();
  }
}
