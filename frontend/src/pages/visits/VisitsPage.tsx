import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, TextField, MenuItem, Switch, FormControlLabel,
  Table, TableContainer, TableHead, TableBody, TableRow, TableCell, Chip, Button,
  IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Snackbar,
  Alert, CircularProgress, Autocomplete, Checkbox, Divider,
} from '@mui/material';
import { Add, Login, Logout, CheckCircle, Close, Schedule, CalendarMonth, Search, ChevronLeft, ChevronRight, AccessTime, Event } from '@mui/icons-material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { serviceVisitsApi, serviceOrdersApi, usersApi } from '../../services/api';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Buttons';
import FormErrors from '../../components/ui/FormErrors';
import { useNavigate } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Constantes e helpers
// ---------------------------------------------------------------------------
const EMPTY: any[] = [];

/**
 * Rótulo de uma opção de O.S.
 *
 * BUG corrigido: as opções vindas da API são objetos de O.S. (osNumber,
 * client) e NÃO têm um campo `label` — o label só era montado no `onChange`,
 * como estado do formulário. Com `getOptionLabel={(o) => o.label || ''}` toda
 * opção renderizava VAZIA: o dropdown abria (por isso "um dropdown preto")
 * mas sem uma linha legível. Mesma classe do bug do "undefined - undefined".
 */
function osLabel(option: any): string {
  if (!option) return '';
  if (option.label) return String(option.label);
  const numero = option.osNumber || option.id || '';
  const cliente = option.client?.name || option.clientName || '';
  if (!cliente) return String(numero);
  return `${numero} — ${cliente}`;
}

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

const durationMinutes = (arrival?: string | null, departure?: string | null): number => {
  if (!arrival || !departure) return 0;
  const start = new Date(arrival).getTime();
  const end = new Date(departure).getTime();
  if (isNaN(start) || isNaN(end)) return 0;
  const diff = end - start;
  return diff > 0 ? Math.round(diff / 60000) : 0;
};

const formatDuration = (minutes: number): string => {
  if (minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
};

/** Semana civil (segunda a domingo) que contém a data informada. */
const weekRange = (anchor: Date): [string, string] => {
  const day = anchor.getDay();
  const offset = (day + 6) % 7;
  const monday = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - offset);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return [toISODate(monday), toISODate(sunday)];
};

const statusLabel = (s?: string): string => {
  if (s === 'PENDING') return 'Pendente';
  if (s === 'APPROVED') return 'Aprovada';
  if (s === 'REJECTED') return 'Recusada';
  if (s === 'CANCELLED') return 'Cancelada';
  return 'Agendada';
};

const statusColor = (s?: string): 'success' | 'warning' | 'error' | 'default' => {
  if (s === 'APPROVED') return 'success';
  if (s === 'PENDING') return 'warning';
  if (s === 'REJECTED') return 'error';
  return 'default';
};

const formatAddress = (addr: any): string => {
  if (!addr) return '—';
  if (typeof addr === 'string') return addr || '—';
  const line = [addr.street, addr.number].filter(Boolean).join(', ');
  const city = [addr.city, addr.state].filter(Boolean).join('/');
  const result = [line, city].filter(Boolean).join(' - ');
  return result || '—';
};

interface VisitFormState {
  osId: string;
  osLabel: string;
  date: string;
  time: string;
  techId: string;
  notes: string;
  street: string;
  number: string;
  city: string;
  state: string;
  needsSecondVisit: boolean;
}

