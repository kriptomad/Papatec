import { Router } from 'express';
import { ok, badRequest } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { licenseService } from '../services/license.service';
import { getMachineFingerprint } from '../utils/machineId';

export const licenseRouter = Router();

// GET /api/license/challenge - entrega o HWID (rota pública)
licenseRouter.get(
  '/challenge',
  handler(async (_req, res) => {
    ok(res, licenseService.getChallenge());
  })
);

// GET /api/license/status - status público (rota pública)
licenseRouter.get(
  '/status',
  handler(async (_req, res) => {
    ok(res, await licenseService.getStatus());
  })
);

// POST /api/license/activate - ativa a licença (rota pública)
licenseRouter.post(
  '/activate',
  handler(async (req, res) => {
    const token = req.body?.token ?? req.body?.license ?? req.body?.licenseJson;
    if (!token || !String(token).trim()) throw badRequest('Token de licença é obrigatório.', 'MISSING_TOKEN');
    ok(res, await licenseService.activate(String(token).trim()));
  })
);

// POST /api/license/deactivate - DESTRUTIVO: desvincula a máquina e invalida
// o cache do LicenseGuard, travando a INSTALAÇÃO INTEIRA até reativar.
// Antes esta rota não tinha requireAuth: qualquer cliente que conseguisse
// alcançar o servidor com o sistema licenciado podia desligar o DRM sem
// credencial nenhuma (DoS remoto do DRM). Agora exige sessão + ADMIN.
licenseRouter.post(
  '/deactivate',
  requireAuth,
  requireRole('ADMIN'),
  handler(async (_req, res) => {
    await licenseService.deactivate();
    ok(res, { message: 'Licença desativada.', hardwareId: getMachineFingerprint() });
  })
);
