/**
 * Drivers de gateway de pagamento.
 *
 * Cada driver encapsula UM mecanismo concreto de falar com o adquirente.
 * Trocar de produto (Cielo API, TEF local, simulado) é escolher outro driver
 * em `resolveDriver()` — nenhuma rota/serviço de venda precisa mudar.
 *
 * ── Por que o desenho antigo nunca funcionou ──────────────────────────────
 * O serviço anterior fazia `fetch(http://{ip}:{port}/api/transaction)` com um
 * corpo JSON inventado, em `sendViaBluetooth`/`sendViaUSB` só escrevia um log,
 * e a resposta vinha por webhook para `/callback` sem autenticação. Não existe
 * maquininha que fale aquele protocolo. Aqui cada driver implementa o contrato
 * real do adquirente e devolve um resultado normalizado.
 */

import { logger } from '../utils/logger';
import { AppError } from '../http/envelope';

export type PaymentKind = 'CREDIT' | 'DEBIT' | 'PIX';
export type DriverStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'ERROR';

export interface AuthorizeInput {
  transactionId: string;
  /** SEMPRE em centavos — dinheiro nunca vira ponto flutuante. */
  amountCents: number;
  kind: PaymentKind;
  installments: number;
  cardBrand?: string | null;
  /** Descrição curta que aparece no comprovante do lojista. */
  description?: string;
}

export interface AuthorizeResult {
  status: DriverStatus;
  /** id da transação NO gateway (para consultar/cancelar depois). */
  externalId?: string;
  authorizationCode?: string;
  nsu?: string;
  qrCode?: string;
  message?: string;
  /** true quando o gateway já respondeu de forma definitiva (API). */
  synchronous: boolean;
}

export interface CardGatewayDriver {
  readonly name: string;
  /** true quando este driver precisa de webhook/callback para concluir. */
  readonly requiresCallback: boolean;
  authorize(input: AuthorizeInput): Promise<AuthorizeResult>;
  cancel(externalId: string): Promise<void>;
  /** Checagem de credenciais/configuração para a tela de configuração. */
  healthCheck(): Promise<{ ok: boolean; message: string }>;
}

const TIMEOUT_MS = 20_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ===========================================================================
// CIELO — API E-commerce (pagamento presencial)
// Docs: https://docs.cielo.com.br/ecommerce-cielo
//   Request: https://api.cieloecommerce.cielo.com.br/_1/sales/
//   Sandbox: https://apisandbox.cieloecommerce.cielo.com.br/_1/sales/
//   Auth: headers MerchantId + MerchantKey
// ===========================================================================

export interface CieloConfig {
  merchantId: string;
  /** MerchantKey da Cielo. Nunca devolver em resposta de API. */
  merchantKey: string;
  /** id do terminal/loja no contrato Cielo. */
  terminal: string;
  sandbox?: boolean;
  /** Sobrescreve a URL base (proxy corporativo, testes). */
  baseUrl?: string;
}

export class CieloDriver implements CardGatewayDriver {
  readonly name = 'CIELO';
  // API responde na hora — não depende de webhook para concluir.
  readonly requiresCallback = false;

  constructor(private readonly cfg: CieloConfig) {}

