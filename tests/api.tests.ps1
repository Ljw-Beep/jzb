# M0 验收测试：本地服务 / 存储 / 备份 / 导出
# 用法：api.tests.ps1 [-ServerExe <记账本.exe 路径>]
param(
  [string]$ServerExe = ''
)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$serverScript = Join-Path $root 'server\server.ps1'
if ($ServerExe) {
  $tmp = Join-Path $root ("build\exe-api-" + [guid]::NewGuid().ToString('N').Substring(0, 6))
} else {
  $tmp = Join-Path $env:TEMP ("ledger-m0-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
}
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# 动态挑选一个空闲端口，避免与残留进程冲突
$port = 0
for ($p = 8720; $p -le 8799; $p++) {
  try {
    $probe = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $p)
    $probe.Start(); $probe.Stop(); $port = $p; break
  } catch { }
}
if ($port -eq 0) { throw '找不到空闲测试端口' }
$base = "http://127.0.0.1:$port"

$script:pass = 0
$script:fail = 0
$script:failures = @()

function Assert {
  param([string]$Name, [bool]$Cond, [string]$Detail = '')
  if ($Cond) {
    $script:pass++
    Write-Host "  [PASS] $Name" -ForegroundColor Green
  } else {
    $script:fail++
    $script:failures += $Name
    Write-Host "  [FAIL] $Name  $Detail" -ForegroundColor Red
  }
}

function Test-StateParse([string]$raw) {
  try { $null = $raw | ConvertFrom-Json; return $true } catch { return $false }
}

function Get-Text([string]$path) {
  $r = Invoke-WebRequest -Uri "$base$path" -UseBasicParsing -TimeoutSec 10
  return [string]$r.Content
}

function Get-Bytes([string]$path) {
  $wc = New-Object System.Net.WebClient
  try { return $wc.DownloadData("$base$path") } finally { $wc.Dispose() }
}

function Put-State([string]$json, [int]$rev) {
  # 用 HttpWebRequest 而不是 Invoke-WebRequest：后者在 4xx 时会吞掉响应体
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $req = [System.Net.HttpWebRequest]::Create("$base/api/state")
  $req.Method = 'PUT'
  $req.ContentType = 'application/json'
  $req.Timeout = 15000
  $req.ReadWriteTimeout = 15000
  $req.Headers.Add('X-Rev', "$rev")
  $req.ContentLength = $bytes.Length
  $s = $req.GetRequestStream()
  $s.Write($bytes, 0, $bytes.Length)
  $s.Close()
  try {
    $resp = $req.GetResponse()
  } catch [System.Net.WebException] {
    $resp = $_.Exception.Response
  }
  $sr = New-Object IO.StreamReader($resp.GetResponseStream())
  $body = $sr.ReadToEnd()
  $sr.Close()
  return @{ Status = [int]$resp.StatusCode; Body = $body }
}

function Start-Server {
  $out = Join-Path $tmp 'server.out.log'
  $err = Join-Path $tmp 'server.err.log'
  if ($ServerExe) {
    # 用 .NET Process.Start：Start-Process 对 GUI 子系统程序会阻塞
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $ServerExe
    $psi.Arguments = "--headless --port $port --data `"$tmp`""
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
  } else {
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $serverScript, '-Port', "$port", '-DataDir', $tmp, '-NoBrowser')
    $p = Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList $argList -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput $out -RedirectStandardError $err
  }
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 200
    if ($p.HasExited) { break }
    try { $null = Invoke-WebRequest -Uri "$base/api/ping" -UseBasicParsing -TimeoutSec 1; return $p } catch { }
  }
  Stop-Server $p
  $log = ''
  if (Test-Path $out) { $log += (Get-Content $out -Raw -Encoding UTF8 -ErrorAction SilentlyContinue) }
  if (Test-Path $err) { $log += (Get-Content $err -Raw -Encoding UTF8 -ErrorAction SilentlyContinue) }
  throw "服务启动失败。日志：`n$log"
}

function Stop-Server($p) {
  if ($p -and -not $p.HasExited) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    $p.WaitForExit(3000) | Out-Null
  }
}

