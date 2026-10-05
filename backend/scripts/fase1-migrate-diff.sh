#!/bin/sh
# ---------------------------------------------------------------------------
# Fase 1 - gera o SQL da migracao comparando o banco ATUAL com o schema novo.
# Roda DENTRO do container api (DATABASE_URL = host "db" correto).
# Uso: docker compose exec -T api sh scripts/fase1-migrate-diff.sh
# ---------------------------------------------------------------------------
set -e
STAMP="20260929150000_fase1_cadastros_compras"
DIR="prisma/migrations/$STAMP"

echo "[1/2] validando schema..."
npx prisma validate

echo "[2/2] gerando diff (banco atual -> schema novo)..."
mkdir -p "$DIR"
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$DIR/migration.sql"

echo "--- migration.sql gerado em $DIR ---"
wc -l < "$DIR/migration.sql"
