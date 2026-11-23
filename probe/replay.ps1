# 直接 P/Invoke hid.dll 复刻配置下载会话 (等价于老软件的 HidD_SetFeature/GetFeature)
# 用法: powershell -File replay.ps1 disable|restore
param([Parameter(Mandatory=$true)][ValidateSet('disable','restore')][string]$Mode)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Hid {
  [DllImport("hid.dll", EntryPoint="HidD_SetFeature", SetLastError=true)]
  public static extern byte SetFeature(IntPtr h, byte[] buf, int len);
  [DllImport("hid.dll", EntryPoint="HidD_GetFeature", SetLastError=true)]
  public static extern byte GetFeature(IntPtr h, byte[] buf, int len);
  [DllImport("kernel32", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sa, uint disp, uint flags, IntPtr tmpl);
  [DllImport("kernel32", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr h);
}
'@

$devPath = '\\?\hid#vid_0c45&pid_8006&mi_00#8&9d43ec4&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}\kbd'
Write-Host "path: $devPath"
$h = [Hid]::CreateFile($devPath, [uint32]3221225472, [uint32]3, [IntPtr]::Zero, [uint32]3, [uint32]0, [IntPtr]::Zero)
if ($h -eq [IntPtr]::(-1)) { Write-Error ("CreateFile failed: " + [Runtime.InteropServices.Marshal]::GetLastWin32Error()); exit 1 }

function Hex($arr, $n) { ( ($arr[0..($n-1)]) | ForEach-Object { $_.ToString('x2') } ) -join ' ' }
function SetF([byte[]]$b, [string]$name) {
  $ret = [Hid]::SetFeature($h, $b, $b.Length)
  $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  Write-Host ("SET {0,-6} ret={1} err={2}  {3}" -f $name, $ret, $err, (Hex $b 14))
}
function GetF([string]$name) {
  $b = New-Object byte[] 65
  $ret = [Hid]::GetFeature($h, $b, 65)
  $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  Write-Host ("GET {0,-6} ret={1} err={2}  {3}" -f $name, $ret, $err, (Hex $b 14))
}
function P([int[]]$payload) { $b = New-Object byte[] 65; for ($i=0; $i -lt $payload.Count; $i++) { $b[$i+1] = [byte]$payload[$i] }; return $b }
function PBytes([byte[]]$raw) { $b = New-Object byte[] 65; [Array]::Copy($raw, 0, $b, 1, 64); return $b }

try {
  # 暖机: 模拟老软件心跳, 让固件进入"可配置"状态
  Write-Host '--- warmup heartbeats'
  for ($i=0; $i -lt 4; $i++) { SetF (P @(0x04,0x18)) "hb$i"; GetF 'hb'; Start-Sleep -Seconds 2 }
  SetF (P @(0x04,0xab)) 'ab';   GetF 'ab'
  $rnd = New-Object byte[] 64; (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($rnd)
  SetF (PBytes $rnd) 'rand'
  SetF (P @(0x04,0x02)) '02';   GetF '02'
  SetF (P @(0x04,0x11,0,0,0,0,0,0x0a)) '11'; GetF '11'
  Start-Sleep -Milliseconds 80
  $blocks = 1..10 | ForEach-Object { New-Object byte[] 64 }
  if ($Mode -eq 'disable') { $blocks[5][48] = 0x05; $blocks[5][49] = 0x03 }
  $blocks[9][62] = 0xaa; $blocks[9][63] = 0x55
  for ($i=0; $i -lt 10; $i++) { SetF (PBytes $blocks[$i]) ("blk$i"); Start-Sleep -Milliseconds 12 }
  SetF (P @(0x04,0x02)) '02';   GetF '02'
  SetF (P @(0x04,0x18)) '18'
  for ($i=0; $i -lt 3; $i++) { SetF (P @(0x04,0x18)) "tb$i"; GetF 'tb'; Start-Sleep -Seconds 2 }
  $desc = if ($Mode -eq 'disable') { '被禁用' } else { '恢复' }
  Write-Host "`n#### 已下发 $Mode - 请测试左Win是否$desc" -ForegroundColor Green
} finally { [Hid]::CloseHandle($h) | Out-Null }
