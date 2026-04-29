@echo off
REM Foreman App - Quick Start Script for Windows

echo Checking for Node.js installation...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Node.js is not installed!
    echo.
    echo Please download and install Node.js from: https://nodejs.org/
    echo Choose the LTS version and follow the installer prompts.
    echo.
    pause
    exit /b 1
)

echo Node.js found!
echo.

echo Checking for npm...
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: npm is not installed!
    pause
    exit /b 1
)

echo npm found!
echo.

echo Installing dependencies...
call npm install

if %errorlevel% neq 0 (
    echo ERROR: Failed to install dependencies!
    pause
    exit /b 1
)

echo.
echo Starting server...
echo.
echo ========================================
echo Server starting on http://localhost:3000
echo Press Ctrl+C to stop the server
echo ========================================
echo.

call npm start

pause
