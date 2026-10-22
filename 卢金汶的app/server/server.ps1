<#
  个人记账 App —— 本地 HTTP 服务（Windows PowerShell 5.1，零依赖）
  职责：静态文件服务 + 数据文件读写（含 revision 校验、原子写入、历史备份、损坏恢复）
  仅监听 127.0.0.1，不对外网开放。
#>
[CmdletBinding()]
param(
  [int]$Port = 8611,
  [switch]$NoBrowser,
  [string]$Root,
  [string]$DataDir
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

if (-not $Root) { $Root = Split-Path $PSScriptRoot -Parent }
if (-not $DataDir) { $DataDir = Join-Path $Root 'data' }
$AppDir    = Join-Path $Root 'app'
$DataFile  = Join-Path $DataDir 'ledger.json'
$BackupDir = Join-Path $DataDir 'backup'
$MetaFile  = Join-Path $DataDir 'meta.json'
$Utf8      = New-Object System.Text.UTF8Encoding($false)

$script:Rev = 1
$script:StateRaw = ''
$script:LastBackupDay = ''

# ============================ 默认数据 ============================
$DefaultStateJson = @'
{
  "version": 1,
  "accounts": [
    { "id": "a1", "name": "现金", "icon": "💵", "color": "#2f80ed", "initialBalance": 0, "archived": false, "order": 1 },
    { "id": "a2", "name": "微信", "icon": "💬", "color": "#07c160", "initialBalance": 0, "archived": false, "order": 2 },
    { "id": "a3", "name": "支付宝", "icon": "🔵", "color": "#1677ff", "initialBalance": 0, "archived": false, "order": 3 },
    { "id": "a4", "name": "银行卡", "icon": "💳", "color": "#7b61ff", "initialBalance": 0, "archived": false, "order": 4 }
  ],
  "categories": [
    { "id": "c1", "name": "餐饮", "parentId": null, "kind": "expense", "icon": "🍜", "color": "#e67e22", "archived": false, "order": 1 },
    { "id": "c1-1", "name": "早饭", "parentId": "c1", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 2 },
    { "id": "c1-2", "name": "午饭", "parentId": "c1", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 3 },
    { "id": "c1-3", "name": "晚饭", "parentId": "c1", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 4 },
    { "id": "c1-4", "name": "外卖", "parentId": "c1", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 5 },
    { "id": "c1-5", "name": "聚餐", "parentId": "c1", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 6 },
    { "id": "c2", "name": "交通", "parentId": null, "kind": "expense", "icon": "🚇", "color": "#3498db", "archived": false, "order": 7 },
    { "id": "c2-1", "name": "地铁", "parentId": "c2", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 8 },
    { "id": "c2-2", "name": "公交", "parentId": "c2", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 9 },
    { "id": "c2-3", "name": "打车", "parentId": "c2", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 10 },
    { "id": "c2-4", "name": "加油", "parentId": "c2", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 11 },
    { "id": "c3", "name": "购物", "parentId": null, "kind": "expense", "icon": "🛍", "color": "#9b59b6", "archived": false, "order": 12 },
    { "id": "c3-1", "name": "日用品", "parentId": "c3", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 13 },
    { "id": "c3-2", "name": "服饰", "parentId": "c3", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 14 },
    { "id": "c3-3", "name": "数码", "parentId": "c3", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 15 },
    { "id": "c4", "name": "居住", "parentId": null, "kind": "expense", "icon": "🏠", "color": "#16a085", "archived": false, "order": 16 },
    { "id": "c4-1", "name": "房租", "parentId": "c4", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 17 },
    { "id": "c4-2", "name": "水电", "parentId": "c4", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 18 },
    { "id": "c4-3", "name": "物业", "parentId": "c4", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 19 },
    { "id": "c5", "name": "娱乐", "parentId": null, "kind": "expense", "icon": "🎬", "color": "#e84393", "archived": false, "order": 20 },
    { "id": "c5-1", "name": "电影", "parentId": "c5", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 21 },
    { "id": "c5-2", "name": "游戏", "parentId": "c5", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 22 },
    { "id": "c5-3", "name": "旅行", "parentId": "c5", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 23 },
    { "id": "c6", "name": "医疗", "parentId": null, "kind": "expense", "icon": "💊", "color": "#e17055", "archived": false, "order": 24 },
    { "id": "c6-1", "name": "药品", "parentId": "c6", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 25 },
    { "id": "c6-2", "name": "门诊", "parentId": "c6", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 26 },
    { "id": "c7", "name": "学习", "parentId": null, "kind": "expense", "icon": "📚", "color": "#2980b9", "archived": false, "order": 27 },
    { "id": "c7-1", "name": "书籍", "parentId": "c7", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 28 },
    { "id": "c7-2", "name": "课程", "parentId": "c7", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 29 },
    { "id": "c8", "name": "人情", "parentId": null, "kind": "expense", "icon": "🎁", "color": "#d35400", "archived": false, "order": 30 },
    { "id": "c8-1", "name": "红包", "parentId": "c8", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 31 },
    { "id": "c8-2", "name": "礼物", "parentId": "c8", "kind": "expense", "icon": "", "color": "", "archived": false, "order": 32 },
    { "id": "c9", "name": "其他", "parentId": null, "kind": "expense", "icon": "📦", "color": "#7f8c8d", "archived": false, "order": 33 },
    { "id": "c10", "name": "工资", "parentId": null, "kind": "income", "icon": "💰", "color": "#1a9c62", "archived": false, "order": 34 },
    { "id": "c11", "name": "奖金", "parentId": null, "kind": "income", "icon": "🏆", "color": "#f1c40f", "archived": false, "order": 35 },
    { "id": "c12", "name": "理财", "parentId": null, "kind": "income", "icon": "📈", "color": "#27ae60", "archived": false, "order": 36 },
    { "id": "c13", "name": "红包", "parentId": null, "kind": "income", "icon": "🧧", "color": "#e74c3c", "archived": false, "order": 37 },
    { "id": "c14", "name": "其他", "parentId": null, "kind": "income", "icon": "📦", "color": "#95a5a6", "archived": false, "order": 38 }
  ],
  "tags": [],
  "transactions": [],
  "budgets": [],
  "settings": { "defaultAccountId": "a1", "monthStartDay": 1, "overspendAlert": true }
}
'@

# ============================ 数据层 ============================
function Test-StateJson([string]$raw) {
  if ([string]::IsNullOrWhiteSpace($raw)) { return $false }
  try { $o = $raw | ConvertFrom-Json } catch { return $false }
  if ($null -eq $o) { return $false }
  if (-not $o.PSObject.Properties['version']) { return $false }
  if (-not $o.PSObject.Properties['accounts']) { return $false }
  if (-not $o.PSObject.Properties['categories']) { return $false }
  if (-not $o.PSObject.Properties['transactions']) { return $false }
  if ($null -eq $o.accounts -or $null -eq $o.categories -or $null -eq $o.transactions) { return $false }
  return $true
}

function Save-State([string]$raw) {
  $tmp = "$DataFile.tmp"
  [IO.File]::WriteAllText($tmp, $raw, $Utf8)
  $retry = 0
  while ($true) {
    try {
      if (Test-Path $DataFile) {
        # .NET Framework 不接受 $null 作为 backup 参数，用一个临时备份名再删掉
        $bak = "$DataFile.bak"
        [IO.File]::Replace($tmp, $DataFile, $bak)
        if (Test-Path $bak) { Remove-Item -LiteralPath $bak -Force -ErrorAction SilentlyContinue }
      } else {
        [IO.File]::Move($tmp, $DataFile)
      }
      break
    } catch {
      $retry++
      if ($retry -ge 3) { throw }
      Start-Sleep -Milliseconds 60
    }
  }
  $script:StateRaw = $raw
}

function Save-Rev {
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  $json = '{ "rev": ' + $script:Rev + ' }'
  [IO.File]::WriteAllText($MetaFile, $json, $Utf8)
}

function Load-Rev {
  if (Test-Path $MetaFile) {
    try {
      $m = [IO.File]::ReadAllText($MetaFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
      if ($m.rev) { $script:Rev = [int]$m.rev }
    } catch { $script:Rev = 1 }
  }
}

function New-Backup {
  if (-not (Test-Path $DataFile)) { return $null }
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  $name = 'ledger-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json'
  $dest = Join-Path $BackupDir $name
  $i = 1
  while (Test-Path $dest) {
    $name = 'ledger-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + "-$i.json"
    $dest = Join-Path $BackupDir $name
    $i++
  }
  Copy-Item -LiteralPath $DataFile -Destination $dest -Force
  $files = @(Get-ChildItem -LiteralPath $BackupDir -Filter 'ledger-*.json' | Sort-Object LastWriteTime -Descending)
  if ($files.Count -gt 20) {
    $files | Select-Object -Skip 20 | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
  }
  $script:LastBackupDay = Get-Date -Format 'yyyy-MM-dd'
  return $name
}

function Ensure-DailyBackup {
  $today = Get-Date -Format 'yyyy-MM-dd'
  if ($script:LastBackupDay -ne $today) { New-Backup | Out-Null }
}

function Restore-FromBackup {
  if (-not (Test-Path $BackupDir)) { return $false }
  $files = @(Get-ChildItem -LiteralPath $BackupDir -Filter 'ledger-*.json' | Sort-Object LastWriteTime -Descending)
  foreach ($f in $files) {
    try {
      $raw = [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::UTF8)
      if (Test-StateJson $raw) {
        Save-State $raw
        Write-Host ("  已从备份恢复: " + $f.Name) -ForegroundColor Yellow
        return $true
      }
    } catch { }
  }
  return $false
}

function Initialize-Data {
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  Load-Rev
  $fresh = $false
  if (Test-Path $DataFile) {
    $raw = [IO.File]::ReadAllText($DataFile, [Text.Encoding]::UTF8)
    if (Test-StateJson $raw) {
      $script:StateRaw = $raw
    } elseif (Restore-FromBackup) {
      # 已恢复
    } else {
      Write-Host '  数据文件损坏且无可用备份，已重建默认数据' -ForegroundColor Yellow
      $fresh = $true
    }
  } else {
    $fresh = $true
  }
  if ($fresh) {
    Save-State $DefaultStateJson
    Save-Rev
  }
  if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null }
  New-Backup | Out-Null
}

# ============================ HTTP 工具 ============================
function Get-ReasonPhrase([int]$status) {
  switch ($status) {
    200 { 'OK' }
    201 { 'Created' }
    400 { 'Bad Request' }
    404 { 'Not Found' }
    405 { 'Method Not Allowed' }
    409 { 'Conflict' }
    500 { 'Internal Server Error' }
    default { 'OK' }
  }
}

function Send-Response {
  param($Stream, [int]$Status, [string]$ContentType, [byte[]]$Body, [string]$ExtraHeaders = '')
  $reason = Get-ReasonPhrase $Status
  $head = "HTTP/1.1 $Status $reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n$ExtraHeaders`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($head)
  $Stream.Write($hb, 0, $hb.Length)
  if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
  $Stream.Flush()
}

function Send-Text {
  param($Stream, [int]$Status, [string]$ContentType, [string]$Text, [string]$ExtraHeaders = '')
  $bytes = $Utf8.GetBytes($Text)
  Send-Response -Stream $Stream -Status $Status -ContentType $ContentType -Body $bytes -ExtraHeaders $ExtraHeaders
}

function Send-Json {
  param($Stream, [int]$Status, [string]$Json)
  Send-Text -Stream $Stream -Status $Status -ContentType 'application/json; charset=utf-8' -Text $Json
}

function Find-HeaderEnd([byte[]]$bytes) {
  for ($i = 0; $i -le $bytes.Length - 4; $i++) {
    if ($bytes[$i] -eq 13 -and $bytes[$i + 1] -eq 10 -and $bytes[$i + 2] -eq 13 -and $bytes[$i + 3] -eq 10) { return $i }
  }
  return -1
}

function Read-HttpRequest {
  param($Stream)
  $buf = New-Object byte[] 8192
  $ms = New-Object System.IO.MemoryStream
  $idx = -1
  while ($true) {
    $n = $Stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $ms.Write($buf, 0, $n)
    if ($ms.Length -gt 33554432) { break }
    $idx = Find-HeaderEnd $ms.ToArray()
    if ($idx -ge 0) { break }
  }
  if ($ms.Length -eq 0) { return $null }
  $all = $ms.ToArray()
  $idx = Find-HeaderEnd $all
  if ($idx -lt 0) { return $null }

  $headerText = [Text.Encoding]::ASCII.GetString($all, 0, $idx)
  $lines = $headerText -split "`r`n"
  $parts = $lines[0] -split ' '
  if ($parts.Length -lt 3) { return $null }
  $method = $parts[0].ToUpper()
  $target = $parts[1]

  $headers = @{}
  for ($i = 1; $i -lt $lines.Length; $i++) {
    $line = $lines[$i]
    $c = $line.IndexOf(':')
    if ($c -gt 0) {
      $k = $line.Substring(0, $c).Trim().ToLower()
      $v = $line.Substring($c + 1).Trim()
      $headers[$k] = $v
    }
  }

  $path = $target
  $query = ''
  $q = $target.IndexOf('?')
  if ($q -ge 0) {
    $path = $target.Substring(0, $q)
    $query = $target.Substring($q + 1)
  }

  $contentLength = 0
  if ($headers.ContainsKey('content-length')) { [int]::TryParse($headers['content-length'], [ref]$contentLength) | Out-Null }

  $bodyMs = New-Object System.IO.MemoryStream
  $already = $all.Length - ($idx + 4)
  if ($already -gt 0) { $bodyMs.Write($all, $idx + 4, $already) }
  while ($bodyMs.Length -lt $contentLength) {
    $n = $Stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $bodyMs.Write($buf, 0, $n)
  }
  $bodyBytes = $bodyMs.ToArray()
  if ($bodyBytes.Length -gt $contentLength) { $bodyBytes = $bodyBytes[0..($contentLength - 1)] }
  $body = ''
  if ($bodyBytes.Length -gt 0) { $body = $Utf8.GetString($bodyBytes) }

  return @{
    Method  = $method
    Path    = $path
    Query   = $query
    Headers = $headers
    Body    = $body
  }
}

function Get-MimeType([string]$path) {
  $ext = [IO.Path]::GetExtension($path).ToLower()
  switch ($ext) {
    '.html' { 'text/html; charset=utf-8' }
    '.css' { 'text/css; charset=utf-8' }
    '.js' { 'text/javascript; charset=utf-8' }
    '.mjs' { 'text/javascript; charset=utf-8' }
    '.json' { 'application/json; charset=utf-8' }
    '.svg' { 'image/svg+xml' }
    '.png' { 'image/png' }
    '.jpg' { 'image/jpeg' }
    '.jpeg' { 'image/jpeg' }
    '.ico' { 'image/x-icon' }
    '.woff2' { 'font/woff2' }
    '.txt' { 'text/plain; charset=utf-8' }
    default { 'application/octet-stream' }
  }
}

function Get-SafeStaticPath([string]$urlPath) {
  $p = [Uri]::UnescapeDataString($urlPath)
  if ($p -eq '/' -or $p -eq '') { $p = '/index.html' }
  $rel = $p.TrimStart('/')
  $full = [IO.Path]::GetFullPath((Join-Path $AppDir $rel))
  $rootFull = [IO.Path]::GetFullPath($AppDir)
  if (-not $rootFull.EndsWith([IO.Path]::DirectorySeparatorChar)) { $rootFull += [IO.Path]::DirectorySeparatorChar }
  if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  return $full
}

function Send-Static {
  param($Stream, [string]$urlPath)
  $full = Get-SafeStaticPath $urlPath
  if (-not $full) { Send-Text $Stream 404 'text/plain; charset=utf-8' '404 Not Found'; return }
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
    Send-Text $Stream 404 'text/plain; charset=utf-8' '404 Not Found'
    return
  }
  $bytes = [IO.File]::ReadAllBytes($full)
  Send-Response -Stream $Stream -Status 200 -ContentType (Get-MimeType $full) -Body $bytes
}

