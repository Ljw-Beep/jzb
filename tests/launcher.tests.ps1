# 启动脚本测试：通过 启动记账.bat 拉起服务并验证数据落盘
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$bat = Join-Path $root '启动记账.bat'
if (-not (Test-Path $bat)) { throw '找不到 启动记账.bat' }

$tmp = Join-Path $env:TEMP ("ledger-launch-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$port = 0
for ($p = 8940; $p -le 8979; $p++) {
  try { $l = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $p); $l.Start(); $l.Stop(); $port = $p; break } catch { }
}
if ($port -eq 0) { throw '无空闲端口' }
$base = "http://127.0.0.1:$port"

$script:pass = 0
$script:fail = 0
function Assert {
  param([string]$Name, [bool]$Cond, [string]$Detail = '')
  if ($Cond) { $script:pass++; Write-Host "  [PASS] $Name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  [FAIL] $Name  $Detail" -ForegroundColor Red }
}

$proc = $null
try {
  Write-Host "== 通过批处理启动服务（端口 $port）=="
  $proc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList @('/c', '"' + $bat + '"', '-Port', "$port", '-DataDir', $tmp, '-NoBrowser') `
    -PassThru -WindowStyle Hidden

  $ready = $false
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 200
    try { $null = Invoke-WebRequest "$base/api/ping" -UseBasicParsing -TimeoutSec 1; $ready = $true; break } catch { }
  }
  Assert '批处理能拉起本地服务' $ready

  if ($ready) {
    $s = (Invoke-WebRequest "$base/api/state" -UseBasicParsing).Content | ConvertFrom-Json
    Assert '服务返回可用数据' (@($s.data.accounts).Count -ge 4)
    Assert '数据文件写到了指定目录' (Test-Path (Join-Path $tmp 'ledger.json'))
    Assert '自动生成了备份目录' (Test-Path (Join-Path $tmp 'backup'))
    $idx = (Invoke-WebRequest "$base/" -UseBasicParsing).Content
    Assert '首页可以访问' ($idx -match '记账本')
  }
} finally {
  # 通过监听端口找到实际的服务进程并结束
  $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 400
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("结果：通过 {0} 项，失败 {1} 项" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
