#!/usr/bin/env bash
# ============================================================================
#  PapaTec - Sistema Loja  |  Instalador Linux (Ubuntu/Debian/RHEL/Alpine)
# ----------------------------------------------------------------------------
#  O Docker NAO precisa estar instalado: este script instala o Docker Engine
#  + plugin compose a partir do repositorio oficial e sobe o sistema inteiro.
#
#  Uso:
#     sudo ./instalar.sh                 instala em modo PRODUCAO
#     sudo ./instalar.sh --teste         instala em modo TESTE (hot reload)
#     sudo ./instalar.sh --preparar      so prepara a maquina (Docker + .env),
#                                        sem build — util antes do deploy
#     ./instalar.sh status               situacao dos containers + saude
#     ./instalar.sh logs                 logs em tempo real (Ctrl+C sai)
#     ./instalar.sh backup               cria um backup agora
#     ./instalar.sh licenca              mostra HWID e ativa token
#     ./instalar.sh update               atualiza para a versao do codigo
#     ./instalar.sh stop                 para (mantem os dados)
#     ./instalar.sh start                volta a subir
#     ./instalar.sh verificar            diagnostico (o que falta / por que)
#     ./instalar.sh reset                APAGA o banco (pede confirmacao)
#
#  O DOCKER E INSTALADO AQUI: em Ubuntu/Debian/RHEL via repositorio oficial
#  (https://get.docker.com), em Alpine via apk. Se ja estiver presente, apenas
#  e verificado e o usuario entra no grupo docker.
# ============================================================================
set -uo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || { echo "ERRO: nao consegui entrar em $ROOT"; exit 1; }

ENV_FILE="$ROOT/.env"
OS_MODE="producao"
APPS=()

# ----------------------------------------------------------------- apresentacao
if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  C_RST=$'\033[0m'; C_OK=$'\033[32m'; C_WARN=$'\033[33m'
  C_ERR=$'\033[31m'; C_HEAD=$'\033[36m'; C_DIM=$'\033[90m'
else
  C_RST=""; C_OK=""; C_WARN=""; C_ERR=""; C_HEAD=""; C_DIM=""
fi

say() {
  # say <texto> [cor]  -> a cor e opcional (ex.: say "pronto" "$C_OK")
  if [ $# -ge 2 ] && [ -n "$2" ]; then
    printf '%s%s%s\n' "$2" "$1" "$C_RST"
  else
    printf '%s\n' "$1"
  fi
}
head_() { printf '\n%s>> %s%s\n' "$C_HEAD" "$*" "$C_RST"; }
ok()   { printf '   %s[OK]%s %s\n' "$C_OK" "$C_RST" "$*"; }
warn() { printf '   %s[!]%s  %s\n' "$C_WARN" "$C_RST" "$*"; }
err()  { printf '   %s[ERRO]%s %s\n' "$C_ERR" "$C_RST" "$*" >&2; }
dim()  { printf '   %s%s%s\n' "$C_DIM" "$*" "$C_RST"; }
die()  { err "$*"; exit 1; }

# =============================================================================
#  1. Docker: instala, configura e coloca o usuario no grupo
# =============================================================================
have() { command -v "$1" >/dev/null 2>&1; }

docker_ok() {
  have docker || return 1
  docker compose version >/dev/null 2>&1 || return 1
  docker info >/dev/null 2>&1 || return 1
  return 0
}

# Sudo transparente: se nao somos root e existe sudo, usa sudo.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  have sudo || die "Precisa executar como root: sudo $0 $*"
  SUDO="sudo -n"
fi
as_root() { if [ -n "$SUDO" ]; then $SUDO "$@"; else "$@"; fi; }

pkg_install_deb() {
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}
pkg_install_rpm() { as_root "$1" install -y "$@"; }

detect_family() {
  if [ -r /etc/os-release ]; then . /etc/os-release; else OS_NAME=unknown; fi
  case "${ID:-}${ID_LIKE:-}" in
    *debian*|*ubuntu*) echo deb ;;
    *rhel*|*fedora*|*centos*|*rocky*|*almalinux*) echo rpm ;;
    *alpine*) echo alpine ;;
    *) echo unknown ;;
  esac
}

