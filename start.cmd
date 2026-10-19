@echo off
rem Block Illustrator - start the dev server and open it in the browser
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
)
start "" http://localhost:5173
call npm run dev
