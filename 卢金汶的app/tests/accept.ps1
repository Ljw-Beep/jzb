# 总验收：依次运行全部测试 + 静态检查，输出汇总表
param(
  [switch]$SkipUI,
  [switch]$WithExe
)
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
$pwshExe = "$PSHOME\powershell.exe"

$steps = @(
  @{ name = '服务与存储测试'; file = 'tests\api.tests.ps1' },
  @{ name = '启动脚本测试'; file = 'tests\launcher.tests.ps1' },
  @{ name = '读写冒烟测试'; file = 'tools\smoke.ps1' },
  @{ name = 'CSV 与 Excel 兼容'; file = 'tests\csv-excel.tests.ps1' }
)
if (-not $SkipUI) {
  $steps += @{ name = '界面与流程测试'; file = 'tests\ui.tests.ps1' }
}

$exePath = Join-Path $root '记账本.exe'
$exeSteps = @()
if ($WithExe) {
  if (-not (Test-Path $exePath)) { throw '找不到 记账本.exe，请先运行 tools\build-exe.ps1' }
  $exeSteps += @{ name = 'exe 接口与存储'; file = 'tests\api.tests.ps1'; extra = @('-ServerExe', $exePath) }
  if (-not $SkipUI) { $exeSteps += @{ name = 'exe 界面与流程'; file = 'tests\ui.tests.ps1'; extra = @('-ServerExe', $exePath) } }
}

$results = @()
Write-Host '================ 开始运行全部测试 ================' -ForegroundColor Cyan
foreach ($s in $steps) {
  $path = Join-Path $root $s.file
  Write-Host ''
  Write-Host ("--- {0}（{1}）---" -f $s.name, $s.file) -ForegroundColor Yellow
  if ($s.ContainsKey('extra')) {
    $out = & $pwshExe -NoProfile -ExecutionPolicy Bypass -File $path @($s.extra) 2>&1 | Out-String -Width 200
  } else {
    $out = & $pwshExe -NoProfile -ExecutionPolicy Bypass -File $path 2>&1 | Out-String -Width 200
  }
  $code = $LASTEXITCODE
  Write-Host $out
  $results += [pscustomobject]@{
    Step   = $s.name
    Exit   = $code
    Passed = ($code -eq 0)
  }
}

foreach ($s in $exeSteps) {
  $path = Join-Path $root $s.file
  Write-Host ''
  Write-Host ("--- {0}（{1}）---" -f $s.name, $s.file) -ForegroundColor Yellow
  $out = & $pwshExe -NoProfile -ExecutionPolicy Bypass -File $path @($s.extra) 2>&1 | Out-String -Width 200
  $code = $LASTEXITCODE
  Write-Host $out
  $results += [pscustomobject]@{ Step = $s.name; Exit = $code; Passed = ($code -eq 0) }
}

Write-Host ''
Write-Host '--- 静态检查 ---' -ForegroundColor Yellow
$staticOk = $true

# 1) 所有 ps1 必须是 UTF-8 BOM（否则中文会破坏解析）
$badBom = @()
Get-ChildItem $root -Recurse -Filter *.ps1 | ForEach-Object {
  $b = [IO.File]::ReadAllBytes($_.FullName)
  if ($b.Length -lt 3 -or $b[0] -ne 0xEF -or $b[1] -ne 0xBB -or $b[2] -ne 0xBF) { $badBom += $_.Name }
}
if ($badBom.Count -eq 0) { Write-Host '  [PASS] 所有 PowerShell 脚本均为 UTF-8 BOM 编码' -ForegroundColor Green }
else { $staticOk = $false; Write-Host ("  [FAIL] 缺少 BOM：" + ($badBom -join ', ')) -ForegroundColor Red }

# 2) 前端不得引用外部 CDN（离线可用）
$hits = @()
Get-ChildItem (Join-Path $root 'app') -Recurse -Include *.js, *.html, *.css | ForEach-Object {
  $text = [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8)
  $hits += [regex]::Matches($text, 'https?://(?!127\.0\.0\.1|www\.w3\.org)[^\s"'')]+')
}
if ($hits.Count -eq 0) { Write-Host '  [PASS] 前端没有任何外部 CDN / 网络依赖' -ForegroundColor Green }
else { $staticOk = $false; Write-Host ("  [FAIL] 发现外部引用：" + (($hits | ForEach-Object { $_.Value }) -join ', ')) -ForegroundColor Red }

# 3) 数据目录不得残留临时文件
$dataDir = Join-Path $root 'data'
if (Test-Path $dataDir) {
  $left = @(Get-ChildItem $dataDir -Recurse -Include *.tmp, *.bak -ErrorAction SilentlyContinue)
  if ($left.Count -eq 0) { Write-Host '  [PASS] 数据目录没有临时文件残留' -ForegroundColor Green }
  else { $staticOk = $false; Write-Host ("  [FAIL] 残留：" + ($left.Name -join ', ')) -ForegroundColor Red }
} else {
  Write-Host '  [INFO] 尚未产生真实数据目录（测试均使用临时目录）' -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '================ 汇总 ================' -ForegroundColor Cyan
$allOk = $staticOk
foreach ($r in $results) {
  if (-not $r.Passed) { $allOk = $false }
  $flag = if ($r.Passed) { 'PASS' } else { 'FAIL' }
  $color = if ($r.Passed) { 'Green' } else { 'Red' }
  Write-Host ("  [{0}] {1}" -f $flag, $r.Step) -ForegroundColor $color
}
$staticFlag = if ($staticOk) { 'PASS' } else { 'FAIL' }
$staticColor = if ($staticOk) { 'Green' } else { 'Red' }
Write-Host ("  [{0}] 静态检查（编码 / 无外链 / 无残留）" -f $staticFlag) -ForegroundColor $staticColor

Write-Host ''
if ($allOk) {
  Write-Host '全部测试通过。' -ForegroundColor Green
  exit 0
} else {
  Write-Host '存在失败的测试，请查看上面的输出。' -ForegroundColor Red
  exit 1
}
