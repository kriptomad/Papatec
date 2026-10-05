import { Router, Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { handler } from '../http/errors';
import { ok, notFound, badRequest } from '../http/envelope';
import { schedulingService } from '../services/scheduling.service';
import { AppointmentStatus, CalendarEventType } from '@prisma/client';

export const serviceVisitsApprovalRouter = Router();

// GET /api/service-visits/pending - visitas pendentes de aprovação (técnico vê as suas)
serviceVisitsApprovalRouter.get(
  '/pending',
  requireAuth,
  requireRole('TECHNICIAN', 'ADMIN'),
  handler(async (req: Request, res: Response) => {
    const where: any = { appointmentStatus: 'PENDING' };
    if (req.user!.role === 'TECHNICIAN') where.techId = req.user!.id;
    const visits = await prisma.serviceVisit.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      include: {
        os: { select: { id: true, osNumber: true, client: { select: { id: true, name: true, phone: true } }, defect: true } },
        tech: { select: { id: true, name: true } },
      },
    });
    ok(res, visits);
  })
);

// POST /api/service-visits/:id/approve - técnico aprova agendamento
serviceVisitsApprovalRouter.post(
  '/:id/approve',
  requireAuth,
  requireRole('TECHNICIAN', 'ADMIN'),
  handler(async (req: Request, res: Response) => {
    const visit = await prisma.serviceVisit.findUnique({
      where: { id: req.params.id },
      include: { os: { include: { client: true } } },
    });
    if (!visit) throw notFound('Visita não encontrada');
    if (req.user!.role === 'TECHNICIAN' && visit.techId !== req.user!.id) {
      throw badRequest('Esta visita não é sua', 'FORBIDDEN');
    }
    if (visit.appointmentStatus !== 'PENDING') {
      throw badRequest('Apenas visitas pendentes podem ser aprovadas', 'INVALID_STATUS');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const v = await tx.serviceVisit.update({
        where: { id: visit.id },
        data: { appointmentStatus: 'APPROVED' },
        include: { os: { include: { client: true } }, tech: true },
      });
      // O evento de calendário já foi criado junto com o agendamento
      // (syncCalendarEvent), e é re-sincronizado fora desta transação usando a
      // duração REAL da visita — antes havia um `create` com fim fixo em +1h,
      // que duplicava o evento e ignorava o "Tempo Serviço".
      // Atualiza OS se tiver appointmentStatus
      if (v.os.appointmentStatus === 'PENDING') {
        await tx.serviceOrder.update({
          where: { id: v.osId },
          data: { appointmentStatus: 'APPROVED' },
        });
      }
      return v;
    });
    await schedulingService.syncCalendarEvent(updated, req.user!.id);
    ok(res, updated);
  })
);

// POST /api/service-visits/:id/reject - técnico recusa agendamento
serviceVisitsApprovalRouter.post(
  '/:id/reject',
  requireAuth,
  requireRole('TECHNICIAN', 'ADMIN'),
  handler(async (req: Request, res: Response) => {
    const { reason } = req.body;
    const visit = await prisma.serviceVisit.findUnique({
      where: { id: req.params.id },
      include: { os: { include: { client: true } } },
    });
    if (!visit) throw notFound('Visita não encontrada');
    if (req.user!.role === 'TECHNICIAN' && visit.techId !== req.user!.id) {
      throw badRequest('Esta visita não é sua', 'FORBIDDEN');
    }
    if (visit.appointmentStatus !== 'PENDING') {
      throw badRequest('Apenas visitas pendentes podem ser recusadas', 'INVALID_STATUS');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const v = await tx.serviceVisit.update({
        where: { id: visit.id },
        data: { appointmentStatus: 'REJECTED', notes: reason ? `${visit.notes || ''}\n[Recusa]: ${reason}` : visit.notes },
        include: { os: { include: { client: true } } },
      });
      if (v.os.appointmentStatus === 'PENDING') {
        await tx.serviceOrder.update({
          where: { id: v.osId },
          data: { appointmentStatus: 'REJECTED' },
        });
      }
      return v;
    });
    ok(res, updated);
  })
);

