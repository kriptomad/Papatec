#!/bin/sh
# ---------------------------------------------------------------------------
# Fase 1 - aplica as migracoes pendentes e regenera o cliente Prisma.
# Uso: docker compose exec -T api sh scripts/fase1-deploy.sh
# ---------------------------------------------------------------------------
set -e
echo "[1/2] prisma migrate deploy..."
npx prisma migrate deploy

echo "[2/2] prisma generate..."
npx prisma generate

echo "MIGRATE_OK"
