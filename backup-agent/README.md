# backup-agent (opcional)

Segunda via de backup **independente** do PapaTec - Sistema Loja.

O sistema já possui backup embutido (agendado pela própria API, ZIP nível 9,
gerido pela interface em *Configurações → Backup*). Este agent existe para
quem quer uma cópia feita **fora da aplicação**, direto no PostgreSQL
(`pg_dump`), no mesmo horário ou em horários diferentes.

- `pg_dump` do banco + pasta `uploads/`
- Compactação `tar.gz`
- Agendamento por cron **do container** (variável `BACKUP_SCHEDULE`)
- Retenção automática (`RETENTION_DAYS`)
- Cópia opcional para destinos remotos (`SYNC_DESTINATIONS`)
- Restauração manual via `restore.sh`

## Como habilitar

Adicione este serviço ao final de `docker-compose.yml` (mesma rede dos demais):

```yaml
  # ------------------------------------------------------------------
  # Backup externo (opcional) - pg_dump direto, fora da aplicação
  # ------------------------------------------------------------------
  backup-agent:
    build: ./backup-agent
    image: papatec-backup-agent
    container_name: papatec-backup-agent
    restart: unless-stopped
    environment:
      TZ: America/Sao_Paulo
      BACKUP_SCHEDULE: ${BACKUP_SCHEDULE:-0 12,18 * * *}
      POSTGRES_HOST: db
      POSTGRES_USER: ${DB_USER:-papatec}
      POSTGRES_DB: ${DB_NAME:-papatec}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      RETENTION_DAYS: ${RETENTION_DAYS:-30}
      UPLOADS_DIR: /uploads
      SYNC_DESTINATIONS: ${SYNC_DESTINATIONS:-}
    volumes:
      - ./backups:/backups
      - ./uploads:/uploads:ro
    depends_on:
      db:
        condition: service_healthy
    networks:
      - papatec-internal
```

Depois:

```powershell
docker compose up -d --build backup-agent
docker compose logs -f backup-agent     # acompanha a primeira execução
```

## Restauração

```powershell
docker compose exec backup-agent /scripts/restore.sh papatec-backup-AAAA-MM-DD_HHMMSS.tar.gz
```

O script pede confirmação (`SIM`) antes de sobrescrever banco e uploads.

## Notas

- Arquivos gerados: `backups/papatec-backup-<data_hora>.tar.gz`
- Conteúdo: `database.sql`, `uploads/` e `manifest.json`
- Logs: `docker compose logs backup-agent` (também `/var/log/backup.log`)
- Este agent usa a **mesma pasta** `./backups` do backup embutido — os formatos
  diferem (`.tar.gz` aqui, `.zip` no backup embutido), então não há colisão.
