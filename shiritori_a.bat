@echo off
chcp 65001 >nul
cd /d "%~dp0"

.\node_modules\.bin\tsx.cmd scripts\shiritori.ts first --port COM68 --turns 5 --timeout 120000

pause