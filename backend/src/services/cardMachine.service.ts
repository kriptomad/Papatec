/**
 * Serviço de cobrança com maquininha / gateway de cartão.
 *
 * Princípio: o ERP NÃO processa dinheiro. Ele registra a intenção de venda,
 * chama o driver do gateway e guarda o resultado. O cartão nunca passa por
 * aqui (a maquininha ou o SDK do adquirente cuida disso).
 *
 * Correções aplicadas sobre a implementação anterior:
 *
 * 1. TransaçõesPersistidas em `card_transactions`. Antes eram um `Map` em
 *    memória: reiniciar a API perdia tudo e o callback virava no-op silencioso.
 * 2. `startTransaction` NÃO bloqueia mais o request por até 2 minutos. Drivers
 *    de API respondem na hora (síncrono); drivers de TEF local devolvem
 *    PENDING e o resultado chega por callback. Uma requisição HTTP de 2 min
 *    morre atrás de qualquer proxy — o `papatec-proxy` cortaria antes.
 * 3. "Já pago" passou a ser `sales.payment_status`, não `payment_method`.
 *    `paymentMethod` é a FORMA escolhida no cadastro; usá-lo como estado
 *    rejeitava com ALREADY_PAID toda venda normal marcada como "Cartão".
 * 4. O comprovante é SOMADO às notas da venda; antes sobrescrevia e apagava o
 *    que o vendedor tinha escrito.
 * 5. `isActive`/`supportedTypes`/`maxInstallments` ganham default no cadastro.
 *    Sem eles a maquininha ficava invisível para `selectBestMachine` — o
 *    registro era aceito (201) e nuncacouldbe usada.
 */

import { prisma } from '../db/prisma';
import { AppError } from '../http/envelope';
import { logger } from '../utils/logger';
import {
  resolveDriver,
  type AuthorizeResult,
  type CardGatewayDriver,
  type DriverStatus,
  type PaymentKind,
} from './cardGateway.drivers';

export type CardTransactionStatus = 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'ERROR';

export interface ChargeInput {
  saleId: string;
  /** Valor em CENTAVOS. Conversão para reais acontece na rota. */
  amountCents: number;
  type: PaymentKind;
  installments?: number;
  cardBrand?: string;
  /** Força uma maquininha específica (padrão: melhor disponível). */
  machineId?: string;
  notes?: string;
}

export interface ChargeResult {
  transactionId: string;
  machineId: string;
  gateway: string;
  status: CardTransactionStatus;
  externalId?: string;
  authorizationCode?: string;
  nsu?: string;
  qrCode?: string;
  message?: string;
  /** true = resultado definitivo; false = aguardando callback. */
  synchronous: boolean;
  createdAt: Date;
}

export interface MachineConfig {
  id: string;
  name: string;
  type: 'POS' | 'TEF' | 'SMARTPOS';
  connectionType: 'BLUETOOTH' | 'USB' | 'NETWORK' | 'WIFI';
  deviceIdentifier?: string;
  ipAddress?: string;
  port?: number;
  isActive: boolean;
  supportedTypes: PaymentKind[];
  maxInstallments: number;
  /** Credenciais do driver. `merchantKey` nunca volta em resposta de API. */
  gateway?: {
    driver?: 'CIELO' | 'TEF_IP' | 'SIMULATED';
    baseUrl?: string;
    merchantId?: string;
    merchantKey?: string;
    terminal?: string;
    sandbox?: boolean;
    /** SIMULATED: false deixa a transação PENDING (testa o caminho do callback). */
    autoApprove?: boolean;
    authorizePath?: string;
    cancelPath?: string;
    healthPath?: string;
    authHeader?: { name?: string; value?: string };
  };
}

const ALL_KINDS: PaymentKind[] = ['CREDIT', 'DEBIT', 'PIX'];
const MAX_INSTALLMENTS = 12;

