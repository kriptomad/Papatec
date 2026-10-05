# ============================================================
#  PapaTec - Sistema Loja
#  INSTALADOR / MENU DE OPERACOES (Windows + Docker)
# ------------------------------------------------------------
#  Uso:
#    INSTALAR.bat                -> menu interativo
#    INSTALAR.bat teste          -> instala em modo TESTE (dev)
#    INSTALAR.bat producao       -> instala em modo PRODUCAO
#    INSTALAR.bat status|logs|backup|licenca|parar|reset
#
#  Requisitos: Docker Desktop 24+ com plugin "docker compose"
# ============================================================
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('menu', 'preparar', 'teste', 'producao', 'status', 'logs', 'backup', 'licenca', 'parar', 'iniciar', 'atualizar', 'verificar', 'reset')]
    [string]$Opcao = 'menu'
)

$ErrorActionPreference = 'Continue'
$Root = $PSScriptRoot
Set-Location -LiteralPath $Root
$EnvFile = Join-Path $Root '.env'

# ------------------------------------------------------------ helpers visuais
function Say([string]$m, [string]$c = 'White') { Write-Host $m -ForegroundColor $c }
function Head([string]$m) { Write-Host ''; Write-Host ">> $m" -ForegroundColor Cyan }
function Ok([string]$m) { Write-Host "   [OK] $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "   [!] $m" -ForegroundColor Yellow }
function Err([string]$m) { Write-Host "   [ERRO] $m" -ForegroundColor Red }

function New-Secret([int]$n = 32) {
    $b = New-Object byte[] $n
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($b)
    (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}

# ------------------------------------------------------------ pre-requisitos

# URLs oficiais do Docker Desktop (canal estavel).
$DockerInstallerUrl = 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe'

<#
  Instala o Docker Desktop quando ele nao existe na maquina.
  Ordem: winget (gerencia versao/updates) -> download direto do instalador
  oficial. Em ambos o `-accept-license` e obrigatorio: sem ele o instalador
  fica esperando aceite interactivo e a instalacao automatica trava.
#>
function Install-DockerDesktop {
    Head 'DOCKER NAO ENCONTRADO - INSTALANDO DOCKER DESKTOP'
    Warn 'Este passo baixa ~600 MB e pode levar 10-15 minutos.'

    $installed = $false

    # ---- 1) winget
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Say '   Tentando via winget...' DarkGray
        try {
            & winget install -e --id Docker.DockerDesktop `
                --accept-package-agreements --accept-source-agreements --silent 2>&1 |
                Out-String | Write-Host
            $installed = ($LASTEXITCODE -eq 0)
        } catch { $installed = $false }
        if ($installed) { Ok 'Docker Desktop instalado via winget.' }
    }

    # ---- 2) instalador oficial
    if (-not $installed) {
        Say '   Baixando o instalador oficial do Docker Desktop...' Cyan
        $tmp = Join-Path $env:TEMP 'DockerDesktopInstaller.exe'
        try {
            $ProgressPreference = 'SilentlyContinue'
            Invoke-WebRequest -Uri $DockerInstallerUrl -OutFile $tmp -UseBasicParsing -TimeoutSec 900
            Ok ("instalador baixado ({0:N0} MB)" -f ((Get-Item $tmp).Length / 1MB))

            Say '   Instalando (pode demorar varios minutos)...' Cyan
            # --quiet + --accept-license sao obrigatorios: sem o segundo o
            # instalador abre uma janela de aceite e trava o script.
            $p = Start-Process -FilePath $tmp `
                -ArgumentList 'install', '--quiet', '--accept-license', '--backend=wsl-2' `
                -Wait -PassThru
            if ($p.ExitCode -eq 0 -or $p.ExitCode -eq 3010) {
                $installed = $true
                Ok 'Docker Desktop instalado.'
            } else {
                Err "instalador retornou codigo $($p.ExitCode)"
            }
        } catch {
            Err "falha ao baixar/instalar: $($_.Exception.Message)"
        } finally {
            Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        }
    }

    if (-not $installed) {
        Err 'Nao foi possivel instalar o Docker Desktop automaticamente.'
        Say '   Baixe manualmente: https://www.docker.com/products/docker-desktop/' Yellow
        Say '  ou: winget install -e --id Docker.DockerDesktop' Yellow
        return $false
    }

    Warn 'REINICIE O Windows antes de continuar (o Docker Desktop exige isso).'
    Warn 'Depois de reiniciar, abra o Docker Desktop e rode o INSTALAR.bat de novo.'
    return $false   # nao segue nesta sessao: o Docker so funciona apos reiniciar
}

function Test-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        return (Install-DockerDesktop)
    }
    & docker compose version 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Err 'Plugin "docker compose" (v2) nao encontrado.'
        Say '   Atualize o Docker Desktop (Settings > Software updates) ou reinstale.' Yellow
        return $false
    }
    & docker info 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Err 'O daemon do Docker nao esta rodando.'
        Say '   Abra o Docker Desktop e aguarde a baleia ficar verde.' Yellow
        return $false
    }
    return $true
}

# Libera a pasta do projeto no File Sharing do Docker Desktop.
# Sem isso os bind mounts (./uploads ./backups ./logs ./certs ./nginx.conf)
# falham com: the path "..." is not shared from the host.
function Ensure-FileSharing {
    $store = Join-Path $env:APPDATA 'Docker\settings-store.json'
    if (-not (Test-Path $store)) { return }   # sem Docker Desktop local: nada a fazer

    try {
        $json = [System.IO.File]::ReadAllText($store) | ConvertFrom-Json

        $prop = @('filesharingDirectories', 'FilesharingDirectories') |
            Where-Object { $json.PSObject.Properties.Name -contains $_ } | Select-Object -First 1
        if (-not $prop) {
            Warn 'Docker Desktop nao expôs a lista de pastas compartilhadas (versao nova?).'
            Warn 'Rode:  INSTALAR.bat verificar   e siga a dica de File Sharing se aparecer.'
            return
        }

        $dirs = @($json.$prop)
        $target = ([string]$Root).TrimEnd('\')
        foreach ($d in $dirs) {
            $dn = ([string]$d).TrimEnd('\')
            if (-not $dn) { continue }
            if ($target.StartsWith($dn, [System.StringComparison]::OrdinalIgnoreCase) -and
                ($target.Length -eq $dn.Length -or $target[$dn.Length] -eq '\')) {
                return   # ja liberada
            }
        }

        $json.$prop = @($dirs + $Root)
        [System.IO.File]::WriteAllText($store, ($json | ConvertTo-Json -Depth 20),
            (New-Object System.Text.UTF8Encoding($false)))
        Ok 'pasta do projeto adicionada ao File Sharing do Docker Desktop'
        Warn 'O Docker Desktop precisa reiniciar para aplicar. Feche e abra o Docker Desktop.'
    } catch {
        Warn "nao consegui ajustar o File Sharing: $($_.Exception.Message)"
    }
}

# Define (ou atualiza) uma chave dentro do texto do .env.
function Set-EnvValue([string]$text, [string]$name, [string]$value) {
    if ([regex]::IsMatch($text, "(?m)^$name=.*$")) {
        return [regex]::Replace($text, "(?m)^$name=.*$", "$name=$value")
    }
    return ($text.TrimEnd() + [Environment]::NewLine + "$name=$value" + [Environment]::NewLine)
}

# ------------------------------------------------------------ .env e pastas
function Ensure-Env {
    if (-not (Test-Path $EnvFile)) {
        $ex = Join-Path $Root '.env.example'
        if (-not (Test-Path $ex)) { Err 'Arquivo .env.example nao encontrado.'; return $false }
        Copy-Item $ex $EnvFile -Force
        Ok '.env criado a partir de .env.example'
    }

    $text = [System.IO.File]::ReadAllText($EnvFile)
    $changed = $false

    foreach ($name in 'DB_PASSWORD', 'JWT_SECRET') {
        $m = [regex]::Match($text, "(?m)^$name=(.*)$")
        if (-not $m.Success) { continue }
        $val = $m.Groups[1].Value.Trim()
        if (-not $val -or $val -like '*TROQUE*' -or $val -like '*cole_aqui*') {
            $text = [regex]::Replace($text, "(?m)^$name=.*$", "$name=$(New-Secret)")
            $changed = $true
            Ok "$name gerado automaticamente (valor aleatorio de 64 caracteres)"
        }
    }

    # ---- Identificacao da maquina (HWID do DRM) ------------------------
    # O backend roda em container Linux, onde nao existem wmic/getmac. Sem
    # o UUID/MAC lidos aqui no host, o HWID cairia no fallback e ficaria
    # IGUAL em todas as maquinas - anulando a amarracao da licenca ao
    # hardware. Por isso lemos direto do Windows e gravamos no .env.
    $uVal = [regex]::Match($text, '(?m)^MACHINE_UUID=(.*)$').Groups[1].Value.Trim()
    $mVal = [regex]::Match($text, '(?m)^MACHINE_MAC=(.*)$').Groups[1].Value.Trim()
    if (-not $uVal -or -not $mVal) {
        $uuid = ''; $mac = ''
        try { $uuid = ([string](Get-CimInstance Win32_ComputerSystemProduct -ErrorAction Stop).UUID).Trim() } catch { $uuid = '' }
        try {
            $nics = @(Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=True' -ErrorAction Stop |
                Where-Object { $_.MACAddress -and ($_.MACAddress -notmatch '^(00-15-5D|00-0D-3A|00-00-00-00-00-00)') })
            if ($nics.Count -gt 0) { $mac = ([string]$nics[0].MACAddress).Trim() }
        } catch { $mac = '' }

        if ($uuid -match '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' -and
            $mac -match '^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$') {
            $text = Set-EnvValue $text 'MACHINE_UUID' $uuid
            $text = Set-EnvValue $text 'MACHINE_MAC' $mac
            $changed = $true
            Ok 'Identificacao da maquina gravada no .env (base do HWID/DRM)'
        } else {
            Warn 'UUID/MAC desta maquina nao puderam ser lidos (HWID usara o nome do computador).'
        }
    }

    if ($changed) {
        [System.IO.File]::WriteAllText($EnvFile, $text, (New-Object System.Text.UTF8Encoding($false)))
    }

    $key = [regex]::Match($text, '(?m)^LICENSE_PUBLIC_KEY_B64=(.*)$').Groups[1].Value.Trim()
    if (-not $key) {
        Err 'LICENSE_PUBLIC_KEY_B64 vazio no .env'
        Say '   Sem essa chave o sistema sobe bloqueado (403 DRM).' Yellow
        Say '   Solicite o valor a Filitech: licenca@filitech.com.br' Yellow
        return $false
    }
    return $true
}

function Ensure-Folders {
    foreach ($d in 'uploads', 'backups', 'certs') {
        $p = Join-Path $Root $d
        if (-not (Test-Path $p)) {
            New-Item -ItemType Directory -Force -Path $p | Out-Null
            Ok "pasta .\$d criada"
        }
    }
}

# ------------------------------------------------------------ docker compose
function Get-Mode {
    $ports = ((& docker ps --filter 'name=papatec-web' --format '{{.Ports}}' 2>$null) -join ' ')
    if ($ports -like '*5173*') { return 'teste' }
    return 'producao'
}

function Get-Base([string]$m) {
    if ($m -eq 'teste') { return 'http://localhost:3001' }
    return 'https://localhost'
}

function Get-SpaUrl([string]$m) {
    if ($m -eq 'teste') { return 'http://localhost:5173' }
    return 'https://localhost'
}

function Invoke-Compose([string]$m, [string[]]$rest) {
    $ca = @('-f', (Join-Path $Root 'docker-compose.yml'))
    if ($m -eq 'teste') { $ca += @('-f', (Join-Path $Root 'docker-compose.dev.yml')) }

    # IMPORTANTE: o docker compose precisa escrever direto no console.
    # Encaminhar a saida pelo pipeline do PowerShell (| Out-Host) redireciona o
    # stdout e aciona a regressao do Docker Compose 5.5.1:
    #   "failed to get console: Identificador invalido." -> build abortado.
    # Start-Process -NoNewWindow herda o console real (sem pipe em nenhum fluxo),
    # o progresso sai colorido e o exit code chega limpo na funcao.
    $argv = @('compose') + $ca + $rest
    for ($i = 0; $i -lt $argv.Count; $i++) {
        if ($argv[$i] -match '\s' -and $argv[$i] -notlike '"*') { $argv[$i] = '"' + $argv[$i] + '"' }
    }
    try {
        $proc = Start-Process -FilePath 'docker' -ArgumentList $argv -NoNewWindow -Wait -PassThru
        return [int]$proc.ExitCode
    } catch {
        Err "falha ao executar 'docker compose $($rest -join ' ')': $($_.Exception.Message)"
        return 1
    }
}

# ------------------------------------------------------------ HTTP (via curl)
function Invoke-Api([string]$method, [string]$url, $body = $null, [string]$token = $null) {
    $tmp = $null
    $a = @('-s', '-k', '--max-time', '60', '-X', $method)
    if ($null -ne $body) {
        $tmp = [System.IO.Path]::GetTempFileName()
        $json = $body | ConvertTo-Json -Compress -Depth 6
        [System.IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
        $a += @('-H', 'Content-Type: application/json', "-d@$tmp")
    }
    if ($token) { $a += @('-H', "Authorization: Bearer $token") }
    $a += $url
    $raw = (& curl.exe @a 2>$null) -join ''
    if ($tmp -and (Test-Path $tmp)) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    try { return ($raw | ConvertFrom-Json) } catch { return $null }
}

function Wait-Api([string]$url, [int]$timeout = 300) {
    $deadline = (Get-Date).AddSeconds($timeout)
    Write-Host -NoNewline "   aguardando $url "
    while ((Get-Date) -lt $deadline) {
        $code = (& curl.exe -s -o NUL -w '%{http_code}' -k --max-time 5 $url 2>$null) -join ''
        if ($code -eq '200') { Write-Host ' OK' -ForegroundColor Green; return $true }
        Write-Host -NoNewline '.'
        Start-Sleep -Seconds 3
    }
    Write-Host ' TIMEOUT' -ForegroundColor Red
    return $false
}

# ------------------------------------------------------------ licenca
function Get-LicenseStatus([string]$base) {
    $st = Invoke-Api 'GET' "$base/api/license/status"
    if (-not $st -or $null -eq $st.data) { Warn 'API de licenca indisponivel.'; return $null }
    if ($st.data.isLicensed) {
        Ok "Licenca ATIVA - HWID: $($st.data.hardwareId)"
    } else {
        Warn "Sem licenca ativa - HWID desta maquina: $($st.data.hardwareId)"
        Say '   Solicite o token a Filitech: licenca@filitech.com.br (informe o HWID acima).' Yellow
    }
    return $st
}

function Request-Token([string]$base) {
    Head 'ATIVACAO DA LICENCA'
    Say '   Cole o token de licenca (linha unica que comeca com "eyJ...").' White
    $token = Read-Host '   Token (Enter para pular)'
    if (-not $token) { Warn 'Ativacao pulada.'; return $false }
    $r = Invoke-Api 'POST' "$base/api/license/activate" @{ token = $token.Trim() }
    if ($r -and $r.success) { Ok 'Licenca ATIVADA com sucesso.'; return $true }
    $msg = if ($r -and $r.error) { $r.error.message } else { 'sem resposta da API' }
    Err "Falha ao ativar: $msg"
    return $false
}

# ------------------------------------------------------------ file sharing (Docker Desktop)
# Bind mounts (./uploads, ./backups e o conteudo da pasta do projeto) exigem que a pasta
# esteja em Docker Desktop > Settings > Resources > File Sharing. Sem isso o compose falha
# com: the path "..." is not shared from the host.
function Test-ProjectShared {
    try {
        $p = Join-Path $env:APPDATA 'Docker\settings-store.json'
        if (-not (Test-Path $p)) { return $true }   # sem settings locais: deixa o compose decidir
        $j = [System.IO.File]::ReadAllText($p) | ConvertFrom-Json
        $dirs = @()
        foreach ($k in @('FilesharingDirectories', 'filesharingDirectories')) {
            if ($j.PSObject.Properties.Name -contains $k) { $dirs = @($j.$k); break }
        }
        if ($dirs.Count -eq 0) { return $false }
        $rootFull = ([string]$Root).TrimEnd('\')
        foreach ($d in $dirs) {
            $dn = ([string]$d).TrimEnd('\')
            if (-not $dn) { continue }
            if (-not $rootFull.StartsWith($dn, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
            if ($rootFull.Length -eq $dn.Length -or $rootFull[$dn.Length] -eq '\') { return $true }
        }
        return $false
    } catch { return $true }
}

function Show-SharingHint {
    if (Test-ProjectShared) { return }
    Warn 'A pasta do projeto nao esta no File Sharing do Docker Desktop (bind mounts recusados).'
    Say '   Abra Docker Desktop > Settings > Resources > File Sharing > Add,' Yellow
    Say "   adicione a pasta:" Yellow
    Say "     $Root" Cyan
    Say '   clique em Apply & Restart e execute o instalador de novo.' Yellow
}

# ------------------------------------------------------------ instalacao TESTE
<#
  Prepara a MAQUINA sem subir o sistema: instala/configura o Docker, gera o
  .env (segredos + HWID) e cria as pastas de bind mount. Util quando:
    - o cliente quer so deixar o servidor pronto antes de Build/deploy;
    - a instalacao completa falhou e quero corrigir o preparo isolado.
  Equivalente no Linux:  ./instalar.sh --senha-docker  (+ o .env)
#>
function Do-Preparar {
    Head 'PREPARANDO A MAQUINA (sem build)'
    if (-not (Test-Docker)) { return }
    Ensure-FileSharing
    if (-not (Ensure-Env)) { return }
    Ensure-Folders

    Head 'MAQUINA PRONTA'
    Say '   Docker + File Sharing + .env + pastas: OK' White
    Say '   Agora rode:  INSTALAR.bat producao   (build e subida)' White
    Say '   Diagnostico: INSTALAR.bat verificar' DarkGray
}

function Install-Teste {
    Head 'INSTALACAO TESTE (desenvolvimento - hot reload)'
    Say '   API  http://localhost:3001   SPA (Vite) http://localhost:5173   PostgreSQL 5432' DarkGray
    if (-not (Test-Docker)) { return $false }
    Ensure-FileSharing
    if (-not (Ensure-Env)) { return $false }
    Ensure-Folders

    # Virada de modo: o override altera `papatec-internal` (internal true<->false)
    # e o compose precisa RECREATE a rede — falharia com "network has active
    # endpoints" se os contenedores do modo anterior (producao) continuassem
    # anexados. `down` no projeto (mesmo nome nos dois modos) derruba a pilha
    # inteira; os volumes (pg_data) sao preservados.
    Say '   Encerrando a pilha do modo anterior (se houver)...' DarkGray
    Invoke-Compose 'teste' @('down', '--remove-orphans') | Out-Null
    # O proxy so existe no modo producao (profile "production" no override), ou
    # seja: o `down` do modo teste NAO o enxerga e ele fica segurando a rede
    # ("network has active endpoints"). Remove-o com o file set de producao,
    # onde o servico nao tem profile. (Inofensivo se nao existir.)
    Invoke-Compose 'producao' @('rm', '-sf', 'proxy') | Out-Null

    Say ''
    Say '   1/4 Build das imagens de desenvolvimento (1a vez pode demorar)...' Cyan
    if ((Invoke-Compose 'teste' @('build', 'api', 'web')) -ne 0) { Err 'Falha no build das imagens.'; return $false }

    Say '   2/4 Banco de dados + migracoes + dados de exemplo' Cyan
    if ((Invoke-Compose 'teste' @('up', '-d', 'db')) -ne 0) { Err 'Falha ao subir o banco.'; Show-SharingHint; return $false }
    if ((Invoke-Compose 'teste' @('run', '-T', '--rm', '--no-deps', 'api', 'npm', 'run', 'prisma:deploy')) -ne 0) {
        Err 'Falha ao aplicar as migracoes (prisma migrate deploy).'; Show-SharingHint; return $false
    }
    Ok 'migracoes aplicadas'
    if ((Invoke-Compose 'teste' @('run', '-T', '--rm', '--no-deps', 'api', 'npm', 'run', 'seed')) -eq 0) {
        Ok 'dados de exemplo carregados (peças, servicos, cliente, admin)'
    } else {
        Warn 'seed nao executou (tente depois: docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api npm run seed)'
    }

    Say '   3/4 Subindo os servicos (api, web, db)' Cyan
    if ((Invoke-Compose 'teste' @('up', '-d', '--build')) -ne 0) { Err 'Falha ao subir os servicos.'; Show-SharingHint; return $false }

    Say '   4/4 Aguardando a API' Cyan
    if (-not (Wait-Api 'http://localhost:3001/api/health' 300)) {
        Err 'A API nao respondeu. Veja os logs: INSTALAR.bat logs'
        return $false
    }

    $base = Get-Base 'teste'
    $st = Get-LicenseStatus $base
    if (-not $st -or -not $st.data.isLicensed) { Request-Token $base | Out-Null }

    Head 'INSTALACAO TESTE CONCLUIDA'
    Say "   Sistema : http://localhost:5173" White
    Say "   API     : http://localhost:3001/api/health" White
    Say "   Ativacao: http://localhost:5173/activate" White
    Say '   Login   : admin@papatec.com / admin123   (dados do seed - troque a senha)' Yellow
    Say '   Dica    : edite backend\src ou frontend\src e o sistema recarrega sozinho.' DarkGray
    Start-Process 'http://localhost:5173'
    return $true
}

# ------------------------------------------------------------ instalacao PRODUCAO
function Install-Producao {
    Head 'INSTALACAO PRODUCAO (cliente final)'
    Say '   HTTPS 80/443 via proxy | API com bundle ofuscado | backups 12h e 18h' DarkGray
    if (-not (Test-Docker)) { return $false }
    Ensure-FileSharing
    if (-not (Ensure-Env)) { return $false }
    Ensure-Folders

    # Virada de modo (simétrico ao teste): derruba a pilha anterior para que a
    # rede `papatec-internal` possa ser recriada com `internal: true` sem
    # contenedores antigos segurando endpoints. Volumes preservados.
    Say '   Encerrando a pilha do modo anterior (se houver)...' DarkGray
    Invoke-Compose 'producao' @('down', '--remove-orphans') | Out-Null

    Say ''
    Say '   1/3 Build das imagens de producao (Distroless + ofuscacao)...' Cyan
    if ((Invoke-Compose 'producao' @('up', '-d', '--build')) -ne 0) {
        Err 'Falha no build/servicos. Portas 80/443 podem estar em uso.'
        Say '   Solucao: net stop http / net stop w3svc  ou troque as portas no docker-compose.yml' Yellow
        Show-SharingHint
        return $false
    }

    Say '   2/3 Aguardando a API (migracoes rodam automaticamente no boot)' Cyan
    # nginx.conf e um bind mount: containers ja existentes NAO o recarregam
    # sozinhos e ficam com upstreams/cache DNS antigos (502 "Connection
    # refused" para o IP velho). Recarrega o proxy antes de checar a API.
    Start-Sleep -Seconds 3
    Invoke-Compose 'producao' @('exec', '-T', 'proxy', 'nginx', '-s', 'reload') | Out-Null
    if (-not (Wait-Api 'https://localhost/api/health' 360)) {
        Err 'A API nao respondeu. Veja os logs: INSTALAR.bat logs'
        return $false
    }

    $base = Get-Base 'producao'
    $st = Get-LicenseStatus $base
    if (-not $st -or -not $st.data.isLicensed) { Request-Token $base | Out-Null }

    $setup = Invoke-Api 'GET' "$base/api/auth/setup-status"
    $needAdmin = ($setup -and $setup.data -and $setup.data.needsSetup)

    Head 'INSTALACAO PRODUCAO CONCLUIDA'
    Say "   Sistema : https://localhost   (aceite o certificado auto-assinado)" White
    Say "   API     : https://localhost/api/health" White
    Say "   Ativacao: https://localhost/activate" White
    if ($needAdmin) {
        Say '   1o passo: https://localhost/login -> "Criar primeiro administrador"' Yellow
    } else {
        Say '   Login   : https://localhost/login' Yellow
    }
    $open = Read-Host '   Abrir o sistema no navegador? (S/n)'
    if ($open -notmatch '^[nN]') { Start-Process 'https://localhost' }
    return $true
}

# ------------------------------------------------------------ operacoes
function Do-Status {
    $m = Get-Mode
    Head "STATUS (modo detectado: $m)"
    Invoke-Compose $m @('ps') | Out-Null
    Wait-Api ((Get-Base $m) + '/api/health') 20 | Out-Null
    Get-LicenseStatus (Get-Base $m) | Out-Null
}

function Do-Logs {
    $m = Get-Mode
    Head "LOGS (Ctrl+C para sair) - modo $m"
    Invoke-Compose $m @('logs', '--tail', '150', '--follow') | Out-Null
}

function Do-Stop {
    $m = Get-Mode
    Head 'PARANDO (os dados sao mantidos)'
    if ((Invoke-Compose $m @('down')) -eq 0) { Ok 'Containers parados. Dados preservados.' }
}

function Do-Start {
    $m = Get-Mode
    Head 'SUBINDO'
    if ((Invoke-Compose $m @('up', '-d')) -eq 0) {
        Ok 'containers iniciados'
        Wait-Api ((Get-Base $m) + '/api/health') 180 | Out-Null
    } else { Err 'falha ao subir - veja os logs: INSTALAR.bat logs' }
}

# Atualiza para o codigo atual: rebuild das imagens + recreate dos containers.
# Preserva .env, uploads, backups e o volume do banco.
function Do-Update {
    Head 'ATUALIZANDO (codigo novo -> containers)'
    if (-not (Test-Docker)) { return }
    if (-not (Test-Path $EnvFile)) { Err '.env ausente - rode a instalacao primeiro.'; return }

    Invoke-Compose (Get-Mode) @('down', '--remove-orphans') | Out-Null
    Say '   Rebuild das imagens (pode levar varios minutos)...' Cyan
    if ((Invoke-Compose 'producao' @('build', '--pull', 'api', 'web')) -ne 0) { Err 'falha no build.'; return }
    if ((Invoke-Compose 'producao' @('up', '-d')) -ne 0) { Err 'falha ao subir.'; return }

    Start-Sleep -Seconds 3
    Invoke-Compose 'producao' @('exec', '-T', 'proxy', 'nginx', '-s', 'reload') | Out-Null
    if (-not (Wait-Api 'https://localhost/api/health' 300)) {
        Err 'a API nao respondeu apos o update - veja os logs'
        return
    }
    Ok 'atualizacao concluida (dados preservados)'
}

<#
  Diagnostico. E o comando mais util quando algo deu errado: nao muda nada,
  so lista o que esta faltando / quebrado.
#>
function Do-Verificar {
    Head 'DIAGNOSTICO'
    $probs = 0

    Say "   sistema  : $env:OS  ($([string](Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Version))"
    Say "   pasta    : $Root"
    Say "   powershell: $($PSVersionTable.PSVersion)"
    Write-Host ''

    # --- Docker
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        Ok "docker: $(((& docker --version 2>$null) -join '').Trim())"
        & docker compose version 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Ok "compose v2: $(((& docker compose version 2>$null) -join '').Trim())"
        } else { Err 'plugin "docker compose" v2 ausente'; $probs++ }

        & docker info 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Ok 'daemon respondendo' }
        else { Err 'daemon NAO responde - abra o Docker Desktop'; $probs++ }
    } else {
        Err 'docker nao instalado (INSTALAR.bat instala o Docker Desktop)'
        $probs++
    }

    # --- .env
    Write-Host ''
    if (Test-Path $EnvFile) {
        Ok '.env existe'
        $text = [System.IO.File]::ReadAllText($EnvFile)
        foreach ($k in 'DB_PASSWORD', 'JWT_SECRET', 'LICENSE_PUBLIC_KEY_B64',
            'MACHINE_UUID', 'MACHINE_MAC', 'CARD_MACHINE_CALLBACK_TOKEN') {
            $v = [regex]::Match($text, "(?m)^$k=(.*)$").Groups[1].Value.Trim()
            if (-not $v) { Warn "$k vazio"; $probs++ }
            elseif ($v -like '*cole_aqui*' -or $v -like '*TROQUE*') { Warn "$k ainda e o valor de exemplo"; $probs++ }
            else { Write-Host "   [ok] $k ($($v.Length) chars)" -ForegroundColor DarkGray }
        }
        # Senha curta nao quebra nada agora, mas e o primeiro alvo de ataque:
        # o banco so fala com a rede interna, porem um dump vaza a senha.
        foreach ($k in 'DB_PASSWORD', 'JWT_SECRET') {
            $v = [regex]::Match($text, "(?m)^$k=(.*)$").Groups[1].Value.Trim()
            if ($v.Length -lt 24) { Warn "$k tem apenas $($v.Length) chars - recomendo 32+" }
        }
        if ([regex]::IsMatch($text, '(?m)^DRM_BYPASS=true')) {
            Warn 'DRM_BYPASS=true - validacao de licenca DESLIGADA'
        }
    } else {
        Err '.env ausente'; $probs++
    }

    # --- pastas de bind mount
    Write-Host ''
    foreach ($d in 'uploads', 'backups', 'certs', 'logs') {
        if (Test-Path (Join-Path $Root $d)) { Ok "pasta .\$d" }
        else { Warn "pasta .\$d ausente (o bind mount vai falhar)"; $probs++ }
    }
    if (Test-Path (Join-Path $Root 'nginx.conf')) { Ok 'nginx.conf presente' }
    else { Err 'nginx.conf ausente'; $probs++ }

    # --- File Sharing
    Write-Host ''
    if (Test-ProjectShared) { Ok 'pasta do projeto liberada no File Sharing' }
    else {
        Warn 'pasta do projeto NAO esta no File Sharing do Docker Desktop'
        Say '   Docker Desktop > Settings > Resources > File Sharing > Add > ' -ForegroundColor Yellow
        Say "     $Root" -ForegroundColor Cyan
        Say '   Apply & Restart  (o instalador tenta fazer isso por voce)' -ForegroundColor Yellow
        $probs++
    }

    # --- portas
    Write-Host ''
    foreach ($p in 80, 443) {
        $busy = @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)
        if ($busy.Count) { Write-Host "   [ok] porta $p em uso (esperado: o proxy)" -ForegroundColor DarkGray }
        else { Warn "porta $p livre (o proxy vai subir e ocupa-la)" }
    }

    # --- containers + saude
    $daemonOk = $false
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        & docker info 2>&1 | Out-Null
        $daemonOk = ($LASTEXITCODE -eq 0)
    }
    if ($daemonOk) {
        Write-Host ''
        Invoke-Compose (Get-Mode) @('ps') | Out-Null
        $m = Get-Mode
        $code = (& curl.exe -s -o NUL -w '%{http_code}' -k --max-time 10 ((Get-Base $m) + '/api/health') 2>$null) -join ''
        if ($code -eq '200') { Ok "API respondendo ($(Get-Base $m)/api/health)" }
        elseif ($code -eq '000') { Warn 'API nao responde ainda (pode ser o primeiro boot: INSTALAR.bat logs)' }
        else { Warn "API respondeu HTTP $code" }
    }

    Write-Host ''
    if ($probs -eq 0) { Ok 'nenhum problema bloqueante encontrado' }
    else { Err "$probs problema(s) - veja as linhas acima"; Say '   documento: INSTALACAO-CONFIGURACAO.txt' DarkGray }
}

function Do-Reset {
    $m = Get-Mode
    Head 'RESET TOTAL - APAGA O BANCO DE DADOS'
    Warn 'Isto remove os containers, o volume do PostgreSQL e TODOS os registros.'
    Warn 'Backups ja gerados na pasta .\backups NAO sao apagados.'
    $c = Read-Host '   Digite APAGAR para confirmar'
    if ($c -ne 'APAGAR') { Warn 'Cancelado.'; return }
    if ((Invoke-Compose $m @('down', '-v', '--remove-orphans')) -eq 0) {
        Ok 'Reset concluido. Rode INSTALAR.bat teste (ou producao) para recomecar.'
    }
}

function Get-AdminToken([string]$base) {
    $email = Read-Host '   E-mail do administrador'
    $sec = Read-Host '   Senha' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    $r = Invoke-Api 'POST' "$base/api/auth/login" @{ email = $email; password = $plain }
    if ($r -and $r.data -and $r.data.access_token) { return $r.data.access_token }
    Err 'Login falhou (credenciais invalidas ou usuario desativado).'
    return $null
}

function Do-Backup {
    $m = Get-Mode
    $base = Get-Base $m
    Head 'BACKUP'
    if (-not (Wait-Api "$base/api/health" 30)) { Err 'API indisponivel.'; return }
    $token = Get-AdminToken $base
    if (-not $token) { return }

    Say ''
    Say '   1 - Criar backup agora' White
    Say '   2 - Listar backups' White
    Say '   3 - Restaurar um backup (DESTRUTIVO)' White
    Say '   4 - Limpar backups antigos (retencao)' White
    $op = Read-Host '   Opcao'

    switch ($op) {
        '1' {
            $r = Invoke-Api 'POST' "$base/api/backup/create" @{} $token
            if ($r -and $r.success -and $r.data) {
                Ok "backup criado: $($r.data.file) ($([math]::Round($r.data.size / 1KB, 1)) KB, $($r.data.tables) tabelas, $($r.data.rows) linhas)"
            } else { Err "falha: $($r.error.message)" }
        }
        '2' {
            $r = Invoke-Api 'GET' "$base/api/backup/list" $null $token
            if (-not ($r -and $r.data -and $r.data.files)) { Err 'nao foi possivel listar.'; return }
            if ($r.data.files.Count -eq 0) { Warn 'nenhum backup gerado ainda.'; return }
            Say "   pasta: $($r.data.path)   cron: $($r.data.schedule)" DarkGray
            $i = 1
            foreach ($f in $r.data.files) {
                $kb = [math]::Round($f.size / 1KB, 1)
                Write-Host ("   [{0}] {1}  {2} KB  {3}" -f $i, $f.name, $kb, $f.createdAt)
                $i++
            }
        }
        '3' {
            $r = Invoke-Api 'GET' "$base/api/backup/list" $null $token
            if (-not ($r -and $r.data -and $r.data.files) -or $r.data.files.Count -eq 0) { Warn 'nenhum backup disponivel.'; return }
            $i = 1
            foreach ($f in $r.data.files) { Write-Host ("   [{0}] {1}" -f $i, $f.name); $i++ }
            $n = Read-Host '   Numero do backup a restaurar'
            $idx = 0
            if (-not [int]::TryParse($n, [ref]$idx) -or $idx -lt 1 -or $idx -gt $r.data.files.Count) { Warn 'invalido.'; return }
            $file = $r.data.files[$idx - 1].name
            Warn 'ATENCAO: todos os dados atuais serao substituidos pelos do backup.'
            $c = Read-Host "   Digite RESTAURAR para confirmar ($file)"
            if ($c -ne 'RESTAURAR') { Warn 'Cancelado.'; return }
            $resp = Invoke-Api 'POST' "$base/api/backup/restore/$file" @{} $token
            if ($resp -and $resp.success) {
                Ok "restaurado: $($resp.data.restoredTables) tabelas / $($resp.data.restoredRows) linhas"
            } else { Err "falha: $($resp.error.message)" }
        }
        '4' {
            $r = Invoke-Api 'POST' "$base/api/backup/cleanup" @{} $token
            if ($r -and $r.success) { Ok "$($r.data.removed) arquivo(s) antigo(s) removido(s)" } else { Err 'falha.' }
        }
        default { Warn 'Opcao invalida.' }
    }
}

function Do-License {
    $m = Get-Mode
    $base = Get-Base $m
    Head 'LICENCA'
    if (-not (Wait-Api "$base/api/health" 30)) { Err 'API indisponivel.'; return }
    $st = Get-LicenseStatus $base
    if ($st -and $st.data -and $st.data.isLicensed) {
        $again = Read-Host '   Ja existe licenca ativa. Reativar/substituir? (s/N)'
        if ($again -notmatch '^[sS]') { return }
    }
    Request-Token $base | Out-Null
}

# ------------------------------------------------------------ menu
function Show-Menu {
    $m = Get-Mode
    try { Clear-Host } catch { }
    Write-Host '============================================================' -ForegroundColor DarkCyan
    Write-Host '   PAPATEC - SISTEMA LOJA   |   INSTALADOR E MENU' -ForegroundColor Cyan
    Write-Host '============================================================' -ForegroundColor DarkCyan
    Write-Host "   Pasta : $Root"
    Write-Host "   Docker: $(((& docker --version 2>$null) -join '').Trim())"
    Write-Host "   Modo atual : $m"
    Write-Host ''
    Write-Host '   [0] Preparar maquina so (Docker + .env + pastas, sem build)' -ForegroundColor Cyan
    Write-Host '   [1] Instalacao TESTE      (dev, hot-reload, dados de exemplo)' -ForegroundColor White
    Write-Host '   [2] Instalacao PRODUCAO   (cliente final, HTTPS, ofuscado)' -ForegroundColor White
    Write-Host '   [3] Status / saude' -ForegroundColor Gray
    Write-Host '   [4] Logs' -ForegroundColor Gray
    Write-Host '   [5] Backup (criar / listar / restaurar)' -ForegroundColor Gray
    Write-Host '   [6] Licenca (verificar / ativar)' -ForegroundColor Gray
    Write-Host '   [7] Parar (mantem dados)' -ForegroundColor Gray
    Write-Host '   [8] RESET TOTAL (apaga o banco)' -ForegroundColor DarkYellow
    Write-Host '   [9] Verificar / diagnosticar  <-- use quando algo falhar' -ForegroundColor Cyan
    Write-Host '  [10] Atualizar (codigo novo -> containers)' -ForegroundColor Cyan
    Write-Host '  [11] Sair' -ForegroundColor Gray
    Write-Host '============================================================' -ForegroundColor DarkCyan
}

function Invoke-Menu {
    while ($true) {
        Show-Menu
        $sel = Read-Host '   Opcao'
        switch ($sel) {
            '0' { Do-Preparar }
            '1' { Install-Teste }
            '2' { Install-Producao }
            '3' { Do-Status }
            '4' { Do-Logs }
            '5' { Do-Backup }
            '6' { Do-License }
            '7' { Do-Stop }
            '8' { Do-Reset }
            '9' { Do-Verificar }
            '10' { Do-Update }
            '11' { return }
            default { Warn 'Opcao invalida.' }
        }
        if ($sel -ne '11') { Write-Host ''; Read-Host '   Enter para voltar ao menu' | Out-Null }
    }
}

# ------------------------------------------------------------ main
# As instalacoes devolvem $true/$false; em falha o script sai com codigo 1 para que
# o INSTALAR.bat reporte "O instalador terminou com erro (codigo 1)".
switch ($Opcao) {
    'menu' { Invoke-Menu }
    'preparar' { Do-Preparar }
    'teste' { if (-not (Install-Teste)) { exit 1 } }
    'producao' { if (-not (Install-Producao)) { exit 1 } }
    'status' { Do-Status }
    'logs' { Do-Logs }
    'backup' { Do-Backup }
    'licenca' { Do-License }
    'parar' { Do-Stop }
    'iniciar' { Do-Start }
    'atualizar' { Do-Update }
    'verificar' { Do-Verificar }
    'reset' { Do-Reset }
}
