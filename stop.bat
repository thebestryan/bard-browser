@echo off
rem Stop Bard Browser (cmd.exe wrapper for stop.ps1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
