# 冒烟测试：100 次读写循环，校验 rev、内容与文件完整性
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$serverScript = Join-Path $root 'server\server.ps1'
$tmp = Join-Path $env:TEMP ("ledger-smoke-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$port = 0
for ($p = 8800; $p -le 8849; $p++) {
  try { $l = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $p); $l.Start(); $l.Stop(); $port = $p; break } catch { }
}
if ($port -eq 0) { throw '无空闲端口' }
$base = "http://127.0.0.1:$port"

$argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $serverScript, '-Port', "$port", '-DataDir', $tmp, '-NoBrowser')
$proc = Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList $argList -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $tmp 'o.log') -RedirectStandardError (Join-Path $tmp 'e.log')

$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 200
  try { $null = Invoke-WebRequest "$base/api/ping" -UseBasicParsing -TimeoutSec 1; $ok = $true; break } catch { }
}
if (-not $ok) { Stop-Process -Id $proc.Id -Force; throw '服务未启动' }

try {
  $s = (Invoke-WebRequest "$base/api/state" -UseBasicParsing).Content | ConvertFrom-Json
  $rev = [int]$s.rev
  $state = $s.data
  $state.transactions = @()
  $sw = [Diagnostics.Stopwatch]::StartNew()
  for ($i = 1; $i -le 100; $i++) {
    $tx = [ordered]@{
      id = "smoke-$i"; kind = 'expense'; amount = ($i * 100); accountId = 'a1'; toAccountId = $null;
      categoryId = 'c1'; date = '2026-10-01'; note = "第 $i 笔"; tagIds = @();
      createdAt = '2026-10-01T10:00:00+08:00'; updatedAt = '2026-10-01T10:00:00+08:00'
    }
    $state.transactions += $tx
    $json = $state | ConvertTo-Json -Depth 20
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $req = [System.Net.HttpWebRequest]::Create("$base/api/state")
    $req.Method = 'PUT'; $req.ContentType = 'application/json'
    $req.Headers.Add('X-Rev', "$rev"); $req.ContentLength = $bytes.Length
    $st = $req.GetRequestStream(); $st.Write($bytes, 0, $bytes.Length); $st.Close()
    $resp = $req.GetResponse()
    $sr = New-Object IO.StreamReader($resp.GetResponseStream())
    $r = $sr.ReadToEnd() | ConvertFrom-Json
    $sr.Close(); $resp.Close()
    if ([int]$r.rev -ne ($rev + 1)) { throw "第 $i 次写入 rev 异常：$($r.rev)" }
    $rev = [int]$r.rev
  }
  $sw.Stop()

  $after = (Invoke-WebRequest "$base/api/state" -UseBasicParsing).Content | ConvertFrom-Json
  if (@($after.data.transactions).Count -ne 100) { throw "记录数不是 100：$(@($after.data.transactions).Count)" }
  if ($after.data.transactions[99].note -ne '第 100 笔') { throw '最后一条内容不符' }
  $raw = [IO.File]::ReadAllText((Join-Path $tmp 'ledger.json'), [Text.Encoding]::UTF8)
  $null = $raw | ConvertFrom-Json
  if (Test-Path (Join-Path $tmp 'ledger.json.tmp')) { throw '存在残留 .tmp' }
  if (Test-Path (Join-Path $tmp 'ledger.json.bak')) { throw '存在残留 .bak' }

  $backups = @(Get-ChildItem (Join-Path $tmp 'backup') -Filter 'ledger-*.json')
  if ($backups.Count -lt 1) { throw '没有生成备份' }
  if ($backups.Count -gt 20) { throw "备份超过 20 份：$($backups.Count)" }

  Write-Host ("[PASS] 100 次读写循环完成，耗时 {0:N0} ms，平均 {1:N1} ms/次" -f $sw.Elapsed.TotalMilliseconds, ($sw.Elapsed.TotalMilliseconds / 100))
  Write-Host ("[PASS] 数据文件完整，无临时文件残留，备份 {0} 份" -f $backups.Count)
  exit 0
} finally {
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; $proc.WaitForExit(3000) | Out-Null }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
