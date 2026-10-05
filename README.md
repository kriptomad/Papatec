# PapaTec - Sistema Loja

Sistema on-premise de gestão para assistência técnica de eletrônicos/celulares/PC,
com DRM proprietário offline (challenge-response RSA-2048) licenciado pela **Filitech**.

> Guia completo de instalação e configuração na máquina do cliente:
> **[`INSTALACAO-CONFIGURACAO.txt`](./INSTALACAO-CONFIGURACAO.txt)**

> Documentação técnica completa (arquitetura, **todas as rotas e chamadas**, módulos,
> DRM, backup, segurança, decisões e backlog de ideias):
> **[`DOCUMENTACAO-COMPLETA.md`](./DOCUMENTACAO-COMPLETA.md)**

---

## Estrutura do Projeto

```
PapaTec ERP/
├── INSTALACAO-CONFIGURACAO.txt # >>> documento de instalação <<<
├── docker-compose.yml          # db + api + web + proxy (80/443)
├── docker-compose.dev.yml # modo desenvolvimento
├── nginx.conf                  # proxy TLS na borda
├── .env / .env.example
├── INSTALAR.bat / INSTALAR.ps1   # >>> instalador com menu (teste/produção) <<<
├── GERAR-INSTALADOR.ps1          # gera o PapaTec-Setup-*.exe (auto-contido)
├── instalador/                   # fonte do stub do .exe (C# + manifest)
├── DEV-LOCAL.bat / DEV-LOCAL.ps1 # dev local com Node (API 3001 + SPA 5173)
├── start.bat / init.ps1          # inicializadores alternativos
├── scripts/
│   └── audit-parity.js         # auditoria de rotas frontend x backend
├── backup-agent/               # agente de backup externo (opcional, README interno)
├── proxy/                      # nginx de borda (gera certificado na 1ª subida)
├── backend/
│   ├── Dockerfile              # builder -> Distroless + bundle ofuscado
│   ├── entrypoint.js           # prisma migrate deploy + boot
│   ├── prisma/schema.prisma
│   └── src/
│       ├── app.ts / main.ts
│       ├── middleware/{auth,license,errors}.ts
│       ├── routes/*.ts         # auth, clients, budgets, service-orders,
│       │                       # inventory, services, expenses, reports,
│       │                       # settings, backup, license, users
│       └── services/*.ts       # license, backup, settings, storage, catalog
└── frontend/
    ├── Dockerfile              # build SPA -> nginx + proxy /api
    ├── public/                 # logo PapaTec (horizontal + marca) e favicon
    └── src/
        ├── App.tsx             # rotas públicas/privadas/guards
        ├── services/api.ts     # cliente axios com envelope {success,data,error}
        ├── pages/...           # dashboard, clientes, orçamentos, OS,
        │                       # estoque, serviços, financeiro, backup,
        │                       # configurações, licença, ativação
        └── components/{layout,ui}
```

---

## 1. Licenciamento (emitido pela Filitech)

A emissão de licenças é feita **offline pela Filitech** — este pacote não
inclui gerador de licenças. O fluxo é:

1. Cliente abre `https://<servidor>/activate` e copia o **Hardware ID**
   (`XXXX-XXXX-XXXX-XXXX`);
2. Envia o HWID + nome da empresa para **licenca@filitech.com.br**;
3. Recebe o **token de licença** (linha única) e cola na mesma tela → *Ativar*;
4. Pronto: a licença fica gravada no banco atrelada ao hardware.

O valor `LICENSE_PUBLIC_KEY_B64` (chave pública que valida os tokens) **já vem
preenchido no `.env`** — não altere. Sem ele (ou sem token ativo), o sistema
retorna `403 SYSTEM_LOCKED_DRM_VIOLATION` e exibe a tela de ativação.

Validade padrão: 1 ano. Renovação: mesmo fluxo, sem perda de dados.

---

## 2. PapaTec - Sistema Loja (máquina do cliente)

### Instalação rápida

**Um arquivo. Windows.**

```
1. Copie  PapaTec-Setup-vAAAA.MMDD.exe  para a máquina do cliente
2. Clique com o botão direito → "Executar como administrador"
3. Escolha a opção 1 (produção)
```

O `.exe` **traz o sistema inteiro dentro dele** (0,8 MB — o código-fonte
compactado e colado no fim do executável). Não precisa de Node, Git, Python,
.NET SDK, WiX, Inno Setup nem NSIS: ele foi compilado com o `csc.exe` que já
vem no Windows. Ele descompacta em `C:\Program Files\PapaTec` e chama o
`INSTALAR.ps1`, que é o mesmo instalador usado no desenvolvimento.

Para gerar o `.exe` depois de mexer no código:

```powershell
.\GERAR-INSTALADOR.ps1              # gera PapaTec-Setup-vAAAA.MMDD.exe
.\GERAR-INSTALADOR.ps1 -Versao v1.2 # versão customizada
```

