# CSV 与 Excel 兼容性测试：导出 CSV 后用 Excel 真实打开，检查中文与字段
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$serverScript = Join-Path $root 'server\server.ps1'

$excelPath = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\excel.exe' -ErrorAction SilentlyContinue).'(default)'
if (-not $excelPath -or -not (Test-Path $excelPath)) {
  Write-Host '  [SKIP] 本机没有安装 Excel，跳过 CSV 打开测试（编码与字段仍由 api 测试覆盖）' -ForegroundColor Yellow
  exit 0
}

$tmp = Join-Path $env:TEMP ("ledger-excel-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$port = 0
for ($p = 8980; $p -le 8999; $p++) {
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
$excel = $null
try {
  $proc = Start-Process -FilePath "$PSHOME\powershell.exe" `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $serverScript, '-Port', "$port", '-DataDir', $tmp, '-NoBrowser') `
    -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $tmp 'o.log') -RedirectStandardError (Join-Path $tmp 'e.log')
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 200
    try { $null = Invoke-WebRequest "$base/api/ping" -UseBasicParsing -TimeoutSec 1; $ready = $true; break } catch { }
  }
  if (-not $ready) { throw '服务未启动' }

  # 写入一条带中文的账目
  $state = (Invoke-WebRequest "$base/api/state" -UseBasicParsing).Content | ConvertFrom-Json
  $state.data.transactions = @([ordered]@{
      id = 'e1'; kind = 'expense'; amount = 2800; accountId = 'a2'; toAccountId = $null;
      categoryId = 'c1-2'; date = '2026-10-18'; note = '和同事吃饭'; tagIds = @();
      createdAt = '2026-10-18T12:00:00+08:00'; updatedAt = '2026-10-18T12:00:00+08:00'
    })
  $json = $state.data | ConvertTo-Json -Depth 20
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $req = [System.Net.HttpWebRequest]::Create("$base/api/state")
  $req.Method = 'PUT'; $req.ContentType = 'application/json'
  $req.Headers.Add('X-Rev', [string]$state.rev); $req.ContentLength = $bytes.Length
  $st = $req.GetRequestStream(); $st.Write($bytes, 0, $bytes.Length); $st.Close()
  $null = $req.GetResponse()

  $csvPath = Join-Path $tmp 'ledger.csv'
  $wc = New-Object System.Net.WebClient
  $wc.DownloadFile("$base/api/export.csv?month=2026-10", $csvPath)
  $wc.Dispose()
  Assert 'CSV 已下载' (Test-Path $csvPath)

  Write-Host '== 用 Excel 打开 CSV =='
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $wb = $excel.Workbooks.Open($csvPath, 0, $true)

  $ws = $wb.Worksheets.Item(1)
  $used = $ws.UsedRange
  $rows = $used.Rows.Count
  $cols = $used.Columns.Count

  $header = [string]$ws.Cells.Item(1, 1).Text
  $typeCell = [string]$ws.Cells.Item(2, 2).Text
  $amountCell = [string]$ws.Cells.Item(2, 3).Text
  $cat1 = [string]$ws.Cells.Item(2, 4).Text
  $cat2 = [string]$ws.Cells.Item(2, 5).Text
  $noteCell = [string]$ws.Cells.Item(2, 8).Text

  Assert 'Excel 读到 8 列' ($cols -eq 8) "实际 $cols"
  Assert '表头中文正常' ($header -eq '日期') "实际 [$header]"
  Assert '类型中文正常' ($typeCell -eq '支出') "实际 [$typeCell]"
  # Excel 会把 28.00 解析成数字 28，这是正常行为；这里校验数值本身正确
  $amountValue = $ws.Cells.Item(2, 3).Value2
  Assert '金额被识别为数字 28' ([math]::Abs([double]$amountValue - 28) -lt 0.001) "实际 [$amountValue]"
  Assert '二级分类正常' ($cat1 -eq '餐饮' -and $cat2 -eq '午饭') "实际 [$cat1/$cat2]"
  Assert '备注中文正常' ($noteCell -eq '和同事吃饭') "实际 [$noteCell]"
  Assert '数据行数正确' ($rows -eq 2) "实际 $rows"

  $wb.Close($false)
} finally {
  if ($excel) {
    try { $excel.Quit() } catch { }
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null } catch { }
    [GC]::Collect()
    Start-Sleep -Milliseconds 300
  }
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Get-Process EXCEL -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt (Get-Date).AddMinutes(-5) } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 300
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("结果：通过 {0} 项，失败 {1} 项" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
