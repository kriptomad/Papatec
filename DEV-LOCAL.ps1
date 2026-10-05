# ============================================================
#  PapaTec - Sistema Loja
#  DEV LOCAL - API + SPA rodando em Node na sua maquina
# ------------------------------------------------------------
#  Uso:
#    DEV-LOCAL.bat            sobe banco (Docker) + API + SPA
#    DEV-LOCAL.bat -Seed      igual, mas recarrega os dados de exemplo
#    DEV-LOCAL.bat -Parar     encerra API (3001) e SPA (5173)
#
#  O que faz:
#    - le o .env da raiz (banco, JWT e chave da licenca)
#    - sobe so o PostgreSQL em Docker (ou usa um PG local)
#    - aplica as migracoes e, com -Seed, os dados de exemplo
#    - abre 2 janelas: API (ts-node-dev) e SPA (Vite) com hot-reload
#
#  Enderecos:  API http://localhost:3001/api/health
#              SPA http://localhost:5173
# ============================================================
[CmdletBinding()]
param(
    [switch]$Seed,
    [switch]$Parar
)

$ErrorActionPreference = 'Continue'
$Root = $PSScriptRoot
Set-Location -LiteralPath $Root
$EnvFile = Join-Path $Root '.env'

function Say([string]$m, [string]$c = 'White') { Write-Host $m -ForegroundColor $c }
function Ok([string]$m) { Write-Host "   [OK] $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "   [!] $m" -ForegroundColor Yellow }
function Err([string]$m) { Write-Host "   [ERRO] $m" -ForegroundColor Red }

function Stop-Port([int]$port) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        try {
            $p = Get-Process -Id $c.OwningProcess -ErrorAction Stop
            if ($p.ProcessName -match 'node') {
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
                Ok "porta $port encerrada (PID $($p.Id))"
            }
        } catch { }
    }
}

if ($Parar) {
    Say 'Encerrando API (3001) e SPA (5173)...' Cyan
    Stop-Port 3001
    Stop-Port 5173
    Say 'Pronto. O banco em Docker permanece de pe (docker compose stop db).' DarkGray
    exit 0
}

# ------------------------------------------------------------ pre-requisitos
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Err 'Node.js 20+ nao encontrado nesta maquina.'
    Say '   Instale em https://nodejs.org  (ou use INSTALAR.bat teste, que roda tudo em Docker).' Yellow
    exit 1
}
if (-not (Test-Path $EnvFile)) {
    Err 'Arquivo .env nao encontrado na raiz do projeto.'
    Say '   Rode o INSTALAR.bat uma vez (gera o .env) ou copie .env.example para .env.' Yellow
    exit 1
}

# ------------------------------------------------------------ le o .env
$vals = @{}
foreach ($line in (Get-Content $EnvFile)) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        $vals[$Matches[1]] = $Matches[2].Trim()
    }
}
$dbName = if ($vals['DB_NAME']) { $vals['DB_NAME'] } else { 'papatec' }
$dbUser = if ($vals['DB_USER']) { $vals['DB_USER'] } else { 'papatec' }
$dbPass = $vals['DB_PASSWORD']

if (-not $dbPass -or $dbPass -like '*TROQUE*') {
    Err 'DB_PASSWORD ainda esta com o valor de exemplo. Rode o INSTALAR.bat (opcao 1 ou 2) ou edite o .env.'
    exit 1
}
if (-not $vals['LICENSE_PUBLIC_KEY_B64']) {
    Err 'LICENSE_PUBLIC_KEY_B64 vazio no .env.'
    exit 1
}

# Variaveis para os processos filhos
$env:DB_NAME = $dbName
$env:DB_USER = $dbUser
$env:DB_PASSWORD = $dbPass
$env:JWT_SECRET = $vals['JWT_SECRET']
$env:JWT_EXPIRES_IN = if ($vals['JWT_EXPIRES_IN']) { $vals['JWT_EXPIRES_IN'] } else { '7d' }
$env:LICENSE_PUBLIC_KEY_B64 = $vals['LICENSE_PUBLIC_KEY_B64']
$env:PORT = '3001'
$env:DATABASE_URL = "postgresql://${dbUser}:${dbPass}@localhost:5432/${dbName}?schema=public"
$env:BACKUP_NETWORK_PATH = if ($vals['BACKUP_NETWORK_PATH']) { $vals['BACKUP_NETWORK_PATH'] } else { (Join-Path $Root 'backups') }
$env:BACKUP_SCHEDULE = if ($vals['BACKUP_SCHEDULE']) { $vals['BACKUP_SCHEDULE'] } else { '0 12,18 * * *' }
$env:UPLOADS_PATH = Join-Path $Root 'uploads'