**Sem internet no local?** Deixe o `DockerDesktopInstaller.exe` oficial do
Docker ao lado do `PapaTec-Setup.exe`. O passo "Preparar a máquina" passa a
usar o arquivo local em vez de baixar.

### Instalação via script (desenvolvimento e servidores)

**Um comando, em qualquer sistema. O Docker é instalado junto.**

```bash
# Linux (servidor de produção)
sudo ./instalar.sh
```

```powershell
# Windows
.\INSTALAR.bat
```

O instalador **instala o Docker se ele não existir** (repositório oficial no
Linux; Docker Desktop via winget ou instalador oficial no Windows), gera todos
os segredos, configura o File Sharing, cria as pastas, sobe os containers e
espera a API responder. Detalhes em
**[INSTALACAO-RAPIDA.md](INSTALACAO-RAPIDA.md)**.

Quando algo dá errado, o diagnóstico não muda nada e diz o que falta:

```bash
sudo ./instalar.sh verificar        # Linux
.\INSTALAR.bat verificar            # Windows
```

### Instalação rápida (Windows) — referência completa

```powershell
cd "C:\Users\User\Documents\Filitech Projects\PapaTec ERP"
.\INSTALAR.bat              # menu interativo
.\INSTALAR.bat producao     # ou direto, modo produção
.\INSTALAR.bat preparar     # só Docker + .env + pastas (sem build)
```

O instalador verifica o Docker, cria o `.env` (gera `DB_PASSWORD`,
`JWT_SECRET` e `CARD_MACHINE_CALLBACK_TOKEN` aleatórios, e lê `MACHINE_UUID` /
`MACHINE_MAC` do host para o HWID da licença), valida a
`LICENSE_PUBLIC_KEY_B64`, sobe os containers, aplica as migrações, checa a
saúde e abre o navegador.

Menu do `INSTALAR.bat`:

| Opção | O que faz |
|-------|-----------|
| **0** | Preparar a máquina (Docker + `.env` + pastas, sem build) |
| **1** | Instalação **TESTE** (dev, hot-reload, dados de exemplo) |
| **2** | Instalação **PRODUÇÃO** (cliente final, HTTPS, bundle ofuscado) |
| **3** | Status / saúde |
| **4** | Logs |
| **5** | Backup (criar / listar / restaurar / limpar) |
| **6** | Licença (verificar / ativar) |
| **7** | Parar (mantém dados) |
| **8** | Reset total (apaga o banco) |
| **9** | **Verificar / diagnosticar** — use quando algo falhar |
| **10** | Atualizar (código novo → containers, preserva dados) |
| **11** | Sair |

### Modo TESTE — testando funções novas com hot-reload

```powershell
.\INSTALAR.bat teste
```

- API `http://localhost:3001` (ts-node-dev, recarrega ao salvar)
- SPA `http://localhost:5173` (Vite, recarrega ao salvar)
- Executa `prisma migrate deploy` + `seed` (peças, serviços, cliente de
  exemplo e admin `admin@papatec.com` / `admin123`)
- Proxy TLS fica de fora nesse modo (`profiles: [production]`)
- Basta editar `backend\src` ou `frontend\src` — **não precisa rebuildar**

### Modo TESTE sem Docker na API (Node direto na máquina)

```powershell
.\DEV-LOCAL.bat            # sobe só o PostgreSQL em Docker + API + SPA
.\DEV-LOCAL.bat -Seed      # idem, recarrega os dados de exemplo
.\DEV-LOCAL.bat -Parar     # encerra API (3001) e SPA (5173)
```

Requer Node 20+. Cada serviço abre em sua própria janela de terminal.

### Instalação manual (equivalente ao modo produção)

```powershell
cd "C:\Users\User\Documents\Filitech Projects\PapaTec ERP"
copy .env.example .env      # preencha DB_PASSWORD e JWT_SECRET
docker compose up -d --build
```

> **Atenção:** os comandos do Docker precisam rodar **dentro** da pasta do
> sistema. `no configuration file provided: not found` significa que você está
> em outra pasta (ex.: `C:\Windows\system32`) — use `cd` antes.

- Sistema: `https://localhost` (certificado auto-assinado gerado automaticamente)
- Ativação: `https://localhost/activate`
- Health:   `https://localhost/api/health`

### Fluxo de primeira execução

1. `/activate` → copia o **Hardware ID** (`XXXX-XXXX-XXXX-XXXX`)
2. Envia o HWID + nome da empresa para **licenca@filitech.com.br** e recebe o token
3. `/activate` → cola o token → `POST /api/license/activate`
4. `/login` → cria o **primeiro administrador** (`GET /api/auth/setup-status`)
5. Painel admin → `/settings` (Empresa, Padrões, Backup, Inventário,
   Serviços, Financeiro, Usuários)

### Painel do administrador (`/settings` — somente ADMIN)

