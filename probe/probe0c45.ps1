# 测试向 vid_0c45&pid_8006 的 HID 接口发心跳 04 18, 验证老软件真正用的通道
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Hid {
  [DllImport("hid.dll", EntryPoint="HidD_SetFeature", SetLastError=true)]
  public static extern byte SetFeature(IntPtr h, byte[] buf, int len);
  [DllImport("hid.dll", EntryPoint="HidD_GetFeature", SetLastError=true)]
  public static extern byte GetFeature(IntPtr h, byte[] buf, int len);
  [DllImport("kernel32", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sa, uint disp, uint flags, IntPtr tmpl);
  [DllImport("kernel32", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr h);
}
'@
# 枚举所有 0c45:8006 接口 (含 kbd 后缀变体)
$guid = '{4d1e55b2-f16f-11cf-88cb-001111000030}'
$paths = @(
  "\\?\hid#vid_0c45&pid_8006&mi_00#8&9d43ec4&0&0000#$guid\kbd",
  "\\?\hid#vid_0c45&pid_8006&mi_00#8&9d43ec4&0&0000#$guid"
)
foreach ($p in $paths) {
  Write-Host "--- $p"
  $h = [Hid]::CreateFileW($p, [uint32]3221225472, [uint32]3, [IntPtr]::Zero, [uint32]3, [uint32]0, [IntPtr]::Zero)
  if ($h -eq [IntPtr]::(-1)) { Write-Host ("  open err=" + [Runtime.InteropServices.Marshal]::GetLastWin32Error()); continue }
  $buf = New-Object byte[] 65; $buf[1] = 0x04; $buf[2] = 0x18
  $ret = [Hid]::SetFeature($h, $buf, 65)
  $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  Write-Host "  SET 0418 ret=$ret err=$err"
  $b2 = New-Object byte[] 65; $b2[1] = 0x04; $b2[2] = 0x18
  $ret2 = [Hid]::GetFeature($h, $b2, 65)
  $err2 = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  $hexs = ( ($b2[0..9]) | ForEach-Object { $_.ToString('x2') } ) -join ' '
  Write-Host "  GET 0418 ret=$ret2 err=$err2 [$hexs]"
  [Hid]::CloseHandle($h) | Out-Null
}