foreach ($d in 'uploads', 'backups') {
    if (-not (Test-Path (Join-Path $Root $d))) { New-Item -ItemType Directory -Force -Path (Join-Path $Root $d) | Out-Null }
}

# ------------------------------------------------------------ banco de dados
$useDocker = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
    & docker info 2>&1 | Out-Null
    $useDocker = ($LASTEXITCODE -eq 0)
}

if ($useDocker) {
    # O docker compose precisa escrever direto no console: pipar o stdout (| Out-Host)
    # aciona a regressao do Compose 5.5.1 -> "failed to get console: Identificador invalido".
    function Invoke-Db([string[]]$composeArgs) {
        $argv = @('compose', '-f', '"' + (Join-Path $Root 'docker-compose.yml') + '"') + $composeArgs
        try {
            $proc = Start-Process -FilePath 'docker' -ArgumentList $argv -NoNewWindow -Wait -PassThru
            return [int]$proc.ExitCode
        } catch {
            Err "falha ao executar docker compose: $($_.Exception.Message)"
            return 1
        }
    }

    Write-Host ''
    Say '1/4 Subindo o PostgreSQL em Docker (porta 5432)...' Cyan
    Invoke-Db -composeArgs @('up', '-d', 'db') | Out-Null
    $okDb = $false
    for ($i = 0; $i -lt 30; $i++) {
        & docker compose -f (Join-Path $Root 'docker-compose.yml') exec -T db `
            pg_isready -U $dbUser -d $dbName 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $okDb = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $okDb) { Err 'PostgreSQL nao respondeu. Veja: docker compose logs db'; exit 1 }
    Ok 'PostgreSQL pronto'
} else {
    Warn 'Docker nao disponivel - assumindo PostgreSQL local rodando em localhost:5432'
    Warn 'Confira se o banco "$dbName" e o usuario "$dbUser" existem.'
}

Write-Host ''
Say '2/4 Dependencias do backend (npm install se necessario)...' Cyan
if (-not (Test-Path (Join-Path $Root 'backend\node_modules'))) {
    Push-Location (Join-Path $Root 'backend'); npm install; Pop-Location
}
if (-not (Test-Path (Join-Path $Root 'frontend\node_modules'))) {
    Push-Location (Join-Path $Root 'frontend'); npm install; Pop-Location
}
Ok 'node_modules ok'

Write-Host ''
Say '3/4 Migracoes do banco...' Cyan
Push-Location (Join-Path $Root 'backend')
npx prisma migrate deploy
$mig = $LASTEXITCODE
if ($mig -ne 0) {
    Pop-Location
    Err 'prisma migrate deploy falhou (confira DATABASE_URL/senha).'
    exit 1
}
Ok 'migracoes aplicadas'

if ($Seed) {
    Say '     Recarregando dados de exemplo (-Seed)...' Cyan
    npm run seed
} else {
    Say '     (use -Seed para criar peças/servicos/cliente de exemplo)' DarkGray
}
Pop-Location

# ------------------------------------------------------------ servidores
Write-Host ''
Say '4/4 Subindo API e SPA (cada uma em sua janela)...' Cyan

$backendDir = Join-Path $Root 'backend'
$frontendDir = Join-Path $Root 'frontend'

Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "`$Host.UI.RawUI.WindowTitle='PapaTec API (3001)'; Set-Location '$backendDir'; npm run dev"
)
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "`$Host.UI.RawUI.WindowTitle='PapaTec SPA (5173)'; Set-Location '$frontendDir'; npm run dev"
)

# aguarda a API responder
$deadline = (Get-Date).AddSeconds(90)
Write-Host -NoNewline '   aguardando http://localhost:3001/api/health '
$up = $false
while ((Get-Date) -lt $deadline) {
    $code = (& curl.exe -s -o NUL -w '%{http_code}' --max-time 5 'http://localhost:3001/api/health' 2>$null) -join ''
    if ($code -eq '200') { $up = $true; break }
    Write-Host -NoNewline '.'
    Start-Sleep -Seconds 3
}
Write-Host ''

if (-not $up) {
    Warn 'A API ainda nao respondeu - veja a janela "PapaTec API".'
} else {
    Ok 'API no ar'
    $st = (& curl.exe -s --max-time 10 'http://localhost:3001/api/license/status' 2>$null) -join ''
    if ($st -notlike '*"isLicensed":true*') {
        Say '   Sem licenca: abra http://localhost:5173/activate e cole o token.' Yellow
    }
}

Say ''
Say '   API  : http://localhost:3001/api/health' White
Say '   SPA  : http://localhost:5173' White
Say '   Parar: DEV-LOCAL.bat -Parar' DarkGray
Start-Process 'http://localhost:5173'
