#!/bin/sh
set -e

# Gera o crontab em tempo de execução (a variável BACKUP_SCHEDULE vem do
# docker-compose, então precisa ser lida aqui e não na imagem).
SCHEDULE="${BACKUP_SCHEDULE:-0 12,18 * * *}"

echo "[entrypoint] Agendando backup com cron: ${SCHEDULE}"
echo "${SCHEDULE} /scripts/backup.sh >> /var/log/backup.log 2>&1" > /etc/crontabs/root
crontab -l || true

exec crond -f -l 2
