# 生成压测数据：向运行中的服务写入 N 笔账目（默认 3600 笔，跨 12 个月）
param(
  [int]$Port = 8611,
  [int]$Count = 3600
)
$ErrorActionPreference = 'Stop'
$base = "http://127.0.0.1:$Port"

$state = (Invoke-WebRequest "$base/api/state" -UseBasicParsing).Content | ConvertFrom-Json
$rev = [int]$state.rev
$s = $state.data

$cats = @($s.categories | Where-Object { $_.kind -eq 'expense' -and -not $_.archived })
$accs = @($s.accounts | Where-Object { -not $_.archived })
if (-not $cats.Count -or -not $accs.Count) { throw '数据里没有可用的分类或账户' }

$txs = New-Object System.Collections.ArrayList
$today = Get-Date
for ($i = 0; $i -lt $Count; $i++) {
  $monthsAgo = $i % 12
  $d = $today.AddMonths(-$monthsAgo)
  $day = ($i % 28) + 1
  $date = (New-Object DateTime($d.Year, $d.Month, $day)).ToString('yyyy-MM-dd')
  $cat = $cats[$i % $cats.Count]
  $acc = $accs[$i % $accs.Count]
  $null = $txs.Add([ordered]@{
      id        = "bench-$i"
      kind      = 'expense'
      amount    = (($i % 200) + 1) * 100
      accountId = $acc.id
      toAccountId = $null
      categoryId  = $cat.id
      date        = $date
      note        = "压测账目 $i"
      tagIds      = @()
      createdAt   = "${date}T10:00:00+08:00"
      updatedAt   = "${date}T10:00:00+08:00"
    })
}
$s.transactions = @($txs)
$json = $s | ConvertTo-Json -Depth 20
$bytes = [Text.Encoding]::UTF8.GetBytes($json)

$req = [System.Net.HttpWebRequest]::Create("$base/api/state")
$req.Method = 'PUT'
$req.ContentType = 'application/json'
$req.Timeout = 60000
$req.ReadWriteTimeout = 60000
$req.Headers.Add('X-Rev', "$rev")
$req.ContentLength = $bytes.Length
$st = $req.GetRequestStream()
$st.Write($bytes, 0, $bytes.Length)
$st.Close()
$resp = $req.GetResponse()
$sr = New-Object IO.StreamReader($resp.GetResponseStream())
$result = $sr.ReadToEnd()
$sr.Close(); $resp.Close()
Write-Host ("已写入 {0} 笔，文件大小 {1:N0} KB，服务端返回 {2}" -f $Count, ($bytes.Length / 1KB), $result)
