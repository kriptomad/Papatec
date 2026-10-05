#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Restauração do backup gerado pelo backup-agent
# Uso: ./restore.sh papatec-backup-AAAA-MM-DD_HHMMSS.tar.gz
# ---------------------------------------------------------------------------

BACKUP_FILE="${1:-}"
BACKUP_DIR="/backups"
PG_HOST="${POSTGRES_HOST:-db}"
PG_USER="${POSTGRES_USER:-papatec}"
PG_DB="${POSTGRES_DB:-papatec}"
PG_PASSWORD="${POSTGRES_PASSWORD:-}"
UPLOADS_DIR="${UPLOADS_DIR:-/uploads}"

if [ -z "${BACKUP_FILE}" ]; then
    echo "Uso: $0 <arquivo_backup.tar.gz>"
    echo "Backups disponíveis:"
    ls -1h "${BACKUP_DIR}"/papatec-backup-*.tar.gz 2>/dev/null || echo "  Nenhum backup encontrado"
    exit 1
fi

BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"
if [ ! -f "${BACKUP_PATH}" ]; then
    echo "ERRO: arquivo não encontrado: ${BACKUP_PATH}"
    exit 1
fi

echo "=== ATENÇÃO ==="
echo "Esta operação vai SOBRESCREVER o banco de dados e os uploads atuais!"
echo "Backup: ${BACKUP_FILE}"
echo ""
read -r -p "Tem certeza? Digite 'SIM' para confirmar: " CONFIRM
if [ "${CONFIRM}" != "SIM" ]; then
    echo "Operação cancelada."
    exit 1
fi

TEMP_DIR="/tmp/restore-$(date +%s)"
mkdir -p "${TEMP_DIR}"
trap 'rm -rf "${TEMP_DIR}"' EXIT

echo "Extraindo backup..."
tar -xzf "${BACKUP_PATH}" -C "${TEMP_DIR}"

EXTRACTED_DIR=$(find "${TEMP_DIR}" -maxdepth 1 -type d -name "papatec-backup-*" | head -1)
if [ -z "${EXTRACTED_DIR}" ]; then
    echo "ERRO: não foi possível localizar o diretório extraído"
    exit 1
fi

echo "Restaurando banco de dados..."
export PGPASSWORD="${PG_PASSWORD}"
if ! psql -h "${PG_HOST}" -U "${PG_USER}" -d "${PG_DB}" -v ON_ERROR_STOP=1 < "${EXTRACTED_DIR}/database.sql"; then
    echo "ERRO: falha ao restaurar o banco de dados"
    exit 1
fi

if [ -d "${EXTRACTED_DIR}/uploads" ]; then
    echo "Restaurando uploads..."
    rm -rf "${UPLOADS_DIR}"
    mkdir -p "${UPLOADS_DIR}"
    cp -r "${EXTRACTED_DIR}/uploads"/. "${UPLOADS_DIR}/"
    echo "Uploads restaurados."
fi

echo "=== Restauração concluída com sucesso ==="