install_docker() {
  local fam; fam="$(detect_family)"
  say "   familia detectada: ${fam} (${PRETTY_NAME:-$OS_NAME:-?})"

  case "$fam" in
    deb)
      head_ "INSTALANDO DOCKER (repositorio oficial)"
      if ! have curl && ! have wget; then
        as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq
        pkg_install_deb ca-certificates curl
      fi
      # get.docker.com resolve a versao correta da distro e ja traz o plugin
      # "docker compose" (v2). Mais confiavel que montar o repo a mao.
      local tmp; tmp="$(mktemp)"
      if have curl; then
        curl -fsSL https://get.docker.com -o "$tmp" || die "falha ao baixar get.docker.com"
      else
        wget -qO "$tmp" https://get.docker.com || die "falha ao baixar get.docker.com"
      fi
      as_root sh "$tmp" || { rm -f "$tmp"; die "instalacao do Docker falhou"; }
      rm -f "$tmp"
      ;;
    rpm)
      head_ "INSTALANDO DOCKER (repositorio oficial)"
      local tmp; tmp="$(mktemp)"
      curl -fsSL https://get.docker.com -o "$tmp" || die "falha ao baixar get.docker.com"
      as_root sh "$tmp" || { rm -f "$tmp"; die "instalacao do Docker falhou"; }
      rm -f "$tmp"
      ;;
    alpine)
      head_ "INSTALANDO DOCKER (Alpine)"
      as_root apk add --no-cache docker docker-cli-compose || die "falha ao instalar docker (apk)"
      ;;
    *)
      warn "Distribuicao nao reconhecida (${PRETTY_NAME:-$OS_NAME})."
      say "      Instale o Docker Engine + plugin 'docker compose' manualmente:" "$C_DIM"
      say "        https://docs.docker.com/engine/install/" "$C_DIM"
      say "      e rode este script de novo." "$C_DIM"
      return 1
      ;;
  esac
}

enable_docker() {
  have systemctl && { as_root systemctl enable --now docker >/dev/null 2>&1 || true; }
  have rc-service && { as_root rc-service docker start >/dev/null 2>&1 || true; }
  # Docker Desktop /_rootless ou WSL podem nao ter systemd
  docker info >/dev/null 2>&1 || true
}

add_user_to_docker_group() {
  local user="${SUDO_USER:-${USER:-}}"
  [ -n "$user" ] || return 0
  id -nG "$user" 2>/dev/null | tr ' ' '\n' | grep -qx docker && return 0
  getent group docker >/dev/null 2>&1 || as_root groupadd docker 2>/dev/null
  as_root usermod -aG docker "$user" && ok "usuario '$user' adicionado ao grupo docker (reautentique para valer)"
}

ensure_docker() {
  head_ "DOCKER"
  if docker_ok; then
    ok "Docker pronto: $(docker --version 2>/dev/null | head -1)"
    dim "compose: $(docker compose version 2>/dev/null | head -1)"
  else
    if have docker; then
      warn "Docker instalado mas o daemon nao responde ou falta o plugin compose v2."
      if ! docker compose version >/dev/null 2>&1; then
        warn "plugin 'docker compose' (v2) ausente - instalando Docker oficial para corrigir"
        install_docker || return 1
      fi
    else
      warn "Docker nao encontrado - instalando agora (leva alguns minutos)"
      install_docker || return 1
    fi
    enable_docker
    sleep 3
    docker_ok || die "Docker instalado mas o daemon nao subiu. See: journalctl -u docker"
    ok "Docker instalado: $(docker --version 2>/dev/null | head -1)"
  fi
  add_user_to_docker_group
  return 0
}