| Aba | O que o ADMIN configura |
|-----|--------------------------|
| **Empresa** | Nome, CNPJ, telefone, e-mail, endereço, rodapé de recibo, info do sistema |
| **Padrões** | Valor/hora de mão de obra, horas padrão, garantia, validade do orçamento, estoque mínimo, margem de lucro, sessão |
| **Backup** | Caminho de destino (via UI), cron, retenção, criar/restaurar/sincronizar/limpar/listar |
| **Inventário** | **Adicionar/editar/excluir itens**, entrada/saída/ajuste de estoque, preço de custo e venda, valoração total e por categoria, movimentação do mês (IN/OUT/AJUSTES), itens abaixo do mínimo |
| **Serviços** | CRUD do catálogo com preço e horas (Formatação, Limpeza, Montagem…) + "Restaurar Padrões" |
| **Financeiro** | Lucro/prejuízo mensal e anual, receita, custos, margem, ticket médio, despesas por categoria (CRUD) |
| **Usuários** | Criar, ativar/desativar, excluir (limite = `maxUsers` da licença) |

Nos orçamentos (`/budgets/new`) existem as abas **Dados / Itens (Peças) /
Serviços / Equipamentos** — a aba *Serviços* traz o catálogo pré-cadastrado.

---

## 3. Segurança / DRM

| Camada | Implementação |
|--------|----------------|
| Chave | RSA-2048, chave pública embutida via `LICENSE_PUBLIC_KEY_B64` |
| Token | JWT RS256 com `{hwid, client, iat, nbf, exp, features, maxUsers}` |
| HWID | SHA-256(UUID da placa-mãe + 1º MAC físico) → `XXXX-XXXX-XXXX-XXXX` |
| Guard | `LicenseGuard` em toda requisição (cache 5 min) → 403 `SYSTEM_LOCKED_DRM_VIOLATION` |
| Rotas públicas | `/api/license/{activate,challenge,status}`, `/api/auth/{login,setup-admin,setup-status,license/install}`, `/api/health`, `/uploads` |
| Ofuscação | esbuild + javascript-obfuscator (RC4 string-array, control-flow-flattening 1, dead-code, self-defending) |
| Runtime | Distroless (sem shell) + `entrypoint.js` aplicando `prisma migrate deploy` |
| BD | transação `SERIALIZABLE` na aprovação de orçamento (aprovação → baixa de estoque → OS) |

Auditoria de paridade de rotas frontend ↔ backend:

```powershell
node scripts/audit-parity.js     # "SEM CORRESPONDÊNCIA NO BACKEND (0)"
```

---

## 4. Comandos úteis

```powershell
.\INSTALAR.bat teste|producao|status|logs|backup|licenca|parar|reset
.\DEV-LOCAL.bat [-Seed|-Parar]               # Node na máquina (sem Docker na API)

docker compose up -d --build              # subir/atualizar
docker compose down                       # parar (mantém dados)
docker compose ps                         # status
docker compose logs -f api                # logs da API
docker compose restart proxy              # recarregar TLS

# modo desenvolvimento (API 3001, Vite 5173)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

# verificações locais (sem Docker)
cd backend  ; npx tsc --noEmit ; npm run build
cd frontend ; npm run build               # tsc + vite
```

---

## 5. Variáveis de ambiente (`.env`)

| Variável | Descrição |
|----------|-----------|
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | credenciais do PostgreSQL |
| `JWT_SECRET` | segredo dos tokens de sessão (32+ chars) |
| `JWT_EXPIRES_IN` | expiração do token (ex.: `7d`) |
| `LICENSE_PUBLIC_KEY_B64` | chave pública PEM em Base64 (**já preenchida no `.env`** — não alterar) |
| `BACKUP_NETWORK_PATH` | destino lógico dos backups (padrão `/backups`) |
| `BACKUP_SCHEDULE` | cron (padrão `0 12,18 * * *`) |
| `UPLOADS_PATH` | pasta de fotos/anexos (`/app/uploads`) |

---

## 6. Endpoints principais

```
GET  /api/health                     saúde da API (pública)
GET  /api/auth/setup-status          precisa criar o 1º admin? (pública)
POST /api/auth/login                 autenticação
GET  /api/license/challenge          retorna o HWID (pública)
POST /api/license/activate           ativa a licença {token} (pública)
GET  /api/license/status             status da licença
GET/POST /api/budgets                orçamentos (aba Serviços/Itens)
POST /api/budgets/:id/approve        aprovação ACID + baixa de estoque + cria OS
GET/POST /api/service-orders         ordens de serviço
GET  /api/inventory/low-stock        estoque abaixo do mínimo
GET  /api/reports/profit-loss/monthly  lucro/prejuízo do mês
GET  /api/reports/movements/monthly  entradas/saídas do estoque (IN/OUT)
PUT  /api/settings                   configurações (ADMIN)
POST /api/backup/create              backup manual (ADMIN)
```

---

## 7. Suporte

**Filitech** — Soluções em Segurança e Software  
Licenciamento: `licenca@filitech.com.br`

Sistema: PapaTec - Sistema Loja v1.0.0 | Licenciamento: Filitech (offline, RSA-2048)