function newTransactionId(): string {
  return `txn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Remove segredos antes de devolver a maquininha ao cliente. */
function publicMachine(m: Record<string, any>): Record<string, any> {
  const g = m.gateway ? { ...m.gateway } : undefined;
  if (g) {
    if (g.merchantKey) g.merchantKey = '***';
    if (g.authHeader?.value) g.authHeader = { ...g.authHeader, value: '***' };
  }
  return { ...m, ...(g ? { gateway: g } : {}) };
}

/**
 * Normaliza a configuração no cadastro.
 * Sem isso o registro era aceito mas a maquininha nunca era selecionável.
 */
export function normalizeMachineConfig(input: Record<string, any>): MachineConfig {
  const supported = Array.isArray(input.supportedTypes)
    ? (input.supportedTypes as string[]).filter((t): t is PaymentKind => ALL_KINDS.includes(t as PaymentKind))
    : [...ALL_KINDS];

  return {
    id: String(input.id).trim(),
    name: String(input.name ?? '').trim() || String(input.id).trim(),
    type: (['POS', 'TEF', 'SMARTPOS'].includes(input.type) ? input.type : 'SMARTPOS') as MachineConfig['type'],
    connectionType: (['BLUETOOTH', 'USB', 'NETWORK', 'WIFI'].includes(input.connectionType)
      ? input.connectionType
      : 'NETWORK') as MachineConfig['connectionType'],
    deviceIdentifier: input.deviceIdentifier ? String(input.deviceIdentifier) : undefined,
    ipAddress: input.ipAddress ? String(input.ipAddress) : undefined,
    port: input.port ? Number(input.port) : undefined,
    // `isActive` é o nome real; `active` era aceito antes e ficava undefined.
    isActive: input.isActive === undefined ? true : Boolean(input.isActive ?? input.active ?? true),
    supportedTypes: supported.length ? supported : [...ALL_KINDS],
    maxInstallments: Math.min(
      MAX_INSTALLMENTS,
      Math.max(1, Number(input.maxInstallments) || MAX_INSTALLMENTS),
    ),
    gateway: input.gateway && typeof input.gateway === 'object' ? input.gateway : undefined,
  };
}

class CardMachineService {
  private machines = new Map<string, MachineConfig>();
  private loaded = false;

  /** Carrega do banco uma vez e mantém em memória para seleção rápida. */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.reload();
  }

  async reload(): Promise<void> {
    try {
      const rows = await prisma.setting.findMany({ where: { category: 'CARD_MACHINE' } });
      this.machines.clear();
      for (const row of rows) {
        if (!row.value) continue;
        try {
          const raw = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
          if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.id) {
            this.machines.set(String(raw.id), normalizeMachineConfig(raw));
          }
        } catch {
          logger.warn('[CardMachine] configuração inválida ignorada', { key: row.key });
        }
      }
      this.loaded = true;
      logger.info(`[CardMachine] ${this.machines.size} maquininha(s) carregada(s)`);
    } catch (error: any) {
      logger.warn('[CardMachine] falha ao carregar maquininhas', { error: error?.message });
    }
  }

  async registerMachine(input: Record<string, any>): Promise<MachineConfig> {
    await this.ensureLoaded();
    const cfg = normalizeMachineConfig(input);
    if (this.machines.has(cfg.id)) {
      throw new AppError(409, 'MACHINE_EXISTS', 'Maquininha já cadastrada com este ID');
    }
    await this.persist(cfg);
    this.machines.set(cfg.id, cfg);
    logger.info('[CardMachine] maquininha registrada', { id: cfg.id, driver: cfg.gateway?.driver ?? 'TEF_IP' });
    return cfg;
  }

  async updateMachine(id: string, updates: Record<string, any>): Promise<MachineConfig> {
    await this.ensureLoaded();
    const existing = this.machines.get(id);
    if (!existing) throw new AppError(404, 'MACHINE_NOT_FOUND', 'Maquininha não encontrada');
    // Mescla e renormaliza: um PUT parcial não pode apagar gateway/isActive.
    const merged = normalizeMachineConfig({ ...existing, ...updates, id });
    await this.persist(merged);
    this.machines.set(id, merged);
    return merged;
  }

  private async persist(cfg: MachineConfig): Promise<void> {
    const key = `card_machine_${cfg.id}`;
    await prisma.setting.upsert({
      where: { key },
      update: { value: JSON.stringify(cfg), category: 'CARD_MACHINE', updatedAt: new Date() },
      create: { key, value: JSON.stringify(cfg), category: 'CARD_MACHINE' },
    });
  }

  async removeMachine(id: string): Promise<void> {
    await this.ensureLoaded();
    if (!this.machines.has(id)) throw new AppError(404, 'MACHINE_NOT_FOUND', 'Maquininha não encontrada');
    await prisma.setting.delete({ where: { key: `card_machine_${id}` } });
    this.machines.delete(id);
  }

  async listMachines(): Promise<Record<string, any>[]> {
    await this.ensureLoaded();
    return Array.from(this.machines.values()).map(publicMachine);
  }

  async getMachine(id: string): Promise<MachineConfig | undefined> {
    await this.ensureLoaded();
    return this.machines.get(id);
  }

  /** TEF > SmartPOS > POS, como antes. */
  private selectBestMachine(type: PaymentKind): MachineConfig | undefined {
    const available = Array.from(this.machines.values()).filter(
      (m) => m.isActive && m.supportedTypes.includes(type),
    );
    if (!available.length) return undefined;
    const priority: Record<string, number> = { TEF: 3, SMARTPOS: 2, POS: 1 };
    return available.sort((a, b) => (priority[b.type] ?? 0) - (priority[a.type] ?? 0))[0];
  }

  /**
   * Inicia a cobrança. NÃO bloqueia esperando o resultado.
   * Retorna PENDING quando o gateway é assíncrono (TEF local).
   */
  async charge(input: ChargeInput): Promise<ChargeResult> {
    await this.ensureLoaded();

    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new AppError(400, 'INVALID_AMOUNT', 'Valor deve ser um inteiro positivo em centavos');
    }
    if (!ALL_KINDS.includes(input.type)) {
      throw new AppError(400, 'INVALID_TYPE', 'Tipo deve ser CREDIT, DEBIT ou PIX');
    }

    const machine = input.machineId
      ? this.machines.get(input.machineId)
      : this.selectBestMachine(input.type);

    if (!machine) {
      throw new AppError(
        503,
        'NO_MACHINE_AVAILABLE',
        input.machineId
          ? `Maquininha "${input.machineId}" não encontrada ou inativa`
          : 'Nenhuma maquininha ativa para este tipo de pagamento',
      );
    }

    const driver = resolveDriver(machine as any);
    const installments = Math.max(1, Math.min(machine.maxInstallments || MAX_INSTALLMENTS, input.installments ?? 1));
    const transactionId = newTransactionId();
    const now = new Date();

    // 1) Registra a intenção ANTES de chamar o gateway. Se a API morrer no
    //    meio, o registro sobra e dá para reconciliar depois.
    await prisma.cardTransaction.create({
      data: {
        id: transactionId,
        saleId: input.saleId,
        machineId: machine.id,
        gateway: driver.name,
        status: 'PENDING',
        amount: input.amountCents,
        type: input.type,
        installments,
        cardBrand: input.cardBrand ?? null,
        payload: JSON.parse(JSON.stringify({ notes: input.notes ?? null })),
      },
    });

    // 2) Chama o gateway.
    let result: AuthorizeResult;
    try {
      result = await driver.authorize({
        transactionId,
        amountCents: input.amountCents,
        kind: input.type,
        installments,
        cardBrand: input.cardBrand ?? null,
        description: input.notes ?? undefined,
      });
    } catch (err: any) {
      result = { status: 'ERROR', message: err?.message ?? 'Erro desconhecido no gateway', synchronous: true };
    }

    // 3) Persiste o resultado e reflete na venda.
    await this.applyResult(transactionId, result);

    const saved = await prisma.cardTransaction.findUnique({ where: { id: transactionId } });
    return {
      transactionId,
      machineId: machine.id,
      gateway: driver.name,
      status: (result.status as CardTransactionStatus) ?? 'PENDING',
      externalId: result.externalId,
      authorizationCode: result.authorizationCode,
      nsu: result.nsu,
      qrCode: result.qrCode,
      message: result.message,
      synchronous: result.synchronous !== false,
      createdAt: saved?.createdAt ?? now,
    };
  }

  /** Grava o resultado do gateway na transação e na venda. */
  private async applyResult(
    transactionId: string,
    result: AuthorizeResult,
  ): Promise<CardTransactionStatus> {
    const status = (result.status ?? 'PENDING') as CardTransactionStatus;

    const txn = await prisma.cardTransaction.update({
      where: { id: transactionId },
      data: {
        status,
        externalId: result.externalId ?? null,
        authorizationCode: result.authorizationCode ?? null,
        nsu: result.nsu ?? null,
        qrCode: result.qrCode ?? null,
        errorMessage: status === 'ERROR' || status === 'DECLINED' ? (result.message ?? null) : null,
        updatedAt: new Date(),
      },
    });

    if (status === 'APPROVED') await this.markSalePaid(txn);
    else if (status === 'DECLINED' || status === 'ERROR') {
      await prisma.sale.updateMany({
        where: { id: txn.saleId, paymentStatus: { not: 'PAID' } },
        data: { paymentStatus: status === 'DECLINED' ? 'FAILED' : 'PENDING' },
      });
    }
    // PENDING: nada muda na venda; o callback completa.
    return status;
  }

  private async markSalePaid(txn: {
    saleId: string;
    externalId: string | null;
    authorizationCode: string | null;
    nsu: string | null;
    cardBrand: string | null;
    installments: number;
  }): Promise<void> {
    const sale = await prisma.sale.findUnique({ where: { id: txn.saleId } });
    if (!sale) return;

    const receipt = [
      `Pagamento aprovado na maquininha (${txn.nsu ? `NSU ${txn.nsu}` : 'NSU N/A'})`,
      txn.authorizationCode ? `Autorização: ${txn.authorizationCode}` : null,
      txn.cardBrand ? `Bandeira: ${txn.cardBrand}` : null,
      `${txn.installments}x`,
    ]
      .filter(Boolean)
      .join(' · ');

    // SOMA ao que já existia. A versão anterior sobrescrevia `notes` e apagava
    // as observações do vendedor.
    const merged = sale.notes ? `${sale.notes}\n${receipt}` : receipt;

    await prisma.sale.update({
      where: { id: txn.saleId },
      data: {
        paymentStatus: 'PAID',
        paidAt: new Date(),
        cardTransactionId: txn.externalId,
        cardAuthorizationCode: txn.authorizationCode,
        cardNsu: txn.nsu,
        cardBrand: txn.cardBrand,
        cardInstallments: txn.installments,
        notes: merged,
      },
    });
  }

  /**
   * Conclui uma transação pendente (callback de TEF local ou conciliação).
   * Idempotente: chamar duas vezes não duplica o comprovante.
   */
  async completeTransaction(transactionId: string, result: AuthorizeResult): Promise<CardTransactionStatus> {
    const existing = await prisma.cardTransaction.findUnique({ where: { id: transactionId } });
    if (!existing) {
      // Não é erro: o gateway pode enviar callback de uma transação que o ERP
      // jáconsidered resolvida (ou nunca viu, se foi criada em outra réplica).
      logger.warn('[CardMachine] callback para transação desconhecida', { transactionId });
      return 'PENDING';
    }
    if (existing.status === 'APPROVED') return 'APPROVED';

    return this.applyResult(transactionId, result);
  }

  async cancelTransaction(transactionId: string): Promise<void> {
    const txn = await prisma.cardTransaction.findUnique({ where: { id: transactionId } });
    if (!txn) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Transação não encontrada');
    if (txn.status !== 'PENDING') {
      throw new AppError(400, 'TRANSACTION_NOT_PENDING', `Transação já está em ${txn.status}`);
    }

    const machine = this.machines.get(txn.machineId);
    if (machine && txn.externalId) {
      try {
        await resolveDriver(machine as any).cancel(txn.externalId);
      } catch (err: any) {
        // Cancelamento local ainda deve acontecer; o gateway pode estar fora.
        logger.warn('[CardMachine] cancelamento no gateway falhou', {
          transactionId,
          error: err?.message,
        });
      }
    }

    await prisma.cardTransaction.update({
      where: { id: transactionId },
      data: { status: 'CANCELLED', updatedAt: new Date() },
    });
    await prisma.sale.updateMany({
      where: { id: txn.saleId, paymentStatus: { not: 'PAID' } },
      data: { paymentStatus: 'CANCELLED' },
    });
  }

  /** Transações em aberto — do BANCO, com idade real (o Map antigo dava sempre 0). */
  async getPendingTransactions(): Promise<{ transactionId: string; saleId: string; age: number; machineId: string }[]> {
    const rows = await prisma.cardTransaction.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, saleId: true, machineId: true, createdAt: true },
    });
    const now = Date.now();
    return rows.map((r) => ({
      transactionId: r.id,
      saleId: r.saleId,
      machineId: r.machineId,
      age: Math.max(0, Math.round((now - r.createdAt.getTime()) / 1000)),
    }));
  }

  async listTransactionsForSale(saleId: string) {
    return prisma.cardTransaction.findMany({
      where: { saleId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Verifica credenciais/config do gateway de uma maquininha. */
  async testMachine(id: string): Promise<{ ok: boolean; success: boolean; message: string }> {
    await this.ensureLoaded();
    const machine = this.machines.get(id);
    if (!machine) throw new AppError(404, 'MACHINE_NOT_FOUND', 'Maquininha não encontrada');
    try {
      const health = await resolveDriver(machine as any).healthCheck();
      return { ...health, success: health.ok };
    } catch (err: any) {
      return { ok: false, success: false, message: err?.message ?? 'Falha ao verificar o gateway' };
    }
  }
}

export const cardMachineService = new CardMachineService();
export type { CardGatewayDriver, DriverStatus, PaymentKind };