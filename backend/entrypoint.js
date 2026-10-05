/**
 * Entrypoint do container Distroless (sem shell).
 * 1) Aplica as migrações do Prisma com retry (banco pode subir depois da API).
 * 2) Sobe a aplicação (bundle ofuscado).
 *
 * IMPORTANTE: não há shell nem /usr/bin/env na imagem distroless,
 * por isso o Prisma é invocado via `node <caminho do CLI>`.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const MAX_RETRIES = 30;
const RETRY_DELAY_MS = 2000;
const APP_DIR = __dirname;

function resolvePrismaCli() {
  try {
    return require.resolve('prisma/build/index.js');
  } catch (_err) {
    return path.join(APP_DIR, 'node_modules', 'prisma', 'build', 'index.js');
  }
}

function sleep(ms) {
  // distroless não tem setTimeout bloqueante confiável em loop de boot? (usa Atomics.wait)
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

console.log('[Entrypoint] Iniciando PapaTec ERP (Distroless)...');

const prismaCli = resolvePrismaCli();
const schemaPath = path.join(APP_DIR, 'prisma', 'schema.prisma');

if (!fs.existsSync(prismaCli)) {
  console.error('[Entrypoint] CLI do Prisma não encontrado em:', prismaCli);
  console.error('[Entrypoint] Verifique se `prisma` está em dependencies no package.json.');
  process.exit(1);
}

/**
 * Erro de configuração/schema é PERMANENTE: repetir 30x não muda nada e só
 * queima 60 segundos antes de o container morrer com um erro que aponta a
 * outra causa. O caso real: no Render faltava DATABASE_URL e o log mostrava
 * 30 linhas idênticas de "Falha temporária" - parecia banco instável, mas
 * era variable de ambiente.
 *
 * Erro de conexão (banco ainda subindo, timeout, DNS) é o caso que o retry
 * existe para tratar, e continua com retry.
 */
function classificar(texto) {
  const permanente = [
    [/P1012/, 'schema do Prisma inválido ou variável de ambiente faltando'],
    [/Environment variable not found/i, 'variável de ambiente faltando'],
    [/P1000/, 'autenticação recusada pelo banco (usuário/senha/URL)'],
    [/P3005/, 'o banco já tem tabelas sem histórico de migração'],
    [/P3009/, 'falha ao aplicar migrações'],
    [/schema validation/i, 'schema do Prisma inválido'],
  ];
  for (const [rx, causa] of permanente) {
    if (rx.test(texto)) return { permanente: true, causa };
  }
  return { permanente: false, causa: 'banco ainda não disponível' };
}

function orientacao(texto) {
  if (/Environment variable not found:\s*(\S+)/i.test(texto)) {
    const varName = /Environment variable not found:\s*(\S+)/i.exec(texto)[1];
    console.error('');
    console.error('  >>> CAUSA: a variável ' + varName + ' não está definida neste serviço.');
    console.error('');
    console.error('  No Render: Environment > Environment Variables > Add, e digite:');
    console.error('      chave : ' + varName);
    console.error('      valor : a URL de conexão do seu Postgres');
    console.error('  Em produção com docker compose, ela é montada a partir de');
    console.error('  DB_USER / DB_PASSWORD / DB_NAME (veja docker-compose.yml).');
    console.error('');
    console.error('  Repetir não vai resolver: variável faltando é erro de configuração.');
    return;
  }
  console.error('');
  console.error('  >>> Veja a causa acima. Se for o banco, confirme que ele está');
  console.error('  >>> no MESMO projeto/rede do serviço e que a URL está correta.');
  console.error('');
}

for (let i = 1; i <= MAX_RETRIES; i++) {
  console.log(`[Entrypoint] Tentativa ${i}/${MAX_RETRIES}: aplicando migrações...`);

  // 'pipe' em vez de 'inherit': precisamos ler a saída para classificar o erro.
  // Ela é repassada logo abaixo, então o log continua igual.
  const result = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', `--schema=${schemaPath}`],
    { stdio: 'pipe', encoding: 'utf8', env: { ...process.env }, timeout: 60000 }
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    console.warn(`[Entrypoint] Erro ao executar o Prisma CLI: ${result.error.message}`);
  } else if (result.status === 0) {
    console.log('[Entrypoint] Migrações aplicadas com sucesso.');
    break;
  }

  const saida = `${result.stdout || ''}\n${result.stderr || ''}`;
  const { permanente, causa } = classificar(saida);

  if (permanente) {
    console.error('');
    console.error('======================================================================');
    console.error('[Entrypoint] FALHA DE CONFIGURAÇÃO (não adianta repetir)');
    console.error('  Causa: ' + causa);
    console.error('======================================================================');
    orientacao(saida);
    process.exit(1);
  }

  if (i === MAX_RETRIES) {
    console.error('[Entrypoint] FALHA CRÍTICA: banco indisponível após', MAX_RETRIES, 'tentativas.');
    process.exit(1);
  }

  console.warn(
    `[Entrypoint] Falha temporária (${saida.trim().split('\n').pop() || 'sem detalhe'}). ` +
    `Nova tentativa em ${RETRY_DELAY_MS / 1000}s...`
  );
  sleep(RETRY_DELAY_MS);
}

console.log('[Entrypoint] Iniciando aplicação principal...');
require(path.join(APP_DIR, 'bundle.js'));