const emptyForm = (): VisitFormState => ({
  osId: '',
  osLabel: '',
  date: toISODate(new Date()),
  time: '',
  techId: '',
  notes: '',
  street: '',
  number: '',
  city: '',
  state: '',
  needsSecondVisit: false,
});

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------
export function VisitsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [dateFilter, setDateFilter] = useState(toISODate(new Date()));
  const [techFilter, setTechFilter] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<VisitFormState>(emptyForm());
  const [formError, setFormError] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [osSearch, setOsSearch] = useState('');

  const [action, setAction] = useState<{ type: 'reject' | 'reschedule'; visit: any } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [actionDatetime, setActionDatetime] = useState('');
  const [actionError, setActionError] = useState<any>(null);
  const [savingAction, setSavingAction] = useState(false);

  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  // --------------------------- POPUP AGENDAR (calendário + slots) ---------------------------
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleMonth, setScheduleMonth] = useState(new Date());
  const [scheduleDay, setScheduleDay] = useState<string | null>(null);
  const [scheduleTechId, setScheduleTechId] = useState('');
  const [scheduleDuration, setScheduleDuration] = useState<number | null>(null);
  const [scheduleOsId, setScheduleOsId] = useState('');
  const [scheduleOsLabel, setScheduleOsLabel] = useState('');
  const [scheduleOsSearch, setScheduleOsSearch] = useState('');
  const [scheduleError, setScheduleError] = useState<any>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  // Cache de slots por data+tech para não refazer a query ao trocar de dia
  const [slotsCache, setSlotsCache] = useState<Record<string, any>>({});
  // Ref para cache sempre atual (evita closure stale no fetchSlots)
  const slotsCacheRef = useRef(slotsCache);
  slotsCacheRef.current = slotsCache;

  const showSnack = (message: string, severity: 'success' | 'error') => setSnack({ open: true, message, severity });

  // Busca slots ao mudar dia/tech — lê/escreve no ref para evitar stale closure
  const fetchSlots = useCallback(async (date: string, techId?: string) => {
    const cacheKey = `${date}|${techId || 'all'}`;
    const cached = slotsCacheRef.current[cacheKey];
    if (cached) return cached;

    const h = { Authorization: 'Bearer ' + localStorage.getItem('token') };
    const tz = -new Date().getTimezoneOffset();
    const params = new URLSearchParams({ date, tzOffsetMinutes: String(tz) });
    if (techId) params.set('techId', techId);
    const res = await fetch(`/api/service-visits/slots?${params}`, { headers: h });
    const data = await res.json();
    setSlotsCache((prev) => ({ ...prev, [cacheKey]: data.data }));
    slotsCacheRef.current = { ...slotsCacheRef.current, [cacheKey]: data.data };
    return data.data;
  }, []);

  // Auto-fetch slots quando o dia ou técnico mudam no popup Agendar
  useEffect(() => {
    if (scheduleOpen && scheduleDay) {
      fetchSlots(scheduleDay, scheduleTechId || undefined);
    }
  }, [scheduleOpen, scheduleDay, scheduleTechId, fetchSlots]);

  const techniciansQuery = useQuery({
    queryKey: ['technicians'],
    queryFn: () => usersApi.getTechnicians(),
  });

  const visitsQuery = useQuery({
    queryKey: ['visits', techFilter],
    queryFn: () => serviceVisitsApi.list({ techId: techFilter || undefined }),
  });

  const osQuery = useQuery({
    queryKey: ['osSearch', osSearch],
    queryFn: () => serviceOrdersApi.list({ search: osSearch || undefined, take: 10 }),
    enabled: dialogOpen,
  });

  // Busca de O.S. para o popup Agendar
  const scheduleOsQuery = useQuery({
    queryKey: ['scheduleOsSearch', scheduleOsSearch],
    queryFn: () => serviceOrdersApi.list({ search: scheduleOsSearch || undefined, take: 10 }),
    enabled: scheduleOpen,
  });

  const technicians: any[] = techniciansQuery.data || EMPTY;
  const visits: any[] = visitsQuery.data || EMPTY;
  // A função `request` do api.ts desempacota (response.data?.data),
    // mas a API retorna { data: { data: [...] } } — por isso o ?.data aqui.
    const osOptions: any[] = (osQuery.data as any)?.data || EMPTY;
  // Mesmo caso para o popup Agendar
  const scheduleOsOptions: any[] = (scheduleOsQuery.data as any)?.data || EMPTY;

  const filtered = useMemo(
    () =>
      visits.filter((v: any) => {
        if (dateFilter && visitDateKey(v) !== dateFilter) return false;
        if (pendingOnly && v.appointmentStatus !== 'PENDING') return false;
        return true;
      }),
    [visits, dateFilter, pendingOnly]
  );

  const summary = useMemo(() => {
    const todayKey = toISODate(new Date());
    const [weekStart, weekEnd] = weekRange(new Date());
    let todayCount = 0;
    let pendingCount = 0;
    let minutes = 0;
    visits.forEach((v: any) => {
      const key = visitDateKey(v);
      if (key === todayKey) todayCount += 1;
      if (v.appointmentStatus === 'PENDING') pendingCount += 1;
      if (key && key >= weekStart && key <= weekEnd) minutes += durationMinutes(v.arrival, v.departure);
    });
    return { todayCount, pendingCount, weekHours: formatDuration(minutes) };
  }, [visits]);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['visits'] });
    queryClient.invalidateQueries({ queryKey: ['calendarVisits'] });
    queryClient.invalidateQueries({ queryKey: ['pendingVisits'] });
  };

  // --------------------------- Registro de horas ---------------------------
  const handleArrive = async (visit: any) => {
    try {
      await serviceVisitsApi.arrive(visit.id);
      refreshAll();
      showSnack('Chegada registrada com sucesso.', 'success');
    } catch (err: any) {
      showSnack(err?.response?.data?.error?.message || 'Erro ao registrar chegada.', 'error');
    }
  };

  const handleDepart = async (visit: any) => {
    try {
      await serviceVisitsApi.depart(visit.id);
      refreshAll();
      showSnack('Saída registrada com sucesso.', 'success');
    } catch (err: any) {
      showSnack(err?.response?.data?.error?.message || 'Erro ao registrar saída.', 'error');
    }
  };

  // ------------------------------ Aprovação --------------------------------
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
    } catch (err: any) {
      showSnack(err?.response?.data?.error?.message || 'Erro ao aprovar agendamento.', 'error');
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

  // ----------------------------- Nova visita -------------------------------
  const openDialog = () => {
    setForm(emptyForm());
    setFormError(null);
    setOsSearch('');
    setDialogOpen(true);
  };

  const submitVisit = async () => {
    setFormError(null);
    if (!form.osId) {
      setFormError('Selecione a O.S. da visita.');
      return;
    }
    if (!form.date) {
      setFormError('Informe a data da visita.');
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        osId: form.osId,
        date: form.date,
        scheduledAt: form.time ? new Date(`${form.date}T${form.time}:00`).toISOString() : null,
        // `null` explícito = SEM técnico. `undefined` faria o backend assumir
        // o usuário logado (vendedor/admin) e bloquear a agenda dele.
        techId: form.techId || null,
        notes: form.notes || undefined,
        needsSecondVisit: form.needsSecondVisit,
      };
      if (form.street) {
        payload.address = { street: form.street, number: form.number, city: form.city, state: form.state };
      }
      await serviceVisitsApi.create(payload);
      setDialogOpen(false);
      refreshAll();
      showSnack('Visita agendada com sucesso.', 'success');
    } catch (err) {
      setFormError(err);
    } finally {
      setSaving(false);
    }
  };

  // --------------------------- Submissão: POPUP AGENDAR ---------------------------
  const submitScheduleVisit = async () => {
    setScheduleError(null);
    if (!scheduleOsId) {
      setScheduleError('Selecione a O.S. da visita.');
      return;
    }
    if (!scheduleDay) {
      setScheduleError('Clique em um dia no calendário para selecionar a data.');
      return;
    }
    if (!scheduleDuration) {
      setScheduleError('Informe a duração prevista (Tempo Serviço).');
      return;
    }
    setScheduleSaving(true);
    try {
      const payload: any = {
        osId: scheduleOsId,
        date: scheduleDay,
        scheduledAt: new Date(`${scheduleDay}T00:00:00`).toISOString(),
        // `null` explícito = SEM técnico (ver comentário no diálogo "Nova Visita").
        techId: scheduleTechId || null,
        durationMinutes: scheduleDuration,
        needsSecondVisit: false,
        notes: `Agendado via popup — duração: ${scheduleDuration}min`,
      };
      await serviceVisitsApi.create(payload);
      setScheduleOpen(false);
      refreshAll();
      showSnack('Visita agendada com sucesso.', 'success');
    } catch (err: any) {
      setScheduleError(err?.response?.data?.error?.message || 'Erro ao agendar visita.');
    } finally {
      setScheduleSaving(false);
    }
  };

  // ------------------------------ Constes JSX ------------------------------
  const technicianItems = technicians.map((t: any) => (
    <MenuItem key={t.id} value={t.id}>
      {t.name}
    </MenuItem>
  ));

  const summaryCards = [
    { label: 'Visitas hoje', value: String(summary.todayCount), color: 'primary.main' },
    { label: 'Pendentes de aprovação', value: String(summary.pendingCount), color: 'warning.main' },
    { label: 'Horas na semana', value: summary.weekHours, color: 'success.main' },
  ].map((card) => (
    <Card key={card.label}>
      <CardContent sx={{ py: 2 }}>
        <Typography variant="caption" color="text.secondary" display="block">
          {card.label}
        </Typography>
        <Typography variant="h5" fontWeight={700} sx={{ color: card.color, mt: 0.5 }}>
          {card.value}
        </Typography>
      </CardContent>
    </Card>
  ));

  const visitRows = filtered.map((v: any) => {
    const dateKey = visitDateKey(v);
    const arrival = timeOf(v.arrival);
    const departure = timeOf(v.departure);
    const minutes = durationMinutes(v.arrival, v.departure);
    const isPending = v.appointmentStatus === 'PENDING';

    return (
      <TableRow key={v.id} hover>
        <TableCell>{formatDateKey(dateKey)}</TableCell>
        <TableCell>{timeOf(v.scheduledAt) || '—'}</TableCell>
        <TableCell>{v.tech?.name || '—'}</TableCell>
        <TableCell>
          <Typography variant="body2" fontWeight={600}>
            {v.os?.osNumber ? `OS ${v.os.osNumber}` : 'OS'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {v.os?.client?.name || '—'}
          </Typography>
        </TableCell>
        <TableCell sx={{ maxWidth: 240 }}>
          <Typography variant="caption" display="block" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {formatAddress(v.address)}
          </Typography>
          {v.needsSecondVisit && <Chip size="small" label="2ª ida" color="info" variant="outlined" sx={{ mt: 0.5 }} />}
        </TableCell>
        <TableCell align="center">
          <Chip size="small" label={statusLabel(v.appointmentStatus)} color={statusColor(v.appointmentStatus)} />
        </TableCell>
        <TableCell align="center">
          <Typography variant="caption" display="block">
            {arrival ? `Entrada ${arrival}` : 'Sem entrada'}
          </Typography>
          <Typography variant="caption" display="block">
            {departure ? `Saída ${departure}` : 'Sem saída'}
          </Typography>
          {minutes > 0 && <Chip size="small" label={formatDuration(minutes)} color="primary" variant="outlined" sx={{ mt: 0.5 }} />}
        </TableCell>
        <TableCell align="center">
          <Box sx={{ display: 'flex', gap: 0.75, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="outlined"
              color="success"
              disabled={!!v.arrival}
              startIcon={<Login fontSize="small" />}
              onClick={() => handleArrive(v)}
            >
              Chegou
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="warning"
              disabled={!v.arrival || !!v.departure}
              startIcon={<Logout fontSize="small" />}
              onClick={() => handleDepart(v)}
            >
              Saiu
            </Button>
            {isPending && (
              <>
                <Tooltip title="Aprovar">
                  <IconButton size="small" color="success" onClick={() => approveVisit(v)}>
                    <CheckCircle fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Recusar">
                  <IconButton size="small" color="error" onClick={() => openAction('reject', v)}>
                    <Close fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Reagendar">
                  <IconButton size="small" color="primary" onClick={() => openAction('reschedule', v)}>
                    <Schedule fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </Box>
        </TableCell>
      </TableRow>
    );
  });

  if (visitsQuery.isLoading) {
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
            Agenda / Registro de Horas
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Agendamentos externos, aprovação e ponto do técnico
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <SecondaryButton startIcon={<CalendarMonth />} onClick={() => navigate('/calendar')}>
            Ver Calendário
          </SecondaryButton>
          <PrimaryButton startIcon={<Add />} onClick={openDialog}>
            Nova Visita
          </PrimaryButton>
          <PrimaryButton startIcon={<Event />} onClick={() => { setScheduleOpen(true); setScheduleMonth(new Date()); setScheduleDay(null); setScheduleOsId(''); setScheduleOsLabel(''); setScheduleOsSearch(''); setScheduleTechId(''); setScheduleDuration(null); setScheduleError(null); }} color="secondary" variant="contained">
            Agendar
          </PrimaryButton>
        </Box>
      </Box>

      {/* Resumo */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mb: 3 }}>
        {summaryCards}
      </Box>

      {/* Filtros */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              type="date"
              label="Data"
              size="small"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 170 }}
            />
            <SecondaryButton size="small" onClick={() => setDateFilter('')}>
              Todas as datas
            </SecondaryButton>
            <TextField
              select
              label="Técnico"
              size="small"
              value={techFilter}
              onChange={(e) => setTechFilter(e.target.value)}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">Todos os técnicos</MenuItem>
              {technicianItems}
            </TextField>
            <FormControlLabel
              control={<Switch checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />}
              label="Somente pendentes"
            />
            <Button
              size="small"
              startIcon={<Search fontSize="small" />}
              onClick={() => setDateFilter(toISODate(new Date()))}
            >
              Hoje
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Data</TableCell>
                <TableCell>Horário</TableCell>
                <TableCell>Técnico</TableCell>
                <TableCell>O.S. / Cliente</TableCell>
                <TableCell>Endereço</TableCell>
                <TableCell align="center">Status</TableCell>
                <TableCell align="center">Horas trabalhadas</TableCell>
                <TableCell align="center">Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visitRows}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                    Nenhuma visita encontrada para os filtros selecionados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* Dialog: nova visita */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Nova Visita</DialogTitle>
        <DialogContent dividers>
          <FormErrors error={formError} onClose={() => setFormError(null)} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mt: formError ? 2 : 1 }}>
            <Box sx={{ gridColumn: '1 / -1' }}>
              <Autocomplete
                options={osOptions}
                value={form.osId ? { id: form.osId, label: form.osLabel } : null}
                inputValue={osSearch}
                getOptionLabel={(option: any) => osLabel(option)}
                isOptionEqualToValue={(option: any, value: any) => option.id === value.id}
                noOptionsText={osQuery.isFetching ? 'Buscando...' : 'Nenhuma O.S. encontrada'}
                onChange={(_e: any, option: any) => {
                  setForm({
                    ...form,
                    osId: option?.id || '',
                    osLabel: osLabel(option),
                  });
                }}
                onInputChange={(_e: any, value: any) => setOsSearch(value || '')}
                renderInput={(params) => (
                  <TextField {...params} label="Ordem de Serviço *" placeholder="Buscar por número da O.S. ou cliente" />
                )}
              />
            </Box>
            <TextField
              type="date"
              label="Data *"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              type="time"
              label="Horário agendado"
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
            <TextField select label="Técnico" value={form.techId} onChange={(e) => setForm({ ...form, techId: e.target.value })} fullWidth>
              <MenuItem value="">A definir</MenuItem>
              {technicianItems}
            </TextField>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <FormControlLabel
                control={<Checkbox checked={form.needsSecondVisit} onChange={(e) => setForm({ ...form, needsSecondVisit: e.target.checked })} />}
                label="Necessita segunda ida"
              />
            </Box>
            <Typography variant="subtitle2" sx={{ gridColumn: '1 / -1', mb: -1 }}>
              Endereço da visita
            </Typography>
            <TextField label="Rua" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} fullWidth />
            <TextField label="Número" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} fullWidth />
            <TextField label="Cidade" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} fullWidth />
            <TextField
              label="UF"
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase().slice(0, 2) })}
              fullWidth
            />
            <TextField
              label="Observações"
              multiline
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              fullWidth
              sx={{ gridColumn: '1 / -1' }}
              placeholder="Observações sobre a visita..."
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <PrimaryButton onClick={submitVisit} loading={saving}>
            Agendar
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* Dialog: AGENDAR (calendário + slots + duração) */}
      <Dialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <Typography>Agendar Visita</Typography>
            <Chip size="small" label="Passo 1: Escolha a data" color="primary" variant="outlined" />
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          <FormErrors error={scheduleError} onClose={() => setScheduleError(null)} />
          <Box sx={{ display: 'flex', gap: 3, mt: 1 }}>
            {/* Lado esquerdo: Calendário do mês */}
            <Box sx={{ flex: 1, minWidth: 280 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <IconButton size="small" onClick={() => setScheduleMonth(new Date(scheduleMonth.getFullYear(), scheduleMonth.getMonth() - 1, 1))}>
                  <ChevronLeft fontSize="small" />
                </IconButton>
                <Typography variant="h6" fontWeight={600}>
                  {scheduleMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                </Typography>
                <IconButton size="small" onClick={() => setScheduleMonth(new Date(scheduleMonth.getFullYear(), scheduleMonth.getMonth() + 1, 1))}>
                  <ChevronRight fontSize="small" />
                </IconButton>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, textAlign: 'center' }}>
                {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d) => (
                  <Box key={d} sx={{ py: 0.5, fontWeight: 600, fontSize: '0.75rem', color: 'text.secondary' }}>{d}</Box>
                ))}
                {(() => {
                  const firstDay = new Date(scheduleMonth.getFullYear(), scheduleMonth.getMonth(), 1);
                  const startOffset = (firstDay.getDay() + 6) % 7;
                  const daysInMonth = new Date(scheduleMonth.getFullYear(), scheduleMonth.getMonth() + 1, 0).getDate();
                  const cells = [];
                  for (let i = 0; i < startOffset; i++) cells.push(<Box key={`empty-${i}`} />);
                  for (let day = 1; day <= daysInMonth; day++) {
                    const dateStr = `${scheduleMonth.getFullYear()}-${String(scheduleMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const isToday = dateStr === toISODate(new Date());
                    const isSelected = dateStr === scheduleDay;
                    cells.push(
                      <Box
                        key={day}
                        sx={{
                          cursor: 'pointer',
                          p: 1,
                          borderRadius: 1,
                          fontSize: '0.875rem',
                          backgroundColor: isSelected ? 'primary.main' : isToday ? 'action.hover' : 'transparent',
                          color: isSelected ? 'primary.contrastText' : isToday ? 'primary.main' : 'inherit',
                          fontWeight: isToday ? 700 : 400,
                          '&:hover': { backgroundColor: isSelected ? 'primary.dark' : 'action.hover' },
                        }}
                        onClick={() => setScheduleDay(dateStr)}
                      >
                        {day}
                      </Box>
                    );
                  }
                  return cells;
                })()}
              </Box>
            </Box>

            {/* Lado direito: Slots + O.S. + Duração */}
            <Box sx={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                  {scheduleDay ? `Horários para ${formatDateKey(scheduleDay)}` : 'Selecione um dia no calendário'}
                </Typography>
                {scheduleDay && (
                  <>
                    <TextField
                      select
                      label="Técnico (opcional — filtra horários livres)"
                      value={scheduleTechId}
                      onChange={(e) => setScheduleTechId(e.target.value)}
                      fullWidth
                      sx={{ mb: 2 }}
                    >
                      <MenuItem value="">Todos os técnicos</MenuItem>
                      {technicians.map((t: any) => (
                        <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                      ))}
                    </TextField>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 280, overflow: 'auto', mb: 2 }}>
                      {(() => {
                        const cacheKey = `${scheduleDay}|${scheduleTechId || 'all'}`;
                        const cached = slotsCache[cacheKey];
                        if (!cached) return <Typography variant="body2" color="text.secondary">Carregando horários...</Typography>;
                        const slots = cached.slots || [];
                        if (slots.length === 0) return <Typography variant="body2" color="text.secondary">Nenhum horário disponível neste dia.</Typography>;
                        return slots.map((slot: any) => (
                          <Button
                            key={slot.label}
                            size="small"
                            variant={slot.available ? 'outlined' : 'text'}
                            color={slot.available ? 'primary' : 'inherit'}
                            disabled={!slot.available}
                            onClick={() => { /* slot apenas informativo; duração define o fim */ }}
                          >
                            {slot.label} {slot.available ? '✓' : '✗'}
                          </Button>
                        ));
                      })()}
                    </Box>
                  </>
                )}
              </Box>

              <Divider sx={{ mb: 1 }} />
              <Box>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Ordem de Serviço</Typography>
                <Autocomplete
                  options={scheduleOsOptions}
                  value={scheduleOsId ? { id: scheduleOsId, label: scheduleOsLabel } : null}
                  getOptionLabel={(option: any) => osLabel(option)}
                  isOptionEqualToValue={(option: any, value: any) => option.id === value.id}
                  noOptionsText={scheduleOsQuery.isFetching ? 'Buscando...' : 'Nenhuma O.S. encontrada'}
                  onChange={(_e: any, option: any) => {
                    setScheduleOsId(option?.id || '');
                    setScheduleOsLabel(osLabel(option));
                  }}
                  onInputChange={(_e: any, value: any) => setScheduleOsSearch(value || '')}
                  renderInput={(params) => (
                    <TextField {...params} label="Buscar O.S. por número ou cliente" placeholder="Digite para buscar..." fullWidth />
                  )}
                  sx={{ mb: 2 }}
                />
              </Box>

              <Box>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Tempo de Serviço (duração)</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                  <TextField
                    type="number"
                    label="Minutos"
                    value={scheduleDuration ?? ''}
                    onChange={(e) => setScheduleDuration(e.target.value ? Number(e.target.value) : null)}
                    inputProps={{ min: 5, max: 480, step: 5 }}
                    sx={{ width: 140 }}
                    InputLabelProps={{ shrink: true }}
                  />
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {[30, 60, 90, 120, 180, 240].map((m) => (
                      <Button
                        key={m}
                        size="small"
                        variant={scheduleDuration === m ? 'contained' : 'outlined'}
                        color="primary"
                        onClick={() => setScheduleDuration(scheduleDuration === m ? null : m)}
                      >
                        {m <= 60 ? `${m}min` : `${m / 60}h`}
                      </Button>
                    ))}
                  </Box>
                </Box>
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScheduleOpen(false)} disabled={scheduleSaving}>
            Cancelar
          </Button>
          <PrimaryButton onClick={submitScheduleVisit} loading={scheduleSaving} disabled={!scheduleDay || !scheduleDuration}>
            Agendar
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* Dialog: recusa / reagendamento */}
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

export default VisitsPage;
