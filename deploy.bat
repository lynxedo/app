@echo off
title Deploying Lynxedo App...
echo ============================================
echo  Lynxedo Deploy
echo  Copy Google Drive -> C:\Projects\lynxedo
echo  Build + Restart
echo ============================================
echo.

set SRC=H:\Shared drives\Claude\Projects\App\lynxedo
set DST=C:\Projects\lynxedo

echo Copying source files...
robocopy "%SRC%" "%DST%" /E /XD node_modules .next .git /XF .env.local /NFL /NDL /NJH /NJS
echo.

echo Building...
cd /d "%DST%"
call npm run build
if %errorlevel% neq 0 (
  echo.
  echo BUILD FAILED. Server not restarted.
  pause
  exit /b 1
)

echo.
echo Restarting server...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$line = netstat -ano | Where-Object { $_ -match ':3000 ' } | Select-Object -First 1; if ($line) { $nPid = [int](($line.Trim() -split '\s+')[-1]); Stop-Process -Id $nPid -Force -EA SilentlyContinue; Write-Host ('Stopped PID ' + $nPid) } else { Write-Host 'Server was not running' }"
timeout /t 3 /nobreak >nul
start "" "C:\Projects\lynxedo\start-routing.bat"
timeout /t 12 /nobreak >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-NetTCPConnection -LocalPort 3000 -State Listen -EA SilentlyContinue; if ($c) { Write-Host 'Server is up on port 3000' } else { Write-Host 'WARNING: Server did not come back up - check the Lynxedo App window' }"

echo.
echo Deploy complete.
timeout /t 3 /nobreak >nul
exit
