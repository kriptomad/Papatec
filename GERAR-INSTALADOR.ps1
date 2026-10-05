# ============================================================
#  PapaTec - Gerador do instalador .exe
# ------------------------------------------------------------
#  Produz UM arquivo auto-contido:  PapaTec-Setup-vAAAA.MMDD.exe
#
#      GERAR-INSTALADOR.ps1
#
#  Como funciona (sem instalar NADA nesta maquina):
#    1. Compacta o codigo do sistema num .zip temporario
#    2. Compila o stub C# com csc.exe (nativo do Windows)
#    3. Cola o .zip no fim do .exe + um trailer de 16 bytes
#       (magic "PAPAtec" + tamanho do zip em int64)
#
#  O .exe final nao depende de .NET SDK, WiX, Inno Setup nem NSIS.
#  ============================================================

[CmdletBinding()]
param(
    [string]$Versao = '',
    [string]$Destino = ''
)

$ErrorActionPreference = 'Stop'
# Este script mora na RAIZ do projeto, entao $PSScriptRoot ja e a raiz.
$Root = $PSScriptRoot
if (-not $Root) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location -LiteralPath $Root
$InstDir = Join-Path $Root 'instalador'

if ([string]::IsNullOrWhiteSpace($Versao)) { $Versao = 'v' + (Get-Date -Format 'yyyy.MMdd') }
if ([string]::IsNullOrWhiteSpace($Destino)) { $Destino = $Root }

function Head($m) { Write-Host ''; Write-Host ">> $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "   [OK] $m" -ForegroundColor Green }
function Warn2($m) { Write-Host "   [!] $m" -ForegroundColor Yellow }
function Err($m) { Write-Host "   [ERRO] $m" -ForegroundColor Red }

# ------------------------------------------------------------- 0. pre-requisitos
Head 'VERIFICANDO O AMBIENTE DE COMPILACAO'

$csc = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $csc) {
    Err 'csc.exe (compilador C#) nao encontrado.'
    Warn2 'Este recurso vem com o .NET Framework 4.x.'
    Warn2 'Ative: Painel de Controle > Programas > Ativar ou desativar Recursos do Windows > .NET Framework 4.x'
    exit 1
}
Ok "compilador: $csc"

$srcCs = Join-Path $InstDir 'PapaTecSetup.cs'
$manif = Join-Path $InstDir 'app.manifest'
foreach ($f in @($srcCs, $manif)) {
    if (-not (Test-Path $f)) { Err "arquivo faltando: $f"; exit 1 }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
Ok 'zip disponivel (System.IO.Compression.FileSystem)'

# ------------------------------------------------------------- 1. payload
Head 'MONTANDO O PAYLOAD DO SISTEMA'

$buildDir = Join-Path $Root 'build-instalador'
if (Test-Path $buildDir) { Remove-Item $buildDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

# O que NAO viaja: dependencia reinstallada no build, dado da maquina, lixo.
$excluirDir = @(
    'node_modules', '.git', 'dist', 'build', 'coverage', '.vite', '.idea', '.vs',
    'build-instalador', 'backups', 'uploads', 'certs', 'logs'
)
$excluirFile = @(
    '.env', 'build.log', '*.log', '*.tmp', '*.bak', '*.zip', '*.iso',
    '*.msi', '*.exe', '*.pyc', 'Thumbs.db', '.DS_Store'
)

# Somente na RAIZ: script solto de depuracao (check_*.py, fix_*.py, test_*.py,
# generate*.py, write_*.py) e relatorio interno. Nao fazem parte do produto e
# so poluem a pasta do cliente. Estes nomes NAO sao excluidos dentro de
# backend/frontend/scripts, onde .py pode ser codigo legitimo do sistema.
$excluirRaiz = @(
    '*.py', 'PapaTec-Setup*', 'AUDITORIA-FORENSE.md', 'ANALISE-ESTRUTURA-SISTEMA.md',
    'GERAR-INSTALADOR.ps1'
)

$copiados = 0

function Pular-Arquivo {
    param($file)
    $rel = $file.FullName.Substring($Root.Length + 1)
    foreach ($e in $script:excluirDir) {
        if ($rel -match ('(^|\\)' + [regex]::Escape($e) + '\\')) { return $true }
    }
    foreach ($e in $script:excluirFile) {
        if ($e.StartsWith('*')) {
            if ($file.Name -like $e) { return $true }
        } elseif ($file.Name -eq $e) { return $true }
    }
    return $false
}

foreach ($d in @('backend', 'frontend', 'proxy', 'scripts', 'backup-agent', 'instalador')) {
    $p = Join-Path $Root $d
    if (-not (Test-Path $p)) { continue }
    Get-ChildItem -LiteralPath $p -Recurse -Force -File -ErrorAction SilentlyContinue |
        Where-Object { -not (Pular-Arquivo $_) } |
        ForEach-Object {
            $dest = Join-Path $script:buildDir $_.FullName.Substring($Root.Length + 1)
            $dd = Split-Path -Parent $dest
            if (-not (Test-Path $dd)) { New-Item -ItemType Directory -Force -Path $dd | Out-Null }
            Copy-Item $_.FullName $dest -Force
            $script:copiados++
        }
}

Get-ChildItem -LiteralPath $Root -File -Force | ForEach-Object {
    $pular = $false
    foreach ($e in $excluirFile) {
        if ($e.StartsWith('*')) { if ($_.Name -like $e) { $pular = $true; break } }
        elseif ($_.Name -eq $e) { $pular = $true; break }
    }
    if (-not $pular) {
        foreach ($e in $excluirRaiz) {
            if ($e.StartsWith('*')) { if ($_.Name -like $e) { $pular = $true; break } }
            elseif ($_.Name -eq $e) { $pular = $true; break }
        }
    }
    if (-not $pular) {
        Copy-Item $_.FullName (Join-Path $buildDir $_.Name) -Force
        $script:copiados++
    }
}

Ok "$copiados arquivos"

# ------------------------------------------------------------- 2. compactar
Head 'COMPACTANDO'
$zip = Join-Path $Root 'papatec-payload.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $buildDir, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

$zipLen = (Get-Item $zip).Length
Ok ("payload: {0:N2} MB" -f ($zipLen / 1MB))

# ------------------------------------------------------------- 3. compilar
Head 'COMPILANDO O STUB'

$exe = Join-Path $Destino ("PapaTec-Setup-$Versao.exe")
if (Test-Path $exe) { Remove-Item $exe -Force }

# csc.exe e antigo (C# 5): sem interpolacao de string, sem ?. e sem nameof.
# As aspas dos argumentos vao pelo formatador - usar backtick-dentro-de-string
# quebra o parser sempre que o caminho tem espaco.
$argsCsc = @(
    '/nologo'
    '/target:exe'
    '/platform:anycpu'
    '/optimize+'
    '/utf8output'
    ('/out:{0}' -f ('"' + $exe + '"'))
    ('/win32manifest:{0}' -f ('"' + $manif + '"'))
)
foreach ($r in @('System.dll', 'System.Core.dll', 'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll')) {
    $argsCsc += ('/reference:{0}' -f ('"' + $r + '"'))
}
$argsCsc += ('"' + $srcCs + '"')

$cscOut = & $csc @argsCsc 2>&1
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exe)) {
    Err 'falha ao compilar o stub:'
    $cscOut | ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
    exit 1
}
Ok ("stub compilado: {0:N0} KB" -f ((Get-Item $exe).Length / 1KB))

