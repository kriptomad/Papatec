import { prisma } from '../db/prisma';
import { CalendarEventType } from '@prisma/client';
import { settingsService } from './settings.service';
import { conflict } from '../http/envelope';

const MIN_MS = 60_000;

/** "YYYY-MM-DD" do instante, em UTC (mesmo formato usado por `ServiceVisit.date`). */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Converte "hora de parede" (08:00) num instante absoluto, considerando o fuso
 * do NAVEGADOR (`tzOffsetMinutes`, convenção JS: UTC-3 => -180).
 *
 * Feito com Date.UTC para não depender do timezone do container — a imagem é
 * distroless e pode rodar em UTC enquanto o usuário está em America/Sao_Paulo.
 */
function wallClockToInstant(date: string, hhmm: string, tzOffsetMinutes: number): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  const asUtc = Date.UTC(y, (mo || 1) - 1, d || 1, h || 0, m || 0, 0, 0);
  return new Date(asUtc - tzOffsetMinutes * MIN_MS);
}

/** Inverso de wallClockToInstant: instante -> { date, hour, minute } no fuso do usuário. */
function instantToWallClock(instant: Date, tzOffsetMinutes: number): { date: string; hour: number; minute: number } {
  const shifted = new Date(instant.getTime() + tzOffsetMinutes * MIN_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export interface Slot {
  /** Instante ISO de início do slot. */
  start: string;
  /** Instante ISO de fim (início + duração pretendida). */
  end: string;
  /** "HH:MM" no fuso do usuário — é o que a UI mostra. */
  label: string;
  /** false quando o MESMO técnico já está ocupado neste horário. */
  available: boolean;
}

export interface SchedulingService {
  getAvailableSlots(input: {
    date: string;
    techId?: string | null;
    durationMinutes?: number;
    tzOffsetMinutes?: number;
    excludeVisitId?: string;
  }): Promise<{ date: string; slots: Slot[]; slotMinutes: number; defaultDurationMinutes: number; start: string; end: string }>;

  assertNoConflict(input: {
    techId?: string | null;
    start: Date;
    durationMinutes?: number | null;
    excludeVisitId?: string;
    date: string;
    tzOffsetMinutes?: number;
  }): Promise<void>;

  /**
   * Cria/atualiza/remove o CalendarEvent da visita.
   *
   * Antes o evento era criado SOMENTE na aprovação, com fim fixo em +1h.
   * Agora ele acompanha o agendamento assim que existe `scheduledAt`
   * (o vendedor marca e já sobe pro calendário central) e usa a duração
   * informada ("Tempo Serviço: 2h").
   */
  syncCalendarEvent(
    visit: {
      id: string;
      osId: string;
      scheduledAt: Date | null;
      durationMinutes?: number | null;
      address?: any;
      techId?: string | null;
    },
    actorId: string,
  ): Promise<void>;

  defaultDuration(): Promise<number>;
}

/**
 * Regra de conflito definida com o cliente:
 *
 *   "Pode ter mais de uma visita no mesmo horário, mas não para o MESMO
 *    técnico. Se for o mesmo cliente, pode — entende-se que é para
 *    endereços diferentes."
 *
 * Portanto o bloqueio é POR TÉCNICO:
 *   - técnico diferente (ou nenhum técnico) -> permitido
 *   - mesmo técnico com janelas sobrepostas  -> 409 CONFLICT
 *
 * Visitas sem `durationMinutes` usam a duração padrão de Configurações.
 */
class SchedulingServiceImpl implements SchedulingService {
  async defaultDuration(): Promise<number> {
    const { defaultDurationMinutes } = await settingsService.getSchedule();
    return defaultDurationMinutes;
  }

  private async busyWindowsForTech(techId: string, from: Date, to: Date, excludeVisitId?: string) {
    const { defaultDurationMinutes } = await settingsService.getSchedule();
    const visits = await prisma.serviceVisit.findMany({
      where: {
        techId,
        scheduledAt: { gte: from, lte: to },
        ...(excludeVisitId ? { id: { not: excludeVisitId } } : {}),
      },
      select: { id: true, scheduledAt: true, durationMinutes: true, os: { select: { osNumber: true } } },
      orderBy: { scheduledAt: 'asc' },
    });

    return visits
      .filter((v) => v.scheduledAt)
      .map((v) => {
        const start = v.scheduledAt as Date;
        const minutes = Number(v.durationMinutes) > 0 ? Number(v.durationMinutes) : defaultDurationMinutes;
        return { id: v.id, start, end: new Date(start.getTime() + minutes * MIN_MS), minutes, osNumber: v.os?.osNumber };
      });
  }

  async assertNoConflict(input: {
    techId?: string | null;
    start: Date;
    durationMinutes?: number | null;
    excludeVisitId?: string;
    date: string;
    tzOffsetMinutes?: number;
  }): Promise<void> {
    // `Number(undefined)` é NaN, e `NaN ?? x` devolve NaN — normaliza antes.
    const tz = Number.isFinite(input.tzOffsetMinutes)
      ? (input.tzOffsetMinutes as number)
      : -new Date().getTimezoneOffset();

    const techId = input.techId || null;
    // Sem técnico atribuído não há recurso disputado — conforme a regra acima.
    if (!techId) return;

    const duration =
      Number(input.durationMinutes) > 0
        ? Number(input.durationMinutes)
        : await this.defaultDuration();

    const end = new Date(input.start.getTime() + duration * MIN_MS);

    // Janela de 2 dias abrange visitas que começam na véspera e invadem o dia.
    const from = new Date(input.start.getTime() - 48 * 60 * MIN_MS);
    const to = new Date(input.start.getTime() + 48 * 60 * MIN_MS);

    const busy = await this.busyWindowsForTech(techId, from, to, input.excludeVisitId);
    const clash = busy.find((w) => w.start < end && w.end > input.start);

    if (clash) {
      const fmt = (d: Date) => {
        const w = instantToWallClock(d, tz);
        return `${pad2(w.hour)}:${pad2(w.minute)}`;
      };
      throw conflict(
        `Técnico já agendado das ${fmt(clash.start)} às ${fmt(clash.end)}` +
          `${clash.osNumber ? ` (O.S. ${clash.osNumber})` : ''}. Escolha outro horário ou outro técnico.`,
        'VISIT_SLOT_CONFLICT',
      );
    }
  }

  async syncCalendarEvent(
    visit: {
      id: string;
      osId: string;
      scheduledAt: Date | null;
      durationMinutes?: number | null;
      address?: any;
      techId?: string | null;
    },
    actorId: string,
  ): Promise<void> {
    const existing = await prisma.calendarEvent.findFirst({ where: { visitId: visit.id } });

    // Visita desmarcada -> não deve continuar ocupando o calendário.
    if (!visit.scheduledAt) {
      if (existing) await prisma.calendarEvent.delete({ where: { id: existing.id } });
      return;
    }

    const minutes =
      Number(visit.durationMinutes) > 0 ? Number(visit.durationMinutes) : await this.defaultDuration();
    const startAt = visit.scheduledAt;
    const endAt = new Date(startAt.getTime() + minutes * MIN_MS);

    const os = await prisma.serviceOrder.findUnique({
      where: { id: visit.osId },
      select: {
        osNumber: true,
        client: { select: { name: true } },
        // Endereços da O.S.: principal em `serviceAddress`, adicionais em
        // `serviceAddresses`. Servem de fallback quando a visita não tem
        // endereço próprio (ex.: agendada pelo popup do vendedor).
        serviceAddress: true,
        serviceAddresses: true,
      },
    });

    // Ordem de precedência do endereço: escolhido na visita -> principal da
    // O.S. -> primeiro adicional.
    const asAddr = (v: any): any => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
    const extras: any[] = Array.isArray(os?.serviceAddresses) ? (os!.serviceAddresses as any[]) : [];
    const addr = asAddr(visit.address) || asAddr(os?.serviceAddress) || asAddr(extras[0]) || {};

    const addressLine = [addr.street, addr.number].filter(Boolean).join(', ');
    const cityLine = [addr.city, addr.state].filter(Boolean).join('/');
    const whereLine = [addressLine, cityLine].filter(Boolean).join(' · ');
    const title =
      [
        os?.osNumber ? `O.S. ${os.osNumber}` : null,
        os?.client?.name,
        whereLine,
      ]
        .filter(Boolean)
        .join(' · ') || 'Visita técnica';

    const description = [
      whereLine ? `Endereço: ${whereLine}` : null,
      `Duração prevista: ${minutes} min`,
      extras.length > 1 ? `${extras.length} endereços na O.S.` : null,
      visit.techId ? null : 'Sem técnico atribuído',
    ]
      .filter(Boolean)
      .join(' · ');

    const shared = {
      title,
      description,
      type: CalendarEventType.APPOINTMENT,
      startAt,
      endAt,
      techId: visit.techId || null,
      osId: visit.osId,
      visitId: visit.id,
      isPublic: true,
    };

    if (existing) {
      await prisma.calendarEvent.update({ where: { id: existing.id }, data: shared });
    } else {
      await prisma.calendarEvent.create({ data: { ...shared, createdById: actorId } });
    }
  }

  async getAvailableSlots(input: {
    date: string;
    techId?: string | null;
    durationMinutes?: number;
    tzOffsetMinutes?: number;
    excludeVisitId?: string;
  }) {
    const tz = Number.isFinite(input.tzOffsetMinutes)
      ? (input.tzOffsetMinutes as number)
      : -new Date().getTimezoneOffset();

    const schedule = await settingsService.getSchedule();
    const duration =
      Number(input.durationMinutes) > 0
        ? Number(input.durationMinutes)
        : schedule.defaultDurationMinutes;

    const techId = input.techId || null;

    // Janela do dia já projetada no fuso do usuário, com folga para visitas
    // da véspera/vesperinha que possam invadir o dia pedido.
    const dayStart = wallClockToInstant(input.date, schedule.start, tz);
    const dayEnd = wallClockToInstant(input.date, schedule.end, tz);
    const from = new Date(dayStart.getTime() - 48 * 60 * MIN_MS);
    const to = new Date(dayEnd.getTime() + 48 * 60 * MIN_MS);

    const busy = techId ? await this.busyWindowsForTech(techId, from, to, input.excludeVisitId) : [];

    const slots: Slot[] = [];
    const [startH, startM] = schedule.start.split(':').map(Number);
    const [endH, endM] = schedule.end.split(':').map(Number);

    const totalMinutes = endH * 60 + endM - (startH * 60 + startM);
    if (totalMinutes <= 0) return { date: input.date, slots, ...schedule };

    for (let offset = 0; offset + duration <= totalMinutes; offset += schedule.slotMinutes) {
      const minuteOfDay = startH * 60 + startM + offset;
      const label = `${pad2(Math.floor(minuteOfDay / 60))}:${pad2(minuteOfDay % 60)}`;
      const start = wallClockToInstant(input.date, label, tz);
      const end = new Date(start.getTime() + duration * MIN_MS);

      // O slot é considerado ocupado se o técnico tiver QUALQUER janela
      // sobreposta — assim o horário já "reservado" desaparece da lista.
      const taken = busy.some((w) => w.start < end && w.end > start);

      slots.push({ start: start.toISOString(), end: end.toISOString(), label, available: !taken });
    }

    return { date: input.date, slots, ...schedule };
  }
}

export const schedulingService = new SchedulingServiceImpl();
