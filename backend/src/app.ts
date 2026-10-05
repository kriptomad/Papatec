import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { LicenseGuard } from './middleware/license';
import { notFoundHandler, errorHandler } from './http/errors';
import { globalRateLimiter, loginRateLimiter, registerRateLimiter, uploadRateLimiter } from './middleware/rateLimit';

import { authRouter } from './routes/auth.routes';
import { usersRouter } from './routes/users.routes';
import { clientsRouter } from './routes/clients.routes';
import { budgetsRouter } from './routes/budgets.routes';
import { serviceOrdersRouter, osMobileRouter } from './routes/serviceOrders.routes';
import { serviceVisitsRouter } from './routes/serviceVisits.routes';
import { serviceVisitsApprovalRouter } from './routes/serviceVisitsApproval.routes';
import { calendarEventsRouter } from './routes/calendarEvents.routes';
import { salesRouter } from './routes/sales.routes';
import { osRealtimeRouter } from './routes/osRealtime.routes';
import { partsRouter } from './routes/parts.routes';
import { suppliersRouter } from './routes/suppliers.routes';
import { purchasesRouter } from './routes/purchases.routes';
import { servicesRouter } from './routes/services.routes';
import { expensesRouter } from './routes/expenses.routes';
import { reportsRouter } from './routes/reports.routes';
import { settingsRouter } from './routes/settings.routes';
import { backupRouter } from './routes/backup.routes';
import { backupService } from './services/backup.service';
import { licenseRouter } from './routes/license.routes';
import { cardMachineRouter } from './routes/cardMachine.routes';
import { healthRouter } from './app/health';
import { cardMachineService } from './services/cardMachine.service';

import { logger } from './utils/logger';
import { UPLOADS_ROOT } from './services/storage.service';

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Segurança básica de cabeçalhos
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Rate limit global (proteção contra força bruta/DoS)
  app.use('/api', globalRateLimiter);

  // Rate limit mais restrito para login (antiforça-bruta)
  app.use('/api/auth/login', loginRateLimiter);

  // Rate limit para registro de usuários
  app.use('/api/auth/register', registerRateLimiter);

  // Rate limit para upload de arquivos
  app.use('/api/backup/upload', uploadRateLimiter);
  app.use('/api/os/upload', uploadRateLimiter);
  app.use('/api/budgets/*/upload', uploadRateLimiter);

  // Log de requisições
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.originalUrl}`, { ip: req.ip });
    next();
  });

  // Backup on-time: toda gravação bem-sucedida marca o serviço para regerar o
  // .bkp (debounce de 1,5s) — assim qualquer mínima alteração já fica 1:1.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.path.startsWith('/api')) {
      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) backupService.markDirty();
      });
    }
    next();
  });

  // Health check com probe REAL de banco (healthRouter).
  // O handler inline que existia aqui em /api/health SOMBREAVA o healthRouter
  // montado logo abaixo (Express para no primeiro match), deixando
  // app/health.ts como código morto: /api/health respondia 'ok' mesmo com o
  // banco caído, e o healthcheck do Docker nunca marcava o container como
  // unhealthy. Removido o handler redundante.
  app.use('/api', healthRouter);

  // ---------------------------------------------------------------------------
  // DRM: valida a licença em todas as rotas não públicas
  // ---------------------------------------------------------------------------
  app.use(LicenseGuard);

  // Arquivos estáticos (fotos de O.S., anexos) - nomes são UUIDs não adivinháveis
  app.use('/uploads', express.static(UPLOADS_ROOT, { fallthrough: true, dotfiles: 'deny', index: false }));

  // ---------------------------------------------------------------------------
  // Rotas da API
  // ---------------------------------------------------------------------------
  app.use('/api/license', licenseRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/clients', clientsRouter);
  app.use('/api/budgets', budgetsRouter);
  app.use('/api/service-orders', serviceOrdersRouter);
  // Briefing B6: upload de fotos do celular via token (sem sessão no aparelho)
  app.use('/api/os-mobile', osMobileRouter);
  // Briefing: aprovação de agendamento pelo técnico (rotas ESPECÍFICAS
  // /pending, /calendar, /:id/approve... precisam vir ANTES de /:id, senão
  // o router de visitas engole "pending"/"calendar" como um id)
  app.use('/api/service-visits', serviceVisitsApprovalRouter);
  // Briefing C1: registro de horas/visitas do técnico
  app.use('/api/service-visits', serviceVisitsRouter);
  // Calendário / Agendamentos
  app.use('/api/calendar', calendarEventsRouter);
  // Venda de Produto (PDV Lite) - separado de O.S.
  app.use('/api/sales', salesRouter);
  // Tempo real: observações do técnico na O.S.
  app.use('/api/os', osRealtimeRouter);
  app.use('/api/inventory', partsRouter);
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/purchases', purchasesRouter);
  app.use('/api/services', servicesRouter);
  app.use('/api/expenses', expensesRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/backup', backupRouter);
app.use('/api/card-machines', cardMachineRouter);

  // Aliases usados por alguns consumidores internos
  app.use('/api/quotes', budgetsRouter);
  app.use('/api/work-orders', serviceOrdersRouter);

  // 404 + error handler globais (para TODA a aplicação, não só /api).
  // Antes o notFoundHandler estava montado em app.use('/api', ...), então
  // GET /uploads/inexistente caía no static com fallthrough:true e recebia o
  // HTML cru do 404 padrão do Express, quebrando o envelope para blobs.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
