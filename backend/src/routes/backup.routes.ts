import { Router } from 'express';
import multer from 'multer';
import { ok, badRequest, notFound } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { backupService } from '../services/backup.service';
import { settingsService } from '../services/settings.service';

export const backupRouter = Router();

// Upload de .bkp enviado pelo painel (de outra máquina) — memória p/ validar
const uploadBackup = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

// ---------------------------------------------------------------------------
// GET /api/backup/machine?token=... — ANTES da autenticação: o script de
// cópia local das máquinas internas puxa o .bkp mais novo usando o token.
// ---------------------------------------------------------------------------
backupRouter.get(
  '/machine',
  handler(async (req, res) => {
    await backupService.assertMachineToken(String(req.query.token || ''));
    const latest = await backupService.latest();
    if (!latest) throw notFound('Nenhum backup disponível ainda.');
    res.download(latest.path, latest.name);
  })
);

backupRouter.use(requireAuth);

// GET /api/backup/list - ADMIN
backupRouter.get(
  '/list',
  requireRole('ADMIN'),
  handler(async (_req, res) => {
    const [files, path, schedule] = await Promise.all([
      backupService.list(),
      settingsService.getBackupPath(),
      settingsService.getBackupSchedule(),
    ]);
    ok(res, { files, path, schedule });
  })
);

// GET /api/backup/status - ADMIN (tempo real: último dump, caminho, agenda)
backupRouter.get(
  '/status',
  requireRole('ADMIN'),
  handler(async (_req, res) => {
    ok(res, await backupService.status());
  })
);

// GET /api/backup/config - estado atual para a tela de configuração (ADMIN)
backupRouter.get(
  '/config',
  requireRole('ADMIN'),
  handler(async (_req, res) => {
    const settings = await settingsService.getByCategory('BACKUP');
    ok(res, settings);
  })
);

// GET /api/backup/token - ADMIN (token das máquinas internas, gera se vazio)
backupRouter.get(
  '/token',
  requireRole('ADMIN'),
  handler(async (_req, res) => {
    ok(res, { token: await backupService.getMachineToken() });
  })
);

// POST /api/backup/token - ADMIN (regenerar token — máquinas precisam atualizar)
backupRouter.post(
  '/token',
  requireRole('ADMIN'),
  handler(async (_req, res) => {
    ok(res, { token: await backupService.regenerateMachineToken() });
  })
);

// GET /api/backup/download/:file - ADMIN (baixar .bkp para esta máquina)
backupRouter.get(
  '/download/:file',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const file = await backupService.resolveFile(req.params.file);
    res.download(file.path, file.name);
  })
);

// GET /api/backup/inspect/:file - ADMIN (resumo antes de restaurar)
backupRouter.get(
  '/inspect/:file',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    ok(res, await backupService.inspect(req.params.file));
  })
);

// POST /api/backup/upload - ADMIN (subir um .bkp de outra máquina)
backupRouter.post(
  '/upload',
  requireRole('ADMIN'),
  uploadBackup.single('file'),
  handler(async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest('Nenhum arquivo enviado.', 'BACKUP_FILE_EMPTY');
    const info = await backupService.saveUpload(file.buffer, file.originalname);
    ok(res, info, 201);
  })
);

// POST /api/backup/create - ADMIN
backupRouter.post(
  '/create',
  requireRole('ADMIN'),
  handler(async (_req, res) => {
    ok(res, await backupService.runManual());
  })
);

// POST /api/backup/cleanup - ADMIN
backupRouter.post(
  '/cleanup',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const retentionDays = req.query.retentionDays ? Number(req.query.retentionDays) : undefined;
    ok(res, await backupService.cleanup(retentionDays));
  })
);

// POST /api/backup/restore/:file - ADMIN (destrutivo, exige confirmação no front)
backupRouter.post(
  '/restore/:file',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    ok(res, await backupService.restore(req.params.file));
  })
);

// POST /api/backup/sync/:file - ADMIN
backupRouter.post(
  '/sync/:file',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    ok(res, await backupService.sync(req.params.file));
  })
);

// DELETE /api/backup/:file - ADMIN
backupRouter.delete(
  '/:file',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    await backupService.delete(req.params.file);
    ok(res, { message: 'Backup excluído' });
  })
);

// ===========================================================================
// SNAPSHOT ON-TIME (.tmp) - Estado 1:1 da máquina a cada minuto
// ===========================================================================

// POST /api/backup/snapshot - Recebe snapshot de máquina cliente (máquina de usuário/vendedor/técnico)
// Body: { machineId, data: { ... } } - o servidor salva na fila para processar a cada 1 min
backupRouter.post(
  '/snapshot',
  handler(async (req, res) => {
    const { machineId, data } = req.body;
    if (!machineId || !data) throw badRequest('machineId e data são obrigatórios', 'SNAPSHOT_INVALID');
    backupService.receiveSnapshot(machineId, data);
    ok(res, { message: 'Snapshot recebido na fila de processamento' });
  })
);

// GET /api/backup/snapshot/status - ADMIN (status do sistema de snapshots)
backupRouter.get(
  '/snapshot/status',
  requireRole('ADMIN'),
  handler(async (_req, res) => {
    ok(res, await backupService.snapshotStatus());
  })
);

// GET /api/backup/snapshot/list - ADMIN (lista snapshots .tmp salvos)
backupRouter.get(
  '/snapshot/list',
  requireRole('ADMIN'),
  handler(async (_req, res) => {
    const { readdirSync, statSync } = await import('fs');
    const { join, resolve } = await import('path');
    
    const getDir = () => backupService.getSnapshotDir?.() || '';
    const dir = getDir();
    if (!dir) return ok(res, { snapshots: [] });
    
    try {
      const files = readdirSync(dir)
        .filter(f => f.endsWith('.tmp'))
        .map(f => {
          const path = join(dir, f);
          const stats = statSync(path);
          return { name: f, size: stats.size, createdAt: stats.mtime.toISOString() };
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      ok(res, { snapshots: files });
    } catch {
      ok(res, { snapshots: [] });
    }
  })
);

// GET /api/backup/snapshot/download/:file - ADMIN (baixar .tmp)
backupRouter.get(
  '/snapshot/download/:file',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const dir = await backupService.getSnapshotDir?.() || '';
    if (!dir) throw notFound('Diretório de snapshots não encontrado');
    const { join, resolve } = await import('path');
    const filePath = resolve(join(dir, req.params.file));
    res.download(filePath, req.params.file);
  })
);
