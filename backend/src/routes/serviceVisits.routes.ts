import { Router } from 'express';
import { prisma } from '../db/prisma';
import { ok, created, badRequest, notFound } from '../http/envelope';
import { handler } from '../http/errors';
import { requireAuth } from '../middleware/auth';
import { schedulingService } from '../services/scheduling.service';
import { Prisma } from '@prisma/client';

export const serviceVisitsRouter = Router();

serviceVisitsRouter.use(requireAuth);

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Briefing B2.3/C1: visitas de serviço externo.
 * - date/scheduledAt = agendamento (13:30 residência, 14:30 escritório...)
 * - arrival/departure = registro real de horas na casa do cliente
 * - needsSecondVisit = checkbox "necessidade de segunda ida"
 */
function parseDate(value: any, field: string): Date {
  const raw = String(value || '').trim();
  if (!raw) throw badRequest(`Data é obrigatória (${field}).`, 'VISIT_DATE_REQUIRED');
  // Noon UTC mantém o calendário correto em qualquer fuso
  const d = new Date(raw.length === 10 ? `${raw}T12:00:00.000Z` : raw);
  if (Number.isNaN(d.getTime())) throw badRequest('Data inválida.');
  return d;
}

function parseDateTime(value: any): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw badRequest('Horário inválido.', 'INVALID_VISIT_TIME');
  return d;
}

/**
 * "Tempo Serviço" — duração prevista da visita em minutos.
 * Aceita número ou string ("2h" também é comum de digitar); valor inválido não
 * deve derrubar o agendamento, apenas cair no padrão de Configurações.
 */
function parseDurationMinutes(value: any): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(5, Math.min(24 * 60, Math.round(n)));
}

/** Offset de fuso do cliente (convenção JS: UTC-3 => -180). Ausente => undefined. */
function tzFrom(source: any): number | undefined {
  const n = Number(source?.tzOffsetMinutes);
  return Number.isFinite(n) ? n : undefined;
}

function visitData(body: any) {
  const date = parseDate(body?.date, 'date');
  const arrival = parseDateTime(body?.arrival);
  const departure = parseDateTime(body?.departure);
  if (arrival && departure && departure.getTime() <= arrival.getTime()) {
    throw badRequest('Hora de saída deve ser depois da hora de entrada.', 'INVALID_VISIT_HOURS');
  }
  const rawAddr = body?.address;
  return {
    date,
    scheduledAt: parseDateTime(body?.scheduledAt),
    durationMinutes: parseDurationMinutes(body?.durationMinutes),
    arrival,
    departure,
    needsSecondVisit: body?.needsSecondVisit === true || body?.needsSecondVisit === 'true',
    notes: body?.notes ? String(body.notes).trim() : null,
    address:
      rawAddr && typeof rawAddr === 'object' && String(rawAddr.street || '').trim()
        ? {
            label: rawAddr.label ? String(rawAddr.label) : '',
            street: String(rawAddr.street).trim(),
            number: rawAddr.number ? String(rawAddr.number) : '',
            city: rawAddr.city ? String(rawAddr.city) : '',
            state: rawAddr.state ? String(rawAddr.state) : '',
          }
        : null,
  };
}

async function assertOs(osId: string) {
  const os = await prisma.serviceOrder.findUnique({ where: { id: osId } });
  if (!os) throw notFound('Ordem de Serviço não encontrada');
  return os;
}

async function visitHours(visit: { arrival: Date | null; departure: Date | null }): Promise<number> {
  if (!visit.arrival || !visit.departure) return 0;
  return (visit.departure.getTime() - visit.arrival.getTime()) / 3_600_000;
}

/**
 * Briefing C2: quando a O.S. usa "horas do registro" (laborSource=VISITS),
 * a soma da mão de obra é recalculada a cada visita.
 */
async function syncOsLabor(osId: string) {
  const os = await prisma.serviceOrder.findUnique({
    where: { id: osId },
    select: { laborSource: true, laborRate: true, totalParts: true, totalServices: true },
  });
  if (!os || os.laborSource !== 'VISITS') return;
  const visits = await prisma.serviceVisit.findMany({ where: { osId } });
  let hours = 0;
  for (const v of visits) hours += await visitHours(v);
  const laborHours = round2(hours);
  const totalLabor = round2(laborHours * round2(os.laborRate));
  const total = round2(os.totalParts + os.totalServices + totalLabor);
  await prisma.serviceOrder.update({ where: { id: osId }, data: { laborHours, totalLabor, total } });
}

