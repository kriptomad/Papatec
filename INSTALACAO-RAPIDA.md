# ============================================================
#  INSTALAÇÃO RÁPIDA — PapaTec Sistema Loja
# ============================================================
#
#  Um arquivo. Windows.
#  ---------------------------------------------------------
#  1. Copie o PapaTec-Setup-vAAAA.MMDD.exe para o computador
#  2. Clique com o botão direito → "Executar como administrador"
#  3. Escolha a opção 1 (produção) e aguarde
#  ---------------------------------------------------------
#
#  O .exe já traz o sistema inteiro dentro dele e instala o Docker
#  se ele não existir. Não precisa de Node, Git, Python ou instalação
#  extra nenhuma.
#
#  SEM INTERNET? Deixe o instalador oficial do Docker
#  (DockerDesktopInstaller.exe) ao lado do PapaTec-Setup.exe: o passo
#  "Preparar a máquina" usa o arquivo local em vez de baixar.
#
#  ============================================================
#  PARA QUEM PREFERIR SCRIPT (servidor Linux / desenvolvimento)
#  ============================================================
#
#  LINUX (servidor de produção — Ubuntu/Debian/RHEL/Alpine)
#  ---------------------------------------------------------
#      sudo ./instalar.sh
#
#  O Docker NÃO precisa estar instalado: o script usa o repositório
#  oficial (get.docker.com) ou apk, e já traz o plugin compose v2.
#
#  ---------------------------------------------------------
#  WINDOWS (Docker Desktop)
#  ---------------------------------------------------------
#      INSTALAR.bat
#
#  Se o Docker Desktop não existir, o instalador baixa e instala
#  sozinho (winget ou instalador oficial, ~600 MB). Depois é preciso
#  REINICIAR o Windows e abrir o Docker Desktop uma vez.
#
#  ---------------------------------------------------------
#  OUTROS COMANDOS
#  ---------------------------------------------------------
#  Só preparar a máquina, sem compilar (útil antes de um deploy):
#      sudo ./instalar.sh --preparar        |  INSTALAR.bat preparar
#
#  Diagnóstico — quando algo deu errado (não muda nada):
#      sudo ./instalar.sh verificar         |  INSTALAR.bat verificar
#
#  Modo desenvolvimento (hot reload, porta 5173):
#      sudo ./instalar.sh --teste           |  INSTALAR.bat teste
#
#  Atualizar para o código novo (preserva dados):
#      sudo ./instalar.sh update             |  INSTALAR.bat atualizar
#
#  Só o Docker, sem o sistema:
#      sudo ./instalar.sh --senha-docker
#
#  O mesmo pelo .exe, direto (sem passar pelo menu):
#      .\PapaTec-Setup-vAAAA.MMDD.exe producao
#      .\PapaTec-Setup-vAAAA.MMDD.exe preparar
#      .\PapaTec-Setup-vAAAA.MMDD.exe /D=C:\Pasta\Instalar producao
#
#  ---------------------------------------------------------
#  O QUE SIGNIFICA CADA OPÇÃO DO MENU DO .EXE
#  ---------------------------------------------------------
#  [1] Instalar (PRODUÇÃO) ....... recomendado para o cliente
#  [2] Só preparar a máquina ....... Docker + segredos + pastas (sem build)
#  [3] Verificar / diagnosticar .... não muda nada, só aponta o problema
#  [4] Modo TESTE .................. desenvolvimento, com hot reload
#  [5] Onde o Docker está sendo baixado?
#  [6] Sair
#
#  Os arquivos são instalados em  C:\Program Files\PapaTec
#  (dá para mudar:  /D=C:\Outro\Lugar )
#  Rodar de novo é seguro: o .env do cliente NUNCA é sobrescrito.
#
#  operating                    Linux                    Windows
#  ------------------------------------------------------------------
#  situação / saúde            status                    status
#  logs (Ctrl+C sai)           logs                      logs
#  backup                      backup                    backup
#  licença                     licenca                   licenca
#  parar / subir               stop / start              parar / iniciar
#  apagar o banco              reset                     reset
#
#  ===========================================================
#  O QUE O INSTALADOR FAZ
#  ===========================================================
#
#  1. DOCKER
#     - Se ausente: instala o engine + plugin compose v2
#     - Se presente: só verifica e te coloca no grupo `docker`
#     - Libera a pasta do projeto no File Sharing (Windows)
#
#  2. SEGREDOS (.env) — gerados, nunca pedidos
#     - senha do PostgreSQL e JWT_SECRET (64 hex aleatórios)
#     - CARD_MACHINE_CALLBACK_TOKEN (callback da maquininha)
#     - MACHINE_UUID / MACHINE_MAC lidos do HOST
#
#     O UUID/MAC é lido no host de propósito: dentro do container
#     Linux não existe wmic/getmac, então sem isso o HWID cairia
#     no fallback e ficaria IDÊNTICO em todas as máquinas —
#     anulando a amarração da licença ao hardware. MACs de
#     Hyper-V/VirtualBox/VMware/Docker são descartados.
#
#     O .env recebe permissão 600 (ele tem senha do banco e a chave
#     privada do JWT).
#
#  3. PASTAS DE BIND MOUNT
#     uploads · backups · certs · logs
#     (sem elas o compose falha com "path is not shared from the host")
#
#  4. PORTAS 80/443
#     O proxy HTTPS precisa delas. Se apache2/httpd/nginx estiverem
#     ocupando, o instalador oferece parar.
#
#  5. BUILD + SUBIDA
#     Primeira vez baixa as imagens e compila (alguns minutos).
#     As migrações do banco rodam sozinhas no boot da API.
#
#  6. SAÚDE
#     Espera /api/health responder e mostra o HWID da máquina.
#
#  É IDEMPOTENTE: rodar de novo não troca segredos nem apaga dados.
#  Para trocar de versão use `update`; para zerar, `reset` (apaga o banco).
#
#  ===========================================================
#  APÓS INSTALAR
#  ===========================================================
#
#  Sistema   https://<ip-do-servidor>
#  Login     https://<ip-do-servidor>/login  → "Criar primeiro administrador"
#  Licença   sudo ./instalar.sh licenca     (cola o token da Filitech)
#
#  ===========================================================
#  PROBLEMAS COMUNS
#  ===========================================================
#
#  "porta 80/443 já está em uso"
#      sudo ./instalar.sh verificar        mostra quem está usando
#      (o instalador já oferece parar o apache/nginx)
#
#  "the path ... is not shared from the host"  (só Windows)
#      Docker Desktop > Settings > Resources > File Sharing > Add
#      → selecione a pasta do projeto → Apply & Restart
#      O instalador tenta fazer isso sozinho.
#
#  "403 em todas as páginas"
#      A licença não está ativada. Veja o HWID em `licenca` e solicite
#      o token à Filitech. Se a tabela `licenses` ainda estiver vazia,
#      mantenha DRM_BYPASS=true no .env.
#
#  A primeira instalação demorou muito
#      Normal: baixa imagem do Postgres/Node e compila o bundle.
#      Para gerar o Docker e o .env sem esperar:
#          sudo ./instalar.sh --preparar
#