$proc = $null
try {
  Write-Host "== 启动服务（数据目录 $tmp）=="
  $proc = Start-Server

  Write-Host "== 1. 基础接口 =="
  $ping = Get-Text '/api/ping' | ConvertFrom-Json
  Assert 'ping 返回 app=ledger' ($ping.app -eq 'ledger')
  Assert 'ping 返回 rev' ($ping.rev -ge 1)

  $s = Get-Text '/api/state' | ConvertFrom-Json
  Assert 'GET state 初始 rev=1' ($s.rev -eq 1) "实际 $($s.rev)"
  Assert '默认 4 个账户' (@($s.data.accounts).Count -eq 4) "实际 $(@($s.data.accounts).Count)"
  $expParents = @($s.data.categories | Where-Object { $_.kind -eq 'expense' -and -not $_.parentId })
  $incParents = @($s.data.categories | Where-Object { $_.kind -eq 'income' -and -not $_.parentId })
  Assert '默认 9 个支出一级分类' ($expParents.Count -eq 9) "实际 $($expParents.Count)"
  Assert '默认 5 个收入分类' ($incParents.Count -eq 5) "实际 $($incParents.Count)"
  Assert '默认有二级分类' (@($s.data.categories | Where-Object { $_.parentId }).Count -gt 0)
  Assert '数据文件已生成' (Test-Path (Join-Path $tmp 'ledger.json'))
  Assert '启动时已生成备份' (@(Get-ChildItem (Join-Path $tmp 'backup') -Filter 'ledger-*.json').Count -ge 1)

  Write-Host "== 2. 写入与版本控制 =="
  $state = $s.data
  $state.transactions = @([ordered]@{
      id = 't1'; kind = 'expense'; amount = 2800;
      accountId = 'a2'; toAccountId = $null; categoryId = 'c1-2'; date = '2026-10-18';
      note = 'note-A'; tagIds = @(); createdAt = '2026-10-18T12:31:00+08:00';
      updatedAt = '2026-10-18T12:31:00+08:00'
    })
  $json = $state | ConvertTo-Json -Depth 20
  $r1 = Put-State $json 1
  Assert 'PUT rev=1 成功' ($r1.Status -eq 200) "状态 $($r1.Status)"
  Assert 'PUT 后 rev 递增为 2' ((($r1.Body | ConvertFrom-Json).rev) -eq 2)

  $r2 = Put-State $json 1
  Assert '旧 rev 写入返回 409' ($r2.Status -eq 409) "状态 $($r2.Status)"
  $r2j = $r2.Body | ConvertFrom-Json
  Assert '409 返回服务端最新 rev' ($r2j.rev -eq 2) "实际 $($r2j.rev)"

  $after = Get-Text '/api/state' | ConvertFrom-Json
  Assert '读取到已写入的账目' (@($after.data.transactions).Count -eq 1)
  Assert '账目内容正确' ($after.data.transactions[0].note -eq 'note-A')
  Assert 'rev 保持 2' ($after.rev -eq 2)

  $fileRaw = [IO.File]::ReadAllText((Join-Path $tmp 'ledger.json'), [Text.Encoding]::UTF8)
  Assert '磁盘文件与提交内容逐字节一致' ($fileRaw -eq $json)
  Assert '磁盘文件可解析' (Test-StateParse $fileRaw)
  Assert '无 .tmp 残留' (-not (Test-Path (Join-Path $tmp 'ledger.json.tmp')))

  $bad = Put-State '{ not json' 2
  Assert '非法 JSON 返回 400' ($bad.Status -eq 400) "状态 $($bad.Status)"
  $still = Get-Text '/api/state' | ConvertFrom-Json
  Assert '非法写入后数据未变' (@($still.data.transactions).Count -eq 1)

  Write-Host "== 3. 中文原样落盘 =="
  $cn = '{"version":1,"accounts":[],"categories":[],"transactions":[],"tags":[],"budgets":[],"settings":{},"note":"中文测试·¥28"}'
  $rc = Put-State $cn 2
  Assert 'RAW 中文写入成功' ($rc.Status -eq 200) "状态 $($rc.Status)"
  $cnFile = [IO.File]::ReadAllText((Join-Path $tmp 'ledger.json'), [Text.Encoding]::UTF8)
  Assert '中文未被转义' ($cnFile -match '中文测试·¥28')
  Assert 'verbatim 与请求体一致' ($cnFile -eq $cn)
  $restore = Put-State $json 3
  Assert '恢复测试数据成功' ($restore.Status -eq 200)

  Write-Host "== 4. 备份轮转 =="
  for ($i = 0; $i -lt 24; $i++) {
    Invoke-WebRequest -Uri "$base/api/backup" -Method Post -UseBasicParsing -TimeoutSec 10 | Out-Null
  }
  $bcount = @(Get-ChildItem (Join-Path $tmp 'backup') -Filter 'ledger-*.json').Count
  Assert '备份数量不超过 20' ($bcount -le 20) "实际 $bcount"
  Assert '备份内容可解析' (Test-StateParse ([IO.File]::ReadAllText((Get-ChildItem (Join-Path $tmp 'backup') -Filter 'ledger-*.json' | Select-Object -First 1).FullName, [Text.Encoding]::UTF8)))

  Write-Host "== 5. 导出 =="
  $ej = Get-Text '/api/export.json' | ConvertFrom-Json
  Assert 'export.json 内容完整' (@($ej.transactions).Count -eq 1)
  $respJson = Invoke-WebRequest -Uri "$base/api/export.json" -UseBasicParsing
  Assert 'export.json 带附件头' ([string]$respJson.Headers['Content-Disposition'] -match 'attachment')

  $csvBytes = Get-Bytes '/api/export.csv?month=2026-10'
  $hasBom = ($csvBytes[0] -eq 0xEF -and $csvBytes[1] -eq 0xBB -and $csvBytes[2] -eq 0xBF)
  Assert 'CSV 带 UTF-8 BOM' $hasBom
  $csvText = [Text.Encoding]::UTF8.GetString($csvBytes)
  Assert 'CSV 表头正确' ($csvText -match '日期,类型,金额,一级分类,二级分类,账户,标签,备注')
  Assert 'CSV 含账目行' ($csvText -match '2026-10-18,支出,28.00,餐饮,午饭,微信')
  $csvEmpty = [Text.Encoding]::UTF8.GetString((Get-Bytes '/api/export.csv?month=2020-01'))
  Assert 'CSV 按月份过滤' ((($csvEmpty -split "`r`n") | Where-Object { $_.Trim() }).Count -eq 1)

  Write-Host "== 6. 静态文件与安全 =="
  $idx = Get-Text '/'
  Assert '首页返回 200 且含标题' ($idx -match '记账')
  $cssStatus = 0
  try { $null = Invoke-WebRequest -Uri "$base/css/nope.css" -UseBasicParsing } catch { $cssStatus = [int]$_.Exception.Response.StatusCode }
  Assert '不存在的文件返回 404' ($cssStatus -eq 404) "状态 $cssStatus"
  $trav = 0
  try { $null = Invoke-WebRequest -Uri "$base/%2e%2e/server/server.ps1" -UseBasicParsing } catch { $trav = [int]$_.Exception.Response.StatusCode }
  Assert '路径穿越被拒绝' ($trav -eq 404) "状态 $trav"

  Write-Host "== 7. 损坏恢复 =="
  Stop-Server $proc
  $proc = $null
  $ledger = Join-Path $tmp 'ledger.json'
  [IO.File]::WriteAllText($ledger, '### corrupted ###', [Text.Encoding]::UTF8)
  $proc = Start-Server
  $rec = Get-Text '/api/state' | ConvertFrom-Json
  Assert '损坏后自动恢复' (@($rec.data.transactions).Count -eq 1) "记录数 $(@($rec.data.transactions).Count)"
  Assert '恢复后文件可解析' (Test-StateParse ([IO.File]::ReadAllText($ledger, [Text.Encoding]::UTF8)))

  Write-Host "== 8. 重启后 rev 保持 =="
  Stop-Server $proc
  $proc = Start-Server
  $p2 = Get-Text '/api/ping' | ConvertFrom-Json
  Assert '重启后 rev 持久化' ($p2.rev -ge 4) "实际 $($p2.rev)"

  Write-Host "== 9. 单实例保护（同一数据目录只允许一个服务）=="
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $second = Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $serverScript, '-Port', "$port", '-DataDir', $tmp, '-NoBrowser') -PassThru -WindowStyle Hidden
  $exited = $second.WaitForExit(15000)
  $sw.Stop()
  Assert '同一数据目录的第二个实例会退出' ($exited -and $second.ExitCode -eq 0) "exited=$exited code=$($second.ExitCode)"
  if (-not $exited) { Stop-Process -Id $second.Id -Force -ErrorAction SilentlyContinue }
  Assert '单实例检测耗时 < 10 秒' ($sw.Elapsed.TotalSeconds -lt 10) ("实际 " + $sw.Elapsed.TotalSeconds.ToString('0.0') + " 秒")
  Assert '原服务仍在运行' ((Get-Text '/api/ping' | ConvertFrom-Json).app -eq 'ledger')
  $listenPorts = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -ge 8611 -and $_.LocalPort -le 8620 })
  Assert '没有产生重复端口上的服务' ($listenPorts.Count -le 1) ("实际监听 $($listenPorts.Count) 个")

  Write-Host "== 10. 不同数据目录可并行（测试隔离）=="
  $tmp3 = Join-Path $env:TEMP ("ledger-iso-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $tmp3 | Out-Null
  $port3 = 0
  for ($pp = 8800; $pp -le 8849; $pp++) {
    try { $l = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $pp); $l.Start(); $l.Stop(); $port3 = $pp; break } catch { }
  }
  if ($port3 -eq 0) { throw '找不到第三个测试端口' }
  $third = Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $serverScript, '-Port', "$port3", '-DataDir', $tmp3, '-NoBrowser') -PassThru -WindowStyle Hidden
  $up3 = $false
  for ($i = 0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 200
    try { $null = Invoke-WebRequest "http://127.0.0.1:$port3/api/ping" -UseBasicParsing -TimeoutSec 1; $up3 = $true; break } catch { }
  }
  Assert '不同数据目录可以独立启动' $up3
  if (-not $third.HasExited) { Stop-Process -Id $third.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  Remove-Item $tmp3 -Recurse -Force -ErrorAction SilentlyContinue

} finally {
  Stop-Server $proc
  Start-Sleep -Milliseconds 200
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("结果：通过 {0} 项，失败 {1} 项" -f $script:pass, $script:fail)
if ($script:fail -gt 0) {
  Write-Host '失败项：' -ForegroundColor Red
  $script:failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}
exit 0
