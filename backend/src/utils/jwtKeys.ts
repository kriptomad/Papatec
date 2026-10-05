import { createPrivateKey, createPublicKey, generateKeyPairSync, KeyObject } from 'crypto';

/**
 * Gera par de chaves RSA-2048 para JWT RS256.
 * Usado no build para gerar as chaves que vão para env.
 * Retorna strings PEM (não KeyObjects) porque generateKeyPairSync com encoding options retorna strings.
 */
export function generateRSAKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey };
}

/**
 * Aceita PEM base64 (formato do .env) OU PEM cru colado sem conversão.
 * Sem isto, `Buffer.from(raw,'base64')` sobre um PEM literal gerava lixo e o
 * erro vindo do crypto era incompreensível ("error:1E08010C:DER routines").
 */
function toPem(raw: string): string {
  const trimmed = raw.trim();
  if (/-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(trimmed) || /-----BEGIN PUBLIC KEY-----/.test(trimmed)) {
    return trimmed;
  }
  return Buffer.from(trimmed, 'base64').toString('utf8');
}

/**
 * Carrega chave privada a partir de string PEM (base64 ou texto).
 * Retorna KeyObject para uso com jsonwebtoken.
 */
export function loadPrivateKey(pemBase64: string): KeyObject {
  return createPrivateKey({ key: toPem(pemBase64), format: 'pem', type: 'pkcs8' });
}

/**
 * Carrega chave pública a partir de string PEM (base64 ou texto).
 * Retorna KeyObject para uso com jsonwebtoken.
 */
export function loadPublicKey(pemBase64: string): KeyObject {
  return createPublicKey({ key: toPem(pemBase64), format: 'pem', type: 'spki' });
}

/**
 * Gera as chaves e retorna em base64 para colocar no .env
 */
export function generateKeysForEnv(): { privateKeyB64: string; publicKeyB64: string } {
  const { privateKey, publicKey } = generateRSAKeyPair();
  return {
    privateKeyB64: Buffer.from(privateKey).toString('base64'),
    publicKeyB64: Buffer.from(publicKey).toString('base64'),
  };
}

// ---------------------------------------------------------------------------
// Cache: o par de chaves é imutável por processo. A versão anterior parseava o
// PEM (base64 decode + DER parse, feito em C) em CADA request — CPU puro
// desperdiçado, e no topo das chamadas.
// ---------------------------------------------------------------------------
let cachedKeys: { privateKey: KeyObject; publicKey: KeyObject } | null = null;

/**
 * Verifica/retorna as chaves RS256 configuradas.
 * Lança com mensagem clara se estiverem ausentes ou inválidas.
 */
export function assertKeys(): { privateKey: KeyObject; publicKey: KeyObject } {
  if (cachedKeys) return cachedKeys;

  const privateB64 = process.env.JWT_PRIVATE_KEY_B64 || '';
  const publicB64 = process.env.JWT_PUBLIC_KEY_B64 || '';

  if (!privateB64 || !publicB64) {
    throw new Error(
      'JWT_PRIVATE_KEY_B64 e JWT_PUBLIC_KEY_B64 devem estar configurados. ' +
        'Use `generateKeysForEnv()` para gerar e colocar no .env.'
    );
  }

  try {
    cachedKeys = { privateKey: loadPrivateKey(privateB64), publicKey: loadPublicKey(publicB64) };
  } catch (error: any) {
    throw new Error(`Chaves RS256 inválidas: ${error.message}`);
  }
  return cachedKeys;
}

/** Versão de leitura (usada só para validar no boot, sem efeitos colaterais). */
export function validateKeys(): void {
  assertKeys();
}

/** Invalida o cache (apenas em testes/rotação de chave). */
export function invalidateKeyCache(): void {
  cachedKeys = null;
}
