@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$exe = Get-ChildItem -LiteralPath (Get-Location) -Filter *.exe | Select-Object -First 1; if (-not $exe) { Write-Host '找不到 exe'; pause; exit 1 }; $psi = New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName = $exe.FullName; $psi.WorkingDirectory = $exe.DirectoryName; $psi.UseShellExecute = $false; [void][System.Diagnostics.Process]::Start($psi)"
