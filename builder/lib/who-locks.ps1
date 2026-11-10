# Prints "<pid> <kind>" for each process holding the given file open (Windows Restart Manager).
# kind: GradleDaemon, KotlinCompileDaemon or other. Read-only: it never closes anything.
param([Parameter(Mandatory = $true)][string]$Path)
$code = @'
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class AnyAppRM {
 [StructLayout(LayoutKind.Sequential)] public struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct RM_PROCESS_INFO { public RM_UNIQUE_PROCESS Process; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string strAppName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string strServiceShortName; public int ApplicationType; public uint AppStatus; public uint TSSessionId; [MarshalAs(UnmanagedType.Bool)] public bool bRestartable; }
 [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmStartSession(out uint h, int f, string k);
 [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint h);
 [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern int RmRegisterResources(uint h, uint n, string[] f, uint a, IntPtr b, uint c, string[] d);
 [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint h, out uint need, ref uint n, [In, Out] RM_PROCESS_INFO[] info, ref uint reasons);
 public static List<int> Who(string path) { uint h; var r = new List<int>(); RmStartSession(out h, 0, Guid.NewGuid().ToString());
  try { RmRegisterResources(h, 1, new[]{path}, 0, IntPtr.Zero, 0, null); uint need=0, n=0, reasons=0; RmGetList(h, out need, ref n, null, ref reasons);
   var info = new RM_PROCESS_INFO[need]; n = need; if (need > 0) { RmGetList(h, out need, ref n, info, ref reasons); foreach (var i in info) r.Add(i.Process.dwProcessId); } } finally { RmEndSession(h); } return r; } }
'@
Add-Type -TypeDefinition $code
foreach ($id in [AnyAppRM]::Who($Path)) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
  $kind = 'other'
  if ($p -and $p.CommandLine -match 'GradleDaemon') { $kind = 'GradleDaemon' }
  elseif ($p -and $p.CommandLine -match 'KotlinCompileDaemon') { $kind = 'KotlinCompileDaemon' }
  "$id $kind"
}
