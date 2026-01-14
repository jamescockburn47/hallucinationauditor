@echo off
REM Hallucination Auditor - Startup Script
REM Kills existing servers and starts fresh on consistent ports

echo ========================================
echo   Hallucination Auditor - Starting...
echo ========================================
echo.

REM Kill any existing processes on our ports
echo [1/4] Stopping existing servers...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

REM Small delay to let ports free up
timeout /t 2 /nobreak >nul

REM Start API server in background
echo [2/4] Starting API server on port 8000...
start "API Server" /min cmd /c "cd /d %~dp0api && python server.py"

REM Wait for API to be ready
timeout /t 3 /nobreak >nul

REM Start UI server
echo [3/4] Starting UI server on port 5173...
start "UI Server" /min cmd /c "cd /d %~dp0ui && npm run dev -- --port 5173 --strictPort"

REM Wait for UI to be ready
timeout /t 3 /nobreak >nul

echo [4/4] Opening browser...
start http://localhost:5173

echo.
echo ========================================
echo   Servers are running:
echo   - API:  http://localhost:8000
echo   - UI:   http://localhost:5173
echo ========================================
echo.
echo Press any key to stop all servers...
pause >nul

REM Cleanup on exit
echo.
echo Stopping servers...
taskkill /FI "WINDOWTITLE eq API Server*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq UI Server*" /F >nul 2>&1
echo Done.
