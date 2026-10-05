import { Router } from 'express';
import { prisma } from '../db/prisma';
import { ok, created, notFound, badRequest, conflict, AppError } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth, requireRole } from '../middleware/auth';
import { cardMachineService } from '../services/cardMachine.service';
import { resolveDriver, type DriverStatus, type PaymentKind } from '../services/cardGateway.drivers';
import { logger } from '../utils/logger';

export const cardMachineRouter = Router();

/**
 * Segredo do callback de maquininha.
 * Sem isso, qualquer um que descobrisse um `transactionId` marcava a venda
 * como paga (o callback antigo era público — mesma classe do DoS em
 * /license/deactivate).
 */
const CALLBACK_TOKEN = process.env.CARD_MACHINE_CALLBACK_TOKEN || '';

function assertCallbackAuthorized(req: any): void {
  // Sem token configurado o callback fica DESLIGADO (fail-closed): em vez de
  // aceitar qualquer um, rejeita até o gateway legítimo.
  if (!CALLBACK_TOKEN) {
    throw new AppError(
      503,
      'CALLBACK_DISABLED',
      'Callback de maquininha desativado: defina CARD_MACHINE_CALLBACK_TOKEN no servidor.',
    );
  }
  const header = String(req.headers?.authorization ?? '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim();
  if (token !== CALLBACK_TOKEN) {
    throw new AppError(401, 'UNAUTHORIZED', 'Token do callback inválido');
  }
}

function isKind(value: unknown): value is PaymentKind {
  return value === 'CREDIT' || value === 'DEBIT' || value === 'PIX';
}

/** Converte reais (Venda.total) em centavos SEM passar por float impreciso. */
function toCents(reais: number): number {
  return Math.round(Number(reais) * 100);
}

/** Mascura segredos só quando existem — não inventar a chave `merchantKey`. */
function maskMachine<T extends Record<string, any>>(machine: T): T {
  const g = (machine as any)?.gateway;
  if (!g || typeof g !== 'object') return machine;
  const gateway = { ...g };
  if (gateway.merchantKey) gateway.merchantKey = '***';
  if (gateway.authHeader?.value) gateway.authHeader = { ...gateway.authHeader, value: '***' };
  return { ...machine, gateway };
}

// ===========================================================================
// CALLBACK — declarado ANTES do `use(requireAuth)`.
//
// A maquininha/gateway NÃO tem JWT de usuário; ela se autentica com o
// CARD_MACHINE_CALLBACK_TOKEN. Com o callback depois do `use(requireAuth)`,
// o requireAuth rejeitava a requisição com "Token inválido" ANTES de o
// handler validar o token do callback — ou seja, o callback nunca funcionava.
// ===========================================================================

/**
 * POST /api/card-machines/callback
 * Conclui uma transação pendente (TEF local envia aqui).
 * Body: { transactionId, status, externalId?, authorizationCode?, nsu?, message? }
 *
 * Exige `Authorization: Bearer <CARD_MACHINE_CALLBACK_TOKEN>`.
 */
cardMachineRouter.post(
  '/callback',
  handler(async (req, res) => {
    assertCallbackAuthorized(req);

    const { transactionId, status, externalId, authorizationCode, nsu, qrCode, message } = req.body ?? {};
    if (!transactionId) throw badRequest('transactionId é obrigatório');

    const normalized = String(status ?? '').toUpperCase();
    if (!['APPROVED', 'DECLINED', 'CANCELLED', 'ERROR'].includes(normalized)) {
      throw badRequest('status deve ser APPROVED, DECLINED, CANCELLED ou ERROR');
    }

    const final = await cardMachineService.completeTransaction(String(transactionId), {
      status: normalized as DriverStatus,
      externalId: externalId ? String(externalId) : undefined,
      authorizationCode: authorizationCode ? String(authorizationCode) : undefined,
      nsu: nsu ? String(nsu) : undefined,
      qrCode: qrCode ? String(qrCode) : undefined,
      message: message ? String(message) : undefined,
      synchronous: true,
    });

    logger.info('[CardMachine] callback processado', { transactionId, status: final });
    ok(res, { transactionId, status: final });
  })
);

// ===========================================================================
// Demais rotas exigem usuário autenticado.
// ===========================================================================
cardMachineRouter.use(requireAuth);

// ===========================================================================
// Maquininhas
// ===========================================================================

/** GET /api/card-machines — lista (segredos mascarados) */
cardMachineRouter.get(
  '/',
  handler(async (_req, res) => {
    ok(res, await cardMachineService.listMachines());
  })
);

/** GET /api/card-machines/transactions/pending */
cardMachineRouter.get(
  '/transactions/pending',
  handler(async (_req, res) => {
    ok(res, await cardMachineService.getPendingTransactions());
  })
);

/** GET /api/card-machines/sales/:saleId/transactions — histórico da venda */
cardMachineRouter.get(
  '/sales/:saleId/transactions',
  handler(async (req, res) => {
    ok(res, await cardMachineService.listTransactionsForSale(req.params.saleId));
  })
);

/** GET /api/card-machines/:id */
cardMachineRouter.get(
  '/:id',
  handler(async (req, res) => {
    const machine = await cardMachineService.getMachine(req.params.id);
    if (!machine) throw notFound('Maquininha não encontrada');
    ok(res, maskMachine(machine as any));
  })
);

/** POST /api/card-machines — cadastra (ADMIN) */
cardMachineRouter.post(
  '/',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const body = req.body ?? {};
    if (!body.id) throw badRequest('Campo "id" é obrigatório');

    // Valida as credenciais do gateway ANTES de gravar: config inválida era o
    // que fazia o registro ser aceito (201) e a maquininha nunca funcionar.
    if (body.gateway?.driver) {
      const probe = resolveDriver(body);
      const health = await probe.healthCheck();
      if (!health.ok) {
        throw badRequest(`Configuração do gateway inválida: ${health.message}`, 'INVALID_GATEWAY');
      }
    }

    const machine = await cardMachineService.registerMachine(body);
    created(res, maskMachine(machine as any));
  })
);

