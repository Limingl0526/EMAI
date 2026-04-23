@echo off
title OpCopilot Launcher
color 0A

:: ========================================================
:: 设置当前目录变量 (SCRIPT_DIR 代表脚本所在的文件夹路径)
:: ========================================================
set "SCRIPT_DIR=%~dp0"

echo ========================================================
echo       Starting OpCopilot AI System (Portable Mode)
echo ========================================================

echo [1/3] Launching C# Backend (Brain)...

:: 使用相对路径跳转。假设 Backend 文件夹就在脚本旁边
:: 如果目录结构不同，请根据实际情况调整下行的相对路径
cd /d "%SCRIPT_DIR%OpCopilot_Backend\bin\Debug\net8.0"

start "OpCopilot Brain" OpCopilot_Backend.exe


echo [2/3] Launching Web Server (Frontend)...

:: 回到项目根目录 (脚本所在位置)
cd /d "%SCRIPT_DIR%"

start "OpCopilot WebHost" python -m http.server 8000


echo [3/3] Opening Browser...
timeout /t 2 >nul
start http://127.0.0.1:8000/index.html

echo.
echo ========================================================
echo   SYSTEM IS LIVE! 
echo   - Brain Logs: Check the 'GameLogs' folder in backend
echo   - Game: Running in your browser
echo ========================================================
pause