# ============================ CSV 导出 ============================
function CsvCell([string]$v) {
  if ($null -eq $v) { $v = '' }
  if ($v -match '[",\r\n]') { return '"' + ($v -replace '"', '""') + '"' }
  return $v
}

function Build-Csv([string]$raw, [string]$month, [bool]$all) {
  $o = $raw | ConvertFrom-Json
  $cats = @{}
  foreach ($c in $o.categories) { $cats[[string]$c.id] = $c }
  $accs = @{}
  foreach ($a in $o.accounts) { $accs[[string]$a.id] = $a }
  $tags = @{}
  foreach ($t in $o.tags) { $tags[[string]$t.id] = $t }

  $sb = New-Object System.Text.StringBuilder
  $header = @('日期', '类型', '金额', '一级分类', '二级分类', '账户', '标签', '备注')
  $null = $sb.Append((($header | ForEach-Object { CsvCell $_ }) -join ','))
  $null = $sb.Append("`r`n")

  $list = @($o.transactions | Sort-Object @{ Expression = { [string]$_.date } }, @{ Expression = { [string]$_.createdAt } })
  foreach ($t in $list) {
    if (-not $all) {
      if ($month -and -not ([string]$t.date).StartsWith($month)) { continue }
    }
    $type = '支出'
    if ($t.kind -eq 'income') { $type = '收入' }
    if ($t.kind -eq 'transfer') { $type = '转账' }
    $amount = [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0:0.00}', ([double]$t.amount) / 100.0)

    $p1 = ''
    $p2 = ''
    if ($t.categoryId -and $cats.ContainsKey([string]$t.categoryId)) {
      $c = $cats[[string]$t.categoryId]
      if ($c.parentId -and $cats.ContainsKey([string]$c.parentId)) {
        $p1 = [string]$cats[[string]$c.parentId].name
        $p2 = [string]$c.name
      } else {
        $p1 = [string]$c.name
      }
    }
    $accName = ''
    if ($t.accountId -and $accs.ContainsKey([string]$t.accountId)) { $accName = [string]$accs[[string]$t.accountId].name }
    if ($t.kind -eq 'transfer') {
      $toName = ''
      if ($t.toAccountId -and $accs.ContainsKey([string]$t.toAccountId)) { $toName = [string]$accs[[string]$t.toAccountId].name }
      $accName = "$accName → $toName"
      $p1 = ''
      $p2 = ''
    }
    $tagNames = @()
    foreach ($tid in @($t.tagIds)) {
      if ($tid -and $tags.ContainsKey([string]$tid)) { $tagNames += [string]$tags[[string]$tid].name }
    }

    $row = @(
      [string]$t.date,
      $type,
      $amount,
      $p1,
      $p2,
      $accName,
      ($tagNames -join '|'),
      [string]$t.note
    ) | ForEach-Object { CsvCell $_ }
    $null = $sb.Append((@($row) -join ','))
    $null = $sb.Append("`r`n")
  }
  return $sb.ToString()
}

