@echo off
rem Block Illustrator - start a local server for dist/index.html (no Node.js / Python needed)
rem Usage: serve.cmd            -> http://localhost:8000/
rem        serve.cmd -Port 8080 -> http://localhost:8080/
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
if errorlevel 1 pause