# =============================================================================
#  2. .env: segredos e identificacao da maquina
# =============================================================================
set_env() {
  # set_env <NOME> <valor>  -> cria ou substitui a linha em $ENV_FILE.
  # Antes esta funcao aceitava um 3o parametro `file` que ninguem passava:
  # com `set -u` isso abortava o instalador em "unbound variable".
  local name="$1" value="$2"
  [ -f "$ENV_FILE" ] || touch "$ENV_FILE"
  if grep -qE "^${name}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${name}=.*|${name}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$name" "$value" >> "$ENV_FILE"
  fi
}

get_env() {
  # usa $ENV_FILE explicitamente: `file` e parametro de set_env e com
  # `set -u` causaria "unbound variable" aqui.
  sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | head -1
}

rand_secret() {
  local n="${1:-32}"
  if have openssl; then
    openssl rand -hex "$n" 2>/dev/null | tr -d '\n'
  else
    head -c "$n" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# OUI (3 primeiros octetos) de interface virtual/bridge. NUNCA sao a NIC real
# do servidor e, se fossem gravadas no .env, o HWID seria identico em maquinas
# diferentes - quebrando a amarracao da licenca ao hardware.
VIRTUAL_OUI='^(00:15:5d|00:0d:3a|00:50:56|00:0c:29|00:1c:14|00:16:3e|08:00:27|0a:00:27|02:42:ac|52:54:00)'

# Lista todos os MACs validos (aa:bb:cc:dd:ee:ff, normalizado em minusculas),
# descartando o null (00:..:00) e o broadcast (ff:ff:ff:ff:ff:ff).
# A entrada pode vir suja: linhas de `ip link` trazem "brd ff:ff:..", o awk
# pode cuttingar o campo errado, e `cat /sys/.../address` devolve varios.
all_valid_macs() {
  tr ' ' '\n' \
    | grep -oiE '([0-9a-f]{2}:){5}[0-9a-f]{2}' \
    | tr 'A-F' 'a-f' \
    | grep -vE '^([0-9a-f]{2}:){5}(00|ff)$' \
    | sort -u
}

# Primeiro MAC REAL. Se a maquina so tiver MAC virtual (container/VM), devolve
# o primeiro valido mesmo assim - melhor que HWID vazio.
first_valid_mac() {
  all_valid_macs | grep -vE "$VIRTUAL_OUI" | head -1
}

# HWID: o backend roda em container Linux, onde nao ha wmic/getmac. Sem ler o
# identificador no HOST o hardwareId cairia no fallback e ficaria IGUAL em
# todas as maquinas - anulando a amarracao da licenca ao hardware.
detect_machine_id() {
  local uuid="" mac=""

  # --- UUID: /etc/machine-id e o equivalente Linux do UUID de hardware
  for f in /etc/machine-id /var/lib/dbus/machine-id; do
    if [ -r "$f" ]; then
      uuid="$(tr -d '\n' < "$f")"
      [ -n "$uuid" ] && break
    fi
  done
  if [ -z "$uuid" ] && have dmidecode; then
    uuid="$(as_root dmidecode -s system-uuid 2>/dev/null | tr -d '\n')"
  fi
  [ -n "$uuid" ] || uuid="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null | tr -d '\n')"

  # --- MAC: `ip link` primeiro, /sys como reserva
  local cands=""
  if have ip; then
    cands="$(ip -o link show 2>/dev/null | sed -n 's/.*link\/ether \([0-9a-fA-F:]*\).*/\1/p')"
  fi
  [ -n "$(printf '%s' "$cands" | all_valid_macs)" ] || \
    cands="$(cat /sys/class/net/*/address 2>/dev/null)"

  mac="$(printf '%s' "$cands" | first_valid_mac)"
  if [ -z "$mac" ]; then
    # so interfaces virtuais: ainda melhor que deixar o HWID sem MAC
    mac="$(printf '%s' "$cands" | all_valid_macs | head -1)"
  fi

  printf '%s|%s' "$uuid" "$mac"
}

ensure_env() {
  head_ "CONFIGURACAO (.env)"
  if [ ! -f "$ENV_FILE" ]; then
    [ -f "$ROOT/.env.example" ] || die ".env.example nao encontrado - projeto incompleto"
    cp "$ROOT/.env.example" "$ENV_FILE"
    ok ".env criado a partir do .env.example"
  fi

  local changed=0 name val

  # --- segredos: so gera se ainda nao tiverem valor real
  for name in DB_PASSWORD JWT_SECRET; do
    val="$(get_env "$name")"
    case "$val" in
      ""|cole_aqui*|*TROQUE*|*troque*)
        set_env "$name" "$(rand_secret 32)"
        ok "$name gerado (aleatorio)"
        changed=1 ;;
    esac
  done

  # --- token do callback da maquininha
  val="$(get_env CARD_MACHINE_CALLBACK_TOKEN)"
  if [ -z "$val" ]; then
    set_env CARD_MACHINE_CALLBACK_TOKEN "$(rand_secret 24)"
    ok "CARD_MACHINE_CALLBACK_TOKEN gerado (callback de maquininha)"
    changed=1
  fi

  # --- DRM: identificacao da maquina
  local cur_uuid cur_mac
  cur_uuid="$(get_env MACHINE_UUID)"; cur_mac="$(get_env MACHINE_MAC)"
  if [ -z "$cur_uuid" ] || [ -z "$cur_mac" ]; then
    IFS='|' read -r uuid mac <<< "$(detect_machine_id)"
    if [ -n "$uuid" ]; then set_env MACHINE_UUID "$uuid"; changed=1; fi
    if [ -n "$mac" ];  then set_env MACHINE_MAC "$mac";   changed=1; fi
    if [ -n "$uuid" ] && [ -n "$mac" ]; then
      ok "identificacao da maquina gravada (base do HWID/DRM)"
      dim "uuid=$uuid  mac=$mac"
    else
      warn "UUID/MAC nao puderam ser lidos - o HWID usara o hostname"
      warn "rode './instalar.sh verificar' e confira LICENSE apos instalar"
    fi
  else
    dim "MACHINE_UUID e MACHINE_MAC ja definidos (preservados - mudá-los invalida a licenca)"
  fi

  # --- chmod 600: o .env tem senha do banco, chave privada JWT e MerchantKey
  chmod 600 "$ENV_FILE" 2>/dev/null || true

  # --- chave publica da licenca: sem ela o sistema sobe travado (403)
  val="$(get_env LICENSE_PUBLIC_KEY_B64)"
  if [ -z "$val" ]; then
    err "LICENSE_PUBLIC_KEY_B64 vazio no .env"
    say "      Sem essa chave o sistema sobe BLOQUEADO (403 em todas as rotas)." "$C_WARN"
    say "      Copie o valor de .env.example para o .env, ou solicite a Filitech." "$C_WARN"
    say "      licenca@filitech.com.br" "$C_DIM"
    return 1
  fi
  ok "chave publica de licenca presente"
  return 0
}

