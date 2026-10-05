#!/bin/sh
mkdir -p /app/prisma/migrations/20260930050000_calendar_sales_commission
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel ./prisma/schema.prisma --script > /app/prisma/migrations/20260930050000_calendar_sales_commission/migration.sql
npx prisma migrate deploy
npx prisma generate