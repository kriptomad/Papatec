import { createApp } from './app';
import { connectDatabase, disconnectDatabase, prisma } from './db/prisma';
import { settingsService } from './services/settings.service';
import { backupService } from './services/backup.service';
import { seedDefaultServices } from './services/catalog.service';
import { ensureUploadsDir } from './services/storage.service';
import { assertKeys } from './utils/jwtKeys';
import { LICENSE_PUBLIC_KEY } from './utils/licenseToken';
import { logger } from './utils/logger';

const PORT = Number(process.env.PORT) || 3001;

/**
 * C2: valida TODO o material criptográfico ANTES de abrir o servidor.
 *
 * Antes só se checava JWT_SECRET (e LICENSE_PUBLIC_KEY_B64 apenas com um log).
 * As chaves RS256 só eram tocadas dentro de assertKeys(), no PRIMEIRO login ou
 * em toda request autenticada — o servidor subia "saudável" e depois respondia
 * 500 INTERNAL_ERROR ("Erro interno do servidor") para login E para cada chamada
 * autenticada, sem nenhuma pista no log de boot.
 */
function assertRuntimeSecrets(): void {
  if (!process.env.JWT_SECRET) {
    logger.fatal('[CRÍTICO] JWT_SECRET ausente. O servidor não pode iniciar com segurança.');
    process.exit(1);
  }

  try {
    assertKeys();
  } catch (error: any) {
    logger.fatal('[CRÍTICO] Chaves RS256 do JWT ausentes/inválidas - login e toda rota autenticada falhariam.', {
      error: error.message,
    });
    process.exit(1);
  }

  if (!LICENSE_PUBLIC_KEY) {
    // Sem chave pública, LicenseGuard responde 403/500 em TODA rota não-pública.
    logger.fatal('[DRM CRITICAL] LICENSE_PUBLIC_KEY_B64 ausente ou inválida - todas as rotas seriam bloqueadas.');
    process.exit(1);
  }

  if (process.env.DRM_BYPASS === 'true' && process.env.NODE_ENV === 'production') {
    logger.fatal('[DRM] DRM_BYPASS=true EM PRODUÇÃO - validação de licença DESLIGADA.');
  }
}

async function bootstrap(): Promise<void> {
  logger.info('===========================================================');
  logger.info('PapaTec - Sistema Loja - Backend iniciando');
  logger.info(`Node ${process.version} | PORT ${PORT} | ENV ${process.env.NODE_ENV || 'development'}`);
  logger.info('===========================================================');

  // 0. Segredos/chaves (antes de qualquer I/O: falha aqui deve ser imediata)
  assertRuntimeSecrets();

  // 1. Banco de dados (com retry - útil no boot do docker-compose)
  await connectDatabase();

  // 2. Configurações padrão
  try {
    await settingsService.ensureDefaults();
  } catch (error: any) {
    logger.error('Falha ao inicializar configurações (migrações aplicadas?)', { error: error.message });
    throw error;
  }

  // 3. Catálogo de serviços pré-definidos (Formatação, Limpeza, Montagem...)
  try {
    const created = await seedDefaultServices();
    if (created > 0) logger.info(`Catálogo: ${created} serviço(s) padrão criado(s).`);
  } catch (error: any) {
    logger.error('Falha ao semear catálogo de serviços', { error: error.message });
  }

  // 4. Pasta de uploads
  ensureUploadsDir();

  // 5. Backup agendado (caminho configurável pela UI)
  await backupService.start();

  // 6. HTTP
  const app = createApp();
  const server = app.listen(PORT, () => {
    logger.info(`Servidor PapaTec - Sistema Loja ouvindo na porta ${PORT}`);
  });

  server.on('error', (error) => {
    logger.error('Falha ao iniciar o servidor HTTP', { error: error.message });
    process.exit(1);
  });

  // ---------------------------------------------------------------------------
  // Encerramento gracioso
  // ---------------------------------------------------------------------------
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Recebido ${signal} - encerrando...`);

    // Watchdog REF (não .unref()): com .unref() o timer só corria se houvesse
    // sockets vivos, e eram justamente as conexões SSE abertas que seguravam o
    // loop — o callback de server.close() podia nunca completar.
    const watchdog = setTimeout(() => {
      logger.warn('[Shutdown] Tempo esgotado - encerrando forçadamente.');
      process.exit(1);
    }, 10_000);

    try {
      await backupService.stop(); // para cron/debounce E descarrega o dump pendente
    } catch (error: any) {
      logger.warn('[Shutdown] Falha ao finalizar backup pendente', { error: error.message });
    }

    // server.close() só completa quando TODAS as conexões caírem — incluindo
    // as SSE, que nunca fecham sozinhas. Fechar sockets ativos é o que
    // permitia o callback disparar.
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections?.();
      setTimeout(() => server.closeAllConnections?.(), 4_000).unref();
    });

    await disconnectDatabase().catch(() => undefined);
    clearTimeout(watchdog);
    logger.info('Servidor encerrado com segurança.');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Depois de um rejection/exception não tratado o processo fica em estado
  // indefinido (pool do Prisma/sockets potencialmente corrompidos). Apenas
  // LOGAR mantinha o processo de pé, servindo requests contra um pool quebrado,
  // invisível para o restart policy do Docker. Matar é melhor: o orquestrador
  // reinicia e o erro vira visível.
  process.on('unhandledRejection', (reason) => {
    logger.fatal('unhandledRejection - estado indefinido, encerrando', { reason: String(reason) });
    process.exit(1);
  });
  process.on('uncaughtException', (error) => {
    logger.fatal('uncaughtException - estado indefinido, encerrando', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });

  return undefined;
}

bootstrap().catch((error) => {
  logger.error('Falha crítica no bootstrap', { error: error?.message, stack: error?.stack });
  process.exit(1);
});

export { prisma };
