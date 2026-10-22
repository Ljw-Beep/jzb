# M1+ 界面测试：用 Edge 无头模式加载页面，检查渲染结果
param(
  [string]$Only = '',
  [string]$ServerExe = ''
)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$serverScript = Join-Path $root 'server\server.ps1'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { throw '未找到 Edge，无法运行界面测试' }

if ($ServerExe) {
  $tmp = Join-Path $root ("build\exe-ui-" + [guid]::NewGuid().ToString('N').Substring(0, 6))
} else {
  $tmp = Join-Path $env:TEMP ("ledger-ui-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
}
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$port = 0
for ($p = 8860; $p -le 8899; $p++) {
  try { $l = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $p); $l.Start(); $l.Stop(); $port = $p; break } catch { }
}
if ($port -eq 0) { throw '无空闲端口' }
$base = "http://127.0.0.1:$port"

# 清理此前测试残留的无头浏览器进程（只匹配测试用的临时 profile，不影响用户自己的浏览器）
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'ledger-(ui|m0|dom|iso|mg|dm)-' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if ($ServerExe) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $ServerExe
  $psi.Arguments = "--headless --port $port --data `"$tmp`""
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $proc = [System.Diagnostics.Process]::Start($psi)
} else {
  $proc = Start-Process -FilePath "$PSHOME\powershell.exe" `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $serverScript, '-Port', "$port", '-DataDir', $tmp, '-NoBrowser') `
    -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $tmp 'o.log') -RedirectStandardError (Join-Path $tmp 'e.log')
}

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 200
  try { $null = Invoke-WebRequest "$base/api/ping" -UseBasicParsing -TimeoutSec 1; $ready = $true; break } catch { }
}
if (-not $ready) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; throw '服务未启动' }

$script:pass = 0
$script:fail = 0
$script:failures = @()

function Assert {
  param([string]$Name, [bool]$Cond, [string]$Detail = '')
  if ($Cond) { $script:pass++; Write-Host "  [PASS] $Name" -ForegroundColor Green }
  else { $script:fail++; $script:failures += $Name; Write-Host "  [FAIL] $Name  $Detail" -ForegroundColor Red }
}

function Stop-EdgeProfile([string]$profileDir) {
  $procs = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileDir) }
  foreach ($pr in $procs) { Stop-Process -Id $pr.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Get-Dom([string]$url, [switch]$NoBudget) {
  $profile = Join-Path $tmp ('edge-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
  $tag = [guid]::NewGuid().ToString('N').Substring(0, 6)
  $out = Join-Path $tmp "dom-$tag.txt"
  $err = Join-Path $tmp "dom-$tag.err.txt"
  $args = @(
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--hide-scrollbars', '--disable-features=Translate',
    "--user-data-dir=$profile", '--virtual-time-budget=6000', '--dump-dom', $url
  )
  $p = Start-Process -FilePath $edge -ArgumentList $args -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $out -RedirectStandardError $err
  if (-not $p.WaitForExit(30000)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  # 等到文件内容稳定（Edge 可能由子进程异步写入）
  $dom = ''
  $prevLen = -1
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 200
    $len = 0
    try { $fs = [IO.File]::Open($out, 'Open', 'Read', 'ReadWrite'); $len = $fs.Length; $fs.Close() } catch { $len = -1 }
    if ($len -gt 100 -and $len -eq $prevLen) {
      $fs = [IO.File]::Open($out, 'Open', 'Read', 'ReadWrite')
      $sr = New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)
      $dom = $sr.ReadToEnd()
      $sr.Close(); $fs.Close()
      break
    }
    $prevLen = $len
  }
  Stop-EdgeProfile $profile
  return $dom
}

try {
  Write-Host "== 1. 单元测试页 =="
  $dom = Get-Dom "$base/tests/index.html"
  $m = [regex]::Match($dom, 'TESTS PASS (\d+) FAIL (\d+)')
  Assert '测试页可加载并执行' $m.Success
  if ($m.Success) {
    $p = [int]$m.Groups[1].Value
    $f = [int]$m.Groups[2].Value
    Assert "单元测试全部通过（PASS $p / FAIL $f）" ($f -eq 0 -and $p -gt 20) "通过 $p 失败 $f"
    if ($f -gt 0) {
      $fails = [regex]::Matches($dom, '<li class="fail">([^<]+)</li>') | ForEach-Object { $_.Groups[1].Value }
      $fails | ForEach-Object { Write-Host "      失败：$_" -ForegroundColor Yellow }
    }
  }

  Write-Host "== 1b. 首页记账流程（真实点击）=="
  $flow = Get-Dom "$base/tests/flow.html"
  $fm = [regex]::Match($flow, 'FLOW PASS (\d+) FAIL (\d+)')
  Assert '流程测试可执行' $fm.Success
  if ($fm.Success) {
    $fp = [int]$fm.Groups[1].Value
    $ff = [int]$fm.Groups[2].Value
    Assert "首页记账流程全部通过（PASS $fp / FAIL $ff）" ($ff -eq 0 -and $fp -ge 8) "通过 $fp 失败 $ff"
    if ($ff -gt 0) {
      $fails2 = [regex]::Matches($flow, '<li class="fail">([^<]+)</li>') | ForEach-Object { $_.Groups[1].Value }
      $fails2 | ForEach-Object { Write-Host "      失败：$_" -ForegroundColor Yellow }
    }
  }

  Write-Host "== 1c. 账单流程（筛选/编辑/删除）=="
  $billsFlow = Get-Dom "$base/tests/bills.html"
  $bm = [regex]::Match($billsFlow, 'BILLS PASS (\d+) FAIL (\d+)')
  Assert '账单流程可执行' $bm.Success
  if ($bm.Success) {
    $bpass = [int]$bm.Groups[1].Value
    $bfail = [int]$bm.Groups[2].Value
    Assert "账单流程全部通过（PASS $bpass / FAIL $bfail）" ($bfail -eq 0 -and $bpass -ge 10) "通过 $bpass 失败 $bfail"
    if ($bfail -gt 0) {
      $bfails = [regex]::Matches($billsFlow, '<li class="fail">([^<]+)</li>') | ForEach-Object { $_.Groups[1].Value }
      $bfails | ForEach-Object { Write-Host "      失败：$_" -ForegroundColor Yellow }
    }
  }

  Write-Host "== 1d. 分类/账户/标签管理流程 =="
  $manage = Get-Dom "$base/tests/manage.html"
  $mm = [regex]::Match($manage, 'MANAGE PASS (\d+) FAIL (\d+)')
  Assert '管理流程可执行' $mm.Success
  if ($mm.Success) {
    $mpass = [int]$mm.Groups[1].Value
    $mfail = [int]$mm.Groups[2].Value
    Assert "管理流程全部通过（PASS $mpass / FAIL $mfail）" ($mfail -eq 0 -and $mpass -ge 12) "通过 $mpass 失败 $mfail"
    if ($mfail -gt 0) {
      $mfails = [regex]::Matches($manage, '<li class="fail">([^<]+)</li>') | ForEach-Object { $_.Groups[1].Value }
      $mfails | ForEach-Object { Write-Host "      失败：$_" -ForegroundColor Yellow }
    }
  }

  Write-Host "== 1e. 统计流程 =="
  $statsFlow = Get-Dom "$base/tests/stats.html"
  $sm = [regex]::Match($statsFlow, 'STATS PASS (\d+) FAIL (\d+)')
  Assert '统计流程可执行' $sm.Success
  if ($sm.Success) {
    $spass = [int]$sm.Groups[1].Value
    $sfail = [int]$sm.Groups[2].Value
    Assert "统计流程全部通过（PASS $spass / FAIL $sfail）" ($sfail -eq 0 -and $spass -ge 10) "通过 $spass 失败 $sfail"
    if ($sfail -gt 0) {
      $sfails = [regex]::Matches($statsFlow, '<li class="fail">([^<]+)</li>') | ForEach-Object { $_.Groups[1].Value }
      $sfails | ForEach-Object { Write-Host "      失败：$_" -ForegroundColor Yellow }
    }
  }
  Write-Host "== 1f. 预算流程 =="
  $budgetFlow = Get-Dom "$base/tests/budget.html"
  $bum = [regex]::Match($budgetFlow, 'BUDGET PASS (\d+) FAIL (\d+)')
  Assert '预算流程可执行' $bum.Success
  if ($bum.Success) {
    $bupass = [int]$bum.Groups[1].Value
    $bufail = [int]$bum.Groups[2].Value
    Assert "预算流程全部通过（PASS $bupass / FAIL $bufail）" ($bufail -eq 0 -and $bupass -ge 8) "通过 $bupass 失败 $bufail"
    if ($bufail -gt 0) {
      $bufails = [regex]::Matches($budgetFlow, '<li class="fail">([^<]+)</li>') | ForEach-Object { $_.Groups[1].Value }
      $bufails | ForEach-Object { Write-Host "      失败：$_" -ForegroundColor Yellow }
    }
  }
  Write-Host "== 1g. 设置与备份流程 =="
  $setFlow = Get-Dom "$base/tests/settings.html"
  $stm = [regex]::Match($setFlow, 'SETTINGS PASS (\d+) FAIL (\d+)')
  Assert '设置流程可执行' $stm.Success
  if ($stm.Success) {
    $stpass = [int]$stm.Groups[1].Value
    $stfail = [int]$stm.Groups[2].Value
    Assert "设置流程全部通过（PASS $stpass / FAIL $stfail）" ($stfail -eq 0 -and $stpass -ge 9) "通过 $stpass 失败 $stfail"
    if ($stfail -gt 0) {
      $stfails = [regex]::Matches($setFlow, '<li class="fail">([^<]+)</li>') | ForEach-Object { $_.Groups[1].Value }
      $stfails | ForEach-Object { Write-Host "      失败：$_" -ForegroundColor Yellow }
    }
  }
  Write-Host "== 1h. 离线兜底 =="
  $offlineDom = Get-Dom "$base/tests/offline.html"
  Assert '离线兜底页显示提示并可重试' ($offlineDom -match 'OFFLINE PASS 3 FAIL 0')

  Write-Host "== 1i. 大数据性能（3600 笔）=="
  & "$PSHOME\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'tools\gen-data.ps1') -Port $port -Count 3600 | Out-Host
  $perfDom = Get-Dom "$base/tests/perf.html" -NoBudget
  $pm = [regex]::Match($perfDom, 'PERF mount=([\d.]+)ms filter=([\d.]+)ms rows=(\d+) total=(\d+) matched=(\d+)')
  Assert '性能页可执行' $pm.Success
  if ($pm.Success) {
    $mountMs = [double]$pm.Groups[1].Value
    $filterMs = [double]$pm.Groups[2].Value
    $rows = [int]$pm.Groups[3].Value
    $total = [int]$pm.Groups[4].Value
    Assert "数据量 3600 笔" ($total -eq 3600) "实际 $total"
    Assert "账单首屏只渲染 50 条" ($rows -eq 50) "实际 $rows"
    Assert "首屏渲染 < 1000ms（实际 $mountMs ms）" ($mountMs -lt 1000)
    Assert "筛选 < 300ms（实际 $filterMs ms）" ($filterMs -lt 300)
    Write-Host ("      渲染 {0:N1} ms，筛选 {1:N2} ms" -f $mountMs, $filterMs)
  }
  Write-Host "== 1j. 空状态巡检 =="
  $emptyDom = Get-Dom "$base/tests/empty.html"
  $em = [regex]::Match($emptyDom, 'EMPTY PASS (\d+) FAIL (\d+)')
  Assert '空状态巡检可执行' $em.Success
  if ($em.Success) {
    $epass = [int]$em.Groups[1].Value
    $efail = [int]$em.Groups[2].Value
    Assert "空状态巡检全部通过（PASS $epass / FAIL $efail）" ($efail -eq 0 -and $epass -ge 9) "通过 $epass 失败 $efail"
    if ($efail -gt 0) {
      $efails = [regex]::Matches($emptyDom, '<li class="fail">([^<]+)</li>') | ForEach-Object { $_.Groups[1].Value }
      $efails | ForEach-Object { Write-Host "      失败：$_" -ForegroundColor Yellow }
    }
  }
  Write-Host "== 2. 首页骨架 =="
  $homeDom = Get-Dom "$base/#/home"
  Assert '首页渲染' ($homeDom -match 'data-page="home"')
  Assert '侧边栏 6 个导航项' (([regex]::Matches($homeDom, 'data-route="')).Count -eq 6) "实际 $(([regex]::Matches($homeDom, 'data-route=""')).Count)"
  Assert '首页高亮' ($homeDom -match 'nav-item active[^>]*data-route="home"')
  Assert '标题为首页' ($homeDom -match '<h1 class="page-title" id="pageTitle">首页</h1>')
  Assert '存在记一笔按钮' ($homeDom -match 'id="quickAdd"')

  Write-Host "== 3. 路由切换 =="
  $stats = Get-Dom "$base/#/stats"
  Assert '统计页渲染' ($stats -match 'data-page="stats"')
  Assert '统计标题正确' ($stats -match 'id="pageTitle">统计<')
  Assert '统计导航高亮' ($stats -match 'nav-item active[^>]*data-route="stats"')
  Assert '统计页显示月份切换' ($stats -notmatch 'id="monthSwitch" hidden')

  $bills = Get-Dom "$base/#/bills"
  Assert '账单页渲染' ($bills -match 'data-page="bills"')
  Assert '账单页隐藏月份切换' ($bills -match 'id="monthSwitch" hidden')

  $unknown = Get-Dom "$base/#/not-exist"
  Assert '未知道路回落到首页' ($unknown -match 'data-page="home"')

  Write-Host "== 4. 今日汇总与月份标签 =="
  Assert '侧边栏今日支出显示' ($homeDom -match 'id="todayBrief">¥')
  $ml = [regex]::Match($homeDom, 'monthLabel[^>]*>([^<]*)<')
  Assert '月份标签为中文格式' ($ml.Success -and $ml.Groups[1].Value -match '^\d{4}年\d{1,2}月$') ("实际 [" + $ml.Groups[1].Value + "]")

} finally {
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; $proc.WaitForExit(3000) | Out-Null }
  Start-Sleep -Milliseconds 200
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("结果：通过 {0} 项，失败 {1} 项" -f $script:pass, $script:fail)
if ($script:fail -gt 0) {
  $script:failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}
exit 0
