@echo off
title Lynxedo-App
echo ============================================
echo  Lynxedo App (lynxedo.com)
echo  Port: 3000
echo ============================================
echo.
cd /d "C:\Projects\lynxedo"
:start
npm start -- -p 3000
echo.
echo Server stopped. Restarting in 5 seconds...
echo (Close this window to stop permanently)
echo.
timeout /t 5
goto start
