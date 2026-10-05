import { verify, JwtPayload } from 'jsonwebtoken';
import { prisma } from '../db/prisma';
import { getMachineFingerprint } from '../utils/machineId';
import { AppError } from '../http/envelope';
import { invalidateLicenseCache } from '../middleware/license';
import { LICENSE_PUBLIC_KEY, verifyLicenseRecord } from '../utils/licenseToken';
import { logger } from '../utils/logger';

export interface LicenseStatus {
  isLicensed: boolean;
  hardwareId: string;
  license: null | {
    clientName: string;
    issuedAt: string | null;
    expiresAt: string | null;
    daysRemaining: number;
    features: string[];
    maxUsers: number;
    active: boolean;
  };
}

export class LicenseService {
  /** GET /api/license/challenge - devolve o HWID desta máquina. */
  getChallenge(): { hardwareId: string; algorithm: string; format: string } {
    return {
      hardwareId: getMachineFingerprint(),
      algorithm: 'SHA-256',
      format: 'XXXX-XXXX-XXXX-XXXX',
    };
  }

  /** POST /api/license/activate - valida assinatura RS256 e persiste a licença. */
  async activate(token: string): Promise<{ message: string; license: any }> {
    if (!LICENSE_PUBLIC_KEY) {
      throw new AppError(500, 'DRM_CONFIG_ERROR', 'Chave pública de licença não configurada no build.');
    }

    let payload: JwtPayload & { hwid: string; client: string };
    try {
      payload = verify(token, LICENSE_PUBLIC_KEY, { algorithms: ['RS256'] }) as JwtPayload & {
        hwid: string;
        client: string;
      };
    } catch (error: any) {
      logger.warn(`[DRM] Tentativa de ativação com token inválido: ${error.message}`);
      throw new AppError(403, 'INVALID_LICENSE_TOKEN', 'Token de licença inválido ou expirado.');
    }

    const currentHwid = getMachineFingerprint();
    if (payload.hwid !== currentHwid) {
      logger.warn(`[DRM] Ativação rejeitada: HWID do token ${payload.hwid} != ${currentHwid}`);
      throw new AppError(
        403,
        'HWID_MISMATCH',
        'Hardware ID divergente. Esta licença não pertence a esta máquina.'
      );
    }

    const signature = token.split('.')[2];
    const record = await prisma.license.upsert({
      where: { hardwareId: currentHwid },
      create: { hardwareId: currentHwid, token, payload: payload as any, signature, isActive: true },
      update: { token, payload: payload as any, signature, isActive: true, updatedAt: new Date() },
    });

    invalidateLicenseCache();
    logger.info(`[DRM] Licença ativada para ${payload.client} (HWID ${currentHwid})`);

    return {
      message: 'Licença ativada com sucesso',
      license: {
        client: payload.client,
        expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
        id: record.id,
      },
    };
  }

  /** Desativa a licença atual (desvincula a máquina). */
  async deactivate(): Promise<void> {
    const currentHwid = getMachineFingerprint();
    await prisma.license.updateMany({ where: { hardwareId: currentHwid }, data: { isActive: false } });
    invalidateLicenseCache();
    logger.warn(`[DRM] Licença desativada para HWID ${currentHwid}`);
  }

  /** Status consolidado usado pelo frontend. */
  async getStatus(): Promise<LicenseStatus> {
    const hardwareId = getMachineFingerprint();
    const record = await prisma.license.findUnique({ where: { hardwareId } });

    if (!record || !record.isActive) {
      return { isLicensed: false, hardwareId, license: null };
    }

    // Revalida a assinatura RS256 do token armazenado. Se estiver inválida
    // (registro sem token / assinatura corrompida), apenas reporta "não
    // licenciado" - nunca desativa licenças em massa.
    const verified = verifyLicenseRecord(record);
    if (!verified) {
      logger.warn(`[DRM] Licença armazenada inválida para HWID ${hardwareId} (assinatura rejeitada).`);
      return { isLicensed: false, hardwareId, license: null };
    }

    if (verified.hwid && verified.hwid !== hardwareId) {
      logger.error(`[DRM ALERT] HWID divergente na licença persistida de ${hardwareId}`);
      return { isLicensed: false, hardwareId, license: null };
    }

    const payload = verified as any;
    const exp = payload?.exp as number | undefined;
    const daysRemaining = exp ? Math.ceil((exp * 1000 - Date.now()) / 86_400_000) : 99999;

    if (exp && exp * 1000 < Date.now()) {
      return { isLicensed: false, hardwareId, license: null };
    }

    return {
      isLicensed: true,
      hardwareId,
      license: {
        clientName: payload?.client || 'Cliente',
        issuedAt: payload?.iat ? new Date(payload.iat * 1000).toISOString() : null,
        expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
        daysRemaining,
        features: Array.isArray(payload?.features) ? payload.features : [],
        maxUsers: typeof payload?.maxUsers === 'number' ? payload.maxUsers : 0,
        active: record.isActive,
      },
    };
  }

  /** Payload da licença ativa (usado para limitar usuários, etc). */
  async getPayload(): Promise<(JwtPayload & { maxUsers?: number }) | null> {
    const hardwareId = getMachineFingerprint();
    const record = await prisma.license.findUnique({ where: { hardwareId } });
    if (!record || !record.isActive) return null;

    const verified = verifyLicenseRecord(record);
    if (!verified) return null;
    if (verified.hwid && verified.hwid !== hardwareId) return null;
    if (verified.exp && verified.exp * 1000 < Date.now()) return null;
    return verified;
  }
}

export const licenseService = new LicenseService();