// POST /api/service-visits/:id/reschedule - reagendar (técnico ou admin)
serviceVisitsApprovalRouter.post(
  '/:id/reschedule',
  requireAuth,
  requireRole('TECHNICIAN', 'ADMIN'),
  handler(async (req: Request, res: Response) => {
    const { scheduledAt, durationMinutes, date, tzOffsetMinutes } = req.body;
    if (!scheduledAt) throw badRequest('scheduledAt obrigatório');
    const visit = await prisma.serviceVisit.findUnique({ where: { id: req.params.id } });
    if (!visit) throw notFound('Visita não encontrada');
    if (req.user!.role === 'TECHNICIAN' && visit.techId !== req.user!.id) {
      throw badRequest('Esta visita não é sua', 'FORBIDDEN');
    }

    const newStart = new Date(scheduledAt);
    if (Number.isNaN(newStart.getTime())) throw badRequest('Horário inválido.', 'INVALID_VISIT_TIME');

    // "Tempo Serviço" pode vir junto do reagendamento. Antes era ignorado e o
    // evento do calendário continuava com a duração antiga.
    const rawDuration =
      durationMinutes === undefined || durationMinutes === null || durationMinutes === ''
        ? visit.durationMinutes
        : Number(durationMinutes);
    const nextDuration = rawDuration === null ? null : Number(rawDuration);
    if (nextDuration !== null && Number.isFinite(nextDuration) && nextDuration > 24 * 60) {
      throw badRequest('Duração acima de 24h.', 'INVALID_DURATION');
    }

    // Reagendar pode mudar o DIA. `date` é o campo que a agenda usa para
    // filtrar, então ficar para trás esconderia a visita no dia novo.
    const dateOnly = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date.trim());
    const nextDate = dateOnly
      ? new Date(`${date.trim()}T12:00:00.000Z`)
      : date
        ? new Date(date)
        : visit.date;
    if (Number.isNaN(nextDate.getTime())) throw badRequest('Data inválida.');
    // Sem `date` explícito, deriva o dia do próprio horário (fuso do cliente).
    if (!date && tzOffsetMinutes !== undefined) {
      const shifted = new Date(newStart.getTime() + Number(tzOffsetMinutes) * 60_000);
      nextDate.setUTCFullYear(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
      nextDate.setUTCHours(12, 0, 0, 0);
    }

    // Reagendar também passa pela trava por técnico (exclui a própria visita
    // para não conflitar consigo mesma).
    await schedulingService.assertNoConflict({
      techId: visit.techId,
      start: newStart,
      durationMinutes: nextDuration,
      excludeVisitId: visit.id,
      date: nextDate.toISOString().slice(0, 10),
      tzOffsetMinutes,
    });

    const updated = await prisma.serviceVisit.update({
      where: { id: visit.id },
      data: {
        scheduledAt: newStart,
        date: nextDate,
        durationMinutes: nextDuration,
        appointmentStatus: 'PENDING',
      },
    });
    // Re-sincroniza o evento do calendário central — aqui ele passa a usar a
    // duração REAL da visita em vez do `+1h` fixo de antes.
    await schedulingService.syncCalendarEvent(updated, req.user!.id);
    ok(res, updated);
  })
);

// GET /api/service-visits/calendar - eventos de calendário do técnico (para FullCalendar)
const CAL_DAY_MS = 86_400_000;
const CAL_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `end` inclusivo: data pura avança para o início do dia seguinte (ver calendarEvents.routes). */
function calBoundary(value: string | undefined, isEnd: boolean): Date | undefined {
  if (!value) return undefined;
  const dateOnly = CAL_DATE_ONLY.test(value);
  const parsed = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (isEnd && dateOnly) return new Date(parsed.getTime() + CAL_DAY_MS);
  if (isEnd) return new Date(parsed.getTime() + 1);
  return parsed;
}

serviceVisitsApprovalRouter.get(
  '/calendar',
  requireAuth,
  handler(async (req: Request, res: Response) => {
    const { start, end } = req.query as Record<string, string>;
    const where: any = { type: 'APPOINTMENT' };
    if (req.user!.role === 'TECHNICIAN') where.techId = req.user!.id;

    // Sobreposição (igual ao /api/calendar): nada some por cruzar a meia-noite.
    const from = calBoundary(start, false);
    const to = calBoundary(end, true);
    if (from) where.endAt = { gt: from };
    if (to) where.startAt = { lt: to };

    const events = await prisma.calendarEvent.findMany({
      where,
      orderBy: { startAt: 'asc' },
      include: { tech: { select: { id: true, name: true } } },
    });
    ok(res, events);
  })
);