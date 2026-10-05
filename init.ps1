<# 
.SYNOPSIS
    Script de inicialização do PapaTec - Sistema Loja para Windows

.DESCRIPTION
    Verifica o ambiente, valida o .env, gera certificados locais (opcional)
    e sobe os containers com Docker Compose v2.

.NOTES
    Execute como Administrador se as portas 80/443 estiverem bloqueadas.
    A licença é emitida pela FILITECH: informe o Hardware ID (tela
    /activate) e receba o token de ativação por e-mail.
#>

param(
    [switch]$DevMode,
    [switch]$SkipBuild,
    [switch]$ResetDB
)

$ErrorActionPreference = "Stop"
$ProjectPath = "C:\Users\User\Documents\Filitech Projects\PapaTec ERP"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PapaTec - Sistema Loja - Inicializador Windows" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------- Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker não encontrado! Instale o Docker Desktop primeiro."
    exit 1
}

try {
    docker compose version | Out-Null
} catch {
    Write-Error "Docker Compose v2 não encontrado! Atualize o Docker Desktop."
    exit 1
}

Write-Host "✓ Docker e Docker Compose encontrados" -ForegroundColor Green

Set-Location $ProjectPath

# ---------------------------------------------------------------- .env
if (-not (Test-Path ".env")) {
    Write-Host "Criando .env com senhas seguras automaticamente..." -ForegroundColor Yellow
    $template = Get-Content ".env.example" -Raw
    $rnd = { -join ((48..110) | ForEach-Object { [char](Get-Random -Minimum 65 -Maximum 122) }) }
    $template = $template -replace '(?m)^DB_PASSWORD=.*$', ("DB_PASSWORD=" + (& $rnd))
    $template = $template -replace '(?m)^JWT_SECRET=.*$', ("JWT_SECRET=" + (& $rnd))
    [System.IO.File]::WriteAllText((Join-Path $PWD ".env"), $template, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "✓ .env criado (DB_PASSWORD e JWT_SECRET gerados)." -ForegroundColor Green
    Read-Host "Pressione Enter para continuar..."
}

$envContent = Get-Content ".env" -Raw
if ($envContent -notmatch 'LICENSE_PUBLIC_KEY_B64=\S') {
    Write-Host "⚠️  LICENSE_PUBLIC_KEY_B64 está vazio no .env" -ForegroundColor Red
    Write-Host "   Solicite o valor correto a Filitech: licenca@filitech.com.br" -ForegroundColor Red
    Write-Host "   Sem essa chave o sistema bloqueia as rotas com 403 DRM." -ForegroundColor Yellow
}
if ($envContent -match 'TROQUE_POR_SENHA') {
    Write-Host "⚠️  O .env ainda contém valores de exemplo (DB_PASSWORD/JWT_SECRET)." -ForegroundColor Red
    Write-Host "   Edite o arquivo .env e troque esses dois valores antes de subir." -ForegroundColor Yellow
}

# ---------------------------------------------------------------- Pastas
foreach ($dir in @("uploads", "backups", "certs")) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Write-Host "✓ Pasta criada: ./$dir" -ForegroundColor Green
    }
}

# ---------------------------------------------------------------- Certificados
if (-not (Test-Path "certs/localhost.crt")) {
    if (Get-Command mkcert -ErrorAction SilentlyContinue) {
        Write-Host "Gerando certificados SSL locais (mkcert)..." -ForegroundColor Yellow
        mkcert -install
        mkcert -cert-file certs/localhost.crt -key-file certs/localhost.key localhost 127.0.0.1 ::1
        Write-Host "✓ Certificados gerados em ./certs/" -ForegroundColor Green
    } else {
        Write-Host "ℹ mkcert não instalado: o próprio container 'proxy' gera" -ForegroundColor Gray
        Write-Host "  automaticamente um certificado auto-assinado na primeira subida." -ForegroundColor Gray
    }
}

# ---------------------------------------------------------------- Build/Up
$composeArgs = @()
if ($DevMode) {
    $composeArgs += @("-f", "docker-compose.yml", "-f", "docker-compose.dev.yml")
    Write-Host "Modo DESENVOLVIMENTO ativado (hot reload)" -ForegroundColor Cyan
}

if (-not $SkipBuild) {
    Write-Host "Fazendo build dos containers..." -ForegroundColor Yellow
    docker compose @composeArgs build
}

if ($ResetDB) {
    Write-Host "⚠️  RESETANDO BANCO DE DADOS (apagando volumes)!" -ForegroundColor Red
    $confirm = Read-Host "Tem certeza? Digite 'SIM' para confirmar"
    if ($confirm -eq 'SIM') {
        docker compose @composeArgs down -v
    } else {
        Write-Host "Reset cancelado." -ForegroundColor Yellow
    }
}

Write-Host "Subindo containers..." -ForegroundColor Yellow
docker compose @composeArgs up -d

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PapaTec - Sistema Loja INICIADO!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📱 Sistema:   https://localhost" -ForegroundColor Cyan
Write-Host "🔑 Ativação:  https://localhost/activate" -ForegroundColor Cyan
Write-Host "❤️  Health:    https://localhost/api/health" -ForegroundColor Cyan
Write-Host ""
Write-Host "Primeiro acesso:" -ForegroundColor Yellow
Write-Host "1. Abra https://localhost/activate e copie o HARDWARE ID" -ForegroundColor White
Write-Host "2. Envie esse Hardware ID + nome da empresa para licenca@filitech.com.br" -ForegroundColor White
Write-Host "3. Cole o token recebido na tela de ativacao -> Ativar" -ForegroundColor White
Write-Host "4. Abra https://localhost/login e crie o primeiro administrador" -ForegroundColor White
Write-Host ""
Write-Host "Comandos úteis:" -ForegroundColor Gray
Write-Host "  Status:   docker compose ps" -ForegroundColor Gray
Write-Host "  Logs API: docker compose logs -f api" -ForegroundColor Gray
Write-Host "  Parar:    docker compose down" -ForegroundColor Gray
Write-Host "  Backup:   painel do admin -> Configurações -> Backup" -ForegroundColor Gray
Write-Host ""
Write-Host "Documentação completa: INSTALACAO-CONFIGURACAO.txt" -ForegroundColor Gray