ensure_dirs() {
  for d in uploads backups certs logs; do
    [ -d "$ROOT/$d" ] || { mkdir -p "$ROOT/$d" && ok "pasta ./$d criada"; }
  done
}

# =============================================================================
#  3. Portas 80/443 - causa numero 1 de falha em servidor limpo
# =============================================================================
check_ports() {
  head_ "PORTAS 80 / 443"
  local busy=""
  for p in 80 443; do
    if have ss && ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$p\$"; then busy="$busy $p"; fi
  done
  if [ -z "$busy" ]; then ok "80 e 443 livres"; return 0; fi

  warn "em uso:$busy (o proxy HTTPS precisa delas)"
  local svc=""
  for s in apache2 httpd nginx lighttpd; do
    have systemctl && systemctl is-active --quiet "$s" && svc="$s" && break
  done
  if [ -n "$svc" ]; then
    say "   O servico '$svc' esta ocupando a porta. Posso parar ele?" "$C_WARN"
    if [ -t 0 ]; then
      local a; read -r -p "   Parar '$svc'? (s/N) " a
      case "$a" in [sSyY]) as_root systemctl stop "$svc" && ok "'$svc' parado" ;; *) warn "deixando como esta" ;; esac
    else
      as_root systemctl stop "$svc" && ok "'$svc' parado (instalacao nao interativa)"
    fi
  fi
  return 0
}

