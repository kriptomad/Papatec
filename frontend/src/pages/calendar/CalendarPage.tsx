import { useMemo, useState } from 'react';
import {
  Box, Card, CardContent, Typography, IconButton, Button, Chip, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, FormControlLabel, Checkbox,
  Snackbar, Alert, Divider, CircularProgress, Stack,
} from '@mui/material';
import { ChevronLeft, ChevronRight, Today, Add, Delete, CheckCircle, Close, Schedule } from '@mui/icons-material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { calendarApi, serviceVisitsApi } from '../../services/api';
import { PrimaryButton, SecondaryButton, DangerButton } from '../../components/ui/Buttons';
import FormErrors from '../../components/ui/FormErrors';
import { truncate } from '../../utils/formatters';
import { useNavigate } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Constantes e helpers
// ---------------------------------------------------------------------------
type EventType = 'APPOINTMENT' | 'HOLIDAY' | 'SPECIAL_DATE' | 'LUNCH_BREAK' | 'BUSINESS_HOURS' | 'CUSTOM';

const TYPE_LABELS: Record<string, string> = {
  APPOINTMENT: 'Agendamento',
  HOLIDAY: 'Feriado',
  SPECIAL_DATE: 'Dia especial',
  LUNCH_BREAK: 'Almoço',
  BUSINESS_HOURS: 'Horário comercial',
  CUSTOM: 'Personalizado',
};

const TYPE_COLORS: Record<string, string> = {
  HOLIDAY: '#d32f2f',
  SPECIAL_DATE: '#8e24aa',
  LUNCH_BREAK: '#ef6c00',
  BUSINESS_HOURS: '#455a64',
  APPOINTMENT: '#1976d2',
  CUSTOM: '#757575',
};

/**
 * Tipos oferecidos no dropdown de "+ Novo Evento".
 *
 * APPOINTMENT ficou de fora de propósito: agendamento técnico é feito em
 * "Agenda / Horas", e o calendário é só onde o evento aprovado aparece. Deixar
 * a opção aqui permitia criar um agendamento pelo calendário, sem técnico, sem
 * técnico responsável e fora do fluxo de aprovação — que é exatamente o que a
 * Agenda / Horas controla.
 *
 * APPOINTMENT continua em TYPE_LABELS, QUICK_TYPES e LEGEND: os eventos que a
 * Agenda cria precisam continuar sendo rotulados e coloridos aqui.
 */
const EVENT_TYPES: EventType[] = ['HOLIDAY', 'SPECIAL_DATE', 'LUNCH_BREAK', 'BUSINESS_HOURS', 'CUSTOM'];

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const QUICK_TYPES: { type: EventType; label: string }[] = [
  { type: 'HOLIDAY', label: 'Feriado' },
  { type: 'SPECIAL_DATE', label: 'Dia especial' },
  { type: 'LUNCH_BREAK', label: 'Almoço' },
  { type: 'BUSINESS_HOURS', label: 'Horário comercial' },
];

const LEGEND: { type: EventType; label: string }[] = [
  { type: 'HOLIDAY', label: 'Feriado' },
  { type: 'SPECIAL_DATE', label: 'Dia especial' },
  { type: 'LUNCH_BREAK', label: 'Almoço' },
  { type: 'BUSINESS_HOURS', label: 'Horário comercial' },
  { type: 'APPOINTMENT', label: 'Agendamento' },
  { type: 'CUSTOM', label: 'Personalizado' },
];

const PRESETS: Record<string, Partial<EventFormState>> = {
  HOLIDAY: { title: 'Feriado', allDay: true, startTime: '00:00', endTime: '23:59', color: TYPE_COLORS.HOLIDAY },
  SPECIAL_DATE: { title: 'Dia especial', allDay: true, startTime: '00:00', endTime: '23:59', color: TYPE_COLORS.SPECIAL_DATE },
  LUNCH_BREAK: { title: 'Almoço', allDay: false, startTime: '12:00', endTime: '13:30', color: TYPE_COLORS.LUNCH_BREAK },
  BUSINESS_HOURS: { title: 'Horário comercial', allDay: false, startTime: '08:00', endTime: '18:00', color: TYPE_COLORS.BUSINESS_HOURS },
};

