# ============================================================
#  DEPLOY NO RENDER — PapaTec Sistema Loja
# ============================================================
#
#  O Render nao roda `docker compose`, entao o stack de 4 servicos
#  (db + api + web + proxy) vira 3 recursos do Render:
#
#      PostgreSQL do Render   ->  DATABASE_URL
#      Web Service (Node)     ->  a API
#      Static Site            ->  o frontend (SPA)
#
#  O proxy nginx com HTTPS nao vem: o Render ja termina TLS e
#  entrega HTTPS no dominio *.onrender.com.
#
#
#  ---------------------------------------------------------
#  1. CRIAR O BLUEPRINT
#  ---------------------------------------------------------
#  No Render:  New  >  Blueprint  >  aponte para o repositorio
#  Ele cria os 3 recursos e ja sobe a API.
#
#  Se preferir montar na mao:
#      New > Postgres  (plano Starter - o free apaga em 30 dias)
#      New > Web Service > Node, Root Directory = backend
#      New > Static Site, Root Directory = frontend
#
#
#  ---------------------------------------------------------
#  2. O QUE O RENDER NAO CONSEGUE GERAR SOZINHO
#  ---------------------------------------------------------
#  Tres variaveis precisam ser coladas a mao. Sem as duas
#  primeiras a API nem sobe: o backend valida as chaves RS256
#  ANTES de abrir a porta e chama process.exit(1).
#
#  Gere o par de chaves (rode na sua maquina, dentro de backend/):
#
#      cd backend
#      npm ci
#      npm run keys
#
#  Ele imprime duas linhas.elas vao no Environment do Web Service:
#
#      JWT_PRIVATE_KEY_B64 = <primeira linha>
#      JWT_PUBLIC_KEY_B64  = <segunda linha>
#
#  ATENCAO: a chave privada e um SEGREDO. Trocar o par invalida
#  todos os sessoes ja emitidas (todo mundo desloga). Guarde num
#  lugar seguro: e o que assina o login.
#
#  A terceira e publica e ja vem no repositorio:
#
#      LICENSE_PUBLIC_KEY_B64 = valor de .env.example
#
#  No Render use "Add from .env" ou o botao de sync, e NAO
#  comente com aspas.
#
#
#  ---------------------------------------------------------
#  3. APONTAR O FRONTEND PARA A API
#  ---------------------------------------------------------
#  So daria para automatizar se o Render montasse
#  "https://" + host + "/api" numa expressao - e nao monta.
#  Entao o passo e manual:
#
#      1. Abra o Web Service papatec-api e copie a URL
#         (ex.: https://papatec-api.onrender.com)
#      2. Static Site papatec-web > Environment
#      3. VITE_API_URL = https://papatec-api.onrender.com/api
#         (o /api no fim e obrigatorio: o backend monta as rotas em /api)
#      4. Salve e clique em "Manual Deploy > Deploy latest commit"
#
#  Sem o passo 3 a tela abre e toda chamada vai para
#  https://<site>/api - que devolve o index.html do SPA em vez de JSON.
#
#
#  ---------------------------------------------------------
#  4. VARIASVEIS QUE A API EXIGE
#  ---------------------------------------------------------
#  inherited do render.yaml, mas a lista na mao:
#
#      DATABASE_URL              (o Render preenche pelo Postgres)
#      JWT_SECRET                generateValue
#      JWT_PRIVATE_KEY_B64       COLAR  (passo 2)
#      JWT_PUBLIC_KEY_B64        COLAR  (passo 2)
#      LICENSE_PUBLIC_KEY_B64    COLAR  (passo 2)
#      NODE_ENV                  production
#      JWT_EXPIRES_IN            7d
#      DRM_BYPASS                true  (enquanto for teste)
#      UPLOADS_PATH              /opt/render/project/src/uploads
#      BACKUP_NETWORK_PATH       /opt/render/project/src/backups
#      CARD_MACHINE_CALLBACK_TOKEN  generateValue
#
#  O Start Command tem de ser:
#      npm run prisma:deploy && npm start
#
#  Sem o `prisma migrate deploy` o banco fica sem tabela e o
#  bootstrap do backend faz throw -> o servico fica em crash-loop.
#
#
#  ---------------------------------------------------------
#  5. O QUE MUDA EM RELACAO AO DOCKER (leia antes de testar)
#  ---------------------------------------------------------
#  DISCO EFEMERO
#      O Render apaga /opt/render/project/src a cada deploy. Fotos de
#      O.S., anexos e backups somem. Para producao de verdade, monte
#      um Disk do Render e aponte UPLOADS_PATH e BACKUP_NETWORK_PATH
#      para ele.
#
#  HTTPS
#      Ja vem pronto. O proxy nginx (que fazia TLS com certificado
#      auto-assinado) nao e necessario aqui.
#
#  CORS
#      Ja liberado no codigo (cors origin:true), entao o SPA em um
#      dominio e a API em outro se comunicam sem configuracao extra.
#
#  MAQUINHA DE CARTAO
#      O gateway real fala com a rede da loja. Do datacenter do Render
#      a rede da loja nao e alcancavel. Nesta fase use o driver
#      SIMULATED; so faz sentido com TEF/IP e VPN ate a loja.
#
#  LICENCA (DRM)
#      Com DRM_BYPASS=true o sistema abre sem licenca. Com "false" e
#      licenses vazia, TODA rota responde 403.
#
#  FREE vs STARTER
#      - web service free: dorme apos 15 min, 1o request demora ~1 min
#      - Postgres free: APAGA O BANCO depois de 30 dias
#      - instance free: 750 h/mes, nao liga instancia de banco
#
#
#  ---------------------------------------------------------
#  6. PRIMEIRO LOGIN
#  ---------------------------------------------------------
#      https://<site>.onrender.com/login  >  "Criar primeiro administrador"
#      admin@papatec.com / admin123
#
#  TROQUE ESSA SENHA. Ela e o mesmo par do seed de desenvolvimento.
#
#
#  ---------------------------------------------------------
#  7. QUANDO ALGO DAR ERRADO
#  ---------------------------------------------------------
#  "no such table / P3009" no log
#      As migracoes nao rodaram. Start Command sem o
#      `prisma migrate deploy`, ou o DATABASE_URL apontando para outro banco.
#
#  "[CRITICO] Chaves RS256 do JWT ausentes"
#      JWT_PRIVATE_KEY_B64 / JWT_PUBLIC_KEY_B64 nao chegaram ao servico.
#      Regere com `npm run keys` e cole de novo.
#
#  403 em tudo
#      Faltou LICENSE_PUBLIC_KEY_B64 (a API nem sobe sem ela) ou
#      DRM_BYPASS esta "false" com a tabela licenses vazia.
#
#  A tela abre e o login da "Failed to fetch"
#      VITE_API_URL errado ou nao rebuildado. Confira o /api no fim.
#      No DevTools > Network veja para onde o request realmente saiu.
#
#  502 / 503 intermitente
#      O web service free esta dormindo. Upgrade para Starter.
#
#  Logs
#      Render > seu servico > Logs > Live logs
#      (o bundle e ofuscado por design, mas o logger escreve JSON)
#