@echo off
REM ============================================================
REM  PapaTec - Sistema Loja - Instalador (Windows)
REM  Uso:  INSTALAR.bat            -> menu interativo
REM        INSTALAR.bat teste       -> instala em modo TESTE
REM        INSTALAR.bat producao    -> instala em modo PRODUCAO
REM        INSTALAR.bat status|logs|backup|licenca|parar|reset
REM ============================================================
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR.ps1" %*
set ERR=%ERRORLEVEL%

if not "%ERR%"=="0" (
    echo.
    echo O instalador terminou com erro (codigo %ERR%).
    pause
)
exit /b %ERR%
