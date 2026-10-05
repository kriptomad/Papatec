# Builder Debian 12 (bookworm, OpenSSL 3.0) de PROPOSITO: precisa ser a mesma
# familia do runtime Distroless Debian 12. Com builder alpine (musl), o Prisma
# baixa engines "linux-musl-*" e no boot ele procura "debian-openssl-3.0.x",
# nao acha, tenta BAIXAR (quebra offline) e ainda nao consegue escrever no
# node_modules (dono root, container roda como nonroot).
FROM node:20-slim AS builder

# Chave pública da licença (somente para conferência durante o build;
# em runtime o valor é injetado via environment no docker-compose.yml)
ARG LICENSE_PUBLIC_KEY_B64=""

WORKDIR /app

# Pastas gravaveis pelo usuario nonroot. Vao para a imagem final via COPY.
# O .gitkeep e necessario porque o Docker ignora diretorio vazio.
RUN mkdir -p /app/uploads /app/logs \
    && touch /app/uploads/.gitkeep /app/logs/.gitkeep

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ libssl-dev openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate

RUN npm run build

# Mantém apenas dependências de produção (prisma CLI permanece em dependencies
# para aplicar as migrações em runtime).
RUN npm prune --production

# ---------------------------------------------------------------- Runtime
# Debian 12 (bookworm) = mesma base do builder -> engines Prisma
# "debian-openssl-3.0.x" ja presentes em node_modules (migra offline).
FROM gcr.io/distroless/nodejs20-debian12 AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# --chown=nonroot: o container roda como nonroot (uid 65532) e o Prisma
# precisa de acesso de escrita em @prisma/engines para o ensure-binaries.
COPY --from=builder --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=builder --chown=nonroot:nonroot /app/prisma ./prisma
COPY --from=builder --chown=nonroot:nonroot /app/package.json ./package.json
COPY --from=builder --chown=nonroot:nonroot /app/dist/bundle.obfuscated.js ./bundle.js
COPY --from=builder --chown=nonroot:nonroot /app/entrypoint.js ./entrypoint.js

# Pastas que o boot precisa criar. A imagem final e Distroless (sem shell, sem
# mkdir), entao elas nascem aqui no builder e vem por COPY com o dono certo.
# Sem isso o `ensureUploadsDir()` do main.ts leva EACCES: o container roda como
# nonroot e /app pertence ao root. No docker-compose local nao aparecia porque
# o bind mount ./uploads:/app/uploads criava a pasta antes do boot - em quem
# nao monta volume (Render, por exemplo) o boot morria.
# O .gitkeep existe porque o Docker nao copia diretorio vazio.
COPY --from=builder --chown=nonroot:nonroot /app/uploads/.gitkeep ./uploads/.gitkeep
COPY --from=builder --chown=nonroot:nonroot /app/logs/.gitkeep ./logs/.gitkeep

# Diretórios de trabalho (uploads e backups) - o usuário nonroot precisa escrever
# (mounts do docker-compose cobrem /app/uploads e /backups)

USER nonroot:nonroot

EXPOSE 3001

# A imagem Distroless já declara ENTRYPOINT ["/nodejs/bin/node"]. O CMD deve
# ser APENAS o script: com "node" aqui a execução vira `node node ...` e o
# Node falha com "Cannot find module '/app/node'" (crash loop em produção).
CMD ["entrypoint.js"]