const pad = (n: number) => String(n).padStart(2, '0');

const toISODate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const formatDateKey = (key: string) => {
  if (!key) return '—';
  const parts = key.split('-');
  if (parts.length !== 3) return key;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

const timeOf = (value?: string | null): string => {
  if (!value) return '';
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const visitDateKey = (v: any): string => {
  if (v?.date) return String(v.date).slice(0, 10);
  if (v?.scheduledAt) return toISODate(new Date(v.scheduledAt));
  return '';
};

interface EventFormState {
  id: string | null;
  title: string;
  description: string;
  type: EventType;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  color: string;
}

interface CalItem {
  key: string;
  kind: 'event' | 'visit';
  dateKey: string;
  color: string;
  label: string;
  timeLabel: string;
  raw: any;
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------
export function CalendarPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pageError, setPageError] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  const [action, setAction] = useState<{ type: 'reject' | 'reschedule'; visit: any } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [actionDatetime, setActionDatetime] = useState('');
  const [actionError, setActionError] = useState<any>(null);
  const [savingAction, setSavingAction] = useState(false);

  const [form, setForm] = useState<EventFormState>({
    id: null,
    title: '',
    description: '',
    type: 'APPOINTMENT',
    date: toISODate(new Date()),
    startTime: '09:00',
    endTime: '10:00',
    allDay: false,
    color: TYPE_COLORS.APPOINTMENT,
  });

  const showSnack = (message: string, severity: 'success' | 'error') => setSnack({ open: true, message, severity });

  // Grade do mês: 6 semanas (42 dias), começando no domingo
  const range = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - first.getDay());
    const list: Date[] = [];
    for (let i = 0; i < 42; i++) {
      list.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
    }
    const gridEnd = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + 41);
    return { gridStart, gridEnd, days: list };
  }, [cursor]);

  // Envia DATA PURA (YYYY-MM-DD) nos dois limites. O backend trata `end` como
  // inclusivo e cobre o dia inteiro; antes mandava `T23:59:59` sem fuso, que o
  // Node interpretava como UTC e perdia os eventos do fim do dia.
  const startISO = toISODate(range.gridStart);
  const endISO = toISODate(range.gridEnd);

  const eventsQuery = useQuery({
    queryKey: ['calendarEvents', startISO, endISO],
    queryFn: () => calendarApi.list({ start: startISO, end: endISO }),
  });
  const visitsQuery = useQuery({
    queryKey: ['calendarVisits', startISO, endISO],
    queryFn: () => serviceVisitsApi.calendar({ start: startISO, end: endISO }),
  });
  const pendingQuery = useQuery({
    queryKey: ['pendingVisits'],
    queryFn: () => serviceVisitsApi.pending(),
  });

  const events: any[] = eventsQuery.data || [];
  const visits: any[] = visitsQuery.data || [];
  const pending: any[] = pendingQuery.data || [];

  const isLoading = eventsQuery.isLoading || visitsQuery.isLoading || pendingQuery.isLoading;

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['calendarEvents'] });
    queryClient.invalidateQueries({ queryKey: ['calendarVisits'] });
    queryClient.invalidateQueries({ queryKey: ['pendingVisits'] });
    queryClient.invalidateQueries({ queryKey: ['visits'] });
  };

  // Junta as DUAS fontes (eventos do calendário + visitas agendadas) em um mapa dia -> itens
  const itemsByDay = useMemo(() => {
    const acc: Record<string, CalItem[]> = {};
    const push = (key: string, item: CalItem) => {
      if (!key) return;
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
    };

    events.forEach((ev: any) => {
      const start = new Date(ev.startAt);
      if (isNaN(start.getTime())) return;
      const end = ev.endAt ? new Date(ev.endAt) : start;
      const color = ev.color || TYPE_COLORS[ev.type] || TYPE_COLORS.CUSTOM;
      const title = ev.title || TYPE_LABELS[ev.type] || 'Evento';

      if (ev.allDay) {
        const safeEnd = isNaN(end.getTime()) ? start : end;
        let day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const last = new Date(safeEnd.getFullYear(), safeEnd.getMonth(), safeEnd.getDate());
        let guard = 0;
        while (day.getTime() <= last.getTime() && guard < 62) {
          const key = toISODate(day);
          push(key, { key: `e-${ev.id}-${key}`, kind: 'event', dateKey: key, color, label: title, timeLabel: '', raw: ev });
          day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
          guard += 1;
        }
      } else {
        const key = toISODate(start);
        push(key, { key: `e-${ev.id}`, kind: 'event', dateKey: key, color, label: title, timeLabel: timeOf(ev.startAt), raw: ev });
      }
    });

    visits.forEach((v: any) => {
      const status = v.appointmentStatus;
      if (status === 'REJECTED' || status === 'CANCELLED') return;
      const key = visitDateKey(v);
      const techName = v.tech?.name || (v.techId ? 'Técnico' : 'Sem técnico');
      const osNumber = v.os?.osNumber ? `OS ${v.os.osNumber}` : 'OS';
      const clientName = v.os?.client?.name || '';
      const label = [techName, osNumber, clientName].filter(Boolean).join(' · ');
      push(key, {
        key: `v-${v.id}`,
        kind: 'visit',
        dateKey: key,
        color: TYPE_COLORS.APPOINTMENT,
        label,
        timeLabel: timeOf(v.scheduledAt) || timeOf(v.arrival),
        raw: v,
      });
    });

    return acc;
  }, [events, visits]);

  // ----------------------------- Ações de evento ---------------------------
  const openCreateDialog = (dateKey: string, type?: EventType) => {
    const preset = type && PRESETS[type] ? PRESETS[type] : {};
    setForm({
      id: null,
      title: '',
      description: '',
      type: type || 'APPOINTMENT',
      date: dateKey || toISODate(new Date()),
      startTime: '09:00',
      endTime: '10:00',
      allDay: false,
      color: TYPE_COLORS.APPOINTMENT,
      ...preset,
    });
    setPageError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (ev: any) => {
    const start = new Date(ev.startAt);
    setForm({
      id: ev.id,
      title: ev.title || '',
      description: ev.description || '',
      type: (ev.type as EventType) || 'APPOINTMENT',
      date: isNaN(start.getTime()) ? toISODate(new Date()) : toISODate(start),
      startTime: timeOf(ev.startAt) || '09:00',
      endTime: timeOf(ev.endAt) || '10:00',
      allDay: !!ev.allDay,
      color: ev.color || TYPE_COLORS[ev.type] || TYPE_COLORS.CUSTOM,
    });
    setPageError(null);
    setDialogOpen(true);
  };

  const saveEvent = async () => {
    if (!form.title.trim()) {
      setPageError('Informe um título para o evento.');
      return;
    }
    setSaving(true);
    try {
      const startAt = form.allDay ? `${form.date}T00:00:00` : `${form.date}T${form.startTime || '00:00'}:00`;
      const endAt = form.allDay ? `${form.date}T23:59:59` : `${form.date}T${form.endTime || form.startTime || '23:59'}:00`;
      const payload = {
        title: form.title.trim(),
        description: form.description,
        type: form.type,
        startAt,
        endAt,
        allDay: form.allDay,
        color: form.color,
        isPublic: true,
      };
      if (form.id) {
        await calendarApi.update(form.id, payload);
        showSnack('Evento atualizado com sucesso.', 'success');
      } else {
        await calendarApi.create(payload);
        showSnack('Evento criado com sucesso.', 'success');
      }
      setDialogOpen(false);
      refreshAll();
    } catch (err) {
      setPageError(err);
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = async () => {
    if (!form.id) return;
    if (!window.confirm('Excluir este evento?')) return;
    setSaving(true);
    try {
      await calendarApi.remove(form.id);
      setDialogOpen(false);
      refreshAll();
      showSnack('Evento excluído.', 'success');
    } catch (err) {
      setPageError(err);
    } finally {
      setSaving(false);
    }
  };

  // ----------------------- Aprovação de agendamentos -----------------------
  const openAction = (type: 'reject' | 'reschedule', visit: any) => {
    setActionReason('');
    const rsDate = visit?.scheduledAt ? new Date(visit.scheduledAt) : null;
    const rsPad = (n: number) => String(n).padStart(2, '0');
    setActionDatetime(rsDate ? `${rsDate.getFullYear()}-${rsPad(rsDate.getMonth() + 1)}-${rsPad(rsDate.getDate())}T${rsPad(rsDate.getHours())}:${rsPad(rsDate.getMinutes())}` : '');
    setActionError(null);
    setAction({ type, visit });
  };

  const approveVisit = async (visit: any) => {
    try {
      await serviceVisitsApi.approve(visit.id);
      refreshAll();
      showSnack('Agendamento aprovado.', 'success');
    } catch (err) {
      setPageError(err);
    }
  };

  const submitAction = async () => {
    if (!action) return;
    if (action.type === 'reject' && !actionReason.trim()) {
      setActionError('Informe o motivo da recusa.');
      return;
    }
    if (action.type === 'reschedule' && !actionDatetime) {
      setActionError('Informe a nova data e hora do agendamento.');
      return;
    }
    setSavingAction(true);
    try {
      if (action.type === 'reject') {
        await serviceVisitsApi.reject(action.visit.id, { reason: actionReason.trim() });
        showSnack('Agendamento recusado.', 'success');
      } else {
        await serviceVisitsApi.reschedule(action.visit.id, { scheduledAt: new Date(actionDatetime).toISOString() });
        showSnack('Visita reagendada.', 'success');
      }
      setAction(null);
      refreshAll();
    } catch (err) {
      setActionError(err);
    } finally {
      setSavingAction(false);
    }
  };

  // ------------------------------ Constes JSX ------------------------------
  const monthLabel = (() => {
    const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(cursor);
    return label.charAt(0).toUpperCase() + label.slice(1);
  })();

  const todayKey = toISODate(new Date());

  const typeOptionItems = EVENT_TYPES.map((t) => (
    <MenuItem key={t} value={t}>
      {TYPE_LABELS[t]}
    </MenuItem>
  ));

  const legendItems = LEGEND.map((entry) => (
    <Chip
      key={entry.type}
      size="small"
      label={entry.label}
      sx={{ bgcolor: TYPE_COLORS[entry.type], color: '#fff', fontWeight: 600 }}
    />
  ));

  const quickButtons = QUICK_TYPES.map((entry) => (
    <Button
      key={entry.type}
      size="small"
      variant="outlined"
      startIcon={<Add fontSize="small" />}
      onClick={() => openCreateDialog(todayKey, entry.type)}
    >
      {entry.label}
    </Button>
  ));

  const weekdayCells = WEEKDAYS.map((day) => (
    <Box
      key={day}
      sx={{
        py: 0.75,
        textAlign: 'center',
        fontWeight: 700,
        fontSize: 12,
        color: 'text.secondary',
        bgcolor: 'grey.100',
        borderRight: 1,
        borderColor: 'divider',
        '&:last-of-type': { borderRight: 'none' },
      }}
    >
      {day}
    </Box>
  ));

  const pendingRows = pending.map((v: any) => {
    const osNumber = v.os?.osNumber ? `OS ${v.os.osNumber}` : 'OS';
    const clientName = v.os?.client?.name || 'Cliente não informado';
    const when = formatDateKey(visitDateKey(v)) + (timeOf(v.scheduledAt) ? ` às ${timeOf(v.scheduledAt)}` : '');
    return (
      <Box
        key={v.id}
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
          py: 1.25,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2">
            {osNumber} · {clientName}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {v.tech?.name || 'Sem técnico'} · {when}
            {v.needsSecondVisit ? ' · 2ª ida' : ''}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, flexWrap: 'wrap' }}>
          <Button size="small" variant="contained" color="success" startIcon={<CheckCircle fontSize="small" />} onClick={() => approveVisit(v)}>
            Aprovar
          </Button>
          <Button size="small" variant="outlined" color="error" startIcon={<Close fontSize="small" />} onClick={() => openAction('reject', v)}>
            Recusar
          </Button>
          <Button size="small" variant="outlined" startIcon={<Schedule fontSize="small" />} onClick={() => openAction('reschedule', v)}>
            Reagendar
          </Button>
        </Box>
      </Box>
    );
  });

  const dayCells = range.days.map((day) => {
    const key = toISODate(day);
    const inMonth = day.getMonth() === cursor.getMonth();
    const isToday = key === todayKey;
    const dayItems = itemsByDay[key] || [];
    const visible = dayItems.slice(0, 3);
    const extra = dayItems.length - visible.length;

    const chips = visible.map((it) => {
      const fullLabel = it.timeLabel ? `${it.timeLabel} · ${it.label}` : it.label;
      return (
        <Chip
          key={it.key}
          size="small"
          label={truncate(fullLabel, 30)}
          onClick={(e) => {
            e.stopPropagation();
            if (it.kind === 'event') openEditDialog(it.raw);
            else navigate(`/service-orders/${it.raw.osId}`);
          }}
          sx={{
            bgcolor: it.color,
            color: '#fff',
            maxWidth: '100%',
            height: 22,
            fontWeight: 600,
            cursor: 'pointer',
            '& .MuiChip-label': { px: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          }}
        />
      );
    });

    return (
      <Box
        key={key}
        onClick={() => openCreateDialog(key)}
        sx={{
          minHeight: 104,
          p: 0.75,
          borderRight: 1,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: inMonth ? 'background.paper' : 'grey.50',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          opacity: inMonth ? 1 : 0.55,
          transition: 'background-color 0.15s',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: isToday ? 800 : 600,
              bgcolor: isToday ? 'primary.main' : 'transparent',
              color: isToday ? '#fff' : 'text.secondary',
              borderRadius: isToday ? '50%' : 0,
              width: 22,
              height: 22,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {day.getDate()}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, overflow: 'hidden' }}>{chips}</Box>
        {extra > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            +{extra} evento(s)
          </Typography>
        )}
      </Box>
    );
  });

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>
            Calendário
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Agendamentos, feriados, dias especiais e horário comercial
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <SecondaryButton startIcon={<Schedule />} onClick={() => navigate('/visits')}>
            Agenda / Registro de Horas
          </SecondaryButton>
          <PrimaryButton startIcon={<Add />} onClick={() => openCreateDialog(todayKey)}>
            Novo Evento
          </PrimaryButton>
        </Box>
      </Box>

      <FormErrors error={pageError} onClose={() => setPageError(null)} />

      {/* Agendamentos pendentes de aprovação */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="h6" fontWeight={700}>
              Agendamentos pendentes de aprovação
            </Typography>
            <Chip label={`${pending.length} pendente(s)`} color={pending.length > 0 ? 'warning' : 'default'} size="small" />
          </Box>
          {pendingRows.length > 0 ? (
            <Stack divider={<Divider />}>{pendingRows}</Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Nenhum agendamento aguardando aprovação.
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Feriados / dias especiais + legenda */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            Feriados / Dias especiais
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{quickButtons}</Box>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            Legenda
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{legendItems}</Box>
        </CardContent>
      </Card>

      {/* Calendário mensal */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <IconButton size="small" aria-label="Mês anterior" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}>
                <ChevronLeft />
              </IconButton>
              <Typography variant="h6" fontWeight={700} sx={{ minWidth: 170, textAlign: 'center' }}>
                {monthLabel}
              </Typography>
              <IconButton size="small" aria-label="Próximo mês" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}>
                <ChevronRight />
              </IconButton>
            </Box>
            <Button size="small" variant="outlined" startIcon={<Today fontSize="small" />} onClick={() => {
              const now = new Date();
              setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
            }}>
              Hoje
            </Button>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderTop: 1, borderLeft: 1, borderColor: 'divider' }}>
            {weekdayCells}
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderLeft: 1, borderColor: 'divider' }}>{dayCells}</Box>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
            Clique em um dia para criar um evento. Clique em um evento para editar ou excluir. Clique em um agendamento para abrir a O.S.
          </Typography>
        </CardContent>
      </Card>

      {/* Dialog de criação/edição de evento */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{form.id ? 'Editar Evento' : 'Novo Evento'}</DialogTitle>
        <DialogContent dividers>
          <FormErrors error={pageError} onClose={() => setPageError(null)} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mt: form.id || pageError ? 2 : 1 }}>
            <TextField label="Título *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} fullWidth autoFocus />
            <TextField select label="Tipo" value={form.type} onChange={(e) => {
              const t = e.target.value as EventType;
              setForm({ ...form, type: t, color: TYPE_COLORS[t] || form.color });
            }} fullWidth>
              {typeOptionItems}
            </TextField>
            <TextField label="Data" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} fullWidth InputLabelProps={{ shrink: true }} />
            <TextField label="Cor" type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} fullWidth InputLabelProps={{ shrink: true }} />
            <FormControlLabel
              sx={{ gridColumn: '1 / -1' }}
              control={<Checkbox checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} />}
              label="Dia inteiro"
            />
            {!form.allDay && (
              <>
                <TextField label="Horário de início" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} fullWidth InputLabelProps={{ shrink: true }} />
                <TextField label="Horário de fim" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} fullWidth InputLabelProps={{ shrink: true }} />
              </>
            )}
            <TextField label="Descrição" multiline rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} fullWidth sx={{ gridColumn: '1 / -1' }} />
          </Box>
        </DialogContent>
        <DialogActions>
          {form.id && (
            <DangerButton startIcon={<Delete />} onClick={deleteEvent} disabled={saving} sx={{ mr: 'auto' }}>
              Excluir
            </DangerButton>
          )}
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <PrimaryButton onClick={saveEvent} loading={saving}>
            {form.id ? 'Salvar' : 'Criar'}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* Dialog de recusa / reagendamento */}
      <Dialog open={!!action} onClose={() => setAction(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{action?.type === 'reject' ? 'Recusar Agendamento' : 'Reagendar Visita'}</DialogTitle>
        <DialogContent dividers>
          <FormErrors error={actionError} onClose={() => setActionError(null)} />
          {action?.type === 'reject' ? (
            <TextField
              fullWidth
              multiline
              rows={3}
              label="Motivo da recusa"
              placeholder="Informe o motivo..."
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              sx={{ mt: 1 }}
            />
          ) : (
            <TextField
              fullWidth
              type="datetime-local"
              label="Nova data e horário"
              value={actionDatetime}
              onChange={(e) => setActionDatetime(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ mt: 1 }}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAction(null)} disabled={savingAction}>
            Cancelar
          </Button>
          <PrimaryButton onClick={submitAction} loading={savingAction}>
            {action?.type === 'reject' ? 'Recusar' : 'Reagendar'}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={3000} onClose={() => setSnack({ ...snack, open: false })}>
        <Alert severity={snack.severity} variant="filled" onClose={() => setSnack({ ...snack, open: false })}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default CalendarPage;
