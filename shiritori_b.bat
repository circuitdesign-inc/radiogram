@echo off
chcp 65001 >nul
cd /d "%~dp0"

.\node_modules\.bin\tsx.cmd scripts\shiritori.ts second --port COM32 --turns 5 --timeout 120000

pause