# =============================================================================
#  4. Compose
# =============================================================================
compose_files() {
  case "$OS_MODE" in
    teste)    printf -- '-f %s -f %s' "$ROOT/docker-compose.yml" "$ROOT/docker-compose.dev.yml" ;;
    *)        printf -- '-f %s' "$ROOT/docker-compose.yml" ;;
  esac
}

dc() {
  # Wrapper do docker compose com os arquivos corretos e sem pipe no stdout
  # (pipe quebra o TTY do Compose >= 5.x: "failed to get console").
  local -a cf; read -r -a cf <<< "$(compose_files)"
  docker compose "${cf[@]}" "$@"
}

compose_extra_files() {
  local extra=""
  [ -f "$ROOT/docker-compose.override.yml" ] && extra=" (override presente)"
  printf '%s' "$extra"
}

wait_api() {
  local url="$1" timeout="${2:-360}" waited=0
  # PAPA_HEALTH_TIMEOUT sobrescreve a espera (util em CI e no primeiro boot
  # numa maquina lenta, onde 360s pode ser pouco ou sobrarem).
  [ -n "${PAPA_HEALTH_TIMEOUT:-}" ] && timeout="$PAPA_HEALTH_TIMEOUT"
  say "   aguardando $url "
  while [ "$waited" -lt "$timeout" ]; do
    if have curl; then
      local code
      code="$(curl -s -o /dev/null -w '%{http_code}' -k --max-time 5 "$url" 2>/dev/null)"
      [ "$code" = "200" ] && printf ' %sOK%s\n' "$C_OK" "$C_RST" && return 0
    fi
    printf '.'; sleep 3; waited=$((waited + 3))
  done
  printf ' %sTIMEOUT%s\n' "$C_ERR" "$C_RST"
  return 1
}