  private get baseUrl(): string {
    if (this.cfg.baseUrl) return this.cfg.baseUrl.replace(/\/+$/, '');
    return this.cfg.sandbox
      ? 'https://apisandbox.cieloecommerce.cielo.com.br'
      : 'https://api.cieloecommerce.cielo.com.br';
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Autenticação da API E-commerce: chaves no header de toda requisição.
      MerchantId: this.cfg.merchantId,
      MerchantKey: this.cfg.merchantKey,
    };
  }

  async authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
    const payment: Record<string, unknown> = {
      // MerchantOrderId: o próprio id da transação — é o que permite
      // reconciliar depois e rejectsão de duplicidade.
      merchantOrderId: input.transactionId,
      // '1' = autorização apenas; a captura é operação separada (PUT).
      authorizeNow: false,
      installments: input.installments,
      installmentsInterest: 'MERCHANT',
      // '1' = crédito, '2' = débito. PIX éqr dinâmico, tratado abaixo.
      paymentTypeCode: input.kind === 'DEBIT' ? '2' : '1',
      recurring: false,
      cleanCode: 0,
      country: 'BRA',
      currency: 'BRL',
      customer: { name: 'CLIENTE PAPAtec' },
      order: {
        total: input.amountCents,
        riskOnBrowserEnable: false,
        riskOnBrowserScoreMin: 0,
        riskOnBrowserScoreMax: 0,
        items: [{ quantity: 1, amount: input.amountCents, merchantOrderId: input.transactionId }],
      },
      ...(input.cardBrand ? { cardBrand: input.cardBrand } : {}),
    };

    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/_1/sales/`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(payment),
      });
      const body: any = await res.json().catch(() => null);

      if (!res.ok) {
        // 4xx da Cielo costuma trazer status/paymentStatusCode com o motivo.
        const reason =
          body?.status || body?.paymentStatusMessage || body?.message || `HTTP ${res.status}`;
        logger.warn('[Cielo] authorize recusado', {
          transactionId: input.transactionId,
          status: res.status,
          reason,
        });
        // 4xx (exceto 429) é recusa definitiva, não erro de transporte.
        const definitive = res.status >= 400 && res.status < 500 && res.status !== 429;
        return {
          status: definitive ? 'DECLINED' : 'ERROR',
          externalId: body?.payment?.id ?? body?.id,
          message: reason,
          synchronous: true,
        };
      }

      const st = body?.status ?? 'PENDING';
      const approved = st === 'APPROVED';
      const authCode = body?.payment?.authorizationCode ?? body?.authorizationCode;

      return {
        status: approved ? 'APPROVED' : st === 'DECLINED' ? 'DECLINED' : 'PENDING',
        externalId: String(body?.payment?.id ?? body?.id ?? input.transactionId),
        authorizationCode: authCode ? String(authCode) : undefined,
        nsu: body?.payment?.nsu ? String(body.payment.nsu) : undefined,
        qrCode:
          body?.payment?.links?.find?.((l: any) => l?.rel === 'self')?.href ??
          body?.payment?.paymentUrl ??
          undefined,
        message: body?.payment?.paymentStatusMessage ?? body?.status ?? undefined,
        synchronous: true,
      };
    } catch (err: any) {
      logger.error('[Cielo] falha de rede em authorize', {
        transactionId: input.transactionId,
        error: err?.message,
      });
      return { status: 'ERROR', message: `Falha de comunicação com a Cielo: ${err?.message}`, synchronous: true };
    }
  }

  async cancel(externalId: string): Promise<void> {
    await fetchWithTimeout(`${this.baseUrl}/_1/sales/${externalId}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancel: true }),
    });
  }

  async healthCheck() {
    if (!this.cfg.merchantId || !this.cfg.merchantKey || !this.cfg.terminal) {
      return {
        ok: false,
        message: 'Credenciais incompletas: informe merchantId, merchantKey e terminal.',
      };
    }
    return {
      ok: true,
      message: `Configurado (${this.cfg.sandbox ? 'SANDBOX' : 'PRODUÇÃO'}, terminal ${this.cfg.terminal}).`,
    };
  }
}

// ===========================================================================
// TEF local — maquininha expondo API HTTP na rede da loja
// (TEF IP / terminal com API habilitada). O ERP busca a maquininha.
// ===========================================================================

export interface TefIpConfig {
  baseUrl: string;
  /** Endpoints podem variar por fabricante; ficam configuráveis. */
  authorizePath?: string;
  cancelPath?: string;
  healthPath?: string;
  authHeader?: { name: string; value: string };
}

export class TefIpDriver implements CardGatewayDriver {
  readonly name = 'TEF_IP';
  // TEF local responde com callback/webhook; a chamada HTTP só "abre" a venda.
  readonly requiresCallback = true;

  constructor(private readonly cfg: TefIpConfig) {}

  private url(path: string): string {
    const base = this.cfg.baseUrl.replace(/\/+$/, '');
    return path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  async authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.cfg.authHeader) headers[this.cfg.authHeader.name] = this.cfg.authHeader.value;

    try {
      const res = await fetchWithTimeout(this.url(this.cfg.authorizePath ?? '/api/transaction'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transactionId: input.transactionId,
          amount: input.amountCents,
          type: input.kind,
          installments: input.installments,
          cardBrand: input.cardBrand ?? undefined,
          description: input.description,
          timestamp: new Date().toISOString(),
        }),
      });

      if (res.status === 401 || res.status === 403) {
        return { status: 'ERROR', message: `TEF recusou a credencial (HTTP ${res.status}).`, synchronous: false };
      }
      if (!res.ok) {
        return { status: 'ERROR', message: `TEF respondeu HTTP ${res.status}.`, synchronous: false };
      }

      // Alguns TEFs já devolvem o resultado definitivo; outros só aceitam.
      const body: any = await res.json().catch(() => null);
      const status = (body?.status ?? '').toUpperCase();
      if (['APPROVED', 'DECLINED', 'CANCELLED', 'ERROR'].includes(status)) {
        return {
          status: status as DriverStatus,
          externalId: body?.transactionId ?? body?.externalId ?? input.transactionId,
          authorizationCode: body?.authorizationCode,
          nsu: body?.nsu,
          message: body?.message,
          synchronous: true,
        };
      }
      return { status: 'PENDING', externalId: input.transactionId, synchronous: false };
    } catch (err: any) {
      logger.error('[TEF] falha de rede em authorize', {
        transactionId: input.transactionId,
        baseUrl: this.cfg.baseUrl,
        error: err?.message,
      });
      return {
        status: 'ERROR',
        message: `Não consegui falar com o TEF em ${this.cfg.baseUrl}: ${err?.message}`,
        synchronous: false,
      };
    }
  }

  async cancel(externalId: string): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cfg.authHeader) headers[this.cfg.authHeader.name] = this.cfg.authHeader.value;
    await fetchWithTimeout(this.url(`${this.cfg.cancelPath ?? '/api/transaction'}/${externalId}/cancel`), {
      method: 'POST',
      headers,
    });
  }

  async healthCheck() {
    if (!this.cfg.baseUrl) return { ok: false, message: 'Informe a URL base do TEF.' };
    try {
      const res = await fetchWithTimeout(this.url(this.cfg.healthPath ?? '/health'), { method: 'GET' }, 6000);
      return {
        ok: res.ok,
        message: res.ok ? `TEF respondeu OK em ${this.cfg.baseUrl}` : `TEF respondeu HTTP ${res.status}`,
      };
    } catch (err: any) {
      return { ok: false, message: `TEF inacessível: ${err?.message}` };
    }
  }
}

