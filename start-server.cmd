@echo off
rem ============================================================
rem  Riverside Tower - Construction Diorama : one-click launcher
rem
rem  IMPORTANT: keep this file pure ASCII. cmd.exe parses .cmd with
rem  the OEM codepage (GBK on zh-CN), so UTF-8 text here can break
rem  the batch parser itself.
rem
rem  Do NOT open index.html directly by double-click: under file://
rem  the browser blocks ES modules (origin "null") and the app
rem  cannot boot. It must be served over http.
rem ============================================================
setlocal
cd /d "%~dp0"
chcp 65001 >nul 2>nul

echo.
echo   ==========================================================
echo    Riverside Tower - Construction Diorama
echo    miniature construction sandbox (Three.js)
echo   ==========================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto no_node

echo   [1/2] starting local server on http://127.0.0.1:5173/ ...
start "city-sandbox server" /min cmd /c "node tools\server.mjs --port 5173"

echo   [2/2] waiting for the server to come up ...
timeout /t 2 /nobreak >nul

echo.
echo   Opening the browser now.
echo   Closing this window does NOT stop the server.
echo   To stop it, end node.exe in Task Manager (or close its window).
echo.
start "" "http://127.0.0.1:5173/"

echo   URL: http://127.0.0.1:5173/
echo.
echo   Press any key to close this window.
pause >nul
exit /b 0

:no_node
echo   [X] Node.js was not found on PATH.
echo.
echo   Use one of these instead:
echo     1. Install Node.js, then run this file again
echo     2. VS Code: right-click index.html -^> "Open with Live Server"
echo     3. VS Code: click "Go Live" in the status bar (bottom right)
echo.
echo   Press any key to close this window.
pause >nul
exit /b 1
