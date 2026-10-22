# 停止记账服务：结束所有正在运行的 server.ps1 进程
Add-Type -AssemblyName System.Windows.Forms

$procs = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'powershell.exe' -and $_.CommandLine -and $_.CommandLine -like '*server\server.ps1*'
  })

if ($procs.Count -eq 0) {
  [System.Windows.Forms.MessageBox]::Show('记账服务当前没有运行。', '记账本') | Out-Null
  exit 0
}

foreach ($p in $procs) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 600

$still = @(Get-NetTCPConnection -State Listen -LocalPort 8611 -ErrorAction SilentlyContinue).Count
if ($still -eq 0) {
  [System.Windows.Forms.MessageBox]::Show('记账服务已停止。', '记账本') | Out-Null
} else {
  [System.Windows.Forms.MessageBox]::Show('停止失败，请打开任务管理器结束 powershell 进程。', '记账本') | Out-Null
}
