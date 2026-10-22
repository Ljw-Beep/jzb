# 编译单文件 exe：把前端页面全部嵌入，输出 记账本.exe
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "找不到 csc.exe：$csc" }

$appDir = Join-Path $root 'app'
$srcFile = Join-Path $root 'src\App.cs'
$outFile = Join-Path $root '记账本.exe'
$serverScript = Join-Path $root 'server\server.ps1'

# 从 PowerShell 服务里抽出默认数据，保证 exe 与脚本版初始数据一致
$psText = [IO.File]::ReadAllText($serverScript, [Text.Encoding]::UTF8)
$m = [regex]::Match($psText, "(?s)\`$DefaultStateJson = @'\r?\n(.*?)\r?\n'@")
if (-not $m.Success) { throw '未能从 server.ps1 提取默认数据' }
$buildDir = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null
$defaultJson = Join-Path $buildDir 'default-state.json'
[IO.File]::WriteAllText($defaultJson, $m.Groups[1].Value, (New-Object Text.UTF8Encoding($false)))

# 收集所有前端资源
$resArgs = New-Object System.Collections.ArrayList
Get-ChildItem $appDir -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($appDir.Length + 1).Replace('\', '/')
  $name = 'app.' + $rel.Replace('/', '.')
  $null = $resArgs.Add("/resource:`"$($_.FullName)`",$name")
}
$null = $resArgs.Add("/resource:`"$defaultJson`",res.default-state.json")

Write-Host ("嵌入资源 {0} 个" -f $resArgs.Count)
$argList = New-Object System.Collections.ArrayList
$null = $argList.Add('/nologo')
$null = $argList.Add('/target:winexe')
$null = $argList.Add('/platform:anycpu')
$null = $argList.Add('/optimize+')
$null = $argList.Add("/out:`"$outFile`"")
foreach ($r in $resArgs) { $null = $argList.Add($r) }
$null = $argList.Add('/r:System.Web.Extensions.dll')
$null = $argList.Add('/r:System.Windows.Forms.dll')
$null = $argList.Add('/r:System.Drawing.dll')
$null = $argList.Add("`"$srcFile`"")
$asmInfo = Join-Path $root 'src\AssemblyInfo.cs'
if (Test-Path $asmInfo) { $null = $argList.Add("`"$asmInfo`"") }

$output = & $csc $argList.ToArray() 2>&1
$output | Out-String | Write-Host
if ($LASTEXITCODE -ne 0) { throw "编译失败（exit $LASTEXITCODE）" }
if (-not (Test-Path $outFile)) { throw '编译没有生成 exe' }

$size = (Get-Item $outFile).Length / 1KB
Write-Host ("编译成功：{0}（{1:N0} KB）" -f $outFile, $size) -ForegroundColor Green
