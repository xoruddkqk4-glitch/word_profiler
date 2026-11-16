@echo off
chcp 65001 >nul
setlocal
title AntWordProfiler EXE Builder

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :NO_NODE

if exist "node_modules\electron\" goto :BUILD_EXE

echo [AntWordProfiler] 필수 패키지가 없어 npm install을 실행합니다...
call npm install
if errorlevel 1 goto :INSTALL_FAIL

:BUILD_EXE
echo ============================================================
echo   AntWordProfiler Windows .exe 빌드를 시작합니다.
echo   웹앱(npm run dev / npm run build / start.bat)은 그대로 유지됩니다.
echo ============================================================
call npm run exe:build
if errorlevel 1 goto :BUILD_FAIL

echo.
echo ============================================================
echo   빌드가 완료되었습니다!
echo   - 단일 실행 파일: release\AntWordProfiler-Portable.exe
echo   - 즉시 실행 폴더: release\win-unpacked\AntWordProfiler.exe
echo ============================================================
pause
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

:BUILD_FAIL
echo [오류] .exe 빌드 중 문제가 발생했습니다.
pause
exit /b 1