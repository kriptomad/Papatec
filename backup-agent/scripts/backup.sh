#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Backup agent (opcional) - pg_dump + uploads compactados com tar.gz
# Agendado pelo cron do próprio container (BACKUP_SCHEDULE).
# ---------------------------------------------------------------------------

BACKUP_DIR="/backups"
PG_HOST="${POSTGRES_HOST:-db}"
PG_USER="${POSTGRES_USER:-papatec}"
PG_DB="${POSTGRES_DB:-papatec}"
PG_PASSWORD="${POSTGRES_PASSWORD:-}"
UPLOADS_DIR="${UPLOADS_DIR:-/uploads}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
SYNC_DESTINATIONS="${SYNC_DESTINATIONS:-}"
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
BACKUP_NAME="papatec-backup-${TIMESTAMP}"
TEMP_DIR="/tmp/${BACKUP_NAME}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

cleanup() {
    rm -rf "${TEMP_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

log "=== Iniciando backup PapaTec - Sistema Loja ==="
mkdir -p "${TEMP_DIR}" "${BACKUP_DIR}"

# 1. Backup do banco de dados ------------------------------------------------
log "Fazendo dump do PostgreSQL (${PG_HOST}/${PG_DB})..."
export PGPASSWORD="${PG_PASSWORD}"
if ! pg_dump -h "${PG_HOST}" -U "${PG_USER}" -d "${PG_DB}" \
    --no-owner --no-privileges --clean --if-exists \
    > "${TEMP_DIR}/database.sql"; then
    log "ERRO: falha no pg_dump"
    exit 1
fi
log "Dump do banco concluído: $(du -h "${TEMP_DIR}/database.sql" | cut -f1)"

# 2. Backup dos uploads (se existir) ----------------------------------------
if [ -d "${UPLOADS_DIR}" ] && [ -n "$(ls -A "${UPLOADS_DIR}" 2>/dev/null)" ]; then
    log "Copiando uploads..."
    cp -r "${UPLOADS_DIR}" "${TEMP_DIR}/uploads"
    log "Uploads copiados: $(du -sh "${TEMP_DIR}/uploads" | cut -f1)"
else
    log "Diretório de uploads vazio ou inexistente, pulando..."
    mkdir -p "${TEMP_DIR}/uploads"
fi

# 3. Manifest ----------------------------------------------------------------
cat > "${TEMP_DIR}/manifest.json" <<EOF
{
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "version": "1.0",
    "format": "tar.gz",
    "database": "database.sql",
    "uploads": "uploads/",
    "hostname": "$(hostname)",
    "pgVersion": "$(pg_dump --version | head -1)"
}
EOF

# 4. Compacta ----------------------------------------------------------------
log "Compactando backup..."
if ! tar -czf "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" -C "/tmp" "${BACKUP_NAME}"; then
    log "ERRO: falha na compactação"
    exit 1
fi
log "Backup criado: ${BACKUP_DIR}/${BACKUP_NAME}.tar.gz ($(du -h "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" | cut -f1))"

# 5. Limpeza de backups antigos ---------------------------------------------
log "Removendo backups com mais de ${RETENTION_DAYS} dias..."
find "${BACKUP_DIR}" -name "papatec-backup-*.tar.gz" -type f -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
REMAINING=$(ls -1 "${BACKUP_DIR}"/papatec-backup-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
log "Backups restantes: ${REMAINING}"

# 6. Sincronização para destinos remotos (SMB/NFS já montados no container) --
if [ -n "${SYNC_DESTINATIONS}" ]; then
    log "Sincronizando para destinos remotos..."
    IFS=';' read -ra DESTS <<< "${SYNC_DESTINATIONS}"
    for DEST in "${DESTS[@]}"; do
        DEST=$(echo "${DEST}" | xargs)
        if [ -n "${DEST}" ]; then
            if mkdir -p "${DEST}" 2>/dev/null && cp "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" "${DEST}/" 2>/dev/null; then
                log "  OK  sincronizado para ${DEST}"
            else
                log "  AVISO  falha ao sincronizar para ${DEST} (destino indisponível?)"
            fi
        fi
    done
fi

log "=== Backup concluído com sucesso ==="
