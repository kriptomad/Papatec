import { Request, Response, NextFunction } from 'express';
import { JwtPayload } from 'jsonwebtoken';
import { prisma } from '../db/prisma';
import { getMachineFingerprint } from '../utils/machineId';
import { LICENSE_PUBLIC_KEY, verifyLicenseRecord } from '../utils/licenseToken';
import { logger } from '../utils/logger';

/**
 * ---------------------------------------------------------------------------
 * LicenseGuard (DRM offline - challenge/response com JWT RS256)
 * ---------------------------------------------------------------------------
 * 1. A chave pública (RSA-2048) é embutida no build via LICENSE_PUBLIC_KEY_B64.
 * 2. A licença fica gravada na tabela `licenses`, atrelada ao HWID da máquina.
 * 3. Cada request (fora das rotas públicas) revalida assinatura + HWID + exp.
 * 4. Cache em memória com TTL de 5 minutos para não custar uma query por request.
 * 5. Violação => HTTP 403 { code: 'SYSTEM_LOCKED_DRM_VIOLATION' }
 * ---------------------------------------------------------------------------
 */

const PUBLIC_KEY_B64 = process.env.LICENSE_PUBLIC_KEY_B64 || '';
const PUBLIC_KEY = LICENSE_PUBLIC_KEY;

if (!PUBLIC_KEY_B64 || !PUBLIC_KEY) {
  logger.fatal('[DRM CRITICAL] LICENSE_PUBLIC_KEY_B64 não definida no build. O Guardião bloqueará tudo.');
}

const POSITIVE_TTL_MS = 5 * 60 * 1000; // 5 min para licença VÁLIDA
const NEGATIVE_TTL_MS = 30 * 1000;     // 30s para resultado NEGATIVO
const LOCK_TTL_MS = 5 * 60 * 1000;     // falha de infraestrutura: reavaliar com menos frequência

interface LicenseCache {
  isValid: boolean;
  lastCheck: number;
  licenseId: string | null;
  payload: JwtPayload | null;
}

let cache: LicenseCache = { isValid: false, lastCheck: 0, licenseId: null, payload: null };

/** Rotas liberadas mesmo sem licença válida. */
const PUBLIC_PATHS = [
  '/api/license/activate',
  '/api/license/challenge',
  '/api/license/status',
  '/api/auth/login',
  '/api/auth/setup-admin',
  '/api/auth/setup-status',
  '/api/auth/license/install',
  '/api/health',
  '/uploads',
];

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

function lock(res: Response, code: string, message: string, status = 403): Response {
  return res.status(status).json({ success: false, data: null, error: { code, message } });
}

function cacheTtl(): number {
  return cache.isValid ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
}

function rememberInvalid(): void {
  cache = { isValid: false, lastCheck: Date.now(), licenseId: null, payload: null };
}

