# Backup agent OPCIONAL do PapaTec - Sistema Loja.
# Segunda via de backup independente da aplicação: pg_dump direto do
# PostgreSQL + uploads, compactados em tar.gz e agendados por cron do
# próprio container.
FROM alpine:3.19

RUN apk add --no-cache \
    postgresql-client \
    bash \
    curl \
    tzdata \
    dcron

ENV TZ=America/Sao_Paulo
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone \
    && mkdir -p /backups /scripts /var/log /uploads

COPY scripts/ /scripts/
RUN chmod +x /scripts/*.sh

ENTRYPOINT ["/scripts/entrypoint.sh"]
