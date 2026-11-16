@echo off
chcp 65001 >nul
setlocal
title AntWordProfiler Web

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :NO_NODE

if exist "node_modules\" goto :RUN_SERVER

echo [AntWordProfiler Web] node_modules 폴더가 없어 패키지 설치를 시작합니다...
call npm install
if errorlevel 1 goto :INSTALL_FAIL

:RUN_SERVER
echo ============================================================
echo   AntWordProfiler Web 로컬 서버를 시작합니다.
echo   잠시 후 기본 브라우저가 자동으로 열립니다.
echo   종료하려면 이 창에서 Ctrl+C 를 누르거나 창을 닫으세요.
echo ============================================================
call npm run dev -- --open
if errorlevel 1 goto :SERVER_FAIL
goto :EOF

:NO_NODE
echo [오류] Node.js가 설치되어 있지 않거나 PATH에서 찾을 수 없습니다.
echo https://nodejs.org 에서 Node.js LTS 버전을 설치한 뒤 다시 실행해 주세요.
pause
exit /b 1

:INSTALL_FAIL
echo [오류] npm install 실행 중 문제가 발생했습니다.
pause
exit /b 1

:SERVER_FAIL
echo [오류] 서버 실행 중 문제가 발생했습니다.
pause
exit /b 1