// ===========================================================================
// SIMULADO — desenvolvimento e homologação sem maquininha.
//   - `autoApprove: false` deixa a transação PENDING, exercitando exatamente
//     o caminho do TEF local (resultado chega depois, via callback).
//   - Determinístico: valores que terminam em 3 são recusados.
// ===========================================================================

export interface SimulatedConfig {
  autoApprove?: boolean;
}

export class SimulatedDriver implements CardGatewayDriver {
  readonly name = 'SIMULATED';
  readonly requiresCallback = false;

  constructor(private readonly cfg: SimulatedConfig = {}) {}

  async authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
    const suffix = input.transactionId.slice(-6).toUpperCase();

    // Modo pendente: imita TEF local — aceita e devolve PENDING.
    if (this.cfg.autoApprove === false) {
      await new Promise((r) => setTimeout(r, 200));
      return { status: 'PENDING', externalId: `SIM-${suffix}`, synchronous: false };
    }

    const lastDigit = input.amountCents % 10;
    const approved = lastDigit !== 3; // termina em 3 => recusado (regra estável)
    await new Promise((r) => setTimeout(r, 300)); // simula latência do terminal
    return approved
      ? {
          status: 'APPROVED',
          externalId: `SIM-${suffix}`,
          authorizationCode: `AUT${suffix}`,
          nsu: String(100000 + (Number(suffix.replace(/\D/g, '') || 1) % 899999)),
          message: 'Aprovada (simulador)',
          synchronous: true,
        }
      : { status: 'DECLINED', externalId: `SIM-${suffix}`, message: 'Recusada (simulador)', synchronous: true };
  }

  async cancel(): Promise<void> {
    /* nada a fazer no simulador */
  }

  async healthCheck() {
    return {
      ok: true,
      message:
        this.cfg.autoApprove === false
          ? 'Simulador em modo pendente (resultado chega por callback).'
          : 'Simulador ativo (nenhuma maquininha é acionada).',
    };
  }
}

// ===========================================================================
// Resolução do driver a partir da maquininha configurada
// ===========================================================================

/** Campos de gateway dentro do JSON da maquininha (categoria CARD_MACHINE). */
export function gatewayConfigOf(machine: Record<string, any>): Record<string, any> {
  const g = (machine as any)?.gateway;
  return g && typeof g === 'object' && !Array.isArray(g) ? g : {};
}

/**
 * Escolhe o driver conforme `gateway.driver` (padrão: TEF_IP).
 * Lança AppError 400 para driver desconhecido — nunca silenciosamente.
 */
export function resolveDriver(machine: Record<string, any>): CardGatewayDriver {
  const g = gatewayConfigOf(machine);
  const wanted = String(g.driver ?? 'TEF_IP').toUpperCase();

  switch (wanted) {
    case 'CIELO':
      return new CieloDriver({
        merchantId: String(g.merchantId ?? ''),
        merchantKey: String(g.merchantKey ?? ''),
        terminal: String(g.terminal ?? ''),
        sandbox: g.sandbox !== false,
        baseUrl: g.baseUrl ? String(g.baseUrl) : undefined,
      });

    case 'SIMULATED':
      return new SimulatedDriver({ autoApprove: g.autoApprove });

    case 'TEF_IP': {
      // Sem `gateway.baseUrl` explícito, cai no IP/porta da maquininha.
      const fallback = machine?.ipAddress
        ? `http://${machine.ipAddress}${machine.port ? `:${machine.port}` : ''}`
        : '';
      return new TefIpDriver({
        baseUrl: String(g.baseUrl ?? fallback),
        authorizePath: g.authorizePath ? String(g.authorizePath) : undefined,
        cancelPath: g.cancelPath ? String(g.cancelPath) : undefined,
        healthPath: g.healthPath ? String(g.healthPath) : undefined,
        authHeader: g.authHeader?.name
          ? { name: String(g.authHeader.name), value: String(g.authHeader.value ?? '') }
          : undefined,
      });
    }

    default:
      throw new AppError(
        400,
        'UNSUPPORTED_DRIVER',
        `Driver de gateway desconhecido: "${wanted}". Use CIELO, TEF_IP ou SIMULATED.`,
      );
  }
}