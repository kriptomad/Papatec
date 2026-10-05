import { Box, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Grid, Typography, List, ListItem, ListItemText, ListItemAvatar, Avatar, Chip, FormControl, InputLabel, Select, MenuItem, Snackbar, Alert, IconButton, Checkbox } from '@mui/material';
import { Add, Edit, Delete, Schedule, AccessTime, CheckCircle, Directions } from '@mui/icons-material';
import { useState } from 'react';
import { serviceVisitsApi } from '../../services/api';
import type { ServiceVisit, ServiceAddress } from '../../types';
import { formatDate, formatDateTime } from '../../utils/formatters';

interface OSVisitsTabProps { osId: string; visits?: any[]; onVisitsChange?: (visits: any[]) => void; editable?: boolean; clientAddresses?: any[]; currentUserId?: string; currentUserRole?: string; }

export function OSVisitsTab({ osId, visits = [], onVisitsChange, editable = true, clientAddresses = [], currentUserId, currentUserRole }: OSVisitsTabProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVisit, setEditingVisit] = useState<any>(null);
  const [formData, setFormData] = useState<any>({});
  const [submitting, setSubmitting] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });

  const showSnackbar = (message: string, severity: 'success' | 'error') => { setSnackbar({ open: true, message, severity }); };
  const isTechOwner = (visit: any) => visit.techId === currentUserId || currentUserRole === 'ADMIN';
  const canEdit = editable && (!editingVisit || isTechOwner(editingVisit) || currentUserRole === 'ADMIN');

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const toLocalInput = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const todayInput = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const resetForm = (visit?: any) => {
    if (visit) setFormData({ date: visit.date?.split('T')[0] || '', scheduledAt: visit.scheduledAt ? toLocalInput(visit.scheduledAt) : '', address: visit.address || {}, needsSecondVisit: visit.needsSecondVisit || false, notes: visit.notes || '' });
    else setFormData({ date: todayInput(), scheduledAt: '', address: {}, needsSecondVisit: false, notes: '' });
  };

  const openDialog = (visit?: any) => { setEditingVisit(visit || null); resetForm(visit); setDialogOpen(true); };

  const handleSubmit = async () => {
    if (!formData.date) return;
    setSubmitting(true);
    try {
      const payload = { osId, date: formData.date, scheduledAt: formData.scheduledAt ? new Date(formData.scheduledAt).toISOString() : null, address: formData.address, needsSecondVisit: formData.needsSecondVisit, notes: formData.notes };
      let updatedVisit: any;
      if (editingVisit) { updatedVisit = await serviceVisitsApi.update(editingVisit.id, payload); if (onVisitsChange) onVisitsChange(visits.map(v => v.id === editingVisit.id ? updatedVisit : v)); }
      else { updatedVisit = await serviceVisitsApi.create(payload); if (onVisitsChange) onVisitsChange([...visits, updatedVisit]); }
      setDialogOpen(false);
    } catch (e) { console.error('Erro ao salvar visita:', e); showSnackbar('Erro ao salvar', 'error'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (visitId: string) => { try { await serviceVisitsApi.remove(visitId); if (onVisitsChange) onVisitsChange(visits.filter(v => v.id !== visitId)); showSnackbar('Visita excluída', 'success'); } catch (e) { console.error('Erro ao excluir visita:', e); showSnackbar('Erro ao excluir', 'error'); } };

  const handleAddressSelect = (address: any) => { setFormData(prev => ({ ...prev, address })); };

  const formatVisitTime = (dateStr: string, timeStr?: string | null) => { if (!timeStr) return ''; try { const date = new Date(timeStr); return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

  const getStatusColor = (status: string) => { switch (status) { case 'APPROVED': return 'success'; case 'REJECTED': return 'error'; case 'CANCELLED': return 'default'; default: return 'warning'; } };
  const getStatusLabel = (status: string) => { switch (status) { case 'PENDING': return 'Pendente'; case 'APPROVED': return 'Aprovada'; case 'REJECTED': return 'Recusada'; case 'CANCELLED': return 'Cancelada'; default: return status; } };
  const getDuration = (arrival?: string, departure?: string) => { if (!arrival || !departure) return '—'; try { const start = new Date(arrival).getTime(); const end = new Date(departure).getTime(); const diff = end - start; if (diff <= 0) return '—'; const hours = Math.floor(diff / 3600000); const minutes = Math.floor((diff % 3600000) / 60000); return hours + 'h ' + minutes + 'min'; } catch { return '—'; } };
  // Briefing C: total de horas apontadas nesta O.S.
  const totalWorkedMs = visits.reduce((sum: number, v: any) => (v.arrival && v.departure ? sum + Math.max(0, new Date(v.departure).getTime() - new Date(v.arrival).getTime()) : sum), 0);
  const totalWorkedLabel = totalWorkedMs > 0 ? `${Math.floor(totalWorkedMs / 3600000)}h ${Math.floor((totalWorkedMs % 3600000) / 60000)}min` : null;

  // Extract map to variable for TS7.0.2 bug
  const visitRows = visits.map(visit => (
    <ListItem key={visit.id} sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }} disablePadding>
      <ListItemAvatar><Avatar sx={{ bgcolor: getStatusColor(visit.appointmentStatus) === 'success' ? 'success.main' : getStatusColor(visit.appointmentStatus) === 'error' ? 'error.main' : getStatusColor(visit.appointmentStatus) === 'default' ? 'default.main' : 'warning.main' }}><Schedule fontSize="medium" /></Avatar></ListItemAvatar>
      <ListItemText primary={
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{visit.address?.label || 'Visita'}{visit.address?.street && <Typography variant="caption" color="text.secondary">{visit.address.street}{visit.address.number ? ', ' + visit.address.number : ''}{visit.address.city ? ' - ' + visit.address.city : ''}</Typography>}</Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5, flexWrap: 'wrap' }}>
            <Chip label={formatDate(visit.date)} icon={<Schedule fontSize="small" />} size="small" variant="outlined" />
            {visit.scheduledAt && <Chip label={formatVisitTime(visit.date, visit.scheduledAt)} icon={<AccessTime fontSize="small" />} size="small" variant="outlined" color="info" />}
            {visit.needsSecondVisit && <Chip label="2ª ida" icon={<CheckCircle fontSize="small" />} size="small" color="info" variant="outlined" />}
            <Chip label={getStatusLabel(visit.appointmentStatus)} size="small" color={getStatusColor(visit.appointmentStatus)} variant="filled" />
          </Box>
        </Box>
      } secondary={
        <Box sx={{ minWidth: 200, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5 }}>
          {visit.arrival && <Typography variant="caption"><AccessTime fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} /> Entrada: {formatVisitTime(visit.date, visit.arrival)}</Typography>}
          {visit.departure && <Typography variant="caption"><AccessTime fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} /> Saída: {formatVisitTime(visit.date, visit.departure)}</Typography>}
          {(visit.arrival || visit.departure) && <Chip label={getDuration(visit.arrival, visit.departure)} size="small" color="primary" variant="outlined" />}
          {editable && <Box sx={{ display: 'flex', gap: 1, mt: 1 }}><IconButton size="small" onClick={() => openDialog(visit)} aria-label="Editar" disabled={!canEdit}><Edit fontSize="small" /></IconButton><IconButton size="small" color="error" onClick={() => handleDelete(visit.id)} aria-label="Excluir"><Delete fontSize="small" /></IconButton></Box>}
        </Box>
      } />
    </ListItem>
  ));

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Typography variant="h6">Agendamento de Visitas</Typography>
          {totalWorkedLabel && <Chip label={`Horas apontadas: ${totalWorkedLabel}`} color="primary" icon={<AccessTime fontSize="small" />} size="small" />}
        </Box>
        {editable && <Button startIcon={<Add />} variant="contained" onClick={() => { setFormData({ date: todayInput(), scheduledAt: '', address: {}, needsSecondVisit: false, notes: '' }); }}>Nova Visita</Button>}
      </Box>
      <List dense>{visitRows}</List>
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingVisit ? 'Editar Visita' : 'Nova Visita'}</DialogTitle>
        <DialogContent>
          <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}><TextField fullWidth type="date" label="Data da Visita *" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} required InputLabelProps={{ shrink: true }} /></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth type="datetime-local" label="Horário Agendado" value={formData.scheduledAt} onChange={(e) => setFormData({ ...formData, scheduledAt: e.target.value })} InputLabelProps={{ shrink: true }} /></Grid>
              <Grid item xs={12}><Typography variant="subtitle2" sx={{ mb: 1 }}>Endereço da Visita</Typography></Grid>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth><InputLabel id="address-select-label">Endereços do Cliente</InputLabel>
                  <Select label="Endereços do Cliente" value={formData.address?.id || ''} onChange={(e) => { const selected = clientAddresses.find(a => a.id === e.target.value); if (selected) handleAddressSelect(selected); }}>
                    <MenuItem value="">Selecionar endereço do cadastro</MenuItem>
                    {clientAddresses.map(addr => <MenuItem key={addr.id} value={addr.id}>{addr.label || 'Endereço'} — {addr.street}{addr.number ? ', ' + addr.number : ''}{addr.city ? ' - ' + addr.city : ''}</MenuItem>)}
                    <MenuItem value="manual">Digitar manualmente</MenuItem>
                  </Select></FormControl>
              </Grid>
              {formData.address?.id === 'manual' && (
                <>
                  <Grid item xs={12} sm={6}><TextField fullWidth label="Rua *" value={formData.address?.street || ''} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, street: e.target.value } })} /></Grid>
                  <Grid item xs={12} sm={2}><TextField fullWidth label="Número" value={formData.address?.number || ''} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, number: e.target.value } })} /></Grid>
                  <Grid item xs={12} sm={4}><TextField fullWidth label="Complemento" value={formData.address?.complement || ''} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, complement: e.target.value } })} /></Grid>
                  <Grid item xs={12} sm={4}><TextField fullWidth label="Bairro" value={formData.address?.district || ''} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, district: e.target.value } })} /></Grid>
                  <Grid item xs={12} sm={4}><TextField fullWidth label="CEP" value={formData.address?.zip || ''} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, zip: e.target.value } })} /></Grid>
                  <Grid item xs={12} sm={4}><TextField fullWidth label="Cidade" value={formData.address?.city || ''} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, city: e.target.value } })} /></Grid>
                  <Grid item xs={12} sm={2}><TextField fullWidth label="UF" value={formData.address?.state || ''} onChange={(e) => setFormData({ ...formData, address: { ...formData.address, state: e.target.value.toUpperCase() } })} /></Grid>
                </>
              )}
              <Grid item xs={12}><Typography variant="body2" color="text.secondary">Necessidade de segunda ida (não obrigatório)</Typography><Box sx={{ mt: 0.5 }}><Checkbox checked={formData.needsSecondVisit} onChange={(e) => setFormData({ ...formData, needsSecondVisit: e.target.checked })} color="primary" /></Box></Grid>
              <Grid item xs={12}><TextField fullWidth multiline rows={3} label="Observações" value={formData.notes || ''} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Observações sobre a visita..." /></Grid>
            </Grid>
          </form>
        </DialogContent>
        <DialogActions><Button onClick={() => setDialogOpen(false)}>Cancelar</Button><Button variant="contained" onClick={handleSubmit} disabled={submitting || !formData.date}>{submitting ? 'Salvando...' : (editingVisit ? 'Atualizar' : 'Agendar')}</Button></DialogActions>
      </Dialog>
      <Snackbar open={snackbar.open} autoHideDuration={3000} onClose={() => setSnackbar({ ...snackbar, open: false })}><Alert severity={snackbar.severity} onClose={() => setSnackbar({ ...snackbar, open: false })} variant="filled">{snackbar.message}</Alert></Snackbar>
    </Box>
  );
}