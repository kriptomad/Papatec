import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { handler } from '../http/errors';
import { ok, created, notFound, badRequest } from '../http/envelope';
import { CalendarEventType, AppointmentStatus } from '@prisma/client';

export const calendarEventsRouter = Router();

const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Converte o parâmetro de intervalo em um instante-limite.
 *
 * `end` é INCLUSIVO do dia inteiro: quando vem só "YYYY-MM-DD" (que é como o
 * CalendarPage envia o último dia da grade), o limite passa a ser o início do
 * dia SEGUINTE e a comparação é `lt` (exclusivo). Sem isso, `new Date('2026-12-01')`
 * virava meia-noite e TODO evento durante o dia 01 sumia da consulta.
 */
function rangeBoundary(value: string | undefined, isEnd: boolean): Date | undefined {
  if (!value) return undefined;
  const dateOnly = DATE_ONLY.test(value);
  // Data pura é interpretada em UTC para não depender do fuso do container.
  const parsed = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (isEnd && dateOnly) return new Date(parsed.getTime() + DAY_MS);
  if (isEnd) return new Date(parsed.getTime() + 1); // datetime: inclusivo no segundo
  return parsed;
}

// GET /api/calendar?start=...&end=...&techId=...&type=...&all=true
calendarEventsRouter.get(
  '/',
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const { start, end, techId, type, all } = req.query as Record<string, string>;
    const where: any = {};

    const from = rangeBoundary(start, false);
    const to = rangeBoundary(end, true);

    // Semântica de SOBREPOSIÇÃO (igual a um calendário de verdade): o evento
    // aparece se encosta na janela, mesmo que comece antes dela ou termine
    // depois. Isso também faz eventos que cruzam a meia-noite aparecerem no dia
    // certo, em vez de sumirem.
    if (from) where.endAt = { gt: from };
    if (to) where.startAt = { lt: to };

    if (techId) where.techId = techId;
    if (type) where.type = type as CalendarEventType;
    if (all !== 'true') where.isPublic = true; // default: só públicos

    const events = await prisma.calendarEvent.findMany({
      where,
      orderBy: { startAt: 'asc' },
      include: {
        tech: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    ok(res, events);
  })
);

// GET /api/calendar/events/:id
calendarEventsRouter.get(
  '/:id',
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const event = await prisma.calendarEvent.findUnique({
      where: { id: req.params.id },
      include: {
        tech: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!event) throw notFound('Evento não encontrado');
    ok(res, event);
  })
);

// POST /api/calendar/events (ADMIN, RECEPTIONIST, TECHNICIAN)
calendarEventsRouter.post(
  '/',
  requireAuth,
  requireRole('ADMIN', 'RECEPTIONIST', 'TECHNICIAN'),
  handler(async (req: Request, res: Response) => {
    const { title, description, type, startAt, endAt, allDay, color, recurrence, techId, osId, visitId, isPublic } = req.body;
    if (!title || !type || !startAt || !endAt) {
      throw badRequest('Campos obrigatórios: title, type, startAt, endAt');
    }
    const event = await prisma.calendarEvent.create({
      data: {
        title,
        description,
        type,
        startAt: new Date(startAt),
        endAt: new Date(endAt),
        allDay: allDay ?? false,
        color,
        recurrence,
        techId: techId || (req.user?.role === 'TECHNICIAN' ? req.user.id : null),
        osId,
        visitId,
        isPublic: isPublic ?? true,
        createdById: req.user!.id,
      },
      include: {
        tech: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    created(res, event);
  })
);

// PUT /api/calendar/events/:id
calendarEventsRouter.put(
  '/:id',
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const existing = await prisma.calendarEvent.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Evento não encontrado');
    // Permissão: dono, admin, ou técnico do evento
    if (existing.createdById !== req.user!.id && req.user!.role !== 'ADMIN' && existing.techId !== req.user!.id) {
      throw badRequest('Sem permissão para editar este evento', 'FORBIDDEN');
    }
    const { title, description, type, startAt, endAt, allDay, color, recurrence, techId, osId, visitId, isPublic } = req.body;
    const event = await prisma.calendarEvent.update({
      where: { id: req.params.id },
      data: {
        title,
        description,
        type,
        startAt: startAt ? new Date(startAt) : undefined,
        endAt: endAt ? new Date(endAt) : undefined,
        allDay,
        color,
        recurrence,
        techId,
        osId,
        visitId,
        isPublic,
      },
      include: {
        tech: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    ok(res, event);
  })
);

// DELETE /api/calendar/events/:id
calendarEventsRouter.delete(
  '/:id',
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const existing = await prisma.calendarEvent.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Evento não encontrado');
    if (existing.createdById !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw badRequest('Sem permissão para excluir este evento', 'FORBIDDEN');
    }
    await prisma.calendarEvent.delete({ where: { id: req.params.id } });
    ok(res, { message: 'Evento excluído' });
  })
);

// POST /api/calendar/events/bulk - criar feriados/almoço/expediente em lote (ADMIN)
calendarEventsRouter.post(
  '/bulk',
  requireAuth,
  requireRole('ADMIN'),
  handler(async (req: Request, res: Response) => {
    const { events } = req.body as { events: any[] };
    if (!Array.isArray(events) || events.length === 0) {
      throw badRequest('Array "events" obrigatório');
    }
    const created = await prisma.calendarEvent.createMany({
      data: events.map(e => ({
        ...e,
        startAt: new Date(e.startAt),
        endAt: new Date(e.endAt),
        createdById: req.user!.id,
      })),
      skipDuplicates: true,
    });
    ok(res, { created: created.count });
  })
);

// GET /api/calendar/techs - técnicos disponíveis para agendamento
calendarEventsRouter.get(
  '/techs',
  requireAuth,
  handler(async (_req: Request, res: Response) => {
    const techs = await prisma.user.findMany({
      where: { role: 'TECHNICIAN', active: true },
      select: { id: true, name: true },
    });
    ok(res, techs);
  })
);