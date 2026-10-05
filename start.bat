@echo off
REM ============================================================
REM  PapaTec - Sistema Loja - Inicializador rapido para Windows
REM  Requer Docker Desktop com Docker Compose v2
REM ============================================================

cd /d "%~dp0"

echo ========================================
echo   PapaTec - Sistema Loja - Inicializador Windows
echo ========================================
echo.

where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo ERRO: Docker nao encontrado!
    echo Instale o Docker Desktop: https://docker.com/products/docker-desktop
    pause
    exit /b 1
)

docker compose version >nul 2>nul
if %errorlevel% neq 0 (
    echo ERRO: Docker Compose v2 nao encontrado! Atualize o Docker Desktop.
    pause
    exit /b 1
)

echo [OK] Docker e Docker Compose encontrados
echo.

if not exist ".env" (
    echo [ERRO] Arquivo .env nao encontrado!
    echo O .env ja acompanha o pacote do sistema e contem o
    echo LICENSE_PUBLIC_KEY_B64 - restaure-o de uma copia do pacote
    echo ou contate a Filitech: licenca@filitech.com.br
    echo.
    echo (recriar do zero: copie .env.example para .env, preencha
    echo  DB_PASSWORD, JWT_SECRET e solicite o LICENSE_PUBLIC_KEY_B64)
    echo.
    pause
    exit /b 1
)

rem Verifica se o LICENSE_PUBLIC_KEY_B64 veio preenchido
set "KEYOK="
for /f "usebackq tokens=1,* delims==" %%A in (`findstr /b /c:"LICENSE_PUBLIC_KEY_B64=" ".env"`) do (
    if not "%%B"=="" set "KEYOK=1"
)
if not defined KEYOK (
    echo [ERRO] LICENSE_PUBLIC_KEY_B64 vazio no .env!
    echo Sem essa chave o ERP sobe, porem TODAS as rotas serao
    echo bloqueadas com 403. Solicite o valor a Filitech:
    echo   licenca@filitech.com.br
    echo.
    pause
    exit /b 1
)

rem Avisa se ainda restam valores de exemplo
findstr /c:"TROQUE_POR_SENHA" ".env" >nul 2>nul
if not errorlevel 1 (
    echo [AVISO] O .env ainda contem valores de exemplo!
    echo Edite DB_PASSWORD e JWT_SECRET antes de subir o sistema.
    echo.
    pause
)

echo Selecione uma opcao:
echo.
echo   1 - Iniciar Producao (build + up)
echo   2 - Iniciar Desenvolvimento (hot reload)
echo   3 - Parar tudo
echo   4 - Status dos containers
echo   5 - Logs da API
echo   6 - Logs de todos os servicos
echo   7 - Abrir o sistema no navegador
echo   8 - Resetar banco (CUIDADO!)
echo   0 - Sair
echo.

set /p choice="Opcao: "

if "%choice%"=="1" (
    echo [INFO] Subindo em modo PRODUCAO...
    docker compose up -d --build
    echo.
    echo Sistema:     https://localhost
    echo Ativacao:    https://localhost/activate
    echo API:         https://localhost/api/health
    echo
    echo Obs: aceite o certificado auto-assinado do navegador.
    pause
) else if "%choice%"=="2" (
    echo [INFO] Subindo em modo DESENVOLVIMENTO...
    docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
    echo.
    echo Frontend (Vite): http://localhost:5173
    echo Backend API:     http://localhost:3001
    pause
) else if "%choice%"=="3" (
    echo [INFO] Parando containers...
    docker compose down
    pause
) else if "%choice%"=="4" (
    docker compose ps
    pause
) else if "%choice%"=="5" (
    docker compose logs -f api
) else if "%choice%"=="6" (
    docker compose logs -f
) else if "%choice%"=="7" (
    start "" "https://localhost"
) else if "%choice%"=="8" (
    echo.
    echo ATENCAO: Isso vai APAGAR TODOS OS DADOS DO BANCO!
    set /p confirm="Digite SIM para confirmar: "
    if "%confirm%"=="SIM" (
        docker compose down -v
        echo Banco resetado.
    ) else (
        echo Operacao cancelada.
    )
    pause
) else if "%choice%"=="0" (
    exit /b 0
) else (
    echo Opcao invalida!
    pause
)