# ------------------------------------------------------------- 4. colar payload
Head 'JUNTANDO O PAYLOAD NO EXECUTAVEL'

$fs = [System.IO.File]::Open($exe, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write)
try {
    $bytes = [System.IO.File]::ReadAllBytes($zip)
    $magic = [System.Text.Encoding]::ASCII.GetBytes('PAPA_SET')
    $lenB = [System.BitConverter]::GetBytes([int64]$bytes.Length)

    # O trailer tem tamanho FIXO (8 + 8 = 16). Se a magic nao tiver 8 bytes
    # exatos, o .exe nao acha o payload - e o erro so aparece no cliente.
    if ($magic.Length -ne 8) { throw "magic deve ter 8 bytes (tem $($magic.Length))" }
    if ($lenB.Length -ne 8) { throw "tamanho deve ter 8 bytes (tem $($lenB.Length))" }

    $fs.Write($bytes, 0, $bytes.Length)
    $fs.Write($magic, 0, 8)
    $fs.Write($lenB, 0, 8)
} finally {
    $fs.Close()
}

Remove-Item $zip -Force -ErrorAction SilentlyContinue
Remove-Item $buildDir -Recurse -Force -ErrorAction SilentlyContinue
$finalLen = (Get-Item $exe).Length
Ok ("instalador pronto: {0:N2} MB" -f ($finalLen / 1MB))

# ------------------------------------------------------------- 5. conferir
Head 'CONFERINDO'

$problems = 0
$fs = [System.IO.File]::OpenRead($exe)
try {
    # Seek devolve a nova posicao (long). Sem [void] o PowerShell imprime o
    # numero no meio do relatorio.
    [void]$fs.Seek(-16, [System.IO.SeekOrigin]::End)
    $tr = New-Object byte[] 16
    [void]$fs.Read($tr, 0, 16)
    $m = [System.Text.Encoding]::ASCII.GetString($tr, 0, 8)
    $z = [System.BitConverter]::ToInt64($tr, 8)
    if ($m -eq 'PAPA_SET') { Ok "trailer OK (magic + $z bytes de payload)" }
    else { Err "trailer invalido: magic='$m' (esperado 'PAPA_SET')"; $problems++ }

    [void]$fs.Seek($finalLen - 16 - $z, [System.IO.SeekOrigin]::Begin)
    $sig = New-Object byte[] 2
    [void]$fs.Read($sig, 0, 2)
    if ($sig[0] -eq 0x50 -and $sig[1] -eq 0x4B) { Ok 'payload comeca com assinatura ZIP (PK)' }
    else { Err 'payload nao parece um ZIP'; $problems++ }
} finally { $fs.Close() }

try {
    $head = [System.IO.File]::ReadAllBytes($exe)
    if ($head[0] -eq 0x4D -and $head[1] -eq 0x5A) { Ok 'assinatura PE (MZ) intacta' }
    else { Err 'assinatura PE comprometida'; $problems++ }
} catch { Err "nao consegui ler o exe: $_"; $problems++ }

Head 'INSTALADOR GERADO'
Write-Host "   Arquivo : $exe" -ForegroundColor White
Write-Host '   Como usar: copie para a maquina do cliente e de duplo clique.' -ForegroundColor White
Write-Host '   (o Windows pede confirmacao de administrador)' -ForegroundColor DarkGray
Write-Host ''
Write-Host '   SEM INTERNET? Deixe o DockerDesktopInstaller.exe oficial ao lado do' -ForegroundColor Yellow
Write-Host '   PapaTec-Setup.exe: o passo "Preparar a maquina" usa o arquivo local.' -ForegroundColor Yellow

if ($problems -gt 0) { exit 1 }