install_app() {
  head_ "INSTALACAO $OS_MODE"
  dim "compose: $(compose_files)$(compose_extra_files)"

  #derruba o modo anterior: a rede papatec-internal muda de internal true<->false
  #e o compose precisa RECRIAR a rede. Sem o down, falha com
  #"network has active endpoints". Volumes (pg_data) sao preservados.
  say "   derrubando a pilha anterior (se houver)..." ; dc down --remove-orphans >/dev/null 2>&1

  if [ "$OS_MODE" = "teste" ]; then
    say "   1/4 build das imagens"
    dc build api web >/dev/null || die "falha no build"
    say "   2/4 banco + migracoes"
    dc up -d db >/dev/null || die "falha ao subir o banco"
    dc run -T --rm --no-deps api npm run prisma:deploy >/dev/null 2>&1 \
      && ok "migracoes aplicadas" || err "falha nas migracoes (veja ./instalar.sh logs)"
    dc run -T --rm --no-deps api npm run seed >/dev/null 2>&1 \
      && ok "dados de exemplo carregados" || warn "seed nao executou (opcional)"
    say "   3/4 subindo os servicos"
    dc up -d --build >/dev/null || die "falha ao subir os servicos"
    say "   4/4 saude da API"
    wait_api "http://localhost:3001/api/health" 300 || die "a API nao respondeu - ./instalar.sh logs"
    local base="http://localhost:3001" spa="http://localhost:5173"
  else
    say "   1/2 build + subida (a primeira vez baixa imagem e compila: leva alguns minutos)"
    dc up -d --build >/dev/null || die "falha no build/servicos - ./instalar.sh verificar"
    say "   2/2 saude da API (migracoes rodam no boot)"
    sleep 3
    dc exec -T proxy nginx -s reload >/dev/null 2>&1 || true
    wait_api "https://localhost/api/health" 360 || die "a API nao respondeu - ./instalar.sh logs"
    local base="https://localhost" spa="https://localhost"
  fi

  local lic
  lic="$(curl -sk --max-time 15 "$base/api/license/status" 2>/dev/null || true)"
  local hwid ok_lic
  hwid="$(printf '%s' "$lic" | grep -o '"hardwareId":"[^"]*"' | cut -d'"' -f4)"
  ok_lic="$(printf '%s' "$lic" | grep -c '"isLicensed":true' || true)"
  if [ "$ok_lic" = "1" ]; then
    ok "licenca ATIVA (HWID $hwid)"
  else
    warn "SEM LICENCA ATIVA - HWID desta maquina: ${hwid:-desconhecido}"
    say "      Ative com:  sudo ./instalar.sh licenca" "$C_DIM"
  fi

  head_ "INSTALADO"
  printf '   Sistema : %s\n' "$spa"
  printf '   API     : %s/api/health\n' "$base"
  printf '   Login   : https://localhost/login  (crie o primeiro administrador)\n'
  [ "$OS_MODE" = "producao" ] && printf '   %s(certificado auto-assinado: o navegador vai avisar)%s\n' "$C_WARN" "$C_RST"
  return 0
}

# =============================================================================
#  5. Operacoes
# =============================================================================
detect_mode() {
  if docker ps --filter 'name=papatec-web' --format '{{.Ports}}' 2>/dev/null | grep -q '5173'; then
    echo teste
  else
    echo producao
  fi
}

base_url() { [ "$1" = "teste" ] && echo "http://localhost:3001" || echo "https://localhost"; }

api_curl() {
  # api_curl <METODO> <caminho> [json]
  local method="$1" path="$2" body="${3:-}" base; base="$(base_url "$(detect_mode)")"
  local -a a=(-s -k --max-time 60 -X "$method" -H 'Content-Type: application/json')
  [ -n "$body" ] && a+=(-d "$body")
  curl "${a[@]}" "$base$path" 2>/dev/null
}

api_login() {
  local email="$1" pass="$2" r
  r="$(curl -sk --max-time 30 -X POST -H 'Content-Type: application/json' \
       -d "{\"email\":\"$email\",\"password\":\"$pass\"}" \
       "$(base_url "$(detect_mode)")/api/auth/login" 2>/dev/null)"
  printf '%s' "$r" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4
}

cmd_status() {
  local m; m="$(detect_mode)"
  head_ "STATUS (modo: $m)"
  dc ps 2>/dev/null
  echo
  wait_api "$(base_url "$m")/api/health" 20 || true
  local lic; lic="$(api_curl GET /api/license/status || true)"
  if printf '%s' "$lic" | grep -q '"isLicensed":true'; then
    ok "licenca ATIVA"
  else
    warn "licenca INATIVA - HWID: $(printf '%s' "$lic" | grep -o '"hardwareId":"[^"]*"' | cut -d'"' -f4)"
  fi
}

cmd_logs()    { local m; m="$(detect_mode)"; head_ "LOGS (Ctrl+C sai) - $m"; dc logs --tail 150 --follow; }

cmd_stop()    { local m; m="$(detect_mode)"; head_ "PARANDO"; if dc down >/dev/null 2>&1; then ok "containers parados, dados preservados"; else err "falha ao parar"; fi; }

cmd_start()   { local m; m="$(detect_mode)"; head_ "SUBINDO"; dc up -d >/dev/null 2>&1 && ok "subindo" || err "falha - ./instalar.sh logs"; wait_api "$(base_url "$m")/api/health" 180; }

cmd_update() {
  head_ "ATUALIZANDO (codigo novo -> containers)"
  docker_ok || die "Docker indisponivel"
  [ -f "$ENV_FILE" ] || die ".env ausente - rode a instalacao primeiro"
  dc down --remove-orphans >/dev/null 2>&1
  dc build --pull api web >/dev/null || die "falha no build"
  dc up -d >/dev/null || die "falha ao subir"
  sleep 3
  dc exec -T proxy nginx -s reload >/dev/null 2>&1 || true
  wait_api "https://localhost/api/health" 300 || die "a API nao respondeu apos o update"
  ok "atualizacao concluida"
}

cmd_license() {
  local m; m="$(detect_mode)"
  wait_api "$(base_url "$m")/api/health" 30 || die "API indisponivel"
  head_ "LICENCA"
  local lic; lic="$(api_curl GET /api/license/status || true)"
  if printf '%s' "$lic" | grep -q '"isLicensed":true'; then
    ok "licenca ATIVA - HWID $(printf '%s' "$lic" | grep -o '"hardwareId":"[^"]*"' | cut -d'"' -f4)"
    read -r -p "   Substituir por outro token? (s/N) " a
    case "$a" in [sSyY]) ;; *) return 0 ;; esac
  else
    warn "licenca INATIVA"
  fi
  say "   HWID desta maquina: $(printf '%s' "$lic" | grep -o '"hardwareId":"[^"]*"' | cut -d'"' -f4)"
  read -r -p "   Cole o token (Enter para sair): " tok
  [ -z "$tok" ] && return 0
  local r; r="$(api_curl POST /api/license/activate "{\"token\":\"$tok\"}")"
  if printf '%s' "$r" | grep -q '"success":true'; then ok "licenca ativada"; else err "falhou: $r"; fi
}

cmd_backup() {
  local m; m="$(detect_mode)"; wait_api "$(base_url "$m")/api/health" 30 || die "API indisponivel"
  read -r -p "   E-mail: " email
  read -r -s -p "   Senha: " pass; echo
  local tok; tok="$(api_login "$email" "$pass")"
  [ -n "$tok" ] || die "login falhou"
  local r; r="$(curl -sk --max-time 300 -X POST -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d '{}' "$(base_url "$m")/api/backup/create")"
  printf '%s' "$r" | grep -q '"success":true' && ok "backup criado" || err "falha: $r"
}

# Diagnostico: a coisa mais util quando algo deu errado.
cmd_verify() {
  head_ "DIAGNOSTICO"
  local probs=0
  local os_n; os_n="${PRETTY_NAME:-${OS_NAME:-?}}"
  dim "sistema: $os_n   kernel: $(uname -r)   usuario: $(id -un)"

  if have docker; then
    ok "docker: $(docker --version 2>/dev/null | head -1)"
    docker compose version >/dev/null 2>&1 \
      && ok "compose v2: $(docker compose version 2>/dev/null | head -1)" \
      || { err "plugin 'docker compose' v2 ausente"; probs=$((probs+1)); }
    if docker info >/dev/null 2>&1; then ok "daemon respondendo"
    else err "daemon NAO responde (sudo systemctl start docker)"; probs=$((probs+1)); fi
  else
    err "docker nao instalado"; probs=$((probs+1))
  fi

  if [ -f "$ENV_FILE" ]; then
    ok ".env existe"
    chmod 600 "$ENV_FILE" 2>/dev/null || true
    for k in DB_PASSWORD JWT_SECRET LICENSE_PUBLIC_KEY_B64 MACHINE_UUID MACHINE_MAC CARD_MACHINE_CALLBACK_TOKEN; do
      v="$(get_env "$k")"
      case "$v" in
        ""|cole_aqui*|*TROQUE*) warn "$k vazio/pendente"; probs=$((probs+1)) ;;
        *) dim "$k = ok (${#v} chars)" ;;
      esac
    done
    grep -q '^DRM_BYPASS=true' "$ENV_FILE" && warn "DRM_BYPASS=true - validacao de licenca DESLIGADA"
  else
    err ".env ausente"; probs=$((probs+1))
  fi

  for d in uploads backups certs logs; do
    [ -d "$ROOT/$d" ] || { warn "pasta ./$d ausente (bind mount vai falhar)"; probs=$((probs+1)); }
  done

  if have ss; then
    for p in 80 443; do
      ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$p\$" \
        && dim "porta $p em uso (esperado: o proxy)" || warn "porta $p livre (o proxy vai subir)"
    done
  fi

  if docker_ok; then
    echo
    dc ps 2>/dev/null | sed 's/^/   /'
    echo
    local h; h="$(curl -sk --max-time 10 -o /dev/null -w '%{http_code}' https://localhost/api/health 2>/dev/null)"
    case "$h" in 200) ok "API respondendo (https://localhost/api/health)" ;;
               000) warn "API nao responde ainda (pode ser o primeiro boot: ./instalar.sh logs)" ;;
               *)   warn "API respondeu HTTP $h" ;; esac
  fi

  echo
  if [ "$probs" -eq 0 ]; then
    ok "nenhum problema bloqueante encontrado"
  else
    err "$probs problema(s) - veja as linhas acima"
    say "      documento: INSTALACAO-CONFIGURACAO.txt" "$C_DIM"
  fi
  return 0
}

