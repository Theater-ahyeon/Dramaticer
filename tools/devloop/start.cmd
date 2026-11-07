@echo off
rem Double-click to start the Dramaticer dev loop in a new PowerShell 7 window.
cd /d "%~dp0..\.."
start "Dramaticer devloop" "C:\Program Files\PowerShell\7\pwsh.exe" -NoLogo -NoExit -File "tools\devloop\devloop.ps1" %*