export const LicenseGuard = async (req: Request, res: Response, next: NextFunction) => {
  // LicenseGuard é montado SEM prefixo (app.use(LicenseGuard)), então req.path
  // JÁ é o caminho completo: "/api/..." ou "/uploads/...".
  // A normalização antiga (`startsWith('/api') ? p : '/' + p`) produzia
  // "//uploads/arquivo.jpg", que não casa com PUBLIC_PATHS['/uploads'] => toda
  // foto/anexo de O.S. rodava o pipeline completo de DRM (query + execSync) e,
  // com licença inválida, o navegador recebia JSON 403 em vez dos bytes da imagem.
  const path = req.path;

  if (isPublic(path)) return next();

  // Bypass DRM - apenas desenvolvimento/teste.
  if (process.env.DRM_BYPASS === 'true') {
    if (process.env.NODE_ENV === 'production') {
      // Não bloqueia (mataria a instalação sem licença ativa), mas deixa o
      // alerta impossível de ignorar no log do container.
      logger.fatal('[DRM] DRM_BYPASS=true ATIVO EM PRODUCAO - validacao de licença DESLIGADA.');
    } else {
      logger.warn('[DRM] BYPASS ativado - ignorando validação de licença');
    }
    return next();
  }

  if (!PUBLIC_KEY) {
    logger.error('[DRM] Public Key não carregada no runtime');
    // 403, não 500: o interceptor do frontend só redireciona para /activate em 403.
    // Com 500 o operador via "Erro interno do servidor" para sempre e nunca
    // chegava na tela de ativação.
    return lock(res, 'DRM_CONFIG_ERROR', 'Public Key ausente no runtime.');
  }

  const now = Date.now();
  // O gate ANTIGO era `cache.isValid && ...`, ou seja, só memorizava acertos.
  // Num sistema SEM licença, CADA request fazia prisma.license.findUnique +
  // getMachineFingerprint() => até 3 execSync síncronos (5s/8s/5s de timeout)
  // bloqueando o event loop. Um único usuário autenticado conseguia congelar
  // o servidor inteiro. Agora o resultado negativo também é cacheado (TTL menor).
  if (now - cache.lastCheck < cacheTtl()) {
    if (!cache.isValid) {
      return lock(res, 'SYSTEM_LOCKED_DRM_VIOLATION', 'Licença inválida ou ausente para este hardware.');
    }
    (req as any).license = { id: cache.licenseId, payload: cache.payload };
    return next();
  }

  try {
    const currentHwid = getMachineFingerprint();

    const licenseRecord = await prisma.license.findUnique({ where: { hardwareId: currentHwid } });

    if (!licenseRecord || !licenseRecord.isActive) {
      rememberInvalid();
      logger.warn(`[DRM] Licença não encontrada ou inativa para HWID: ${currentHwid}`);
      return lock(res, 'SYSTEM_LOCKED_DRM_VIOLATION', 'Licença não encontrada ou inativa para este hardware.');
    }

    // Revalida a assinatura RS256 do token original armazenado (fallback:
    // reconstrução para registros legados)
    const decoded = verifyLicenseRecord(licenseRecord) as (JwtPayload & { hwid: string }) | null;

    if (!decoded) {
      rememberInvalid();
      logger.error(
        `[DRM ALERT] ASSINATURA INVÁLIDA para HWID ${currentHwid} (token ausente/corrompido) | IP: ${req.ip}`
      );
      return lock(res, 'SYSTEM_LOCKED_DRM_VIOLATION', 'Integridade da licença inválida.');
    }

    if (decoded.hwid !== currentHwid) {
      rememberInvalid();
      logger.error(
        `[DRM ALERT] CLONE DETECTADO! Token HWID: ${decoded.hwid} != Real HWID: ${currentHwid} | IP: ${req.ip}`
      );
      return lock(res, 'SYSTEM_LOCKED_DRM_VIOLATION', 'Violação de integridade: Hardware ID divergente.');
    }

    if (decoded.exp && decoded.exp * 1000 < Date.now()) {
      rememberInvalid();
      logger.warn(`[DRM] Licença expirada para HWID: ${currentHwid}`);
      return lock(res, 'LICENSE_EXPIRED', 'Licença expirada.');
    }

    cache = { isValid: true, lastCheck: now, licenseId: licenseRecord.id, payload: decoded };
    (req as any).license = { id: licenseRecord.id, payload: decoded };
    next();
  } catch (error: any) {
    rememberInvalid();
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      logger.error(`[DRM] Token inválido: ${error.message}`);
      return lock(res, 'SYSTEM_LOCKED_DRM_VIOLATION', 'Licença inválida ou corrompida.');
    }
    logger.error('[LicenseGuard Crash]', { error: error.message, stack: error.stack });
    // Infraestrutura quebrada: TTL longo para não martelar o banco a cada request.
    cache.lastCheck = Date.now() - (NEGATIVE_TTL_MS - LOCK_TTL_MS);
    return lock(res, 'INTERNAL_DRM_ERROR', 'Erro interno de validação de licença.', 500);
  }
};

/** Limpa o cache (usado após ativação/desativação de licença). */
export function invalidateLicenseCache(): void {
  cache = { isValid: false, lastCheck: 0, licenseId: null, payload: null };
}