// GET /api/service-visits?osId=&techId=&date=
serviceVisitsRouter.get(
  '/',
  handler(async (req, res) => {
    const where: any = {};
    if (req.query.osId) where.osId = String(req.query.osId);
    if (req.query.techId) where.techId = String(req.query.techId);
    if (req.query.date) where.date = parseDate(req.query.date, 'filter');

    const list = await prisma.serviceVisit.findMany({
      where,
      orderBy: [{ date: 'desc' }, { scheduledAt: 'asc' }, { createdAt: 'asc' }],
      include: {
        tech: { select: { id: true, name: true } },
        os: { select: { id: true, osNumber: true, status: true, client: { select: { name: true } } } },
      },
    });
    ok(res, list);
  })
);

/**
 * GET /api/service-visits/slots?date=&techId=&durationMinutes=&tzOffsetMinutes=&excludeVisitId=
 *
 * Lista os horários do dia conforme o horário comercial configurável, marcando
 * os que o MESMO técnico já tem ocupado.
 *
 * IMPORTANTE: precisa vir ANTES de `GET /:id` — caso contrário o Express casa
 * "/slots" com o parâmetro `:id` e devolve "Visita não encontrada".
 */
serviceVisitsRouter.get(
  '/slots',
  handler(async (req, res) => {
    const date = String(req.query.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw badRequest('Parâmetro `date` obrigatório no formato YYYY-MM-DD.', 'INVALID_DATE');
    }
    ok(
      res,
      await schedulingService.getAvailableSlots({
        date,
        techId: req.query.techId ? String(req.query.techId) : null,
        durationMinutes: req.query.durationMinutes ? Number(req.query.durationMinutes) : undefined,
        tzOffsetMinutes: tzFrom(req.query),
        excludeVisitId: req.query.excludeVisitId ? String(req.query.excludeVisitId) : undefined,
      }),
    );
  })
);

// GET /api/service-visits/:id
serviceVisitsRouter.get(
  '/:id',
  handler(async (req, res) => {
    const visit = await prisma.serviceVisit.findUnique({
      where: { id: req.params.id },
      include: {
        tech: { select: { id: true, name: true } },
        os: { select: { id: true, osNumber: true, status: true, client: { select: { name: true } } } },
      },
    });
    if (!visit) throw notFound('Visita não encontrada');
    ok(res, visit);
  })
);

// POST /api/service-visits
serviceVisitsRouter.post(
  '/',
  handler(async (req, res) => {
    const osId = String(req.body?.osId || '').trim();
    if (!osId) throw badRequest('O.S. é obrigatória.', 'OS_REQUIRED');
    await assertOs(osId);
    const data = visitData(req.body);

    // Mesma semântica do PUT: `techId` explícito e vazio/null significa
    // "SEM técnico" e é respeitado. Antes o POST fazia
    // `req.body?.techId ? ... : req.user!.id`, ou seja, um `null` explícito
    // virava o usuário logado — normalmente um VENDEDOR/admin, não um técnico.
    // Resultado: a visita era atribuída à pessoa errada E essa pessoa ficava
    // bloqueada pelo conflito de agenda nas visitas seguintes.
    // Só quando a chave vem AUSENTE assumimos o usuário logado.
    const techId =
      req.body?.techId === undefined ? req.user!.id : req.body?.techId ? String(req.body.techId) : null;

    // Trava por técnico: mesmo técnico não pode ter duas janelas sobrepostas.
    if (data.scheduledAt) {
      await schedulingService.assertNoConflict({
        techId,
        start: data.scheduledAt,
        durationMinutes: data.durationMinutes,
        date: data.date.toISOString().slice(0, 10),
        tzOffsetMinutes: tzFrom(req.body),
      });
    }

    const visit = await prisma.serviceVisit.create({
      data: {
        osId,
        ...data,
        address: data.address ? (data.address as Prisma.InputJsonValue) : Prisma.DbNull,
        techId,
      },
      include: { tech: { select: { id: true, name: true } } },
    });
    // Sobe pro calendário central assim que existe horário marcado.
    await schedulingService.syncCalendarEvent(visit, req.user!.id);
    await syncOsLabor(osId);
    created(res, visit);
  })
);

