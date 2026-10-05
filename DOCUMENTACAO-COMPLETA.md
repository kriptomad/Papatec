# PapaTec — Sistema Loja · Documentação Completa

> **Produto:** `PapaTec - Sistema Loja` (ERP on-premise para assistência técnica / loja de informática)
> **Licenciamento:** sistema licenciado e distribuído pela **Filitech** (DRM offline challenge-response)
> **Repositório/pacote:** pasta `PapaTec ERP` — a identidade/nome do produto aparece em rótulos, telas e documentação; o nome da pasta e as referências de caminho permanecem `PapaTec ERP`
> **Data desta revisão:** 29/09/2026

Este documento concentra **tudo** sobre o aplicativo: arquitetura, todas as rotas, todas as chamadas HTTP do frontend, regras de negócio, DRM, backup, segurança, configuração, comandos, decisões técnicas e o backlog de ideias.

---

## Índice

1. [Resumo do produto](#1-resumo-do-produto)
2. [Identidade e marca](#2-identidade-e-marca)
3. [Arquitetura](#3-arquitetura)
4. [Estrutura de pastas](#4-estrutura-de-pastas)
5. [Modos de execução e comandos](#5-modos-de-execução-e-comandos)
6. [Backend — pipeline, envelope e middlewares](#6-backend--pipeline-envelope-e-middlewares)
7. [Todas as rotas HTTP](#7-todas-as-rotas-http)
8. [Frontend — telas e rotas](#8-frontend--telas-e-rotas)
9. [Todas as chamadas do frontend (api.ts)](#9-todas-as-chamadas-do-frontend-apits)
10. [Frontend — camadas, componentes e estilos](#10-frontend--camadas-componentes-e-estilos)
11. [Modelo de dados (Prisma)](#11-modelo-de-dados-prisma)
12. [Funcionalidades de negócio por módulo](#12-funcionalidades-de-negócio-por-módulo)
13. [DRM / Licenciamento](#13-drm--licenciamento)
14. [Backup](#14-backup)
15. [Segurança e anti-reversa](#15-segurança-e-anti-reversa)
16. [Configuração, ambiente e infra](#16-configuração-ambiente-e-infra)
17. [Qualidade e auditoria](#17-qualidade-e-auditoria)
18. [Ideias, melhorias e backlog](#18-ideias-melhorias-e-backlog)
19. [Decisões técnicas e histórico de correções](#19-decisões-técnicas-e-histórico-de-correções)
20. [Checklist de smoke test](#20-checklist-de-smoke-test)

---

## 1. Resumo do produto

ERP completo, **100% on-premise** (roda na máquina do cliente, sem dependência de nuvem), para gestão de assistência técnica/loja:

| Módulo | O que faz |
|---|---|
| **Dashboard** | KPIs: orçamentos (30d), O.S. entregues, clientes com O.S. ativa, peças com estoque baixo |
| **Clientes** | Cadastro completo (CPF único), histórico de orçamentos e O.S., filtro "com O.S. ativa" |
| **Orçamentos** | Equipamentos, defeito, itens (peça/serviço/mão de obra), fotos, máquina de status, conversão em O.S. com baixa de estoque (ACID) |
| **Ordens de Serviço** | Numeração sequencial, técnico, timeline de status, fotos, garantia, itens com estoque (ACID) |
| **Estoque** | SKUs únicos, custo/venda, mínimo, movimentações (IN/OUT/ADJUSTMENT), estoque baixo, valoração |
| **Catálogo de serviços** | 12 serviços padrão semeados no boot, CRUD por categoria/horas estimadas (ADMIN) |
| **Financeiro** | Despesas por categoria (7 categorias), resumos mensal/anual/por categoria (ADMIN) |
| **Relatórios** | Valoração de estoque, DRE mensal/anual, movimentações do mês, top itens/serviços (ADMIN) |
| **Configurações** | Painel admin com 7 abas: Empresa, Padrões, Backup, Inventário, Serviços, Financeiro, Usuários |
| **Backup** | ZIP nível 9 (banco JSON + uploads), cron 12h/18h, restauração transacional, sync de rede |
| **Licença (DRM)** | Ativação offline challenge-response, trava global em 403 se inválida |

**Papéis:** `ADMIN` · `TECHNICIAN` · `RECEPTIONIST` (limite de usuários = `maxUsers` da licença).

---

## 2. Identidade e marca

| Item | Detalhe |
|---|---|
| Nome do produto | **PapaTec - Sistema Loja** (rótulos, telas, títulos) |
| Nome da pasta/pacote | `PapaTec ERP` (inalterado — referências de caminho) |
| Licenciador | Filitech |
| Logo horizontal | `frontend/public/logo-papatec.png` (900×220) — **Header** (à esquerda do Toolbar, h≈22–26px) e **Login** (h≈56/72px responsivo) |
| Marca recortada (quadrada) | `frontend/public/logo-papatec-marca.png` (215×215) — **Sidebar** (30px) e favicon/app icons |
| Logo vertical (empilhada) | `frontend/public/logo-papatec-vertical.png` (566×390) — reservada para materiais impressos |
| Favicon | `frontend/public/favicon.png` (64×64) — `index.html` → `<link rel="icon" href="/favicon.png">` + `apple-touch-icon` |
| Ativação da licença | `LicenseActivation.tsx` usa a logo em chip branco sobre o card escuro |
| Títulos | Login exibe logo + caption "SISTEMA LOJA"; página de ativação: "Ativação da Licença" |

---

## 3. Arquitetura

### 3.1 Diagrama (modo PRODUÇÃO)

```
                      ┌──────────────────────────────────────────────┐
   https://localhost   │  proxy (nginx) :80/:443                      │
  ───────────────────► │   TLS auto-assinado (certs/)                 │
                       │   /            → web (SPA estática)         │
                       │   /api/        → api:3001                   │
                       │   /uploads/    → api:3001 (cache 200 1d)    │
                       └───────┬──────────────────────┬──────────────┘
                               │                      │
                 ┌─────────────▼──────────┐  ┌────────▼─────────────────────┐
                 │ web (nginx)            │  │ api (Express + TS)           │
                 │ SPA buildada (Vite)    │  │ bundle ofuscado (Distroless) │
                 │ try_files → index.html │  │ entrypoint.js → migrate      │
                 └────────────────────────┘  │        deploy + bundle.js    │
                                             │ LicenseGuard + JWT + rotas   │
                                             └────────┬─────────────────────┘
                                                      │ (rede interna)
                                             ┌────────▼─────────────────────┐
                                             │ db (PostgreSQL 15)  volume   │
                                             │ pg_data                      │
                                             └──────────────────────────────┘
        volumes bind: ./uploads → /app/uploads · ./backups → /backups
```

### 3.2 Modo TESTE/DEV (hot-reload)

| Serviço | Porta (host) | Comando | Imagem |
|---|---|---|---|
| `api` | **3001** (+9229 inspect) | `npm run dev` (ts-node-dev) | `backend/Dockerfile.dev` (monta `./backend:/app`) |
| `web` | **5173** (Vite) | `npm run dev -- --host 0.0.0.0` | `frontend/Dockerfile.dev` (monta `./frontend:/app`) |
| `db` | **5432** | postgres:15-alpine | volume `pg_data` |
| `proxy` | — | `profiles: [production]` → **desativado em dev** | — |

Vite faz proxy de `/api` → `http://localhost:3001` (`vite.config.ts`).

### 3.3 Camadas do backend

```
main.ts (bootstrap)  → connectDatabase (retry) → settings.ensureDefaults → seedDefaultServices
                     → ensureUploadsDir → backupService.start (cron) → HTTP listen
app.ts (createApp)   → helmet → cors → json/urlencoded(10mb) → rate-limit global (300/60s)
                     → rate-limit login (20/15min) → logger → LicenseGuard → rotas
                     → notFoundHandler → errorHandler
rotas (12 routers)   → middlewares (requireAuth/requireRole) → services (regras, transações)
services             → license / backup / settings / storage / catalog
utils                → licenseToken (RS256) · machineId (HWID) · logger (JSON/arquivo)
db                   → prisma.ts (PrismaClient singleton)
http                 → envelope.ts (ok/created/fail) · errors.ts (handler/errorHandler)
```

---

## 4. Estrutura de pastas

```
PapaTec ERP/
├── INSTALAR.bat / INSTALAR.ps1      # instalador menu (1=teste, 2=produção, …)
├── DEV-LOCAL.bat / DEV-LOCAL.ps1    # dev com Node local (sem container de api/web)
├── init.ps1 / start.bat             # alternativas de bootstrap
├── docker-compose.yml               # produção (db, api, web, proxy)
├── docker-compose.dev.yml      # dev (hot-reload, portas expostas, proxy off)
├── nginx.conf                       # borda TLS (proxy)
├── .env / .env.example              # variáveis do compose/host
├── README.md · INSTALACAO-CONFIGURACAO.txt
├── DOCUMENTACAO-COMPLETA.md         # ← este arquivo
├── scripts/audit-parity.js          # auditoria frontend↔backend
├── uploads/ · backups/ · certs/     # dados do cliente (criados pelo instalador)
├── backend/
│   ├── Dockerfile                   # builder alpine → Distroless (produção)
│   ├── Dockerfile.dev               # dev com hot-reload
│   ├── entrypoint.js                # prisma migrate deploy (retry 30x) + bundle.js
│   ├── prisma/schema.prisma · prisma/seed.ts
│   └── src/
│       ├── app.ts · main.ts
│       ├── db/prisma.ts
│       ├── http/envelope.ts · http/errors.ts
│       ├── middleware/auth.ts · middleware/license.ts
│       ├── routes/*.routes.ts (14)
│       ├── services/license · backup · settings · storage · catalog
│       └── utils/licenseToken · machineId · logger
├── frontend/
│   ├── Dockerfile · Dockerfile.dev · nginx.conf
│   ├── public/logo-papatec*.png · favicon.png
│   └── src/
│       ├── main.tsx (providers) · App.tsx (rotas+guards) · theme.ts · index.css
│       ├── services/api.ts (axios + todos os endpoints)
│       ├── store/auth.tsx (AuthProvider/useAuth)
│       ├── types/index.ts
│       ├── components/layout/{MainLayout,Sidebar,Header} + .css
│       ├── components/ui/* (shadcn) · components/{Buttons,StatusChips}.tsx
│       └── pages/** (21 páginas)
└── proxy/ · backup-agent/           # imagens auxiliares (backup-agent = opcional)
```

---

## 5. Modos de execução e comandos

### 5.1 Instalador (`INSTALAR.bat` → `INSTALAR.ps1 -Opcao …`)

Menu interativo (9 opções):

| # | Opção | O que faz |
|---|---|---|
| 1 | `teste` | **Instalação teste**: build api+web → db → `prisma migrate deploy` → `seed` → `up -d --build` → aguarda health → ativa licença → abre `http://localhost:5173` |
| 2 | `producao` | Build Distroless+ofuscado → `up -d --build` (proxy 80/443) → aguarda `https://localhost/api/health` → ativa licença → opção de abrir no navegador |
| 3 | `status` | Saúde da API + status da licença |
| 4 | `logs` | `docker compose logs --tail 150 --follow` |
| 5 | `backup` | Submenu: criar / listar / restaurar / limpar |
| 6 | `licenca` | Verificar/ativar licença |
| 7 | `parar` | `compose down` (mantém dados) |
| 8 | `reset` | `compose down -v` (**apaga o banco**) com confirmação |
| 9 | `sair` | Sai |

- **Códigos de saída:** `0` = sucesso; `1` = falha em qualquer etapa (o `.bat` reporta "O instalador terminou com erro (codigo 1)").
- `Ensure-Env` cria `.env` a partir do `.env.example` e gera `DB_PASSWORD` e `JWT_SECRET` (64 chars).
- `Ensure-Folders` cria `uploads/`, `backups/`, `certs/`.

### 5.2 Comandos avulsos

```powershell
# Modo teste (dev containers)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api npm run seed
docker compose -f docker-compose.yml -f docker-compose.dev.yml down

# Modo produção
docker compose up -d --build
docker compose down

# Desenvolvimento com Node local (sobe só o Postgres no Docker)
.\DEV-LOCAL.ps1            # + -Seed para recarregar dados, -Parar para encerrar

# Auditoria de paridade rotas backend ↔ chamadas frontend
node scripts/audit-parity.js

# Builds/qualidade
npm run typecheck          # backend: tsc --noEmit
cd frontend; npm run build # tsc --noEmit && vite build
cd backend;  npm run build # esbuild bundle → javascript-obfuscator (RC4)
```

### 5.3 URLs

| Modo | URL |
|---|---|
| Dev SPA | `http://localhost:5173` |
| Dev API | `http://localhost:3001/api/health` |
| Produção | `https://localhost` (cert auto-assinado, aceite o aviso) |
| Produção API | `https://localhost/api/health` |
| Ativação | `/activate` · Gestão da licença: `/license` |
| Login seed | `admin@papatec.com` / `admin123` (troque após o 1º acesso) |

---

## 6. Backend — pipeline, envelope e middlewares

### 6.1 Ordem dos middlewares globais (`backend/src/app.ts`)

1. `helmet` (L33) → 2. `cors` (L34) → 3. `express.json`/`urlencoded` limit 10 MB (L36-37)
4. Rate-limit global `/api` **300 req/60s** (L40-49)
5. Rate-limit `/api/auth/login` **20 req/15min** (L52-61)
6. Logger de requisições (L64-67)
7. `GET /api/health` inline (L70) — **antes** do guard
8. `express.static('/uploads', { fallthrough, dotfiles: 'deny', index: false })` (L78)
9. **`LicenseGuard`** (L75) — DRM global
10. Rotas (12 routers + 2 aliases) (L83-98)
11. `notFoundHandler` (L101) → `errorHandler` (L102)

### 6.2 Envelope de resposta (todas as rotas)

```jsonc
{ "success": true,  "data": <payload>, "error": null }
{ "success": false, "data": null, "error": { "code": "CODIGO_ERRO", "message": "Mensagem em PT-BR" } }
```

- `backend/src/http/envelope.ts` — `ok` (L12), `created` (L16), `fail` (L20), `AppError` (L25) + helpers `badRequest/unauthorized/forbidden/notFound/conflict`.
- `backend/src/http/errors.ts` — `handler()` converte handler async em `next(err)` (L8); `notFoundHandler` (L15); `errorHandler` (L24) mapeia Prisma `P2002` (duplicado), `P2025` (não encontrado), `P2003` (FK), `P2021` (tabela), `entity.too.large` (413), `MulterError`.

### 6.3 Middlewares de segurança/permissão

| Middleware | Arquivo | Papel |
|---|---|---|
| `LicenseGuard` | `middleware/license.ts:59` | DRM global (ver §13); cache 5 min; `PUBLIC_PATHS` em L39-49; `invalidateLicenseCache()` L127 |
| `requireAuth` | `middleware/auth.ts:33` | `Authorization: Bearer` + `verify(JWT_SECRET)` + carrega usuário + `active`; erros `TOKEN_EXPIRED`/`Token inválido` |
| `requireRole(...)` | `middleware/auth.ts:68` | Restringe papel; erro `ADMIN_ONLY` |
| `sanitizeUser()` | `middleware/auth.ts:79` | Remove hash de senha das respostas |

> **Importante:** como `LicenseGuard` é global, **toda rota fora de `PUBLIC_PATHS` exige licença válida**, mesmo sem `requireAuth`.

---

## 7. Todas as rotas HTTP

**Legenda de proteção:** 🔓 = pública (sem licença nem JWT) · 🔑 = só licença DRM (sem JWT) · 👤 = JWT · 🛡️ = JWT + ADMIN

### 7.1 Infraestrutura

| Método | Rota | Proteção | Onde |
|---|---|---|---|
| GET | `/api/health` | 🔓 | `app.ts:70` |
| static | `/uploads/**` | 🔓 | `app.ts:78` (`express.static`) |

### 7.2 `/api/auth` (`routes/auth.routes.ts`)

| Método | Rota | Proteção | Linha |
|---|---|---|---|
| POST | `/api/auth/login` | 🔓 + rate 20/15min | 22 |
| GET | `/api/auth/setup-status` | 🔓 | 48 |
| POST | `/api/auth/setup-admin` | 🔓 (só se `user.count === 0`) | 57 |
| POST | `/api/auth/register` | 👤 + checagem ADMIN interna (L91) + `maxUsers` | 84 |
| GET | `/api/auth/profile` | 👤 | 129 |
| PUT | `/api/auth/password` | 👤 | 140 |
| GET | `/api/auth/license/status` | 🔑 | 164 |
| POST | `/api/auth/license/install` | 🔓 | 172 |
| POST | `/api/auth/license/deactivate` | 👤 + 🔑 | 196 |

Handler local `signToken(userId)` (L14): `JWT_SECRET` + `session_days` das settings.

### 7.3 `/api/license` (`routes/license.routes.ts`)

| Método | Rota | Proteção | Linha |
|---|---|---|---|
| GET | `/api/license/challenge` | 🔓 | 10 |
| GET | `/api/license/status` | 🔓 | 18 |
| POST | `/api/license/activate` | 🔓 | 26 |
| POST | `/api/license/deactivate` | 🔑 | 36 |

Nenhuma rota deste router usa `requireAuth`.

### 7.4 `/api/users` (`routes/users.routes.ts` — `use(requireAuth)` L11)

| Método | Rota | Permissão | Linha |
|---|---|---|---|
| GET | `/api/users/technicians` | 👤 | 22 |
| GET | `/api/users` | 👤 | 35 |
| GET | `/api/users/:id` | 👤 | 61 |
| POST | `/api/users` | 🛡️ (+`maxUsers`) | 71 |
| PUT | `/api/users/:id` | 🛡️ (`SELF_LOCKOUT`) | 106 |
| PUT | `/api/users/:id/toggle-active` | 🛡️ | 145 |
| DELETE | `/api/users/:id` | 🛡️ (`LAST_ADMIN`) | 162 |

### 7.5 `/api/clients` (`routes/clients.routes.ts` — `use(requireAuth)` L9)

| Método | Rota | Linha |
|---|---|---|
| GET | `/api/clients` | 35 |
| GET | `/api/clients/:id` | 92 |
| GET | `/api/clients/:id/history` | 105 |
| POST | `/api/clients` | 129 |
| PUT | `/api/clients/:id` | 143 |
| DELETE | `/api/clients/:id` | 161 |

### 7.6 `/api/budgets` — alias `/api/quotes` (`routes/budgets.routes.ts` — `use(requireAuth)` L13)

| Método | Rota | Linha |
|---|---|---|
| GET | `/api/budgets/stats` | 117 |
| GET | `/api/budgets` | 142 |
| GET | `/api/budgets/:id` | 183 |
| POST | `/api/budgets` (multipart, até 10 fotos) | 193 |
| PUT | `/api/budgets/:id` (multipart) | 240 |
| PUT | `/api/budgets/:id/status` | 305 |
| POST | `/api/budgets/:id/convert-to-os` **(ACID)** | 329 |
| DELETE | `/api/budgets/:id` | 446 |
| GET | `/api/budgets/:id/attachment/:attachmentId` | 469 |

### 7.7 `/api/service-orders` — alias `/api/work-orders` (`routes/serviceOrders.routes.ts` — `use(requireAuth)` L12)

| Método | Rota | Linha |
|---|---|---|
| GET | `/api/service-orders/stats` | 87 |
| GET | `/api/service-orders` | 112 |
| GET | `/api/service-orders/:id` | 159 |
| GET | `/api/service-orders/:id/timeline` | 169 |
| POST | `/api/service-orders` (multipart) **(ACID)** | 185 |
| PUT | `/api/service-orders/:id` (multipart) **(ACID)** | 279 |
| PUT | `/api/service-orders/:id/status` **(ACID)** | 370 |
| PUT | `/api/service-orders/:id/assign` | 417 |
| POST | `/api/service-orders/:id/items` **(ACID)** | 439 |
| DELETE | `/api/service-orders/:id/items/:itemId` **(ACID)** | 496 |
| POST | `/api/service-orders/:id/photos` | 531 |
| DELETE | `/api/service-orders/photos/:photoId` | 554 |
| DELETE | `/api/service-orders/:id` **(ACID)** | 566 |
| GET | `/api/service-orders/photo/:photoId` | 604 |

### 7.8 `/api/inventory` (`routes/parts.routes.ts` — `use(requireAuth)` L9)

| Método | Rota | Linha |
|---|---|---|
| GET | `/api/inventory/stats` | 44 |
| GET | `/api/inventory/low-stock` | 89 |
| GET | `/api/inventory/categories` | 101 |
| GET | `/api/inventory` | 115 |
| GET | `/api/inventory/:id` | 154 |
| GET | `/api/inventory/:id/movements` | 170 |
| POST | `/api/inventory` **(ACID)** | 190 |
| PUT | `/api/inventory/:id` | 218 |
| PUT | `/api/inventory/:id/toggle-status` | 236 |
| POST | `/api/inventory/:id/stock` **(ACID)** | 250 |
| DELETE | `/api/inventory/:id` | 298 |
| GET | `/api/inventory/movements/monthly` | 322 |

### 7.9 `/api/services` — catálogo (`routes/services.routes.ts` — `use(requireAuth)` L10)

| Método | Rota | Permissão | Linha |
|---|---|---|---|
| GET | `/api/services/by-category` | 👤 | 13 |
| GET | `/api/services` | 👤 | 29 |
| GET | `/api/services/:id` | 👤 | 45 |
| POST | `/api/services` | 🛡️ | 55 |
| PUT | `/api/services/:id` | 🛡️ | 83 |
| PUT | `/api/services/:id/toggle` | 🛡️ | 116 |
| DELETE | `/api/services/:id` | 🛡️ | 131 |
| POST | `/api/services/init` | 🛡️ | 156 |

### 7.10 `/api/expenses` — financeiro (`routes/expenses.routes.ts` — `use(requireAuth)` L9)

| Método | Rota | Permissão | Linha |
|---|---|---|---|
| GET | `/api/expenses/summary/monthly` | 👤 | 30 |
| GET | `/api/expenses/summary/yearly` | 👤 | 55 |
| GET | `/api/expenses/summary/by-category` | 👤 | 83 |
| GET | `/api/expenses` | 👤 | 115 |
| GET | `/api/expenses/:id` | 👤 | 142 |
| POST | `/api/expenses` | 🛡️ | 152 |
| PUT | `/api/expenses/:id` | 🛡️ | 163 |
| DELETE | `/api/expenses/:id` | 🛡️ | 176 |

### 7.11 `/api/reports` (`routes/reports.routes.ts` — `use(requireAuth, requireRole('ADMIN'))` L11 — router inteiro 🛡️)

| Método | Rota | Linha |
|---|---|---|
| GET | `/api/reports/inventory-valuation` | 22 |
| GET | `/api/reports/profit-loss/monthly` | 69 |
| GET | `/api/reports/profit-loss/yearly` | 128 |
| GET | `/api/reports/movements/monthly` | 185 |
| GET | `/api/reports/top-items` | 220 |
| GET | `/api/reports/top-services` | 266 |

### 7.12 `/api/settings` (`routes/settings.routes.ts` — todas 🛡️)

| Método | Rota | Linha |
|---|---|---|
| GET | `/api/settings/catalog` | 12 |
| GET | `/api/settings/category/:category` | 21 |
| GET | `/api/settings` | 30 |
| PUT | `/api/settings` | 39 |
| POST | `/api/settings/init` | 50 |
| PUT | `/api/settings/:key` | 60 |

### 7.13 `/api/backup` (`routes/backup.routes.ts` — todas 🛡️)

| Método | Rota | Linha |
|---|---|---|
| GET | `/api/backup/list` | 13 |
| GET | `/api/backup/config` | 27 |
| POST | `/api/backup/create` | 37 |
| POST | `/api/backup/cleanup` | 46 |
| POST | `/api/backup/restore/:file` | 56 |
| POST | `/api/backup/sync/:file` | 65 |
| DELETE | `/api/backup/:file` | 74 |

### 7.14 `/api/suppliers` (`routes/suppliers.routes.ts` — `use(requireAuth)` L15 — 🆕 Fase 1)

| Método | Rota | Linha |
|---|---|---|
| GET | `/api/suppliers/options` | 71 |
| GET | `/api/suppliers` | 84 |
| GET | `/api/suppliers/:id` | 123 |
| POST | `/api/suppliers` | 142 |
| PUT | `/api/suppliers/:id` | 158 |
| PUT | `/api/suppliers/:id/toggle-active` | 195 |
| DELETE | `/api/suppliers/:id` | 173 |

> Códigos `FOR-NNNN` (tabela `Sequence`); CPF/CNPJ único (`SUPPLIER_DUPLICATE_DOCUMENT`);
> exclusão bloqueada com compras (`SUPPLIER_HAS_PURCHASES`); `GET /:id` inclui o
> histórico de compras. No frontend o menu é restrito a `ADMIN`/`TECHNICIAN`.

### 7.15 `/api/purchases` (`routes/purchases.routes.ts` — `use(requireAuth)` L22 — 🆕 Fase 1)

| Método | Rota | Linha |
|---|---|---|
| GET | `/api/purchases` | 101 |
| GET | `/api/purchases/:id` | 148 |
| POST | `/api/purchases` **(ACID)** | 165 |
| DELETE | `/api/purchases/:id` **(ACID)** | 274 |

> **Núcleo de negócio:** transação `Serializable` — cria compra → incrementa
> estoque por item → recalcula `costPrice` por **média ponderada** com o rateio
> `extra = frete + imposto − desconto` proporcional ao valor de cada item →
> grava `unitCost`. `DELETE` reverte as entradas de estoque (custo **não** é
> recalculado — comportamento documentado e alertado na UI). Códigos `COM-NNNN`
> via `Sequence`. No frontend o menu é restrito a `ADMIN`/`TECHNICIAN`.

### 7.16 Resumo "público vs protegido"

| Classe | Rotas |
|---|---|
| 🔓 Públicas | `GET /api/health`, `GET /api/license/challenge`, `GET /api/license/status`, `POST /api/license/activate`, `POST /api/auth/login`, `GET /api/auth/setup-status`, `POST /api/auth/setup-admin`, `POST /api/auth/license/install`, `/uploads` |
| 🔑 Só licença (sem JWT) | `POST /api/license/deactivate`, `GET /api/auth/license/status` |
| 👤 JWT | clients, budgets, service-orders, inventory, services (leitura), expenses (leitura), users (leitura), **suppliers**, **purchases**, `auth/profile`, `auth/password`, `auth/register` |
| 🛡️ JWT + ADMIN | users (escrita), services (escrita), expenses (escrita), **reports (todas)**, **settings (todas)**, **backup (todas)** |

> **Notas:** não existe `uploads.routes.ts` / `health.routes.ts` (health é inline; uploads é `express.static` + multer). Os aliases `/api/quotes` e `/api/work-orders` (`app.ts:97-98`) apontam para os mesmos routers de budgets e service-orders.

---

## 8. Frontend — telas e rotas

### 8.1 Guards (`frontend/src/App.tsx`)

- `PrivateRoute` (L21): exige `isAuthenticated`, senão → `/login`
- `PublicRoute` (L26): só para não autenticado, senão → `/dashboard`
- `AdminRoute` (L32): exige `user.role === 'ADMIN'`, senão → `/dashboard`

### 8.2 Tabela de rotas

| Caminho | Guard/Layout | Componente | Arquivo |
|---|---|---|---|
| `/login` | `PublicRoute` | `LoginPage` | `pages/auth/LoginPage.tsx` |
| `/activate` | `PublicRoute` | `LicenseActivation` | `pages/LicenseActivation.tsx` |
| `/license` | `PrivateRoute` | `LicensePage` | `pages/license/LicensePage.tsx` |
| `/` | `PrivateRoute` + `MainLayout` | → `/dashboard` | `App.tsx:50` |
| `/dashboard` | `MainLayout` | `DashboardPage` | `pages/DashboardPage.tsx` |
| `/clients` | `MainLayout` | `ClientsPage` | `pages/clients/ClientsPage.tsx` |
| `/clients/new` · `/clients/:id` | `MainLayout` | `ClientDetailPage` | `pages/clients/ClientDetailPage.tsx` |
| `/budgets` | `MainLayout` | `BudgetsPage` | `pages/budgets/BudgetsPage.tsx` |
| `/budgets/new` | `MainLayout` | `BudgetFormPage` | `pages/budgets/BudgetFormPage.tsx` |
| `/budgets/:id` | `MainLayout` | `BudgetDetailPage` | `pages/budgets/BudgetDetailPage.tsx` |
| `/budgets/:id/edit` | `MainLayout` | `BudgetFormPage` | `pages/budgets/BudgetFormPage.tsx` |
| `/service-orders` | `MainLayout` | `ServiceOrdersPage` | `pages/service-orders/ServiceOrdersPage.tsx` |
| `/service-orders/new` | `MainLayout` | `ServiceOrderFormPage` | `pages/service-orders/ServiceOrderFormPage.tsx` |
| `/service-orders/from-budget/:budgetId` | `MainLayout` | `ServiceOrderFormPage` | idem |
| `/service-orders/:id` | `MainLayout` | `ServiceOrderDetailPage` | `pages/service-orders/ServiceOrderDetailPage.tsx` |
| `/service-orders/:id/edit` | `MainLayout` | `ServiceOrderFormPage` | idem |
| `/inventory` | `MainLayout` | `InventoryPage` | `pages/inventory/InventoryPage.tsx` |
| `/inventory/new` · `/inventory/:id/edit` | `MainLayout` | `PartFormPage` | `pages/inventory/PartFormPage.tsx` |
| `/suppliers` | `MainLayout` | `SuppliersPage` | `pages/suppliers/SuppliersPage.tsx` 🆕 |
| `/suppliers/new` · `/suppliers/:id` | `MainLayout` | `SupplierDetailPage` | `pages/suppliers/SupplierDetailPage.tsx` 🆕 |
| `/purchases` | `MainLayout` | `PurchasesPage` | `pages/purchases/PurchasesPage.tsx` 🆕 |
| `/purchases/new` | `MainLayout` | `PurchaseFormPage` | `pages/purchases/PurchaseFormPage.tsx` 🆕 |
| `/purchases/:id` | `MainLayout` | `PurchaseDetailPage` | `pages/purchases/PurchaseDetailPage.tsx` 🆕 |
| `/backup` | `MainLayout` + `AdminRoute` | `BackupPage` | `pages/backup/BackupPage.tsx` |
| `/settings` | `MainLayout` + `AdminRoute` | `SettingsPage` (7 abas) | `pages/settings/SettingsPage.tsx` |
| `*` | — | → `/dashboard` | `App.tsx:76` |

### 8.3 Descrição das páginas

| Página | Resumo |
|---|---|
| `DashboardPage` | 4 KPIs via React Query (`budgetsApi.getStats`, `serviceOrdersApi.getStats`, `clientsApi.list`, `inventoryApi.getStats/getLowStock`) |
| `LoginPage` | RHF + Zod; detecta primeiro acesso via `authApi.setupStatus()` e, se `needsSetup`, cria o primeiro admin (`setupAdmin`) |
| `LicenseActivation` | Tela DRM: busca HWID (`/license/challenge`), permite copiar, cola token e ativa (`/license/activate`); redireciona p/ `/login` se já licenciado |
| `LicensePage` | Gestão da licença: status/validade/dias restantes + colar token/JSON (`installLicense`) |
| `ClientsPage` | Lista paginada com busca, ordenação, **código `CLI-NNNN`**, tipo PF/PJ, status e contagem Orçamentos/OS, ver/editar/excluir |
| `ClientDetailPage` | Formulário completo PDF p.1 (classificação PF/PJ condiciona CPF+RG × CNPJ+IE+IM, endereço estruturado, site, **funcionário responsável**) + abas de histórico (orçamentos e O.S.) + exclusão |
| `BudgetsPage` | Lista com filtros (busca/status/paginação), chips de status, atalhos novo/editar/duplicar/excluir |
| `BudgetFormPage` | Multi-aba (cliente, equipamentos, defeito, itens, mão de obra, fotos); duplicar via `?copy=<id>`; Zod + `useFieldArray` |
| `BudgetDetailPage` | Totais, itens, máquina de status, conversão em O.S., impressão (`window.print`), editar/duplicar/excluir |
| `ServiceOrdersPage` | Lista com filtros de status/busca, chips e ações (ver, editar, concluir, excluir) |
| `ServiceOrderFormPage` | Cliente, técnico, equipamentos, defeito, diagnóstico/solução, garantia, itens, fotos, totais em tempo real |
| `ServiceOrderDetailPage` | Status/totais/garantia, timeline, troca de status com nota, atribuição, fotos, impressão, exclusão (só `OPEN`) |
| `InventoryPage` | Cards de stats, filtros (busca/categoria/status/estoque baixo), paginação, ajuste rápido, ativar/desativar, excluir |
| `PartFormPage` | SKU, nome, categoria, unidade, **tipo (Novo/Usado/Digital)**, **NCM**, preços com **lucro bruto (R$ / %) ao vivo**, **% comissão**, mínimo, quantidade, fornecedor, local, toggle de status |
| `SuppliersPage` 🆕 | Lista de fornecedores com busca, status (ativos/todos), contagem de compras, ativar/desativar e excluir (bloqueado se houver compras) |
| `SupplierDetailPage` 🆕 | Formulário completo (PF/PJ, endereço, documentos, contato, site, observações) + **histórico de compras** do fornecedor; cria/edita com código `FOR-NNNN` |
| `PurchasesPage` 🆕 | Lista de entradas de mercadoria com filtros (fornecedor/busca/período), chips e acesso ao detalhe |
| `PurchaseFormPage` 🆕 | Fornecedor, data, **grade de itens com busca por SKU/nome** (autocomplete), frete/imposto/desconto com **rateio e custo unitário ao vivo**, NF compra/transporte, forma de pagamento → cria `COM-NNNN` |
| `PurchaseDetailPage` 🆕 | Itens com `Custo unit. c/ rateio`, resumo financeiro, metadados (NFs, quem lançou), impressão e **"Remover e reverter estoque"** (confirm + alerta de custo não recalculado) |
| `BackupPage` | Lista `.zip`, criar agora, restaurar, excluir, sincronizar, limpar antigos |
| `SettingsPage` | Painel admin com abas: **Empresa · Padrões · Backup · Inventário · Serviços · Financeiro · Usuários** — aba Usuários = cadastro/edição completo de funcionário (PDF p.4: documentos, endereço, comissão, código `FUN-NNNN`) |

### 8.4 Providers (`frontend/src/main.tsx`) — obrigatórios

```tsx
<ThemeProvider theme={theme}>          // tema MUI (theme.ts)
  <QueryClientProvider client={qc}>    // React Query (retry 1, staleTime 30s)
    <BrowserRouter>                    // rotas
      <AuthProvider>                   // contexto useAuth
        <App />
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>
</ThemeProvider>
```

> Sem esta montagem, `useQuery`/`useNavigate`/`useAuth` quebram em runtime. (Corrigido em 29/09/2026 — ver §19.)

---

## 9. Todas as chamadas do frontend (api.ts)

`frontend/src/services/api.ts`:
- `axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', timeout: 60000 })`
- **Request interceptor** (L15): injeta `Authorization: Bearer <localStorage.token>`
- **Response interceptor** (L24): normaliza `error.response.data.message` a partir de `body.error.message`; **401** → limpa storage e vai p/ `/login`; **403** com `SYSTEM_LOCKED_DRM_VIOLATION`/`LICENSE_EXPIRED`/`DRM_CONFIG_ERROR` → limpa storage e vai p/ **`/activate`**
- Helpers: `request<T>()` (desembrulha `response.data.data`), `get/post/put/del`, `raw`, `unwrap`/`unwrapPaginated`, `formConfig()` (multipart só se `FormData`)

| Grupo | Funções → endpoints |
|---|---|
| **`authApi`** | `login`→`POST /auth/login` · `register`→`POST /auth/register` · `setupAdmin`→`POST /auth/setup-admin` · `setupStatus`→`GET /auth/setup-status` · `getProfile`→`GET /auth/profile` · `changePassword`→`PUT /auth/password` · `getLicenseStatus`→`GET /auth/license/status` · `installLicense`→`POST /auth/license/install` · `deactivateLicense`→`POST /auth/license/deactivate` · `license.challenge`→`GET /license/challenge` · `license.status`→`GET /license/status` · `license.activate`→`POST /license/activate` |
| **`usersApi`** | `list`→`GET /users` · `get`→`GET /users/:id` · `getTechnicians`→`GET /users/technicians` · `create`→`POST /users` · `update`→`PUT /users/:id` · `toggleActive`→`PUT /users/:id/toggle-active` · `delete`→`DELETE /users/:id` |
| **`clientsApi`** | `list`→`GET /clients` · `get`→`GET /clients/:id` · `getHistory`→`GET /clients/:id/history` · `create`→`POST /clients` · `update`→`PUT /clients/:id` · `delete`→`DELETE /clients/:id` |
| **`budgetsApi`** | `list`→`GET /budgets` · `get`→`GET /budgets/:id` · `getStats`→`GET /budgets/stats` · `create`→`POST /budgets` (FormData) · `update`→`PUT /budgets/:id` (FormData) · `updateStatus`→`PUT /budgets/:id/status` · `convertToOs`→`POST /budgets/:id/convert-to-os` · `delete`→`DELETE /budgets/:id` |
| **`serviceOrdersApi`** | `list`→`GET /service-orders` · `get`→`GET /service-orders/:id` · `getTimeline`→`GET /service-orders/:id/timeline` · `getStats`→`GET /service-orders/stats` · `create`→`POST /service-orders` · `update`→`PUT /service-orders/:id` · `updateStatus`→`PUT /service-orders/:id/status` · `assign`→`PUT /service-orders/:id/assign` · `addItem`→`POST /service-orders/:id/items` · `removeItem`→`DELETE /service-orders/:id/items/:itemId` · `addPhoto`→`POST /service-orders/:id/photos` · `deletePhoto`→`DELETE /service-orders/photos/:photoId` · `delete`→`DELETE /service-orders/:id` |
| **`inventoryApi`** | `list`→`GET /inventory` · `get`→`GET /inventory/:id` · `getStats`→`GET /inventory/stats` · `getLowStock`→`GET /inventory/low-stock` · `getCategories`→`GET /inventory/categories` · `getMovements`→`GET /inventory/:id/movements` · `getMonthlyMovement`→`GET /inventory/movements/monthly` · `create`→`POST /inventory` · `update`→`PUT /inventory/:id` · `toggleStatus`→`PUT /inventory/:id/toggle-status` · `adjustStock`→`POST /inventory/:id/stock` · `delete`→`DELETE /inventory/:id` |
| **`suppliersApi`** 🆕 | `list`→`GET /suppliers` · `options`→`GET /suppliers/options` · `get`→`GET /suppliers/:id` · `create`→`POST /suppliers` · `update`→`PUT /suppliers/:id` · `toggleActive`→`PUT /suppliers/:id/toggle-active` · `delete`→`DELETE /suppliers/:id` |
| **`purchasesApi`** 🆕 | `list`→`GET /purchases` (filtros `supplierId`, `startDate/endDate`, `search`) · `get`→`GET /purchases/:id` · `create`→`POST /purchases` · `delete`→`DELETE /purchases/:id` |
| **`servicesApi`** | `list`→`GET /services` · `byCategory`→`GET /services/by-category` · `get`→`GET /services/:id` · `create`→`POST /services` · `update`→`PUT /services/:id` · `toggle`→`PUT /services/:id/toggle` · `remove`→`DELETE /services/:id` · `initDefaults`→`POST /services/init` |
| **`expensesApi`** | `list`→`GET /expenses` · `get`→`GET /expenses/:id` · `create`→`POST /expenses` · `update`→`PUT /expenses/:id` · `remove`→`DELETE /expenses/:id` · `monthlySummary`→`GET /expenses/summary/monthly` · `yearlySummary`→`GET /expenses/summary/yearly` · `byCategory`→`GET /expenses/summary/by-category` |
| **`reportsApi`** | `inventoryValuation`→`GET /reports/inventory-valuation` · `profitLossMonthly`→`GET /reports/profit-loss/monthly` · `profitLossYearly`→`GET /reports/profit-loss/yearly` · `monthlyMovements`→`GET /reports/movements/monthly` · `topItems`→`GET /reports/top-items` · `topServices`→`GET /reports/top-services` |
| **`settingsApi`** | `getAll`→`GET /settings` · `getByCategory`→`GET /settings/category/:category` · `getCatalog`→`GET /settings/catalog` · `update`→`PUT /settings/:key` · `updateMany`→`PUT /settings` · `initDefaults`→`POST /settings/init` |
| **`backupApi`** | `list`→`GET /backup/list` (retorna `.files`) · `getConfig`→`GET /backup/config` · `create`→`POST /backup/create` · `restore`→`POST /backup/restore/:file` · `delete`→`DELETE /backup/:file` · `cleanup`→`POST /backup/cleanup` · `sync`→`POST /backup/sync/:file` |

Tipos exportados: `LicenseSummary` (L96), `LicenseStatus` (L106).

---

## 10. Frontend — camadas, componentes e estilos

### 10.1 Store/auth (`store/auth.tsx`)

- `AuthProvider` (L14) + `useAuth()` (L93): estado `{ user, token, license, isAuthenticated }`; persiste em `localStorage` (`token`, `user`, `license`); funções `login`, `logout`, `setupAdmin`, `refreshLicense`.
- `loadStoredAuth` (L22-47): no boot, se houver sessão salva, **revalida a licença** (`authApi.getLicenseStatus()`) e atualiza o storage.

### 10.2 Layout (`components/layout/`)

| Componente | Descrição |
|---|---|
| `Sidebar.tsx` | `Drawer` duplo (temporário no mobile, permanente 280px no desktop). Itens com restrição de papel: Dashboard, Clientes, Orçamentos, O.S. (todos os papéis); Estoque (`ADMIN`+`TECHNICIAN`); Backup, Licença, Configurações (só `ADMIN`). Logo marca 30px + "PapaTec" + legenda. Bloco de usuário + "Sair". `Sidebar.css` |
| `Header.tsx` | `AppBar` sticky com logo horizontal, sino de notificações com **badge real** (orçamentos pendentes, OS pronta, estoque baixo — montado via React Query), menu do usuário (Meu Perfil → `/settings`, Configurações → `/settings`, Sair) |
| `MainLayout.tsx` | Shell: `Sidebar` + `Header` + `Container maxWidth="xl"` com `<Outlet/>`. Redireciona p/ `/license` se `license.isValid === false` (L12-17). `MainLayout.css` |

### 10.3 Componentes de UI

- **shadcn/ui (Radix + CVA + Tailwind)** — `components/ui/`: `alert`, `badge`, `button` (`buttonVariants` com `cva`), `card`, `input`, `label`, `select`, `table`, `textarea` + barrel `index.ts` (`@/components/ui`).
- **Wrappers MUI:** `Buttons.tsx` → `PrimaryButton`, `SecondaryButton`, `DangerButton`, `GhostButton` (todos com `loading`/spinner). `StatusChips.tsx` → `BudgetStatusChip`, `OSStatusChip`, `PartStatusChip`, `GenericStatusChip` (mapas de cor/rótulo PT-BR).

### 10.4 Estilos e tema

| Arquivo | Conteúdo |
|---|---|
| `index.css` | `@tailwind base/components/utilities` + variáveis shadcn (`--background`, `--primary`, `--radius: .5rem`) + `body { @apply bg-background text-foreground }` |
| `tailwind.config.js` | content (index.html + src), `darkMode: 'class'`, cores via `hsl(var(--*))`, animações accordion |
| `theme.ts` | `createTheme` MUI (Inter, sombras suaves, `borderRadius 8`, botões sem uppercase) — montado no `main.tsx` |
| CSS de layout | `Sidebar.css`, `MainLayout.css`, `LoginPage.css` |
| `vite.config.ts` | alias `@` → `./src`; dev server 5173 com proxy `/api` → `:3001` |

> **Não existe** `App.css`.

---

## 11. Modelo de dados (Prisma)

**Enums (8):** `UserRole`, `BudgetStatus`, `OsStatus`, `PartStatus`, `ItemType`, `MovementType`, `ExpenseCategory`, `PartyType` 🆕 (`NATURAL`|`LEGAL` — PF/PJ de Cliente e Fornecedor).

**Models (19):**

| Model | Destaques |
|---|---|
| `User` | `role @default(TECHNICIAN)`, `active`, relações p/ budgets, O.S. (autor/técnico), movimentos; 🆕 Fase 1: `codeSequence`, `phone/ramal/site/cpf/rg/cnpj/stateRegistration/municipalRegistration/street/number/complement/district/zip/city/state/notes/commissionPercent` |
| `Client` | `cpf @unique`; exclusão em cascata p/ orçamentos/O.S.; 🆕 Fase 1: `codeSequence` (`CLI-NNNN`), `type`, `active`, endereço estruturado, `rg/cnpj/stateRegistration/municipalRegistration/site`, `responsibleId → User` |
| `Budget` | `status @default(DRAFT)`, `equipment Json`, totais, `validUntil`, 1-N `items`/`attachments`, 1-1 `serviceOrder` |
| `BudgetItem` | `partId`/`serviceId` (`onDelete: SetNull`), `type` (PART\|SERVICE\|LABOR) |
| `BudgetAttachment` | `filePath` |
| `ServiceOrder` | `osNumber Int @unique autoincrement`, `budgetId @unique`, `warrantyDays`, `startedAt/finishedAt/deliveredAt` |
| `OsItem` · `OsMovement` · `OsPhoto` | itens · timeline de status (`fromStatus`,`toStatus`,`note`) · fotos |
| `Part` | `code @unique` (SKU), `costPrice/salePrice/minStock/quantity`, `status`; 🆕 Fase 1: `productType` (NEW/USED/DIGITAL), `ncm`, `commissionPercent` |
| `StockMovement` | `type` (IN/OUT/ADJUSTMENT), `qty`, `reason`, `userId` |
| `Service` | catálogo: `name @unique`, `price`, `category`, `estimatedHours`, `isActive` |
| `Expense` | `category` (7), `amount`, `date` |
| `Setting` | `key @unique`, `value Json`, `category` |
| `License` | `hardwareId @unique`, `token @db.Text`, `payload Json`, `signature`, `isActive` |
| `Sequence` 🆕 | contadores atômicos por `key` (`CLIENT|SUPPLIER|EMPLOYEE|PURCHASE`…) — upsert `increment` gera `CLI-NNNN`/`FOR-NNNN`/`FUN-NNNN`/`COM-NNNN` |
| `Supplier` 🆕 | espelho do `Client`: `codeSequence` único, `type/active`, docs, endereço estruturado, contato/site/notes, 1-N `purchases` |
| `Purchase` 🆕 | `codeSequence` (`COM-NNNN`), `supplierId`, `purchaseDate`, `freight/tax/discount`, `paymentMethod`, `invoiceNumber/transportInvoiceNumber`, `notes`, `userId`, 1-N `items` |
| `PurchaseItem` 🆕 | `purchaseId`, `partId`, `qty`, `unitPrice`, `unitCost` (custo pós-rateio) |

Provider `postgresql` via `env("DATABASE_URL")`; migrations em `backend/prisma/migrations` — última: **`20260929150000_fase1_cadastros_compras`** (Fase 1, aplicada via `migrate deploy` + backfill dos códigos `CLI-`/`FUN-` a partir do `COUNT(*)`).

---

## 12. Funcionalidades de negócio por módulo

### 12.1 Clientes
Cadastro com `name`/`phone` obrigatórios, `email`, `cpf` único (**`DUPLICATE_CPF`**), `notes`. Listagem paginada com busca (nome/telefone/email/cpf/**cnpj/código**) e filtro `hasActiveOs`. Exclusão bloqueada se houver O.S. em aberto (**`CLIENT_HAS_OPEN_ORDERS`**). `GET /:id/history` devolve cliente + orçamentos + O.S.
**Fase 1:** código `CLI-NNNN` (tabela `Sequence`), classificação **PF/PJ** (`PartyType` — o form mostra CPF+RG ou CNPJ+IE+IM conforme a escolha), endereço estruturado (rua/nº/compl/bairro/CEP/cidade/UF), `site`, status `active` e **funcionário responsável** (`responsibleId`).

### 12.2 Orçamentos
- Itens `PART|SERVICE|LABOR`, horas/valor de mão de obra, fotos (multer, até 10 × 5MB, mime jpeg/png/webp/gif/pdf).
- Totais recalculados **server-side** (`computeTotals`, L58): `totalParts + totalServices + totalLabor`.
- **Máquina de status** (`VALID_TRANSITIONS`, L23-30): `DRAFT ⇄ SENT` · `SENT → APPROVED|REJECTED|EXPIRED` · `APPROVED → SENT|REJECTED` · `REJECTED|EXPIRED → DRAFT` · `CONVERTED_TO_OS` (terminal).
- **ACID — `POST /:id/convert-to-os`** (L329-443): `prisma.$transaction` **Serializable** (timeout 15s) que valida status `APPROVED`, técnico ativo, **estoque de todas as peças antes de qualquer baixa** (`INSUFFICIENT_STOCK`/`PART_INACTIVE`/`PART_NOT_FOUND`), decrementa `Part.quantity` + cria `StockMovement(OUT)`, cria O.S. + itens + `OsMovement` e marca o orçamento `CONVERTED_TO_OS`.
- Exclusão restrita a `DRAFT|REJECTED|EXPIRED` sem O.S. vinculada; remove anexos do disco.

### 12.3 Ordens de Serviço
- Numeração sequencial (`osNumber`), garantia default 90 dias, fotos, timeline de `OsMovement`.
- **Máquina de status** (L23-30): `OPEN → IN_PROGRESS|WAITING_PARTS|CANCELLED` · `IN_PROGRESS → WAITING_PARTS|READY|CANCELLED|OPEN` · `WAITING_PARTS → IN_PROGRESS|CANCELLED` · `READY → DELIVERED|IN_PROGRESS|CANCELLED` · `DELIVERED` (terminal) · `CANCELLED → OPEN`. Carimba `startedAt/finishedAt/deliveredAt`.
- **Transações ACID:** `POST /` (cria O.S. + itens + movimento + fotos + **baixa de estoque**) · `PUT /:id` (devolve estoque das peças removidas, recria, baixa novas) · `PUT /:id/status` (update + `OsMovement`) · `POST /:id/items` (item + baixa + totais) · `DELETE /:id/items/:itemId` (apaga + devolve estoque + totais) · `DELETE /:id` (só `OPEN`; devolve todo o estoque e apaga fotos).

### 12.4 Estoque
CRUD com SKU único (**`DUPLICATE_CODE`**), categorias, custo/venda, mínimo, fornecedor (texto livre), localização; `stats` (contagens + valoração custo/venda/lucro potencial), `low-stock`, `categories`, `movements`, `movements/monthly`.
- **Fase 1:** campos **tipo** (`productType` NEW/USED/DIGITAL), **NCM** e **% de comissão** no form; **lucro bruto (R$ / %) calculado ao vivo**.
- **ACID:** `POST /` cria peça + movimento `IN` inicial; `POST /:id/stock` aplica `IN|OUT|ADJUSTMENT` (valida `INSUFFICIENT_STOCK`) + `StockMovement` na mesma transação.
- `costPrice` também é atualizado pela **Entrada de Mercadoria** (média ponderada com rateio de frete/imposto − desconto — ver §12.10).
- `DELETE` **não apaga** peça com histórico em `BudgetItem`/`OsItem` → apenas desativa (`deactivated: true`).

### 12.5 Catálogo de serviços
`DEFAULT_SERVICES` (12: Formatação, Limpeza Física, Montagem, Remoção de Vírus, Upgrade Memória/SSD, Instalação de Software, Recuperação de Dados, Configuração de Rede, Manutenção Preventiva, Instalação de SO, Troca de Tela, Troca de Bateria) com preço/categoria/horas. Semeados no boot (`main.ts:38`) e sob demanda (`POST /api/services/init`). CRUD ADMIN; exclusão vira desativação se houver histórico.

### 12.6 Financeiro e relatórios
- Despesas com 7 categorias (`RENT, ENERGY, SALARIES, MATERIALS, MARKETING, TAXES, OTHER`), escrita só ADMIN; resumos `monthly`/`yearly`/`by-category`.
- Relatórios (ADMIN): valoração de estoque por categoria, **DRE mensal/anual** (receita de peças/serviços/mão de obra − custo de peças − despesas, com margem e ticket médio), movimentações do mês, `top-items`/`top-services` (agregados de `BudgetItem` em orçamentos `APPROVED|CONVERTED_TO_OS`).

### 12.7 Configurações (catálogo fechado `SETTING_DEFINITIONS`, L19-47)
Chave fora da lista → **`UNKNOWN_SETTING`**. Categorias:
- `COMPANY`: nome, telefone, e-mail, endereço, CNPJ, rodapé de recibo
- `FINANCIAL`: `default_labor_rate`, `default_warranty_days`, `budget_validity_days`, `low_stock_threshold`, `profit_margin_pct`
- `LABOR`: `default_labor_hours`
- `BACKUP`: `backup_path`, `backup_schedule`, `backup_retention_days`, `backup_include_uploads`
- `SYSTEM`: `allow_self_registration`, `session_days`

Coerção de tipos (`coerce`, L148); `ensureDefaults()` no boot; mudar `backup_schedule` **reagenda o cron** (L100-103).
**UI (7 abas):** Empresa · Padrões · Backup (`BackupTab` L308) · Inventário (`InventoryTab` L466 — valoração, movimentações do mês, low stock, CRUD e ajuste) · Serviços (`ServicesTab` L1005 — CRUD + restaurar padrões) · Financeiro (`FinancialTab` L1189 — DRE do mês, despesas) · Usuários (`UsersTab` — cadastro/edição **completo de funcionário** (Fase 1, PDF p.4: documentos, endereço, comissão) com limite `maxUsers`).

### 12.8 Usuários e papéis
Papéis `ADMIN | TECHNICIAN | RECEPTIONIST`; criação respeita `maxUsers` da licença (**`LICENSE_USER_LIMIT`**); proteções **`SELF_LOCKOUT`** e **`LAST_ADMIN`**; ao excluir, `DELETE` reatribui `budgets/serviceOrders/stockMovements/osMovements` para outro ADMIN ativo em **`prisma.$transaction`** (`users.routes.ts:178-187`). `PUT /users/:id` só aplica campos de funcionário se algum deles estiver no body (evita zerar dados em PUTs parciais).
**Fase 1:** código `FUN-NNNN`, documentos (CPF/RG/CNPJ/IE/IM), endereço estruturado, telefone/ramal/site, `% de comissão` e observações — tabela com busca e edição.

### 12.9 Fornecedores (🆕 Fase 1)
Espelho do Cliente em `/suppliers`: código `FOR-NNNN`, PF/PJ, status ativo, endereço estruturado, documentos, contato, site e observações. Busca por nome/docs/código; `GET /options` alimenta o select da compra; `GET /:id` devolve o **histórico de compras**. Regras: documento único (**`SUPPLIER_DUPLICATE_DOCUMENT`**) e exclusão bloqueada se existirem compras (**`SUPPLIER_HAS_PURCHASES`**); toggle de ativo/inativo. Menu restrito a `ADMIN`/`TECHNICIAN`.

### 12.10 Entrada de Mercadoria / Compras (🆕 Fase 1)
- **`POST /api/purchases` — ACID Serializable:** valida fornecedor ativo e itens (parte ativa, qty ≥ 1, preço ≥ 0) → cria `Purchase` + `PurchaseItem` → **rateio** `extra = frete + imposto − |desconto|` distribuído **proporcionalmente ao valor de cada item** → `unitCost = round(unitPrice + extra × share / qty)` → estoque `quantity += qty` e **custo por média ponderada** `(saldoAntigo × custoAntigo + Σ(qtd × unitCost)) / novoSaldo` → movimento `IN` por peça → grava `unitCost` no item (auditoria do rateio). Código `COM-NNNN` via `Sequence`.
- **`DELETE /api/purchases/:id` — ACID:** reverte o estoque (`quantity −= qty`, valida saldo) e apaga a compra. **O custo não é recalculado** (a média ponderada é irreversível sem histórico completo) — a UI exibe alerta na confirmação.
- Listagem com filtros de fornecedor/busca/período; detalhe com resumo financeiro, NFs compra/transporte, forma de pagamento e quem lançou.
- Frontend: grade de itens com **autocomplete de busca por SKU/nome** (`GET /api/inventory?search=`), quantidades/preços editáveis e **resumo ao vivo** (itens + frete + imposto − desconto = total) com o custo unitário já rateado por linha.

---

## 13. DRM / Licenciamento

### 13.1 Fluxo (offline, challenge-response)

```
1. GET /api/license/challenge
   └─ getChallenge() → { hardwareId: "XXXX-XXXX-XXXX-XXXX", algorithm: "SHA-256" }
      HWID = SHA-256(uuid_placa | mac_primaria) truncado (16 hex)
      (filtra MACs virtuais 00155D/000D3A; fallback "FALLBACK-<COMPUTERNAME>-<platform>")
2. Cliente envia HWID + nome da empresa → Filitech emite JWT (RS256, linha única)
3. POST /api/license/activate  (ou POST /api/auth/license/install)
   ├─ verify(token, LICENSE_PUBLIC_KEY, { algorithms: ['RS256'] }) → inválido: 403 INVALID_LICENSE_TOKEN
   ├─ payload.hwid === HWID real → divergência: 403 HWID_MISMATCH
   ├─ prisma.license.upsert({ hardwareId, token, payload, signature, isActive: true })
   └─ invalidateLicenseCache()
4. LicenseGuard em CADA request (cache 5 min):
   ├─ ignora PUBLIC_PATHS
   ├─ assinatura + hwid + exp → falha: 403 SYSTEM_LOCKED_DRM_VIOLATION | LICENSE_EXPIRED
   └─ hwid divergente → log "[DRM ALERT] CLONE DETECTADO!"
5. GET /api/license/status → revalida assinatura e devolve
   { isLicensed, hardwareId, license: { clientName, issuedAt, expiresAt, daysRemaining, features[], maxUsers, active } }
6. POST /api/license/deactivate → isActive: false + limpa cache
```

### 13.2 Payload do JWT
`hwid`, `client`, `iat`, `exp`, `features[]`, `maxUsers` (usado em `auth.routes.ts:99-109` e `users.routes.ts:84-88`).

### 13.3 Chave pública
`LICENSE_PUBLIC_KEY_B64` (env no `.env`/`.env.example` + build-arg) → `createPublicKey({ key: Buffer.from(b64,'base64'), format: 'pem' })` em `utils/licenseToken.ts:16`. Sem ela, `main.ts:21` loga `logger.fatal('[DRM CRITICAL] ...')`.

### 13.4 Arquivos envolvidos

| Arquivo | Papel |
|---|---|
| `backend/src/middleware/license.ts` | `LicenseGuard`, `PUBLIC_PATHS`, cache 5 min, `invalidateLicenseCache()` |
| `backend/src/utils/licenseToken.ts` | `LICENSE_PUBLIC_KEY`, `resolveLicenseToken()`, `verifyLicenseRecord()` (RS256) |
| `backend/src/utils/machineId.ts` | `getMachineFingerprint()` (HWID) |
| `backend/src/services/license.service.ts` | `getChallenge`/`activate`/`deactivate`/`getStatus`/`getPayload` |
| `backend/src/routes/license.routes.ts` | `/challenge` · `/status` · `/activate` · `/deactivate` |
| `backend/src/routes/auth.routes.ts` (L163-203) | `/license/status` · `/license/install` · `/license/deactivate` |
| `prisma/schema.prisma` (model `License`) | persistência |
| `pages/LicenseActivation.tsx` · `pages/license/LicensePage.tsx` | UI ativação/gestão |
| `services/api.ts:44-56` | intercept 403 → `/activate` |

> **Não existe gerador de licenças neste repositório** (`README.md:54`). A emissão é feita offline pela Filitech.

### 13.5 Códigos de erro DRM
`INVALID_LICENSE_TOKEN` · `HWID_MISMATCH` · `SYSTEM_LOCKED_DRM_VIOLATION` · `LICENSE_EXPIRED` · `DRM_CONFIG_ERROR` · `INTERNAL_DRM_ERROR`.

---

## 14. Backup

### 14.1 Backup embutido (`services/backup.service.ts`)

- **Cron:** `node-cron`, expressão de `settings.backup_schedule` → env `BACKUP_SCHEDULE` → default **`0 12,18 * * *`** (12h/18h), timezone `TZ || America/Sao_Paulo` (L65). Inválido → fallback default (L61). Iniciado no boot (`main.ts:48`), parado no `SIGTERM/SIGINT` (L66), reagendado ao salvar a setting.
- **Destino:** setting `backup_path` → env `BACKUP_NETWORK_PATH` → `/backups` (cria o diretório).
- **Dump 100% Node** (sem `pg_dump`, compatível com Distroless): lista tabelas do `information_schema` + `SELECT *` por tabela.
- **ZIP:** `backup_papatec_<ISO>.zip` com `archiver` **nível 9**, contendo `database.json` (`{version:1, generatedAt, tables}`) + `uploads/` (se `backup_include_uploads`). Lock anti-concorrência (409 `BACKUP_ALREADY_RUNNING`), ZIP vazio → `BACKUP_EMPTY`, `cleanup` automático (retenção `backup_retention_days`, default 30).
- **Segurança:** `safePath()` bloqueia path traversal (`INVALID_BACKUP_NAME`, `PATH_TRAVERSAL_DENIED`).
- **Sync:** `sync(file)` copia para `BACKUP_NETWORK_PATH` (`SYNC_NOT_CONFIGURED` se ausente).
- **Restauração:** extrai `database.json` → `BEGIN` → `TRUNCATE ... CASCADE` (todas as tabelas) → INSERTs na **ordem topológica de dependências** (`dependencyOrder()`) → `COMMIT` (ROLLBACK em erro) → `resetSequences()` (`setval`). Retorna `{ restoredTables, restoredRows }`.

### 14.2 Endpoints (`/api/backup`, JWT + ADMIN)
`GET /list` · `GET /config` · `POST /create` · `POST /cleanup[?retentionDays=]` · `POST /restore/:file` · `POST /sync/:file` · `DELETE /:file`.

### 14.3 UI
- `pages/backup/BackupPage.tsx` (rota `/backup`): criar agora, tabela de `.zip`, restaurar/excluir/sincronizar/limpar, cards de info.
- Aba **Backup** do `SettingsPage` (`BackupTab`): `backup_path`, `backup_schedule`, `backup_retention_days`, `backup_include_uploads` + mesmas operações.
- CLI: `INSTALAR.ps1` opção `[5]` (submenu criar/listar/restaurar/limpar; restaurar exige digitar `RESTAURAR`).

### 14.4 Backup externo opcional (`backup-agent/`)
Container separado (**não habilitado** no compose; snippet em `backup-agent/README.md`): `pg_dump` → `database.sql` + `uploads/` + `manifest.json` → `tar.gz` com retenção (`RETENTION_DAYS`) e sync multi-destino (`SYNC_DESTINATIONS`, separadas por `;`), cron próprio via `BACKUP_SCHEDULE`. Restauração manual: `scripts/restore.sh <arquivo>` (confirma `SIM`). O formato `.tar.gz` não colide com o `.zip` do backup embutido.

---

## 15. Segurança e anti-reversa

| Camada | Implementação |
|---|---|
| HTTP | `helmet`, `cors`, body limit 10 MB, rate-limit global 300/min e login 20/15min |
| Sessão | JWT (`JWT_SECRET`, exp `session_days`/`7d`), `requireAuth` checa `active` |
| DRM | §13 — guard global + cache 5 min + HWID + RS256 |
| Papéis | `requireRole` + checagens internas (`ADMIN_ONLY`, `SELF_LOCKOUT`, `LAST_ADMIN`, `LICENSE_USER_LIMIT`) |
| Uploads | multer (10/20 arquivos, 5 MB, allowlist de MIME), `dotfiles: 'deny'`, `resolveUploadPath()` com proteção `PATH_TRAVERSAL_DENIED` |
| Backup | `safePath()`, restauração transacional, lock de concorrência |
| **Anti-RE (produção)** | `esbuild` bundle → `javascript-obfuscator` (**RC4** string array, control-flow flattening, compact, **self-defending**, dead-code) → imagem **Distroless** (`gcr.io/distroless/nodejs20-debian11`, `USER nonroot`) com `entrypoint.js` programático que roda `prisma migrate deploy` e só então `require(bundle.js)` |
| Dados | `.env` fora do versionamento; `.dockerignore` exclui `.env`; senha hash no banco; `sanitizeUser` remove hash das respostas |
| Logs | `utils/logger.ts` — JSON por linha em `LOG_DIR`/`logs/app-YYYY-MM-DD.log` |

---

## 16. Configuração, ambiente e infra

### 16.1 Variáveis (raiz `.env` / `.env.example`)

| Variável | Função |
|---|---|
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | Postgres (senha gerada pelo instalador, 64 chars) |
| `JWT_SECRET` | Segredo do JWT de sessão (sem ele o backend não sobe) |
| `JWT_EXPIRES_IN` | Validade (default `7d`) |
| `LICENSE_PUBLIC_KEY_B64` | Chave pública RSA-2048 das licenças (604 chars) — sem ela **tudo** retorna 403 DRM |
| `BACKUP_NETWORK_PATH` | Destino dos backups (default `/backups`) |
| `BACKUP_SCHEDULE` | Cron do backup (default `0 12,18 * * *`) |
| `UPLOADS_PATH` | Pasta de uploads (default `/app/uploads`) |

> Não existe `backend/.env.example` — o backend lê `process.env` (o `.env` da raiz é consumido pelo compose e pelo `DEV-LOCAL.ps1`). Outras envs lidas pelo código: `DATABASE_URL`, `PORT` (3001), `NODE_ENV`, `TZ`, `DB_SSL`, `LOG_DIR`, `VITE_API_URL`, `RETENTION_DAYS`, `SYNC_DESTINATIONS`.

### 16.2 Compose

**Produção (`docker-compose.yml`):**

| Serviço | Imagem | Portas | Volumes |
|---|---|---|---|
| `db` | `postgres:15-alpine` | — | `pg_data` (healthcheck `pg_isready`) |
| `api` | `./backend` + build-arg `LICENSE_PUBLIC_KEY_B64` | 3001 interno | `./uploads:/app/uploads`, `./backups:/backups` |
| `web` | `./frontend` | 80 interno | — |
| `proxy` | `./proxy` | **80**, **443** | `nginx.conf`, `./certs` (gera cert auto-assinado 3650 dias se faltar) |

Redes: `papatec-internal` (`internal: true`), `papatec-external`.

**Dev (`docker-compose.dev.yml`):** api usa `Dockerfile.dev` + bind `./backend` + portas 3001/9229; web usa `Dockerfile.dev` + bind `./frontend` + 5173 + `VITE_API_URL=http://localhost:3001/api`; db expõe 5432; `proxy` fica com `profiles: [production]` (desligado).

### 16.3 Nginx

- **`nginx.conf` (borda TLS):** `:80` → 301 HTTPS; `:443` TLS 1.2/1.3 com `certs/localhost.{crt,key}`; `/` → web, `/api/` → api (upgrade headers, `client_max_body_size 20M`), `/uploads/` → api (cache 200 1d).
- **`frontend/nginx.conf`:** SPA `try_files … /index.html`, `/api/` e `/uploads/` → `api:3001`, `/assets/` cache 30d.

### 16.4 Dockerfiles

- **`backend/Dockerfile` (produção):** builder `node:20-alpine` (python3/make/g++/**openssl**) → `npm ci` (com `prisma/` copiado antes, por causa do `postinstall`) → `prisma generate` → `npm run build` (bundle + ofuscador) → `npm prune --production` → runtime **Distroless** com `node_modules`, `prisma/`, `bundle.obfuscated.js`→`bundle.js`, `entrypoint.js`; `USER nonroot`; `CMD ["node","entrypoint.js"]`.
- **`backend/Dockerfile.dev`:** `node:20-alpine` + `python3 make g++ vips-dev **openssl**` → `COPY package*.json` + `COPY prisma ./prisma` (necessário para o `postinstall: prisma generate`) → `npm install` → `COPY . .` → `npx prisma generate` → `npm run dev`.

---

## 17. Qualidade e auditoria

| Verificação | Comando | Status |
|---|---|---|
| Paridade rotas × chamadas | `node scripts/audit-parity.js` | ✅ (extrai chamadas de `api.ts` e compara com `backend/src/routes`) |
| Typecheck backend | `cd backend; npm run typecheck` | ✅ |
| Typecheck frontend | `cd frontend; npx tsc --noEmit` | ✅ (0 erros) |
| Build backend (bundle+ofuscador) | `cd backend; npm run build` | ✅ |
| Build frontend (tsc + vite) | `cd frontend; npm run build` | ✅ (aviso de chunk >500 kB é esperado) |
| Migração Fase 1 | `docker compose exec -T api npx prisma migrate deploy` | ✅ `20260929150000_fase1_cadastros_compras` (schema + backfill `CLI-`/`FUN-`) |
| Suíte E2E backend (Fase 1) | script Node (`e2e-fase1.mjs`, `%TEMP%\opencode`) | ✅ **19/19 PASS** — fornecedor, compra (rateio/ACID), clientes, peças, funcionários, códigos e proteções |
| Smoke UI (Fase 1) | navegador | ✅ fornecedor → compra → rateio → estoque → exclusão/reversão; clientes, produto e funcionários; **console sem erros** |
| Instalação teste ponta a ponta | `INSTALAR.bat teste` | ✅ build→db→migrate→seed→up→health→licença |
| Produção HTTPS | `INSTALAR.bat producao` | ver §20 |

---

## 18. Ideias, melhorias e backlog

### 18.1 Curto prazo (quick wins)
1. **PDF real de orçamento/O.S.** — hoje a impressão usa `window.print()`; um template dedicado (jsPDF/react-to-print) com logo e rodapé da empresa melhora a entrega ao cliente.
2. **Gráficos no Dashboard** — Recharts/Chart.js: evolução de orçamentos aprovados, O.S. por mês, receita x despesa.
3. **Busca global** — campo no Header que digite em clientes/O.S./peças de uma vez.
4. **CSV/XLSX** — exportação das listagens (clientes, peças, O.S.) e dos relatórios.
5. **Notificações adicionais** — o sino já é real (badge = orçamentos pendentes, OS pronta e estoque baixo); falta ligar mais eventos (licença perto do vencimento, garantia a vencer).
6. **Confirmação por e-mail/WhatsApp** — link de status da O.S para o cliente (exige SMTP/gateway, manter opcional/offline-friendly).
7. **Dark mode** — Tailwind já está com `darkMode: 'class'`; só falta o toggle + persistência.
8. **Atalhos de teclado** — `Ctrl+K` busca, atalhos de nova O.S./orçamento.

### 18.2 Médio prazo (produto)
9. **Multi-loja/multiempresa** — tenant por `Setting` + filtro global (hoje é single-company por design on-premise).
10. **PDV/venda direta** — fluxo de venda de acessórios sem O.S.
11. **Fiscal (NF-e/NFC-e)** — integração opcional com emissor local (Somente-homologação primeiro); mantido como módulo plugável para não quebrar o offline.
12. **Garantia automática** — alerta de O.S. dentro da janela de garantia e histórico de retorno.
13. **Reposição sugerida** — min/max + lead time por fornecedor, gera lista de compra automática.
14. **Assinatura digital/orçamento online** — aprovação por link (exige exposição controlada da API).
15. **Auditoria (audit log)** — tabela de eventos (quem alterou status/preço) + aba no painel admin.
16. **2FA** — TOTP para perfis ADMIN.
17. **PWA** — manifest + service worker para uso em tablet na bancada (offline parcial com fila de sincronização).
18. **Backup criptografado** — AES-GCM no ZIP + senha derivada (KDF), chave guardada nas settings.
19. **Backup incrementado/diferencial** — além do full diário.
20. **Upgrade do obfuscador** — avaliar ofuscação em camadas (ᾴlias de funções, flattening por módulo) e ofuscar também o bundle do frontend.

### 18.3 Processo/engenharia
21. **Testes automatizados** — Vitest (unit) no frontend, Vitest/Jest + supertest (rotas) no backend, smoke E2E com Playwright contra `INSTALAR teste`.
22. **CI** — pipeline rodando `typecheck + audit-parity + build` em PR.
23. **Healthcheck mais rico** — `/api/health` com versão, migração atual e status da licença (sem vazar dados).
24. **Métricas de uso** — contadores locais (O.S. por técnico, tempo médio de reparo) para o relatório.
25. **Tradução/i18n** — dicionário PT-BR → preparar EN para exportação futura.

---

## 19. Decisões técnicas e histórico de correções

### 19.1 Decisões (ADR curto)

| Decisão | Motivo |
|---|---|
| On-premise + Docker Compose | cliente sem nuvem; instalação em 1 passo |
| DRM offline challenge-response RS256 | sem servidor de licenças; HWID estável (UUID+MAC) |
| Chave pública embutida no `.env`/build | cliente não pode forjar licenças; emissão só pela Filitech |
| LicenseGuard global + cache 5 min | custo zero por request e trava total quando inválida |
| Envelope `{success,data,error}` em 100% das rotas | contrato único p/ frontend e auditoria |
| Transações **Serializable** nas operações de estoque | evita venda sem estoque em concorrência (loja real com 2 balcões) |
| Distroless + bundle ofuscado | reduz superfície de RE/ataque no servidor do cliente |
| Backup em JSON+ZIP (Node puro) | funciona em Distroless (sem `pg_dump`) |
| Hot-reload só no modo teste | dev rápido; produção isolada da fonte |
| Aliases `/api/quotes` e `/api/work-orders` | compatibilidade com nomenclatura alternativa |
| Nome de produto nos rótulos, pasta inalterada | marca visível sem quebrar caminhos/scripts |
| Códigos curtos (`CLI-`/`FOR-`/`FUN-`/`COM-`) via tabela `Sequence` com `upsert`+`increment` atômico | numeração estável sem corrida; a migração semeia a partir do `COUNT(*)` para não colidir com o backfill |
| Rateio de frete+imposto−desconto proporcional ao valor dos itens; custo por média ponderada | distribui o custo real sem distorcer itens baratos; a média é o padrão contábil da loja |
| Exclusão de compra reverte estoque **sem** recalcular custo | a média ponderada é irreversível sem histórico completo — decisão explícita, com alerta na UI |

### 19.2 Correções aplicadas (histórico)

| # | Problema | Causa raiz | Correção |
|---|---|---|---|
| 1 | `INSTALAR` falhava com `failed to get console: Identificador inválido.` | regressão do **Docker Compose v5.5.1** ao redirecionar o stdout (`\| Out-Host`) com stderr no console (issue docker/compose#14182) | `Invoke-Compose` agora usa `Start-Process -NoNewWindow` → docker herda o console real e o exit chega limpo (validado: padrão antigo exit=1, novo exit=0). Mesma correção no `DEV-LOCAL.ps1` (`Invoke-Db`) |
| 2 | Build da imagem api: `Could not load schema from prisma/schema.prisma … file or directory not found` | `postinstall: prisma generate` rodava antes do `COPY prisma/` | `Dockerfile.dev` ganhou `COPY prisma ./prisma/` antes do `npm install` (paridade com o Dockerfile de produção) |
| 3 | Relatório de erro com `SCRIPT_EXIT=0` | instalador não propagava falha | `Install-Teste`/`Install-Producao` devolvem `$true/$false`; `exit 1` no dispatch → `.bat` reporta código 1 |
| 4 | SPA quebrava em runtime (`No QueryClient set`, `useNavigate` sem Router, `useAuth deve ser usado dentro de AuthProvider`) | **nenhum provider era montado** — `main.tsx` só renderizava `<App/>` | `main.tsx` monta `ThemeProvider + QueryClientProvider + BrowserRouter + AuthProvider` |
| 5 | `docker compose run … prisma migrate deploy` → `the path … is not shared from the host` | Docker Desktop sem nenhum diretório compartilhado (File Sharing vazio) | Configurado `FilesharingDirectories: ["C:\Users\User"]` em `%APPDATA%\Docker\settings-store.json` (chave PascalCase; a chave `filesharingAllowedDirectories` é do `admin-settings.json` corporativo e é ignorada aqui). **Não** compartilhar a raiz `C:\` — trava o boot do daemon |
| 6 | `prisma migrate deploy` → `Could not parse schema engine response: "Error load…" is not valid JSON` | `Dockerfile.dev` sem `openssl` → Prisma não detecta o libssl e baixa o engine errado (default `openssl-1.1.x`); no 1º retry o `apk add` ainda caiu em `DNS: transient error` do CDN do Alpine | `apk add … openssl` no `Dockerfile.dev` **antes do `npm install`** (Prisma detecta a libssl na hora de baixar os engines), com **retry de 5 tentativas** no `apk` (código != 0 se todas falharem) |
| 7 | Logo/identidade | — | Assets em `frontend/public/`, aplicados em Header, Sidebar, Login e Ativação; favicon/`apple-touch-icon` corrigidos (`/vite.svg` removido) |
| 8 | Modo teste: API/SPA inacessíveis no host (`NetworkSettings.Ports` vazio) | containers só estavam na rede `papatec-internal` com `internal: true` — Docker **não publica portas** de rede interna | `docker-compose.dev.yml` define `networks: papatec-internal: internal: false` (regra empírica: só publica porta quem está em ≥1 rede **sem** `internal: true`; em produção o proxy fica em interna+externa e publica 80/443 normalmente) |
| 9 | JSON malformado no corpo respondia `500 INTERNAL_ERROR` | `express.json` lança `SyntaxError` e o error handler tratava tudo como erro genérico | `entity.parse.failed`/`SyntaxError` com `body` tratado **antes** dos demais → `400 INVALID_JSON` (no `http/errors.ts`) |
| 10 | **HWID idêntico em todas as máquinas** (`5261-7714-B3B5-C1BC`) dentro do Docker | não há `wmic`/`getmac` no container Linux e o fallback gerava hash constante → amarração de hardware inexistente | `machineId.ts` reescrito: `LICENSE_HWID` → `MACHINE_UUID`+`MACHINE_MAC` (lidos **no host** pelo `INSTALAR.ps1` via `Get-CimInstance`/NIC e injetados no `.env`/compose) → coleta nativa (CIM + regex de MAC em qualquer coluna do CSV) → `COMPUTERNAME`; mesma entrada `${UUID}|${MAC}` nos caminhos 2 e 3 → mesmo HWID. Verificado: `E599-27F5-A4A4-3042` |
| 11 | Produção: API em crash loop (`Cannot find module '/app/node'`) | Distroless declara `ENTRYPOINT ["/nodejs/bin/node"]` + `CMD ["node","entrypoint.js"]` → execução `node node entrypoint.js` | `CMD ["entrypoint.js"]` no `Dockerfile` (o CMD só pode ser o script) |
| 12 | Produção: `prisma migrate deploy` falhava com `Can't write to /app/node_modules/@prisma/engines` e, atrás disso, query engine errado | builder `node:20-alpine` (musl) baixa engines `linux-musl-*`; runtime Distroless Debian (glibc) procura `debian-openssl-*`, não acha, tenta **baixar no boot** (quebra offline) e ainda não escreve (container `nonroot` × `node_modules` de root) | builder `node:20-slim` + runtime `distroless/nodejs20-debian12` (**mesma família** debian12/OpenSSL 3.0 → engines `debian-openssl-3.0.x` presentes) e `COPY --chown=nonroot:nonroot`. Regra: plataforma dos engines do Prisma deve bater builder ↔ runtime |
| 13 | Produção: `https://localhost/api/health` → 502 (`connect() failed … IP velho`) | `nginx.conf` é bind mount e o compose **não recria** o proxy quando o arquivo muda; o nginx em execução mantinha `upstream`/cache DNS antigos (`nginx -T` relê do disco e engana — não mostra a config em uso) | (a) configs com `resolver 127.0.0.11` + `proxy_pass` em variável (não abortam mais se a API subir depois); (b) `INSTALAR.ps1 producao` executa `nginx -s reload` no proxy antes de checar a API |
| 14 | Trocar `producao` → `teste` falhava: `network … has active endpoints (papatec-proxy, papatec-web, papatec-api)` | o `override.yml` muda `papatec-internal: internal` (false↔true) e o compose precisa **remover e recriar a rede** — impossível enquanto os contêineres do modo anterior estão anexados; e o `proxy` (com `profiles: [production]` no override) é **invisível** para o `down` do modo teste, sobrando sozinho na rede | `Install-Teste`/`Install-Producao` começam com `docker compose … down --remove-orphans` (mesmo nome de projeto nos dois modos → derruba a pilha; **volumes `pg_data` preservados** — `down` sem `-v`) e o `Install-Teste` ainda remove o proxy explicitamente com `compose rm -sf proxy` usando o file set de **produção** (onde o serviço não tem profile) |
| 15 | **Portal em loop eterno** entre `/activate` e o "index" (recargas ~2/s, "não deixava fazer nada"), terminando sozinho no `/login` — reproduzido e corrigido | (a) `MainLayout` testava `!license.isValid`, mas o backend **nunca** envia `isValid` (envia `active`/`isLicensed`) → *sempre* redirecionava com `window.location.href = '/license'` (recarga completa) em **toda** visita ao dashboard; (b) `PrivateRoute`/`PublicRoute` liam `isAuthenticated` **antes** da restauração da sessão (estado inicial `false`) → pingue-pongue `/license`→`/login`→`/dashboard`; (c) `LicensePage` lia campos legados (`cnpj`/`companyName`/`maxEmployees`) inexistentes e mostrava "✗ Inválida" mesmo com licença ativa; sintoma colateral: 429 do rate limit global (300/min) com a tempestade de requisições | `MainLayout` só redireciona quando `license.active === false` (com `navigate`, sem recarga); rotas aguardam a nova flag **`hydrated`** do `AuthProvider` (restauração síncrona no mesmo tick); `LicensePage` lê o formato real `{isLicensed, hardwareId, license:{clientName, issuedAt, expiresAt, daysRemaining, features, maxUsers, active}}`. Verificação: reprodução pré-correção geração subia 2 recargas/s; pós-correção g **congela** (0 recargas), login pelo formulário entra no dashboard sem erro no console |
| 16 | Após o loop, o usuário era "derrubado" para o `/login` sozinho | `loadStoredAuth` envolvia o **refresh da licença** no mesmo `try/catch` que limpava tudo → qualquer falha transitória (429 atingido durante a tempestade do loop, rede) **apagava** token/usuário/licença | Restauração síncrona + `hydrated`; refresh da licença vira best-effort em background com `catch` próprio que **nunca** toca nas credenciais; credenciais só são limpas quando o `user` não é JSON válido |
| 17 | Chamadas `/api` **relativas** passando pelo Vite respondiam 500 (`ECONNREFUSED` no proxy) | `vite.config.ts` usava `target: 'http://localhost:3001'` — de **dentro** do container `localhost` é o próprio container (a SPA escapava disso porque `VITE_API_URL` é absoluta, então a armadilha só aparecia em qualquer chamada relativa) | alvo resolvido como `VITE_PROXY_TARGET` → se `VITE_API_URL` definida (container) usa `http://papatec-api:3001` (DNS do Docker) → senão `localhost:3001` (dev na host) |
| 18 | Autocomplete de produto da "Nova Compra" apagava o texto digitado e mostrava **"No options"** mesmo com a API respondendo 200 (só em janela **sem foco de sistema**; disparava a busca `search=<texto>` e o estado voltava a `''` em <50 ms) | `useAutocomplete` do MUI roda um efeito de reset amarrado à identidade de `resetInputValue` (muda a cada tecla); o early-return depende de `focused=true` e, com a **janela desfocada**, o `onFocus` não chega → emite `onInputChange('', 'reset')` e o handler aceitava qualquer `reason` → `partInput` zerado → query `enabled:false` → `options: []` | `onInputChange` só aplica `reason === 'input'` (`PurchaseFormPage.tsx`) — preserva o texto em qualquer reset programático (protege também o usuário real que sai do campo no meio da digitação) e deixa a busca estável; limpeza continua explícita no `addItem` |
| 19 | Data padrão da compra aparecia como **dia seguinte** à noite (form aberto 29/09 23h28 → "30/09/2026") | `new Date().toISOString().slice(0, 10)` usa a data **UTC**; com UTC-3 o dia só troca às 21h | data local via `new Date(Date.now() - getTimezoneOffset()*60000).toISOString().slice(0, 10)` |

### 19.3 Armadilhas conhecidas (para o futuro)

- **PowerShell 5.1:** pipe de comando nativo (`\| Out-Host`) redireciona só o stdout → nunca chamar `docker compose` assim; usar `Start-Process` (ver §19.2 #1). `Add-Member`/propriedades são **case-insensitive**.
- **Prisma no Alpine:** sempre manter `openssl` na imagem e `prisma/` copiado antes do `npm install` (o `openssl` precisa estar lá **na hora do `npm install`**, senão os engines baixados são os da versão errada de libssl).
- **apk/Alpine:** o índice do CDN pode falhar com `DNS: transient error (try again later)` — manter o retry no `apk add` do `Dockerfile.dev` e apenas re-executar o instalador quando acontecer.
- **Docker Desktop:** partilha de arquivos = chave `FilesharingDirectories` (lista de strings) no `settings-store.json`; raiz de drive quebra o daemon.
- **React + Vite:** `tsc --noEmit` **não** valida presença de providers — só o smoke test em runtime pega esse tipo de erro (ver §20).
- **Compose:** `docker compose run` precisa de `-T` (sem TTY) em script não interativo.
- **Portas no Docker:** container só publica portas em **≥1 rede sem `internal: true`** (ver §19.2 #8). Ao mexer nas redes, conferir `NetworkSettings.Ports` e não só `HostConfig.PortBindings`.
- **nginx + bind mount:** mudanças em `nginx.conf` **não** recarregam sozinhos (compose não recria o contêiner); `nginx -T` mostra o arquivo do disco, **não** a config em execução — usar `docker exec <proxy> nginx -s reload` (o instalador de produção já faz isso).
- **Distroless:** `CMD` = só o script (o `ENTRYPOINT` da imagem já é o `node`), e builder/runtime precisam da **mesma família Debian** para os engines do Prisma (senão ele tenta baixar no boot e falha por permissão do usuário `nonroot`).
- **wmic foi descontinuado** (Windows 11 24H2+): a coleta de HWID tem fallback PowerShell/CIM; `getmac /fo csv` pode ter o MAC em qualquer coluna → regex por linha.
- **PowerShell 5.1 + `curl.exe`:** aspas embutidas no `-d '{…}'` chegam mutiladas ao curl (`INVALID_JSON`); em testes, escrever o JSON em arquivo e usar `-d @arquivo`.
- **React × contrato da API:** nunca decidir redirecionamento por campo que o backend **não envia** (`isValid` causou o loop do §19.2 #15) — conferir sempre o formato real do envelope. Rotas privadas/públicas devem aguardar a hidratação da sessão (`hydrated`), senão o estado inicial `isAuthenticated=false` briga com o restaurado e vira pingue-pongue de redirects; refresh de sessão/licença em background deve ter `catch` próprio (falha transitória não pode limpar credenciais).
- **Vite em container:** `localhost` dentro do container é o próprio container — proxy/target de dev precisa apontar para o serviço via DNS Docker (`papatec-api`), e a SPA deve usar `VITE_API_URL` absoluta (§19.2 #17).
- **Rate limit (300/min global, 20/15min no login):** um loop de frontend dispara centenas de req/min e recebe 429, mascarando a causa raiz; se o login estiver bloqueado após um incidente, `docker restart papatec-api` zera o contador (limiter em memória).

---

## 20. Checklist de smoke test

Após `INSTALAR.bat teste` (ou `producao`):

**API**
- [ ] `GET /api/health` → 200
- [ ] `GET /api/license/status` → `isLicensed: true`
- [ ] `GET /api/auth/setup-status` → `needsSetup: false` (após seed)
- [ ] `POST /api/auth/login` com `admin@papatec.com`/`admin123` → `{success:true}` + token

**SPA**
- [ ] `http://localhost:5173` (dev) / `https://localhost` (prod) abre sem erros no console
- [ ] Login redireciona ao Dashboard com os 4 KPIs
- [ ] Logo aparece no Header, Sidebar e Login
- [ ] Cliente novo → aparece na lista; CPF duplicado → erro amigável
- [ ] Orçamento novo → enviar → aprovar → **converter em O.S.** → estoque baixado (`GET /api/inventory/:id/movements`)
- [ ] O.S. acompanha status até `DELIVERED` (timeline visível)
- [ ] Aba Inventário → ajuste de estoque registra movimento
- [ ] `/backup` (ADMIN) → "Criar Backup Agora" → `.zip` na lista → restaurar em banco limpo
- [ ] `/settings` → 7 abas; mudar `backup_schedule` reagenda o cron
- [ ] Usuário sem papel ADMIN não vê Configurações/Backup/Relatórios

**DRM**
- [ ] Com licença removida/inválida: qualquer rota → 403 `SYSTEM_LOCKED_DRM_VIOLATION` e SPA vai para `/activate`
- [ ] `/activate` mostra o HWID `XXXX-XXXX-XXXX-XXXX` copiável

**Produção extra**
- [ ] `https://localhost` com cert auto-assinado (aceitar aviso)
- [ ] `docker compose images` → api com imagem Distroless/ofuscada
- [ ] Backup cron presente nos logs (`[Backup]`)

---

*Fim do documento. Arquivos relacionados: `README.md` (estrutura e fluxo de licenciamento), `INSTALACAO-CONFIGURACAO.txt` (guia de instalação para o cliente).*
