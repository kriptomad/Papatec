@echo off
REM ============================================================
REM  PapaTec - Sistema Loja - DEV LOCAL (Node na maquina)
REM  Uso:  DEV-LOCAL.bat            -> banco + API + SPA
REM        DEV-LOCAL.bat -Seed      -> idem, com dados de exemplo
REM        DEV-LOCAL.bat -Parar     -> encerra API e SPA
REM ============================================================
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DEV-LOCAL.ps1" %*
set ERR=%ERRORLEVEL%

if not "%ERR%"=="0" (
    echo.
    echo DEV-LOCAL terminou com erro (codigo %ERR%).
    pause
)
exit /b %ERR%