// PUT /api/service-visits/:id
serviceVisitsRouter.put(
  '/:id',
  handler(async (req, res) => {
    const existing = await prisma.serviceVisit.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Visita não encontrada');
    const data = visitData(req.body);

    const nextTechId =
      req.body?.techId !== undefined
        ? req.body.techId
          ? String(req.body.techId)
          : null
        : existing.techId;

    // Revalida o encaixe ignorando a própria visita (senão toda edição
    // reencontraria o conflito com ela mesma).
    if (data.scheduledAt) {
      await schedulingService.assertNoConflict({
        techId: nextTechId,
        start: data.scheduledAt,
        durationMinutes: data.durationMinutes,
        excludeVisitId: existing.id,
        date: data.date.toISOString().slice(0, 10),
        tzOffsetMinutes: tzFrom(req.body),
      });
    }

    const visit = await prisma.serviceVisit.update({
      where: { id: existing.id },
      data: {
        ...data,
        address: data.address ? (data.address as Prisma.InputJsonValue) : Prisma.DbNull,
        techId: nextTechId,
      },
      include: { tech: { select: { id: true, name: true } } },
    });
    await schedulingService.syncCalendarEvent(visit, req.user!.id);
    await syncOsLabor(existing.osId);
    ok(res, visit);
  })
);

// POST /api/service-visits/:id/arrive - bate o ponto de CHEGADA (agora)
serviceVisitsRouter.post(
  '/:id/arrive',
  handler(async (req, res) => {
    const existing = await prisma.serviceVisit.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Visita não encontrada');
    if (existing.arrival && !existing.departure) {
      throw badRequest('Visita já em andamento (chegada registrada).', 'ALREADY_ARRIVED');
    }
    const visit = await prisma.serviceVisit.update({
      where: { id: existing.id },
      data: { arrival: new Date() },
      include: { tech: { select: { id: true, name: true } } },
    });
    await syncOsLabor(existing.osId);
    ok(res, visit);
  })
);

// POST /api/service-visits/:id/depart - bate o ponto de SAÍDA (agora)
serviceVisitsRouter.post(
  '/:id/depart',
  handler(async (req, res) => {
    const existing = await prisma.serviceVisit.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Visita não encontrada');
    if (!existing.arrival) throw badRequest('Registre a chegada antes da saída.', 'ARRIVAL_REQUIRED');
    if (existing.departure) throw badRequest('Visita já finalizada.', 'ALREADY_DEPARTED');
    const visit = await prisma.serviceVisit.update({
      where: { id: existing.id },
      data: { departure: new Date() },
      include: { tech: { select: { id: true, name: true } } },
    });
    await syncOsLabor(existing.osId);
    ok(res, visit);
  })
);

// GET /api/service-visits/calendar?start=&end= - visitas do período p/ calendário
// GET /api/service-visits/calendar?start=&end= - visitas do período p/ calendário
const CAL_RANGE_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `end` inclusivo: data pura cobre o dia inteiro (ver calendarEvents.routes). */
function calRangeBoundary(value: unknown, isEnd: boolean): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const dateOnly = CAL_RANGE_DATE_ONLY.test(raw);
  const parsed = new Date(dateOnly ? `${raw}T00:00:00.000Z` : raw);
  if (Number.isNaN(parsed.getTime())) return null;
  if (isEnd && dateOnly) return new Date(parsed.getTime() + 86_400_000);
  if (isEnd) return new Date(parsed.getTime() + 1);
  return parsed;
}

serviceVisitsRouter.get(
  '/calendar/range',
  handler(async (req, res) => {
    const from = calRangeBoundary(req.query.start, false) ?? new Date(Date.now() - 30 * 86_400_000);
    const to = calRangeBoundary(req.query.end, true) ?? new Date(Date.now() + 60 * 86_400_000);
    const list = await prisma.serviceVisit.findMany({
      where: { date: { gte: from, lt: to } },
      orderBy: [{ date: 'asc' }, { scheduledAt: 'asc' }],
      include: {
        tech: { select: { id: true, name: true } },
        os: { select: { id: true, osNumber: true, status: true, client: { select: { name: true } } } },
      },
    });
    ok(res, list);
  })
);

// DELETE /api/service-visits/:id
serviceVisitsRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const existing = await prisma.serviceVisit.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Visita não encontrada');
    await prisma.serviceVisit.delete({ where: { id: existing.id } });
    await syncOsLabor(existing.osId);
    ok(res, { message: 'Visita excluída' });
  })
);