cmd_reset() {
  head_ "RESET TOTAL - APAGA O BANCO DE DADOS"
  warn "remove containers, o volume do PostgreSQL e TODOS os registros."
  warn "backups em ./backups NAO sao apagados."
  read -r -p "   Digite APAGAR para confirmar: " c
  [ "$c" = "APAGAR" ] || { warn "cancelado"; return 0; }
  dc down -v --remove-orphans >/dev/null 2>&1 && ok "reset concluido" || err "falha"
}

# =============================================================================
#  main
# =============================================================================
ACTION="${1:-instalar}"
case "$ACTION" in
  --teste|-t) OS_MODE="teste"; ACTION="instalar" ;;
  --preparar|-p) ACTION="preparar" ;;
  --senha-docker) ACTION="preparar" ;;   # alias legado: so o Docker
  -h|--help|help)
    # imprime o cabecalho de comentario, sem os "#" e sem as linhas em branco
    sed -n '2,26p' "$0" | sed -e 's/^#\{1,\} \{0,1\}//' -e '/^$/d'
    exit 0 ;;
esac

case "$ACTION" in
  instalar)
    say "============================================================"
    say "   PAPATEC - SISTEMA LOJA   |   INSTALADOR LINUX"
    say "============================================================"
    [ "$(id -u)" -ne 0 ] || say "   (rodando como root)"
    ensure_docker      || die "Docker indisponivel - instale manualmente e rode de novo"
    ensure_env         || die "configure o LICENSE_PUBLIC_KEY_B64 no .env e rode de novo"
    ensure_dirs
    check_ports
    install_app
    ;;
  preparar)
    say "============================================================"
    say "   PAPATEC - PREPARANDO A MAQUINA (sem build)"
    say "============================================================"
    ensure_docker || die "Docker indisponivel"
    ensure_env    || die "configure o LICENSE_PUBLIC_KEY_B64 no .env e rode de novo"
    ensure_dirs
    head_ "MAQUINA PRONTA"
    say "   Docker + .env + pastas: OK" "$C_OK"
    say "   Agora rode:  sudo ./instalar.sh" "$C_OK"
    ;;
  status)    cmd_status ;;
  logs)      cmd_logs ;;
  stop)      cmd_stop ;;
  start)     cmd_start ;;
  update)    cmd_update ;;
  backup)    cmd_backup ;;
  licenca)   cmd_license ;;
  verificar) cmd_verify ;;
  reset)     cmd_reset ;;
  *)
    err "comando desconhecido: '$ACTION'"
    say "  use: instalar | --teste | so-docker | status | logs | stop | start | update | backup | licenca | verificar | reset" >&2
    exit 2 ;;
esac