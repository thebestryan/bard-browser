@echo off
rem Bard Browser launcher for plain cmd.exe users.
rem PowerShell wrapper handles install + server + browser open.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