# ============================ 请求处理 ============================
function Handle-Request {
  param($Stream)

  $req = Read-HttpRequest $Stream
  if (-not $req) { return }
  $method = $req.Method
  $path = $req.Path

  # --- ping ---
  if ($path -eq '/api/ping') {
    Send-Json $Stream 200 ('{"app":"ledger","version":1,"rev":' + $script:Rev + ',"port":' + $Port + '}')
    return
  }

  # --- state ---
  if ($path -eq '/api/state') {
    if ($method -eq 'GET') {
      Send-Json $Stream 200 ('{"rev":' + $script:Rev + ',"data":' + $script:StateRaw + '}')
      return
    }
    if ($method -eq 'PUT') {
      $rev = 0
      if ($req.Headers.ContainsKey('x-rev')) { [int]::TryParse($req.Headers['x-rev'], [ref]$rev) | Out-Null }
      if ($rev -ne $script:Rev) {
        Send-Text $Stream 409 'application/json; charset=utf-8' ('{"error":"版本冲突","rev":' + $script:Rev + '}')
        return
      }
      if (-not (Test-StateJson $req.Body)) {
        Send-Text $Stream 400 'application/json; charset=utf-8' '{"error":"数据结构不合法"}'
        return
      }
      try {
        Ensure-DailyBackup
        Save-State $req.Body
        $script:Rev = $script:Rev + 1
        Save-Rev
        Send-Json $Stream 200 ('{"rev":' + $script:Rev + '}')
      } catch {
        Send-Json $Stream 500 ('{"error":' + (($_.Exception.Message | ConvertTo-Json)) + '}')
      }
      return
    }
    Send-Text $Stream 405 'text/plain; charset=utf-8' 'Method Not Allowed'
    return
  }

  # --- backup ---
  if ($path -eq '/api/backup') {
    if ($method -ne 'POST') { Send-Text $Stream 405 'text/plain; charset=utf-8' 'Method Not Allowed'; return }
    $name = New-Backup
    Send-Json $Stream 200 ('{"file":"' + $name + '"}')
    return
  }

  # --- info ---
  if ($path -eq '/api/info') {
    $files = @(Get-ChildItem -LiteralPath $BackupDir -Filter 'ledger-*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    $last = ''
    if ($files.Count -gt 0) { $last = $files[0].LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') }
    $info = [ordered]@{
      dataFile    = $DataFile
      backupDir   = $BackupDir
      backupCount = $files.Count
      lastBackup  = $last
      rev         = $script:Rev
    }
    Send-Json $Stream 200 ($info | ConvertTo-Json -Compress)
    return
  }

  # --- export json ---
  if ($path -eq '/api/export.json') {
    $fname = 'ledger-backup-' + (Get-Date -Format 'yyyy-MM-dd') + '.json'
    $extra = "Content-Disposition: attachment; filename=`"$fname`"`r`n"
    Send-Text $Stream 200 'application/json; charset=utf-8' $script:StateRaw $extra
    return
  }

  # --- export csv ---
  if ($path -eq '/api/export.csv') {
    $qs = @{}
    foreach ($pair in ($req.Query -split '&')) {
      if ([string]::IsNullOrWhiteSpace($pair)) { continue }
      $kv = $pair -split '=', 2
      $k = [Uri]::UnescapeDataString($kv[0])
      $v = ''
      if ($kv.Length -gt 1) { $v = [Uri]::UnescapeDataString($kv[1]) }
      $qs[$k] = $v
    }
    $all = $qs.ContainsKey('all') -and $qs['all'] -eq '1'
    $month = ''
    if ($qs.ContainsKey('month')) { $month = $qs['month'] }
    $csv = Build-Csv $script:StateRaw $month $all
    $bom = [Text.Encoding]::UTF8.GetPreamble()
    $body = $csvBytes = $Utf8.GetBytes($csv)
    $payload = New-Object byte[] ($bom.Length + $body.Length)
    [Array]::Copy($bom, 0, $payload, 0, $bom.Length)
    [Array]::Copy($body, 0, $payload, $bom.Length, $body.Length)
    $fname = 'ledger-' + (Get-Date -Format 'yyyy-MM-dd') + '.csv'
    $extra = "Content-Disposition: attachment; filename=`"$fname`"`r`n"
    Send-Response -Stream $Stream -Status 200 -ContentType 'text/csv; charset=utf-8' -Body $payload -ExtraHeaders $extra
    return
  }

  # --- static ---
  if ($method -eq 'GET' -or $method -eq 'HEAD') {
    Send-Static $Stream $path
    return
  }
  Send-Text $Stream 405 'text/plain; charset=utf-8' 'Method Not Allowed'
}

# ============================ 启动逻辑 ============================
function Test-ExistingServer([int]$p) {
  try {
    $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$p/api/ping")
    $req.Timeout = 400
    $req.ReadWriteTimeout = 400
    $resp = $req.GetResponse()
    $sr = New-Object IO.StreamReader($resp.GetResponseStream())
    $txt = $sr.ReadToEnd()
    $sr.Close()
    $resp.Close()
    return ($txt -match '"app"\s*:\s*"ledger"')
  } catch { return $false }
}

# 单实例守卫：用命名互斥体，避免两次启动各占一个端口、同时写同一份数据
# 互斥体名字带上数据目录指纹：同一份数据只允许一个服务，不同数据目录（如测试）互不影响
$dataKey = [IO.Path]::GetFullPath($DataDir).TrimEnd('\').ToLowerInvariant()
$md5 = [Security.Cryptography.MD5]::Create()
$hashBytes = $md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($dataKey))
$mutexName = 'LedgerApp.' + ([BitConverter]::ToString($hashBytes) -replace '-', '').Substring(0, 16)
$script:instanceMutex = New-Object System.Threading.Mutex($false, $mutexName)
$isFirstInstance = $false
try { $isFirstInstance = $script:instanceMutex.WaitOne(0) } catch { $isFirstInstance = $false }

if (-not $isFirstInstance) {
  # 已有实例在跑：等它就绪后打开浏览器
  for ($i = 0; $i -lt 40; $i++) {
    for ($p = $Port; $p -le ($Port + 9); $p++) {
      if (Test-ExistingServer $p) {
        $url = "http://127.0.0.1:$p/"
        Write-Host "记账服务已在运行：$url" -ForegroundColor Green
        if (-not $NoBrowser) { Start-Process $url }
        exit 0
      }
    }
    Start-Sleep -Milliseconds 250
  }
  Write-Host "检测到已有实例，但暂时无法连接，请稍后重试。" -ForegroundColor Yellow
  exit 0
}

$bindPort = 0
for ($p = $Port; $p -le ($Port + 9); $p++) {
  try {
    $probe = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $p)
    $probe.Start()
    $probe.Stop()
    $bindPort = $p
    break
  } catch { }
}
if ($bindPort -eq 0) {
  Write-Host "端口 $Port - $($Port + 9) 都被占用，无法启动。" -ForegroundColor Red
  exit 1
}

Initialize-Data

$listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $bindPort)
$listener.Start()
$url = "http://127.0.0.1:$bindPort/"

Write-Host ''
Write-Host '  记账服务已启动' -ForegroundColor Green
Write-Host "  地址：$url"
Write-Host "  数据：$DataFile"
Write-Host '  关闭此窗口即停止服务'
Write-Host ''

if (-not $NoBrowser) { Start-Process $url }

while ($true) {
  $client = $null
  try {
    $client = $listener.AcceptTcpClient()
    $client.ReceiveTimeout = 5000
    $client.SendTimeout = 5000
    $stream = $client.GetStream()
    Handle-Request $stream
  } catch [System.IO.IOException] {
    # 客户端断开等，忽略
  } catch {
    Write-Host ("[错误] " + $_.Exception.Message) -ForegroundColor Red
  } finally {
    if ($client) { try { $client.Close() } catch { } }
  }
}
