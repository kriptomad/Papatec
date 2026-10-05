import { verify, JwtPayload } from 'jsonwebtoken';
import { createPublicKey, KeyObject } from 'crypto';

/**
 * Verificação central da licença DRM a partir do registro persistido.
 *
 * Fonte da verdade: o JWT original emitido pela Filitech, gravado na
 * coluna `licenses.token`. A reconstrução a partir de payload+signature é
 * apenas fallback para registros antigos (o JSONB do PostgreSQL reordena as
 * chaves, o que invalida a reconstrução — por isso não pode ser o caminho
 * principal).
 */

const PUBLIC_KEY_B64 = process.env.LICENSE_PUBLIC_KEY_B64 || '';

export const LICENSE_PUBLIC_KEY: KeyObject | null = PUBLIC_KEY_B64
  ? createPublicKey({ key: Buffer.from(PUBLIC_KEY_B64, 'base64'), format: 'pem' })
  : null;

export interface StoredLicenseRecord {
  token?: string | null;
  payload?: unknown;
  signature?: string | null;
}

/** Recupera o JWT do registro (token original, ou fallback reconstruído). */
export function resolveLicenseToken(record: StoredLicenseRecord): string | null {
  if (record.token && record.token.includes('.')) {
    return record.token;
  }

  if (record.payload && record.signature) {
    try {
      const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify(record.payload)).toString('base64url');
      return `${headerB64}.${payloadB64}.${record.signature}`;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Verifica a assinatura RS256 da licença persistida.
 * Retorna o payload decodificado ou null quando a licença não é válida
 * (registro sem token, assinatura corrompida ou chave pública ausente).
 */
export function verifyLicenseRecord(
  record: StoredLicenseRecord
): (JwtPayload & { hwid?: string; client?: string }) | null {
  if (!LICENSE_PUBLIC_KEY) return null;

  const token = resolveLicenseToken(record);
  if (!token) return null;

  try {
    return verify(token, LICENSE_PUBLIC_KEY, { algorithms: ['RS256'] }) as JwtPayload & {
      hwid?: string;
      client?: string;
    };
  } catch {
    return null;
  }
}