/** PUT /api/card-machines/:id — atualiza (ADMIN) */
cardMachineRouter.put(
  '/:id',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    const machine = await cardMachineService.updateMachine(req.params.id, req.body ?? {});
    ok(res, maskMachine(machine as any));
  })
);

/** DELETE /api/card-machines/:id — remove (ADMIN) */
cardMachineRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    await cardMachineService.removeMachine(req.params.id);
    ok(res, { message: 'Maquininha removida com sucesso' });
  })
);

/** POST /api/card-machines/:id/test — checa credenciais/ligação (ADMIN) */
cardMachineRouter.post(
  '/:id/test',
  requireRole('ADMIN'),
  handler(async (req, res) => {
    ok(res, await cardMachineService.testMachine(req.params.id));
  })
);

// ===========================================================================
// Cobrança
// ===========================================================================

/**
 * POST /api/card-machines/transaction
 * Body: { saleId, amountCents, type, installments?, cardBrand?, machineId? }
 *
 * NÃO bloqueia esperando o cartão. Retorna:
 *   - `synchronous: true`  → resultado já é definitivo (drivers de API)
 *   - `synchronous: false` → PENDING; o resultado chega em /callback
 */
cardMachineRouter.post(
  '/transaction',
  handler(async (req, res) => {
    const { saleId, amountCents, type, installments, cardBrand, machineId, notes } = req.body ?? {};

    if (!saleId) throw badRequest('saleId é obrigatório');
    if (!isKind(type)) throw badRequest('type deve ser CREDIT, DEBIT ou PIX');
    if (amountCents === undefined || amountCents === null) {
      throw badRequest('amountCents é obrigatório (valor em centavos)');
    }
    if (installments && (Number(installments) < 1 || Number(installments) > 12)) {
      throw badRequest('installments deve estar entre 1 e 12');
    }

    const sale = await prisma.sale.findUnique({ where: { id: String(saleId) } });
    if (!sale) throw notFound('Venda não encontrada');

    // `paymentStatus` é o estado. `paymentMethod` é a forma escolhida e NÃO
    // significa "pago" — usar os dois como sinônimos quebrava toda venda de
    // cartão (a venda "Cartão" era rejeitada com ALREADY_PAID).
    if (sale.paymentStatus === 'PAID') throw conflict('Venda já paga', 'ALREADY_PAID');

    const result = await cardMachineService.charge({
      saleId: sale.id,
      amountCents: Number(amountCents),
      type,
      installments: installments ? Number(installments) : 1,
      cardBrand: cardBrand ? String(cardBrand) : undefined,
      machineId: machineId ? String(machineId) : undefined,
      notes: notes ? String(notes) : undefined,
    });

    created(res, result);
  })
);

/**
 * POST /api/card-machines/sales/:id/process-payment
 * Conveniência: cobra o total da venda.
 * Body: { type, installments?, cardBrand?, machineId? }
 */
cardMachineRouter.post(
  '/sales/:id/process-payment',
  handler(async (req, res) => {
    const { type, installments, cardBrand, machineId, notes } = req.body ?? {};
    if (!isKind(type)) throw badRequest('type deve ser CREDIT, DEBIT ou PIX');

    const sale = await prisma.sale.findUnique({ where: { id: req.params.id } });
    if (!sale) throw notFound('Venda não encontrada');
    if (sale.paymentStatus === 'PAID') throw conflict('Venda já paga', 'ALREADY_PAID');

    const result = await cardMachineService.charge({
      saleId: sale.id,
      amountCents: toCents(sale.total),
      type,
      installments: installments ? Number(installments) : 1,
      cardBrand: cardBrand ? String(cardBrand) : undefined,
      machineId: machineId ? String(machineId) : undefined,
      notes: notes ? String(notes) : undefined,
    });

    created(res, result);
  })
);

/** POST /api/card-machines/transaction/:id/cancel — cancela uma pendência */
cardMachineRouter.post(
  '/transaction/:id/cancel',
  handler(async (req, res) => {
    await cardMachineService.cancelTransaction(req.params.id);
    ok(res, { message: 'Transação cancelada' });
  })
);