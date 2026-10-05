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

for (let i = 1; i <= MAX_RETRIES; i++) {
  try {
    console.log(`[Entrypoint] Tentativa ${i}/${MAX_RETRIES}: aplicando migrações...`);

    const result = spawnSync(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', `--schema=${schemaPath}`],
      { stdio: 'inherit', env: { ...process.env }, timeout: 60000 }
    );

    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`migração falhou com código ${result.status}`);

    console.log('[Entrypoint] Migrações aplicadas com sucesso.');
    break;
  } catch (err) {
    if (i === MAX_RETRIES) {
      console.error('[Entrypoint] FALHA CRÍTICA: banco indisponível após', MAX_RETRIES, 'tentativas.');
      console.error(String(err && err.message));
      process.exit(1);
    }
    console.warn(`[Entrypoint] Falha temporária: ${err.message}. Nova tentativa em ${RETRY_DELAY_MS / 1000}s...`);
    sleep(RETRY_DELAY_MS);
  }
}

console.log('[Entrypoint] Iniciando aplicação principal...');
require(path.join(APP_DIR, 'bundle.js'));
