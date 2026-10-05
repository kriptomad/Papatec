import { execSync } from 'child_process';
import { createHash } from 'crypto';

/**
 * ---------------------------------------------------------------------------
 * Hardware ID (HWID) - formato XXXX-XXXX-XXXX-XXXX (SHA-256 truncado)
 * ---------------------------------------------------------------------------
 * Ordem de resolucao (primeiro caminho que responder vence):
 *
 *  1. LICENSE_HWID      -> valor pronto, escrito no .env pelo suporte.
 *  2. MACHINE_UUID +    -> materia-prima lida NO HOST pelo instalador e
 *     MACHINE_MAC          repassada ao container via .env/compose. OBRIGATORIO
 *                          quando o backend roda em Docker/Linux: dentro do
 *                          container nao existem wmic/getmac e, sem estes
 *                          valores, o fallback geraria o MESMO HWID em todas
 *                          as maquinas (anulando a amarracao por hardware).
 *  3. wmic/getmac       -> coleta nativa Windows (backend sem container).
 *  4. COMPUTERNAME      -> ultimo recurso, apenas para destravar a instalacao.
 *
 * O hash usa SEMPRE a mesma entrada `${UUID}|${MAC}` (sem '-' e sem ':'),
 * garantindo que os caminhos 2 e 3 produzam o mesmo HWID na mesma maquina.
 */

const HWID_FORMAT = /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/;

/** SHA-256 -> 16 hex maiusculos -> XXXX-XXXX-XXXX-XXXX */
function toHwid(seed: string): string {
  const hash = createHash('sha256')
    .update(seed)
    .digest('hex')
    .toUpperCase()
    .substring(0, 16);
  return hash.match(/.{1,4}/g)!.join('-');
}

/** Normaliza UUID (sem hifen) + MAC (sem hifen/dois-pontos) e calcula o HWID. */
function fromUuidMac(uuid: string, mac: string): string | null {
  const u = uuid.trim().toUpperCase().replace(/-/g, '');
  const m = mac.trim().toUpperCase().replace(/[-:]/g, '');
  if (!/^[0-9A-F]{16,64}$/.test(u)) return null;
  if (!/^[0-9A-F]{6,48}$/.test(m)) return null;
  return toHwid(`${u}|${m}`);
}

/** Caminho 3: coleta nativa Windows (wmic + getmac), com fallback via CIM. */
function nativeWindowsIds(): { uuid: string; mac: string } {
  let uuid = '';

  try {
    const out = execSync('wmic csproduct get uuid', {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    const match = out.match(/[A-F0-9-]{36}/i);
    uuid = match ? match[0] : '';
  } catch {
    // wmic ausente (Windows 11 24H2+) -> PowerShell/CIM
    try {
      const out = execSync(
        'powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"',
        { encoding: 'utf8', timeout: 8000, windowsHide: true }
      );
      uuid = out.trim();
    } catch {
      uuid = '';
    }
  }

  let mac = '';
  try {
    const out = execSync('getmac /fo csv /nh', {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    for (const line of out.split(/\r?\n/)) {
      // A coluna do MAC pode sair em qualquer posicao (2 ou 4 colunas do csv)
      const match = line.match(/"([0-9A-F]{2}(?:[-:][0-9A-F]{2}){5})"/i);
      if (!match) continue;
      const candidate = match[1].replace(/[-:]/g, '').toUpperCase();
      if (
        candidate === '000000000000' ||
        candidate.startsWith('00155D') || // Hyper-V / WSL
        candidate.startsWith('000D3A')    // hipervisores
      ) {
        continue;
      }
      mac = match[1];
      break;
    }
  } catch {
    mac = '';
  }

  return { uuid, mac };
}

export function getMachineFingerprint(): string {
  // 1) HWID pronto injetado no ambiente (.env / suporte)
  const injected = (process.env.LICENSE_HWID || '').trim().toUpperCase();
  if (HWID_FORMAT.test(injected)) return injected;

  // 2) UUID + MAC lidos no host pelo instalador (caminho Docker obrigatorio)
  const fromHost = fromUuidMac(
    process.env.MACHINE_UUID || '',
    process.env.MACHINE_MAC || ''
  );
  if (fromHost) return fromHost;

  // 3) Coleta nativa Windows
  try {
    const { uuid, mac } = nativeWindowsIds();
    const native = fromUuidMac(uuid, mac);
    if (native) return native;
  } catch {
    /* segue para o fallback */
  }

  // 4) Ultimo recurso: nome da maquina (unico por estacao, nao por hardware)
  const computer =
    (process.env.COMPUTERNAME || process.env.HOSTNAME || 'UNKNOWN').trim();
  return toHwid(`FALLBACK-${computer}-${process.platform}`);
}
